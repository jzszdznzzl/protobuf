import {
  EDITIONS,
  FieldLabel,
  ImportModifier,
  MAX_FIELD_NUMBER,
  NodeKind,
  OptionValueKind,
  Syntax,
} from '../ast/types.ts';
import type {
  Edition,
  EnumNode,
  EnumValueNode,
  ExtendNode,
  FieldNode,
  ImportNode,
  MessageNode,
  OneOfNode,
  OptionValue,
  ProtoFileNode,
  ProtoOption,
  ReservedRange,
  RpcNode,
  ServiceNode,
} from '../ast/types.ts';
import { syntaxError } from '../errors.ts';
import type { ProtoError } from '../errors.ts';
import { TokenKind } from './token.ts';
import type { Token } from './token.ts';
import { Tokenizer } from './tokenizer.ts';

/** Container of declarations being parsed (a message, a group or an `extend`). */
interface MessageBody {
  fields: FieldNode[];
  oneOfs: OneOfNode[];
  messages: MessageNode[];
  enums: EnumNode[];
  extends: ExtendNode[];
  options: ProtoOption[];
  reservedRanges: ReservedRange[];
  reservedNames: string[];
  extensionRanges: ReservedRange[];
}

const BYTE_ORDER_MARK = 0xfeff;
const RESERVED_FIELD_NUMBERS = { from: 19000, to: 19999 } as const;
const ENUM_MIN = -2147483648;
const ENUM_MAX = 2147483647;
const NAMED_LABELS = [FieldLabel.Optional, FieldLabel.Required, FieldLabel.Repeated] as const;
const IMPORT_MODIFIERS = [ImportModifier.Public, ImportModifier.Weak] as const;

const isValidFieldNumber = (value: number): boolean =>
  Number.isInteger(value) &&
  value >= 1 &&
  value <= MAX_FIELD_NUMBER &&
  !(value >= RESERVED_FIELD_NUMBERS.from && value <= RESERVED_FIELD_NUMBERS.to);

const parseIntLiteral = (text: string): number | undefined => {
  if (/^0[xX][0-9a-fA-F]+$/.test(text)) {
    return Number.parseInt(text.slice(2), 16);
  }
  if (/^0[0-7]+$/.test(text)) {
    return Number.parseInt(text.slice(1), 8);
  }
  if (/^(0|[1-9][0-9]*)$/.test(text)) {
    return Number.parseInt(text, 10);
  }
  return undefined;
};

const parseNumberLiteral = (raw: string): number => {
  const isNegative = raw.startsWith('-');
  const body = isNegative ? raw.slice(1) : raw;
  const value = parseIntLiteral(body) ?? Number.parseFloat(body.replace(/[fF]$/, ''));
  return isNegative ? -value : value;
};

const keywordOf = (token: Token): string => (token.kind === TokenKind.Identifier ? token.text : '');

/**
 * Parses the contents of a .proto file (proto2, proto3 or editions). Throws a `ProtoError`.
 *
 * @param source Text of the file.
 * @param fileName Logical name, used in errors and to resolve imports.
 */
export function parseProto(source: string, fileName = '<input>'): ProtoFileNode {
  return new Parser(source, fileName).parseFile();
}

class Parser {
  #fileName: string;
  #tokens: readonly Token[];
  #index = 0;
  #syntax: Syntax = Syntax.Proto2;
  #edition: Edition | undefined;

  constructor(source: string, fileName: string) {
    this.#fileName = fileName;
    const hasBom = source.charCodeAt(0) === BYTE_ORDER_MARK;
    this.#tokens = new Tokenizer(hasBom ? source.slice(1) : source, fileName).tokenize();
  }

  get #current(): Token {
    const token = this.#tokens[this.#index];
    if (token === undefined) {
      throw new RangeError(`Invalid token index: ${this.#index}`);
    }
    return token;
  }

  #lookAhead(offset: number): Token {
    const token = this.#tokens[Math.min(this.#index + offset, this.#tokens.length - 1)];
    if (token === undefined) {
      throw new RangeError(`Invalid token index: ${this.#index + offset}`);
    }
    return token;
  }

  #next(): Token {
    const token = this.#current;
    if (token.kind !== TokenKind.Eof) {
      this.#index++;
    }
    return token;
  }

  #previous(): Token {
    const token = this.#tokens[this.#index - 1];
    if (token === undefined) {
      throw new RangeError(`Invalid token index: ${this.#index - 1}`);
    }
    return token;
  }

  #error(message: string, token: Token = this.#current): ProtoError {
    return syntaxError(message, this.#fileName, token.position);
  }

  #is(text: string): boolean {
    const token = this.#current;
    return (
      (token.kind === TokenKind.Symbol || token.kind === TokenKind.Identifier) &&
      token.text === text
    );
  }

  #accept(text: string): boolean {
    if (!this.#is(text)) {
      return false;
    }
    this.#next();
    return true;
  }

  #expect(text: string): Token {
    if (!this.#is(text)) {
      const token = this.#current;
      const found = token.kind === TokenKind.Eof ? 'end of file' : `'${token.text}'`;
      throw this.#error(`Expected '${text}' but found ${found}`);
    }
    return this.#next();
  }

  #expectIdentifier(what = 'identifier'): Token {
    if (this.#current.kind !== TokenKind.Identifier) {
      throw this.#error(`Expected ${what}`);
    }
    return this.#next();
  }

  #expectString(): string {
    if (this.#current.kind !== TokenKind.String) {
      throw this.#error('Expected a string');
    }
    let value = '';
    while (this.#current.kind === TokenKind.String) {
      value += this.#next().text;
    }
    return value;
  }

  /** `ident ("." ident)*`, optionally with a leading dot (fully qualified name). */
  #parseTypeName(): string {
    let name = this.#accept('.') ? '.' : '';
    name += this.#expectIdentifier('type name').text;
    while (this.#accept('.')) {
      name += `.${this.#expectIdentifier('type name').text}`;
    }
    return name;
  }

  #parseInteger(isNegativeAllowed: boolean): number {
    let isNegative = false;
    if (this.#is('-')) {
      if (!isNegativeAllowed) {
        throw this.#error('Negative numbers are not allowed here');
      }
      this.#next();
      isNegative = true;
    } else {
      this.#accept('+');
    }
    const token = this.#current;
    if (token.kind !== TokenKind.Number) {
      throw this.#error('Expected an integer');
    }
    this.#next();
    const value = parseIntLiteral(token.text);
    if (value === undefined) {
      throw this.#error(`Invalid integer '${token.text}'`, token);
    }
    return isNegative ? -value : value;
  }

  #parseFieldNumber(token: Token = this.#current): number {
    const number = this.#parseInteger(false);
    if (!isValidFieldNumber(number)) {
      throw this.#error(`Invalid field number ${number}`, token);
    }
    return number;
  }

  #commentOf(start: Token): string | undefined {
    return start.leadingComment ?? this.#previous().trailingComment;
  }

  #parseOptionStatement(): ProtoOption {
    this.#expect('option');
    const option = this.#parseOptionAssignment();
    this.#expect(';');
    return option;
  }

  #parseOptionAssignment(): ProtoOption {
    const name = this.#parseOptionName();
    this.#expect('=');
    return { name, value: this.#parseOptionValue() };
  }

  #parseOptionName(): string {
    let name = '';
    for (;;) {
      if (this.#accept('(')) {
        name += `(${this.#parseTypeName()})`;
        this.#expect(')');
      } else {
        name += this.#expectIdentifier('option name').text;
      }
      if (!this.#accept('.')) {
        return name;
      }
      name += '.';
    }
  }

  #parseOptionValue(): OptionValue {
    if (this.#current.kind === TokenKind.String) {
      const bytes: number[] = [];
      let value = '';
      while (this.#current.kind === TokenKind.String) {
        const part = this.#next();
        value += part.text;
        bytes.push(...(part.bytes ?? []));
      }
      return { kind: OptionValueKind.String, value, bytes };
    }
    if (this.#is('{')) {
      return { kind: OptionValueKind.Aggregate, raw: this.#captureAggregate() };
    }

    let sign = '';
    if (this.#is('-') || this.#is('+')) {
      sign = this.#next().text === '-' ? '-' : '';
    }
    const token = this.#current;
    if (token.kind === TokenKind.Number) {
      this.#next();
      const raw = sign + token.text;
      return { kind: OptionValueKind.Number, value: parseNumberLiteral(raw), raw };
    }
    if (token.kind === TokenKind.Identifier) {
      this.#next();
      if (token.text === 'inf' || token.text === 'nan') {
        const value = token.text === 'inf' ? Number.POSITIVE_INFINITY : Number.NaN;
        return {
          kind: OptionValueKind.Number,
          value: sign ? -value : value,
          raw: sign + token.text,
        };
      }
      if (sign) {
        throw this.#error('Invalid sign before an identifier', token);
      }
      if (token.text === 'true' || token.text === 'false') {
        return { kind: OptionValueKind.Bool, value: token.text === 'true' };
      }
      let identifier = token.text;
      while (this.#accept('.')) {
        identifier += `.${this.#expectIdentifier().text}`;
      }
      return { kind: OptionValueKind.Identifier, value: identifier };
    }
    throw this.#error('Invalid option value');
  }

  /** Captures an aggregate value `{ ... }` (text format) as raw text. */
  #captureAggregate(): string {
    const parts: string[] = [];
    let depth = 0;
    do {
      const token = this.#next();
      if (token.kind === TokenKind.Eof) {
        throw this.#error('Unterminated option aggregate', token);
      }
      if (token.text === '{') {
        depth++;
      }
      if (token.text === '}') {
        depth--;
      }
      parts.push(token.kind === TokenKind.String ? JSON.stringify(token.text) : token.text);
    } while (depth > 0);
    return parts.join(' ');
  }

  /** `[a = 1, (b).c = "x"]` */
  #parseFieldOptions(): ProtoOption[] {
    const options: ProtoOption[] = [];
    if (!this.#accept('[')) {
      return options;
    }
    do {
      options.push(this.#parseOptionAssignment());
    } while (this.#accept(','));
    this.#expect(']');
    return options;
  }

  #newBody(): MessageBody {
    return {
      fields: [],
      oneOfs: [],
      messages: [],
      enums: [],
      extends: [],
      options: [],
      reservedRanges: [],
      reservedNames: [],
      extensionRanges: [],
    };
  }

  #parseMessage(): MessageNode {
    const start = this.#expect('message');
    const name = this.#expectIdentifier('message name').text;
    const body = this.#newBody();
    this.#parseMessageBody(body);
    return {
      kind: NodeKind.Message,
      name,
      comment: start.leadingComment,
      position: start.position,
      ...body,
    };
  }

  #parseMessageBody(body: MessageBody): void {
    this.#expect('{');
    while (!this.#accept('}')) {
      if (this.#current.kind === TokenKind.Eof) {
        throw this.#error("Unterminated message ('}')");
      }
      this.#parseMessageElement(body);
    }
  }

  #parseMessageElement(body: MessageBody): void {
    if (this.#accept(';')) {
      return;
    }
    switch (keywordOf(this.#current)) {
      case 'export':
      case 'local': {
        if (this.#edition !== undefined && ['message', 'enum'].includes(this.#lookAhead(1).text)) {
          this.#next();
          this.#parseMessageElement(body);
          return;
        }
        break;
      }
      case 'message': {
        body.messages.push(this.#parseMessage());
        return;
      }
      case 'enum': {
        body.enums.push(this.#parseEnum());
        return;
      }
      case 'extend': {
        const extend = this.#parseExtend();
        body.extends.push(extend);
        body.messages.push(...extend.groupMessages);
        return;
      }
      case 'option': {
        body.options.push(this.#parseOptionStatement());
        return;
      }
      case 'oneof': {
        this.#parseOneOf(body);
        return;
      }
      case 'reserved': {
        this.#parseReserved(body.reservedRanges, body.reservedNames);
        return;
      }
      case 'extensions': {
        this.#next();
        body.extensionRanges.push(...this.#parseRanges());
        this.#parseFieldOptions();
        this.#expect(';');
        return;
      }
      case 'map': {
        if (this.#lookAhead(1).text === '<') {
          body.fields.push(this.#parseMapField());
          return;
        }
        break;
      }
      default: {
        break;
      }
    }
    body.fields.push(this.#parseField(body, undefined));
  }

  #parseLabel(): FieldLabel {
    const token = this.#current;
    const label = NAMED_LABELS.find((candidate) => candidate === token.text);
    // `optional` can also be a type name; check that it is not `optional = 1`.
    if (
      token.kind === TokenKind.Identifier &&
      label !== undefined &&
      this.#lookAhead(1).text !== '='
    ) {
      this.#next();
      return label;
    }
    return FieldLabel.None;
  }

  #isGroupStart(): boolean {
    return (
      this.#is('group') &&
      this.#lookAhead(1).kind === TokenKind.Identifier &&
      this.#lookAhead(2).kind === TokenKind.Symbol &&
      this.#lookAhead(2).text === '='
    );
  }

  /** Regular field or proto2 `group`. If `oneOfIndex` is defined, the field has no label. */
  #parseField(body: MessageBody, oneOfIndex: number | undefined): FieldNode {
    const start = this.#current;
    const label = oneOfIndex === undefined ? this.#parseLabel() : FieldLabel.None;

    if (label === FieldLabel.Required && this.#syntax === Syntax.Proto3) {
      throw this.#error("'required' is not allowed in proto3", start);
    }
    if (
      label === FieldLabel.None &&
      oneOfIndex === undefined &&
      this.#syntax === Syntax.Proto2 &&
      this.#edition === undefined &&
      !this.#isGroupStart()
    ) {
      throw this.#error('In proto2 fields require a label (optional, required or repeated)', start);
    }

    if (this.#isGroupStart()) {
      return this.#parseGroup(start, label, body, oneOfIndex);
    }

    const typeName = this.#parseTypeName();
    const name = this.#expectIdentifier('field name').text;
    this.#expect('=');
    const number = this.#parseFieldNumber();
    const options = this.#parseFieldOptions();
    this.#expect(';');

    const field: FieldNode = {
      kind: NodeKind.Field,
      name,
      number,
      label,
      typeName,
      options,
      comment: this.#commentOf(start),
      position: start.position,
    };
    if (oneOfIndex !== undefined) {
      field.oneOfIndex = oneOfIndex;
    }
    return field;
  }

  #parseGroup(
    start: Token,
    label: FieldLabel,
    body: MessageBody,
    oneOfIndex: number | undefined,
  ): FieldNode {
    if (this.#syntax === Syntax.Proto3) {
      throw this.#error("'group' is not allowed in proto3");
    }
    this.#expect('group');
    const nameToken = this.#expectIdentifier('group name');
    const groupName = nameToken.text;
    if (!/^[A-Z]/.test(groupName)) {
      throw this.#error('A group name must start with an uppercase letter', nameToken);
    }
    this.#expect('=');
    const number = this.#parseFieldNumber();
    const options = this.#parseFieldOptions();
    const groupBody = this.#newBody();
    this.#parseMessageBody(groupBody);

    const groupMessage: MessageNode = {
      kind: NodeKind.Message,
      name: groupName,
      position: start.position,
      isGroup: true,
      ...groupBody,
    };
    body.messages.push(groupMessage);

    const field: FieldNode = {
      kind: NodeKind.Field,
      name: groupName.toLowerCase(),
      number,
      label,
      typeName: groupName,
      options,
      comment: start.leadingComment,
      position: start.position,
      group: groupMessage,
    };
    if (oneOfIndex !== undefined) {
      field.oneOfIndex = oneOfIndex;
    }
    return field;
  }

  #parseMapField(): FieldNode {
    const start = this.#expect('map');
    this.#expect('<');
    const keyType = this.#parseTypeName();
    this.#expect(',');
    const valueType = this.#parseTypeName();
    this.#expect('>');
    const name = this.#expectIdentifier('field name').text;
    this.#expect('=');
    const number = this.#parseFieldNumber();
    const options = this.#parseFieldOptions();
    this.#expect(';');
    return {
      kind: NodeKind.Field,
      name,
      number,
      label: FieldLabel.Repeated,
      typeName: `map<${keyType},${valueType}>`,
      map: { keyType, valueType },
      options,
      comment: this.#commentOf(start),
      position: start.position,
    };
  }

  #parseOneOf(body: MessageBody): void {
    const start = this.#expect('oneof');
    const oneof: OneOfNode = {
      name: this.#expectIdentifier('oneof name').text,
      options: [],
      comment: start.leadingComment,
    };
    const index = body.oneOfs.length;
    body.oneOfs.push(oneof);
    this.#expect('{');
    while (!this.#accept('}')) {
      if (this.#current.kind === TokenKind.Eof) {
        throw this.#error("Unterminated oneof ('}')");
      }
      if (this.#accept(';')) {
        continue;
      }
      if (this.#is('option')) {
        oneof.options.push(this.#parseOptionStatement());
        continue;
      }
      if (NAMED_LABELS.some((label) => this.#is(label)) && this.#lookAhead(1).text !== '=') {
        throw this.#error('Oneof fields cannot have a label');
      }
      if (this.#is('map') && this.#lookAhead(1).text === '<') {
        throw this.#error('A oneof cannot contain maps');
      }
      body.fields.push(this.#parseField(body, index));
    }
  }

  #parseRanges(): ReservedRange[] {
    const ranges: ReservedRange[] = [];
    do {
      const from = this.#parseInteger(true);
      let to = from;
      if (this.#accept('to')) {
        to = this.#accept('max') ? MAX_FIELD_NUMBER : this.#parseInteger(true);
      }
      ranges.push({ from, to });
    } while (this.#accept(','));
    return ranges;
  }

  #parseReserved(ranges: ReservedRange[], names: string[]): void {
    this.#expect('reserved');
    if (this.#current.kind === TokenKind.String || this.#current.kind === TokenKind.Identifier) {
      do {
        names.push(
          this.#current.kind === TokenKind.String
            ? this.#expectString()
            : this.#expectIdentifier().text,
        );
      } while (this.#accept(','));
    } else {
      ranges.push(...this.#parseRanges());
    }
    this.#expect(';');
  }

  #parseEnum(): EnumNode {
    const start = this.#expect('enum');
    const name = this.#expectIdentifier('enum name').text;
    const node: EnumNode = {
      kind: NodeKind.Enum,
      name,
      values: [],
      options: [],
      reservedRanges: [],
      reservedNames: [],
      comment: start.leadingComment,
      position: start.position,
    };
    this.#expect('{');
    while (!this.#accept('}')) {
      if (this.#current.kind === TokenKind.Eof) {
        throw this.#error("Unterminated enum ('}')");
      }
      if (this.#accept(';')) {
        continue;
      }
      if (this.#is('option')) {
        node.options.push(this.#parseOptionStatement());
      } else if (this.#is('reserved')) {
        this.#parseReserved(node.reservedRanges, node.reservedNames);
      } else {
        node.values.push(this.#parseEnumValue());
      }
    }
    const first = node.values[0];
    if (first === undefined) {
      throw this.#error(`The enum '${name}' has no values`, start);
    }
    if (this.#syntax === Syntax.Proto3 && first.number !== 0) {
      throw this.#error(`In proto3 the first value of the enum '${name}' must be 0`, start);
    }
    return node;
  }

  #parseEnumValue(): EnumValueNode {
    const start = this.#current;
    const name = this.#expectIdentifier('enum value name').text;
    this.#expect('=');
    const number = this.#parseInteger(true);
    if (number < ENUM_MIN || number > ENUM_MAX) {
      throw this.#error(`Enum value outside the int32 range: ${number}`, start);
    }
    const options = this.#parseFieldOptions();
    this.#expect(';');
    return { name, number, options, comment: this.#commentOf(start) };
  }

  #parseService(): ServiceNode {
    const start = this.#expect('service');
    const service: ServiceNode = {
      kind: NodeKind.Service,
      name: this.#expectIdentifier('service name').text,
      methods: [],
      options: [],
      comment: start.leadingComment,
      position: start.position,
    };
    this.#expect('{');
    while (!this.#accept('}')) {
      if (this.#current.kind === TokenKind.Eof) {
        throw this.#error("Unterminated service ('}')");
      }
      if (this.#accept(';')) {
        continue;
      }
      if (this.#is('option')) {
        service.options.push(this.#parseOptionStatement());
        continue;
      }
      service.methods.push(this.#parseRpc());
    }
    return service;
  }

  #parseRpc(): RpcNode {
    const start = this.#expect('rpc');
    const name = this.#expectIdentifier('method name').text;
    this.#expect('(');
    const isRequestStream = this.#acceptStreamKeyword();
    const requestType = this.#parseTypeName();
    this.#expect(')');
    this.#expect('returns');
    this.#expect('(');
    const isResponseStream = this.#acceptStreamKeyword();
    const responseType = this.#parseTypeName();
    this.#expect(')');
    const options: ProtoOption[] = [];
    if (this.#accept('{')) {
      while (!this.#accept('}')) {
        if (!this.#accept(';')) {
          options.push(this.#parseOptionStatement());
        }
      }
      this.#accept(';');
    } else {
      this.#expect(';');
    }
    return {
      name,
      requestType,
      isRequestStream,
      responseType,
      isResponseStream,
      options,
      comment: start.leadingComment,
    };
  }

  /** `stream` is a keyword unless it is the type name itself (`(stream)`). */
  #acceptStreamKeyword(): boolean {
    const next = this.#lookAhead(1);
    if (this.#is('stream') && (next.kind === TokenKind.Identifier || next.text === '.')) {
      this.#next();
      return true;
    }
    return false;
  }

  #parseExtend(): ExtendNode {
    const start = this.#expect('extend');
    const extendee = this.#parseTypeName();
    const node: ExtendNode = {
      kind: NodeKind.Extend,
      extendee,
      fields: [],
      groupMessages: [],
      position: start.position,
    };
    const body = this.#newBody();
    this.#expect('{');
    while (!this.#accept('}')) {
      if (this.#current.kind === TokenKind.Eof) {
        throw this.#error("Unterminated extend ('}')");
      }
      if (!this.#accept(';')) {
        node.fields.push(this.#parseField(body, undefined));
      }
    }
    node.groupMessages = body.messages;
    return node;
  }

  #parseSyntax(file: ProtoFileNode): void {
    this.#next();
    this.#expect('=');
    const token = this.#current;
    const value = this.#expectString();
    const syntax = Object.values(Syntax).find((candidate) => candidate === value);
    if (syntax === undefined) {
      throw this.#error(`Unsupported syntax '${value}' (only proto2 and proto3)`, token);
    }
    this.#syntax = syntax;
    file.syntax = syntax;
    this.#expect(';');
  }

  #parseEdition(file: ProtoFileNode): void {
    this.#next();
    this.#expect('=');
    const token = this.#current;
    const value = this.#expectString();
    const edition = EDITIONS.find((candidate) => candidate === value);
    if (edition === undefined) {
      throw this.#error(
        `Unsupported edition '${value}' (supported: ${EDITIONS.join(', ')})`,
        token,
      );
    }
    this.#expect(';');
    this.#edition = edition;
    file.edition = edition;
  }

  #parseImport(file: ProtoFileNode): void {
    this.#next();
    if (this.#accept('option')) {
      // `import option "x.proto";` (edition 2024) only contributes options, not types.
      this.#expectString();
      this.#expect(';');
      return;
    }
    const modifier = IMPORT_MODIFIERS.find((candidate) => this.#is(candidate));
    if (modifier !== undefined) {
      this.#next();
    }
    const path = this.#expectString();
    this.#expect(';');
    const node: ImportNode = modifier === undefined ? { path } : { path, modifier };
    file.imports.push(node);
  }

  parseFile(): ProtoFileNode {
    const file: ProtoFileNode = {
      fileName: this.#fileName,
      syntax: Syntax.Proto2,
      imports: [],
      options: [],
      messages: [],
      enums: [],
      services: [],
      extends: [],
    };

    if (this.#is('syntax')) {
      this.#parseSyntax(file);
    } else if (this.#is('edition')) {
      this.#parseEdition(file);
    }

    while (this.#current.kind !== TokenKind.Eof) {
      const token = this.#current;
      if (this.#accept(';')) {
        continue;
      }
      switch (keywordOf(token)) {
        case 'package': {
          this.#next();
          if (file.package !== undefined) {
            throw this.#error("'package' declared more than once", token);
          }
          file.package = this.#parseTypeName();
          this.#expect(';');
          break;
        }
        case 'import': {
          this.#parseImport(file);
          break;
        }
        case 'option': {
          file.options.push(this.#parseOptionStatement());
          break;
        }
        case 'export':
        case 'local': {
          // Visibility modifiers of edition 2024 do not affect generation.
          const isDeclaration = ['message', 'enum', 'service'].includes(this.#lookAhead(1).text);
          if (this.#edition === undefined || !isDeclaration) {
            throw this.#error(`Unexpected declaration '${token.text}'`);
          }
          this.#next();
          break;
        }
        case 'message': {
          file.messages.push(this.#parseMessage());
          break;
        }
        case 'enum': {
          file.enums.push(this.#parseEnum());
          break;
        }
        case 'service': {
          file.services.push(this.#parseService());
          break;
        }
        case 'extend': {
          const extend = this.#parseExtend();
          file.extends.push(extend);
          file.messages.push(...extend.groupMessages);
          break;
        }
        default: {
          throw this.#error(`Unexpected declaration '${token.text}'`);
        }
      }
    }
    return file;
  }
}
