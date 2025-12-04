const { getFieldDefinition } = require('./spec');
const { bcdToAscii } = require('./bcd');

function extractBitmap(buffer, offset = 0) {
  if (buffer.length < offset + 8) {
    throw new Error('Buffer too short to contain primary bitmap');
  }

  const primary = buffer.slice(offset, offset + 8);
  offset += 8;

  const bits = [];
  for (let byteIndex = 0; byteIndex < primary.length; byteIndex += 1) {
    const currentByte = primary[byteIndex];
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = 1 << (7 - bit);
      bits.push((currentByte & mask) !== 0);
    }
  }

  let bitmapBytes = primary;
  if (bits[0]) {
    if (buffer.length < offset + 8) {
      throw new Error('Buffer too short to contain secondary bitmap');
    }
    const secondary = buffer.slice(offset, offset + 8);
    offset += 8;
    bitmapBytes = Buffer.concat([primary, secondary]);

    for (let byteIndex = 0; byteIndex < secondary.length; byteIndex += 1) {
      const currentByte = secondary[byteIndex];
      for (let bit = 0; bit < 8; bit += 1) {
        const mask = 1 << (7 - bit);
        bits.push((currentByte & mask) !== 0);
      }
    }
  }

  return { bitmapBytes, bits, offset };
}

function readFixedField(buffer, offset, definition) {
  if (definition.encoding === 'bcd') {
    const byteLength = Math.ceil(definition.length / 2);
    const fieldBytes = buffer.slice(offset, offset + byteLength);
    if (fieldBytes.length !== byteLength) {
      throw new Error(`Truncated BCD field ${definition.label}`);
    }

    const rawValue = bcdToAscii(fieldBytes, definition.length);
    return { value: rawValue, nextOffset: offset + byteLength };
  }

  if (definition.encoding === 'ascii') {
    const fieldBytes = buffer.slice(offset, offset + definition.length);
    if (fieldBytes.length !== definition.length) {
      throw new Error(`Truncated ASCII field ${definition.label}`);
    }
    return { value: fieldBytes.toString('ascii'), nextOffset: offset + definition.length };
  }

  if (definition.encoding === 'binary') {
    const fieldBytes = buffer.slice(offset, offset + definition.length);
    if (fieldBytes.length !== definition.length) {
      throw new Error(`Truncated binary field ${definition.label}`);
    }
    return { value: fieldBytes, nextOffset: offset + definition.length };
  }

  throw new Error(`Unsupported encoding ${definition.encoding} for field ${definition.label}`);
}

function readVariableField(buffer, offset, definition) {
  const lengthDigits = definition.format === 'llvar' ? 2 : 3;
  let lengthValue;
  let lengthOffset = offset;

  if (definition.encoding === 'bcd') {
    const lengthByteCount = definition.format === 'llvar' ? 1 : 2;
    const lengthSlice = buffer.slice(lengthOffset, lengthOffset + lengthByteCount);
    if (lengthSlice.length !== lengthByteCount) {
      throw new Error(`Truncated BCD length indicator for field ${definition.label}`);
    }
    lengthValue = parseInt(bcdToAscii(lengthSlice, lengthDigits), 10);
    if (Number.isNaN(lengthValue)) {
      throw new Error(`Invalid BCD length indicator for field ${definition.label}`);
    }
    lengthOffset += lengthByteCount;
  } else {
    const lengthSlice = buffer.slice(lengthOffset, lengthOffset + lengthDigits);
    if (lengthSlice.length !== lengthDigits) {
      throw new Error(`Truncated length indicator for field ${definition.label}`);
    }
    lengthValue = parseInt(lengthSlice.toString('ascii'), 10);
    if (Number.isNaN(lengthValue)) {
      throw new Error(`Invalid length indicator for field ${definition.label}`);
    }
    lengthOffset += lengthDigits;
  }

  offset = lengthOffset;

  if (definition.encoding === 'bcd') {
    const byteLength = Math.ceil(lengthValue / 2);
    const fieldBytes = buffer.slice(offset, offset + byteLength);
    if (fieldBytes.length !== byteLength) {
      throw new Error(`Truncated BCD variable field ${definition.label}`);
    }
    const value = bcdToAscii(fieldBytes, lengthValue);
    return { value, nextOffset: offset + byteLength };
  }

  if (definition.encoding === 'ascii') {
    const fieldBytes = buffer.slice(offset, offset + lengthValue);
    if (fieldBytes.length !== lengthValue) {
      throw new Error(`Truncated ASCII variable field ${definition.label}`);
    }
    return { value: fieldBytes.toString('ascii'), nextOffset: offset + lengthValue };
  }

  if (definition.encoding === 'binary') {
    const fieldBytes = buffer.slice(offset, offset + lengthValue);
    if (fieldBytes.length !== lengthValue) {
      throw new Error(`Truncated binary variable field ${definition.label}`);
    }
    return { value: fieldBytes, nextOffset: offset + lengthValue };
  }

  throw new Error(`Unsupported encoding ${definition.encoding} for field ${definition.label}`);
}

function parseFields(buffer, offset, bits) {
  const fields = {};

  for (let fieldIndex = 1; fieldIndex < bits.length; fieldIndex += 1) {
    if (!bits[fieldIndex]) continue;
    const fieldNumber = fieldIndex + 1; // bits array is zero-based.
    const definition = getFieldDefinition(fieldNumber);
    if (!definition) {
      throw new Error(`Field ${fieldNumber} is present but no definition exists`);
    }

    let result;
    if (definition.format === 'fixed') {
      result = readFixedField(buffer, offset, definition);
    } else if (definition.format === 'llvar' || definition.format === 'lllvar') {
      result = readVariableField(buffer, offset, definition);
    } else {
      throw new Error(`Field ${fieldNumber} format ${definition.format} not supported in parser`);
    }

    const { value, nextOffset } = result;
    fields[fieldNumber] = value;
    offset = nextOffset;
  }

  return { fields, offset };
}

function parseIso8583Message(buffer) {
  if (buffer.length < 12) {
    throw new Error('Buffer too short to be a valid ISO8583 message');
  }

  const mti = buffer.slice(0, 4).toString('ascii');
  let offset = 4;

  const { bitmapBytes, bits, offset: afterBitmap } = extractBitmap(buffer, offset);
  offset = afterBitmap;

  const { fields } = parseFields(buffer, offset, bits);

  return {
    mti,
    bitmap: bitmapBytes,
    fields,
  };
}

module.exports = {
  parseIso8583Message,
};

