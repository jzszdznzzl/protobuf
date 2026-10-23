import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ImportModifier } from '../ast/types.ts';
import type { ProtoFileNode } from '../ast/types.ts';
import { ProtoError, ProtoErrorCode } from '../errors.ts';
import { BUILTIN_PROTO_DIR } from '../location.ts';
import { parseProto } from '../parser/parser.ts';
import { nodeFileSystem } from './file-system.ts';
import type { FileSystemHost } from './file-system.ts';

export interface LoadOptions {
  /** Directories to search for imports (equivalent to protoc's `-I` / `--proto_path`). */
  protoPaths?: string[];
  /** Looks up `google/protobuf/*.proto` among those shipped with the package. Default: true. */
  shouldUseBuiltinWellKnownTypes?: boolean;
  fileSystem?: FileSystemHost;
}

export interface LoadResult {
  /** All loaded files, in dependency order (imported ones first). */
  files: ProtoFileNode[];
  /** Logical names of the explicitly requested files (the ones that are generated). */
  entryFiles: string[];
}

const importError = (message: string): ProtoError => new ProtoError(ProtoErrorCode.Import, message);

const toLogicalName = (absolute: string, protoPaths: string[]): string | undefined => {
  for (const root of protoPaths) {
    const relative = path.relative(root, absolute);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      return relative.split(path.sep).join('/');
    }
  }
  return undefined;
};

const resolveImport = (
  importPath: string,
  searchPaths: string[],
  fileSystem: FileSystemHost,
): string | undefined =>
  searchPaths
    .map((root) => path.join(root, importPath))
    .find((candidate) => fileSystem.readFile(candidate) !== undefined);

/** Reads and parses the input files and, recursively, all their imports. Throws a `ProtoError`. */
export function loadProtoFiles(inputs: string[], options: LoadOptions = {}): LoadResult {
  const fileSystem = options.fileSystem ?? nodeFileSystem;
  const protoPaths = (options.protoPaths ?? []).map((protoPath) => path.resolve(protoPath));
  const searchPaths = [...protoPaths];
  if (options.shouldUseBuiltinWellKnownTypes !== false) {
    searchPaths.push(fileURLToPath(BUILTIN_PROTO_DIR));
  }

  const loaded = new Set<string>();
  const ordered: ProtoFileNode[] = [];
  const inProgress = new Set<string>();

  const loadLogical = (logicalName: string, absolutePath: string, importedFrom?: string): void => {
    if (loaded.has(logicalName)) {
      return;
    }
    if (inProgress.has(logicalName)) {
      throw importError(`Circular import detected: ${logicalName} (from ${importedFrom})`);
    }
    const source = fileSystem.readFile(absolutePath);
    if (source === undefined) {
      throw importError(`Could not read ${absolutePath}`);
    }

    inProgress.add(logicalName);
    const ast = parseProto(source, logicalName);
    for (const imported of ast.imports) {
      const resolved = resolveImport(imported.path, searchPaths, fileSystem);
      if (resolved === undefined) {
        if (imported.modifier === ImportModifier.Weak) {
          continue;
        }
        throw importError(
          `${logicalName}: import "${imported.path}" not found. ` +
            `Paths searched: ${searchPaths.join(', ') || '(none)'}. Use -I to add directories.`,
        );
      }
      loadLogical(imported.path, resolved, logicalName);
    }
    inProgress.delete(logicalName);
    loaded.add(logicalName);
    ordered.push(ast);
  };

  const entryFiles: string[] = [];
  for (const input of inputs) {
    const absolute = path.resolve(input);
    let logical = toLogicalName(absolute, protoPaths);
    if (logical === undefined) {
      // No -I contains it: its own folder becomes the search path.
      const directory = path.dirname(absolute);
      protoPaths.push(directory);
      searchPaths.splice(protoPaths.length - 1, 0, directory);
      logical = path.basename(absolute);
    }
    loadLogical(logical, absolute);
    if (!entryFiles.includes(logical)) {
      entryFiles.push(logical);
    }
  }

  return { files: ordered, entryFiles };
}
