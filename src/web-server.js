const express = require('express');
const net = require('net');
const path = require('path');
const { buildIso8583Message } = require('./iso8583/builder');

const app = express();
const PORT = process.env.WEB_PORT || 3000;
const NPSB_HOST = process.env.NPSB_HOST || 'localhost';
const NPSB_PORT = parseInt(process.env.NPSB_PORT || '5000', 10);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Helper functions
function pad(value, length) {
  return value.toString().padStart(length, '0');
}

function currentDateTime() {
  const now = new Date();
  const utc = new Date(now.getTime() + now.getTimezoneOffset() * 60000);
  const mm = pad(utc.getUTCMonth() + 1, 2);
  const dd = pad(utc.getUTCDate(), 2);
  const hh = pad(utc.getUTCHours(), 2);
  const min = pad(utc.getUTCMinutes(), 2);
  const ss = pad(utc.getUTCSeconds(), 2);
  return {
    de7: `${mm}${dd}${hh}${min}${ss}`,
    de12: `${hh}${min}${ss}`,
    de13: `${mm}${dd}`,
  };
}

function buildField47(counterpartAccount) {
  if (!counterpartAccount) return undefined;
  const len = pad(counterpartAccount.length, 2);
  return `9270${len}${counterpartAccount}`;
}

function buildField48(counterpartAccount) {
  if (!counterpartAccount) return undefined;
  const len = pad(counterpartAccount.length, 2);
  return `8480${len}${counterpartAccount}`;
}

// API endpoint to send transaction
app.post('/api/send-transaction', async (req, res) => {
  try {
    const {
      host = NPSB_HOST,
      port = NPSB_PORT,
      pan,
      procCode,
      amount,
      settlementAmount,
      billingAmount,
      stan,
      rrn,
      transmissionDateTime,
      localTime,
      localDate,
      merchantType,
      entryMode,
      acquirerId,
      terminalId,
      cardAcceptorId,
      cardAcceptorName,
      counterpart,
      additionalInfo,
      currency,
      field47,
      field48,
    } = req.body;

    const defaults = currentDateTime();
    const finalAmount = amount || '000015600000';
    const finalSettlementAmount = settlementAmount || finalAmount;
    const finalBillingAmount = billingAmount || finalAmount;
    const finalStan = stan || pad(Math.floor(Math.random() * 1_000_000), 6);
    const finalRrn =
      rrn ||
      `${defaults.de7.slice(0, 4)}${defaults.de12}${finalStan}`.slice(0, 12).padEnd(12, '0');
    const finalCounterpart = counterpart || '2001070006085';

    // Helper function to ensure fixed-length fields are correct
    const ensureFixedLength = (value, length, padChar = ' ', padStart = false) => {
      if (!value) return padChar.repeat(length);
      const str = String(value);
      if (str.length === length) return str;
      if (str.length > length) return str.substring(0, length);
      return padStart ? str.padStart(length, padChar) : str.padEnd(length, padChar);
    };

    const fields = {
      2: pan || '0000950000000000',
      3: (procCode || '280000').padStart(6, '0').substring(0, 6),
      4: finalAmount.padStart(12, '0').substring(0, 12),
      5: finalSettlementAmount.padStart(12, '0').substring(0, 12),
      6: finalBillingAmount.padStart(12, '0').substring(0, 12),
      7: (transmissionDateTime || defaults.de7).padStart(10, '0').substring(0, 10),
      11: finalStan.padStart(6, '0').substring(0, 6),
      12: (localTime || defaults.de12).padStart(6, '0').substring(0, 6),
      13: (localDate || defaults.de13).padStart(4, '0').substring(0, 4),
      18: (merchantType || '6013').padStart(4, '0').substring(0, 4),
      22: (entryMode || '012').padStart(3, '0').substring(0, 3),
      32: acquirerId || '000015',
      37: ensureFixedLength(finalRrn, 12, '0', true),
      41: ensureFixedLength(terminalId || '90200151', 8, ' '),
      42: ensureFixedLength(cardAcceptorId || 'AL-ARAFAH BANK  ', 15, ' '),
      43: ensureFixedLength(cardAcceptorName || 'aibl i-banking           DHAKA        BD', 40, ' '),
      47: field47 || buildField47(finalCounterpart),
      48: field48 || buildField48(finalCounterpart),
      49: (currency || '050').padStart(3, '0').substring(0, 3),
      103: finalCounterpart,
      112: additionalInfo || '    TWHAT_TRX  TIBFTA2A',
    };

    // Remove undefined fields
    Object.keys(fields).forEach((key) => {
      if (fields[key] == null) delete fields[key];
    });

    // Build ISO8583 message
    const message = buildIso8583Message({ mti: '0100', fields });

    // Create payload with header
    const header = Buffer.alloc(2);
    header.writeUInt16BE(message.length);
    const payload = Buffer.concat([header, message]);

    // Send via TCP socket
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host, port: parseInt(port, 10) }, () => {
        socket.write(payload);
      });

      let responseData = Buffer.alloc(0);
      let responseTimeout;

      socket.on('data', (chunk) => {
        responseData = Buffer.concat([responseData, chunk]);
        clearTimeout(responseTimeout);
        responseTimeout = setTimeout(() => {
          socket.end();
        }, 100);
      });

      socket.on('close', () => {
        clearTimeout(responseTimeout);
        if (responseData.length > 0) {
          resolve({
            success: true,
            requestLength: payload.length,
            responseLength: responseData.length,
            responseHex: responseData.toString('hex'),
            messageLength: message.length,
            fields: fields,
          });
        } else {
          reject(new Error('No response received from server'));
        }
      });

      socket.on('error', (error) => {
        clearTimeout(responseTimeout);
        reject(error);
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        if (!socket.destroyed) {
          socket.destroy();
          reject(new Error('Connection timeout'));
        }
      }, 5000);
    })
      .then((result) => {
        res.json(result);
      })
      .catch((error) => {
        res.status(500).json({
          success: false,
          error: error.message,
        });
      });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`Web application running on http://localhost:${PORT}`);
  console.log(`NPSB Server: ${NPSB_HOST}:${NPSB_PORT}`);
});

