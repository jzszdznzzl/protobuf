import path from 'node:path';

import type { CodegenOptions } from '../options.ts';

/** `a/b/foo.proto` becomes `a/b/foo` plus the suffix, always separated by `/`. */
export function outputBaseName(
  protoFileName: string,
  options: Pick<CodegenOptions, 'fileSuffix'>,
): string {
  return protoFileName.replace(/\.proto$/, '') + options.fileSuffix;
}

/** Relative module specifier from `fromBase` to `toBase`, both without extension. */
export function relativeModule(fromBase: string, toBase: string, extension: string): string {
  const relative = path.posix.relative(path.posix.dirname(fromBase), toBase);
  return (relative.startsWith('.') ? relative : `./${relative}`) + extension;
}
