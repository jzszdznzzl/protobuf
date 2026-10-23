import { fail, ok } from '../result.ts';
import type { Result } from '../result.ts';

export const DecodeErrorCode = Object.freeze({
  Truncated: 'truncated',
  MalformedVarint: 'malformed_varint',
  InvalidTag: 'invalid_tag',
  InvalidWireType: 'invalid_wire_type',
  InvalidUtf8: 'invalid_utf8',
  LengthOverrun: 'length_overrun',
  UnterminatedGroup: 'unterminated_group',
  UnexpectedEndGroup: 'unexpected_end_group',
  MissingRequiredField: 'missing_required_field',
  WrongMessageType: 'wrong_message_type',
} as const);

export type DecodeErrorCode = (typeof DecodeErrorCode)[keyof typeof DecodeErrorCode];

export const JsonErrorCode = Object.freeze({
  InvalidType: 'invalid_type',
  InvalidValue: 'invalid_value',
  OutOfRange: 'out_of_range',
  UnknownField: 'unknown_field',
  UnknownEnumValue: 'unknown_enum_value',
  UnregisteredType: 'unregistered_type',
  ConflictingOneof: 'conflicting_oneof',
  Unrepresentable: 'unrepresentable',
} as const);

export type JsonErrorCode = (typeof JsonErrorCode)[keyof typeof JsonErrorCode];

/** Malformed or truncated binary input. Callers branch on `code`. */
export class DecodeError extends Error {
  #code: DecodeErrorCode;

  constructor(code: DecodeErrorCode, message: string) {
    super(message);
    this.name = 'DecodeError';
    this.#code = code;
  }

  get code(): DecodeErrorCode {
    return this.#code;
  }
}

/** JSON that does not follow the canonical protobuf JSON mapping. Callers branch on `code`. */
export class JsonError extends Error {
  #code: JsonErrorCode;

  constructor(code: JsonErrorCode, message: string) {
    super(message);
    this.name = 'JsonError';
    this.#code = code;
  }

  get code(): JsonErrorCode {
    return this.#code;
  }
}

// The codec unwinds with exceptions from deep inside nested messages; only the public
// entry points turn them into a `Result`, and anything that is not ours is a bug and propagates.
export function tryDecode<T>(run: () => T): Result<T, DecodeError> {
  try {
    return ok(run());
  } catch (error) {
    if (error instanceof DecodeError) {
      return fail(error);
    }
    throw error;
  }
}

export function tryJson<T>(run: () => T): Result<T, JsonError> {
  try {
    return ok(run());
  } catch (error) {
    if (error instanceof JsonError) {
      return fail(error);
    }
    throw error;
  }
}
