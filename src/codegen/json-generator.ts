import { ScalarType } from '../model/scalars.ts';
import { Presence, ValueKind } from '../model/types.ts';
import type { FieldModel, MessageModel, ValueType } from '../model/types.ts';
import { CodeWriter } from './code-writer.ts';
import { nonDefaultCheck } from './encode-generator.ts';
import type { ImportManager } from './import-manager.ts';
import { wellKnownJson } from './wkt-json.ts';

const keyExpression = (field: FieldModel): string => {
  const protoName = JSON.stringify(field.name);
  if (field.jsonName === field.name) {
    return protoName;
  }
  return `options?.useProtoFieldName === true ? ${protoName} : ${JSON.stringify(field.jsonName)}`;
};

const isInt64 = (scalar: ScalarType): boolean =>
  scalar === ScalarType.Int64 ||
  scalar === ScalarType.Uint64 ||
  scalar === ScalarType.Sint64 ||
  scalar === ScalarType.Fixed64 ||
  scalar === ScalarType.Sfixed64;

/** Name of the runtime reader for a scalar: the 32/64-bit families share one reader each. */
const scalarReader = (scalar: ScalarType): string => {
  switch (scalar) {
    case ScalarType.Int32:
    case ScalarType.Sint32:
    case ScalarType.Sfixed32: {
      return 'int32';
    }
    case ScalarType.Uint32:
    case ScalarType.Fixed32: {
      return 'uint32';
    }
    case ScalarType.Int64:
    case ScalarType.Sint64:
    case ScalarType.Sfixed64: {
      return 'int64';
    }
    case ScalarType.Uint64:
    case ScalarType.Fixed64: {
      return 'uint64';
    }
    default: {
      return scalar;
    }
  }
};

/** The `null` value is meaningful for `Value` and `NullValue`; for everything else it means "absent". */
const acceptsNull = (type: ValueType): boolean =>
  (type.kind === ValueKind.Message && type.message.fullName === 'google.protobuf.Value') ||
  (type.kind === ValueKind.Enum && type.enum.fullName === 'google.protobuf.NullValue');

/** Expression that converts a value to JSON. */
function toJsonExpression(
  type: ValueType,
  value: string,
  imports: ImportManager,
  J: string,
): string {
  switch (type.kind) {
    case ValueKind.Message: {
      return `${value}.toJSON(options)`;
    }
    case ValueKind.Enum: {
      return `${J}.enumOut(${imports.value(type.enum)}, ${value}, options)`;
    }
    case ValueKind.Scalar: {
      if (isInt64(type.scalar)) {
        return `${value}.toString()`;
      }
      switch (type.scalar) {
        case ScalarType.Double: {
          return `${J}.doubleOut(${value})`;
        }
        case ScalarType.Float: {
          return `${J}.floatOut(${value})`;
        }
        case ScalarType.Bytes: {
          return `${J}.bytesOut(${value})`;
        }
        default: {
          return value;
        }
      }
    }
  }
}

function writeToJson(
  writer: CodeWriter,
  message: MessageModel,
  imports: ImportManager,
  J: string,
): void {
  writer.line(`const json: { [key: string]: ${J}.Value } = {};`);
  if (
    message.fields.some(
      (field) => field.map || field.isRepeated || field.presence === Presence.Implicit,
    )
  ) {
    writer.line('const emit = options?.emitDefaults === true;');
  }
  for (const field of message.fields) {
    const reference = `this.${field.tsName}`;
    const target = `json[${keyExpression(field)}]`;
    if (field.map) {
      const value = toJsonExpression(field.map.value, 'v', imports, J);
      writer.block(`if (${reference}.size !== 0 || emit) {`, () => {
        writer.line(`const entries: { [key: string]: ${J}.Value } = {};`);
        writer.line(`for (const [k, v] of ${reference}) entries[String(k)] = ${value};`);
        writer.line(`${target} = entries;`);
      });
    } else if (field.isRepeated) {
      const element = toJsonExpression(field.type, 'v', imports, J);
      writer.line(
        `if (${reference}.length !== 0 || emit) ${target} = ${reference}.map((v) => ${element});`,
      );
    } else if (field.presence === Presence.Implicit) {
      writer.line(
        `if (emit || (${nonDefaultCheck(field.type, reference)})) ${target} = ${toJsonExpression(field.type, reference, imports, J)};`,
      );
    } else if (field.presence === Presence.Required) {
      writer.line(`${target} = ${toJsonExpression(field.type, reference, imports, J)};`);
    } else {
      writer.line(
        `if (${reference} != null) ${target} = ${toJsonExpression(field.type, reference, imports, J)};`,
      );
    }
  }
  writer.line('return json;');
}

/** Statement that reads one JSON value of `type` from `input` and hands it to `assign`. */
function writeReadOne(
  writer: CodeWriter,
  type: ValueType,
  input: string,
  context: string,
  assign: (expression: string) => string,
  imports: ImportManager,
  J: string,
): void {
  switch (type.kind) {
    case ValueKind.Message: {
      writer.line(`${assign(`${imports.value(type.message)}.readJSON(${input}, options)`)};`);
      return;
    }
    case ValueKind.Enum: {
      const enumObject = imports.value(type.enum);
      const nullable = acceptsNull(type) ? `${input} === null ? 0 : ` : '';
      const read = type.enum.isClosed
        ? `${J}.closedEnumIn(${enumObject}, ${imports.guard(type.enum)}, ${input}, ${JSON.stringify(context)}, options)`
        : `${J}.enumIn(${enumObject}, ${input}, ${JSON.stringify(context)}, options)`;
      writer.line(`const e = ${nullable}${read};`);
      writer.line(`if (e !== undefined) ${assign('e')};`);
      return;
    }
    case ValueKind.Scalar: {
      writer.line(
        `${assign(`${J}.${scalarReader(type.scalar)}(${input}, ${JSON.stringify(context)})`)};`,
      );
      return;
    }
  }
}

function mapKeyExpression(key: ScalarType, context: string, J: string): string {
  switch (key) {
    case ScalarType.String: {
      return 'k';
    }
    case ScalarType.Bool: {
      return `${J}.boolKey(k, ${JSON.stringify(context)})`;
    }
    default: {
      return `${J}.${scalarReader(key)}(k, ${JSON.stringify(context)})`;
    }
  }
}

function writeFromJsonField(
  writer: CodeWriter,
  field: FieldModel,
  imports: ImportManager,
  J: string,
): void {
  const reference = `message.${field.tsName}`;
  const context = field.name;
  const isNullable = field.map ? acceptsNull(field.map.value) : acceptsNull(field.type);

  if (!isNullable || field.isRepeated || field.map) {
    writer.line('if (value === null) break;');
  }

  if (field.map) {
    const { key, value } = field.map;
    writer.line(`const entries = ${J}.object(value, ${JSON.stringify(context)});`);
    writer.block('for (const k of Object.keys(entries)) {', () => {
      writer.line('const entry = entries[k];');
      if (!acceptsNull(value)) {
        writer.line('if (entry === null) continue;');
      }
      writeReadOne(
        writer,
        value,
        'entry',
        context,
        (expression) =>
          `${reference}.set(${mapKeyExpression(key, `${context} (key)`, J)}, ${expression})`,
        imports,
        J,
      );
    });
    return;
  }
  if (field.isRepeated) {
    writer.block(`for (const item of ${J}.array(value, ${JSON.stringify(context)})) {`, () => {
      writeReadOne(
        writer,
        field.type,
        'item',
        context,
        (expression) => `${reference}.push(${expression})`,
        imports,
        J,
      );
    });
    return;
  }
  // Two members of the same oneof in the JSON are an error.
  const JsonError = imports.runtime('JsonError');
  const JsonErrorCode = imports.runtime('JsonErrorCode');
  for (const other of field.oneof?.fields ?? []) {
    if (other !== field) {
      writer.line(
        `if (message.${other.tsName} !== undefined) throw new ${JsonError}(${JsonErrorCode}.ConflictingOneof, ${JSON.stringify(`${field.oneof?.name ?? ''}: only one member of the oneof is allowed`)});`,
      );
    }
  }
  writeReadOne(
    writer,
    field.type,
    'value',
    context,
    (expression) => `${reference} = ${expression}`,
    imports,
    J,
  );
}

function writeFromJson(
  writer: CodeWriter,
  message: MessageModel,
  imports: ImportManager,
  J: string,
): void {
  const JsonError = imports.runtime('JsonError');
  const JsonErrorCode = imports.runtime('JsonErrorCode');
  writer.line(`const obj = ${J}.object(json, "${message.fullName}");`);
  writer.line(`const message = new ${message.tsName}();`);
  writer.block('for (const key of Object.keys(obj)) {', () => {
    if (message.fields.length > 0) {
      writer.line('const value = obj[key];');
    }
    writer.block('switch (key) {', () => {
      for (const field of message.fields) {
        const names = field.jsonName === field.name ? [field.name] : [field.jsonName, field.name];
        names.forEach((name, index) => {
          const isLast = index === names.length - 1;
          writer.line(`case ${JSON.stringify(name)}:${isLast ? ` { // ${field.name}` : ''}`);
        });
        writer.indent();
        writeFromJsonField(writer, field, imports, J);
        writer.line('break;');
        writer.dedent();
        writer.line('}');
      }
      writer.line('default:');
      writer.indent();
      writer.line(
        `if (options?.ignoreUnknownFields !== true) throw new ${JsonError}(${JsonErrorCode}.UnknownField, \`${message.fullName}: unknown field '\${key}'\`);`,
      );
      writer.dedent();
    });
  });
  writer.line('return message;');
}

/** Lines of a method body, with `void options;` first when the body does not use the parameter. */
function bodyLines(build: (body: CodeWriter) => void): string[] {
  const body = new CodeWriter();
  build(body);
  const lines = body
    .toString()
    .split('\n')
    .filter((line) => line !== '');
  return lines.some((line) => line.includes('options')) ? lines : ['void options;', ...lines];
}

/** Generates `toJSON` (and the instance helpers of the well-known types). */
export function generateToJson(
  writer: CodeWriter,
  message: MessageModel,
  imports: ImportManager,
): void {
  const J = imports.runtime('Json');
  const special = wellKnownJson(message, imports);
  const lines = bodyLines((body) => {
    if (special) {
      body.lines(special.toJson.join('\n'));
    } else {
      writeToJson(body, message, imports, J);
    }
  });

  writer.line(
    '/** Converts the message to its canonical JSON representation (used by `JSON.stringify`). */',
  );
  writer.block(`toJSON(options?: ${J}.WriteOptions): ${J}.Value {`, () => {
    for (const line of lines) {
      writer.line(line);
    }
  });
  if (special?.instanceMembers.length) {
    writer.line();
    for (const line of special.instanceMembers) {
      writer.line(line);
    }
  }
}

/**
 * Generates `readJSON` and `fromJSON` (and the static helpers of the well-known types),
 * following the canonical proto3 JSON mapping.
 */
export function generateFromJson(
  writer: CodeWriter,
  message: MessageModel,
  imports: ImportManager,
): void {
  const J = imports.runtime('Json');
  const Result = imports.runtime('Result');
  const JsonError = imports.runtime('JsonError');
  const tryJson = imports.runtime('tryJson');
  const cls = message.tsName;
  const special = wellKnownJson(message, imports);
  const lines = bodyLines((body) => {
    if (special) {
      body.lines(special.fromJson.join('\n'));
    } else {
      writeFromJson(body, message, imports, J);
    }
  });

  writer.line(
    '/** Reads the message from its canonical JSON representation; throws a `JsonError`. */',
  );
  writer.block(`static readJSON(json: unknown, options?: ${J}.ReadOptions): ${cls} {`, () => {
    for (const line of lines) {
      writer.line(line);
    }
  });
  writer.line();
  writer.line('/** Creates the message from its canonical JSON representation. */');
  writer.block(
    `static fromJSON(json: unknown, options?: ${J}.ReadOptions): ${Result}<${cls}, ${JsonError}> {`,
    () => {
      writer.line(`return ${tryJson}(() => ${cls}.readJSON(json, options));`);
    },
  );
  if (special?.staticMembers.length) {
    writer.line();
    for (const line of special.staticMembers) {
      writer.line(line);
    }
  }
}
