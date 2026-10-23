import type { SourcePosition } from '../ast/types.ts';

export const TokenKind = Object.freeze({
  Identifier: 'identifier',
  String: 'string',
  Number: 'number',
  Symbol: 'symbol',
  Eof: 'eof',
} as const);

export type TokenKind = (typeof TokenKind)[keyof typeof TokenKind];

export interface Token {
  kind: TokenKind;
  /** Original text of the token (for strings: the content decoded as UTF-8). */
  text: string;
  /** Strings only: exact bytes of the literal (useful for `bytes` defaults). */
  bytes?: number[];
  position: SourcePosition;
  /** Line where the token ends. */
  endLine: number;
  /** Comment block immediately before (with no blank line in between). */
  leadingComment?: string;
  /** Comment on the same line, immediately after the token. */
  trailingComment?: string;
}
