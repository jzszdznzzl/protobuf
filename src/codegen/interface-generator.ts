import { Presence, ValueKind } from '../model/types.ts';
import type { FieldModel, MessageModel } from '../model/types.ts';
import type { CodegenOptions } from '../options.ts';
import type { CodeWriter } from './code-writer.ts';
import { writeJsDoc } from './jsdoc.ts';
import { TypeMode } from './type-mapper.ts';
import type { TypeMapper } from './type-mapper.ts';
import { hasUnknown } from './unknown.ts';

const typeLabel = (type: FieldModel['type']): string => {
  switch (type.kind) {
    case ValueKind.Scalar: {
      return type.scalar;
    }
    case ValueKind.Enum: {
      return type.enum.fullName;
    }
    case ValueKind.Message: {
      return type.message.fullName;
    }
  }
};

/** Short description of the field for the JSDoc: `Field 3 · repeated int64 (packed)`. */
export function fieldSummary(field: FieldModel): string {
  let label: string;
  if (field.map) {
    label = `map<${field.map.key}, ${typeLabel(field.map.value)}>`;
  } else {
    label = typeLabel(field.type);
    if (field.isRepeated) {
      label = `repeated ${label}`;
    } else if (field.presence === Presence.Required) {
      label = `required ${label}`;
    } else if (
      field.presence === Presence.Explicit &&
      field.type.kind !== ValueKind.Message &&
      !field.oneof
    ) {
      label = `optional ${label}`;
    }
  }
  if (field.isGroup) {
    label += ' (group)';
  }
  if (field.isPacked) {
    label += ' (packed)';
  }
  if (field.oneof) {
    label += ` · oneof ${field.oneof.name}`;
  }
  return `Field ${field.number} · \`${label}\``;
}

/**
 * Generates the `FooInit` type of a message.
 *
 * Every field is optional and accepts `null`: it describes any object "similar" to the message
 * and is what the constructor and `encode()` accept.
 */
export function generateInit(
  writer: CodeWriter,
  message: MessageModel,
  types: TypeMapper,
  options: CodegenOptions,
): void {
  writeJsDoc(
    writer,
    {
      comment: message.comment,
      isDeprecated: message.isDeprecated,
      extra: [`Properties of \`${message.fullName}\`.`],
    },
    options.shouldIncludeComments,
  );
  writer.block(`export interface ${message.initName} {`, () => {
    for (const field of message.fields) {
      writeJsDoc(
        writer,
        { comment: field.comment, isDeprecated: field.isDeprecated, extra: [fieldSummary(field)] },
        options.shouldIncludeComments,
      );
      writer.line(`${field.tsName}?: ${types.field(field, TypeMode.Init)} | null | undefined;`);
    }
    if (hasUnknown(message, options)) {
      writer.line('/** Unknown fields and extensions, already encoded. */');
      writer.line('$unknown?: Uint8Array[] | null | undefined;');
    }
  });
  writer.line();
}
