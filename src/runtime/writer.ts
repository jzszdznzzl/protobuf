import { splitInt64, toBigInt, zigZagEncode64 } from './int64.ts';
import type { Int64Like } from './int64.ts';

const MIN_CAPACITY = 16;
const DEFAULT_CAPACITY = 64;

const encoder = new TextEncoder();

const varintSize = (value: number): number => {
  if (value < 0x80) {
    return 1;
  }
  if (value < 0x4000) {
    return 2;
  }
  if (value < 0x200000) {
    return 3;
  }
  if (value < 0x10000000) {
    return 4;
  }
  return 5;
};

/**
 * Protobuf binary writer. Every method returns `this`, so calls chain:
 * `writer.uint32(10).string('hello')`.
 *
 * Nested messages are written between `fork()` and `ldelim()`: `fork()` reserves room for
 * the length prefix and `ldelim()` fills it in.
 */
export class Writer {
  #buf: Uint8Array;
  #view: DataView;
  #pos = 0;
  #forks: number[] = [];

  constructor(initialCapacity = DEFAULT_CAPACITY) {
    this.#buf = new Uint8Array(Math.max(MIN_CAPACITY, initialCapacity));
    this.#view = new DataView(this.#buf.buffer);
  }

  #ensure(extra: number): void {
    const needed = this.#pos + extra;
    if (needed <= this.#buf.length) {
      return;
    }
    let size = this.#buf.length * 2;
    while (size < needed) {
      size *= 2;
    }
    const next = new Uint8Array(size);
    next.set(this.#buf.subarray(0, this.#pos));
    this.#buf = next;
    this.#view = new DataView(next.buffer);
  }

  #varint32(value: number): void {
    this.#ensure(5);
    let rest = value >>> 0;
    while (rest > 127) {
      this.#buf[this.#pos++] = (rest & 127) | 128;
      rest >>>= 7;
    }
    this.#buf[this.#pos++] = rest;
  }

  #varint64(lo: number, hi: number): void {
    this.#ensure(10);
    let low = lo;
    let high = hi;
    while (high) {
      this.#buf[this.#pos++] = (low & 127) | 128;
      low = ((low >>> 7) | (high << 25)) >>> 0;
      high >>>= 7;
    }
    while (low > 127) {
      this.#buf[this.#pos++] = (low & 127) | 128;
      low >>>= 7;
    }
    this.#buf[this.#pos++] = low;
  }

  /** Number of bytes written so far. */
  get length(): number {
    return this.#pos;
  }

  /** Unsigned varint (also used for tags and lengths). */
  uint32(value: number): this {
    this.#varint32(value);
    return this;
  }

  /** Signed varint: negatives take 10 bytes (sign extension to 64 bits). */
  int32(value: number): this {
    if (value < 0) {
      this.#varint64(value >>> 0, 0xffffffff);
    } else {
      this.#varint32(value);
    }
    return this;
  }

  /** ZigZag varint (efficient for negatives). */
  sint32(value: number): this {
    this.#varint32(((value << 1) ^ (value >> 31)) >>> 0);
    return this;
  }

  fixed32(value: number): this {
    this.#ensure(4);
    this.#view.setUint32(this.#pos, value >>> 0, true);
    this.#pos += 4;
    return this;
  }

  sfixed32(value: number): this {
    this.#ensure(4);
    this.#view.setInt32(this.#pos, value | 0, true);
    this.#pos += 4;
    return this;
  }

  float(value: number): this {
    this.#ensure(4);
    this.#view.setFloat32(this.#pos, value, true);
    this.#pos += 4;
    return this;
  }

  bool(value: boolean): this {
    this.#ensure(1);
    this.#buf[this.#pos++] = value ? 1 : 0;
    return this;
  }

  uint64(value: Int64Like): this {
    const [lo, hi] = splitInt64(value);
    this.#varint64(lo, hi);
    return this;
  }

  int64(value: Int64Like): this {
    return this.uint64(value);
  }

  sint64(value: Int64Like): this {
    const [lo, hi] = splitInt64(zigZagEncode64(value));
    this.#varint64(lo, hi);
    return this;
  }

  fixed64(value: Int64Like): this {
    this.#ensure(8);
    this.#view.setBigUint64(this.#pos, BigInt.asUintN(64, toBigInt(value)), true);
    this.#pos += 8;
    return this;
  }

  sfixed64(value: Int64Like): this {
    this.#ensure(8);
    this.#view.setBigInt64(this.#pos, BigInt.asIntN(64, toBigInt(value)), true);
    this.#pos += 8;
    return this;
  }

  double(value: number): this {
    this.#ensure(8);
    this.#view.setFloat64(this.#pos, value, true);
    this.#pos += 8;
    return this;
  }

  bytes(value: Uint8Array): this {
    this.#varint32(value.length);
    return this.raw(value);
  }

  /** Appends already-encoded bytes (unknown fields, extensions) without a length prefix. */
  raw(value: Uint8Array): this {
    this.#ensure(value.length);
    this.#buf.set(value, this.#pos);
    this.#pos += value.length;
    return this;
  }

  string(value: string): this {
    return this.bytes(encoder.encode(value));
  }

  /**
   * Starts a length-prefixed block. It reserves one byte for the length, enough for blocks
   * under 128 bytes; `ldelim()` shifts the content when more room is needed.
   */
  fork(): this {
    this.#ensure(1);
    this.#forks.push(this.#pos);
    this.#pos += 1;
    return this;
  }

  /** Closes the block opened by `fork()` by writing its length. */
  ldelim(): this {
    const start = this.#forks.pop();
    if (start === undefined) {
      throw new Error('ldelim() without a previous fork()');
    }
    const contentStart = start + 1;
    const length = this.#pos - contentStart;
    const size = varintSize(length);
    if (size > 1) {
      this.#ensure(size - 1);
      this.#buf.copyWithin(start + size, contentStart, this.#pos);
      this.#pos += size - 1;
    }
    let cursor = start;
    let rest = length;
    while (rest > 127) {
      this.#buf[cursor++] = (rest & 127) | 128;
      rest >>>= 7;
    }
    this.#buf[cursor] = rest;
    return this;
  }

  /** Returns a copy of the bytes written. */
  finish(): Uint8Array {
    if (this.#forks.length > 0) {
      throw new Error('finish() with an unclosed fork()');
    }
    return this.#buf.slice(0, this.#pos);
  }
}
