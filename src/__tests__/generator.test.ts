import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { generate, generateFromSources } from '../generator.ts';
import type { GenerateResult } from '../generator.ts';
import { ProtoErrorCode } from '../errors.ts';
import { ImportExtension } from '../options.ts';
import { buildFixtures, FIXTURES_DIR, PROJECT_ROOT, RUNTIME_ENTRY } from './generated-fixtures.ts';

const TSC = path.join(PROJECT_ROOT, 'node_modules', '.bin', 'tsc');
const STRICT_FLAGS = {
  moduleDetection: 'force',
  isolatedModules: true,
  verbatimModuleSyntax: true,
  erasableSyntaxOnly: true,
  strict: true,
  noUncheckedIndexedAccess: true,
  exactOptionalPropertyTypes: true,
  noImplicitOverride: true,
  noImplicitReturns: true,
  noFallthroughCasesInSwitch: true,
  noPropertyAccessFromIndexSignature: true,
  noUnusedLocals: true,
  noUnusedParameters: true,
  target: 'ESNext',
  lib: ['ESNext'],
  types: ['node'],
  typeRoots: [path.join(PROJECT_ROOT, 'node_modules', '@types')],
  module: 'ESNext',
  moduleResolution: 'Bundler',
  allowImportingTsExtensions: true,
  noEmit: true,
} as const;

const fixtures = buildFixtures();
after(() => rmSync(fixtures.root, { recursive: true, force: true }));

const typecheck = (directory: string, include: string[], skipLibCheck: boolean): string => {
  const configPath = path.join(directory, 'tsconfig.json');
  writeFileSync(
    configPath,
    JSON.stringify({ compilerOptions: { ...STRICT_FLAGS, skipLibCheck }, include }),
  );
  const run = spawnSync(TSC, ['-p', configPath], { encoding: 'utf8' });
  return `${run.stdout}${run.stderr}`.trim();
};

const generated = (sources: Record<string, string>, options = {}): GenerateResult => {
  const result = generateFromSources(sources, { runtimeImport: RUNTIME_ENTRY, ...options });
  assert.equal(result.error, null, result.error?.message);
  assert.ok(result.data);
  return result.data;
};

const contentOf = (result: GenerateResult, file: string): string => {
  const found = result.ts.find((candidate) => candidate.path === file);
  assert.ok(found, `${file} was not generated`);
  return found.content;
};

describe('generated TypeScript', () => {
  it('passes the strictest compiler settings', () => {
    assert.equal(typecheck(fixtures.root, ['ts'], false), '');
  });

  it('is accepted as ESM by Node and has no namespaces or enums', () => {
    const text = readFileSync(path.join(fixtures.tsDir, 'kitchen.ts'), 'utf8');
    assert.doesNotMatch(text, /\bnamespace\b/);
    assert.doesNotMatch(text, /\bexport enum\b/);
    assert.match(text, /export class Kitchen_Inner implements Kitchen_InnerInit/);
    assert.match(text, /export const Kitchen_Kind: Readonly</);
  });
});

describe('generated JavaScript and declarations', () => {
  it('has declarations that a consumer can compile against', () => {
    const consumer = path.join(fixtures.root, 'consumer.ts');
    writeFileSync(
      consumer,
      `import { Kitchen, Kitchen_Inner, Color } from './js/kitchen.js';
import { Legacy, isKnownLegacy_Mode } from './js/legacy.js';

const inner: Kitchen_Inner = new Kitchen_Inner({ name: 'x' });
const kitchen: Kitchen = new Kitchen({ i32: 1, inner, color: Color.RED, byName: new Map([['k', { name: 'v' }]]) });
const decoded = Kitchen.decode(kitchen.toJSON() === undefined ? new Uint8Array() : Kitchen.encode(kitchen).finish());
if (decoded.error === null) {
  const count: number = decoded.data.i32;
  const which: 'a' | 'b' | 'c' | undefined = decoded.data.pick;
  void [count, which];
} else {
  const code: string = decoded.error.code;
  void code;
}
const legacy = Legacy.decode(new Uint8Array());
if (legacy.error === null && legacy.data.mode !== undefined && isKnownLegacy_Mode(legacy.data.mode)) {
  void legacy.data.mode;
}
`,
    );
    assert.equal(typecheck(fixtures.root, ['consumer.ts'], false), '');
  });

  it('uses ES module syntax with .js specifiers', () => {
    const text = readFileSync(path.join(fixtures.jsDir, 'kitchen.js'), 'utf8');
    assert.match(text, /^import \{ .* \} from "\.\/google\/protobuf\/any\.js";$/m);
    assert.match(text, /^export class Kitchen /m);
    assert.doesNotMatch(text, /\brequire\(|module\.exports/);
  });

  it('can skip the declarations', () => {
    const result = generate({
      files: [path.join(FIXTURES_DIR, 'legacy.proto')],
      protoPaths: [FIXTURES_DIR],
      js: { shouldEmitDeclarations: false },
    });
    assert.ok(result.data?.js?.every((file) => file.path.endsWith('.js')));
  });
});

describe('options', () => {
  const source = {
    'a.proto':
      'syntax = "proto3"; package p; import "b.proto"; message A { B b = 1; int32 field_name = 2; }',
    'b.proto': 'syntax = "proto3"; package p; message B {} service S { rpc Go(B) returns (B); }',
  };

  it('imports sibling files with the .ts extension by default and .js on request', () => {
    assert.match(contentOf(generated(source), 'a.ts'), /from "\.\/b\.ts"/);
    const asJs = generated(source, { importExtension: ImportExtension.Js });
    assert.match(contentOf(asJs, 'a.ts'), /from "\.\/b\.js"/);
  });

  it('keeps snake_case, adds a suffix and skips JSON and services on request', () => {
    const result = generated(source, {
      shouldKeepCase: true,
      fileSuffix: '_pb',
      shouldGenerateJson: false,
      shouldGenerateServices: false,
    });
    assert.deepEqual(
      result.ts.map((file) => file.path),
      ['b_pb.ts', 'a_pb.ts'],
    );
    const a = contentOf(result, 'a_pb.ts');
    assert.match(a, /field_name\?: number/);
    assert.match(a, /from "\.\/b_pb\.ts"/);
    assert.doesNotMatch(a, /toJSON|fromJSON/);
    assert.doesNotMatch(contentOf(result, 'b_pb.ts'), /interface S\b|SDefinition/);
  });

  it('drops unknown-field storage and comments on request', () => {
    const result = generated(
      { 'c.proto': 'syntax = "proto3"; // doc\nmessage C { int32 x = 1; }' },
      { shouldKeepUnknownFields: false, shouldIncludeComments: false },
    );
    const c = contentOf(result, 'c.ts');
    assert.doesNotMatch(c, /\$unknown/);
    assert.doesNotMatch(c, /\bdoc\b/);
  });

  it('generates only the requested files when imports are excluded', () => {
    const result = generate({
      files: [path.join(FIXTURES_DIR, 'kitchen.proto')],
      protoPaths: [FIXTURES_DIR],
      shouldIncludeImports: false,
    });
    assert.deepEqual(
      result.data?.ts.map((file) => file.path),
      ['kitchen.ts'],
    );
  });

  it('copies .proto comments as JSDoc', () => {
    const result = generated({
      'd.proto': 'syntax = "proto3";\n// A *documented* thing.\nmessage D { int32 x = 1; }',
    });
    assert.match(contentOf(result, 'd.ts'), /\/\*\*\n \* A \*documented\* thing\./);
  });
});

describe('failures are returned, not thrown', () => {
  it('reports syntax errors with their position', () => {
    const result = generateFromSources({ 'bad.proto': 'syntax = "proto3";\nmessage {' });
    assert.equal(result.data, null);
    assert.equal(result.error?.code, ProtoErrorCode.Syntax);
    assert.equal(result.error?.position?.line, 2);
  });

  it('reports missing and circular imports', () => {
    const missing = generateFromSources({ 'a.proto': 'syntax = "proto3"; import "nope.proto";' });
    assert.equal(missing.error?.code, ProtoErrorCode.Import);
    assert.match(missing.error?.message ?? '', /import "nope\.proto" not found/);

    const circular = generateFromSources({
      'a.proto': 'syntax = "proto3"; import "b.proto";',
      'b.proto': 'syntax = "proto3"; import "a.proto";',
    });
    assert.match(circular.error?.message ?? '', /Circular import/);
  });

  it('reports resolution errors', () => {
    const result = generateFromSources({
      'a.proto': 'syntax = "proto3"; message M { Nope n = 1; }',
    });
    assert.equal(result.error?.code, ProtoErrorCode.Resolution);
  });

  it('rejects invalid options before reading any file', () => {
    // @ts-expect-error: invalid on purpose, to check what callers without types would hit.
    const result = generate({ files: ['whatever.proto'], importExtension: '.mjs' });
    assert.equal(result.error?.code, ProtoErrorCode.InvalidOptions);
  });

  it('does not swallow bugs', () => {
    assert.throws(() =>
      generate({
        files: ['x.proto'],
        fileSystem: {
          readFile: () => {
            throw new TypeError('disk on fire');
          },
        },
      }),
    );
  });
});

describe('output paths', () => {
  it('keeps the folder structure of the .proto names', () => {
    const result = generated({ 'x/y/z.proto': 'syntax = "proto3"; message Z {}' });
    assert.equal(result.ts[0]?.path, 'x/y/z.ts');
  });
});
