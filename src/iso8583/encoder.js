/**
 * ISO 8583:1993 encoder/decoder for NPSB profile
 * Ported from the NPSB SIM TypeScript implementation.
 */

const ISO8583_FIELDS = {
  2: { type: 'LLVAR', length: 19, format: 'N', description: 'Primary Account Number (PAN)' },
  3: { type: 'FIXED', length: 6, format: 'N', description: 'Processing Code' },
  4: { type: 'FIXED', length: 12, format: 'N', description: 'Amount, Transaction' },
  5: { type: 'FIXED', length: 12, format: 'N', description: 'Amount, Settlement' },
  6: { type: 'FIXED', length: 12, format: 'N', description: 'Cardholder Billing Amount' },
  7: { type: 'FIXED', length: 10, format: 'N', description: 'Transmission Date & Time' },
  10: { type: 'FIXED', length: 8, format: 'N', description: 'Conversion Rate, Cardholder Billing' },
  11: { type: 'FIXED', length: 6, format: 'N', description: 'System Trace Audit Number' },
  12: { type: 'FIXED', length: 6, format: 'N', description: 'Local Transaction Time' },
  13: { type: 'FIXED', length: 4, format: 'N', description: 'Local Transaction Date' },
  18: { type: 'FIXED', length: 4, format: 'N', description: 'Merchant Type' },
  19: { type: 'FIXED', length: 3, format: 'N', description: 'Acquiring Country Code' },
  22: { type: 'FIXED', length: 3, format: 'N', description: 'Point of Service Entry Mode' },
  25: { type: 'FIXED', length: 2, format: 'N', description: 'Point of Service Condition Code' },
  32: { type: 'LLVAR', length: 11, format: 'N', description: 'Acquiring Institution Identification Code' },
  35: { type: 'LLVAR', length: 37, format: 'Z', description: 'Track 2 Data' },
  37: { type: 'FIXED', length: 12, format: 'AN', description: 'Retrieval Reference Number' },
  38: { type: 'FIXED', length: 6, format: 'AN', description: 'Authorization Identification Response' },
  39: { type: 'FIXED', length: 2, format: 'AN', description: 'Response Code' },
  41: { type: 'FIXED', length: 8, format: 'ANS', description: 'Card Acceptor Terminal Identification' },
  42: { type: 'FIXED', length: 15, format: 'ANS', description: 'Card Acceptor Identification Code' },
  43: { type: 'FIXED', length: 40, format: 'ANS', description: 'Card Acceptor Name/Location' },
  49: { type: 'FIXED', length: 3, format: 'N', description: 'Currency Code, Transaction' },
  50: { type: 'FIXED', length: 3, format: 'AN', description: 'Settlement Currency Code' },
  51: { type: 'FIXED', length: 3, format: 'AN', description: 'Cardholder Billing Currency Code' },
  52: { type: 'FIXED', length: 16, format: 'B', description: 'Personal Identification Number (PIN) Data' },
  53: { type: 'FIXED', length: 16, format: 'B', description: 'Security Related Control Information' },
  54: { type: 'LLLVAR', length: 120, format: 'ANS', description: 'Additional Amounts' },
  70: { type: 'FIXED', length: 3, format: 'N', description: 'Network Management Information Code' },
  128: { type: 'FIXED', length: 16, format: 'B', description: 'Message Authentication Code (MAC)' },
  46: { type: 'LLLVAR', length: 999, format: 'ANS', description: 'NPSB Proprietary Field 46' },
  47: { type: 'LLLVAR', length: 999, format: 'ANS', description: 'NPSB Proprietary Field 47 (PDS927 Counterpart Account ID)' },
  48: { type: 'LLLVAR', length: 999, format: 'ANS', description: 'NPSB Proprietary Field 48 (PDS848 Payment Service Code)' },
  103: { type: 'LLVAR', length: 104, format: 'ANS', description: 'Account Identification-2 (A2A/IBFT)' },
  112: { type: 'LLLVAR', length: 999, format: 'AN', description: 'Additional Info (Card-to-Card/Card-to-Account/Account-to-Account/Account-to-Card)' },
  125: { type: 'LLLVAR', length: 999, format: 'ANS', description: 'NPSB Proprietary Field 125' },
};

class ISO8583Encoder {
  constructor(encoding = 'ascii', numericEncoding = 'ascii') {
    this.encoding = encoding;
    this.numericEncoding = numericEncoding;
  }

  buildBitmap(fieldNumbers) {
    const primaryBitmap = Buffer.alloc(8, 0);
    const secondaryBitmap = Buffer.alloc(8, 0);
    let hasSecondary = false;

    for (const fieldNum of fieldNumbers) {
      if (fieldNum <= 64) {
        const byteIndex = Math.floor((fieldNum - 1) / 8);
        const bitIndex = 7 - ((fieldNum - 1) % 8);
        primaryBitmap[byteIndex] |= 1 << bitIndex;
      } else if (fieldNum <= 128) {
        hasSecondary = true;
        const secondaryFieldNum = fieldNum - 64;
        const byteIndex = Math.floor((secondaryFieldNum - 1) / 8);
        const bitIndex = 7 - ((secondaryFieldNum - 1) % 8);
        secondaryBitmap[byteIndex] |= 1 << bitIndex;
      } else {
        throw new Error(`Field ${fieldNum} exceeds maximum supported (128)`);
      }
    }

    if (hasSecondary) {
      primaryBitmap[0] |= 0x80;
    }

    if (hasSecondary) {
      const combined = Buffer.concat([primaryBitmap, secondaryBitmap]);
      const hex = combined.toString('hex').toUpperCase();
      return hex.padEnd(32, '0');
    }

    return primaryBitmap.toString('hex').toUpperCase();
  }

  encodeField(fieldNum, value) {
    const fieldDef = ISO8583_FIELDS[fieldNum];
    if (!fieldDef) {
      return `${value.length.toString().padStart(2, '0')}${value}`;
    }

    let encoded = value;

    if (fieldDef.type === 'FIXED') {
      if (fieldDef.format === 'N') {
        encoded = value.padStart(fieldDef.length, '0').substring(0, fieldDef.length);
        if (this.numericEncoding === 'bcd') {
          return this.encodeBCD(encoded);
        }
      } else if (fieldDef.format === 'AN' || fieldDef.format === 'ANS') {
        encoded = value.padEnd(fieldDef.length, ' ').substring(0, fieldDef.length);
      } else {
        encoded = value.padEnd(fieldDef.length, '0').substring(0, fieldDef.length);
      }
    } else if (fieldDef.type === 'LLVAR') {
      const length = value.length;
      const lengthStr = length.toString().padStart(2, '0');
      const useBCDLength = this.numericEncoding === 'bcd';

      if (useBCDLength) {
        const lengthBCD = this.encodeBCD(lengthStr);
        if (fieldNum === 2 || fieldDef.format === 'N') {
          const valueBCD = this.encodeBCD(value);
          return lengthBCD + valueBCD;
        }
        const valueBinary = Buffer.from(value, 'ascii').toString('binary');
        return lengthBCD + valueBinary;
      }

      // ASCII length/value
      encoded = `${lengthStr}${value}`;
    } else if (fieldDef.type === 'LLLVAR') {
      const length = value.length;
      const lengthStr = length.toString().padStart(3, '0');
      const useBCDLength = this.numericEncoding === 'bcd';

      if (useBCDLength) {
        const paddedLengthStr = lengthStr.padStart(lengthStr.length + (lengthStr.length % 2), '0');
        const lengthBCD = this.encodeBCD(paddedLengthStr);
        if (fieldDef.format === 'N') {
          const valueBCD = this.encodeBCD(value);
          return lengthBCD + valueBCD;
        }
        const valueBinary = Buffer.from(value, 'ascii').toString('binary');
        return lengthBCD + valueBinary;
      }

      encoded = `${lengthStr}${value}`;
    }

    return encoded;
  }

  pack(message) {
    const fieldNumbers = Object.keys(message.fields).map(Number).sort((a, b) => a - b);
    const bitmapHex = message.bitmap && message.bitmap.trim() !== ''
      ? message.bitmap.toUpperCase()
      : this.buildBitmap(fieldNumbers);
    const bitmapBuffer = Buffer.from(bitmapHex, 'hex');

    let packed = message.mti;
    packed += bitmapBuffer.toString('binary');

    const primaryFields = fieldNumbers.filter((f) => f <= 64);
    const secondaryFields = fieldNumbers.filter((f) => f > 64);

    for (const fieldNum of primaryFields) {
      const value = message.fields[fieldNum];
      packed += this.encodeField(fieldNum, value);
    }

    for (const fieldNum of secondaryFields) {
      const value = message.fields[fieldNum];
      packed += this.encodeField(fieldNum, value);
    }

    return packed;
  }

  parseBitmap(bitmapHex) {
    const bitmap = Buffer.from(bitmapHex, 'hex');
    const fields = [];

    const hasSecondary = (bitmap[0] & 0x80) !== 0;
    const primaryBitmapLength = 8;
    const totalBitmapLength = hasSecondary ? 16 : 8;

    if (bitmap.length < totalBitmapLength) {
      throw new Error(`Invalid bitmap length: expected ${totalBitmapLength} bytes, got ${bitmap.length}`);
    }

    for (let byteIndex = 0; byteIndex < primaryBitmapLength; byteIndex++) {
      for (let bitIndex = 0; bitIndex < 8; bitIndex++) {
        if (bitmap[byteIndex] & (1 << (7 - bitIndex))) {
          const fieldNum = byteIndex * 8 + bitIndex + 1;
          if (fieldNum === 1 && hasSecondary) {
            continue;
          }
          if (fieldNum <= 64) {
            fields.push(fieldNum);
          }
        }
      }
    }

    if (hasSecondary && bitmap.length >= 16) {
      for (let byteIndex = 0; byteIndex < primaryBitmapLength; byteIndex++) {
        const secondaryByteIndex = byteIndex + primaryBitmapLength;
        for (let bitIndex = 0; bitIndex < 8; bitIndex++) {
          if (bitmap[secondaryByteIndex] & (1 << (7 - bitIndex))) {
            const secondaryFieldNum = byteIndex * 8 + bitIndex + 1;
            const fieldNum = secondaryFieldNum + 64;
            fields.push(fieldNum);
          }
        }
      }
    }

    return fields;
  }

  decodeFieldFromBuffer(fieldNum, dataBuffer, offset) {
    const fieldDef = ISO8583_FIELDS[fieldNum];
    if (!fieldDef) {
      const length = parseInt(dataBuffer.slice(offset, offset + 2).toString('ascii'), 10);
      return {
        value: dataBuffer.slice(offset + 2, offset + 2 + length).toString('ascii'),
        length: 2 + length,
      };
    }

    let value;
    let consumed;

    if (fieldDef.type === 'FIXED') {
      if (fieldDef.format === 'N' && this.numericEncoding === 'bcd') {
        const bcdBytes = Math.ceil(fieldDef.length / 2);
        const bcdBuffer = dataBuffer.slice(offset, offset + bcdBytes);
        value = this.decodeBCD(bcdBuffer, fieldDef.length);
        consumed = bcdBytes;
        return { value, length: consumed };
      }
      value = dataBuffer.slice(offset, offset + fieldDef.length).toString('ascii');
      consumed = fieldDef.length;
      if (fieldDef.format === 'N') {
        return { value, length: consumed };
      }
    } else if (fieldDef.type === 'LLVAR') {
      const useBCDLength = this.numericEncoding === 'bcd';
      let length;
      let headerLength;
      if (useBCDLength) {
        const lengthBytes = dataBuffer.slice(offset, offset + 1);
        length = parseInt(this.decodeBCD(lengthBytes, 2), 10);
        headerLength = 1;
      } else {
        length = parseInt(dataBuffer.slice(offset, offset + 2).toString('ascii'), 10);
        headerLength = 2;
      }
      const isBCDValue = (fieldDef.format === 'N' || fieldNum === 2) && this.numericEncoding === 'bcd';
      const dataLength = isBCDValue ? Math.ceil(length / 2) : length;
      const fieldBytes = dataBuffer.slice(offset + headerLength, offset + headerLength + dataLength);
      value = isBCDValue ? this.decodeBCD(fieldBytes, length) : fieldBytes.toString('ascii');
      consumed = headerLength + fieldBytes.length;
    } else if (fieldDef.type === 'LLLVAR') {
      const useBCDLength = this.numericEncoding === 'bcd';
      let length;
      let headerLength;
      if (useBCDLength) {
        const lengthBytes = dataBuffer.slice(offset, offset + 2);
        length = parseInt(this.decodeBCD(lengthBytes, 3), 10);
        headerLength = 2;
      } else {
        length = parseInt(dataBuffer.slice(offset, offset + 3).toString('ascii'), 10);
        headerLength = 3;
      }
      const isBCDValue = fieldDef.format === 'N' && this.numericEncoding === 'bcd';
      const dataLength = isBCDValue ? Math.ceil(length / 2) : length;
      const fieldBytes = dataBuffer.slice(offset + headerLength, offset + headerLength + dataLength);
      value = isBCDValue ? this.decodeBCD(fieldBytes, length) : fieldBytes.toString('ascii');
      consumed = headerLength + fieldBytes.length;
    } else {
      throw new Error(`Unsupported field type: ${fieldDef.type}`);
    }

    return { value: value.trim(), length: consumed };
  }

  decodeBCD(buffer, length) {
    let result = '';
    for (let i = 0; i < buffer.length; i++) {
      const byte = buffer[i];
      const high = (byte >> 4) & 0x0f;
      const low = byte & 0x0f;

      if (high !== 0x0f) {
        if (high > 9) {
          throw new Error(`Invalid BCD digit: ${high}`);
        }
        result += high.toString();
      }

      if (low !== 0x0f) {
        if (low > 9) {
          throw new Error(`Invalid BCD digit: ${low}`);
        }
        result += low.toString();
      }
    }
    if (result.length === 0) {
      return ''.padStart(length, '0');
    }
    if (result.length > length) {
      result = result.slice(result.length - length);
    }
    return result.padStart(length, '0');
  }

  encodeBCD(value) {
    const bytes = [];
    const paddedValue = value.length % 2 === 1 ? `0${value}` : value;
    for (let i = 0; i < paddedValue.length; i += 2) {
      const high = parseInt(paddedValue[i] || '0', 10);
      const low = parseInt(paddedValue[i + 1] || '0', 10);
      bytes.push((high << 4) | low);
    }
    return Buffer.from(bytes).toString('binary');
  }

  decodeField(fieldNum, data, offset) {
    const dataBuffer = Buffer.from(data, 'ascii');
    return this.decodeFieldFromBuffer(fieldNum, dataBuffer, offset);
  }

  unpackFromBuffer(dataBuffer) {
    if (dataBuffer.length < 4) {
      throw new Error('Message too short');
    }

    const mti = dataBuffer.slice(0, 4).toString('ascii');
    const firstBitmapByte = dataBuffer[4];
    const hasSecondary = (firstBitmapByte & 0x80) !== 0;
    const bitmapLength = hasSecondary ? 16 : 8;

    if (dataBuffer.length < 4 + bitmapLength) {
      throw new Error(`Invalid bitmap length: expected ${4 + bitmapLength} bytes, got ${dataBuffer.length}`);
    }

    const bitmapBuffer = dataBuffer.slice(4, 4 + bitmapLength);
    const bitmapHex = bitmapBuffer.toString('hex').toUpperCase();

    if (hasSecondary && bitmapLength !== 16) {
      throw new Error(`Secondary bitmap detected but length is ${bitmapLength} instead of 16`);
    }

    const fieldNumbers = this.parseBitmap(bitmapHex);
    const fields = {};
    let offset = 4 + bitmapLength;

    const expectedMinLength = offset + fieldNumbers.reduce((sum, fieldNum) => {
      const fieldDef = ISO8583_FIELDS[fieldNum];
      if (fieldDef) {
        if (fieldDef.type === 'FIXED') {
          if (fieldDef.format === 'N' && this.numericEncoding === 'bcd') {
            return sum + Math.ceil(fieldDef.length / 2);
          }
          return sum + fieldDef.length;
        }
        if (fieldDef.type === 'LLVAR') {
          return sum + (this.numericEncoding === 'bcd' ? 1 : 2);
        }
        if (fieldDef.type === 'LLLVAR') {
          return sum + (this.numericEncoding === 'bcd' ? 2 : 3);
        }
      }
      return sum + 2;
    }, 0);

    if (dataBuffer.length < expectedMinLength) {
      if (this.numericEncoding === 'ascii') {
        try {
          const fallbackEncoder = new ISO8583Encoder(this.encoding, 'bcd');
          return fallbackEncoder.unpackFromBuffer(dataBuffer);
        } catch (error) {
          // ignore
        }
      }

      const actualLength = dataBuffer.length;
      const missingBytes = expectedMinLength - actualLength;
      const fieldInfo = fieldNumbers
        .map((f) => {
          const def = ISO8583_FIELDS[f];
          return `${f}(${def ? def.type : 'unknown'},${def ? def.length : '?'})`;
        })
        .join(', ');
      throw new Error(
        `Message too short: expected at least ${expectedMinLength} bytes, got ${actualLength} (missing ${missingBytes} bytes). ` +
          `Fields: ${fieldInfo}. Remaining data: ${dataBuffer.slice(offset).toString('hex').toUpperCase()}`,
      );
    }

    const primaryFields = fieldNumbers.filter((f) => f <= 64);
    const secondaryFields = fieldNumbers.filter((f) => f > 64);

    for (const fieldNum of primaryFields) {
      if (offset >= dataBuffer.length) {
        throw new Error(
          `Message too short: cannot parse field ${fieldNum} at offset ${offset}, message length is ${dataBuffer.length}`,
        );
      }
      const result = this.decodeFieldFromBuffer(fieldNum, dataBuffer, offset);
      fields[fieldNum] = result.value;
      offset += result.length;
    }

    for (const fieldNum of secondaryFields) {
      if (offset >= dataBuffer.length) {
        throw new Error(
          `Message too short: cannot parse field ${fieldNum} at offset ${offset}, message length is ${dataBuffer.length}`,
        );
      }
      const result = this.decodeFieldFromBuffer(fieldNum, dataBuffer, offset);
      fields[fieldNum] = result.value;
      offset += result.length;
    }

    return {
      mti,
      bitmap: bitmapHex,
      fields,
    };
  }

  unpack(data) {
    const dataBuffer = Buffer.from(data, 'ascii');
    return this.unpackFromBuffer(dataBuffer);
  }

  buildResponse(request, responseMTI, overrides = {}) {
    const responseFields = {};

    const fieldsToCopy = [7, 11, 12, 13, 37, 41, 42, 49, 70];
    for (const fieldNum of fieldsToCopy) {
      if (request.fields[fieldNum]) {
        responseFields[fieldNum] = request.fields[fieldNum];
      }
    }

    for (const [fieldNum, value] of Object.entries(overrides)) {
      const fieldNumInt = parseInt(fieldNum, 10);
      if (value !== undefined && value !== null && value !== '') {
        const stringValue = String(value).trim();
        if (stringValue !== '') {
          responseFields[fieldNumInt] = stringValue;
        }
      }
    }

    return {
      mti: responseMTI,
      bitmap: '',
      fields: responseFields,
    };
  }
}

module.exports = {
  ISO8583_FIELDS,
  ISO8583Encoder,
};
