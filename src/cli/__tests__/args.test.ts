import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ImportExtension } from '../../options.ts';
import { parseCliArgs } from '../args.ts';

const parse = (...argv: string[]) => {
  const result = parseCliArgs(argv);
  assert.equal(result.error, null, result.error ?? undefined);
  assert.ok(result.data);
  return result.data;
};

describe('parseCliArgs', () => {
  it('applies the defaults', () => {
    const args = parse('a.proto');
    assert.deepEqual(args.files, ['a.proto']);
    assert.equal(args.codegen.importExtension, ImportExtension.Ts);
    assert.equal(args.codegen.shouldGenerateJson, true);
    assert.equal(args.shouldEmitDeclarations, true);
    assert.equal(args.shouldIncludeImports, true);
  });

  it('reads outputs, include paths and switches', () => {
    const args = parse(
      '-o',
      'ts',
      '--js-out',
      'js',
      '-I',
      'a',
      '--proto-path',
      'b',
      '--keep-case',
      '--no-json',
      '--no-comments',
      '--no-services',
      '--no-unknown-fields',
      '--no-declarations',
      '--only-inputs',
      '--file-suffix',
      '_pb',
      '--runtime-import',
      './rt.ts',
      'x.proto',
    );
    assert.equal(args.tsOut, 'ts');
    assert.equal(args.jsOut, 'js');
    assert.deepEqual(args.protoPaths, ['a', 'b']);
    assert.equal(args.codegen.shouldKeepCase, true);
    assert.equal(args.codegen.shouldGenerateJson, false);
    assert.equal(args.codegen.shouldIncludeComments, false);
    assert.equal(args.codegen.shouldGenerateServices, false);
    assert.equal(args.codegen.shouldKeepUnknownFields, false);
    assert.equal(args.shouldEmitDeclarations, false);
    assert.equal(args.shouldIncludeImports, false);
    assert.equal(args.codegen.fileSuffix, '_pb');
    assert.equal(args.codegen.runtimeImport, './rt.ts');
  });

  it('accepts the import extension with or without the dot', () => {
    assert.equal(
      parse('--import-extension', 'js', 'a.proto').codegen.importExtension,
      ImportExtension.Js,
    );
    assert.equal(
      parse('--import-extension', '.ts', 'a.proto').codegen.importExtension,
      ImportExtension.Ts,
    );
  });

  it('returns a message for invalid usage', () => {
    assert.match(parseCliArgs(['--import-extension', 'mjs']).error ?? '', /importExtension/);
    assert.match(parseCliArgs(['--unknown-flag']).error ?? '', /Unknown option/);
    assert.match(parseCliArgs(['--js-out']).error ?? '', /argument missing/);
  });

  it('recognizes help and version', () => {
    assert.equal(parse('-h').isHelp, true);
    assert.equal(parse('--version').isVersion, true);
  });
});
