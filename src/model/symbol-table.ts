import { ProtoError, ProtoErrorCode } from '../errors.ts';
import type { TypeModel } from './types.ts';

/**
 * Global registry of messages and enums by fully qualified name, with scope-relative name
 * resolution (protobuf scoping rules).
 */
export class SymbolTable {
  #symbols = new Map<string, TypeModel>();

  #isPackagePrefix(name: string): boolean {
    const prefix = `${name}.`;
    return this.#symbols.keys().some((key) => key.startsWith(prefix));
  }

  register(type: TypeModel): void {
    const existing = this.#symbols.get(type.fullName);
    if (existing) {
      throw new ProtoError(
        ProtoErrorCode.Resolution,
        `Duplicate type '${type.fullName}' (defined in ${existing.file.fileName} and ${type.file.fileName})`,
      );
    }
    this.#symbols.set(type.fullName, type);
  }

  /**
   * Resolves `typeName` from the scope `scope` (e.g. `pkg.Outer`). Searches from the inside
   * out: `pkg.Outer.T`, `pkg.T`, `T`. A name with a leading dot (`.pkg.T`) is absolute.
   */
  resolve(typeName: string, scope: string): TypeModel | undefined {
    if (typeName.startsWith('.')) {
      return this.#symbols.get(typeName.slice(1));
    }

    const scopeParts = scope ? scope.split('.') : [];
    const [first = '', ...rest] = typeName.split('.');
    for (let depth = scopeParts.length; depth >= 0; depth--) {
      const prefix = scopeParts.slice(0, depth).join('.');
      const head = prefix ? `${prefix}.${first}` : first;
      // protoc rule: the first component is resolved by scope; if it exists as a type or as a
      // package prefix, the rest is looked up from it.
      if (this.#symbols.has(head) || this.#isPackagePrefix(head)) {
        const found = this.#symbols.get(rest.length > 0 ? `${head}.${rest.join('.')}` : head);
        if (found) {
          return found;
        }
        if (this.#symbols.has(head)) {
          return undefined;
        }
      }
    }
    return undefined;
  }
}
