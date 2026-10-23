import { Presence, ValueKind } from '../model/types.ts';
import type { FieldModel, MessageModel } from '../model/types.ts';
import type { CodegenOptions } from '../options.ts';
import type { CodeWriter } from './code-writer.ts';
import { generateDecode } from './decode-generator.ts';
import { defaultLiteral } from './default-values.ts';
import { generateEncode } from './encode-generator.ts';
import type { ImportManager } from './import-manager.ts';
import { fieldSummary } from './interface-generator.ts';
import { writeJsDoc } from './jsdoc.ts';
import { generateFromJson, generateToJson } from './json-generator.ts';
import { TypeMode } from './type-mapper.ts';
import type { TypeMapper } from './type-mapper.ts';
import { hasUnknown } from './unknown.ts';

/** `static get defaults()` with the proto2 `[default = ...]` values of optional fields. */
function generateDefaults(writer: CodeWriter, message: MessageModel, types: TypeMapper): void {
  const withDefault = message.fields.filter(
    (field) => field.defaultValue && field.presence === Presence.Explicit,
  );
  if (withDefault.length === 0) {
    return;
  }
  const shape = withDefault
    .map((field) => `${field.tsName}: ${types.field(field, TypeMode.Class)}`)
    .join('; ');
  // A getter: the enums used by the defaults are declared before the class, but a getter keeps
  // the values lazy and the class free of static initialization order.
  writer.line(
    '/** Values declared with `[default = ...]` for optional fields that are not assigned. */',
  );
  writer.block(`static get defaults(): Readonly<{ ${shape} }> {`, () => {
    writer.block(
      'return {',
      () => {
        for (const field of withDefault) {
          if (field.defaultValue) {
            writer.line(`${field.tsName}: ${defaultLiteral(field, field.defaultValue, types)},`);
          }
        }
      },
      '};',
    );
  });
  writer.line();
}

function propertyDeclaration(field: FieldModel, types: TypeMapper): string {
  const type = types.field(field, TypeMode.Class);
  const name = field.tsName;

  if (field.map) {
    return `${name}: ${type} = new Map();`;
  }
  if (field.isRepeated) {
    return `${name}: ${type} = [];`;
  }
  if (field.presence === Presence.Implicit) {
    return `${name}: ${type} = ${types.zeroValue(field.type)};`;
  }
  if (field.presence === Presence.Required && field.type.kind !== ValueKind.Message) {
    const initial = field.defaultValue
      ? defaultLiteral(field, field.defaultValue, types)
      : types.zeroValue(field.type);
    return `${name}: ${type} = ${initial};`;
  }
  return `${name}: ${type} | undefined = undefined;`;
}

/** Expression that copies the value from the init object, turning messages into instances. */
function copyExpression(
  field: FieldModel,
  source: string,
  types: TypeMapper,
  imports: ImportManager,
): string {
  const toInstance = (expression: string, type: FieldModel['type']): string => {
    if (type.kind !== ValueKind.Message) {
      return expression;
    }
    const cls = imports.value(type.message);
    return `${expression} instanceof ${cls} ? ${expression} : new ${cls}(${expression})`;
  };

  if (field.map) {
    if (field.map.value.kind !== ValueKind.Message) {
      return `new Map(${source})`;
    }
    const keyType = types.scalar(field.map.key);
    const valueType = types.value(field.map.value, TypeMode.Class);
    return `new Map(Array.from(${source}, ([k, v]): [${keyType}, ${valueType}] => [k, ${toInstance('v', field.map.value)}]))`;
  }
  if (field.isRepeated) {
    return field.type.kind === ValueKind.Message
      ? `${source}.map((v) => ${toInstance('v', field.type)})`
      : `[...${source}]`;
  }
  return toInstance(source, field.type);
}

function generateConstructor(
  writer: CodeWriter,
  message: MessageModel,
  types: TypeMapper,
  imports: ImportManager,
  options: CodegenOptions,
): void {
  writer.block(`constructor(init?: ${message.initName}) {`, () => {
    const isKeepingUnknown = hasUnknown(message, options);
    if (message.fields.length === 0 && !isKeepingUnknown) {
      writer.line('void init;');
      return;
    }
    writer.line('if (!init) return;');
    for (const field of message.fields) {
      const source = `init.${field.tsName}`;
      writer.line(
        `if (${source} != null) this.${field.tsName} = ${copyExpression(field, source, types, imports)};`,
      );
    }
    if (isKeepingUnknown) {
      writer.line('if (init.$unknown != null) this.$unknown = init.$unknown.slice();');
    }
  });
}

function generateOneOfGetters(
  writer: CodeWriter,
  message: MessageModel,
  options: CodegenOptions,
): void {
  for (const oneOf of message.oneOfs) {
    const union = oneOf.fields.map((field) => JSON.stringify(field.tsName)).join(' | ');
    writeJsDoc(
      writer,
      {
        comment: oneOf.comment,
        extra: [`Assigned member of the oneof \`${oneOf.name}\`, or \`undefined\`.`],
      },
      options.shouldIncludeComments,
    );
    writer.block(`get ${oneOf.tsName}(): ${union} | undefined {`, () => {
      for (const field of oneOf.fields) {
        writer.line(
          `if (this.${field.tsName} !== undefined) return ${JSON.stringify(field.tsName)};`,
        );
      }
      writer.line('return undefined;');
    });
    writer.line();
  }
}

/**
 * Generates the class of a message. Members follow the project's class layout: fields,
 * constructor, getters, instance methods and, last, the static methods.
 *
 * ```ts
 * export class Foo implements FooInit {
 *   // properties with their default values
 *   constructor(init?: FooInit)
 *   static encode(message: FooInit, writer?): Writer
 *   static decode(input: Uint8Array): Result<Foo, DecodeError>
 * }
 * ```
 */
export function generateClass(
  writer: CodeWriter,
  message: MessageModel,
  types: TypeMapper,
  imports: ImportManager,
  options: CodegenOptions,
): void {
  const { tsName, initName } = message;
  writeJsDoc(
    writer,
    {
      comment: message.comment,
      isDeprecated: message.isDeprecated,
      extra: [`Message \`${message.fullName}\`.`],
    },
    options.shouldIncludeComments,
  );

  writer.block(`export class ${tsName} implements ${initName} {`, () => {
    for (const field of message.fields) {
      writeJsDoc(
        writer,
        { comment: field.comment, isDeprecated: field.isDeprecated, extra: [fieldSummary(field)] },
        options.shouldIncludeComments,
      );
      writer.line(propertyDeclaration(field, types));
    }
    if (hasUnknown(message, options)) {
      writer.line('/** Unknown fields and extensions, already encoded (one element per field). */');
      writer.line('$unknown: Uint8Array[] | undefined = undefined;');
    }
    if (message.fields.length > 0 || hasUnknown(message, options)) {
      writer.line();
    }

    generateConstructor(writer, message, types, imports, options);
    writer.line();

    writer.line('/** Fully qualified name of the message in the .proto. */');
    writer.block('static get typeName(): string {', () => {
      writer.line(`return ${JSON.stringify(message.fullName)};`);
    });
    writer.line();
    generateDefaults(writer, message, types);
    generateOneOfGetters(writer, message, options);

    if (options.shouldGenerateJson) {
      generateToJson(writer, message, imports);
      writer.line();
    }

    generateEncode(writer, message, imports, options);
    writer.line();
    generateDecode(writer, message, types, imports, options);
    if (options.shouldGenerateJson) {
      writer.line();
      generateFromJson(writer, message, imports);
    }
  });
  writer.line();
}
