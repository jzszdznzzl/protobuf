#!/usr/bin/env node
import { USAGE, parseCliArgs } from './cli/args.ts';
import { writeOutput } from './emit/output-writer.ts';
import { generate } from './generator.ts';
import pkg from '../package.json' with { type: 'json' };

const EXIT_ERROR = 1;
const EXIT_USAGE = 2;

function main(argv: string[]): number {
  const parsed = parseCliArgs(argv);
  if (parsed.error !== null) {
    process.stderr.write(`error: ${parsed.error}\n\n${USAGE}`);
    return EXIT_USAGE;
  }
  const args = parsed.data;
  if (args.isHelp) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (args.isVersion) {
    process.stdout.write(`${pkg.version}\n`);
    return 0;
  }
  if (args.files.length === 0) {
    process.stderr.write(`error: No .proto files given\n\n${USAGE}`);
    return EXIT_USAGE;
  }
  if (args.tsOut === undefined && args.jsOut === undefined) {
    process.stderr.write(`error: Specify at least --ts-out or --js-out\n\n${USAGE}`);
    return EXIT_USAGE;
  }

  const result = generate({
    ...args.codegen,
    files: args.files,
    protoPaths: args.protoPaths,
    shouldIncludeImports: args.shouldIncludeImports,
    ...(args.jsOut === undefined
      ? {}
      : { js: { shouldEmitDeclarations: args.shouldEmitDeclarations } }),
  });
  if (result.error !== null) {
    process.stderr.write(`error: ${result.error.message}\n`);
    return EXIT_ERROR;
  }

  for (const warning of result.data.warnings) {
    process.stderr.write(`warning: ${warning}\n`);
  }
  if (args.tsOut !== undefined) {
    const written = writeOutput(args.tsOut, result.data.ts);
    process.stdout.write(`TypeScript: ${written.length} files in ${args.tsOut}\n`);
  }
  if (args.jsOut !== undefined && result.data.js) {
    const written = writeOutput(args.jsOut, result.data.js);
    process.stdout.write(`JavaScript: ${written.length} files in ${args.jsOut}\n`);
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));
