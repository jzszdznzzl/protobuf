/**
 * Naming rules for the generated identifiers.
 */

/** JS/TS reserved words that cannot be class or enum names. */
const RESERVED_WORDS: ReadonlySet<string> = new Set([
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'new',
  'null',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
  'let',
  'static',
  'implements',
  'interface',
  'package',
  'private',
  'protected',
  'public',
  'await',
  'arguments',
  'eval',
  // TypeScript primitive type names
  'any',
  'bigint',
  'boolean',
  'never',
  'number',
  'object',
  'string',
  'symbol',
  'undefined',
  'unknown',
]);

/** Globals the generated code refers to; a user type must not shadow them. */
const RESERVED_GLOBALS: ReadonlySet<string> = new Set([
  'Array',
  'AsyncIterable',
  'BigInt',
  'Boolean',
  'Error',
  'Infinity',
  'Iterable',
  'JSON',
  'Map',
  'Math',
  'NaN',
  'Number',
  'Object',
  'Promise',
  'Readonly',
  'ReadonlyMap',
  'ReadonlySet',
  'String',
  'Symbol',
  'Uint8Array',
  'globalThis',
]);

/**
 * Local variables and parameters of the generated methods. A .proto type may legally be named
 * `value` or `reader`, and it would be shadowed inside the methods that use these names.
 */
const GENERATED_LOCALS: ReadonlySet<string> = new Set([
  'chunk',
  'e',
  'emit',
  'end',
  'end2',
  'entries',
  'entry',
  'groupField',
  'init',
  'item',
  'json',
  'k',
  'key',
  'length',
  'message',
  'obj',
  'options',
  'reader',
  'seen',
  'start',
  'tag',
  'tag2',
  'type',
  'v',
  'value',
  'writer',
]);

/** Properties that cannot be used as an instance field name. */
const RESERVED_PROPERTIES: ReadonlySet<string> = new Set([
  'constructor',
  '__proto__',
  'prototype',
  'toJSON',
  '$unknown',
]);

/** `foo_bar_baz` becomes `fooBarBaz` (same as protoc's `json_name`). */
export function camelCase(name: string): string {
  let out = '';
  let shouldUpperNext = false;
  for (const char of name) {
    if (char === '_') {
      shouldUpperNext = true;
    } else if (shouldUpperNext) {
      out += char.toUpperCase();
      shouldUpperNext = false;
    } else {
      out += char;
    }
  }
  return out;
}

/** Name of a top-level class, enum or extension; nested ones are prefixed by the caller. */
export function typeIdentifier(name: string): string {
  const isClashing =
    RESERVED_WORDS.has(name) || RESERVED_GLOBALS.has(name) || GENERATED_LOCALS.has(name);
  return isClashing ? `${name}_` : name;
}

export function propertyName(fieldName: string, shouldKeepCase: boolean): string {
  const name = shouldKeepCase ? fieldName : camelCase(fieldName);
  return RESERVED_PROPERTIES.has(name) ? `${name}_` : name;
}

/** Service method name: `GetUser` becomes `getUser`. */
export function methodName(rpcName: string): string {
  const name = rpcName.charAt(0).toLowerCase() + rpcName.slice(1);
  return RESERVED_PROPERTIES.has(name) ? `${name}_` : name;
}

/** Returns `base`, or `base_2`, `base_3`, ... the first one not in `taken`. */
export function uniqueName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) {
    return base;
  }
  for (let attempt = 2; ; attempt++) {
    const candidate = `${base}_${attempt}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}
