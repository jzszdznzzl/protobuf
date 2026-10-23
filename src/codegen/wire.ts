import { ScalarType, SCALARS } from '../model/scalars.ts';
import { ValueKind } from '../model/types.ts';
import type { ValueType } from '../model/types.ts';
import { WireType } from '../runtime/wire-type.ts';

/** Tag (field number + wire type) as an unsigned integer. */
export function makeTag(fieldNumber: number, wireType: WireType): number {
  return ((fieldNumber << 3) | wireType) >>> 0;
}

/** Wire type of an unpacked value. */
export function wireTypeOf(type: ValueType, isGroup = false): WireType {
  switch (type.kind) {
    case ValueKind.Scalar: {
      return SCALARS[type.scalar].wireType;
    }
    case ValueKind.Enum: {
      return WireType.Varint;
    }
    case ValueKind.Message: {
      return isGroup ? WireType.StartGroup : WireType.LengthDelimited;
    }
  }
}

/** Runtime Writer/Reader method for a scalar or enum (`int32`, `sint64`, ...). */
export function codecMethod(type: ValueType): ScalarType {
  switch (type.kind) {
    case ValueKind.Enum: {
      return ScalarType.Int32;
    }
    case ValueKind.Scalar: {
      return type.scalar;
    }
    case ValueKind.Message: {
      throw new Error('Messages have no scalar codec method');
    }
  }
}
