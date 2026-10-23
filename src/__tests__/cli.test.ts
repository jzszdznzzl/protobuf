import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import pkg from '../../package.json' with { type: 'json' };
import { FIXTURES_DIR, PROJECT_ROOT } from './generated-fixtures.ts';

const CLI = path.join(PROJECT_ROOT, 'src', 'cli.ts');
const output = mkdtempSync(path.join(tmpdir(), 'protobuf-cli-'));
after(() => rmSync(output, { recursive: true, force: true }));

const run = (...args: string[]) =>
  spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

describe('pb CLI', () => {
  it('prints the version and the usage', () => {
    assert.equal(run('--version').stdout.trim(), pkg.version);
    assert.match(run('--help').stdout, /^Usage: pb /);
  });

  it('exits with 2 and the usage when the arguments are wrong', () => {
    for (const args of [[], ['a.proto'], ['--nope']]) {
      const result = run(...args);
      assert.equal(result.status, 2, args.join(' '));
      assert.match(result.stderr, /Usage: pb /);
    }
  });

  it('generates TypeScript and JavaScript', () => {
    const result = run(
      '-o',
      path.join(output, 'ts'),
      '--js-out',
      path.join(output, 'js'),
      '-I',
      FIXTURES_DIR,
      path.join(FIXTURES_DIR, 'legacy.proto'),
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /TypeScript: \d+ files/);
    assert.ok(existsSync(path.join(output, 'ts', 'legacy.ts')));
    assert.ok(existsSync(path.join(output, 'js', 'legacy.js')));
    assert.ok(existsSync(path.join(output, 'js', 'legacy.d.ts')));
  });

  it('exits with 1 and the reason when the .proto is wrong', () => {
    const result = run('-o', path.join(output, 'bad'), path.join(FIXTURES_DIR, 'missing.proto'));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^error: /);
  });
});
