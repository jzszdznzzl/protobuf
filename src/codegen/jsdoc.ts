import type { CodeWriter } from './code-writer.ts';

export interface JsDocInput {
  comment?: string | undefined;
  isDeprecated?: boolean | undefined;
  /** Additional lines, such as `Field 3: int64`. */
  extra?: string[];
}

/** Writes a JSDoc block if there is anything to document. */
export function writeJsDoc(
  writer: CodeWriter,
  doc: JsDocInput,
  shouldIncludeComments: boolean,
): void {
  const lines: string[] = [];
  if (shouldIncludeComments && doc.comment) {
    lines.push(...doc.comment.split('\n'));
  }
  if (doc.extra?.length) {
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push(...doc.extra);
  }
  if (doc.isDeprecated) {
    lines.push('@deprecated');
  }
  if (lines.length === 0) {
    return;
  }

  const safe = lines.map((line) => line.replaceAll('*/', '*\\/'));
  const [only] = safe;
  if (safe.length === 1 && only !== undefined) {
    writer.line(`/** ${only} */`);
    return;
  }
  writer.line('/**');
  for (const line of safe) {
    writer.line(line ? ` * ${line}` : ' *');
  }
  writer.line(' */');
}
