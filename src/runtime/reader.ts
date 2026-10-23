import { DecodeError, DecodeErrorCode } from './errors.ts';
import { joinInt64, joinUint64, zigZagDecode64 } from './int64.ts';
import { WireType } from './wire-type.ts';

// `ignoreBOM` keeps a leading U+FEFF: it is data in a protobuf string, not an encoding marker.
const lenientDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
const strictDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });

const MAX_VARINT_BYTES = 10;

interface TextDecoding {
  decode(input: Uint8Array): string;
}

/** Protobuf binary reader. 64-bit integers are returned as `bigint`. */
export class Reader {
  #buf: Uint8Array;
  #view: DataView;
  #pos = 0;
  // Result of the last 64-bit varint read; avoids allocating a pair per call.
  #lo = 0;
  #hi = 0;

  constructor(buf: Uint8Array) {
    this.#buf = buf;
    this.#view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  #byte(): number {
    const value = this.#buf[this.#pos];
    if (value === undefined) {
      throw new DecodeError(
        DecodeErrorCode.Truncated,
        `Read out of range: position ${this.#pos} + 1 > ${this.length}`,
      );
    }
    this.#pos++;
    return value;
  }

  #need(count: number): void {
    if (this.#pos + count > this.length) {
      throw new DecodeError(
        DecodeErrorCode.Truncated,
        `Read out of range: position ${this.#pos} + ${count} > ${this.length}`,
      );
    }
  }

  #readVarint64(): void {
    let lo = 0;
    let hi = 0;
    let byte = 0;
    for (let i = 0; i < 4; i++) {
      byte = this.#byte();
      lo = (lo | ((byte & 127) << (i * 7))) >>> 0;
      if (byte < 128) {
        this.#lo = lo;
        this.#hi = 0;
        return;
      }
    }
    byte = this.#byte();
    lo = (lo | ((byte & 127) << 28)) >>> 0;
    hi = (byte & 127) >> 4;
    if (byte < 128) {
      this.#lo = lo;
      this.#hi = hi;
      return;
    }
    for (let i = 0; i < 5; i++) {
      byte = this.#byte();
      hi = (hi | ((byte & 127) << (i * 7 + 3))) >>> 0;
      if (byte < 128) {
        this.#lo = lo;
        this.#hi = hi;
        return;
      }
    }
    throw new DecodeError(DecodeErrorCode.MalformedVarint, 'Invalid varint (more than 10 bytes)');
  }

  #decodeText(decoder: TextDecoding): string {
    const length = this.uint32();
    this.#need(length);
    const bytes = this.#buf.subarray(this.#pos, this.#pos + length);
    this.#pos += length;
    try {
      return decoder.decode(bytes);
    } catch (error) {
      if (error instanceof TypeError) {
        throw new DecodeError(DecodeErrorCode.InvalidUtf8, 'String with invalid UTF-8');
      }
      throw error;
    }
  }

  get pos(): number {
    return this.#pos;
  }

  get length(): number {
    return this.#buf.length;
  }

  /** Throws if a field read went past `end`, the end of the length-delimited region that holds it. */
  checkEnd(end: number): void {
    if (this.#pos > end) {
      throw new DecodeError(
        DecodeErrorCode.LengthOverrun,
        `Malformed message: a field overruns its length (position ${this.#pos} > ${end})`,
      );
    }
  }

  /** Varint truncated to an unsigned 32 bits. Used for tags and lengths. */
  uint32(): number {
    let value = 0;
    for (let shift = 0; shift < 28; shift += 7) {
      const byte = this.#byte();
      value |= (byte & 127) << shift;
      if (byte < 128) {
        return value >>> 0;
      }
    }
    const last = this.#byte();
    value |= (last & 15) << 28;
    if (last < 128) {
      return value >>> 0;
    }
    // Discard the high bytes of a varint of up to 10 bytes.
    for (let i = 0; i < 5; i++) {
      if (this.#byte() < 128) {
        return value >>> 0;
      }
    }
    throw new DecodeError(DecodeErrorCode.MalformedVarint, 'Invalid varint (more than 10 bytes)');
  }

  int32(): number {
    return this.uint32() | 0;
  }

  sint32(): number {
    const zigZag = this.uint32();
    return (zigZag >>> 1) ^ -(zigZag & 1);
  }

  bool(): boolean {
    this.#readVarint64();
    return this.#lo !== 0 || this.#hi !== 0;
  }

  uint64(): bigint {
    this.#readVarint64();
    return joinUint64(this.#lo, this.#hi);
  }

  int64(): bigint {
    this.#readVarint64();
    return joinInt64(this.#lo, this.#hi);
  }

  sint64(): bigint {
    this.#readVarint64();
    return zigZagDecode64(joinUint64(this.#lo, this.#hi));
  }

  fixed32(): number {
    this.#need(4);
    const value = this.#view.getUint32(this.#pos, true);
    this.#pos += 4;
    return value;
  }

  sfixed32(): number {
    this.#need(4);
    const value = this.#view.getInt32(this.#pos, true);
    this.#pos += 4;
    return value;
  }

  float(): number {
    this.#need(4);
    const value = this.#view.getFloat32(this.#pos, true);
    this.#pos += 4;
    return value;
  }

  fixed64(): bigint {
    this.#need(8);
    const value = this.#view.getBigUint64(this.#pos, true);
    this.#pos += 8;
    return value;
  }

  sfixed64(): bigint {
    this.#need(8);
    const value = this.#view.getBigInt64(this.#pos, true);
    this.#pos += 8;
    return value;
  }

  double(): number {
    this.#need(8);
    const value = this.#view.getFloat64(this.#pos, true);
    this.#pos += 8;
    return value;
  }

  /** Returns a copy of the bytes: it never shares memory with the input buffer. */
  bytes(): Uint8Array {
    const length = this.uint32();
    this.#need(length);
    const out = this.#buf.slice(this.#pos, this.#pos + length);
    this.#pos += length;
    return out;
  }

  /** Copies the bytes `[start, pos)` already read; used to keep unknown fields. */
  raw(start: number): Uint8Array {
    return this.#buf.slice(start, this.#pos);
  }

  string(): string {
    return this.#decodeText(lenientDecoder);
  }

  /** Like `string()`, but throws if the bytes are not valid UTF-8 (`utf8_validation = VERIFY`). */
  stringStrict(): string {
    return this.#decodeText(strictDecoder);
  }

  /** Skips `length` bytes, or a whole varint if no length is given. */
  skip(length?: number): this {
    if (length === undefined) {
      for (let i = 0; i < MAX_VARINT_BYTES; i++) {
        if (this.#byte() < 128) {
          return this;
        }
      }
      throw new DecodeError(DecodeErrorCode.MalformedVarint, 'Invalid varint (more than 10 bytes)');
    }
    this.#need(length);
    this.#pos += length;
    return this;
  }

  /** Skips the field whose tag was already read (used by generated code for unknown fields). */
  skipField(tag: number): this {
    const fieldNumber = tag >>> 3;
    if (fieldNumber === 0) {
      throw new DecodeError(
        DecodeErrorCode.InvalidTag,
        `Invalid tag ${tag} at position ${this.#pos}`,
      );
    }
    return this.skipType(tag & 7, fieldNumber);
  }

  /** Skips an unknown field according to its wire type. */
  skipType(wireType: number, fieldNumber?: number): this {
    switch (wireType) {
      case WireType.Varint: {
        return this.skip();
      }
      case WireType.Fixed64: {
        return this.skip(8);
      }
      case WireType.LengthDelimited: {
        return this.skip(this.uint32());
      }
      case WireType.StartGroup: {
        for (;;) {
          const tag = this.uint32();
          const innerWireType = tag & 7;
          if (innerWireType === WireType.EndGroup) {
            if (fieldNumber !== undefined && tag >>> 3 !== fieldNumber) {
              throw new DecodeError(
                DecodeErrorCode.UnexpectedEndGroup,
                `Unexpected end of group (field ${tag >>> 3}, expected ${fieldNumber})`,
              );
            }
            return this;
          }
          this.skipType(innerWireType, tag >>> 3);
        }
      }
      case WireType.Fixed32: {
        return this.skip(4);
      }
      default: {
        throw new DecodeError(
          DecodeErrorCode.InvalidWireType,
          `Invalid wire type ${wireType} at position ${this.#pos}`,
        );
      }
    }
  }
}
