/**
 * Protobuf edition features (`option features.xxx = ...`).
 *
 * proto2 and proto3 are expressed as sets of default features, so the resolver works with a
 * single mechanism.
 */
import { OptionValueKind } from '../ast/types.ts';
import type { ProtoOption } from '../ast/types.ts';
import { ProtoError, ProtoErrorCode } from '../errors.ts';

export const FieldPresence = Object.freeze({
  Explicit: 'EXPLICIT',
  Implicit: 'IMPLICIT',
  LegacyRequired: 'LEGACY_REQUIRED',
} as const);

export type FieldPresence = (typeof FieldPresence)[keyof typeof FieldPresence];

export const EnumType = Object.freeze({
  Open: 'OPEN',
  Closed: 'CLOSED',
} as const);

export type EnumType = (typeof EnumType)[keyof typeof EnumType];

export const RepeatedFieldEncoding = Object.freeze({
  Packed: 'PACKED',
  Expanded: 'EXPANDED',
} as const);

export type RepeatedFieldEncoding =
  (typeof RepeatedFieldEncoding)[keyof typeof RepeatedFieldEncoding];

export const Utf8Validation = Object.freeze({
  Verify: 'VERIFY',
  None: 'NONE',
} as const);

export type Utf8Validation = (typeof Utf8Validation)[keyof typeof Utf8Validation];

export const MessageEncoding = Object.freeze({
  LengthPrefixed: 'LENGTH_PREFIXED',
  Delimited: 'DELIMITED',
} as const);

export type MessageEncoding = (typeof MessageEncoding)[keyof typeof MessageEncoding];

export const JsonFormat = Object.freeze({
  Allow: 'ALLOW',
  LegacyBestEffort: 'LEGACY_BEST_EFFORT',
} as const);

export type JsonFormat = (typeof JsonFormat)[keyof typeof JsonFormat];

export interface Features {
  fieldPresence: FieldPresence;
  enumType: EnumType;
  repeatedFieldEncoding: RepeatedFieldEncoding;
  utf8Validation: Utf8Validation;
  messageEncoding: MessageEncoding;
  jsonFormat: JsonFormat;
}

export const PROTO2_FEATURES: Features = {
  fieldPresence: FieldPresence.Explicit,
  enumType: EnumType.Closed,
  repeatedFieldEncoding: RepeatedFieldEncoding.Expanded,
  utf8Validation: Utf8Validation.None,
  messageEncoding: MessageEncoding.LengthPrefixed,
  jsonFormat: JsonFormat.LegacyBestEffort,
};

export const PROTO3_FEATURES: Features = {
  fieldPresence: FieldPresence.Implicit,
  enumType: EnumType.Open,
  repeatedFieldEncoding: RepeatedFieldEncoding.Packed,
  utf8Validation: Utf8Validation.Verify,
  messageEncoding: MessageEncoding.LengthPrefixed,
  jsonFormat: JsonFormat.Allow,
};

/** Defaults of editions 2023, 2024 and 2026 (the same for the supported features). */
export const EDITION_FEATURES: Features = {
  fieldPresence: FieldPresence.Explicit,
  enumType: EnumType.Open,
  repeatedFieldEncoding: RepeatedFieldEncoding.Packed,
  utf8Validation: Utf8Validation.Verify,
  messageEncoding: MessageEncoding.LengthPrefixed,
  jsonFormat: JsonFormat.Allow,
};

const FEATURES_PREFIX = 'features.';

const invalid = (context: string, detail: string): ProtoError =>
  new ProtoError(ProtoErrorCode.Resolution, `${context}: ${detail}`);

function isKnownFeature(name: string): boolean {
  return [
    'field_presence',
    'enum_type',
    'repeated_field_encoding',
    'utf8_validation',
    'message_encoding',
    'json_format',
  ].includes(name);
}

function pick<T extends string>(
  allowed: Readonly<Record<string, T>>,
  value: string,
  optionName: string,
  context: string,
): T {
  const found = Object.values(allowed).find((candidate) => candidate === value);
  if (found === undefined) {
    throw invalid(context, `invalid value '${value}' for '${optionName}'`);
  }
  return found;
}

/**
 * Applies the `features.*` options on top of `base`. Language-specific features
 * (`features.(pb.cpp).string_type`, ...) are ignored.
 */
export function applyFeatures(base: Features, options: ProtoOption[], context: string): Features {
  let result = base;
  for (const option of options) {
    if (!option.name.startsWith(FEATURES_PREFIX)) {
      continue;
    }
    const name = option.name.slice(FEATURES_PREFIX.length);
    if (option.value.kind !== OptionValueKind.Identifier) {
      if (isKnownFeature(name)) {
        throw invalid(context, `invalid value for '${option.name}'`);
      }
      continue;
    }
    const value = option.value.value;
    switch (name) {
      case 'field_presence': {
        result = { ...result, fieldPresence: pick(FieldPresence, value, option.name, context) };
        break;
      }
      case 'enum_type': {
        result = { ...result, enumType: pick(EnumType, value, option.name, context) };
        break;
      }
      case 'repeated_field_encoding': {
        result = {
          ...result,
          repeatedFieldEncoding: pick(RepeatedFieldEncoding, value, option.name, context),
        };
        break;
      }
      case 'utf8_validation': {
        result = { ...result, utf8Validation: pick(Utf8Validation, value, option.name, context) };
        break;
      }
      case 'message_encoding': {
        result = { ...result, messageEncoding: pick(MessageEncoding, value, option.name, context) };
        break;
      }
      case 'json_format': {
        result = { ...result, jsonFormat: pick(JsonFormat, value, option.name, context) };
        break;
      }
      default: {
        break;
      }
    }
  }
  return result;
}
