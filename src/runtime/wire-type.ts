/** Wire types of the protobuf binary format. */
export const WireType = Object.freeze({
  Varint: 0,
  Fixed64: 1,
  LengthDelimited: 2,
  StartGroup: 3,
  EndGroup: 4,
  Fixed32: 5,
} as const);

export type WireType = (typeof WireType)[keyof typeof WireType];
