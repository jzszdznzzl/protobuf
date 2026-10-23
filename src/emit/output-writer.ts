import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { GeneratedFile } from '../codegen/file-generator.ts';

/** Writes the generated files into `outDir`, creating the necessary folders. */
export function writeOutput(outDir: string, files: GeneratedFile[]): string[] {
  return files.map((file) => {
    const target = path.join(outDir, ...file.path.split('/'));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, file.content, 'utf8');
    return target;
  });
}
