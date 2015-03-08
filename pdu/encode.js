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

var toHexByte = require('../utils.js').toHexByte;

var TPSRR  = 32,
    TPUDHI = 64;

var SMS_SUBMIT = 1;

var encoders = {
    '7bit': require('./7bit.js'),
    '8bit': require('./8bit.js'),
    '16bit': require('./16bit.js')
};

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

function detectDCS(text) {
    var i = 0;
    while (i < text.length && 
           encoders['7bit'].alpha.indexOf(text[i]) !== -1) {
        i++;
    }
    console.log(i);
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
        pdu += toHexByte(opts.vp);
    }
    
    return pdu + opts.encoder.encode(text, udh);
}

function encode(msg) {
    var pdus = [];
    
    var encoding = msg.encoding || detectDCS(msg.text);
    var encoder = encoders[encoding];
    var bounadies = encoder.boundaries(msg.text);
    var vp = {
        format: 0x10,
        value: 0
    };
    
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
        vp: vp.value,
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