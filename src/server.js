const net = require('net');
const fs = require('fs');
const { ISO8583Encoder } = require('./iso8583/encoder');

const PORT = parseInt(process.env.NPSB_PORT ?? '5000', 10);
const HOST = process.env.NPSB_HOST ?? '0.0.0.0';
const HEADER_LENGTH = 2;

const ACQUIRER_HOSTS = parseHostList(process.env.NPSB_ACQUIRERS ?? '');
const ISSUER_HOSTS = parseHostList(process.env.NPSB_ISSUERS ?? '');

const acquirerConnections = new Map();
const issuerConnections = new Map();
const pendingByStan = new Map(); // STAN -> { socket, connectionId, createdAt }
const isoEncoder = new ISO8583Encoder('ascii', 'bcd');

const A2A_BITMAP = '';
const A2A_TRIGGER_FILE = 'send-a2a-request.trigger';

function packIsoMessage(mti, fields, bitmap = '', encoder = isoEncoder) {
  const packed = encoder.pack({ mti, bitmap, fields });
  return Buffer.from(packed, 'binary');
}

function unpackIsoMessage(buffer) {
  return isoEncoder.unpackFromBuffer(buffer);
}

function buildSampleA2AFields() {
  return {
    2: '0000950000000000',
    3: '280000',
    4: '000015600000',
    7: '1108114838',
    11: '094906',
    12: '174837',
    13: '1108',
    18: '6013',
    22: '012',
    32: '000015',
    37: '531211094906',
    41: '90200151',
    42: 'AL-ARAFAH BANK ',
    43: 'aibl i-banking           DHAKA        BD',
    47: '9270162000004444555560',
    48: '8480132001070006085',
    49: '050',
    103: '2001070006085',
    112: '    TWHAT_TRX  TIBFTA2A',
  };
}

function sendAccountToAccountRequest(connectionId) {
  let targetConnection;
  let targetId = connectionId;

  if (targetId) {
    targetConnection = acquirerConnections.get(targetId);
  } else {
    const firstEntry = acquirerConnections.entries().next();
    if (!firstEntry.done) {
      [targetId, targetConnection] = firstEntry.value;
    }
  }

  if (!targetConnection || !targetId) {
    console.warn('No connected acquirer available to send A2A request');
    return false;
  }

  try {
    const fields = buildSampleA2AFields();
    const messageBuffer = packIsoMessage('0100', fields, A2A_BITMAP);
    const payload = wrapWithHeader(messageBuffer);
    targetConnection.write(payload);

    console.log('Sent sample 0100 A2A request', {
      connectionId: targetId,
      length: payload.length,
      stan: fields[11],
      rrn: fields[37],
    });
    return true;
  } catch (error) {
    console.error('Failed to send sample 0100 A2A request', {
      connectionId: targetId,
      error: error.message,
    });
    return false;
  }
}

function parseHostList(value) {
  return new Set(
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

function normalizeAddress(address) {
  if (!address) return '';
  return address.replace(/^::ffff:/, '');
}

function getTransmissionDateTime() {
  const now = new Date();
  const pad = (value, size) => value.toString().padStart(size, '0');

  const month = pad(now.getUTCMonth() + 1, 2);
  const day = pad(now.getUTCDate(), 2);
  const hours = pad(now.getUTCHours(), 2);
  const minutes = pad(now.getUTCMinutes(), 2);
  const seconds = pad(now.getUTCSeconds(), 2);

  return `${month}${day}${hours}${minutes}${seconds}`;
}

function wrapWithHeader(buffer) {
  const header = Buffer.alloc(HEADER_LENGTH);
  header.writeUInt16BE(buffer.length);
  return Buffer.concat([header, buffer]);
}

function getFirstSocket(connectionMap) {
  const iterator = connectionMap.values();
  const result = iterator.next();
  return result.done ? null : result.value;
}

function determineRole(address) {
  const normalized = normalizeAddress(address);
  // Treat localhost as acquirer for testing
  if (normalized === '127.0.0.1' || normalized === '::1') return 'acquirer';
  if (ACQUIRER_HOSTS.has(normalized)) return 'acquirer';
  if (ISSUER_HOSTS.has(normalized)) return 'issuer';

  if (acquirerConnections.size === 0) return 'acquirer';
  if (issuerConnections.size === 0) return 'issuer';
  return 'unknown';
}

function buildNetworkResponse(request) {
  const infoCode = request.fields[70];
  const stan = request.fields[11] ?? '000000';
  const transmissionDateTime = request.fields[7] ?? getTransmissionDateTime();

  if (!infoCode) {
    return packIsoMessage('0810', {
      7: transmissionDateTime,
      11: stan,
      39: '96',
      70: '000',
    });
  }

  const normalizedInfoCode = typeof infoCode === 'string' ? infoCode.trim() : infoCode;
  console.log(
    `Network management request MTI ${request.mti}, DE70 raw=[${infoCode}] normalized=[${normalizedInfoCode}]`,
  );

  if (normalizedInfoCode === '162') {
    return packIsoMessage('0810', {
      7: transmissionDateTime,
      11: stan,
      39: '00',
      70: normalizedInfoCode,
    });
  }

  const supported = new Set(['001', '002', '301']);
  if (!supported.has(normalizedInfoCode)) {
    return packIsoMessage('0810', {
      7: transmissionDateTime,
      11: stan,
      39: '96',
      70: normalizedInfoCode ?? '000',
    });
  }

  return packIsoMessage('0810', {
    7: transmissionDateTime,
    11: stan,
    39: '00',
    70: normalizedInfoCode,
  });
}

function sendBackToAcquirer(stan, rawBuffer) {
  const pending = pendingByStan.get(stan);
  if (!pending) {
    console.warn(`No pending acquirer request for STAN ${stan}`);
    return;
  }

  try {
    pending.socket.write(wrapWithHeader(rawBuffer));
    console.log(`Forwarded issuer response for STAN ${stan} to ${pending.connectionId}`);
  } catch (error) {
    console.error(`Failed to forward response for STAN ${stan}`, error);
  } finally {
    pendingByStan.delete(stan);
  }
}

function buildFailureResponse(original, responseCode = '96') {
  return packIsoMessage('0110', {
    7: getTransmissionDateTime(),
    11: original?.fields?.[11] ?? '000000',
    39: responseCode,
  });
}

function cleanupPendingForSocket(socket) {
  for (const [stan, entry] of pendingByStan.entries()) {
    if (entry.socket === socket) {
      pendingByStan.delete(stan);
    }
  }
}

function handleAcquirerMessage(connectionId, socket, message, rawBuffer) {
  if (message.mti.startsWith('08')) {
    const responseBuffer = buildNetworkResponse(message);
    socket.write(wrapWithHeader(responseBuffer));
    console.log(
      `Handled network management ${message.fields[70]} for acquirer ${connectionId}`,
    );
    return;
  }

  if (message.mti !== '0100') {
    console.warn(`Unsupported MTI ${message.mti} from acquirer ${connectionId}`);
    return;
  }

  const stan = message.fields[11];
  if (!stan) {
    console.warn(`Acquirer message missing STAN (DE11) from ${connectionId}`);
    const failure = buildFailureResponse(message);
    socket.write(wrapWithHeader(failure));
    return;
  }

  const issuerSocket = getFirstSocket(issuerConnections);
  if (!issuerSocket) {
    console.warn('No issuer connection available to forward 0100 request');
    const failure = buildFailureResponse(message, '91'); // issuer unavailable
    socket.write(wrapWithHeader(failure));
    return;
  }

  pendingByStan.set(stan, { socket, connectionId, createdAt: Date.now() });
  issuerSocket.write(wrapWithHeader(rawBuffer));
  console.log(
    `Forwarded 0100 request STAN ${stan} to issuer from acquirer ${connectionId}`,
  );
}

function handleIssuerMessage(connectionId, socket, message, rawBuffer) {
  if (message.mti.startsWith('08')) {
    const responseBuffer = buildNetworkResponse(message);
    socket.write(wrapWithHeader(responseBuffer));
    console.log(
      `Handled network management ${message.fields[70]} for issuer ${connectionId}`,
    );
    return;
  }

  if (!['0110', '0210', '0410'].includes(message.mti)) {
    console.warn(`Unsupported MTI ${message.mti} from issuer ${connectionId}`);
    return;
  }

  const stan = message.fields[11];
  if (!stan) {
    console.warn(`Issuer response missing STAN (DE11) from ${connectionId}`);
    return;
  }

  sendBackToAcquirer(stan, rawBuffer);
}

function startServer() {
  const server = net.createServer((socket) => {
    const connectionId = `${normalizeAddress(socket.remoteAddress)}:${socket.remotePort}`;
    const role = determineRole(socket.remoteAddress);

    if (role === 'acquirer') {
      acquirerConnections.set(connectionId, socket);
    } else if (role === 'issuer') {
      issuerConnections.set(connectionId, socket);
    }

    console.log(`Client connected (${role})`, connectionId);

    let buffer = Buffer.alloc(0);

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      while (buffer.length >= HEADER_LENGTH) {
        const messageLength = buffer.readUInt16BE(0);
        if (buffer.length < HEADER_LENGTH + messageLength) {
          break;
        }

        const payload = buffer.slice(HEADER_LENGTH, HEADER_LENGTH + messageLength);
        buffer = buffer.slice(HEADER_LENGTH + messageLength);

        let request;
        try {
          request = unpackIsoMessage(payload);
        } catch (error) {
          console.error('Failed to parse ISO8583 message:', error);
          continue;
        }

        try {
          if (role === 'acquirer') {
            handleAcquirerMessage(connectionId, socket, request, payload);
          } else if (role === 'issuer') {
            handleIssuerMessage(connectionId, socket, request, payload);
          } else {
            console.warn(`Unknown role for connection ${connectionId}, ignoring message`);
          }
        } catch (error) {
          console.error(`Error handling message for ${connectionId}`, error);
        }
      }
    });

    socket.on('close', () => {
      console.log('Client disconnected', connectionId);
      cleanupPendingForSocket(socket);
      acquirerConnections.delete(connectionId);
      issuerConnections.delete(connectionId);
    });

    socket.on('error', (error) => {
      console.error('Socket error', connectionId, error);
    });
  });

  server.listen(PORT, HOST, () => {
    console.log(`NPSB ISO8583 switch listening on ${HOST}:${PORT}`);
    console.log(`Configured acquirer hosts: ${Array.from(ACQUIRER_HOSTS).join(', ') || '(any)'}`);
    console.log(`Configured issuer hosts: ${Array.from(ISSUER_HOSTS).join(', ') || '(any)'}`);
  });

  server.on('error', (error) => {
    console.error('Server error', error);
  });

  return server;
}

if (require.main === module) {
  const serverInstance = startServer();
  global.npsbSwitch = { sendAccountToAccountRequest };

  if (fs.existsSync(A2A_TRIGGER_FILE)) {
    fs.unlinkSync(A2A_TRIGGER_FILE);
  }

  const triggerInterval = setInterval(() => {
    try {
      if (fs.existsSync(A2A_TRIGGER_FILE)) {
        const success = sendAccountToAccountRequest();
        if (success) {
          console.log('✓ Sent 0100 A2A request to connected acquirer');
        } else {
          console.log('✗ Failed to send 0100 A2A request - no connected acquirer');
        }
        fs.unlinkSync(A2A_TRIGGER_FILE);
      }
    } catch (error) {
      console.error('Error processing A2A trigger file', error);
    }
  }, 1000);

  const shutdown = () => {
    clearInterval(triggerInterval);
    serverInstance.close(() => {
      console.log('NPSB ISO8583 switch stopped');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = {
  startServer,
  sendAccountToAccountRequest,
};

