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
    PDU = require('pdu'),
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

    m_serialPort.on('data', onData.bind(this));
    m_serialPort.on('error', onError.bind(this));

    this.connect = function connect() {
        var that = this;
        return m_serialopen().then(function () {
            m_logger.info('connected');
            return Bluebird.all([
                that.setEchoMode(false),
                that.setTextMode(false),
                that.sendCommand('AT+CNMI=2,2,2,1,0'),
                that.sendCommand('AT+CMEE=2')
            ]);
        });
    };

    this.sendCommand = function sendCommand(cmd, payload) {
        return new Bluebird(function (resolve, reject) {
            m_cmdQueue.push(new HayesCommand(cmd, payload, resolve, reject));
            sendNext();
        });
    };

    this.setEchoMode = function setEchoMode(enEcho) {
        return this.sendCommand('ATE' + (enEcho?'1':'0'));
    };
    this.setTextMode = function setTextMode(enText) {
        return this.sendCommand('AT+CMGF=' + (enText?'1':'0'));
    };
    this.sendSms = function sendSms(msg) {
        var that = this;
        var pdus = PDU.generate(msg);
        var prev = Bluebird.resolve();
        _.forEach(pdus, function (pdu) {
            prev = prev.then(function () {
                return that.sendCommand('AT+CMGS=' + (pdu.length/2 - 1), pdu);
            });
        });
        return prev;
    };

    function sendNext() {
        if (!m_busy && m_cmdQueue.length > 0) {
            m_busy = true;
            writeData(m_cmdQueue[0].cmd + '\r');
        }
    }

    function writeData(data) {
        m_logger.debug('%s ---->', m_serialPort.path, data.toString());
        return m_serialwrite(data);
    }

    function onData(data) {
        var cmd;

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
                cmd = m_cmdQueue[0];
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
        for (var i = 0; i < lines.length; i++) {

        }

        var b = new Buffer(lines.join('\n'));
        b.copy(m_rxBuffer);
        m_rxPtr = b.length;

        /* check for termination message */
        if (m_cmdQueue.length > 0) {
            cmd = m_cmdQueue[0];
            var lastLine = lines[lines.length - 1];
            var finished = _.indexOf(terminalMessage, lastLine) !== -1 ||
                           b.toString().indexOf(cmd.expect) !== -1;
            if (finished) {
                /* pop cmd from the queue */
                m_cmdQueue.splice(0, 1);
                var resp = b.toString();
                m_logger.debug(cmd.cmd + ' resolved: ' + resp);
                cmd.resolve(resp);

                m_rxPtr = 0;
                m_busy = false;
                sendNext();
            }
        }
    }

    function onError(msg) {
        m_logger.error(msg);
    }
}

//Modem.prototype.
module.exports = Modem;
