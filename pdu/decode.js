/*
Copyright (C) 2015 Wilfried Chauveau

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION
OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
*/

'use strict';

var moment = require('moment'),
    _ = require('lodash'),
    encoders = {
    '7bit': require('./7bit.js'),
    '8bit': require('./8bit.js'),
    '16bit': require('./16bit.js')
},  TPStatus = {
    '00': 'received',
    '01': 'forwarded but unable to confirm delivery',
    '02': 'replaced by SC',
    '20': 'congestion',
    '21': 'SME busy',
    '22': 'no response from SME',
    '23': 'service rejected',
    '24': 'quality of service not available',
    '25': 'error in SME',
    '40': 'remote procedure error',
    '41': 'incompatible destination',
    '42': 'connection rejected by SME',
    '43': 'not obtainable',
    '44': 'quality of service not available',
    '45': 'no interworking available',
    '46': 'SM validity period expired',
    '47': 'SM deleted by originating SME',
    '48': 'SM deleted by SC administration',
    '49': 'SM does not exist'
};

function readByte(state) {
    var val = state.pdu.slice(state.cursor, state.cursor+2);
    state.cursor += 2;
    return val;
}

function parseByte(state) {
    return parseInt(readByte(state), 16);
}

function parseTimestamp(state) {
    var year = readByte(state);
    var month = readByte(state);
    var day = readByte(state);
    var hour = readByte(state);
    var minute = readByte(state);
    var second = readByte(state);
    var tz = readByte(state);
    tz = parseInt(tz[1] + tz[0]);
    tz = (tz & 0x80) * 15;
    var tz_sign = (!!(tz & 0x80))? '-' : '+',
        tz_hour = Math.floor(tz/60),
        tz_min = tz - tz_hour*60;
    return moment(
        year[1] + year[0] +
        month[1] + month[0] +
        day[1] + day[0] +
        hour[1] + hour[0] +
        minute[1] + minute[0] +
        second[1] + second[0] +
        tz_sign + tz_hour + ':' + tz_min,
        'YYMMDDHHmmssZZ');
}

function decodeAddress(state, isSMSC) {
    var len = parseByte(state);
    if (isSMSC) {
        len = (len - 1)*2;
    }
    // skip type of address/numbering plan
    state.cursor+=2;
    var addr = '';
    while (len > 0) {
        var digits = readByte(state);
        
        addr += digits[1];
        if (digits[0] === 'F') {
            break;
        }
        addr += digits[0];
        len -= 2;
    }
    return addr;
}

function decode(pdu, direction) {
    var msg = {};
    var state = {
        pdu: pdu,
        cursor: 0
    };
    msg.smsc = decodeAddress(state, true);
    var head = parseByte(state);
    var mti = head & 0x03;
    if (direction === 'MS->SC') {
            throw new Error ('not implemented');
    } else {
        if (mti === 2) {
            msg.mti = 'SMS-STATUS-REPORT';
            msg.srq = !!(head & 0x20);
            msg.mms = !!(head & 0x04);
            msg.ref = parseByte(state);
            msg.recipientAddress = decodeAddress(state);
            msg.timestamp = parseTimestamp(state);
            msg.dischargeTime = parseTimestamp(state);
            var st = readByte(state);
            if (TPStatus[st]) {
                msg.status = TPStatus[st];
            } else {
                msg.status = 'SC specific value: ' + st;
            }
        } else if (mti === 1) {
            throw new Error ('not implemented');
        } else if (mti === 0) {
            msg.mti = 'SMS-DELIVER';
            // MMS, SRI UDHI RP
            msg.originatingAddress = decodeAddress(state);
            //skip TP-PID
            readByte(state);
            var dcs = readByte(state);
            msg.timestamp = parseTimestamp(state);
            var encoding = _.findKey(encoders, 'dcs', dcs);
            if (!encoding) {
                throw new Error('Unsupported encoding');
            }
            var udl = parseByte(state);
            var ud = encoders[encoding].decode(udl, state.pdu.slice(state.cursor));
            msg.udh = ud.head;
            msg.text = ud.text;
        } else {
            throw new Error ('invalid MTI');
        }
    }
        
    return msg;
}

module.exports = decode;
