const { getFieldDefinition } = require('./spec');
const { asciiToBcd } = require('./bcd');

function normalizeNumeric(value, length) {
  if (!/^\d*$/.test(value)) {
    throw new Error(`Value "${value}" must be numeric`);
  }
  return value.padStart(length, '0').slice(-length);
}

function ensureRange(fieldNumber, lengthValue, definition, unit = 'characters') {
  if (!definition.lengthRange) return;
  const { min = 0, max = Infinity } = definition.lengthRange;
  if (lengthValue < min || lengthValue > max) {
    throw new Error(
      `Field ${fieldNumber} ${unit} length ${lengthValue} out of bounds (${min}..${max})`,
    );
  }
}

function coerceBinary(value) {
  if (Buffer.isBuffer(value)) {
    return Buffer.from(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length % 2 !== 0) {
      throw new Error('Binary field hex strings must have an even length');
    }
    return Buffer.from(trimmed, 'hex');
  }
  throw new Error('Binary fields expect Buffer or hex string values');
}

function encodeFixedField(number, rawValue, definition) {
  const value = `${rawValue ?? ''}`;

  if (definition.encoding === 'bcd') {
    const normalized = normalizeNumeric(value, definition.length);
    return asciiToBcd(normalized, definition.length);
  }

  if (definition.encoding === 'ascii') {
    if (value.length !== definition.length) {
      throw new Error(`Field ${number} length must be ${definition.length}`);
    }
    return Buffer.from(value, 'ascii');
  }

  if (definition.encoding === 'binary') {
    const buffer = coerceBinary(rawValue);
    if (buffer.length !== definition.length) {
      throw new Error(`Field ${number} binary length must be ${definition.length} bytes`);
    }
    return buffer;
  }

  throw new Error(`Unsupported encoding ${definition.encoding} for field ${number}`);
}

function encodeVariableField(number, rawValue, definition, numericEncoding = 'ascii') {
  const value = rawValue ?? '';
  let dataBuffer;
  let lengthValue;

  if (definition.encoding === 'bcd') {
    const stringValue = `${value}`;
    if (!/^\d*$/.test(stringValue)) {
      throw new Error(`Field ${number} expects numeric data`);
    }
    lengthValue = stringValue.length;
    ensureRange(number, lengthValue, definition, 'digits');
    dataBuffer = asciiToBcd(stringValue, lengthValue);
  } else if (definition.encoding === 'ascii') {
    const stringValue = `${value}`;
    lengthValue = stringValue.length;
    ensureRange(number, lengthValue, definition);
    dataBuffer = Buffer.from(stringValue, 'ascii');
  } else if (definition.encoding === 'binary') {
    dataBuffer = coerceBinary(value);
    lengthValue = dataBuffer.length;
    ensureRange(number, lengthValue, definition, 'bytes');
  } else {
    throw new Error(`Unsupported encoding ${definition.encoding} for field ${number}`);
  }

  const lengthDigits = definition.format === 'llvar' ? 2 : 3;
  let lengthBuffer;

  // Use BCD for length indicators when numericEncoding is 'bcd'
  // This matches the encoder's behavior where length indicators use numericEncoding
  if (numericEncoding === 'bcd') {
    const baseLengthString = lengthValue.toString().padStart(lengthDigits, '0');
    const paddedLengthString = baseLengthString.padStart(
      lengthDigits + (lengthDigits % 2),
      '0',
    );
    lengthBuffer = asciiToBcd(paddedLengthString, paddedLengthString.length);
  } else if (definition.encoding === 'bcd') {
    const baseLengthString = lengthValue.toString().padStart(lengthDigits, '0');
    const paddedLengthString = baseLengthString.padStart(
      lengthDigits + (lengthDigits % 2),
      '0',
    );
    lengthBuffer = asciiToBcd(paddedLengthString, paddedLengthString.length);
  } else {
    const lengthString = lengthValue.toString().padStart(lengthDigits, '0');
    lengthBuffer = Buffer.from(lengthString, 'ascii');
  }

  return Buffer.concat([lengthBuffer, dataBuffer]);
}

function buildBitmap(fieldNumbers) {
  if (fieldNumbers.some((field) => field === 1)) {
    throw new Error('Field 1 is reserved for the secondary bitmap indicator');
  }

  const highest = fieldNumbers.length ? fieldNumbers[fieldNumbers.length - 1] : 0;
  const bitmapLength = highest > 64 ? 16 : 8;
  const bitmap = Buffer.alloc(bitmapLength);

  if (bitmapLength === 16) {
    bitmap[0] |= 0x80;
  }

  fieldNumbers.forEach((field) => {
    const index = field - 1;
    const byteIndex = Math.floor(index / 8);
    const bitOffset = index % 8;
    bitmap[byteIndex] |= 1 << (7 - bitOffset);
  });

  return bitmap;
}

function buildIso8583Message({ mti, fields, numericEncoding = 'bcd' }) {
  if (!mti || mti.length !== 4) {
    throw new Error('MTI must be a 4-character string');
  }

  const fieldNumbers = Object.keys(fields)
    .map(Number)
    .sort((a, b) => a - b);

  const bitmap = buildBitmap(fieldNumbers);

  const fieldBuffers = fieldNumbers.map((fieldNumber) => {
    const definition = getFieldDefinition(fieldNumber);
    if (!definition) {
      throw new Error(`Field ${fieldNumber} has no encoder definition`);
    }

    const value = fields[fieldNumber];
    if (definition.format === 'fixed') {
      return encodeFixedField(fieldNumber, value, definition);
    }
    if (definition.format === 'llvar' || definition.format === 'lllvar') {
      return encodeVariableField(fieldNumber, value, definition, numericEncoding);
    }

    throw new Error(`Field ${fieldNumber} format ${definition.format} not supported in builder`);
  });

  return Buffer.concat([Buffer.from(mti, 'ascii'), bitmap, ...fieldBuffers]);
}

module.exports = {
  buildIso8583Message,
};

