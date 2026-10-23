import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ProtoError, ProtoErrorCode } from '../../errors.ts';
import { parseProto } from '../../parser/parser.ts';
import { resolveFiles } from '../resolver.ts';
import type { ResolveOptions } from '../resolver.ts';
import { Presence, ValueKind } from '../types.ts';

const resolve = (sources: Record<string, string>, options?: ResolveOptions) =>
  resolveFiles(
    Object.entries(sources).map(([name, source]) => parseProto(source, name)),
    options,
  );

const resolutionMessage = (source: string): string => {
  try {
    resolve({ 'a.proto': source });
  } catch (error) {
    if (error instanceof ProtoError && error.code === ProtoErrorCode.Resolution) {
      return error.message;
    }
    throw error;
  }
  return '';
};

describe('names', () => {
  const [file] = resolve({
    'a.proto': `syntax = "proto3";
package demo;
message Outer {
  message Inner { enum Kind { K_NONE = 0; } }
  enum Mode { M_NONE = 0; }
}
message Map { int32 x = 1; }
message value { int32 x = 1; }
message Outer_Inner { int32 x = 1; }`,
  }).files;

  it('flattens nested types with their parents', () => {
    assert.deepEqual(file?.messages.map((m) => m.tsName).slice(0, 2), ['Outer', 'Outer_Inner']);
    assert.deepEqual(
      file?.enums.map((e) => e.tsName),
      ['Outer_Mode', 'Outer_Inner_Kind'],
    );
    assert.equal(file?.messages[1]?.fullName, 'demo.Outer.Inner');
  });

  it('adds the init and guard names', () => {
    assert.equal(file?.messages[0]?.initName, 'OuterInit');
    assert.equal(file?.enums[1]?.guardName, 'isKnownOuter_Inner_Kind');
  });

  it('renames types that shadow globals or generated locals', () => {
    const names = file?.messages.map((m) => m.tsName);
    assert.ok(names?.includes('Map_'));
    assert.ok(names?.includes('value_'));
  });

  it('keeps flattened names unique', () => {
    const names = file?.messages.map((m) => m.tsName) ?? [];
    assert.equal(new Set(names).size, names.length);
    assert.ok(names.includes('Outer_Inner_2'));
  });
});

describe('fields', () => {
  it('computes presence for proto3 and proto2', () => {
    const { files } = resolve({
      'a.proto': `syntax = "proto3"; message M { int32 a = 1; optional int32 b = 2; M c = 3; repeated int32 d = 4; oneof o { int32 e = 5; } }`,
      'b.proto': `syntax = "proto2"; message N { required int32 a = 1; optional int32 b = 2; repeated int32 c = 3; repeated int32 d = 4 [packed = true]; }`,
    });
    const presence = (i: number) => files[i]?.messages[0]?.fields.map((f) => f.presence);
    assert.deepEqual(presence(0), [
      Presence.Implicit,
      Presence.Explicit,
      Presence.Explicit,
      Presence.Repeated,
      Presence.Explicit,
    ]);
    assert.deepEqual(presence(1), [
      Presence.Required,
      Presence.Explicit,
      Presence.Repeated,
      Presence.Repeated,
    ]);
  });

  it('packs repeated scalars by default in proto3 only', () => {
    const { files } = resolve({
      'a.proto':
        'syntax = "proto3"; message M { repeated int32 a = 1; repeated string s = 2; repeated int32 u = 3 [packed = false]; }',
      'b.proto':
        'syntax = "proto2"; message N { repeated int32 a = 1; repeated int32 p = 2 [packed = true]; }',
    });
    assert.deepEqual(
      files[0]?.messages[0]?.fields.map((f) => f.isPacked),
      [true, false, false],
    );
    assert.deepEqual(
      files[1]?.messages[0]?.fields.map((f) => f.isPacked),
      [false, true],
    );
  });

  it('converts names to camelCase unless asked to keep them', () => {
    const source = { 'a.proto': 'syntax = "proto3"; message M { int32 field_name = 1; }' };
    assert.equal(resolve(source).files[0]?.messages[0]?.fields[0]?.tsName, 'fieldName');
    assert.equal(
      resolve(source, { shouldKeepCase: true }).files[0]?.messages[0]?.fields[0]?.tsName,
      'field_name',
    );
    assert.equal(resolve(source).files[0]?.messages[0]?.fields[0]?.jsonName, 'fieldName');
  });

  it('resolves types across files and scopes', () => {
    const { files } = resolve({
      'dep.proto': 'syntax = "proto3"; package dep; message Thing { int32 x = 1; }',
      'a.proto':
        'syntax = "proto3"; package a; import "dep.proto"; message M { dep.Thing t = 1; .dep.Thing u = 2; }',
    });
    const [t, u] = files[1]?.messages[0]?.fields ?? [];
    assert.equal(t?.type.kind, ValueKind.Message);
    assert.equal(
      u?.type.kind === ValueKind.Message ? u.type.message.file.fileName : '',
      'dep.proto',
    );
  });

  it('treats proto2 enums as closed and proto3 enums as open', () => {
    const { files } = resolve({
      'a.proto': 'syntax = "proto3"; enum E { A = 0; }',
      'b.proto': 'syntax = "proto2"; enum F { A = 0; }',
    });
    assert.equal(files[0]?.enums[0]?.isClosed, false);
    assert.equal(files[1]?.enums[0]?.isClosed, true);
  });

  it('marks messages used with delimited encoding', () => {
    const { files } = resolve({
      'a.proto': 'syntax = "proto2"; message M { optional group G = 1 { optional int32 z = 1; } }',
    });
    const group = files[0]?.messages.find((m) => m.fullName === 'M.G');
    assert.equal(group?.isGroup, true);
    assert.equal(group?.isUsedDelimited, true);
  });
});

describe('extensions and services', () => {
  it('names extensions after their enclosing message', () => {
    const { files } = resolve({
      'a.proto': `syntax = "proto2"; message Base { extensions 100 to 199; }
extend Base { optional int32 top_level = 100; }
message Holder { extend Base { optional int32 inside = 101; } }`,
    });
    assert.deepEqual(
      files[0]?.extensions.map((x) => x.tsName),
      ['Holder_inside', 'topLevel'],
    );
  });

  it('names the service definition and lowercases method names', () => {
    const { files } = resolve({
      'a.proto':
        'syntax = "proto3"; message R {} service Greeter { rpc SayHello (R) returns (R); }',
    });
    const service = files[0]?.services[0];
    assert.equal(service?.definitionName, 'GreeterDefinition');
    assert.equal(service?.methods[0]?.tsName, 'sayHello');
  });
});

describe('errors', () => {
  it('rejects unknown types', () => {
    assert.match(
      resolutionMessage('syntax = "proto3"; message M { Missing a = 1; }'),
      /unknown type 'Missing'/,
    );
  });

  it('rejects duplicated numbers, reserved names and reserved numbers', () => {
    assert.match(
      resolutionMessage('syntax = "proto3"; message M { int32 a = 1; int32 b = 1; }'),
      /number 1 is used by 'a' and 'b'/,
    );
    assert.match(
      resolutionMessage('syntax = "proto3"; message M { reserved "a"; int32 a = 1; }'),
      /name 'a' is reserved/,
    );
    assert.match(
      resolutionMessage('syntax = "proto3"; message M { reserved 1; int32 a = 1; }'),
      /number 1 is reserved/,
    );
  });

  it('rejects duplicated types and enum values without allow_alias', () => {
    assert.match(
      resolutionMessage('syntax = "proto3"; message M {} message M {}'),
      /Duplicate type 'M'/,
    );
    assert.match(resolutionMessage('syntax = "proto3"; enum E { A = 0; B = 0; }'), /allow_alias/);
  });

  it('rejects invalid map keys, defaults and extension numbers', () => {
    assert.match(
      resolutionMessage('syntax = "proto3"; message M { map<double, int32> m = 1; }'),
      /invalid map key type 'double'/,
    );
    assert.match(
      resolutionMessage('syntax = "proto3"; message M { int32 a = 1 [default = 1]; }'),
      /'default' is not allowed in proto3/,
    );
    assert.match(
      resolutionMessage(
        'syntax = "proto2"; message M { extensions 100 to 199; } extend M { optional int32 x = 5; }',
      ),
      /outside the extension ranges/,
    );
  });
});
