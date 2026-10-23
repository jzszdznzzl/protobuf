import { WireType } from '../runtime/wire-type.ts';

export const ScalarType = Object.freeze({
  Double: 'double',
  Float: 'float',
  Int32: 'int32',
  Int64: 'int64',
  Uint32: 'uint32',
  Uint64: 'uint64',
  Sint32: 'sint32',
  Sint64: 'sint64',
  Fixed32: 'fixed32',
  Fixed64: 'fixed64',
  Sfixed32: 'sfixed32',
  Sfixed64: 'sfixed64',
  Bool: 'bool',
  String: 'string',
  Bytes: 'bytes',
} as const);

export type ScalarType = (typeof ScalarType)[keyof typeof ScalarType];

export type TsScalar = 'number' | 'bigint' | 'boolean' | 'string' | 'Uint8Array';

export interface ScalarInfo {
  wireType: WireType;
  tsType: TsScalar;
  /** Supports `packed` encoding when repeated. */
  isPackable: boolean;
  /** Can be the key of a `map<K, V>`. */
  isMapKey: boolean;
}

export const SCALARS: Readonly<Record<ScalarType, ScalarInfo>> = {
  [ScalarType.Double]: {
    wireType: WireType.Fixed64,
    tsType: 'number',
    isPackable: true,
    isMapKey: false,
  },
  [ScalarType.Float]: {
    wireType: WireType.Fixed32,
    tsType: 'number',
    isPackable: true,
    isMapKey: false,
  },
  [ScalarType.Int32]: {
    wireType: WireType.Varint,
    tsType: 'number',
    isPackable: true,
    isMapKey: true,
  },
  [ScalarType.Int64]: {
    wireType: WireType.Varint,
    tsType: 'bigint',
    isPackable: true,
    isMapKey: true,
  },
  [ScalarType.Uint32]: {
    wireType: WireType.Varint,
    tsType: 'number',
    isPackable: true,
    isMapKey: true,
  },
  [ScalarType.Uint64]: {
    wireType: WireType.Varint,
    tsType: 'bigint',
    isPackable: true,
    isMapKey: true,
  },
  [ScalarType.Sint32]: {
    wireType: WireType.Varint,
    tsType: 'number',
    isPackable: true,
    isMapKey: true,
  },
  [ScalarType.Sint64]: {
    wireType: WireType.Varint,
    tsType: 'bigint',
    isPackable: true,
    isMapKey: true,
  },
  [ScalarType.Fixed32]: {
    wireType: WireType.Fixed32,
    tsType: 'number',
    isPackable: true,
    isMapKey: true,
  },
  [ScalarType.Fixed64]: {
    wireType: WireType.Fixed64,
    tsType: 'bigint',
    isPackable: true,
    isMapKey: true,
  },
  [ScalarType.Sfixed32]: {
    wireType: WireType.Fixed32,
    tsType: 'number',
    isPackable: true,
    isMapKey: true,
  },
  [ScalarType.Sfixed64]: {
    wireType: WireType.Fixed64,
    tsType: 'bigint',
    isPackable: true,
    isMapKey: true,
  },
  [ScalarType.Bool]: {
    wireType: WireType.Varint,
    tsType: 'boolean',
    isPackable: true,
    isMapKey: true,
  },
  [ScalarType.String]: {
    wireType: WireType.LengthDelimited,
    tsType: 'string',
    isPackable: false,
    isMapKey: true,
  },
  [ScalarType.Bytes]: {
    wireType: WireType.LengthDelimited,
    tsType: 'Uint8Array',
    isPackable: false,
    isMapKey: false,
  },
};

export function isScalarType(name: string): name is ScalarType {
  return Object.hasOwn(SCALARS, name);
}
