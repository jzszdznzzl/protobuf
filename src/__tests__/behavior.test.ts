import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { after, describe, it } from 'node:test';

import { buildFixtures, moduleUrl } from './generated-fixtures.ts';

interface Failure {
  code: string;
  message: string;
}

interface Message {
  [property: string]: unknown;
  toJSON(options?: object): Record<string, unknown>;
}

interface Outcome {
  data: Message | null;
  error: Failure | null;
}

interface MessageClass {
  new (init?: object): Message;
  typeName: string;
  encode(message: object): { finish(): Uint8Array };
  encodeDelimited(message: object): { finish(): Uint8Array };
  decode(input: Uint8Array): Outcome;
  decodeDelimited(input: Uint8Array): Outcome;
  fromJSON(json: unknown, options?: object): Outcome;
}

interface Extension {
  get(message: object): { data: unknown; error: Failure | null };
  set(message: object, value: unknown): void;
  has(message: object): boolean;
}

interface AnyMessage extends Message {
  unpack(type: MessageClass): Outcome;
}

interface AnyClass {
  new (init?: object): AnyMessage;
  pack(type: MessageClass, message: object): AnyMessage;
}

interface KitchenModule {
  Kitchen: MessageClass;
  Kitchen_Inner: MessageClass;
  Color: Record<string, number>;
  GreeterDefinition: { name: string; methods: Record<string, Record<string, unknown>> };
}

interface LegacyModule {
  Legacy: MessageClass & { defaults: object };
  Legacy_Extra: MessageClass;
  Legacy_Mode: Record<string, number>;
  isKnownLegacy_Mode(value: number): boolean;
  weight: Extension;
  notes: Extension;
}

interface WellKnownModule {
  Any: AnyClass;
  Timestamp: MessageClass;
}

const fixtures = buildFixtures();
after(() => rmSync(fixtures.root, { recursive: true, force: true }));

const bytesOf = (type: MessageClass, init: object): number[] => [...type.encode(init).finish()];

const expectInstance = <T>(type: abstract new (...args: never[]) => T, value: unknown): T => {
  assert.ok(value instanceof type);
  return value;
};

const expectData = (outcome: Outcome): Message => {
  assert.equal(outcome.error, null, outcome.error?.message);
  assert.ok(outcome.data);
  return outcome.data;
};

for (const [label, directory, extension] of [
  ['TypeScript output', fixtures.tsDir, 'ts'],
  ['JavaScript output', fixtures.jsDir, 'js'],
] as const) {
  describe(label, async () => {
    const kitchen: KitchenModule = await import(moduleUrl(directory, `kitchen.${extension}`));
    const legacy: LegacyModule = await import(moduleUrl(directory, `legacy.${extension}`));
    const wellKnown: WellKnownModule = {
      ...(await import(moduleUrl(directory, `google/protobuf/any.${extension}`))),
      ...(await import(moduleUrl(directory, `google/protobuf/timestamp.${extension}`))),
    };
    const { Kitchen, Kitchen_Inner: Inner } = kitchen;
    const { Legacy } = legacy;

    describe('binary format', () => {
      it('matches the byte layout of the protobuf documentation', () => {
        assert.deepEqual(bytesOf(Kitchen, { i32: 150 }), [0x08, 0x96, 0x01]);
        assert.deepEqual(bytesOf(Kitchen, { text: 'testing' }), [
          0x6a,
          0x07,
          ...Buffer.from('testing'),
        ]);
      });

      it('omits default values in proto3 but writes explicit presence', () => {
        assert.deepEqual(bytesOf(Kitchen, {}), []);
        assert.deepEqual(bytesOf(Kitchen, { i32: 0, flag: false, text: '' }), []);
        assert.deepEqual(bytesOf(Kitchen, { maybe: 0 }), [0xd8, 0x01, 0x00]);
        assert.deepEqual(bytesOf(Kitchen, { dbl: -0 }).length > 0, true);
      });

      it('round-trips every scalar kind', () => {
        const init = {
          i32: -7,
          i64: -(2n ** 62n),
          u64: 2n ** 64n - 1n,
          s32: -123456,
          s64: -(2n ** 63n),
          f32: 4294967295,
          f64: 2n ** 64n - 1n,
          sf32: -5,
          sf64: -9n,
          flt: 0.5,
          dbl: Math.PI,
          flag: true,
          text: 'héllo 🌍',
          blob: new Uint8Array([0, 255, 7]),
          color: kitchen.Color['GREEN'],
        };
        const back = expectData(Kitchen.decode(Kitchen.encode(init).finish()));
        for (const [key, value] of Object.entries(init)) {
          assert.deepEqual(back[key], value, key);
        }
      });

      it('round-trips nested messages, lists, maps and oneofs', () => {
        const init = {
          inner: { name: 'one' },
          inners: [{ name: 'a' }, { name: 'b' }],
          numbers: [1, 2, 300, -1],
          tags: ['x', 'y'],
          byName: new Map([['k', { name: 'v' }]]),
          byId: new Map([[-5n, 'neg']]),
          flags: new Map([[true, kitchen.Color['RED']]]),
          c: { name: 'picked' },
        };
        const back = expectData(Kitchen.decode(Kitchen.encode(init).finish()));
        assert.ok(back['inner'] instanceof Inner);
        assert.deepEqual(back['numbers'], [1, 2, 300, -1]);
        assert.equal(back['pick'], 'c');
        // The canonical JSON is the easiest way to look inside lists and maps without casts.
        assert.deepEqual(back.toJSON(), {
          inner: { name: 'one' },
          inners: [{ name: 'a' }, { name: 'b' }],
          numbers: [1, 2, 300, -1],
          tags: ['x', 'y'],
          byName: { k: { name: 'v' } },
          byId: { '-5': 'neg' },
          flags: { true: 'RED' },
          c: { name: 'picked' },
        });
      });

      it('reads repeated numbers both packed and unpacked', () => {
        const packed = Uint8Array.from([0x9a, 0x01, 0x02, 0x01, 0x02]);
        const unpacked = Uint8Array.from([0x98, 0x01, 0x01, 0x98, 0x01, 0x02]);
        assert.deepEqual(expectData(Kitchen.decode(packed))['numbers'], [1, 2]);
        assert.deepEqual(expectData(Kitchen.decode(unpacked))['numbers'], [1, 2]);
      });

      it('keeps only the last member of a oneof', () => {
        const bytes = Uint8Array.from([
          ...bytesOf(Kitchen, { a: 'x' }),
          ...bytesOf(Kitchen, { b: 5 }),
        ]);
        const message = expectData(Kitchen.decode(bytes));
        assert.equal(message['pick'], 'b');
        assert.equal(message['a'], undefined);
        assert.equal(message['b'], 5);
      });

      it('merges a singular message that appears twice', () => {
        const bytes = Uint8Array.from([
          ...bytesOf(Kitchen, { inner: { name: 'first' } }),
          ...bytesOf(Kitchen, { inner: { name: 'second' } }),
        ]);
        assert.equal(
          expectInstance(Inner, expectData(Kitchen.decode(bytes))['inner'])['name'],
          'second',
        );
      });

      it('preserves unknown fields through decode and encode', () => {
        const unknown = [0xb8, 0x3e, 0x01];
        const bytes = Uint8Array.from([...bytesOf(Kitchen, { i32: 1 }), ...unknown]);
        const message = expectData(Kitchen.decode(bytes));
        assert.equal(message['i32'], 1);
        assert.deepEqual([...Kitchen.encode(message).finish()], [...bytes]);
      });

      it('supports length-delimited framing', () => {
        const framed = Kitchen.encodeDelimited({ i32: 150 }).finish();
        assert.deepEqual([...framed], [3, 0x08, 0x96, 0x01]);
        assert.equal(expectData(Kitchen.decodeDelimited(framed))['i32'], 150);
      });

      it('returns a Result with a code for malformed input', () => {
        assert.equal(Kitchen.decode(Uint8Array.from([0x0a, 0xff])).error?.code, 'truncated');
        assert.equal(
          Kitchen.decode(Uint8Array.from([0x6a, 0x01, 0xff])).error?.code,
          'invalid_utf8',
        );
        assert.equal(Kitchen.decode(Uint8Array.from([0x00])).error?.code, 'invalid_tag');
        assert.equal(Kitchen.decode(Uint8Array.from([0x0f])).error?.code, 'invalid_wire_type');
      });
    });

    describe('class behavior', () => {
      it('turns plain objects into instances and copies collections', () => {
        const tags = ['a'];
        const message = new Kitchen({ inner: { name: 'x' }, tags });
        assert.ok(message['inner'] instanceof Inner);
        tags.push('b');
        assert.deepEqual(message['tags'], ['a']);
      });

      it('exposes the type name and the service descriptor', () => {
        assert.equal(Kitchen.typeName, 'kitchen.Kitchen');
        assert.equal(Inner.typeName, 'kitchen.Kitchen.Inner');
        const { methods } = kitchen.GreeterDefinition;
        assert.equal(kitchen.GreeterDefinition.name, 'kitchen.Greeter');
        assert.equal(methods['say']?.['path'], '/kitchen.Greeter/Say');
        assert.equal(methods['say']?.['responseType'], Inner);
        assert.equal(methods['chat']?.['isRequestStream'], true);
      });
    });

    describe('JSON mapping', () => {
      const init = {
        i32: 5,
        i64: 2n ** 62n,
        flt: 1.5,
        dbl: Number.NaN,
        text: 'hi',
        blob: new Uint8Array([1, 2, 3]),
        color: 1,
        kind: 1,
        byName: new Map([['k', { name: 'v' }]]),
        byId: new Map([[7n, 'seven']]),
        b: 3,
        when: { seconds: 1700000000n, nanos: 5_000_000 },
        span: { seconds: -1n, nanos: -500_000_000 },
        mask: { paths: ['foo_bar'] },
        wrapped: { value: 9n },
      };

      it('writes the canonical form', () => {
        assert.deepEqual(new Kitchen(init).toJSON(), {
          i32: 5,
          i64: '4611686018427387904',
          flt: 1.5,
          dbl: 'NaN',
          text: 'hi',
          blob: 'AQID',
          color: 'RED',
          kind: 'KIND_B',
          byName: { k: { name: 'v' } },
          byId: { '7': 'seven' },
          b: 3,
          when: '2023-11-14T22:13:20.005Z',
          span: '-1.500s',
          mask: 'fooBar',
          wrapped: '9',
        });
      });

      it('omits defaults unless asked and can use proto names', () => {
        assert.deepEqual(new Kitchen().toJSON(), {});
        assert.equal(new Kitchen().toJSON({ emitDefaults: true })['i32'], 0);
        assert.deepEqual(
          new Kitchen({ byName: new Map([['k', {}]]) }).toJSON({ useProtoFieldName: true }),
          {
            by_name: { k: {} },
          },
        );
        assert.equal(new Kitchen({ color: 1 }).toJSON({ enumAsNumber: true })['color'], 1);
      });

      it('reads what it writes, accepting both field spellings', () => {
        const message = new Kitchen(init);
        const parsed = JSON.parse(JSON.stringify({ ...message.toJSON(), dbl: 1 }));
        const back = expectData(Kitchen.fromJSON(parsed));
        assert.equal(back['i64'], 2n ** 62n);
        assert.equal(back['color'], 1);
        assert.deepEqual(back['blob'], new Uint8Array([1, 2, 3]));
        assert.equal(expectInstance(wellKnown.Timestamp, back['when'])['seconds'], 1700000000n);
        assert.equal(
          expectData(Kitchen.fromJSON({ by_name: { k: {} } }))['byName'] instanceof Map,
          true,
        );
        assert.equal(expectData(Kitchen.fromJSON({ color: 'GREEN' }))['color'], 2);
        assert.equal(expectData(Kitchen.fromJSON({ i32: null }))['i32'], 0);
      });

      it('reports problems with a code instead of throwing', () => {
        assert.equal(Kitchen.fromJSON({ nope: 1 }).error?.code, 'unknown_field');
        assert.equal(Kitchen.fromJSON({ nope: 1 }, { ignoreUnknownFields: true }).error, null);
        assert.equal(Kitchen.fromJSON({ i32: 'x' }).error?.code, 'invalid_value');
        assert.equal(Kitchen.fromJSON({ i32: 2 ** 40 }).error?.code, 'out_of_range');
        assert.equal(Kitchen.fromJSON({ a: 'x', b: 1 }).error?.code, 'conflicting_oneof');
        assert.equal(Kitchen.fromJSON([]).error?.code, 'invalid_type');
        assert.equal(Kitchen.fromJSON({ color: 'PINK' }).error?.code, 'unknown_enum_value');
      });

      it('handles Struct and Value', () => {
        const json = { meta: { a: 1, b: [true, null, 'x'], c: { d: 'e' } } };
        const message = expectData(Kitchen.fromJSON(json));
        assert.deepEqual(message.toJSON(), json);
      });

      it('packs messages into Any and keeps them through JSON', () => {
        const { Any, Timestamp } = wellKnown;
        const any = Any.pack(Timestamp, { seconds: 10n, nanos: 0 });
        const message = new Kitchen({ any });
        const json = message.toJSON();
        assert.deepEqual(json, {
          any: {
            '@type': 'type.googleapis.com/google.protobuf.Timestamp',
            value: '1970-01-01T00:00:10Z',
          },
        });
        const back = expectData(Kitchen.fromJSON(json));
        const unpacked = expectInstance(Any, back['any']).unpack(Timestamp);
        assert.equal(expectData(unpacked)['seconds'], 10n);

        const wrong = any.unpack(Inner);
        assert.equal(wrong.error?.code, 'wrong_message_type');
      });
    });

    describe('proto2', () => {
      it('requires required fields when decoding and encoding', () => {
        assert.equal(Legacy.decode(new Uint8Array()).error?.code, 'missing_required_field');
        assert.throws(() => Legacy.encode({}), /missing required field 'id'/);
      });

      it('leaves optional fields unset and exposes the declared defaults', () => {
        const message = expectData(Legacy.decode(Legacy.encode({ id: 1 }).finish()));
        assert.equal(message['name'], undefined);
        assert.deepEqual(Legacy.defaults, { name: 'anon', mode: 1 });
      });

      it('keeps unknown values of closed enums as unknown fields', () => {
        const bytes = Uint8Array.from([0x08, 0x01, 0x18, 0x05, 0x20, 0x01, 0x20, 0x09]);
        const message = expectData(Legacy.decode(bytes));
        assert.equal(message['mode'], undefined);
        assert.deepEqual(message['modes'], [1]);
        assert.deepEqual([...Legacy.encode(message).finish()].sort(), [...bytes].sort());
        assert.equal(legacy.isKnownLegacy_Mode(1), true);
        assert.equal(legacy.isKnownLegacy_Mode(5), false);
      });

      it('writes unpacked by default and packed on request', () => {
        const bytes = bytesOf(Legacy, { id: 1, plain: [1, 2], packed: [1, 2] });
        assert.deepEqual(bytes, [0x08, 0x01, 0x28, 0x01, 0x28, 0x02, 0x32, 0x02, 0x01, 0x02]);
      });

      it('round-trips groups with start and end tags', () => {
        const bytes = bytesOf(Legacy, { id: 1, extra: { z: 3 } });
        assert.deepEqual(bytes, [0x08, 0x01, 0x3b, 0x08, 0x03, 0x3c]);
        const extra = expectInstance(
          legacy.Legacy_Extra,
          expectData(Legacy.decode(Uint8Array.from(bytes)))['extra'],
        );
        assert.equal(extra['z'], 3);
        assert.equal(
          Legacy.decode(Uint8Array.from([0x08, 0x01, 0x3b, 0x08, 0x03])).error?.code,
          'unterminated_group',
        );
      });

      it('stores extensions in the unknown fields', () => {
        const message = new Legacy({ id: 1 });
        assert.equal(legacy.weight.has(message), false);
        legacy.weight.set(message, 42);
        legacy.notes.set(message, ['a', 'b']);
        const back = expectData(Legacy.decode(Legacy.encode(message).finish()));
        assert.deepEqual(legacy.weight.get(back), { data: 42, error: null });
        assert.deepEqual(legacy.notes.get(back).data, ['a', 'b']);
      });
    });
  });
}
