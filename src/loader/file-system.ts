import { readFileSync } from 'node:fs';

/** Minimal file system abstraction, so the generator can run in memory. */
export interface FileSystemHost {
  /** Returns the file contents or `undefined` if it does not exist. */
  readFile(absolutePath: string): string | undefined;
}

const isMissingFileError = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

export const nodeFileSystem: FileSystemHost = {
  readFile(absolutePath) {
    try {
      return readFileSync(absolutePath, 'utf8');
    } catch (error) {
      if (isMissingFileError(error)) {
        return undefined;
      }
      throw error;
    }
  },
};

/** In-memory file system: the key is the absolute path normalized with `/`. */
export function memoryFileSystem(files: Record<string, string>): FileSystemHost {
  return {
    readFile(absolutePath) {
      return files[absolutePath.replaceAll('\\', '/')];
    },
  };
}
