import { OptionValueKind } from '../ast/types.ts';
import type { OptionValue } from '../ast/types.ts';
import { ProtoError, ProtoErrorCode } from '../errors.ts';
import { SCALARS } from '../model/scalars.ts';
import { ValueKind } from '../model/types.ts';
import type { FieldModel } from '../model/types.ts';
import type { TypeMapper } from './type-mapper.ts';

const invalidDefault = (field: FieldModel): ProtoError =>
  new ProtoError(ProtoErrorCode.Resolution, `Invalid default value for field '${field.name}'`);

/** Converts protobuf integer literals (decimal, hex, octal, signed) to exact decimal text. */
const toDecimalText = (raw: string, field: FieldModel): string => {
  const isNegative = raw.startsWith('-');
  let body = isNegative ? raw.slice(1) : raw;
  if (/^0[0-7]+$/.test(body)) {
    body = `0o${body.slice(1)}`;
  }
  if (!/^(0[xX][0-9a-fA-F]+|0o[0-7]+|\d+)$/.test(body)) {
    throw invalidDefault(field);
  }
  const value = BigInt(body);
  return (isNegative ? -value : value).toString();
};

const numberLiteral = (value: number): string => {
  if (Number.isNaN(value)) {
    return 'NaN';
  }
  if (value === Number.POSITIVE_INFINITY) {
    return 'Infinity';
  }
  if (value === Number.NEGATIVE_INFINITY) {
    return '-Infinity';
  }
  return String(value);
};

/** Converts the value of `[default = ...]` (proto2) into a TypeScript literal. */
export function defaultLiteral(field: FieldModel, value: OptionValue, mapper: TypeMapper): string {
  const { type } = field;

  if (type.kind === ValueKind.Enum) {
    if (value.kind !== OptionValueKind.Identifier) {
      throw invalidDefault(field);
    }
    const member = type.enum.values.find((candidate) => candidate.name === value.value);
    if (member === undefined) {
      throw invalidDefault(field);
    }
    return mapper.enumMember(type.enum, member.number);
  }
  if (type.kind !== ValueKind.Scalar) {
    throw invalidDefault(field);
  }

  switch (SCALARS[type.scalar].tsType) {
    case 'boolean': {
      if (value.kind !== OptionValueKind.Bool) {
        throw invalidDefault(field);
      }
      return String(value.value);
    }
    case 'string': {
      if (value.kind !== OptionValueKind.String) {
        throw invalidDefault(field);
      }
      return JSON.stringify(value.value);
    }
    case 'Uint8Array': {
      if (value.kind !== OptionValueKind.String) {
        throw invalidDefault(field);
      }
      return `new Uint8Array([${value.bytes.join(', ')}])`;
    }
    case 'bigint': {
      if (value.kind !== OptionValueKind.Number) {
        throw invalidDefault(field);
      }
      return `${toDecimalText(value.raw, field)}n`;
    }
    case 'number': {
      if (value.kind !== OptionValueKind.Number) {
        throw invalidDefault(field);
      }
      return numberLiteral(value.value);
    }
  }
}
