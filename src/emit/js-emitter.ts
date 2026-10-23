import { isolatedDeclarationSync, transformSync } from 'oxc-transform';

import type { GeneratedFile } from '../codegen/file-generator.ts';
import { ProtoError, ProtoErrorCode } from '../errors.ts';

export interface JsEmitOptions {
  /** Also emit the `.d.ts` files. Default: true. */
  shouldEmitDeclarations?: boolean;
}

interface EmitDiagnostic {
  message: string;
}

const formatErrors = (fileName: string, errors: EmitDiagnostic[]): string =>
  `${fileName}: the generated code does not compile:\n${errors.map((error) => error.message).join('\n')}`;

/**
 * Turns the generated `.ts` files into ES modules (`.js`) and, optionally, declarations
 * (`.d.ts`). Both come from the TypeScript source, so the three outputs always agree. The
 * declarations need no type checker because the generated code annotates every public type.
 */
export function emitJavaScript(
  files: GeneratedFile[],
  options: JsEmitOptions = {},
): GeneratedFile[] {
  const output: GeneratedFile[] = [];
  for (const file of files) {
    const base = file.path.replace(/\.ts$/, '');
    const compiled = transformSync(file.path, file.content, { lang: 'ts', sourceType: 'module' });
    if (compiled.errors.length > 0) {
      throw new ProtoError(ProtoErrorCode.Emit, formatErrors(file.path, compiled.errors));
    }
    output.push({ path: `${base}.js`, content: compiled.code });

    if (options.shouldEmitDeclarations !== false) {
      const declarations = isolatedDeclarationSync(file.path, file.content);
      if (declarations.errors.length > 0) {
        throw new ProtoError(ProtoErrorCode.Emit, formatErrors(file.path, declarations.errors));
      }
      output.push({ path: `${base}.d.ts`, content: declarations.code });
    }
  }
  return output.sort((a, b) => a.path.localeCompare(b.path));
}
