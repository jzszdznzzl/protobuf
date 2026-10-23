import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DecodeError, DecodeErrorCode } from '../errors.ts';
import { Reader } from '../reader.ts';
import { WireType } from '../wire-type.ts';
import { Writer } from '../writer.ts';

const decodeCode = (run: () => unknown): string | undefined => {
  try {
    run();
  } catch (error) {
    return error instanceof DecodeError ? error.code : undefined;
  }
  return undefined;
};

describe('varints', () => {
  it('round-trips unsigned 32-bit values', () => {
    for (const value of [0, 1, 127, 128, 300, 16384, 2 ** 28, 2 ** 32 - 1]) {
      const bytes = new Writer().uint32(value).finish();
      assert.equal(new Reader(bytes).uint32(), value);
    }
  });

  it('writes negative int32 as ten bytes and reads them back', () => {
    const bytes = new Writer().int32(-1).finish();
    assert.equal(bytes.length, 10);
    assert.equal(new Reader(bytes).int32(), -1);
    assert.equal(new Reader(new Writer().int32(-2147483648).finish()).int32(), -2147483648);
  });

  it('zig-zags sint32 and sint64', () => {
    for (const value of [0, -1, 1, -2147483648, 2147483647]) {
      assert.equal(new Reader(new Writer().sint32(value).finish()).sint32(), value);
    }
    for (const value of [0n, -1n, 1n, -(2n ** 63n), 2n ** 63n - 1n]) {
      assert.equal(new Reader(new Writer().sint64(value).finish()).sint64(), value);
    }
    assert.deepEqual([...new Writer().sint32(-1).finish()], [1]);
  });

  it('round-trips 64-bit integers at their limits', () => {
    for (const value of [0n, 1n, 2n ** 32n, 2n ** 63n - 1n, -1n, -(2n ** 63n)]) {
      assert.equal(new Reader(new Writer().int64(value).finish()).int64(), value);
    }
    assert.equal(new Reader(new Writer().uint64(2n ** 64n - 1n).finish()).uint64(), 2n ** 64n - 1n);
  });

  it('accepts numbers and decimal strings for 64-bit fields', () => {
    assert.equal(new Reader(new Writer().int64(42).finish()).int64(), 42n);
    assert.equal(new Reader(new Writer().int64('-42').finish()).int64(), -42n);
    assert.throws(() => new Writer().int64(1.5), RangeError);
  });

  it('reads bool from any non-zero varint', () => {
    assert.equal(new Reader(new Writer().bool(true).finish()).bool(), true);
    assert.equal(new Reader(new Writer().bool(false).finish()).bool(), false);
    assert.equal(new Reader(new Uint8Array([0x80, 0x01])).bool(), true);
  });
});

describe('fixed-width values', () => {
  it('round-trips fixed and floating point values', () => {
    const writer = new Writer()
      .fixed32(0xdeadbeef)
      .sfixed32(-5)
      .fixed64(2n ** 64n - 1n)
      .sfixed64(-(2n ** 63n))
      .float(1.5)
      .double(-0.1);
    const reader = new Reader(writer.finish());
    assert.equal(reader.fixed32(), 0xdeadbeef);
    assert.equal(reader.sfixed32(), -5);
    assert.equal(reader.fixed64(), 2n ** 64n - 1n);
    assert.equal(reader.sfixed64(), -(2n ** 63n));
    assert.equal(reader.float(), 1.5);
    assert.equal(reader.double(), -0.1);
  });

  it('writes little endian', () => {
    assert.deepEqual([...new Writer().fixed32(1).finish()], [1, 0, 0, 0]);
  });
});

describe('strings and bytes', () => {
  it('round-trips unicode text', () => {
    const text = 'héllo 🌍 世界';
    assert.equal(new Reader(new Writer().string(text).finish()).string(), text);
  });

  it('keeps a leading byte order mark as data', () => {
    const text = '﻿abc';
    assert.equal(new Reader(new Writer().string(text).finish()).string(), text);
  });

  it('replaces a lone surrogate with U+FFFD when writing', () => {
    assert.equal(new Reader(new Writer().string('a\ud800b').finish()).string(), 'a�b');
  });

  it('decodes invalid UTF-8 leniently and rejects it strictly', () => {
    const bytes = new Writer().bytes(new Uint8Array([0x61, 0xff])).finish();
    assert.equal(new Reader(bytes).string(), 'a�');
    assert.equal(
      decodeCode(() => new Reader(bytes).stringStrict()),
      DecodeErrorCode.InvalidUtf8,
    );
  });

  it('returns bytes that do not share memory with the input', () => {
    const input = new Writer().bytes(new Uint8Array([1, 2, 3])).finish();
    const copy = new Reader(input).bytes();
    input[1] = 9;
    assert.deepEqual([...copy], [1, 2, 3]);
  });
});

describe('length-delimited blocks', () => {
  it('shifts the content when the length needs more than one byte', () => {
    const payload = new Uint8Array(300).fill(7);
    const writer = new Writer().uint32(10).fork();
    writer.raw(payload);
    const bytes = writer.ldelim().finish();
    const reader = new Reader(bytes);
    assert.equal(reader.uint32(), 10);
    assert.equal(reader.uint32(), 300);
    assert.equal(reader.pos + 300, bytes.length);
  });

  it('grows its buffer and still closes nested forks in order', () => {
    const writer = new Writer(16).fork().fork();
    writer.string('x'.repeat(500));
    const bytes = writer.ldelim().ldelim().finish();
    const reader = new Reader(bytes);
    const outer = reader.uint32();
    assert.equal(outer, bytes.length - reader.pos);
    assert.equal(reader.uint32(), reader.length - reader.pos);
    assert.equal(reader.string().length, 500);
  });

  it('rejects unbalanced forks', () => {
    assert.throws(() => new Writer().ldelim());
    assert.throws(() => new Writer().fork().finish());
  });
});

describe('malformed input', () => {
  it('reports truncation', () => {
    assert.equal(
      decodeCode(() => new Reader(new Uint8Array([0x80])).uint32()),
      DecodeErrorCode.Truncated,
    );
    assert.equal(
      decodeCode(() => new Reader(new Uint8Array([1, 2])).fixed32()),
      DecodeErrorCode.Truncated,
    );
    assert.equal(
      decodeCode(() => new Reader(new Uint8Array([5, 1])).bytes()),
      DecodeErrorCode.Truncated,
    );
  });

  it('rejects varints longer than ten bytes', () => {
    const bytes = new Uint8Array(11).fill(0xff);
    assert.equal(
      decodeCode(() => new Reader(bytes).uint32()),
      DecodeErrorCode.MalformedVarint,
    );
    assert.equal(
      decodeCode(() => new Reader(bytes).uint64()),
      DecodeErrorCode.MalformedVarint,
    );
  });

  it('rejects field number zero and unknown wire types', () => {
    assert.equal(
      decodeCode(() => new Reader(new Uint8Array([0])).skipField(0)),
      DecodeErrorCode.InvalidTag,
    );
    assert.equal(
      decodeCode(() => new Reader(new Uint8Array([0])).skipType(7)),
      DecodeErrorCode.InvalidWireType,
    );
  });

  it('detects a field that overruns its region', () => {
    const reader = new Reader(new Uint8Array([1, 2, 3, 4]));
    reader.fixed32();
    assert.equal(
      decodeCode(() => reader.checkEnd(2)),
      DecodeErrorCode.LengthOverrun,
    );
  });
});

describe('skipping', () => {
  it('skips every wire type including nested groups', () => {
    const writer = new Writer()
      .uint32((1 << 3) | WireType.Varint)
      .uint32(300)
      .uint32((2 << 3) | WireType.Fixed64)
      .fixed64(1n)
      .uint32((3 << 3) | WireType.LengthDelimited)
      .string('abc')
      .uint32((4 << 3) | WireType.StartGroup)
      .uint32((1 << 3) | WireType.Varint)
      .uint32(1)
      .uint32((5 << 3) | WireType.StartGroup)
      .uint32((5 << 3) | WireType.EndGroup)
      .uint32((4 << 3) | WireType.EndGroup)
      .uint32((6 << 3) | WireType.Fixed32)
      .fixed32(1);
    const bytes = writer.finish();
    const reader = new Reader(bytes);
    while (reader.pos < bytes.length) {
      reader.skipField(reader.uint32());
    }
    assert.equal(reader.pos, bytes.length);
  });

  it('rejects a group closed with the wrong field number', () => {
    const bytes = new Writer()
      .uint32((1 << 3) | WireType.StartGroup)
      .uint32((2 << 3) | WireType.EndGroup)
      .finish();
    const reader = new Reader(bytes);
    assert.equal(
      decodeCode(() => reader.skipField(reader.uint32())),
      DecodeErrorCode.UnexpectedEndGroup,
    );
  });
});
