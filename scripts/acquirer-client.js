#!/usr/bin/env node

const net = require('net');
const process = require('process');
const { buildIso8583Message } = require('../src/iso8583/builder');
const { parseIso8583Message } = require('../src/iso8583/parser');

function pad(value, length) {
  return `${value}`.padStart(length, '0');
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next == null || next.startsWith('--')) {
      args[key.slice(2)] = true;
    } else {
      args[key.slice(2)] = next;
      i += 1;
    }
  }
  return args;
}

function isoDateParts() {
  const now = new Date();
  const utc = new Date(now.getTime() + now.getTimezoneOffset() * 60000);
  const mm = pad(utc.getUTCMonth() + 1, 2);
  const dd = pad(utc.getUTCDate(), 2);
  const hh = pad(utc.getUTCHours(), 2);
  const mi = pad(utc.getUTCMinutes(), 2);
  const ss = pad(utc.getUTCSeconds(), 2);
  return {
    de7: `${mm}${dd}${hh}${mi}${ss}`,
    de12: `${hh}${mi}${ss}`,
    de13: `${mm}${dd}`,
  };
}

function build0100(fieldsOverride = {}) {
  const nowParts = isoDateParts();
  const stan = fieldsOverride[11] ?? pad(Math.floor(Math.random() * 1_000_000), 6);
  const rrn =
    fieldsOverride[37] ??
    `${nowParts.de13}${nowParts.de12}${pad(Math.floor(Math.random() * 100), 2)}`.slice(0, 12);

  const counterpart = fieldsOverride[103] ?? '2001070006085';
  const de48 =
    fieldsOverride[48] ?? `8480${pad(counterpart.length, 2)}${counterpart}`;

  const fields = {
    2: '0000950000000000',
    3: '280000',
    4: '000015600000',
    5: '000015600000',
    6: '000015600000',
    7: nowParts.de7,
    11: stan,
    12: nowParts.de12,
    13: nowParts.de13,
    18: '6013',
    22: '012',
    32: '000015',
    37: rrn,
    41: '90200151',
    42: 'AL-ARAFAH BANK ',
    43: 'aibl i-banking           DHAKA        BD',
    47: '9270132001070006085',
    48: de48,
    49: '050',
    103: counterpart,
    112: '    TWHAT_TRX  TIBFTA2A',
    ...fieldsOverride,
  };

  return buildIso8583Message({ mti: '0100', fields });
}

(async function main() {
  const args = parseArgs(process.argv.slice(2));
  const host = args.host ?? '127.0.0.1';
  const port = Number.parseInt(args.port ?? '5000', 10);

  let message;
  try {
    message = build0100();
  } catch (error) {
    console.error('Failed to build ISO8583 message:', error);
    process.exit(1);
  }

  const header = Buffer.alloc(2);
  header.writeUInt16BE(message.length);
  const payload = Buffer.concat([header, message]);

  console.log(`Connecting to switch at ${host}:${port}`);
  const socket = net.createConnection({ host, port }, () => {
    console.log(`Sending 0100 request (${payload.length} bytes)`);
    socket.write(payload);
  });

  socket.on('data', (chunk) => {
    console.log(`Received response (${chunk.length} bytes): ${chunk.toString('hex')}`);
    try {
      const withoutHeader = chunk.slice(2);
      const parsed = parseIso8583Message(withoutHeader);
      console.log('Parsed response:', parsed);
    } catch (error) {
      console.warn('Failed to parse response:', error.message);
    }
    socket.end();
  });

  socket.on('error', (error) => {
    console.error('Socket error:', error.message);
    process.exitCode = 1;
  });

  socket.on('close', () => {
    console.log('Connection closed');
  });
})();

