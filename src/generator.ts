import { z } from 'zod';

import { generateFile } from './codegen/file-generator.ts';
import type { GeneratedFile } from './codegen/file-generator.ts';
import { emitJavaScript } from './emit/js-emitter.ts';
import { ProtoError, ProtoErrorCode } from './errors.ts';
import { loadProtoFiles } from './loader/file-loader.ts';
import { memoryFileSystem, nodeFileSystem } from './loader/file-system.ts';
import type { FileSystemHost } from './loader/file-system.ts';
import { resolveFiles } from './model/resolver.ts';
import { CodegenOptions, ImportExtension } from './options.ts';
import type { CodegenOptionsInput } from './options.ts';
import { fail, ok } from './result.ts';
import type { Result } from './result.ts';

export interface GenerateOptions extends CodegenOptionsInput {
  /** Input .proto files. */
  files: string[];
  /** Directories to search for imports (`-I`). */
  protoPaths?: string[];
  /** Also generate the imported .proto files, which the output needs to compile. Default: true. */
  shouldIncludeImports?: boolean;
  /** Use the google/protobuf well-known types shipped with the package. Default: true. */
  shouldUseBuiltinWellKnownTypes?: boolean;
  /** Alternative file system, e.g. in memory. */
  fileSystem?: FileSystemHost;
  /** If set, JavaScript (and `.d.ts` unless disabled) is also produced. */
  js?: { shouldEmitDeclarations?: boolean };
}

export interface GenerateResult {
  ts: GeneratedFile[];
  /** JavaScript files and declarations, if `js` was requested. */
  js?: GeneratedFile[];
  warnings: string[];
}

const MEMORY_ROOT = '/__protobuf_memory__';

function run(options: GenerateOptions): GenerateResult {
  const parsed = CodegenOptions.safeParse(options);
  if (!parsed.success) {
    throw new ProtoError(ProtoErrorCode.InvalidOptions, z.prettifyError(parsed.error));
  }
  const codegen = parsed.data;

  const loaded = loadProtoFiles(options.files, {
    protoPaths: options.protoPaths ?? [],
    shouldUseBuiltinWellKnownTypes: options.shouldUseBuiltinWellKnownTypes ?? true,
    fileSystem: options.fileSystem ?? nodeFileSystem,
  });
  const { files, warnings } = resolveFiles(loaded.files, {
    shouldKeepCase: codegen.shouldKeepCase,
  });
  const selected =
    options.shouldIncludeImports === false
      ? files.filter((file) => loaded.entryFiles.includes(file.fileName))
      : files;

  const result: GenerateResult = {
    ts: selected.map((file) => generateFile(file, codegen)),
    warnings,
  };
  if (options.js) {
    // Node resolves `.js` specifiers, so the JavaScript comes from a copy that imports `.js`.
    const forJs = { ...codegen, importExtension: ImportExtension.Js };
    const sources = selected.map((file) => generateFile(file, forJs));
    result.js = emitJavaScript(sources, {
      shouldEmitDeclarations: options.js.shouldEmitDeclarations ?? true,
    });
  }
  return result;
}

/**
 * Main entry point: .proto to TypeScript, and optionally JavaScript with declarations.
 *
 * Problems with the user's input (bad syntax, missing imports, invalid options) are returned.
 * The passes unwind with a `ProtoError`; anything else is a bug and is thrown.
 */
export function generate(options: GenerateOptions): Result<GenerateResult, ProtoError> {
  try {
    return ok(run(options));
  } catch (error) {
    if (error instanceof ProtoError) {
      return fail(error);
    }
    throw error;
  }
}

/** Generates code from in-memory sources: `{ "foo.proto": "syntax = ..." }`. */
export function generateFromSources(
  sources: Record<string, string>,
  options: Omit<GenerateOptions, 'files' | 'protoPaths' | 'fileSystem'> = {},
): Result<GenerateResult, ProtoError> {
  const memory = memoryFileSystem(
    Object.fromEntries(
      Object.entries(sources).map(([name, content]) => [`${MEMORY_ROOT}/${name}`, content]),
    ),
  );
  const fileSystem: FileSystemHost = {
    // Well-known types are still read from disk: they ship with the package.
    readFile: (absolutePath) =>
      memory.readFile(absolutePath) ??
      (options.shouldUseBuiltinWellKnownTypes !== false && !absolutePath.startsWith(MEMORY_ROOT)
        ? nodeFileSystem.readFile(absolutePath)
        : undefined),
  };
  return generate({
    ...options,
    files: Object.keys(sources).map((name) => `${MEMORY_ROOT}/${name}`),
    protoPaths: [MEMORY_ROOT],
    fileSystem,
  });
}
