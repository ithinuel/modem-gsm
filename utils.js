'use strict';

function toHexByte(text) {
    return ('0' + text.toString(16)).slice(-2);
}

module.exports = {
    toHexByte: toHexByte
};