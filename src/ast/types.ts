/**
 * Abstract syntax tree (AST) of a .proto file.
 *
 * The parser produces these structures exactly as they appear in the file, without resolving
 * type references. Resolution happens in `model/`.
 */

export const OptionValueKind = Object.freeze({
  String: 'string',
  Number: 'number',
  Bool: 'bool',
  Identifier: 'identifier',
  Aggregate: 'aggregate',
} as const);

export type OptionValueKind = (typeof OptionValueKind)[keyof typeof OptionValueKind];

export const NodeKind = Object.freeze({
  Field: 'field',
  Enum: 'enum',
  Message: 'message',
  Extend: 'extend',
  Service: 'service',
} as const);

export type NodeKind = (typeof NodeKind)[keyof typeof NodeKind];

export const FieldLabel = Object.freeze({
  Optional: 'optional',
  Required: 'required',
  Repeated: 'repeated',
  None: 'none',
} as const);

export type FieldLabel = (typeof FieldLabel)[keyof typeof FieldLabel];

export const Syntax = Object.freeze({
  Proto2: 'proto2',
  Proto3: 'proto3',
} as const);

export type Syntax = (typeof Syntax)[keyof typeof Syntax];

export const ImportModifier = Object.freeze({
  Public: 'public',
  Weak: 'weak',
} as const);

export type ImportModifier = (typeof ImportModifier)[keyof typeof ImportModifier];

export const EDITIONS = Object.freeze(['2023', '2024', '2026'] as const);

export type Edition = (typeof EDITIONS)[number];

/** Maximum field number allowed by protobuf (2^29 - 1). */
export const MAX_FIELD_NUMBER = 2 ** 29 - 1;

/** Position in the source file (1-based) for error messages. */
export interface SourcePosition {
  line: number;
  column: number;
}

/** Value of an option: a scalar, an identifier or an aggregate `{ ... }`. */
export type OptionValue =
  | {
      kind: typeof OptionValueKind.String;
      value: string;
      /** Exact bytes of the literal (for `bytes` defaults). */
      bytes: number[];
    }
  | {
      kind: typeof OptionValueKind.Number;
      value: number;
      raw: string;
    }
  | {
      kind: typeof OptionValueKind.Bool;
      value: boolean;
    }
  | {
      kind: typeof OptionValueKind.Identifier;
      value: string;
    }
  | {
      kind: typeof OptionValueKind.Aggregate;
      raw: string;
    };

export interface ProtoOption {
  /** Name as written: `packed`, `(my.ext).field`, etc. */
  name: string;
  value: OptionValue;
}

export interface ReservedRange {
  from: number;
  /** Inclusive. `max` is represented as 2^29 - 1. */
  to: number;
}

export interface FieldNode {
  kind: typeof NodeKind.Field;
  name: string;
  number: number;
  label: FieldLabel;
  /** Type name as written (`int32`, `Foo.Bar`, `.pkg.Baz`). */
  typeName: string;
  options: ProtoOption[];
  comment?: string | undefined;
  position: SourcePosition;
  /** Present if the field is `map<K, V>`. */
  map?: {
    keyType: string;
    valueType: string;
  };
  /** Present if the field is a `group` (proto2): the generated nested message. */
  group?: MessageNode;
  /** Index of the oneof the field belongs to within the message, if any. */
  oneOfIndex?: number;
}

export interface OneOfNode {
  name: string;
  options: ProtoOption[];
  comment?: string | undefined;
}

export interface EnumValueNode {
  name: string;
  number: number;
  options: ProtoOption[];
  comment?: string | undefined;
}

export interface EnumNode {
  kind: typeof NodeKind.Enum;
  name: string;
  values: EnumValueNode[];
  options: ProtoOption[];
  reservedRanges: ReservedRange[];
  reservedNames: string[];
  comment?: string | undefined;
  position: SourcePosition;
}

export interface MessageNode {
  kind: typeof NodeKind.Message;
  name: string;
  fields: FieldNode[];
  oneOfs: OneOfNode[];
  messages: MessageNode[];
  enums: EnumNode[];
  extends: ExtendNode[];
  options: ProtoOption[];
  reservedRanges: ReservedRange[];
  reservedNames: string[];
  extensionRanges: ReservedRange[];
  comment?: string | undefined;
  position: SourcePosition;
  /** true if it was synthesized by a `group`. */
  isGroup?: boolean;
}

export interface ExtendNode {
  kind: typeof NodeKind.Extend;
  extendee: string;
  fields: FieldNode[];
  /** Messages created by `group` inside the `extend`; they belong to the enclosing scope. */
  groupMessages: MessageNode[];
  position: SourcePosition;
}

export interface RpcNode {
  name: string;
  requestType: string;
  isRequestStream: boolean;
  responseType: string;
  isResponseStream: boolean;
  options: ProtoOption[];
  comment?: string | undefined;
}

export interface ServiceNode {
  kind: typeof NodeKind.Service;
  name: string;
  methods: RpcNode[];
  options: ProtoOption[];
  comment?: string | undefined;
  position: SourcePosition;
}

export interface ImportNode {
  path: string;
  modifier?: ImportModifier;
}

export interface ProtoFileNode {
  /** Logical path of the file (relative to its include path). */
  fileName: string;
  syntax: Syntax;
  /** Edition (`edition = "2023"`); when present, `syntax` is "proto2" and the edition defaults apply. */
  edition?: Edition;
  package?: string;
  imports: ImportNode[];
  options: ProtoOption[];
  messages: MessageNode[];
  enums: EnumNode[];
  services: ServiceNode[];
  extends: ExtendNode[];
}
