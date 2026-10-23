import { parseArgs } from 'node:util';

import { z } from 'zod';

import { CodegenOptions } from '../options.ts';
import { fail, ok } from '../result.ts';
import type { Result } from '../result.ts';

export const USAGE = `Usage: pb [options] <file.proto ...>

Generates TypeScript/JavaScript classes with encode/decode/new from .proto files
(proto2, proto3 or editions). 64-bit integers are represented as bigint.
The JavaScript output is always ESM.

Output (at least one):
  -o, --ts-out <dir>          Folder for the .ts files
  --js-out <dir>              Folder for the .js + .d.ts files

Options:
  -I, --proto-path <dir>      Directory to search for imports (repeatable)
  --no-declarations           Do not generate .d.ts next to the JS output
  --keep-case                 Keep snake_case field names
  --import-extension <ext>    Extension of relative imports in the .ts output: ts | js (default: ts)
  --runtime-import <module>   Module to import the runtime from (default: @jzszdznzzl/protobuf/runtime)
  --file-suffix <suffix>      File suffix: foo.proto becomes foo<suffix>.ts
  --no-comments               Do not copy the .proto comments
  --no-services               Do not generate service interfaces
  --no-unknown-fields         Do not keep unknown fields when decoding
  --no-json                   Do not generate toJSON()/fromJSON()
  --only-inputs               Generate only the input files, not their imports
  -h, --help                  Show this help
  -v, --version               Show the version
`;

export const CliArgs = z.object({
  files: z.array(z.string()),
  protoPaths: z.array(z.string()),
  tsOut: z.string().optional(),
  jsOut: z.string().optional(),
  shouldEmitDeclarations: z.boolean(),
  shouldIncludeImports: z.boolean(),
  codegen: CodegenOptions,
  isHelp: z.boolean(),
  isVersion: z.boolean(),
});

export type CliArgs = z.infer<typeof CliArgs>;

const PARSE_OPTIONS = {
  'proto-path': { type: 'string', short: 'I', multiple: true },
  'ts-out': { type: 'string', short: 'o' },
  'js-out': { type: 'string' },
  'no-declarations': { type: 'boolean' },
  'keep-case': { type: 'boolean' },
  'import-extension': { type: 'string' },
  'runtime-import': { type: 'string' },
  'file-suffix': { type: 'string' },
  'no-comments': { type: 'boolean' },
  'no-services': { type: 'boolean' },
  'no-unknown-fields': { type: 'boolean' },
  'no-json': { type: 'boolean' },
  'only-inputs': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const;

/** Returns the message to show the user when the arguments are not valid. */
export function parseCliArgs(argv: string[]): Result<CliArgs, string> {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: PARSE_OPTIONS });
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  const { values } = parsed;

  // Absent flags stay `undefined`, so the schema defaults apply.
  const candidate = {
    files: parsed.positionals,
    protoPaths: values['proto-path'] ?? [],
    tsOut: values['ts-out'],
    jsOut: values['js-out'],
    shouldEmitDeclarations: !values['no-declarations'],
    shouldIncludeImports: !values['only-inputs'],
    codegen: {
      shouldKeepCase: values['keep-case'],
      importExtension:
        values['import-extension'] === undefined
          ? undefined
          : `.${values['import-extension'].replace(/^\./, '')}`,
      runtimeImport: values['runtime-import'],
      fileSuffix: values['file-suffix'],
      shouldIncludeComments: values['no-comments'] ? false : undefined,
      shouldGenerateServices: values['no-services'] ? false : undefined,
      shouldKeepUnknownFields: values['no-unknown-fields'] ? false : undefined,
      shouldGenerateJson: values['no-json'] ? false : undefined,
    },
    isHelp: values.help === true,
    isVersion: values.version === true,
  };
  const result = CliArgs.safeParse(candidate);
  if (!result.success) {
    return fail(z.prettifyError(result.error));
  }
  return ok(result.data);
}
