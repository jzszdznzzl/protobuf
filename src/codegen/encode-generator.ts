import { ScalarType, SCALARS } from '../model/scalars.ts';
import { Presence, ValueKind } from '../model/types.ts';
import type { FieldModel, MessageModel, ValueType } from '../model/types.ts';
import type { CodegenOptions } from '../options.ts';
import { WireType } from '../runtime/wire-type.ts';
import type { CodeWriter } from './code-writer.ts';
import type { ImportManager } from './import-manager.ts';
import { hasUnknown } from './unknown.ts';
import { codecMethod, makeTag, wireTypeOf } from './wire.ts';

/** Writes a single value together with its tag. */
function writeValue(
  writer: CodeWriter,
  type: ValueType,
  fieldNumber: number,
  expression: string,
  isGroup: boolean,
  imports: ImportManager,
): void {
  if (type.kind === ValueKind.Message) {
    const cls = imports.value(type.message);
    if (isGroup) {
      writer.line(`writer.uint32(${makeTag(fieldNumber, WireType.StartGroup)});`);
      writer.line(`${cls}.encode(${expression}, writer);`);
      writer.line(`writer.uint32(${makeTag(fieldNumber, WireType.EndGroup)});`);
    } else {
      writer.line(
        `${cls}.encode(${expression}, writer.uint32(${makeTag(fieldNumber, WireType.LengthDelimited)}).fork()).ldelim();`,
      );
    }
    return;
  }
  writer.line(
    `writer.uint32(${makeTag(fieldNumber, wireTypeOf(type))}).${codecMethod(type)}(${expression});`,
  );
}

function encodeField(
  writer: CodeWriter,
  owner: MessageModel,
  field: FieldModel,
  imports: ImportManager,
): void {
  const reference = `message.${field.tsName}`;

  if (field.map) {
    const { key, value } = field.map;
    const keyTag = makeTag(1, SCALARS[key].wireType);
    writer.block(`if (${reference} != null) {`, () => {
      writer.block(`for (const [k, v] of ${reference}) {`, () => {
        writer.line(
          `writer.uint32(${makeTag(field.number, WireType.LengthDelimited)}).fork().uint32(${keyTag}).${key}(k);`,
        );
        writeValue(writer, value, 2, 'v', false, imports);
        writer.line('writer.ldelim();');
      });
    });
    return;
  }

  if (field.isRepeated) {
    if (field.isPacked) {
      writer.block(`if (${reference} != null && ${reference}.length !== 0) {`, () => {
        writer.line(`writer.uint32(${makeTag(field.number, WireType.LengthDelimited)}).fork();`);
        writer.line(`for (const v of ${reference}) writer.${codecMethod(field.type)}(v);`);
        writer.line('writer.ldelim();');
      });
    } else {
      writer.block(`if (${reference} != null) {`, () => {
        writer.block(`for (const v of ${reference}) {`, () =>
          writeValue(writer, field.type, field.number, 'v', field.isGroup, imports),
        );
      });
    }
    return;
  }

  if (field.presence === Presence.Required) {
    writer.line(
      `if (${reference} == null) throw new Error(${JSON.stringify(`${owner.fullName}: missing required field '${field.name}'`)});`,
    );
    writeValue(writer, field.type, field.number, reference, field.isGroup, imports);
    return;
  }

  const condition =
    field.presence === Presence.Implicit
      ? `${reference} != null && ${nonDefaultCheck(field.type, reference)}`
      : `${reference} != null`;
  writer.block(`if (${condition}) {`, () =>
    writeValue(writer, field.type, field.number, reference, field.isGroup, imports),
  );
}

/** Condition "differs from the default value" for proto3 fields without explicit presence. */
export function nonDefaultCheck(type: ValueType, reference: string): string {
  switch (type.kind) {
    case ValueKind.Enum: {
      return `${reference} !== 0`;
    }
    case ValueKind.Message: {
      return 'true';
    }
    case ValueKind.Scalar: {
      switch (type.scalar) {
        case ScalarType.Double:
        case ScalarType.Float: {
          // -0 is serialized (its bits are not zero), like the official implementations do.
          return `!Object.is(${reference}, 0)`;
        }
        case ScalarType.Bool: {
          return `${reference} !== false`;
        }
        case ScalarType.String: {
          return `${reference} !== ""`;
        }
        case ScalarType.Bytes: {
          return `${reference}.length !== 0`;
        }
        default: {
          return SCALARS[type.scalar].tsType === 'bigint'
            ? `${reference} !== 0n`
            : `${reference} !== 0`;
        }
      }
    }
  }
}

/**
 * Generates `static encode(message, writer?)` and `static encodeDelimited(...)`.
 * Fields are written in field-number order, as the official implementations do.
 */
export function generateEncode(
  writer: CodeWriter,
  message: MessageModel,
  imports: ImportManager,
  options: CodegenOptions,
): void {
  const Writer = imports.runtime('Writer');
  const { tsName, initName } = message;

  writer.line(`/** Encodes a \`${tsName}\` (or a \`${initName}\` object) into binary format. */`);
  writer.block(
    `static encode(message: ${initName}, writer: ${Writer} = new ${Writer}()): ${Writer} {`,
    () => {
      for (const field of message.fields) {
        encodeField(writer, message, field, imports);
      }
      if (hasUnknown(message, options)) {
        writer.line(
          'if (message.$unknown != null) for (const chunk of message.$unknown) writer.raw(chunk);',
        );
      }
      writer.line('return writer;');
    },
  );
  writer.line();

  writer.line('/** Same as `encode`, but prefixed with the length as a varint. */');
  writer.block(
    `static encodeDelimited(message: ${initName}, writer: ${Writer} = new ${Writer}()): ${Writer} {`,
    () => {
      writer.line(`return ${tsName}.encode(message, writer.fork()).ldelim();`);
    },
  );
}
