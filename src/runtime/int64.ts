/** Values accepted for 64-bit fields when encoding. */
export type Int64Like = bigint | number | string;

const MASK_32 = 0xffffffffn;

export function toBigInt(value: Int64Like): bigint {
  if (typeof value === 'number' && !Number.isInteger(value)) {
    throw new RangeError(`Non-integer value for a 64-bit field: ${value}`);
  }
  return BigInt(value);
}

/** Splits a 64-bit integer (two's complement) into unsigned 32-bit halves. */
export function splitInt64(value: Int64Like): [lo: number, hi: number] {
  const unsigned = BigInt.asUintN(64, toBigInt(value));
  return [Number(unsigned & MASK_32), Number(unsigned >> 32n)];
}

export function joinUint64(lo: number, hi: number): bigint {
  return hi === 0 ? BigInt(lo) : (BigInt(hi) << 32n) | BigInt(lo);
}

export function joinInt64(lo: number, hi: number): bigint {
  return BigInt.asIntN(64, joinUint64(lo, hi));
}

/** 64-bit ZigZag: maps signed integers to unsigned (sint64). */
export function zigZagEncode64(value: Int64Like): bigint {
  const signed = BigInt.asIntN(64, toBigInt(value));
  return BigInt.asUintN(64, (signed << 1n) ^ (signed >> 63n));
}

export function zigZagDecode64(value: bigint): bigint {
  return (value >> 1n) ^ -(value & 1n);
}
