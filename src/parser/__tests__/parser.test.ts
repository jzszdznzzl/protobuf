import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { FieldLabel, OptionValueKind, Syntax } from '../../ast/types.ts';
import { ProtoError, ProtoErrorCode } from '../../errors.ts';
import { parseProto } from '../parser.ts';

const syntaxMessage = (source: string): string => {
  try {
    parseProto(source, 'test.proto');
  } catch (error) {
    if (error instanceof ProtoError && error.code === ProtoErrorCode.Syntax) {
      return error.message;
    }
    throw error;
  }
  return '';
};

describe('proto3', () => {
  const file = parseProto(
    `syntax = "proto3";
package demo.v1;
import "other.proto";
import public "pub.proto";
option java_package = "x";

// A user.
message User {
  // The name.
  string name = 1; // trailing
  repeated int32 ids = 2 [packed = false];
  map<string, Address> addresses = 3;
  optional bool active = 4;
  oneof contact { string email = 5; string phone = 6; }
  reserved 10 to 12, 20;
  reserved "old";
  message Address { string city = 1; }
  enum Role { ROLE_NONE = 0; ADMIN = 1; }
}

service Users { rpc Get (User) returns (stream User); }
`,
    'user.proto',
  );

  it('reads the header', () => {
    assert.equal(file.syntax, Syntax.Proto3);
    assert.equal(file.package, 'demo.v1');
    assert.deepEqual(file.imports, [
      { path: 'other.proto' },
      { path: 'pub.proto', modifier: 'public' },
    ]);
    assert.equal(file.options[0]?.name, 'java_package');
  });

  it('reads fields, maps, oneofs and nested declarations', () => {
    const user = file.messages[0];
    assert.equal(user?.name, 'User');
    assert.deepEqual(
      user?.fields.map((f) => [f.name, f.number]),
      [
        ['name', 1],
        ['ids', 2],
        ['addresses', 3],
        ['active', 4],
        ['email', 5],
        ['phone', 6],
      ],
    );
    assert.deepEqual(user?.fields[2]?.map, { keyType: 'string', valueType: 'Address' });
    assert.equal(user?.fields[3]?.label, FieldLabel.Optional);
    assert.equal(user?.fields[4]?.oneOfIndex, 0);
    assert.deepEqual(user?.reservedRanges, [
      { from: 10, to: 12 },
      { from: 20, to: 20 },
    ]);
    assert.deepEqual(user?.reservedNames, ['old']);
    assert.equal(user?.messages[0]?.name, 'Address');
    assert.equal(user?.enums[0]?.values[1]?.name, 'ADMIN');
  });

  it('keeps comments as leading and trailing text', () => {
    const user = file.messages[0];
    assert.equal(user?.comment, 'A user.');
    assert.equal(user?.fields[0]?.comment, 'The name.');
    assert.equal(user?.fields[1]?.comment, undefined);
  });

  it('reads services with streaming', () => {
    const rpc = file.services[0]?.methods[0];
    assert.equal(rpc?.isRequestStream, false);
    assert.equal(rpc?.isResponseStream, true);
  });
});

describe('proto2', () => {
  it('reads labels, defaults, groups and extensions', () => {
    const file = parseProto(
      `message M {
  required int32 a = 1;
  optional string s = 2 [default = "a\\x41\\u00e9\\n"];
  optional group G = 3 { optional int32 z = 1; }
  extensions 100 to max;
}
extend M { optional int32 e = 100; }`,
      'p2.proto',
    );
    const message = file.messages.find((m) => m.name === 'M');
    assert.equal(file.syntax, Syntax.Proto2);
    assert.equal(message?.fields[0]?.label, FieldLabel.Required);
    const option = message?.fields[1]?.options[0]?.value;
    assert.equal(option?.kind, OptionValueKind.String);
    if (option?.kind === OptionValueKind.String) {
      assert.equal(option.value, 'aAé\n');
      assert.deepEqual(option.bytes, [0x61, 0x41, 0xc3, 0xa9, 0x0a]);
    }
    assert.equal(message?.fields[2]?.group?.isGroup, true);
    assert.equal(message?.extensionRanges[0]?.from, 100);
    assert.equal(file.extends[0]?.fields[0]?.name, 'e');
  });

  it('requires a label on fields', () => {
    assert.match(syntaxMessage('message M { int32 a = 1; }'), /fields require a label/);
  });
});

describe('editions', () => {
  it('accepts supported editions and visibility modifiers', () => {
    const file = parseProto(
      'edition = "2024";\nexport message M { int32 a = 1; }\nlocal enum E { A = 0; }',
      'e.proto',
    );
    assert.equal(file.edition, '2024');
    assert.equal(file.messages[0]?.name, 'M');
    assert.equal(file.enums[0]?.name, 'E');
  });

  it('rejects unknown editions', () => {
    assert.match(syntaxMessage('edition = "1999";'), /Unsupported edition '1999'/);
  });
});

describe('literals', () => {
  it('reads decimal, hex and octal field numbers', () => {
    const file = parseProto(
      'syntax = "proto3"; message M { int32 a = 0x10; int32 b = 010; }',
      'n.proto',
    );
    assert.deepEqual(
      file.messages[0]?.fields.map((f) => f.number),
      [16, 8],
    );
  });

  it('reads signed, float and special option values', () => {
    const file = parseProto(
      'syntax = "proto2"; message M { optional double d = 1 [default = -inf]; optional float f = 2 [default = 1.5e1f]; optional bool b = 3 [default = true]; }',
      'v.proto',
    );
    const [d, f, b] = file.messages[0]?.fields.map((field) => field.options[0]?.value) ?? [];
    assert.deepEqual(d, { kind: OptionValueKind.Number, value: -Infinity, raw: '-inf' });
    assert.deepEqual(f, { kind: OptionValueKind.Number, value: 15, raw: '1.5e1f' });
    assert.deepEqual(b, { kind: OptionValueKind.Bool, value: true });
  });

  it('strips a byte order mark', () => {
    assert.equal(parseProto('﻿syntax = "proto3";', 'bom.proto').syntax, Syntax.Proto3);
  });
});

describe('errors', () => {
  it('reports the file, line and column', () => {
    assert.match(
      syntaxMessage('syntax = "proto3";\nmessage M {\n  int32 a 1;\n}'),
      /^test\.proto:3:\d+: Expected '=' but found '1'/,
    );
  });

  it('rejects proto3 restrictions', () => {
    assert.match(
      syntaxMessage('syntax = "proto3"; message M { required int32 a = 1; }'),
      /'required' is not allowed in proto3/,
    );
    assert.match(syntaxMessage('syntax = "proto3"; enum E { A = 1; }'), /must be 0/);
    assert.match(
      syntaxMessage('syntax = "proto3"; message M { optional group G = 1 {} }'),
      /'group' is not allowed in proto3/,
    );
  });

  it('rejects bad numbers, unterminated input and bad escapes', () => {
    assert.match(
      syntaxMessage('syntax = "proto3"; message M { int32 a = 19000; }'),
      /Invalid field number 19000/,
    );
    assert.match(
      syntaxMessage('syntax = "proto3"; message M { int32 a = 0; }'),
      /Invalid field number 0/,
    );
    assert.match(syntaxMessage('syntax = "proto3"; message M {'), /Unterminated message/);
    assert.match(syntaxMessage('syntax = "proto3"; option x = "abc'), /Unterminated string/);
    assert.match(syntaxMessage('syntax = "proto3"; option x = "\\q";'), /Invalid escape/);
    assert.match(syntaxMessage('/* never closed'), /Unterminated block comment/);
    assert.match(syntaxMessage('syntax = "proto3"; $'), /Unexpected character '\$'/);
  });

  it('carries a code and position on the error object', () => {
    try {
      parseProto('message {', 'x.proto');
      assert.fail('expected a ProtoError');
    } catch (error) {
      assert.ok(error instanceof ProtoError);
      assert.equal(error.code, ProtoErrorCode.Syntax);
      assert.equal(error.fileName, 'x.proto');
      assert.equal(error.position?.line, 1);
    }
  });
});
