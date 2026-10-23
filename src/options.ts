import { z } from 'zod';

export const ImportExtension = Object.freeze({
  Js: '.js',
  Ts: '.ts',
} as const);

export type ImportExtension = (typeof ImportExtension)[keyof typeof ImportExtension];

/** Module the generated code imports the runtime from by default. */
export const DEFAULT_RUNTIME_IMPORT = '@jzszdznzzl/protobuf/runtime';

/** Options that change the generated code. Validated at the API and CLI boundaries. */
export const CodegenOptions = z.object({
  /** Keep field names in snake_case instead of converting them to camelCase. */
  shouldKeepCase: z.boolean().default(false),
  /** Extension of the relative imports in the `.ts` output. The `.js` output always uses `.js`. */
  importExtension: z.enum(ImportExtension).default(ImportExtension.Ts),
  /** Module the generated code imports the runtime from. */
  runtimeImport: z.string().min(1).default(DEFAULT_RUNTIME_IMPORT),
  /** Suffix for the generated files: `foo.proto` becomes `foo${suffix}.ts`. */
  fileSuffix: z.string().default(''),
  /** Copy the .proto comments as JSDoc. */
  shouldIncludeComments: z.boolean().default(true),
  /** Generate interfaces and descriptors for `service`s. */
  shouldGenerateServices: z.boolean().default(true),
  /** Keep unknown fields when decoding (`$unknown`) and write them back when encoding. */
  shouldKeepUnknownFields: z.boolean().default(true),
  /** Generate `toJSON()` / `fromJSON()` (canonical proto3 JSON mapping). */
  shouldGenerateJson: z.boolean().default(true),
});

export type CodegenOptions = z.infer<typeof CodegenOptions>;

export type CodegenOptionsInput = z.input<typeof CodegenOptions>;
