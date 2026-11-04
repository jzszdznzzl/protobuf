<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/jzszdznzzl/protobuf/main/assets/logo-dark.svg">
  <img alt="protobuf" src="https://raw.githubusercontent.com/jzszdznzzl/protobuf/main/assets/logo-light.svg" width="400">
</picture>

**Esquemas Protobuf de entrada, TypeScript y JavaScript tipados de salida.**
<br>
Un generador de código y runtime para Node.js: sin necesidad de instalar `protoc`.

[![npm](https://img.shields.io/npm/v/@jzszdznzzl/protobuf?color=4f46e5&label=npm)](https://www.npmjs.com/package/@jzszdznzzl/protobuf)
[![licencia](https://img.shields.io/badge/licencia-MIT-0891b2)](./LICENSE)
![node](https://img.shields.io/badge/node-%E2%89%A524-339933?logo=nodedotjs&logoColor=white)
![tipos](https://img.shields.io/badge/tipos-incluidos-3178c6?logo=typescript&logoColor=white)
![protobuf](https://img.shields.io/badge/protobuf-proto2%20%7C%20proto3%20%7C%20editions-6750a4)
![esm](https://img.shields.io/badge/m%C3%B3dulo-solo%20ESM-f7df1e)

[English](./README.md) · **Español**

</div>

---

## ¿Por qué protobuf?

Protocol Buffers permite que las aplicaciones intercambien mensajes compactos y estructurados a
partir de un esquema compartido. Este paquete transforma esos esquemas en módulos ES legibles que
puedes usar directamente en tu proyecto Node.js, tanto en TypeScript como en JavaScript.

## Características

- 🧩 **Un esquema, dos salidas.** Genera TypeScript o JavaScript con archivos de declaraciones.
- 🛠️ **Sin instalar `protoc`.** Usa el CLI `pb` o llama al generador desde tu código.
- 📦 **Tipos de Google incluidos.** Importa los tipos conocidos, de API y comunes incluidos, sin configurar una ruta de búsqueda.
- 🔄 **Binario y JSON.** Codifica y decodifica el formato binario de protobuf y usa su representación JSON canónica.
- 🛡️ **Errores explícitos.** Los datos binarios malformados y el JSON inválido devuelven un `Result`.
- 🧮 **Enteros precisos.** Los campos enteros de 64 bits usan `bigint`.
- 🧱 **Módulos modernos.** El TypeScript generado usa declaraciones de nivel superior, sin namespaces ni enums de TypeScript.
- 🧰 **Funciones del protocolo.** Compatible con proto2, proto3, editions, mapas, oneofs, extensiones, grupos, campos desconocidos y descriptores de servicios.

## Instalación

```bash
pnpm add @jzszdznzzl/protobuf
```

El código generado importa su runtime desde `@jzszdznzzl/protobuf/runtime`, por lo que el paquete
debe ser también una dependencia del proyecto que use los archivos generados. Requiere
Node.js 24 o posterior y solo admite módulos ESM.

## Primeros pasos

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
  console.error(decoded.error.code); // p. ej. "truncated"
}

JSON.stringify(user); // {"name":"Ada","tags":["math"],"id":"1"}
```

## CLI

```text
pb [opciones] <archivo.proto ...>
```

| Opción                      | Descripción                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------- |
| `-o`, `--ts-out <dir>`      | Carpeta para los archivos `.ts`                                                       |
| `--js-out <dir>`            | Carpeta para los archivos `.js` y `.d.ts`                                             |
| `-I`, `--proto-path <dir>`  | Directorio donde buscar importaciones (se puede repetir)                              |
| `--no-declarations`         | No generar archivos `.d.ts` junto a la salida JavaScript                              |
| `--keep-case`               | Conservar los nombres de campos en `snake_case`                                       |
| `--import-extension <ext>`  | Extensión de importaciones relativas en TypeScript: `ts` (predeterminado) o `js`      |
| `--runtime-import <module>` | Módulo del que se importa el runtime (predeterminado: `@jzszdznzzl/protobuf/runtime`) |
| `--file-suffix <suffix>`    | `foo.proto` se convierte en `foo<suffix>.ts`                                          |
| `--no-comments`             | No copiar los comentarios `.proto` como JSDoc                                         |
| `--no-services`             | No generar interfaces de servicios                                                    |
| `--no-unknown-fields`       | No conservar campos desconocidos al decodificar                                       |
| `--no-json`                 | No generar `toJSON()` / `fromJSON()`                                                  |
| `--only-inputs`             | Generar solo los archivos indicados, sin sus importaciones                            |

Se requiere al menos una de las opciones `--ts-out` o `--js-out`. Los tipos conocidos de Google
(`google/protobuf/*`, `google/type/*`, `google/api/*`) están incluidos, por lo que se pueden
importar sin `-I`.

## Código generado

Cada archivo `.proto` se convierte en un módulo. Todas las declaraciones se exportan en el nivel
superior y los tipos anidados se combinan con sus padres: `Outer.Inner` se convierte en
`Outer_Inner`.

| `.proto`               | Se genera                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `message Foo`          | `class Foo` e `interface FooInit` (todos los campos son opcionales y anulables)    |
| `enum Color`           | `const Color` (objeto congelado) y `type Color` (unión de los valores)             |
| enum cerrado (proto2)  | También `isKnownColor(value)`, una guarda de tipo                                  |
| `oneof pick`           | Un getter `pick` que devuelve el nombre del miembro asignado                       |
| `map<K, V>`            | `Map<K, V>`                                                                        |
| `int64`, `uint64`, ... | `bigint`                                                                           |
| `service Greeter`      | `interface Greeter` y `GreeterDefinition`, un descriptor para cualquier transporte |
| `extend Foo { ... }`   | Constantes `Extension` con `get`, `set`, `has` y `clear`                           |

Los enums abiertos (proto3) se tipan como `number`, porque puede llegar cualquier número por la red.

### API de mensajes

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

`Foo.read(reader)` y `Foo.readJSON(json)` realizan las mismas operaciones, pero lanzan
`DecodeError` o `JsonError`. Son las piezas para el código que maneja los errores en otro lugar.

### Errores

La decodificación y la lectura de JSON devuelven un `Result`, por lo que el compilador obliga a
manejar los fallos:

```ts
type Result<T, E> = { data: T; error: null } | { data: null; error: E };
```

`DecodeError.code` puede ser `truncated`, `malformed_varint`, `invalid_tag`, `invalid_wire_type`,
`invalid_utf8`, `length_overrun`, `unterminated_group`, `unexpected_end_group`,
`missing_required_field` o `wrong_message_type`. `JsonError.code` puede ser `invalid_type`,
`invalid_value`, `out_of_range`, `unknown_field`, `unknown_enum_value`, `unregistered_type`,
`conflicting_oneof` o `unrepresentable`.

Codificar un mensaje que no tiene un campo `required` de proto2 lanza un error, porque es un error
de programación.

### JSON

`toJSON` y `fromJSON` siguen la representación JSON canónica de protobuf: los enteros de 64 bits
son strings decimales, `bytes` usa base64 (estándar o seguro para URL al leer), los enums son
nombres y los tipos conocidos usan sus formatos especiales. `fromJSON` acepta tanto `fieldName`
como `field_name`.

```ts
Kitchen.fromJSON({ nope: 1 }); // error.code === "unknown_field"
Kitchen.fromJSON({ nope: 1 }, { ignoreUnknownFields: true }); // ok
```

`google.protobuf.Any` necesita que el tipo empaquetado esté cargado, ya que los módulos se
registran al importarse.

## API de la biblioteca

```ts
import { generate, writeOutput } from '@jzszdznzzl/protobuf';

const result = generate({
  files: ['user.proto'],
  protoPaths: ['.'],
  js: {}, // también produce .js y .d.ts
});

if (result.error !== null) {
  console.error(result.error.code, result.error.message); // un ProtoError
} else {
  writeOutput('src/gen', result.data.ts);
  writeOutput('dist/gen', result.data.js ?? []);
}
```

`generate` devuelve un `Result<GenerateResult, ProtoError>`: los errores de sintaxis,
importaciones ausentes, tipos sin resolver y opciones inválidas se devuelven como resultados.
`generateFromSources` hace lo mismo a partir de strings en memoria y `GenerateOptions` acepta las
mismas opciones que el CLI (`shouldKeepCase`, `importExtension`, `runtimeImport`, `fileSuffix`,
`shouldIncludeComments`, `shouldGenerateServices`, `shouldKeepUnknownFields`,
`shouldGenerateJson`).

## Desarrollo

Requiere Node.js 24 o posterior y pnpm 12 o posterior.

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Los archivos fuente corren directamente en Node.js, así que las pruebas no necesitan compilación
previa. Las contribuciones siguen [AGENTS.md](./AGENTS.md) y [CONTRIBUTING.md](./CONTRIBUTING.md).

`pnpm update:protos` actualiza los archivos `.proto` de Google incluidos desde revisiones fijadas.

---

<div align="center">
  <a href="./LICENSE"><img src="https://raw.githubusercontent.com/jzszdznzzl/protobuf/main/assets/license-mit.svg" alt="Licencia MIT" width="72"></a>
  <br>
  <strong><a href="./LICENSE">Licencia MIT</a></strong>
  <br>
  © 2026 José Daniel Cristaldo Vera<br>Los archivos <code>.proto</code> incluidos conservan sus propias licencias; consulta <a href="./protos/">protos/</a>.
</div>
