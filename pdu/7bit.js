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

var toHexByte = require('../utils.js').toHexByte,
    parseByte = require('../utils.js').parseByte;

var sevenBitAlpha = [
    '@', '£', '$', '¥', 'è', 'é', 'ù', 'ì', 'ò', 'Ç',
    '\n', 'Ø', 'ø', '\r','Å', 'å','\u0394', '_', '\u03a6', '\u0393',
    '\u039b', '\u03a9', '\u03a0','\u03a8', '\u03a3', '\u0398', '\u039e','\x1b', 'Æ', 'æ',
    'ß', 'É', ' ', '!', '"', '#', '¤', '%', '&', '\'',
    '(', ')', '*', '+', ',', '-', '.', '/', '0', '1',
    '2', '3', '4', '5', '6', '7', '8', '9', ':', ';',
    '<', '=', '>', '?', '¡', 'A', 'B', 'C', 'D', 'E',
    'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O',
    'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y',
    'Z', 'Ä', 'Ö', 'Ñ', 'Ü', '§', '¿', 'a', 'b', 'c',
    'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
    'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w',
    'x', 'y', 'z', 'ä', 'ö', 'ñ', 'ü', 'à'];

function boundaries7bit(text) {
    if (text.length > 160) {
        return {max: 153, cnt: Math.ceil(text.length/153)};
    }
    return {max: 160, cnt: 1};
}

function encodeUserDataAs7bit(text, udh) {
    var ud = udh || '';
    
    var i = 0;
    var shift = 0;
    if (ud.length) {
        shift = (ud.length+1);
        if (shift === 7) { shift = 0; }
        ud += toHexByte(text.charCodeAt(i)<<(7-shift));
        i++; shift++;
        if (shift === 7) { shift = 0; }
    }
    
    while (i < text.length) {
        var sept_cur = sevenBitAlpha.indexOf(text.charAt(i));
        var sept_nex = 0;
        if ((i+1) < text.length) {
            sept_nex = sevenBitAlpha.indexOf(text.charAt(i+1));
        }
        
        var byte = (sept_cur >> shift) | (sept_nex << (7-shift));
        ud += toHexByte(byte);
        
        /* we already inserted the whole sept_nex */
        if (shift === 6) {
            i++;
        }
        
        shift++;
        if (shift === 7) { shift = 0; }
        i++;
    }
    var len = text.length;
    if (udh) {
        len += Math.ceil((udh.length*8) / 7) / 2;
    }
    return toHexByte(len) + ud;
}

function decodeUserDataAs7bit(offset, udl, state) {
    var text = '';
    
    var bitInStash = offset;
    var stash = 0;
    var idx = 0;
    
    if (offset) {
        stash = parseByte(state) >> (7-offset);
        bitInStash = 8 - (7-offset);
        idx = offset + 1;
    }
    while (idx < udl) {
        if (bitInStash < 7) {
            var newb = parseByte(state);
            stash |= newb << bitInStash;
            bitInStash += 8;
        }
        var septet = stash&0x7F;
        text += sevenBitAlpha[septet];
        stash = stash >> 7;
        bitInStash -= 7;
        idx++;
    }
    
    return text;
}

module.exports = {
    alpha: sevenBitAlpha,
    boundaries: boundaries7bit,
    dcs: '00',
    decode: decodeUserDataAs7bit,
    encode: encodeUserDataAs7bit
};