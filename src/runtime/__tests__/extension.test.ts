import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DecodeErrorCode } from '../errors.ts';
import { Extension, RepeatedExtension } from '../extension.ts';
import type { Extendable } from '../extension.ts';
import { WireType } from '../wire-type.ts';

const NUMBER = 100;

const singular = new Extension<number>('test.Base', 'test.number', {
  number: NUMBER,
  wireType: WireType.Varint,
  isPackable: true,
  read: (reader) => reader.int32(),
  write: (writer, value) => {
    writer.int32(value);
  },
});

const repeated = (isPacked: boolean): RepeatedExtension<number> =>
  new RepeatedExtension<number>('test.Base', 'test.numbers', {
    number: NUMBER + 1,
    wireType: WireType.Varint,
    isPackable: true,
    isPacked,
    read: (reader) => reader.int32(),
    write: (writer, value) => {
      writer.int32(value);
    },
  });

describe('Extension', () => {
  it('stores the value as an unknown field and reads it back', () => {
    const message: Extendable = {};
    assert.equal(singular.has(message), false);
    singular.set(message, 42);
    assert.equal(singular.has(message), true);
    assert.deepEqual(singular.get(message), { data: 42, error: null });
  });

  it('replaces the previous value and removes it on undefined', () => {
    const message: Extendable = {};
    singular.set(message, 1);
    singular.set(message, 2);
    assert.equal(message.$unknown?.length, 1);
    assert.equal(singular.get(message).data, 2);
    singular.set(message, undefined);
    assert.equal(message.$unknown, undefined);
    assert.equal(singular.get(message).data, undefined);
  });

  it('keeps other unknown fields when clearing', () => {
    const other = new Uint8Array([0x08, 0x01]);
    const message: Extendable = { $unknown: [other] };
    singular.set(message, 5);
    singular.clear(message);
    assert.deepEqual(message.$unknown, [other]);
  });

  it('lets the last occurrence win', () => {
    const first: Extendable = {};
    const second: Extendable = {};
    singular.set(first, 1);
    singular.set(second, 2);
    const merged: Extendable = {
      $unknown: [...(first.$unknown ?? []), ...(second.$unknown ?? [])],
    };
    assert.equal(singular.get(merged).data, 2);
  });

  it('reports malformed stored bytes instead of throwing', () => {
    // Tag for field 100 (varint) followed by a varint that never ends.
    const message: Extendable = { $unknown: [new Uint8Array([0xa0, 0x06, 0x80])] };
    const { data, error } = singular.get(message);
    assert.equal(data, null);
    assert.equal(error?.code, DecodeErrorCode.Truncated);
  });
});

describe('RepeatedExtension', () => {
  it('writes unpacked elements one chunk each', () => {
    const extension = repeated(false);
    const message: Extendable = {};
    extension.set(message, [1, 2, 3]);
    assert.equal(message.$unknown?.length, 3);
    assert.deepEqual(extension.get(message).data, [1, 2, 3]);
  });

  it('writes packed elements in one chunk and reads both forms', () => {
    const packed = repeated(true);
    const message: Extendable = {};
    packed.set(message, [1, 2, 3]);
    assert.equal(message.$unknown?.length, 1);
    assert.deepEqual(packed.get(message).data, [1, 2, 3]);
    assert.deepEqual(repeated(false).get(message).data, [1, 2, 3]);
  });

  it('returns an empty list when absent and stores nothing for an empty list', () => {
    const extension = repeated(true);
    const message: Extendable = {};
    assert.deepEqual(extension.get(message).data, []);
    extension.set(message, []);
    assert.equal(message.$unknown, undefined);
  });
});
