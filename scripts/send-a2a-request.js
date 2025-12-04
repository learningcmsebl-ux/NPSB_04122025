#!/usr/bin/env node

/**
 * CLI helper to send an ISO8583 account-to-account credit message to an NPSB client.
 * Defaults mirror the active test data used during development but can be overridden with flags.
 *
 * Example:
 *   node scripts/send-a2a-request.js --host 192.168.225.101 --port 5000 \
 *     --pan 0000950000000000 --amount 000015600000 --counterpart 2001070006085
 */

const net = require('net');
const { buildIso8583Message } = require('../src/iso8583/builder');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const value = argv[i + 1];
    if (value == null || value.startsWith('--')) {
      args[key.slice(2)] = true;
      i -= 1;
    } else {
      args[key.slice(2)] = value;
      i += 0;
    }
  }
  return args;
}

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

(async function main() {
  const argv = parseArgs(process.argv.slice(2));

  const defaults = currentDateTime();
  const host = argv.host ?? '192.168.225.101';
  const port = Number.parseInt(argv.port ?? '5000', 10);

  const pan = argv.pan ?? '0000950000000000';
  const processingCode = argv.procCode ?? '280000';
  const amount = argv.amount ?? '000015600000';
  const settlementAmount = argv.settlementAmount ?? amount;
  const billingAmount = argv.billingAmount ?? amount;
  const stan = argv.stan ?? pad(Math.floor(Math.random() * 1_000_000), 6);
  const rrn =
    argv.rrn ??
    `${defaults.de7.slice(0, 4)}${defaults.de12}${stan}`.slice(0, 12).padEnd(12, '0');

  const merchantType = argv.merchantType ?? '6013';
  const entryMode = argv.entryMode ?? '012';
  const acquirerId = argv.acquirerId ?? '000015';
  const terminalId = argv.terminalId ?? '90200151';
  const cardAcceptorId = argv.cardAcceptorId ?? 'AL-ARAFAH BANK ';
  const cardAcceptorName =
    argv.cardAcceptorName ?? 'aibl i-banking           DHAKA        BD';

  const counterpart = argv.counterpart ?? '2001070006085';
  const additionalInfo = argv.additionalInfo ?? '    TWHAT_TRX  TIBFTA2A';
  const currencyCode = argv.currency ?? '050';

  const fields = {
    2: pan,
    3: processingCode,
    4: amount,
    5: settlementAmount,
    6: billingAmount,
    7: argv.transmissionDateTime ?? defaults.de7,
    11: stan,
    12: argv.localTime ?? defaults.de12,
    13: argv.localDate ?? defaults.de13,
    18: merchantType,
    22: entryMode,
    32: acquirerId,
    37: rrn,
    41: terminalId,
    42: cardAcceptorId,
    43: cardAcceptorName,
    47: argv.field47 ?? buildField47(counterpart),
    48: argv.field48 ?? buildField48(counterpart),
    49: currencyCode,
    103: counterpart,
    112: additionalInfo,
  };

  // Remove undefined populated fields (optional ones not provided)
  Object.keys(fields).forEach((key) => {
    if (fields[key] == null) delete fields[key];
  });

  let message;
  try {
    message = buildIso8583Message({ mti: '0100', fields });
  } catch (error) {
    console.error('Failed to build ISO8583 message:', error.message);
    process.exit(1);
  }

  const header = Buffer.alloc(2);
  header.writeUInt16BE(message.length);
  const payload = Buffer.concat([header, message]);

  console.log(`Connecting to ${host}:${port}`);
  const socket = net.createConnection({ host, port }, () => {
    console.log(`Sending ${payload.length} bytes`);
    socket.write(payload);
  });

  socket.on('data', (chunk) => {
    console.log(`Response (${chunk.length} bytes): ${chunk.toString('hex')}`);
  });

  socket.on('error', (error) => {
    console.error('Socket error:', error.message);
    process.exitCode = 1;
  });

  socket.on('close', () => {
    console.log('Connection closed');
  });
})();

