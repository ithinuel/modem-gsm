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
    toHexByte = require('../utils.js').toHexByte;

var TPSRR  = 32,
    TPUDHI = 64,
    SMS_SUBMIT = 1,
    HOUR = 60,
    DAY = 24 * HOUR,
    WEEK = 7 * DAY;


var encoders = {
    '7bit': require('./7bit.js'),
    '8bit': require('./8bit.js'),
    '16bit': require('./16bit.js')
};

function encodeAddress(addr, isSC) {
    if (!addr) {
        return '00';
    }
    
    var pdu = '',
        addr_len = addr.length,
        toanp = '81',
        idx = 0;
    if (addr[0] === '+') {
        toanp = '91';
        addr_len--; idx++;
    }
    if (isSC) {
        pdu += toHexByte(2 + Math.ceil(addr_len/2));
    } else {
        pdu += toHexByte(addr_len);
    }
    
    pdu += toanp;
    while (idx < addr.length) {
        if (idx+1 === addr.length) {
            pdu += 'F';
        } else {
            pdu += addr.charAt(idx+1);
        }
        pdu += addr.charAt(idx);
        idx += 2;
    }
    
    return pdu;
}

function detectDCS(text) {
    var i = 0;
    while (i < text.length && 
           encoders['7bit'].alpha.indexOf(text[i]) !== -1) {
        i++;
    }
    
    if (i === text.length) {
        return '7bit';
    } else if (text.charCodeAt(i) > 255) {
        return '16bit';
    }
    
    return '8bit';
}

function generatePdu(text, opts) {
    var udh;
    if (opts.cnt > 1) {
        udh = '050003' + opts.ref +
            toHexByte(opts.cnt) +
            toHexByte(opts.idx+1);
    }

    var pdu = opts.smsc;
    pdu += toHexByte(opts.mti);
    if (opts.cnt > 1) {
        pdu += toHexByte(Math.random()*256);
    } else {
        pdu += opts.ref;
    }
    
    pdu += opts.receiver;
    // TP-PDI + TP-DCS
    pdu += '00' + opts.encoder.dcs;
    // TP-VP
    if (opts.hasOwnProperty('vp')) {
        if (opts.vp.format === 0x10) {
            pdu += toHexByte(opts.vp.value);
        } else if (opts.vp.format === 0x18) {
            pdu += opts.vp.value;
        }
    }
    
    return pdu + opts.encoder.encode(text, udh);
}

function encode(msg) {
    var pdus = [];
    
    var encoding = msg.encoding || detectDCS(msg.text);
    var encoder = encoders[encoding];
    var bounadies = encoder.boundaries(msg.text);
    var vp = {
        format: 0x00
    };
    
    if (msg.expiresIn) {
        if (typeof msg.expiresIn === 'number') {
            vp.format = 0x10;
            if (msg.expiresIn <= 12*HOUR) {
                vp.value = Math.ceil(msg.expiresIn / 5) - 1;
            } else if (msg.expiresIn <= DAY) {
                vp.value = 143 + Math.ceil((msg.expiresIn - 12*HOUR) / 30);
            } else if (msg.expiresIn <= WEEK) {
                vp.value = 166 + Math.ceil(msg.expiresIn / DAY);
            } else {
                vp.value = 192 + Math.ceil(msg.expiresIn / WEEK);
            }
        }
    } else if (msg.expiresAt) {
        var date = moment(msg.expiresAt);
        var d = date.utc().format('YYMMDDHHmmss');
        vp.format = 0x18;
        vp.value = d[1] + d[0] + d[3] + d[2] + d[5] + d[4] +
            d[7] + d[6] + d[9] + d[8] + d[11] + d[10] + '00';
    }
    
    /*
    extract/generate meta information
    break message into parts & generatePdu for each Part
    */
    var opts = {
        ref: toHexByte(Math.floor(Math.random()*256)),
        cnt: bounadies.cnt,
        idx: 0,
        mti: SMS_SUBMIT |
        (msg.statusReport ? TPSRR : 0) |
        vp.format |
        ((bounadies.cnt !== 1) ? TPUDHI : 0),
        vp: vp,
        encoder: encoder
    };
    
    opts.smsc = encodeAddress(msg.smsc, true);
    opts.receiver = encodeAddress(msg.receiver);
    
    var offset = 0;
    while (opts.idx < opts.cnt) {
        var text = msg.text.substr(offset, bounadies.max);
        offset += bounadies.max;
        
        var pdu = generatePdu(text, opts);
        pdus.push(pdu);
        opts.idx++;
    }
    
    return pdus;
}

module.exports = encode;