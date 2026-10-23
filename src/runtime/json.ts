/**
 * Canonical protobuf JSON mapping (proto3 JSON) for the generated code.
 *
 * - 64-bit integers are decimal strings; `bytes` is base64; enums are names
 * - `NaN`, `Infinity` and `-Infinity` are strings
 * - Well-known types (Timestamp, Duration, FieldMask, wrappers, Struct, Value, ListValue, Any)
 *   have their own special form.
 */
import { JsonError, JsonErrorCode } from './errors.ts';

export type Value = null | boolean | number | string | Value[] | { [key: string]: Value };

export interface WriteOptions {
  /** Also include fields with their default value (omitted by default). */
  emitDefaults?: boolean;
  /** Use the .proto names (`field_name`) instead of `fieldName`. */
  useProtoFieldName?: boolean;
  /** Write enums as numbers instead of names. */
  enumAsNumber?: boolean;
}

export interface ReadOptions {
  /** Ignore unknown fields and enum values instead of failing. */
  ignoreUnknownFields?: boolean;
}

/** What `google.protobuf.Any` needs to convert a registered message to and from JSON. */
export interface MessageType {
  typeName: string;
  /** Binary → JSON. */
  toJson(bytes: Uint8Array, options?: WriteOptions): Value;
  /** JSON → binary. */
  fromJson(json: unknown, options?: ReadOptions): Uint8Array;
}

type EnumObject = { readonly [name: string]: number };

interface EnumTables {
  byName: Map<string, number>;
  byNumber: Map<number, string>;
}

const registry = new Map<string, MessageType>();
const enumTablesCache = new WeakMap<object, EnumTables>();

const INT32_MIN = -(2n ** 31n);
const INT32_MAX = 2n ** 31n - 1n;
const UINT32_MAX = 2n ** 32n - 1n;
const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;
const UINT64_MAX = 2n ** 64n - 1n;

const TIMESTAMP = 'google.protobuf.Timestamp';
const DURATION = 'google.protobuf.Duration';
const FIELD_MASK = 'google.protobuf.FieldMask';
const ANY = 'google.protobuf.Any';
const TIMESTAMP_MIN_SECONDS = -62135596800n;
const TIMESTAMP_MAX_SECONDS = 253402300799n;
const DURATION_MAX_SECONDS = 315_576_000_000n;
const MAX_NANOS = 999_999_999;
const TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?([Zz]|[+-]\d{2}:\d{2})$/;
const DURATION_PATTERN = /^(-)?(\d+)(\.\d{1,9})?s$/;
const INTEGER_PATTERN = /^-?\d+$/;
const INTEGRAL_DECIMAL_PATTERN = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;
const DECIMAL_PATTERN = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/_-]*$/;

/** Names whose JSON is not an object: inside an `Any` they go under the `value` key. */
const NON_OBJECT_WELL_KNOWN_TYPES: ReadonlySet<string> = new Set([
  TIMESTAMP,
  DURATION,
  FIELD_MASK,
  'google.protobuf.Value',
  'google.protobuf.ListValue',
  'google.protobuf.DoubleValue',
  'google.protobuf.FloatValue',
  'google.protobuf.Int64Value',
  'google.protobuf.UInt64Value',
  'google.protobuf.Int32Value',
  'google.protobuf.UInt32Value',
  'google.protobuf.BoolValue',
  'google.protobuf.StringValue',
  'google.protobuf.BytesValue',
]);

const jsonError = (code: JsonErrorCode, context: string, detail: string): JsonError =>
  new JsonError(code, `${context}: ${detail}`);

const describe = (value: unknown): string => JSON.stringify(value) ?? String(value);

const integerFrom = (value: unknown, context: string): bigint => {
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw jsonError(JsonErrorCode.InvalidValue, context, `not an integer: ${value}`);
    }
    return BigInt(value);
  }
  if (typeof value === 'string') {
    if (INTEGER_PATTERN.test(value)) {
      return BigInt(value);
    }
    // Forms such as "1e3" or "1.0" are accepted as long as they represent an integer.
    if (INTEGRAL_DECIMAL_PATTERN.test(value)) {
      const number = Number(value);
      if (Number.isInteger(number)) {
        return BigInt(number);
      }
    }
  }
  throw jsonError(JsonErrorCode.InvalidValue, context, `invalid integer: ${describe(value)}`);
};

const ranged = (value: unknown, context: string, min: bigint, max: bigint): bigint => {
  const integer = integerFrom(value, context);
  if (integer < min || integer > max) {
    throw jsonError(JsonErrorCode.OutOfRange, context, `value out of range: ${integer}`);
  }
  return integer;
};

const enumTables = (enumObject: EnumObject): EnumTables => {
  const cached = enumTablesCache.get(enumObject);
  if (cached) {
    return cached;
  }
  const byName = new Map<string, number>();
  const byNumber = new Map<number, string>();
  for (const [name, number] of Object.entries(enumObject)) {
    byName.set(name, number);
    // With aliases the first declared name wins.
    if (!byNumber.has(number)) {
      byNumber.set(number, name);
    }
  }
  const tables = { byName, byNumber };
  enumTablesCache.set(enumObject, tables);
  return tables;
};

const nanoDigits = (nanos: number): string => {
  if (nanos === 0) {
    return '';
  }
  const padded = String(nanos).padStart(9, '0');
  if (nanos % 1_000_000 === 0) {
    return `.${padded.slice(0, 3)}`;
  }
  if (nanos % 1000 === 0) {
    return `.${padded.slice(0, 6)}`;
  }
  return `.${padded}`;
};

const typeNameOf = (typeUrl: string, context: string): string => {
  const slash = typeUrl.lastIndexOf('/');
  if (slash < 0 || slash === typeUrl.length - 1) {
    throw jsonError(JsonErrorCode.InvalidValue, context, `invalid type URL: ${describe(typeUrl)}`);
  }
  return typeUrl.slice(slash + 1);
};

const lookupRegistered = (typeUrl: string): MessageType => {
  const name = typeNameOf(typeUrl, ANY);
  const type = registry.get(name);
  if (!type) {
    throw jsonError(
      JsonErrorCode.UnregisteredType,
      ANY,
      `type not registered: ${name} (import the module that defines it)`,
    );
  }
  return type;
};

const isJsonObject = (value: unknown): value is { [key: string]: unknown } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isValueObject = (value: Value): value is { [key: string]: Value } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Registers a generated message by its `typeName` (needed by `google.protobuf.Any`). */
export function registerType(type: MessageType): void {
  registry.set(type.typeName, type);
}

export function object(value: unknown, context: string): { [key: string]: unknown } {
  if (!isJsonObject(value)) {
    throw jsonError(JsonErrorCode.InvalidType, context, 'expected a JSON object');
  }
  return value;
}

export function array(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) {
    throw jsonError(JsonErrorCode.InvalidType, context, 'expected a JSON array');
  }
  return value;
}

export function int32(value: unknown, context: string): number {
  return Number(ranged(value, context, INT32_MIN, INT32_MAX));
}

export function uint32(value: unknown, context: string): number {
  return Number(ranged(value, context, 0n, UINT32_MAX));
}

export function int64(value: unknown, context: string): bigint {
  return ranged(value, context, INT64_MIN, INT64_MAX);
}

export function uint64(value: unknown, context: string): bigint {
  return ranged(value, context, 0n, UINT64_MAX);
}

export function double(value: unknown, context: string): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw jsonError(JsonErrorCode.OutOfRange, context, 'number out of range');
    }
    return value;
  }
  if (value === 'NaN') {
    return Number.NaN;
  }
  if (value === 'Infinity') {
    return Number.POSITIVE_INFINITY;
  }
  if (value === '-Infinity') {
    return Number.NEGATIVE_INFINITY;
  }
  if (typeof value === 'string' && DECIMAL_PATTERN.test(value)) {
    return Number(value);
  }
  throw jsonError(JsonErrorCode.InvalidValue, context, `invalid number: ${describe(value)}`);
}

export function float(value: unknown, context: string): number {
  const number = double(value, context);
  const rounded = Math.fround(number);
  // Out of range only if a finite value overflows when rounded to float32. This keeps the
  // shortest form that `floatOut` writes for FLT_MAX (`3.4028235e+38`) readable.
  if (Number.isFinite(number) && !Number.isFinite(rounded)) {
    throw jsonError(JsonErrorCode.OutOfRange, context, `value out of float range: ${number}`);
  }
  return rounded;
}

export function bool(value: unknown, context: string): boolean {
  if (typeof value !== 'boolean') {
    throw jsonError(JsonErrorCode.InvalidType, context, `expected a boolean: ${describe(value)}`);
  }
  return value;
}

export function string(value: unknown, context: string): string {
  if (typeof value !== 'string') {
    throw jsonError(JsonErrorCode.InvalidType, context, `expected a string: ${describe(value)}`);
  }
  return value;
}

export function boolKey(value: string, context: string): boolean {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  throw jsonError(JsonErrorCode.InvalidValue, context, `invalid boolean key: ${describe(value)}`);
}

/** Accepts both the standard and the URL-safe alphabets, with or without padding. */
export function bytes(value: unknown, context: string): Uint8Array {
  const text = string(value, context).replace(/=+$/, '');
  if (!BASE64_PATTERN.test(text) || text.length % 4 === 1) {
    throw jsonError(JsonErrorCode.InvalidValue, context, 'invalid base64');
  }
  return new Uint8Array(Buffer.from(text, 'base64'));
}

/** Reads an enum from its name or number. Returns `undefined` if an unknown value is ignored. */
export function enumIn(
  enumObject: EnumObject,
  value: unknown,
  context: string,
  options?: ReadOptions,
): number | undefined {
  if (typeof value === 'number') {
    return int32(value, context);
  }
  if (typeof value === 'string') {
    const found = enumTables(enumObject).byName.get(value);
    if (found !== undefined) {
      return found;
    }
  }
  if (options?.ignoreUnknownFields === true) {
    return undefined;
  }
  throw jsonError(
    JsonErrorCode.UnknownEnumValue,
    context,
    `unknown enum value: ${describe(value)}`,
  );
}

/** Like `enumIn`, for closed enums: numbers that are not declared values count as unknown. */
export function closedEnumIn<T extends number>(
  enumObject: EnumObject,
  isKnown: (value: number) => value is T,
  value: unknown,
  context: string,
  options?: ReadOptions,
): T | undefined {
  const number = enumIn(enumObject, value, context, options);
  if (number === undefined) {
    return undefined;
  }
  if (isKnown(number)) {
    return number;
  }
  if (options?.ignoreUnknownFields === true) {
    return undefined;
  }
  throw jsonError(JsonErrorCode.UnknownEnumValue, context, `unknown enum value: ${number}`);
}

export function doubleOut(value: number): Value {
  if (Number.isNaN(value)) {
    return 'NaN';
  }
  if (value === Number.POSITIVE_INFINITY) {
    return 'Infinity';
  }
  if (value === Number.NEGATIVE_INFINITY) {
    return '-Infinity';
  }
  return value;
}

/** `float` with the shortest decimal representation that maps back to the same 32-bit value. */
export function floatOut(value: number): Value {
  if (!Number.isFinite(value)) {
    return doubleOut(value);
  }
  for (let precision = 1; precision < 9; precision++) {
    const candidate = Number(value.toPrecision(precision));
    if (Math.fround(candidate) === value) {
      return candidate;
    }
  }
  return value;
}

export function bytesOut(value: Uint8Array): string {
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64');
}

export function enumOut(
  enumObject: EnumObject,
  value: number,
  options?: WriteOptions,
): string | number {
  if (options?.enumAsNumber === true) {
    return value;
  }
  return enumTables(enumObject).byNumber.get(value) ?? value;
}

export function timestampOut(seconds: bigint, nanos: number): Value {
  if (seconds < TIMESTAMP_MIN_SECONDS || seconds > TIMESTAMP_MAX_SECONDS) {
    throw jsonError(
      JsonErrorCode.Unrepresentable,
      TIMESTAMP,
      'outside the range 0001-01-01..9999-12-31',
    );
  }
  if (nanos < 0 || nanos > MAX_NANOS) {
    throw jsonError(JsonErrorCode.Unrepresentable, TIMESTAMP, 'nanos out of range');
  }
  // `toISOString` gives YYYY-MM-DDTHH:mm:ss.sssZ; only the seconds part is reused.
  const iso = new Date(Number(seconds) * 1000).toISOString();
  return `${iso.slice(0, 19)}${nanoDigits(nanos)}Z`;
}

export function timestampIn(value: unknown): [seconds: bigint, nanos: number] {
  const text = string(value, TIMESTAMP);
  const match = TIMESTAMP_PATTERN.exec(text);
  if (!match) {
    throw jsonError(JsonErrorCode.InvalidValue, TIMESTAMP, `invalid RFC 3339: ${describe(text)}`);
  }
  const part = (index: number): number => Number(match[index] ?? '0');
  const [year, month, day, hour, minute, second] = [1, 2, 3, 4, 5, 6].map(part);
  const date = new Date(0);
  date.setUTCFullYear(year ?? 0, (month ?? 1) - 1, day);
  date.setUTCHours(hour ?? 0, minute ?? 0, second ?? 0, 0);
  if (
    date.getUTCMonth() !== (month ?? 1) - 1 ||
    date.getUTCDate() !== day ||
    (hour ?? 0) > 23 ||
    (minute ?? 0) > 59 ||
    (second ?? 0) > 59
  ) {
    throw jsonError(JsonErrorCode.InvalidValue, TIMESTAMP, `invalid date: ${describe(text)}`);
  }
  let seconds = BigInt(date.getTime() / 1000);
  const zone = match[8] ?? 'Z';
  if (zone !== 'Z' && zone !== 'z') {
    const sign = zone.startsWith('-') ? -1 : 1;
    const offset = Number(zone.slice(1, 3)) * 3600 + Number(zone.slice(4, 6)) * 60;
    seconds -= BigInt(sign * offset);
  }
  if (seconds < TIMESTAMP_MIN_SECONDS || seconds > TIMESTAMP_MAX_SECONDS) {
    throw jsonError(
      JsonErrorCode.OutOfRange,
      TIMESTAMP,
      'outside the range 0001-01-01..9999-12-31',
    );
  }
  const fraction = match[7];
  return [seconds, fraction ? Number(fraction.slice(1).padEnd(9, '0')) : 0];
}

export function durationOut(seconds: bigint, nanos: number): Value {
  if ((seconds < 0n && nanos > 0) || (seconds > 0n && nanos < 0)) {
    throw jsonError(
      JsonErrorCode.Unrepresentable,
      DURATION,
      'seconds and nanos have different signs',
    );
  }
  const absolute = seconds < 0n ? -seconds : seconds;
  if (absolute > DURATION_MAX_SECONDS || Math.abs(nanos) > MAX_NANOS) {
    throw jsonError(JsonErrorCode.Unrepresentable, DURATION, 'out of range');
  }
  const sign = seconds < 0n || nanos < 0 ? '-' : '';
  return `${sign}${absolute}${nanoDigits(Math.abs(nanos))}s`;
}

export function durationIn(value: unknown): [seconds: bigint, nanos: number] {
  const text = string(value, DURATION);
  const match = DURATION_PATTERN.exec(text);
  if (!match) {
    throw jsonError(JsonErrorCode.InvalidValue, DURATION, `invalid duration: ${describe(text)}`);
  }
  const magnitude = BigInt(match[2] ?? '0');
  if (magnitude > DURATION_MAX_SECONDS) {
    throw jsonError(JsonErrorCode.OutOfRange, DURATION, 'out of range');
  }
  const fraction = match[3];
  const nanos = fraction ? Number(fraction.slice(1).padEnd(9, '0')) : 0;
  return match[1] ? [-magnitude, -nanos] : [magnitude, nanos];
}

export function fieldMaskOut(paths: readonly string[]): Value {
  return paths
    .map((path) => {
      if (/[A-Z]/.test(path) || /_(?![a-z])/.test(path)) {
        throw jsonError(JsonErrorCode.Unrepresentable, FIELD_MASK, `path not convertible: ${path}`);
      }
      return path.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
    })
    .join(',');
}

export function fieldMaskIn(value: unknown): string[] {
  const text = string(value, FIELD_MASK);
  if (text === '') {
    return [];
  }
  return text.split(',').map((path) => {
    if (path.includes('_')) {
      throw jsonError(JsonErrorCode.InvalidValue, FIELD_MASK, `invalid path: ${path}`);
    }
    return path.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  });
}

export function anyOut(typeUrl: string, value: Uint8Array, options?: WriteOptions): Value {
  if (typeUrl === '' && value.length === 0) {
    return {};
  }
  const type = lookupRegistered(typeUrl);
  const json = type.toJson(value, options);
  if (NON_OBJECT_WELL_KNOWN_TYPES.has(type.typeName)) {
    return { '@type': typeUrl, value: json };
  }
  if (!isValueObject(json)) {
    throw jsonError(JsonErrorCode.Unrepresentable, ANY, `${type.typeName} has no object form`);
  }
  return { '@type': typeUrl, ...json };
}

export function anyIn(value: unknown, options?: ReadOptions): [typeUrl: string, bytes: Uint8Array] {
  const entries = object(value, ANY);
  if (Object.keys(entries).length === 0) {
    return ['', new Uint8Array(0)];
  }
  const typeUrl = string(entries['@type'], `${ANY}.@type`);
  const type = lookupRegistered(typeUrl);
  const body = NON_OBJECT_WELL_KNOWN_TYPES.has(type.typeName)
    ? entries['value']
    : Object.fromEntries(Object.entries(entries).filter(([key]) => key !== '@type'));
  return [typeUrl, type.fromJson(body, options)];
}
