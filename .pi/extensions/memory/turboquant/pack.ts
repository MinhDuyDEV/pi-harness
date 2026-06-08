/**
 * Bit-packing utilities for TurboQuant.
 *
 * Converts quantized codes (0..numLevels-1 per coordinate) into tight
 * packed byte arrays and vice versa.
 *
 * bitWidth=4: pack 2 codes per byte (nibble-split)
 * bitWidth=2: pack 4 codes per byte
 * bitWidth=3: pack 2 codes per byte with one unused bit (straddles 2 planes)
 *             (stored as 2-bit sub-codes + separate plane2)
 */

// =============================================================================
// Encode (scalar indices → packed bytes)
// =============================================================================

/**
 * Pack quantized codes into a byte array.
 *
 * @param codes Flat array of n*d code indices (each 0..numLevels-1)
 * @param n Number of vectors
 * @param dim Vector dimension
 * @param bitWidth Bits per coordinate (2 or 4)
 * @returns Packed byte array
 */
export function packCodes(
  codes: Uint8Array,
  n: number,
  dim: number,
  bitWidth: 2 | 3 | 4,
): Uint8Array {
  if (bitWidth === 2) {
    return pack2Bit(codes, n, dim);
  } else if (bitWidth === 3) {
    return pack3Bit(codes, n, dim);
  } else {
    return pack4Bit(codes, n, dim);
  }
}

/**
 * Unpack byte array back to quantized codes.
 *
 * @param packed Packed byte array
 * @param n Number of vectors
 * @param dim Vector dimension
 * @param bitWidth Bits per coordinate (2 or 4)
 * @returns Flat array of n*d code indices
 */
export function unpackCodes(
  packed: Uint8Array,
  n: number,
  dim: number,
  bitWidth: 2 | 3 | 4,
): Uint8Array {
  if (bitWidth === 2) {
    return unpack2Bit(packed, n, dim);
  } else if (bitWidth === 3) {
    return unpack3Bit(packed, n, dim);
  } else {
    return unpack4Bit(packed, n, dim);
  }
}

// =============================================================================
// 4-bit packing (2 codes per byte, nibble-split)
// =============================================================================

function pack4Bit(codes: Uint8Array, n: number, dim: number): Uint8Array {
  const bytesPerVec = Math.ceil(dim / 2);
  const packed = new Uint8Array(n * bytesPerVec);

  for (let vi = 0; vi < n; vi++) {
    const vecOffset = vi * dim;
    const packOffset = vi * bytesPerVec;
    for (let d = 0; d < dim; d += 2) {
      const lo = codes[vecOffset + d] & 0x0F;
      const hi = (d + 1 < dim ? codes[vecOffset + d + 1] & 0x0F : 0);
      packed[packOffset + (d >> 1)] = (hi << 4) | lo;
    }
  }
  return packed;
}

function unpack4Bit(packed: Uint8Array, n: number, dim: number): Uint8Array {
  const bytesPerVec = Math.ceil(dim / 2);
  const codes = new Uint8Array(n * dim);

  for (let vi = 0; vi < n; vi++) {
    const vecOffset = vi * dim;
    const packOffset = vi * bytesPerVec;
    for (let d = 0; d < dim; d += 2) {
      const byte = packed[packOffset + (d >> 1)];
      codes[vecOffset + d] = byte & 0x0F;
      if (d + 1 < dim) {
        codes[vecOffset + d + 1] = (byte >> 4) & 0x0F;
      }
    }
  }
  return codes;
}

// =============================================================================
// 2-bit packing (4 codes per byte)
// =============================================================================

function pack2Bit(codes: Uint8Array, n: number, dim: number): Uint8Array {
  const bytesPerVec = Math.ceil(dim / 4);
  const packed = new Uint8Array(n * bytesPerVec);

  for (let vi = 0; vi < n; vi++) {
    const vecOffset = vi * dim;
    const packOffset = vi * bytesPerVec;
    for (let d = 0; d < dim; d += 4) {
      let byte = 0;
      for (let s = 0; s < 4 && d + s < dim; s++) {
        byte |= (codes[vecOffset + d + s] & 0x03) << (s * 2);
      }
      packed[packOffset + (d >> 2)] = byte;
    }
  }
  return packed;
}

function unpack2Bit(packed: Uint8Array, n: number, dim: number): Uint8Array {
  const bytesPerVec = Math.ceil(dim / 4);
  const codes = new Uint8Array(n * dim);

  for (let vi = 0; vi < n; vi++) {
    const vecOffset = vi * dim;
    const packOffset = vi * bytesPerVec;
    for (let d = 0; d < dim; d += 4) {
      const byte = packed[packOffset + (d >> 2)];
      for (let s = 0; s < 4 && d + s < dim; s++) {
        codes[vecOffset + d + s] = (byte >> (s * 2)) & 0x03;
      }
    }
  }
  return codes;
}

// =============================================================================
// 3-bit packing (straddles 2 planes: 2-bit sub-codes + separate plane2 bits)
// =============================================================================

/**
 * Pack 3-bit codes into the two-plane format.
 * Returns { subCodes: Uint8Array (2-bit packed), plane2: Uint8Array (bit-packed) }
 */
export function pack3BitSplit(
  codes: Uint8Array,
  n: number,
  dim: number,
): { subCodes: Uint8Array; plane2: Uint8Array } {
  const subBytesPerVec = Math.ceil(dim / 4);
  const plane2BytesPerVec = Math.ceil(dim / 8);
  const subCodes = new Uint8Array(n * subBytesPerVec);
  const plane2 = new Uint8Array(n * plane2BytesPerVec);

  for (let vi = 0; vi < n; vi++) {
    const vecOffset = vi * dim;

    // Pack low 2 bits (4 per byte)
    for (let d = 0; d < dim; d += 4) {
      let byte = 0;
      for (let s = 0; s < 4 && d + s < dim; s++) {
        byte |= (codes[vecOffset + d + s] & 0x03) << (s * 2);
      }
      subCodes[vi * subBytesPerVec + (d >> 2)] = byte;
    }

    // Pack high bit (1 per byte, 8 per byte)
    for (let d = 0; d < dim; d += 8) {
      let byte = 0;
      for (let s = 0; s < 8 && d + s < dim; s++) {
        const code = codes[vecOffset + d + s];
        if (code & 0x04) {
          byte |= 1 << (7 - s);
        }
      }
      plane2[vi * plane2BytesPerVec + (d >> 3)] = byte;
    }
  }

  return { subCodes, plane2 };
}

/**
 * Unpack 3-bit codes from the two-plane format.
 */
export function unpack3BitSplit(
  subCodes: Uint8Array,
  plane2: Uint8Array,
  n: number,
  dim: number,
): Uint8Array {
  const codes = new Uint8Array(n * dim);
  const subBytesPerVec = Math.ceil(dim / 4);
  const plane2BytesPerVec = Math.ceil(dim / 8);

  for (let vi = 0; vi < n; vi++) {
    const vecOffset = vi * dim;

    for (let d = 0; d < dim; d++) {
      const subByte = subCodes[vi * subBytesPerVec + (d >> 2)];
      const subShift = (d & 3) * 2;
      const lo2 = (subByte >> subShift) & 0x03;

      const p2Byte = plane2[vi * plane2BytesPerVec + (d >> 3)];
      const hi = (p2Byte >> (7 - (d & 7))) & 0x01;

      codes[vecOffset + d] = lo2 | (hi << 2);
    }
  }
  return codes;
}

// 3-bit unified pack (wraps the split format into a single packed array)
function pack3Bit(codes: Uint8Array, n: number, dim: number): Uint8Array {
  const { subCodes, plane2 } = pack3BitSplit(codes, n, dim);
  const combined = new Uint8Array(subCodes.length + plane2.length);
  combined.set(subCodes);
  combined.set(plane2, subCodes.length);
  return combined;
}

function unpack3Bit(packed: Uint8Array, n: number, dim: number): Uint8Array {
  const subBytesPerVec = Math.ceil(dim / 4);
  const plane2BytesPerVec = Math.ceil(dim / 8);
  const subLen = n * subBytesPerVec;
  const subCodes = packed.subarray(0, subLen);
  const plane2 = packed.subarray(subLen, subLen + n * plane2BytesPerVec);
  return unpack3BitSplit(subCodes, plane2, n, dim);
}

// =============================================================================
// Utility
// =============================================================================

/**
 * Compute packed byte length for a given configuration.
 */
export function packedByteLength(
  n: number,
  dim: number,
  bitWidth: 2 | 3 | 4,
): number {
  if (bitWidth === 2) return n * Math.ceil(dim / 4);
  if (bitWidth === 3) {
    return n * (Math.ceil(dim / 4) + Math.ceil(dim / 8));
  }
  return n * Math.ceil(dim / 2);
}
