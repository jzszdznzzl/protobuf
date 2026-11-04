<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/jzszdznzzl/protobuf/main/assets/logo-dark.svg">
  <img alt="protobuf" src="https://raw.githubusercontent.com/jzszdznzzl/protobuf/main/assets/logo-light.svg" width="400">
</picture>

**Protobuf schemas in, typed TypeScript and JavaScript out.**
<br>
A code generator and runtime for Node.js: no `protoc` installation required.

[![npm](https://img.shields.io/npm/v/@jzszdznzzl/protobuf?color=4f46e5&label=npm)](https://www.npmjs.com/package/@jzszdznzzl/protobuf)
[![license](https://img.shields.io/badge/license-MIT-0891b2)](./LICENSE)
![node](https://img.shields.io/badge/node-%E2%89%A524-339933?logo=nodedotjs&logoColor=white)
![types](https://img.shields.io/badge/types-included-3178c6?logo=typescript&logoColor=white)
![protobuf](https://img.shields.io/badge/protobuf-proto2%20%7C%20proto3%20%7C%20editions-6750a4)
![esm](https://img.shields.io/badge/module-ESM%20only-f7df1e)

**English** · [Español](./README.es.md)

</div>

---

## Why protobuf?

Protocol Buffers let applications exchange compact, structured messages from a shared schema.
This package turns those schemas into readable ES modules you can use directly in your Node.js
project, whether you prefer TypeScript or JavaScript.

## Features

- 🧩 **One schema, two outputs.** Generate TypeScript or JavaScript with declaration files.
- 🛠️ **No `protoc` setup.** Use the `pb` CLI or call the generator from your code.
- 📦 **Built-in Google types.** Import bundled well-known, API and common types without an include path.
- 🔄 **Binary and JSON.** Encode and decode protobuf wire format and use canonical protobuf JSON.
- 🛡️ **Explicit errors.** Malformed binary input and invalid JSON return a `Result`.
- 🧮 **Precise integers.** 64-bit integer fields use `bigint`.
- 🧱 **Modern modules.** Generated TypeScript uses top-level declarations, without TypeScript namespaces or enums.
- 🧰 **Protocol features.** Supports proto2, proto3, editions, maps, oneofs, extensions, groups, unknown fields and service descriptors.

## Install

```bash
pnpm add @jzszdznzzl/protobuf
```

The generated code imports its runtime from `@jzszdznzzl/protobuf/runtime`, so the package must
also be a dependency of the project that uses the generated files.

## Quick start

```proto
// user.proto
syntax = "proto3";
package demo;

message User {
  string name = 1;
  repeated string tags = 2;
  int64 id = 3;
}
```

```bash
pnpm exec pb -o src/gen -I . user.proto
```

```ts
import { User } from './gen/user.ts';

const user = new User({ name: 'Ada', tags: ['math'], id: 1n });

const bytes = User.encode(user).finish();
const decoded = User.decode(bytes);

if (decoded.error === null) {
  console.log(decoded.data.name); // "Ada"
} else {
  console.error(decoded.error.code); // e.g. "truncated"
}

JSON.stringify(user); // {"name":"Ada","tags":["math"],"id":"1"}
```

## CLI

```text
pb [options] <file.proto ...>
```

| Option                      | Description                                                                  |
| --------------------------- | ---------------------------------------------------------------------------- |
| `-o`, `--ts-out <dir>`      | Folder for the `.ts` files                                                   |
| `--js-out <dir>`            | Folder for the `.js` and `.d.ts` files                                       |
| `-I`, `--proto-path <dir>`  | Directory to search for imports (repeatable)                                 |
| `--no-declarations`         | Do not generate `.d.ts` next to the JavaScript output                        |
| `--keep-case`               | Keep `snake_case` field names                                                |
| `--import-extension <ext>`  | Extension of relative imports in the `.ts` output: `ts` (default) or `js`    |
| `--runtime-import <module>` | Module the runtime is imported from (default `@jzszdznzzl/protobuf/runtime`) |
| `--file-suffix <suffix>`    | `foo.proto` becomes `foo<suffix>.ts`                                         |
| `--no-comments`             | Do not copy `.proto` comments as JSDoc                                       |
| `--no-services`             | Do not generate service interfaces                                           |
| `--no-unknown-fields`       | Do not keep unknown fields when decoding                                     |
| `--no-json`                 | Do not generate `toJSON()` / `fromJSON()`                                    |
| `--only-inputs`             | Generate only the given files, not their imports                             |

At least one of `--ts-out` and `--js-out` is required. The Google well-known types
(`google/protobuf/*`, `google/type/*`, `google/api/*`) are bundled, so they can be imported
without `-I`.

## Generated code

Every `.proto` file becomes one module. All declarations are top-level exports, and nested types
are flattened with their parents: `Outer.Inner` becomes `Outer_Inner`.

| `.proto`               | Generated                                                                   |
| ---------------------- | --------------------------------------------------------------------------- |
| `message Foo`          | `class Foo` and `interface FooInit` (every field optional and nullable)     |
| `enum Color`           | `const Color` (frozen object) and `type Color` (union of the values)        |
| closed enum (proto2)   | also `isKnownColor(value)`, a type guard                                    |
| `oneof pick`           | a `pick` getter returning the name of the assigned member                   |
| `map<K, V>`            | `Map<K, V>`                                                                 |
| `int64`, `uint64`, ... | `bigint`                                                                    |
| `service Greeter`      | `interface Greeter` and `GreeterDefinition`, a descriptor for any transport |
| `extend Foo { ... }`   | `Extension` constants with `get`, `set`, `has` and `clear`                  |

Open enums (proto3) are typed as `number`, because any number may arrive on the wire.

### Message API

```ts
new Foo(init?: FooInit)

Foo.encode(message: FooInit, writer?: Writer): Writer
Foo.encodeDelimited(message: FooInit, writer?: Writer): Writer
Foo.decode(input: Uint8Array): Result<Foo, DecodeError>
Foo.decodeDelimited(input: Uint8Array): Result<Foo, DecodeError>
Foo.fromJSON(json: unknown, options?: ReadOptions): Result<Foo, JsonError>

foo.toJSON(options?: WriteOptions): Value
Foo.typeName // "pkg.Foo"
```

`Foo.read(reader)` and `Foo.readJSON(json)` are the same operations but throw `DecodeError` /
`JsonError`. They are the building blocks for code that handles errors elsewhere.

### Errors

Decoding and JSON parsing return a `Result`, so the compiler makes callers handle the failure:

```ts
type Result<T, E> = { data: T; error: null } | { data: null; error: E };
```

`DecodeError.code` is one of `truncated`, `malformed_varint`, `invalid_tag`, `invalid_wire_type`,
`invalid_utf8`, `length_overrun`, `unterminated_group`, `unexpected_end_group`,
`missing_required_field` and `wrong_message_type`. `JsonError.code` is one of `invalid_type`,
`invalid_value`, `out_of_range`, `unknown_field`, `unknown_enum_value`, `unregistered_type`,
`conflicting_oneof` and `unrepresentable`.

Encoding a message that lacks a `required` proto2 field throws: it is a programming error.

### JSON

`toJSON` and `fromJSON` follow the canonical protobuf JSON mapping: 64-bit integers are decimal
strings, `bytes` is base64 (standard or URL-safe when reading), enums are names, and the
well-known types use their special forms. `fromJSON` accepts both `fieldName` and `field_name`.

```ts
Kitchen.fromJSON({ nope: 1 }); // error.code === "unknown_field"
Kitchen.fromJSON({ nope: 1 }, { ignoreUnknownFields: true }); // ok
```

`google.protobuf.Any` needs the packed type to be loaded, since modules register themselves when
imported.

## Library API

```ts
import { generate, writeOutput } from '@jzszdznzzl/protobuf';

const result = generate({
  files: ['user.proto'],
  protoPaths: ['.'],
  js: {}, // also produce .js and .d.ts
});

if (result.error !== null) {
  console.error(result.error.code, result.error.message); // a ProtoError
} else {
  writeOutput('src/gen', result.data.ts);
  writeOutput('dist/gen', result.data.js ?? []);
}
```

`generate` returns a `Result<GenerateResult, ProtoError>`: syntax errors, missing imports,
unresolved types and invalid options are returned, never thrown. `generateFromSources` does the
same from in-memory strings, and `GenerateOptions` accepts the same switches as the CLI
(`shouldKeepCase`, `importExtension`, `runtimeImport`, `fileSuffix`, `shouldIncludeComments`,
`shouldGenerateServices`, `shouldKeepUnknownFields`, `shouldGenerateJson`).

## Development

Requires Node.js 24 or newer and pnpm 12 or newer.

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The sources run directly on Node.js, so tests need no build step. Contributions follow
[AGENTS.md](./AGENTS.md) and [CONTRIBUTING.md](./CONTRIBUTING.md).

`pnpm update:protos` refreshes the bundled Google `.proto` files from pinned revisions.

---

<div align="center">
  <a href="./LICENSE"><img src="https://raw.githubusercontent.com/jzszdznzzl/protobuf/main/assets/license-mit.svg" alt="MIT License" width="72"></a>
  <br>
  <strong><a href="./LICENSE">MIT License</a></strong>
  <br>
  © 2026 José Daniel Cristaldo Vera<br>Bundled <code>.proto</code> files retain their own licenses; see <a href="./protos/">protos/</a>.
</div>
