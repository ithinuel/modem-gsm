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

var Pdu = {};


var TPRD   = 4,
    TPVPF  = 8,
    TPSRR  = 32,
    TPUDHI = 64,
    TPRP   = 128;

// SC->MS
var SMS_DELIVER = 0,
    SMS_SUBMIT_REPORT = 1,
    SMS_STATUS_REPORT = 2;

// MS->SC
var SMS_DELIVER_REPORT = 0,
    SMS_SUBMIT = 1,
    SMS_COMMAND = 2;

var encoders = {
    '7bit': {
        id: 0,
        encode: encodeAs7bit
    },
    '8bit': {
        id: 4,
        encode: encodeAs8bit
    },
    '16bit': {
        id: 8,
        encode: encodeAs16bit
    }
};


function encodeAs16bit(text) {
    var pdu = '';
    for (var i = 0; i < text.length; i++) {
        pdu += ('000' + text.charCodeAt(i).toString(16)).slice(-4);
    }
    return pdu;
}

function encodeAs8bit(text) {
    var pdu = '';
    for (var i = 0; i < text.length; i++) {
        pdu += toHexByte(text);
    }
    return pdu;
}
function encodeAs7bit() {
    return '';
}

function toHexByte(text) {
    return ('0' + text.toString(16)).slice(-2);
}

function encodeAddress(addr, isSC) {
    var pdu = '';
    if (!addr) {
        return '00';
    }
    
    if (isSC) {
        pdu += toHexByte(2 + Math.ceil(addr.length/2));
    } else {
        pdu += toHexByte(addr.length);
    }
    pdu += '91';
    
    for (var i = 0; i < addr.length; i+=2) {
        if (i+1 === addr.length) {
            pdu += 'F';
        } else {
            pdu += addr.charAt(i+1);
        }
        pdu += addr.charAt(i);
    }
    
    return pdu;
}

function autoDetectDCS() {
    return '16bit';
}

Pdu.encode = function pduEncode(msg) {
    var pdus = [];
    
    var partLen = 1;
    var partCnt = 1;
    var encoding = msg.encoding || autoDetectDCS(msg.text);
    
    if(encoding === '16bit') {
        if (msg.text.length > 70) {
            partLen = 66;
        } else {
            partLen = 70;
        }
    } else if (encoding === '8bit') {
        if (msg.text.length > 140) {
             partLen = 132;
        } else {
            partLen = 140;
        }
    } else {
        if (msg.text.length > 160) {
            partLen = 153;
        } else {
            partLen = 160;
        }
    }
    
    partCnt = msg.text.length / partLen;
    partCnt = Math.ceil(partCnt);
    
    // SCA
    var head = encodeAddress(msg.smsc, true);
    // TP-MIT etc
    head += toHexByte(
        SMS_SUBMIT |
        (msg.statusReport ? TPSRR : 0) | 
        ((partCnt !== 1) ? TPUDHI : 0)
    );
    // TP-MR
    head += toHexByte(Math.random()*256);
    // TP-DA
    head += encodeAddress(msg.receiver);
    // TP-PID
    head += '00';
    // TP-DCS
    head += toHexByte(encoders[encoding].id);
    // TP-VP
    if (false) {
        head += '00';
    }
    
    var offset = 0;
    for (var partIdx = 0; partIdx < partCnt; partIdx ++) {
        var partText = msg.text.substr(offset, partLen);
        
        var udl = Math.min(partText.length, partLen);
        if (encoding === '16bit') {
            udl *= 2;
        }
        var ud = encoders[encoding].encode(partText);
        
        console.log(head + toHexByte(udl) + ud);
        pdus.push(head + toHexByte(udl) + ud);
    }
    
    return pdus;
};

module.exports = Pdu;
