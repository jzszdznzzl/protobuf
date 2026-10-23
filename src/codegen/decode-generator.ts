import { ScalarType, SCALARS } from '../model/scalars.ts';
import { Presence, ValueKind } from '../model/types.ts';
import type { EnumModel, FieldModel, MessageModel, ValueType } from '../model/types.ts';
import type { CodegenOptions } from '../options.ts';
import { WireType } from '../runtime/wire-type.ts';
import type { CodeWriter } from './code-writer.ts';
import type { ImportManager } from './import-manager.ts';
import { TypeMode } from './type-mapper.ts';
import type { TypeMapper } from './type-mapper.ts';
import { hasUnknown } from './unknown.ts';
import { makeTag, wireTypeOf } from './wire.ts';

interface DecodeContext {
  types: TypeMapper;
  imports: ImportManager;
  /** The message keeps unknown fields. */
  isKeepingUnknown: boolean;
}

/** Keeps everything read since `start` (the start of the tag) as unknown. */
const unknownPush = (): string => '(message.$unknown ??= []).push(reader.raw(start));';

/** Keeps a lone varint value (from a packed repeated field) as an unknown field. */
const unknownVarint = (context: DecodeContext, fieldNumber: number): string => {
  const Writer = context.imports.runtime('Writer');
  return `(message.$unknown ??= []).push(new ${Writer}().uint32(${makeTag(fieldNumber, WireType.Varint)}).int32(v).finish());`;
};

const closedEnumOf = (type: ValueType): EnumModel | undefined =>
  type.kind === ValueKind.Enum && type.enum.isClosed ? type.enum : undefined;

const readScalar = (scalar: ScalarType, shouldVerifyUtf8: boolean): string =>
  `reader.${scalar === ScalarType.String && shouldVerifyUtf8 ? 'stringStrict' : scalar}()`;

/** Expression that reads a value of the given type, with the reader positioned after the tag. */
function readExpression(
  type: ValueType,
  fieldNumber: number,
  isGroup: boolean,
  shouldVerifyUtf8: boolean,
  context: DecodeContext,
): string {
  switch (type.kind) {
    case ValueKind.Message: {
      const cls = context.imports.value(type.message);
      return isGroup
        ? `${cls}.read(reader, undefined, ${fieldNumber})`
        : `${cls}.read(reader, reader.uint32())`;
    }
    case ValueKind.Enum: {
      return 'reader.int32()';
    }
    case ValueKind.Scalar: {
      return readScalar(type.scalar, shouldVerifyUtf8);
    }
  }
}

function mergeExpression(field: FieldModel, reference: string, context: DecodeContext): string {
  const { type } = field;
  if (type.kind !== ValueKind.Message) {
    throw new Error('mergeExpression only applies to messages');
  }
  const cls = context.imports.value(type.message);
  return field.isGroup
    ? `${cls}.merge(${reference} ?? new ${cls}(), reader, undefined, ${field.number})`
    : `${cls}.merge(${reference} ?? new ${cls}(), reader, reader.uint32())`;
}

/** `if (known(v)) <push>; else <unknown>;`, without the `else` if unknown fields are dropped. */
function pushOrUnknown(
  writer: CodeWriter,
  context: DecodeContext,
  type: EnumModel,
  push: string,
  unknown: string,
): void {
  const check = `${context.imports.guard(type)}(v)`;
  writer.line(
    context.isKeepingUnknown ? `if (${check}) ${push}; else ${unknown}` : `if (${check}) ${push};`,
  );
}

function decodeRepeatedCase(writer: CodeWriter, field: FieldModel, context: DecodeContext): void {
  const reference = `message.${field.tsName}`;
  const comment = ` // ${field.name}`;
  const closed = closedEnumOf(field.type);
  const read = readExpression(
    field.type,
    field.number,
    field.isGroup,
    field.shouldVerifyUtf8,
    context,
  );
  const tag = makeTag(field.number, wireTypeOf(field.type, field.isGroup));
  const isPackable =
    field.type.kind === ValueKind.Enum ||
    (field.type.kind === ValueKind.Scalar && SCALARS[field.type.scalar].isPackable);

  if (closed) {
    writer.block(`case ${tag}: {${comment}`, () => {
      writer.line(`const v = ${read};`);
      pushOrUnknown(writer, context, closed, `${reference}.push(v)`, unknownPush());
      writer.line('break;');
    });
  } else {
    writer.line(`case ${tag}:${comment}`);
    writer.indent().line(`${reference}.push(${read});`).line('break;').dedent();
  }
  if (!isPackable) {
    return;
  }
  writer.block(
    `case ${makeTag(field.number, WireType.LengthDelimited)}: {${comment} (packed)`,
    () => {
      writer.line('const end2 = reader.uint32() + reader.pos;');
      if (closed) {
        writer.block('while (reader.pos < end2) {', () => {
          writer.line(`const v = ${read};`);
          pushOrUnknown(
            writer,
            context,
            closed,
            `${reference}.push(v)`,
            unknownVarint(context, field.number),
          );
        });
      } else {
        writer.line(`while (reader.pos < end2) ${reference}.push(${read});`);
      }
      writer.line('reader.checkEnd(end2);');
      writer.line('break;');
    },
  );
}

function decodeMapCase(writer: CodeWriter, field: FieldModel, context: DecodeContext): void {
  const { types } = context;
  const map = field.map;
  if (map === undefined) {
    throw new Error('decodeMapCase only applies to maps');
  }
  const keyTag = makeTag(1, SCALARS[map.key].wireType);
  const valueTag = makeTag(2, wireTypeOf(map.value));
  const isMessageValue = map.value.kind === ValueKind.Message;
  const valueType = types.value(map.value, TypeMode.Class);
  const closed = closedEnumOf(map.value);

  writer.block(
    `case ${makeTag(field.number, WireType.LengthDelimited)}: { // ${field.name}`,
    () => {
      writer.line('const end2 = reader.uint32() + reader.pos;');
      writer.line(
        `let key: ${types.scalar(map.key)} = ${types.zeroValue({ kind: ValueKind.Scalar, scalar: map.key })};`,
      );
      if (isMessageValue) {
        writer.line(`let value: ${valueType} | undefined;`);
      } else {
        // A closed enum value is a plain number until the type guard has accepted it.
        writer.line(`let value: ${closed ? 'number' : valueType} = ${types.zeroValue(map.value)};`);
      }
      writer.block('while (reader.pos < end2) {', () => {
        writer.line('const tag2 = reader.uint32();');
        writer.block('switch (tag2) {', () => {
          writer.line(`case ${keyTag}:`);
          writer
            .indent()
            .line(`key = ${readScalar(map.key, field.shouldVerifyUtf8)};`)
            .line('break;')
            .dedent();
          writer.line(`case ${valueTag}:`);
          writer
            .indent()
            .line(
              `value = ${readExpression(map.value, 2, false, field.shouldVerifyUtf8, context)};`,
            )
            .line('break;')
            .dedent();
          writer.line('default:');
          writer.indent().line('reader.skipField(tag2);').dedent();
        });
      });
      writer.line('reader.checkEnd(end2);');
      const finalValue = isMessageValue ? `value ?? ${types.zeroValue(map.value)}` : 'value';
      const set = `message.${field.tsName}.set(key, ${finalValue});`;
      if (closed) {
        const check = `${context.imports.guard(closed)}(value)`;
        if (context.isKeepingUnknown) {
          writer.block(`if (${check}) {`, () => writer.line(set), `} else ${unknownPush()}`);
        } else {
          writer.block(`if (${check}) {`, () => writer.line(set));
        }
      } else {
        writer.line(set);
      }
      writer.line('break;');
    },
  );
}

function decodeSingularCase(
  writer: CodeWriter,
  field: FieldModel,
  context: DecodeContext,
  seenVariable: string | undefined,
): void {
  const reference = `message.${field.tsName}`;
  const comment = ` // ${field.name}`;
  const closed = closedEnumOf(field.type);
  const tag = makeTag(field.number, field.isGroup ? WireType.StartGroup : wireTypeOf(field.type));
  const read = readExpression(
    field.type,
    field.number,
    field.isGroup,
    field.shouldVerifyUtf8,
    context,
  );

  const assign = (): void => {
    // A singular message that appears several times is merged into the previous one.
    let value = read;
    if (field.type.kind === ValueKind.Message) {
      value = mergeExpression(field, reference, context);
    } else if (closed) {
      value = 'v';
    }
    writer.line(`${reference} = ${value};`);
    // Assigning a oneof member clears the others.
    for (const other of field.oneof?.fields ?? []) {
      if (other !== field) {
        writer.line(`message.${other.tsName} = undefined;`);
      }
    }
    if (seenVariable) {
      writer.line(`${seenVariable} = true;`);
    }
  };

  if (closed) {
    writer.block(`case ${tag}: {${comment}`, () => {
      writer.line(`const v = ${read};`);
      const check = `${context.imports.guard(closed)}(v)`;
      if (context.isKeepingUnknown) {
        writer.block(`if (${check}) {`, assign, `} else ${unknownPush()}`);
      } else {
        writer.block(`if (${check}) {`, assign);
      }
      writer.line('break;');
    });
    return;
  }

  writer.line(`case ${tag}:${comment}`);
  writer.indent();
  assign();
  writer.line('break;');
  writer.dedent();
}

function decodeFieldCases(
  writer: CodeWriter,
  field: FieldModel,
  context: DecodeContext,
  seenVariable: string | undefined,
): void {
  if (field.map) {
    decodeMapCase(writer, field, context);
  } else if (field.isRepeated) {
    decodeRepeatedCase(writer, field, context);
  } else {
    decodeSingularCase(writer, field, context, seenVariable);
  }
}

/**
 * Generates `read`, `merge`, `decode` and `decodeDelimited`.
 *
 * The `switch` is done on the full tag (number + wire type), so an unexpected wire type falls
 * into `default` and is kept as unknown. Repeated numeric fields accept both the packed and the
 * unpacked form, as the specification requires. Unknown values of closed enums are kept as
 * unknown fields.
 */
export function generateDecode(
  writer: CodeWriter,
  message: MessageModel,
  types: TypeMapper,
  imports: ImportManager,
  options: CodegenOptions,
): void {
  const Reader = imports.runtime('Reader');
  const Result = imports.runtime('Result');
  const DecodeError = imports.runtime('DecodeError');
  const tryDecode = imports.runtime('tryDecode');
  const cls = message.tsName;
  const required = message.fields.filter((field) => field.presence === Presence.Required);
  const isDelimited = message.isGroup || message.isUsedDelimited;
  const groupParameter = isDelimited ? ', groupField?: number' : '';
  const groupArgument = isDelimited ? ', groupField' : '';
  const context: DecodeContext = { types, imports, isKeepingUnknown: hasUnknown(message, options) };

  writer.line(`/** Decodes a \`${cls}\` from bytes. */`);
  writer.block(`static decode(input: Uint8Array): ${Result}<${cls}, ${DecodeError}> {`, () => {
    writer.line(`return ${tryDecode}(() => ${cls}.read(new ${Reader}(input)));`);
  });
  writer.line();

  writer.line('/** Decodes a message preceded by its length (varint). */');
  writer.block(
    `static decodeDelimited(input: Uint8Array): ${Result}<${cls}, ${DecodeError}> {`,
    () => {
      writer.block(
        `return ${tryDecode}(() => {`,
        () => {
          writer.line(`const reader = new ${Reader}(input);`);
          writer.line(`return ${cls}.read(reader, reader.uint32());`);
        },
        '});',
      );
    },
  );
  writer.line();

  writer.line(
    `/** Reads a \`${cls}\` from a Reader; throws a \`DecodeError\` if the bytes are malformed. */`,
  );
  writer.block(`static read(reader: ${Reader}, length?: number${groupParameter}): ${cls} {`, () => {
    writer.line(`return ${cls}.merge(new ${cls}(), reader, length${groupArgument});`);
  });
  writer.line();

  writer.line(
    `/** Reads onto an existing \`${cls}\`: scalar fields are overwritten and messages are merged. */`,
  );
  writer.block(
    `static merge(message: ${cls}, reader: ${Reader}, length?: number${groupParameter}): ${cls} {`,
    () => {
      writer.line('const end = length === undefined ? reader.length : reader.pos + length;');
      required.forEach((_field, index) => writer.line(`let seen${index} = false;`));
      if (isDelimited) {
        writer.line('let isEnded = groupField === undefined;');
      }

      writer.block('while (reader.pos < end) {', () => {
        if (context.isKeepingUnknown) {
          writer.line('const start = reader.pos;');
        }
        writer.line('const tag = reader.uint32();');
        if (isDelimited) {
          writer.block(
            `if (groupField !== undefined && tag === ((groupField << 3) | ${WireType.EndGroup}) >>> 0) {`,
            () => {
              writer.line('isEnded = true;');
              writer.line('break;');
            },
          );
        }
        writer.block('switch (tag) {', () => {
          for (const field of message.fields) {
            const index = required.indexOf(field);
            decodeFieldCases(writer, field, context, index >= 0 ? `seen${index}` : undefined);
          }
          writer.line('default:');
          writer.indent().line('reader.skipField(tag);');
          if (context.isKeepingUnknown) {
            writer.line(unknownPush());
          }
          writer.dedent();
        });
      });

      writer.line('reader.checkEnd(end);');
      const fail = (code: string, text: string): string => {
        const DecodeErrorCode = imports.runtime('DecodeErrorCode');
        return `throw new ${DecodeError}(${DecodeErrorCode}.${code}, ${JSON.stringify(text)});`;
      };
      if (isDelimited) {
        writer.line(
          `if (!isEnded) ${fail('UnterminatedGroup', `${message.fullName}: unterminated group`)}`,
        );
      }
      required.forEach((field, index) => {
        writer.line(
          `if (!seen${index}) ${fail('MissingRequiredField', `${message.fullName}: missing required field '${field.name}'`)}`,
        );
      });
      writer.line('return message;');
    },
  );
}
