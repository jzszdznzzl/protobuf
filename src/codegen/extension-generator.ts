import { ScalarType, SCALARS } from '../model/scalars.ts';
import { ValueKind } from '../model/types.ts';
import type { ExtensionModel } from '../model/types.ts';
import type { CodegenOptions } from '../options.ts';
import { WireType } from '../runtime/wire-type.ts';
import type { CodeWriter } from './code-writer.ts';
import type { ImportManager } from './import-manager.ts';
import { writeJsDoc } from './jsdoc.ts';
import { TypeMode } from './type-mapper.ts';
import type { TypeMapper } from './type-mapper.ts';
import { codecMethod, makeTag, wireTypeOf } from './wire.ts';

/**
 * Generates one extension constant per `extend` field:
 *
 * ```ts
 * export const fooBar: $Extension<number> = new $Extension<number>("pkg.Foo", "pkg.bar", { ... });
 * fooBar.set(foo, 5); fooBar.get(foo); fooBar.has(foo); fooBar.clear(foo);
 * ```
 */
export function generateExtension(
  writer: CodeWriter,
  extension: ExtensionModel,
  types: TypeMapper,
  imports: ImportManager,
  options: CodegenOptions,
): void {
  const { field } = extension;
  const isRepeated = field.isRepeated;
  const ExtensionClass = imports.runtime(isRepeated ? 'RepeatedExtension' : 'Extension');
  // Enum elements are plain numbers: the extension reads whatever the wire holds.
  const element =
    field.type.kind === ValueKind.Enum ? 'number' : types.value(field.type, TypeMode.Class);
  const isPackable =
    field.type.kind === ValueKind.Enum ||
    (field.type.kind === ValueKind.Scalar && SCALARS[field.type.scalar].isPackable);

  writeJsDoc(
    writer,
    {
      comment: extension.comment,
      isDeprecated: extension.isDeprecated,
      extra: [
        `Extension \`${extension.fullName}\` (field ${extension.number}) of \`${extension.extendee.fullName}\`.`,
      ],
    },
    options.shouldIncludeComments,
  );
  const typed = `${ExtensionClass}<${element}>`;
  writer.block(
    `export const ${extension.tsName}: ${typed} = new ${typed}(${JSON.stringify(extension.extendee.fullName)}, ${JSON.stringify(extension.fullName)}, {`,
    () => {
      writer.line(`number: ${extension.number},`);
      writer.line(`wireType: ${wireTypeOf(field.type, field.isGroup)},`);
      writer.line(`isPackable: ${isPackable},`);
      if (isRepeated) {
        writer.line(`isPacked: ${field.isPacked},`);
      }
      if (field.type.kind === ValueKind.Message) {
        const cls = imports.value(field.type.message);
        if (field.isGroup) {
          writer.line(`read: (reader) => ${cls}.read(reader, undefined, ${extension.number}),`);
          writer.block(
            'write: (writer, value) => {',
            () => {
              writer.line(`${cls}.encode(value, writer);`);
              writer.line(`writer.uint32(${makeTag(extension.number, WireType.EndGroup)});`);
            },
            '},',
          );
        } else {
          writer.line(`read: (reader) => ${cls}.read(reader, reader.uint32()),`);
          writer.line(
            `write: (writer, value) => { ${cls}.encode(value, writer.fork()).ldelim(); },`,
          );
        }
      } else {
        const method = codecMethod(field.type);
        const read =
          method === ScalarType.String && field.shouldVerifyUtf8 ? 'stringStrict' : method;
        writer.line(`read: (reader) => reader.${read}(),`);
        writer.line(`write: (writer, value) => { writer.${method}(value); },`);
      }
    },
    '});',
  );
  writer.line();
}
