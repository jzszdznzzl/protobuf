/**
 * Minimal runtime used by the generated code. The generated files import it from
 * `@jzszdznzzl/protobuf/runtime` unless `--runtime-import` says otherwise.
 */
export { Reader } from './reader.ts';
export { Writer } from './writer.ts';
export { WireType } from './wire-type.ts';
export { toBigInt } from './int64.ts';
export type { Int64Like } from './int64.ts';
export { Extension, RepeatedExtension } from './extension.ts';
export type { Extendable, ExtensionSpec, RepeatedExtensionSpec } from './extension.ts';
export {
  DecodeError,
  DecodeErrorCode,
  JsonError,
  JsonErrorCode,
  tryDecode,
  tryJson,
} from './errors.ts';
export type { Result } from '../result.ts';
export * as Json from './json.ts';
