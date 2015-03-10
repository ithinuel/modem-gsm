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

function boundaries16bit(text) {
    if (text.length > 70) {
        return {max: 67, cnt: Math.ceil(text.length/67)};
    }
    return {max: 70, cnt: 1};
}

function encodeUserDataAs16bit(text, udh) {
    var ud = udh || '';
    for (var i = 0; i < text.length; i++) {
        ud += ('000' + text.charCodeAt(i).toString(16)).slice(-4);
    }
    return toHexByte(ud.length/2) + ud;
}

function decodeUserDataAs16bit(offset, udl, state) {
    var text = '';
    var idx = offset;
    while (idx < udl) {
        var wc = state.pdu.slice(state.cursor, state.cursor + 4);
        state.cursor += 4;
        text += String.fromCharCode('0x' + wc);
        idx += 2;
    }
    
    return text;
}

module.exports = {
    boundaries: boundaries16bit,
    dcs: '08',
    decode: decodeUserDataAs16bit,
    encode: encodeUserDataAs16bit
};