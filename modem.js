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
    Pdu = require('./pdu.js'),
    SerialPort = serialport.SerialPort;

var terminalMessage = [
    'ERROR',
    'OK'
];

function HayesCommand(cmd, payload, resolve, reject) {
    this.cmd = cmd;
    this.payload = payload;
    this.payload_sent = false;
    this.resolve = resolve;
    this.reject = reject;
}

function Modem(opts) {
    var m_serialPort = new SerialPort(opts.port, {
            baudrate: opts.baudrate || 115200,
            openImmediately: false
        }, false),
        m_serialopen = Bluebird.promisify(m_serialPort.open, m_serialPort),
        m_serialflush = Bluebird.promisify(m_serialPort.flush, m_serialPort),
        m_serialwrite = Bluebird.promisify(m_serialPort.write, m_serialPort),
        m_logger = intel.getLogger(opts.port);

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
        var that = this;
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
        return this.sendCommand('AT+CMGF=' + (enText?'1':'0')).timeout(500);
    };
    this.sendSms = function sendSms(msg) {
        var that = this;
        var pdus = Pdu.encode(msg);
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
        if (m_rxBuffer[m_rxPtr-1] !== 10 && str.indexOf('>') === -1) {
            return;
        }

        if (str.indexOf('>') !== -1) {
            if (m_cmdQueue.length > 0) {
                var cmd = m_cmdQueue[0];
                if (!cmd.payload_sent) {
                    cmd.payload_sent = true;
                    writeData(cmd.payload + String.fromCharCode(26));
                    return;
                }
            } else {
                m_logger.info('no payload, cancelling');
                writeData(String.fromCharCode(24));
            }
        }

        /* split lines */
        var lines = str.split('\r\n');
        lines = _.compact(lines);
        if (lines.length === 0) { return; }

        /* filter out unsolicited message */
        var i = 0;
        while (i < lines.length) {
            var line = lines[i];
            if (line[0] === '+') {
                if (line.indexOf('ERROR') !== -1) {
                    lines.splice(i, 1);
                    complete(line, null);
                    continue;
                }
            }
            i++;
        }

        var b = new Buffer(lines.join('\n'));
        b.copy(m_rxBuffer);
        m_rxPtr = b.length;

        /* check for termination message */
        if (m_cmdQueue.length > 0) {
            var lastLine = lines[lines.length - 1];
            var finished = _.indexOf(terminalMessage, lastLine) !== -1;
            if (finished) {
                var resp = b.toString();
                m_rxPtr = 0;
                complete(null, resp);
            }
        }
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

//Modem.prototype.
module.exports = Modem;
