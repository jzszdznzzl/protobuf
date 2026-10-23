import { SCALARS } from '../model/scalars.ts';
import type { ScalarType } from '../model/scalars.ts';
import { ValueKind } from '../model/types.ts';
import type { EnumModel, FieldModel, ValueType } from '../model/types.ts';
import type { ImportManager } from './import-manager.ts';

/**
 * - `init`: type used in the `FooInit` types (messages as `BarInit`).
 * - `class`: type used in the class properties (messages as `Bar`).
 */
export const TypeMode = Object.freeze({
  Init: 'init',
  Class: 'class',
} as const);

export type TypeMode = (typeof TypeMode)[keyof typeof TypeMode];

/** Translates protobuf types to TypeScript types. */
export class TypeMapper {
  #imports: ImportManager;

  constructor(imports: ImportManager) {
    this.#imports = imports;
  }

  scalar(scalar: ScalarType): string {
    return SCALARS[scalar].tsType;
  }

  /** Open enums accept any number; closed enums are the union of their declared values. */
  value(type: ValueType, mode: TypeMode): string {
    switch (type.kind) {
      case ValueKind.Scalar: {
        return this.scalar(type.scalar);
      }
      case ValueKind.Enum: {
        return type.enum.isClosed ? this.#imports.enumType(type.enum) : 'number';
      }
      case ValueKind.Message: {
        return mode === TypeMode.Init
          ? this.#imports.init(type.message)
          : this.#imports.value(type.message);
      }
    }
  }

  /** Full type of the property, including `[]` or `Map<...>`. */
  field(field: FieldModel, mode: TypeMode): string {
    if (field.map) {
      return `Map<${this.scalar(field.map.key)}, ${this.value(field.map.value, mode)}>`;
    }
    const element = this.value(field.type, mode);
    return field.isRepeated ? `${element}[]` : element;
  }

  /** Expression for the enum member with a given number (the first one if there are aliases). */
  enumMember(enumModel: EnumModel, number: number): string {
    const member = enumModel.values.find((candidate) => candidate.number === number);
    if (!member) {
      throw new Error(`Enum ${enumModel.fullName} has no value ${number}`);
    }
    return `${this.#imports.value(enumModel)}.${member.name}`;
  }

  /** Expression with the zero value of a type, ignoring `[default = ...]`. */
  zeroValue(type: ValueType): string {
    switch (type.kind) {
      case ValueKind.Enum: {
        return this.enumMember(type.enum, type.enum.defaultValue);
      }
      case ValueKind.Message: {
        return `new ${this.#imports.value(type.message)}()`;
      }
      case ValueKind.Scalar: {
        switch (SCALARS[type.scalar].tsType) {
          case 'number': {
            return '0';
          }
          case 'bigint': {
            return '0n';
          }
          case 'boolean': {
            return 'false';
          }
          case 'string': {
            return '""';
          }
          case 'Uint8Array': {
            return 'new Uint8Array(0)';
          }
        }
      }
    }
  }
}
