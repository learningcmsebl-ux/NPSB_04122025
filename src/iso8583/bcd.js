function ensureEvenLength(value) {
  return value.length % 2 === 0 ? value : `0${value}`;
}

function asciiToBcd(value, digitCount) {
  const normalized = ensureEvenLength(value);
  const byteLength = normalized.length / 2;
  const buffer = Buffer.alloc(byteLength);

  for (let i = 0; i < byteLength; i += 1) {
    const highNibble = parseInt(normalized[i * 2], 10);
    const lowNibble = parseInt(normalized[i * 2 + 1], 10);

    if (Number.isNaN(highNibble) || Number.isNaN(lowNibble)) {
      throw new Error(`Non-numeric character in BCD field: ${value}`);
    }

    buffer[i] = (highNibble << 4) | lowNibble;
  }

  return buffer;
}

function bcdToAscii(buffer, digitCount) {
  let ascii = '';
  for (let i = 0; i < buffer.length; i += 1) {
    const byte = buffer[i];
    ascii += ((byte >> 4) & 0x0f).toString(10);
    ascii += (byte & 0x0f).toString(10);
  }

  if (digitCount != null) {
    ascii = ascii.slice(ascii.length - digitCount);
  }

  return ascii;
}

module.exports = {
  asciiToBcd,
  bcdToAscii,
};

