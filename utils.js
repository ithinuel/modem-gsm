'use strict';

function toHexByte(text) {
    return ('0' + text.toString(16)).slice(-2);
}

function readByte(state) {
    var val = state.pdu.slice(state.cursor, state.cursor+2);
    state.cursor += 2;
    return val;
}

function parseByte(state) {
    return parseInt(readByte(state), 16);
}

module.exports = {
    toHexByte: toHexByte,
    readByte: readByte,
    parseByte: parseByte
};