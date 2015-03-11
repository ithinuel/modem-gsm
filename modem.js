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

var serialport = require('serialport'),
    Bluebird = require('bluebird'),
    intel = require('intel'),
    _ = require('lodash'),
    util = require('util'),
    EventEmitter = require('events').EventEmitter,
    Pdu = require('./pdu'),
    SerialPort = serialport.SerialPort;

var networkStat = {
    '0': 'Not registered',
    '1': 'Registered, home network',
    '2': 'Not registered, searching...',
    '3': 'Registration denied',
    '4': 'Unknown',
    '5': 'Registered, roaming'
};

function HayesCommand(cmd, payload, resolve, reject) {
    this.cmd = cmd;
    this.payload = payload;
    this.payload_sent = false;
    this.resolve = resolve;
    this.reject = reject;
}

function Modem(opts) {
    var that = this;
    var m_serialPort = new SerialPort(opts.port, {
            baudrate: opts.baudrate || 115200,
            openImmediately: false
        }, false),
        m_serialopen = Bluebird.promisify(m_serialPort.open, m_serialPort),
        m_serialflush = Bluebird.promisify(m_serialPort.flush, m_serialPort),
        m_serialwrite = Bluebird.promisify(m_serialPort.write, m_serialPort),
        m_logger = intel.getLogger(opts.port),
        m_pending = [];

    if (!opts.debug) {
        m_logger.setLevel(intel.INFO);
    }

    var m_cmdQueue = [],
        m_rxBuffer = new Buffer(1024),
        m_rxPtr = 0,
        m_busy = false;

    if (!opts.port) {
        throw new Error('Port is not defined');
    }

    m_serialPort.on('data', onData);
    m_serialPort.on('error', onError);

    this.connect = function connect() {
        return m_serialopen().then(function () {
            m_logger.info('connected');
            return Bluebird.all([
                that.setEchoMode(false),
                that.setTextMode(false),
                that.sendCommand('AT+CNMI=2,2,2,1,0').timeout(500),
                that.sendCommand('AT+CMEE=2').timeout(500)
            ]);
        });
    };
    
    this.disconnect = function disconnect() {
        return m_serialflush().then(function () {
            return new Bluebird(function (resolve) {
                m_serialPort.close(resolve);
            });
        }).timeout(2000).then(function () {
            m_logger.info('disconnected');
        });
    };

    this.sendCommand = function sendCommand(cmd, payload) {
        return new Bluebird(function (resolve, reject) {
            m_cmdQueue.push(new HayesCommand(cmd, payload, resolve, reject));
            sendNext();
        });
    };

    this.setEchoMode = function setEchoMode(enEcho) {
        return this.sendCommand('ATE' + (enEcho?'1':'0')).timeout(500);
    };
    this.setTextMode = function setTextMode(enText) {
        return this.sendCommand('AT+CMGF=' + (enText?'1':'0')).timeout(500).then(function () {
        });
    };
    this.getCSQ = function getCSQ() {
        return this.sendCommand('AT+CSQ').timeout(500).then(function (resp) {
            var m = resp.match(/\+CSQ: (\d+),(\d+)\nOK/);
            return {rssi: m[1], ber: m[2]};
        });
    };
    this.getCREG = function getCREG() {
        return this.sendCommand('AT+CREG?').timeout(500).then(function (resp) {
            var m = resp.match(/\+CREG: (\d+),(\d+)(,(\d+),(\d+))?\nOK/);
            var result = { state: networkStat[m[2]] };
            if (m[4] && m[5]) {
                result.lac = m[4];
                result.ci = m[5];
            }
            return result;
        });
    };
    
    this.sendSms = function sendSms(msg) {
        var that = this;
        var pdus = Pdu.encode(msg);
        m_logger.debug(JSON.stringify(pdus));
        var last = Bluebird.resolve();
        _.forEach(pdus, function (pdu) {
            last = last.then(function () {
                return that.sendCommand('AT+CMGS=' + (pdu.length/2 - 1), pdu).timeout(60000);
            });
        });
        return last;
    };

    function sendNext() {
        if (!m_busy && m_cmdQueue.length > 0) {
            m_busy = true;
            writeData(m_cmdQueue[0].cmd + '\r');
        }
    }

    function writeData(data) {
        m_logger.debug('%s ---->', m_serialPort.path, JSON.stringify(data));
        return m_serialwrite(data);
    }

    function onData(data) {
        m_logger.debug('%s <----', m_serialPort.path, data.toString().trim());
        /* enqueue new data */
        if ((data.length + m_rxPtr) > m_rxBuffer.length) {
            m_logger.error('Buffer overflow');
            m_rxPtr = 0;
        }
        data.copy(m_rxBuffer, m_rxPtr);
        m_rxPtr += data.length;

        var str = m_rxBuffer.slice(0, m_rxPtr).toString();

        /* if last char is not lf and buffer does not contain > then nothing else to do */
        if (str.charAt(str.length - 1) !== '\n' && str.indexOf('>') === -1) {
            return;
        }

        /* split lines */
        var lines = str.split('\r\n');
        lines = _.compact(lines);
        if (lines.length === 0) { return; }
        
        /* filter out unsolicited message */
        var prev_len;        
        
        do {
            do {
                prev_len = lines.length;
                if (lines[0].match(/^\+(CMT|CDS): /)) {
                    if (lines.length > 1) {
                        var ls = lines.splice(0, 2);
                        
                        try {
                            var us = Pdu.decode(ls[1]);
                            m_logger.debug(us);
                            if (us.mti === 'SMS-STATUS-REPORT') {
                                that.emit('status-report', us);
                            } else if (us.mti === 'SMS-DELIVER') {
                                processStatusReport(us);
                            }
                        } catch (err) {
                            m_logger.error(err);
                        }
                    }
                }
            } while (lines.length && prev_len !== lines.length);
            do {
                prev_len = lines.length;
                _.forEach(lines, findResponse);
            } while (lines.length && lines.length !== prev_len);
        } while (lines.length && lines.length !== prev_len);
        
        var b = new Buffer(lines.join('\n'));
        b.copy(m_rxBuffer);
        m_rxPtr = b.length;
    }
    
    function processStatusReport(us) {
        var out = null;
        if (us.udh && us.udh.concatenatedMessage) {
            if (m_pending.length !== 0) {
                if (m_pending[0].udh.concatenatedMessage.ref !==
                    us.udh.concatenatedMessage.ref) {
                    m_pending.length = 0;
                    m_logger.info('cleaning buffer');
                }
            }
            m_pending.push(us);
            m_pending = _.sortBy(m_pending, function (m) {
                return m.udh.concatenatedMessage.idx;
            });
            m_logger.debug(m_pending);
            if (m_pending.length === us.udh.concatenatedMessage.max) {
                _.forEach(m_pending, function (m) {
                    if (out === null) {
                        out = m;
                    } else {
                        out.text += m.text;
                    }
                });
                delete out.udh;
            }
        } else {
            out = us;
        }
        if (out) {
            that.emit('deliver', out);
        }
    }
    
    function findResponse(line, i, lines) {
        var ls;

        if (line === '> ') {
            lines.splice(i, i+1);
            processCmdPayload();
        } else if (line === 'OK') {
            ls = lines.splice(0, i+1);
            complete(null, ls.join('\n'));
            return false;
        } else if (line === 'ERROR' || line.indexOf('+CMS ERROR: ') !== -1 || line.indexOf('+CME ERROR: ') !== -1) {
            ls = lines.splice(0, i+1);
            complete(ls.join('\n'));
            return false;
        }
    }
    
    function processCmdPayload() {
        if (m_cmdQueue.length > 0) {
            var cmd = m_cmdQueue[0];
            if (!cmd.payload_sent) {
                cmd.payload_sent = true;
                writeData(cmd.payload + String.fromCharCode(26));
                return;
            } else {
                m_logger.info('payload already sent, cancelling');
            }
        } else {
            m_logger.info('no payload, cancelling');
        }
        writeData(String.fromCharCode(24));
    }
    
    function complete(err, resp) {
        var cmd = m_cmdQueue[0];
        m_cmdQueue.splice(0, 1);
        m_busy = false;
        
        if (err) {
            m_logger.debug(' rejected: ' + err);
            cmd.reject(new Error(err));
        } else {
            m_logger.debug(cmd.cmd + ' resolved: ' + resp);
            cmd.resolve(resp);
        }
        sendNext();
    }

    function onError(msg) {
        m_logger.log(msg);
    }
}

util.inherits(Modem, EventEmitter);

module.exports = Modem;
