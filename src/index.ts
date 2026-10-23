/**
 * Public API of @jzszdznzzl/protobuf.
 *
 * ```ts
 * import { generate } from "@jzszdznzzl/protobuf";
 * const { data, error } = generate({ files: ["api.proto"], protoPaths: ["protos"], js: {} });
 * ```
 */
export { generate, generateFromSources } from './generator.ts';
export type { GenerateOptions, GenerateResult } from './generator.ts';
export { writeOutput } from './emit/output-writer.ts';
export type { GeneratedFile } from './codegen/file-generator.ts';
export { ProtoError, ProtoErrorCode } from './errors.ts';
export { memoryFileSystem, nodeFileSystem } from './loader/file-system.ts';
export type { FileSystemHost } from './loader/file-system.ts';
export { CodegenOptions, DEFAULT_RUNTIME_IMPORT, ImportExtension } from './options.ts';
export type { CodegenOptionsInput } from './options.ts';
export type { Result } from './result.ts';
