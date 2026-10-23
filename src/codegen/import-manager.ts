import type { CodegenOptions } from '../options.ts';
import type { EnumModel, FileModel, MessageModel, TypeModel } from '../model/types.ts';
import { outputBaseName, relativeModule } from './paths.ts';

interface ImportedName {
  local: string;
  /** true if it is only used as a type (`import { type X }`). */
  isTypeOnly: boolean;
}

/**
 * Runtime identifiers. The `$` prefix cannot clash with a .proto name, so a user type called
 * `Reader` or `Result` never shadows the runtime.
 */
export const RUNTIME = Object.freeze({
  Reader: '$Reader',
  Writer: '$Writer',
  Extension: '$Extension',
  RepeatedExtension: '$RepeatedExtension',
  Json: '$Json',
  Result: '$Result',
  DecodeError: '$DecodeError',
  DecodeErrorCode: '$DecodeErrorCode',
  JsonError: '$JsonError',
  JsonErrorCode: '$JsonErrorCode',
  tryDecode: '$tryDecode',
  tryJson: '$tryJson',
} as const);

export type RuntimeName = keyof typeof RUNTIME;

const TYPE_ONLY_RUNTIME: ReadonlySet<RuntimeName> = new Set(['Result']);

const declaredNames = (file: FileModel): Set<string> => {
  const names = new Set<string>();
  for (const enumModel of file.enums) {
    names.add(enumModel.tsName).add(enumModel.guardName);
  }
  for (const message of file.messages) {
    names.add(message.tsName).add(message.initName);
  }
  for (const extension of file.extensions) {
    names.add(extension.tsName);
  }
  for (const service of file.services) {
    names.add(service.tsName).add(service.definitionName);
  }
  return names;
};

/**
 * Keeps track of which symbols from other files the generated file uses and produces the
 * `import` statements, with aliases when names clash.
 */
export class ImportManager {
  #file: FileModel;
  #options: CodegenOptions;
  #modules = new Map<string, Map<string, ImportedName>>();
  #takenNames: Set<string>;
  #baseName: string;
  #runtimeNames = new Set<RuntimeName>();

  constructor(file: FileModel, options: CodegenOptions) {
    this.#file = file;
    this.#options = options;
    this.#takenNames = declaredNames(file);
    this.#baseName = outputBaseName(file.fileName, options);
  }

  #reference(type: TypeModel, exportedName: string, isTypeOnly: boolean): string {
    if (type.file === this.#file) {
      return exportedName;
    }

    const target = outputBaseName(type.file.fileName, this.#options);
    const specifier = relativeModule(this.#baseName, target, this.#options.importExtension);
    let names = this.#modules.get(specifier);
    if (!names) {
      names = new Map();
      this.#modules.set(specifier, names);
    }
    const existing = names.get(exportedName);
    if (existing) {
      if (!isTypeOnly) {
        existing.isTypeOnly = false;
      }
      return existing.local;
    }

    let local = exportedName;
    for (let attempt = 2; this.#takenNames.has(local); attempt++) {
      local = `${exportedName}_${attempt}`;
    }
    this.#takenNames.add(local);
    names.set(exportedName, { local, isTypeOnly });
    return local;
  }

  /** Name of the class or enum object (a value). */
  value(type: TypeModel): string {
    return this.#reference(type, type.tsName, false);
  }

  /** Name of the init type of a message (type only). */
  init(type: MessageModel): string {
    return this.#reference(type, type.initName, true);
  }

  /** Name of an enum in type position. */
  enumType(type: EnumModel): string {
    return this.#reference(type, type.tsName, true);
  }

  /** Type guard of a closed enum. */
  guard(type: EnumModel): string {
    return this.#reference(type, type.guardName, false);
  }

  runtime(name: RuntimeName): string {
    this.#runtimeNames.add(name);
    return RUNTIME[name];
  }

  /** Sorted `import` statements, the runtime first. */
  render(): string[] {
    const lines: string[] = [];
    if (this.#runtimeNames.size > 0) {
      const parts = [...this.#runtimeNames]
        .sort()
        .map((name) => `${TYPE_ONLY_RUNTIME.has(name) ? 'type ' : ''}${name} as ${RUNTIME[name]}`);
      lines.push(
        `import { ${parts.join(', ')} } from ${JSON.stringify(this.#options.runtimeImport)};`,
      );
    }
    for (const specifier of [...this.#modules.keys()].sort()) {
      const names = [...(this.#modules.get(specifier) ?? [])].sort(([a], [b]) =>
        a.localeCompare(b),
      );
      const parts = names.map(([exported, { local, isTypeOnly }]) => {
        const alias = local === exported ? exported : `${exported} as ${local}`;
        return isTypeOnly ? `type ${alias}` : alias;
      });
      lines.push(`import { ${parts.join(', ')} } from ${JSON.stringify(specifier)};`);
    }
    return lines;
  }
}
