const INDENT_UNIT = '  ';

/** Line accumulator with indentation handling. */
export class CodeWriter {
  #lines: string[] = [];
  #level = 0;

  /** Adds a line with the current indentation (no argument: an empty line). */
  line(text = ''): this {
    this.#lines.push(text === '' ? '' : INDENT_UNIT.repeat(this.#level) + text);
    return this;
  }

  indent(): this {
    this.#level++;
    return this;
  }

  dedent(): this {
    if (this.#level === 0) {
      throw new Error('CodeWriter: dedent() without indent()');
    }
    this.#level--;
    return this;
  }

  /** Writes `header`, runs `body` indented and closes with `footer` (`}` by default). */
  block(header: string, body: () => void, footer = '}'): this {
    this.line(header);
    this.indent();
    body();
    this.dedent();
    this.line(footer);
    return this;
  }

  /** Adds every non-empty line of a multi-line snippet at the current indentation. */
  lines(text: string): this {
    for (const line of text.split('\n')) {
      if (line !== '') {
        this.line(line);
      }
    }
    return this;
  }

  toString(): string {
    while (this.#lines.at(-1) === '') {
      this.#lines.pop();
    }
    return `${this.#lines.join('\n')}\n`;
  }
}
