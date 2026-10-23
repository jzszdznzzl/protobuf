import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { JsonError, JsonErrorCode } from '../errors.ts';
import * as Json from '../json.ts';

const jsonCode = (run: () => unknown): string | undefined => {
  try {
    run();
  } catch (error) {
    return error instanceof JsonError ? error.code : undefined;
  }
  return undefined;
};

const COLOR = Object.freeze({ UNSPECIFIED: 0, RED: 1, CRIMSON: 1, GREEN: 2 } as const);

describe('integers', () => {
  it('reads numbers and decimal strings', () => {
    assert.equal(Json.int64('9223372036854775807', 'f'), 2n ** 63n - 1n);
    assert.equal(Json.int64(-5, 'f'), -5n);
    assert.equal(Json.int32('1e3', 'f'), 1000);
    assert.equal(Json.uint32('4294967295', 'f'), 4294967295);
  });

  it('rejects fractions, garbage and out-of-range values', () => {
    assert.equal(
      jsonCode(() => Json.int32(1.5, 'f')),
      JsonErrorCode.InvalidValue,
    );
    assert.equal(
      jsonCode(() => Json.int32('abc', 'f')),
      JsonErrorCode.InvalidValue,
    );
    assert.equal(
      jsonCode(() => Json.int32(2 ** 31, 'f')),
      JsonErrorCode.OutOfRange,
    );
    assert.equal(
      jsonCode(() => Json.uint64('-1', 'f')),
      JsonErrorCode.OutOfRange,
    );
    assert.equal(
      jsonCode(() => Json.int64('9223372036854775808', 'f')),
      JsonErrorCode.OutOfRange,
    );
  });
});

describe('floating point', () => {
  it('maps non-finite values to strings and back', () => {
    assert.equal(Json.doubleOut(Number.NaN), 'NaN');
    assert.equal(Json.doubleOut(-Infinity), '-Infinity');
    assert.ok(Number.isNaN(Json.double('NaN', 'f')));
    assert.equal(Json.double('Infinity', 'f'), Infinity);
    assert.equal(Json.double('1.5e2', 'f'), 150);
  });

  it('rejects non-finite JSON numbers and bad strings', () => {
    assert.equal(
      jsonCode(() => Json.double(Infinity, 'f')),
      JsonErrorCode.OutOfRange,
    );
    assert.equal(
      jsonCode(() => Json.double('x', 'f')),
      JsonErrorCode.InvalidValue,
    );
  });

  it('writes floats with the shortest form that maps back to the same value', () => {
    assert.equal(Json.floatOut(Math.fround(0.1)), 0.1);
    assert.equal(Json.floatOut(3.4028234663852886e38), 3.4028235e38);
    assert.equal(Json.float(3.4028235e38, 'f'), 3.4028234663852886e38);
    assert.equal(
      jsonCode(() => Json.float(1e39, 'f')),
      JsonErrorCode.OutOfRange,
    );
  });
});

describe('bytes', () => {
  it('encodes and decodes standard base64', () => {
    assert.equal(Json.bytesOut(new Uint8Array([1, 2, 3])), 'AQID');
    assert.deepEqual([...Json.bytes('AQID', 'f')], [1, 2, 3]);
    assert.equal(Json.bytesOut(new Uint8Array([0xfb, 0xff])), '+/8=');
  });

  it('accepts the URL-safe alphabet and optional padding', () => {
    assert.deepEqual([...Json.bytes('-_8', 'f')], [0xfb, 0xff]);
    assert.deepEqual([...Json.bytes('+/8=', 'f')], [0xfb, 0xff]);
    assert.deepEqual([...Json.bytes('', 'f')], []);
  });

  it('only encodes the visible window of a view', () => {
    const view = new Uint8Array([9, 1, 2, 3, 9]).subarray(1, 4);
    assert.equal(Json.bytesOut(view), 'AQID');
  });

  it('rejects invalid characters and impossible lengths', () => {
    assert.equal(
      jsonCode(() => Json.bytes('A*ID', 'f')),
      JsonErrorCode.InvalidValue,
    );
    assert.equal(
      jsonCode(() => Json.bytes('AAAAA', 'f')),
      JsonErrorCode.InvalidValue,
    );
    assert.equal(
      jsonCode(() => Json.bytes(1, 'f')),
      JsonErrorCode.InvalidType,
    );
  });
});

describe('enums', () => {
  it('reads names and numbers, and writes the first declared alias', () => {
    assert.equal(Json.enumIn(COLOR, 'GREEN', 'f'), 2);
    assert.equal(Json.enumIn(COLOR, 7, 'f'), 7);
    assert.equal(Json.enumOut(COLOR, 1), 'RED');
    assert.equal(Json.enumOut(COLOR, 99), 99);
    assert.equal(Json.enumOut(COLOR, 2, { enumAsNumber: true }), 2);
  });

  it('fails on unknown names unless unknown values are ignored', () => {
    assert.equal(
      jsonCode(() => Json.enumIn(COLOR, 'BLUE', 'f')),
      JsonErrorCode.UnknownEnumValue,
    );
    assert.equal(Json.enumIn(COLOR, 'BLUE', 'f', { ignoreUnknownFields: true }), undefined);
  });

  it('treats undeclared numbers of a closed enum as unknown', () => {
    const isKnown = (value: number): value is 0 | 1 | 2 => value >= 0 && value <= 2;
    assert.equal(Json.closedEnumIn(COLOR, isKnown, 'RED', 'f'), 1);
    assert.equal(
      jsonCode(() => Json.closedEnumIn(COLOR, isKnown, 7, 'f')),
      JsonErrorCode.UnknownEnumValue,
    );
    assert.equal(
      Json.closedEnumIn(COLOR, isKnown, 7, 'f', { ignoreUnknownFields: true }),
      undefined,
    );
  });
});

describe('Timestamp', () => {
  it('writes RFC 3339 with the shortest fraction', () => {
    assert.equal(Json.timestampOut(1700000000n, 0), '2023-11-14T22:13:20Z');
    assert.equal(Json.timestampOut(1700000000n, 5_000_000), '2023-11-14T22:13:20.005Z');
    assert.equal(Json.timestampOut(1700000000n, 5_000), '2023-11-14T22:13:20.000005Z');
    assert.equal(Json.timestampOut(1700000000n, 5), '2023-11-14T22:13:20.000000005Z');
  });

  it('reads offsets and fractions', () => {
    assert.deepEqual(Json.timestampIn('2023-11-14T23:13:20.005+01:00'), [1700000000n, 5_000_000]);
    assert.deepEqual(Json.timestampIn('1970-01-01T00:00:00Z'), [0n, 0]);
    assert.deepEqual(Json.timestampIn('0001-01-01T00:00:00Z'), [-62135596800n, 0]);
  });

  it('rejects impossible dates and out-of-range seconds', () => {
    assert.equal(
      jsonCode(() => Json.timestampIn('2023-02-30T00:00:00Z')),
      JsonErrorCode.InvalidValue,
    );
    assert.equal(
      jsonCode(() => Json.timestampIn('yesterday')),
      JsonErrorCode.InvalidValue,
    );
    assert.equal(
      jsonCode(() => Json.timestampOut(253402300800n, 0)),
      JsonErrorCode.Unrepresentable,
    );
    assert.equal(
      jsonCode(() => Json.timestampOut(0n, 1_000_000_000)),
      JsonErrorCode.Unrepresentable,
    );
  });
});

describe('Duration', () => {
  it('round-trips signed durations', () => {
    assert.equal(Json.durationOut(3n, 1), '3.000000001s');
    assert.equal(Json.durationOut(-1n, -500_000_000), '-1.500s');
    assert.equal(Json.durationOut(0n, -1), '-0.000000001s');
    assert.deepEqual(Json.durationIn('-1.5s'), [-1n, -500_000_000]);
    assert.deepEqual(Json.durationIn('3s'), [3n, 0]);
  });

  it('rejects mixed signs, bad syntax and huge values', () => {
    assert.equal(
      jsonCode(() => Json.durationOut(1n, -1)),
      JsonErrorCode.Unrepresentable,
    );
    assert.equal(
      jsonCode(() => Json.durationIn('3')),
      JsonErrorCode.InvalidValue,
    );
    assert.equal(
      jsonCode(() => Json.durationIn('315576000001s')),
      JsonErrorCode.OutOfRange,
    );
  });
});

describe('FieldMask', () => {
  it('converts between snake_case paths and lowerCamelCase text', () => {
    assert.equal(Json.fieldMaskOut(['foo_bar', 'baz']), 'fooBar,baz');
    assert.deepEqual(Json.fieldMaskIn('fooBar,baz'), ['foo_bar', 'baz']);
    assert.deepEqual(Json.fieldMaskIn(''), []);
  });

  it('rejects paths that do not survive the round trip', () => {
    assert.equal(
      jsonCode(() => Json.fieldMaskOut(['fooBar'])),
      JsonErrorCode.Unrepresentable,
    );
    assert.equal(
      jsonCode(() => Json.fieldMaskIn('foo_bar')),
      JsonErrorCode.InvalidValue,
    );
  });
});

describe('Any', () => {
  const type: Json.MessageType = {
    typeName: 'test.Point',
    toJson: (bytes) => ({ x: bytes.length }),
    fromJson: (json) => new Uint8Array(Array.from({ length: Number(Json.object(json, 'p')['x']) })),
  };

  it('writes and reads registered types through their JSON form', () => {
    Json.registerType(type);
    const url = 'type.googleapis.com/test.Point';
    assert.deepEqual(Json.anyOut(url, new Uint8Array(3)), { '@type': url, x: 3 });
    const [readUrl, bytes] = Json.anyIn({ '@type': url, x: 2 });
    assert.equal(readUrl, url);
    assert.equal(bytes.length, 2);
  });

  it('uses the value key for types whose JSON is not an object', () => {
    Json.registerType({
      typeName: 'google.protobuf.Duration',
      toJson: () => '1s',
      fromJson: () => new Uint8Array([8, 1]),
    });
    const url = 'type.googleapis.com/google.protobuf.Duration';
    assert.deepEqual(Json.anyOut(url, new Uint8Array([8, 1])), { '@type': url, value: '1s' });
    assert.deepEqual([...Json.anyIn({ '@type': url, value: '1s' })[1]], [8, 1]);
  });

  it('maps the empty Any to the empty object', () => {
    assert.deepEqual(Json.anyOut('', new Uint8Array(0)), {});
    assert.deepEqual(Json.anyIn({}), ['', new Uint8Array(0)]);
  });

  it('fails for types nobody registered', () => {
    assert.equal(
      jsonCode(() => Json.anyOut('type.googleapis.com/test.Missing', new Uint8Array(0))),
      JsonErrorCode.UnregisteredType,
    );
    assert.equal(
      jsonCode(() => Json.anyOut('no-slash', new Uint8Array(1))),
      JsonErrorCode.InvalidValue,
    );
  });
});

describe('structure helpers', () => {
  it('check the shape of objects and arrays', () => {
    assert.deepEqual(Json.object({ a: 1 }, 'f'), { a: 1 });
    assert.equal(
      jsonCode(() => Json.object([], 'f')),
      JsonErrorCode.InvalidType,
    );
    assert.equal(
      jsonCode(() => Json.object(null, 'f')),
      JsonErrorCode.InvalidType,
    );
    assert.deepEqual(Json.array([1], 'f'), [1]);
    assert.equal(
      jsonCode(() => Json.array({}, 'f')),
      JsonErrorCode.InvalidType,
    );
    assert.equal(
      jsonCode(() => Json.bool('true', 'f')),
      JsonErrorCode.InvalidType,
    );
    assert.equal(Json.boolKey('false', 'f'), false);
    assert.equal(
      jsonCode(() => Json.boolKey('yes', 'f')),
      JsonErrorCode.InvalidValue,
    );
  });
});
