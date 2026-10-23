import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { writeOutput } from '../emit/output-writer.ts';
import { generate } from '../generator.ts';

export const PROJECT_ROOT = path.join(import.meta.dirname, '..', '..');
export const RUNTIME_ENTRY = path.join(PROJECT_ROOT, 'src', 'runtime', 'index.ts');
export const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures');
export const FIXTURE_FILES = ['kitchen.proto', 'legacy.proto'];

export interface BuiltFixtures {
  root: string;
  tsDir: string;
  jsDir: string;
}

/** Generates the fixture protos once into a fresh temporary folder, as `.ts` and as `.js`. */
export function buildFixtures(): BuiltFixtures {
  const root = mkdtempSync(path.join(tmpdir(), 'protobuf-fixtures-'));
  const result = generate({
    files: FIXTURE_FILES.map((file) => path.join(FIXTURES_DIR, file)),
    protoPaths: [FIXTURES_DIR],
    runtimeImport: RUNTIME_ENTRY,
    js: {},
  });
  if (result.error !== null) {
    throw new Error(`fixtures failed to generate: ${result.error.message}`);
  }
  const tsDir = path.join(root, 'ts');
  const jsDir = path.join(root, 'js');
  writeOutput(tsDir, result.data.ts);
  writeOutput(jsDir, result.data.js ?? []);
  return { root, tsDir, jsDir };
}

export const moduleUrl = (directory: string, file: string): string =>
  pathToFileURL(path.join(directory, file)).href;
