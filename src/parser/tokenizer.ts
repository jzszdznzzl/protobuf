import type { SourcePosition } from '../ast/types.ts';
import { syntaxError } from '../errors.ts';
import type { ProtoError } from '../errors.ts';
import { TokenKind } from './token.ts';
import type { Token } from './token.ts';

interface PendingComment {
  text: string;
  startLine: number;
  endLine: number;
}

const SYMBOLS: ReadonlySet<string> = new Set([
  '{',
  '}',
  '[',
  ']',
  '(',
  ')',
  '<',
  '>',
  ';',
  ',',
  '=',
  '.',
  '-',
  '+',
  ':',
  '/',
]);

const MAX_BMP_CODE_POINT = 0xffff;
const MAX_HEX_ESCAPE_DIGITS = 2;
const MAX_OCTAL_ESCAPE_DIGITS = 3;
const SHORT_UNICODE_DIGITS = 4;
const LONG_UNICODE_DIGITS = 8;

const ESCAPED_BYTES: Readonly<Record<string, number>> = {
  a: 0x07,
  b: 0x08,
  f: 0x0c,
  n: 0x0a,
  r: 0x0d,
  t: 0x09,
  v: 0x0b,
  '\\': 0x5c,
  "'": 0x27,
  '"': 0x22,
  '?': 0x3f,
};

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder('utf-8', { ignoreBOM: true });

const isDigit = (char: string): boolean => char >= '0' && char <= '9';

const isHexDigit = (char: string): boolean =>
  isDigit(char) || (char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F');

const isIdentStart = (char: string): boolean =>
  (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || char === '_';

const isIdentPart = (char: string): boolean => isIdentStart(char) || isDigit(char);

const cleanLineComment = (text: string): string => text.replace(/^\/\/\/?\s?/, '').trimEnd();

const cleanBlockComment = (text: string): string => {
  const lines = text.split('\n').map((line) => line.replace(/^\s*\*?\s?/, '').trimEnd());
  while (lines[0] === '') {
    lines.shift();
  }
  while (lines.at(-1) === '') {
    lines.pop();
  }
  return lines.join('\n');
};

/**
 * Converts the text of a .proto into a list of tokens.
 *
 * - Removes `//` and block comments, but keeps them attached to the next token (leading
 *   comment) or to the previous one if they are on the same line (trailing comment), so they
 *   can be emitted as JSDoc.
 * - Decodes string literals into their exact bytes and their UTF-8 text.
 */
export class Tokenizer {
  #source: string;
  #fileName: string;
  #pos = 0;
  #line = 1;
  #column = 1;
  #tokens: Token[] = [];
  #pending: PendingComment[] = [];

  constructor(source: string, fileName: string) {
    this.#source = source;
    this.#fileName = fileName;
  }

  #here(): SourcePosition {
    return { line: this.#line, column: this.#column };
  }

  #peek(offset = 0): string {
    return this.#source[this.#pos + offset] ?? '';
  }

  #advance(): string {
    const char = this.#source[this.#pos++] ?? '';
    if (char === '\n') {
      this.#line++;
      this.#column = 1;
    } else {
      this.#column++;
    }
    return char;
  }

  #error(message: string): ProtoError {
    return syntaxError(message, this.#fileName, this.#here());
  }

  #push(token: Token): void {
    const block = this.#collectLeadingComment(token.position.line);
    if (block !== undefined) {
      token.leadingComment = block;
    }
    this.#tokens.push(token);
  }

  #collectLeadingComment(tokenLine: number): string | undefined {
    const pending = this.#pending;
    this.#pending = [];
    const last = pending.at(-1);
    if (last === undefined || last.endLine < tokenLine - 1) {
      return undefined;
    }
    // Take only the final contiguous block (blank lines separate blocks).
    let start = pending.length - 1;
    while (
      start > 0 &&
      (pending[start - 1]?.endLine ?? 0) >= (pending[start]?.startLine ?? 0) - 1
    ) {
      start--;
    }
    return pending
      .slice(start)
      .map((comment) => comment.text)
      .join('\n');
  }

  #addComment(text: string, startLine: number, endLine: number): void {
    const previous = this.#tokens.at(-1);
    if (
      previous !== undefined &&
      previous.kind !== TokenKind.Eof &&
      previous.endLine === startLine &&
      previous.trailingComment === undefined
    ) {
      previous.trailingComment = text;
      return;
    }
    this.#pending.push({ text, startLine, endLine });
  }

  #skipWhitespaceAndComments(): void {
    while (this.#pos < this.#source.length) {
      const char = this.#peek();
      if (
        char === ' ' ||
        char === '\t' ||
        char === '\r' ||
        char === '\n' ||
        char === '\f' ||
        char === '\v'
      ) {
        this.#advance();
      } else if (char === '/' && this.#peek(1) === '/') {
        const startLine = this.#line;
        let text = '';
        while (this.#pos < this.#source.length && this.#peek() !== '\n') {
          text += this.#advance();
        }
        this.#addComment(cleanLineComment(text), startLine, startLine);
      } else if (char === '/' && this.#peek(1) === '*') {
        const startLine = this.#line;
        let text = '';
        this.#advance();
        this.#advance();
        while (!(this.#peek() === '*' && this.#peek(1) === '/')) {
          if (this.#pos >= this.#source.length) {
            throw this.#error('Unterminated block comment');
          }
          text += this.#advance();
        }
        this.#advance();
        this.#advance();
        this.#addComment(cleanBlockComment(text), startLine, this.#line);
      } else {
        return;
      }
    }
  }

  #readIdentifier(): void {
    const position = this.#here();
    let text = '';
    while (isIdentPart(this.#peek())) {
      text += this.#advance();
    }
    this.#push({ kind: TokenKind.Identifier, text, position, endLine: position.line });
  }

  #readNumber(): void {
    const position = this.#here();
    let text = '';
    if (this.#peek() === '0' && (this.#peek(1) === 'x' || this.#peek(1) === 'X')) {
      text += this.#advance() + this.#advance();
      while (isHexDigit(this.#peek())) {
        text += this.#advance();
      }
    } else {
      while (isDigit(this.#peek()) || this.#peek() === '.') {
        text += this.#advance();
      }
      if (this.#peek() === 'e' || this.#peek() === 'E') {
        text += this.#advance();
        if (this.#peek() === '+' || this.#peek() === '-') {
          text += this.#advance();
        }
        while (isDigit(this.#peek())) {
          text += this.#advance();
        }
      }
      // Optional C-style float suffix (`1.0f`), allowed in options.
      if (this.#peek() === 'f' || this.#peek() === 'F') {
        text += this.#advance();
      }
    }
    if (isIdentStart(this.#peek())) {
      throw this.#error(`Invalid number '${text}${this.#peek()}'`);
    }
    this.#push({ kind: TokenKind.Number, text, position, endLine: position.line });
  }

  #readDigits(count: number, isValid: (char: string) => boolean): string {
    let digits = '';
    while (digits.length < count && isValid(this.#peek())) {
      digits += this.#advance();
    }
    return digits;
  }

  #readEscape(bytes: number[]): void {
    const char = this.#advance();
    const simple = ESCAPED_BYTES[char];
    if (simple !== undefined) {
      bytes.push(simple);
      return;
    }
    if (char === 'x' || char === 'X') {
      const hex = this.#readDigits(MAX_HEX_ESCAPE_DIGITS, isHexDigit);
      if (hex.length === 0) {
        throw this.#error('\\x escape without digits');
      }
      bytes.push(Number.parseInt(hex, 16));
      return;
    }
    if (char === 'u' || char === 'U') {
      const expected = char === 'u' ? SHORT_UNICODE_DIGITS : LONG_UNICODE_DIGITS;
      const hex = this.#readDigits(expected, isHexDigit);
      if (hex.length !== expected) {
        throw this.#error(`Escape \\${char} requires ${expected} hexadecimal digits`);
      }
      bytes.push(...utf8Encoder.encode(String.fromCodePoint(Number.parseInt(hex, 16))));
      return;
    }
    if (char >= '0' && char <= '7') {
      const rest = this.#readDigits(
        MAX_OCTAL_ESCAPE_DIGITS - 1,
        (next) => next >= '0' && next <= '7',
      );
      bytes.push(Number.parseInt(char + rest, 8) & 0xff);
      return;
    }
    throw this.#error(`Invalid escape sequence '\\${char}'`);
  }

  #readString(quote: string): void {
    const position = this.#here();
    this.#advance();
    const bytes: number[] = [];
    for (;;) {
      if (this.#pos >= this.#source.length || this.#peek() === '\n') {
        throw this.#error('Unterminated string');
      }
      const codePoint = this.#source.codePointAt(this.#pos) ?? 0;
      const char = this.#advance();
      if (char === quote) {
        break;
      }
      if (char === '\\') {
        this.#readEscape(bytes);
        continue;
      }
      bytes.push(...utf8Encoder.encode(String.fromCodePoint(codePoint)));
      if (codePoint > MAX_BMP_CODE_POINT) {
        // Second half of the surrogate pair.
        this.#advance();
      }
    }
    this.#push({
      kind: TokenKind.String,
      text: utf8Decoder.decode(Uint8Array.from(bytes)),
      bytes,
      position,
      endLine: this.#line,
    });
  }

  tokenize(): Token[] {
    for (;;) {
      this.#skipWhitespaceAndComments();
      if (this.#pos >= this.#source.length) {
        this.#push({ kind: TokenKind.Eof, text: '', position: this.#here(), endLine: this.#line });
        return this.#tokens;
      }
      const char = this.#peek();
      if (isIdentStart(char)) {
        this.#readIdentifier();
      } else if (isDigit(char) || (char === '.' && isDigit(this.#peek(1)))) {
        this.#readNumber();
      } else if (char === '"' || char === "'") {
        this.#readString(char);
      } else if (SYMBOLS.has(char)) {
        const position = this.#here();
        this.#advance();
        this.#push({ kind: TokenKind.Symbol, text: char, position, endLine: position.line });
      } else {
        throw this.#error(`Unexpected character '${char}'`);
      }
    }
  }
}
