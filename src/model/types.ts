/**
 * Resolved model: the AST with all type references linked, TypeScript names assigned and
 * presence/packed semantics computed. It is the only input the code generators need.
 */
import type {
  EnumNode,
  MessageNode,
  OptionValue,
  ProtoFileNode,
  ServiceNode,
  Syntax,
} from '../ast/types.ts';
import type { Features } from './features.ts';
import type { ScalarType } from './scalars.ts';

/**
 * - `implicit`: proto3 without `optional`; omitted when encoding if it equals the zero value.
 * - `explicit`: encoded if it is not `undefined` (proto2 optional, proto3 optional, messages, oneof).
 * - `required`: proto2 required; always encoded and validated when decoding.
 * - `repeated`: lists and maps.
 */
export const Presence = Object.freeze({
  Implicit: 'implicit',
  Explicit: 'explicit',
  Required: 'required',
  Repeated: 'repeated',
} as const);

export type Presence = (typeof Presence)[keyof typeof Presence];

export const ValueKind = Object.freeze({
  Scalar: 'scalar',
  Enum: 'enum',
  Message: 'message',
} as const);

export type ValueKind = (typeof ValueKind)[keyof typeof ValueKind];

export interface FileModel {
  ast: ProtoFileNode;
  /** Logical path of the .proto (e.g. `google/protobuf/timestamp.proto`). */
  fileName: string;
  syntax: Syntax;
  package: string;
  /** All messages of the file, including nested ones, in declaration order. */
  messages: MessageModel[];
  /** All enums of the file, including nested ones. */
  enums: EnumModel[];
  services: ServiceModel[];
  /** Extensions declared in the file (at file level or inside messages). */
  extensions: ExtensionModel[];
  features: Features;
}

export interface EnumValueModel {
  name: string;
  number: number;
  comment?: string | undefined;
  isDeprecated: boolean;
}

export interface EnumModel {
  kind: typeof ValueKind.Enum;
  ast: EnumNode;
  /** Fully qualified name without leading dot: `pkg.Outer.Kind`. */
  fullName: string;
  /** Generated identifier, flat: nested types are prefixed by their parents (`Outer_Kind`). */
  tsName: string;
  /** Name of the generated type guard of a closed enum (`isKnownOuter_Kind`). */
  guardName: string;
  file: FileModel;
  values: EnumValueModel[];
  /** Default value (first declared value). */
  defaultValue: number;
  /** true if the enum is closed (unknown values go to the unknown fields). */
  isClosed: boolean;
  comment?: string | undefined;
  isDeprecated: boolean;
}

export type ValueType =
  | { kind: typeof ValueKind.Scalar; scalar: ScalarType }
  | { kind: typeof ValueKind.Enum; enum: EnumModel }
  | { kind: typeof ValueKind.Message; message: MessageModel };

export interface MapModel {
  key: ScalarType;
  value: ValueType;
}

export interface FieldModel {
  /** Name in the .proto. */
  name: string;
  /** Name of the generated property. */
  tsName: string;
  number: number;
  /** Type of the elements (for maps, see `map`). */
  type: ValueType;
  isRepeated: boolean;
  presence: Presence;
  /** Only repeated numeric scalars and enums. */
  isPacked: boolean;
  /** true if the message is delimited-encoded (proto2 `group` or `message_encoding = DELIMITED`). */
  isGroup: boolean;
  /** Strings are validated as UTF-8 when decoding (`utf8_validation = VERIFY`). */
  shouldVerifyUtf8: boolean;
  /** JSON name (`json_name` or lowerCamelCase). */
  jsonName: string;
  map?: MapModel;
  oneof?: OneOfModel;
  /** Proto2 `[default = ...]` value. */
  defaultValue?: OptionValue;
  comment?: string | undefined;
  isDeprecated: boolean;
}

export interface OneOfModel {
  name: string;
  /** Name of the getter that tells which member is assigned. */
  tsName: string;
  fields: FieldModel[];
  comment?: string | undefined;
}

export interface MessageModel {
  kind: typeof ValueKind.Message;
  ast: MessageNode;
  fullName: string;
  /** Generated class name, flat: nested types are prefixed by their parents (`Outer_Inner`). */
  tsName: string;
  /** Name of the generated init type (`Outer_InnerInit`). */
  initName: string;
  file: FileModel;
  syntax: Syntax;
  /** Fields sorted by number (serialization order). */
  fields: FieldModel[];
  oneOfs: OneOfModel[];
  isGroup: boolean;
  /** true if some field uses it with delimited encoding (its `read` accepts `groupField`). */
  isUsedDelimited: boolean;
  /** Declared extension ranges (`extensions 100 to max;`). */
  extensionRanges: { from: number; to: number }[];
  features: Features;
  comment?: string | undefined;
  isDeprecated: boolean;
}

/** Extension field (`extend Foo { optional int32 bar = 100; }`). */
export interface ExtensionModel {
  name: string;
  /** Fully qualified name: `pkg.Scope.name`. */
  fullName: string;
  /** Identifier of the exported constant. */
  tsName: string;
  number: number;
  extendee: MessageModel;
  file: FileModel;
  /** Field with its type, presence and encoding resolved. */
  field: FieldModel;
  comment?: string | undefined;
  isDeprecated: boolean;
}

export interface MethodModel {
  name: string;
  tsName: string;
  request: MessageModel;
  response: MessageModel;
  isRequestStream: boolean;
  isResponseStream: boolean;
  comment?: string | undefined;
  isDeprecated: boolean;
}

export interface ServiceModel {
  ast: ServiceNode;
  fullName: string;
  tsName: string;
  /** Name of the exported descriptor constant (`GreeterDefinition`). */
  definitionName: string;
  file: FileModel;
  methods: MethodModel[];
  comment?: string | undefined;
  isDeprecated: boolean;
}

export type TypeModel = MessageModel | EnumModel;
