import type { MessageModel } from '../model/types.ts';
import type { ImportManager } from './import-manager.ts';

export interface WellKnownJson {
  /** Body of `toJSON(options)`. */
  toJson: string[];
  /** Body of `static readJSON(json, options)`. */
  fromJson: string[];
  /** Extra instance methods. */
  instanceMembers: string[];
  /** Extra static methods. */
  staticMembers: string[];
}

interface WrapperJson {
  out: (J: string, value: string) => string;
  read: string;
}

const WRAPPERS: Readonly<Record<string, WrapperJson>> = {
  'google.protobuf.DoubleValue': { out: (J, v) => `${J}.doubleOut(this.${v})`, read: 'double' },
  'google.protobuf.FloatValue': { out: (J, v) => `${J}.floatOut(this.${v})`, read: 'float' },
  'google.protobuf.Int64Value': { out: (_J, v) => `this.${v}.toString()`, read: 'int64' },
  'google.protobuf.UInt64Value': { out: (_J, v) => `this.${v}.toString()`, read: 'uint64' },
  'google.protobuf.Int32Value': { out: (_J, v) => `this.${v}`, read: 'int32' },
  'google.protobuf.UInt32Value': { out: (_J, v) => `this.${v}`, read: 'uint32' },
  'google.protobuf.BoolValue': { out: (_J, v) => `this.${v}`, read: 'bool' },
  'google.protobuf.StringValue': { out: (_J, v) => `this.${v}`, read: 'string' },
  'google.protobuf.BytesValue': { out: (J, v) => `${J}.bytesOut(this.${v})`, read: 'bytes' },
};

/**
 * Special JSON representation of the `google.protobuf` well-known types.
 * Returns `undefined` for any other message, which uses the generic mapping.
 */
export function wellKnownJson(
  message: MessageModel,
  imports: ImportManager,
): WellKnownJson | undefined {
  const name = message.fullName;
  if (!name.startsWith('google.protobuf.')) {
    return undefined;
  }

  const J = imports.runtime('Json');
  const cls = message.tsName;
  const field = (proto: string): string =>
    message.fields.find((candidate) => candidate.name === proto)?.tsName ?? proto;
  const sibling = (fullName: string): string => {
    const found = message.file.messages.find((candidate) => candidate.fullName === fullName);
    return found ? imports.value(found) : (fullName.split('.').at(-1) ?? fullName);
  };
  const plain = (toJson: string[], fromJson: string[]): WellKnownJson => ({
    toJson,
    fromJson,
    instanceMembers: [],
    staticMembers: [],
  });

  switch (name) {
    case 'google.protobuf.Timestamp':
    case 'google.protobuf.Duration': {
      const kind = name.endsWith('Timestamp') ? 'timestamp' : 'duration';
      const [seconds, nanos] = [field('seconds'), field('nanos')];
      return plain(
        [`return ${J}.${kind}Out(this.${seconds}, this.${nanos});`],
        [
          `const [${seconds}, ${nanos}] = ${J}.${kind}In(json);`,
          `return new ${cls}({ ${seconds}, ${nanos} });`,
        ],
      );
    }
    case 'google.protobuf.FieldMask': {
      const paths = field('paths');
      return plain(
        [`return ${J}.fieldMaskOut(this.${paths});`],
        [`return new ${cls}({ ${paths}: ${J}.fieldMaskIn(json) });`],
      );
    }
    case 'google.protobuf.Struct': {
      const fields = field('fields');
      const Value = sibling('google.protobuf.Value');
      return plain(
        [
          `const entries: { [key: string]: ${J}.Value } = {};`,
          `for (const [k, v] of this.${fields}) entries[k] = v.toJSON(options);`,
          'return entries;',
        ],
        [
          `const obj = ${J}.object(json, "${name}");`,
          `const message = new ${cls}();`,
          `for (const k of Object.keys(obj)) message.${fields}.set(k, ${Value}.readJSON(obj[k], options));`,
          'return message;',
        ],
      );
    }
    case 'google.protobuf.ListValue': {
      const values = field('values');
      const Value = sibling('google.protobuf.Value');
      return plain(
        [`return this.${values}.map((item) => item.toJSON(options));`],
        [
          `const message = new ${cls}();`,
          `for (const item of ${J}.array(json, "${name}")) message.${values}.push(${Value}.readJSON(item, options));`,
          'return message;',
        ],
      );
    }
    case 'google.protobuf.Value': {
      const nullValue = field('null_value');
      const numberValue = field('number_value');
      const stringValue = field('string_value');
      const boolValue = field('bool_value');
      const structValue = field('struct_value');
      const listValue = field('list_value');
      const Struct = sibling('google.protobuf.Struct');
      const List = sibling('google.protobuf.ListValue');
      const JsonError = imports.runtime('JsonError');
      const JsonErrorCode = imports.runtime('JsonErrorCode');
      return plain(
        [
          `if (this.${numberValue} !== undefined) {`,
          `  if (!Number.isFinite(this.${numberValue})) throw new ${JsonError}(${JsonErrorCode}.Unrepresentable, "${name}: a non-finite number has no JSON form");`,
          `  return this.${numberValue};`,
          '}',
          `if (this.${stringValue} !== undefined) return this.${stringValue};`,
          `if (this.${boolValue} !== undefined) return this.${boolValue};`,
          `if (this.${structValue} !== undefined) return this.${structValue}.toJSON(options);`,
          `if (this.${listValue} !== undefined) return this.${listValue}.toJSON(options);`,
          'return null;',
        ],
        [
          `const message = new ${cls}();`,
          `if (json === null) message.${nullValue} = 0;`,
          `else if (typeof json === "number") message.${numberValue} = json;`,
          `else if (typeof json === "string") message.${stringValue} = json;`,
          `else if (typeof json === "boolean") message.${boolValue} = json;`,
          `else if (Array.isArray(json)) message.${listValue} = ${List}.readJSON(json, options);`,
          `else message.${structValue} = ${Struct}.readJSON(json, options);`,
          'return message;',
        ],
      );
    }
    case 'google.protobuf.Any': {
      const typeUrl = field('type_url');
      const value = field('value');
      const Writer = imports.runtime('Writer');
      const Result = imports.runtime('Result');
      const DecodeError = imports.runtime('DecodeError');
      const DecodeErrorCode = imports.runtime('DecodeErrorCode');
      return {
        toJson: [`return ${J}.anyOut(this.${typeUrl}, this.${value}, options);`],
        fromJson: [
          `const [${typeUrl}, ${value}] = ${J}.anyIn(json, options);`,
          `return new ${cls}({ ${typeUrl}, ${value} });`,
        ],
        instanceMembers: [
          '/** true if the `Any` contains a message of the given type. */',
          'is(type: { typeName: string }): boolean {',
          `  return this.${typeUrl}.slice(this.${typeUrl}.lastIndexOf("/") + 1) === type.typeName;`,
          '}',
          '',
          '/** Decodes the contained message; fails if it is of another type. */',
          `unpack<T>(type: { typeName: string; decode(input: Uint8Array): ${Result}<T, ${DecodeError}> }): ${Result}<T, ${DecodeError}> {`,
          '  if (!this.is(type)) {',
          `    const error = new ${DecodeError}(${DecodeErrorCode}.WrongMessageType, \`${name}: contains '\${this.${typeUrl}}', not '\${type.typeName}'\`);`,
          '    return { data: null, error };',
          '  }',
          `  return type.decode(this.${value});`,
          '}',
        ],
        staticMembers: [
          '/** Packs a message into an `Any` (`type.googleapis.com/<name>`). */',
          `static pack<T>(type: { typeName: string; encode(message: T): ${Writer} }, message: T, prefix: string = "type.googleapis.com"): ${cls} {`,
          `  return new ${cls}({ ${typeUrl}: \`\${prefix}/\${type.typeName}\`, ${value}: type.encode(message).finish() });`,
          '}',
        ],
      };
    }
  }

  const wrapper = WRAPPERS[name];
  if (wrapper) {
    const value = field('value');
    return plain(
      [`return ${wrapper.out(J, value)};`],
      [`return new ${cls}({ ${value}: ${J}.${wrapper.read}(json, "${name}") });`],
    );
  }
  return undefined;
}
