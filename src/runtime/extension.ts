import type { Result } from '../result.ts';
import { tryDecode } from './errors.ts';
import type { DecodeError } from './errors.ts';
import { Reader } from './reader.ts';
import { WireType } from './wire-type.ts';
import { Writer } from './writer.ts';

/** Any message that can hold extensions (it keeps unknown fields). */
export interface Extendable {
  $unknown?: Uint8Array[] | undefined;
}

export interface ExtensionSpec<E> {
  number: number;
  /** Wire type of one element (3 for groups). */
  wireType: number;
  /** Can be read packed (numeric scalars and enums). */
  isPackable: boolean;
  /** Reads one element with the reader positioned right after the tag. */
  read(reader: Reader): E;
  /** Writes one element without its tag (groups include their closing tag). */
  write(writer: Writer, value: E): void;
}

export interface RepeatedExtensionSpec<E> extends ExtensionSpec<E> {
  /** Written packed (only when `isPackable`). */
  isPacked: boolean;
}

const chunkNumber = (chunk: Uint8Array): number => new Reader(chunk).uint32() >>> 3;

const makeTag = (number: number, wireType: number): number => ((number << 3) | wireType) >>> 0;

const readElements = <E>(spec: ExtensionSpec<E>, message: Extendable): E[] => {
  const values: E[] = [];
  for (const chunk of message.$unknown ?? []) {
    const reader = new Reader(chunk);
    const tag = reader.uint32();
    if (tag >>> 3 !== spec.number) {
      continue;
    }
    const wireType = tag & 7;
    if (wireType === spec.wireType) {
      values.push(spec.read(reader));
    } else if (spec.isPackable && wireType === WireType.LengthDelimited) {
      const end = reader.uint32() + reader.pos;
      while (reader.pos < end) {
        values.push(spec.read(reader));
      }
      reader.checkEnd(end);
    }
  }
  return values;
};

const encodeUnpacked = <E>(spec: ExtensionSpec<E>, items: readonly E[]): Uint8Array[] =>
  items.map((item) => {
    const writer = new Writer().uint32(makeTag(spec.number, spec.wireType));
    spec.write(writer, item);
    return writer.finish();
  });

const encodePacked = <E>(spec: ExtensionSpec<E>, items: readonly E[]): Uint8Array[] => {
  const writer = new Writer().uint32(makeTag(spec.number, WireType.LengthDelimited)).fork();
  for (const item of items) {
    spec.write(writer, item);
  }
  return [writer.ldelim().finish()];
};

const append = (message: Extendable, chunks: Uint8Array[]): void => {
  if (chunks.length > 0) {
    message.$unknown = [...(message.$unknown ?? []), ...chunks];
  }
};

abstract class ExtensionBase {
  #extendee: string;
  #fullName: string;
  #number: number;

  constructor(extendee: string, fullName: string, number: number) {
    this.#extendee = extendee;
    this.#fullName = fullName;
    this.#number = number;
  }

  /** Fully qualified name of the extended message. */
  get extendee(): string {
    return this.#extendee;
  }

  /** Fully qualified name of the extension. */
  get fullName(): string {
    return this.#fullName;
  }

  get number(): number {
    return this.#number;
  }

  /** true if the message contains this extension. */
  has(message: Extendable): boolean {
    return (message.$unknown ?? []).some((chunk) => chunkNumber(chunk) === this.#number);
  }

  /** Removes the extension from the message. */
  clear(message: Extendable): void {
    if (!message.$unknown) {
      return;
    }
    const kept = message.$unknown.filter((chunk) => chunkNumber(chunk) !== this.#number);
    message.$unknown = kept.length > 0 ? kept : undefined;
  }
}

/**
 * Singular extension of proto2 and editions. The value is stored already encoded in
 * `message.$unknown`, so it survives decode/encode even if the extension is not known.
 */
export class Extension<E> extends ExtensionBase {
  #spec: ExtensionSpec<E>;

  constructor(extendee: string, fullName: string, spec: ExtensionSpec<E>) {
    super(extendee, fullName, spec.number);
    this.#spec = spec;
  }

  /** Value of the extension; `undefined` if absent. When repeated on the wire, the last one wins. */
  get(message: Extendable): Result<E | undefined, DecodeError> {
    return tryDecode(() => readElements(this.#spec, message).at(-1));
  }

  /** Assigns the extension, replacing the previous one; `undefined` removes it. */
  set(message: Extendable, value: E | undefined): void {
    this.clear(message);
    if (value !== undefined) {
      append(message, encodeUnpacked(this.#spec, [value]));
    }
  }
}

/** Repeated extension: the value is the list of every element found. */
export class RepeatedExtension<E> extends ExtensionBase {
  #spec: RepeatedExtensionSpec<E>;

  constructor(extendee: string, fullName: string, spec: RepeatedExtensionSpec<E>) {
    super(extendee, fullName, spec.number);
    this.#spec = spec;
  }

  /** Every element of the extension; an empty list if absent. */
  get(message: Extendable): Result<E[], DecodeError> {
    return tryDecode(() => readElements(this.#spec, message));
  }

  /** Assigns the extension, replacing the previous one; `undefined` removes it. */
  set(message: Extendable, value: readonly E[] | undefined): void {
    this.clear(message);
    if (value === undefined || value.length === 0) {
      return;
    }
    const isPacked = this.#spec.isPacked && this.#spec.isPackable;
    append(message, isPacked ? encodePacked(this.#spec, value) : encodeUnpacked(this.#spec, value));
  }
}
