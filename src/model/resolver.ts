import { FieldLabel, OptionValueKind, Syntax } from '../ast/types.ts';
import type {
  EnumNode,
  ExtendNode,
  FieldNode,
  MessageNode,
  OptionValue,
  ProtoFileNode,
  ProtoOption,
} from '../ast/types.ts';
import { ProtoError, ProtoErrorCode } from '../errors.ts';
import {
  applyFeatures,
  EDITION_FEATURES,
  EnumType,
  FieldPresence,
  MessageEncoding,
  PROTO2_FEATURES,
  PROTO3_FEATURES,
  RepeatedFieldEncoding,
  Utf8Validation,
} from './features.ts';
import type { Features } from './features.ts';
import { camelCase, methodName, propertyName, typeIdentifier, uniqueName } from './naming.ts';
import { isScalarType, ScalarType, SCALARS } from './scalars.ts';
import { SymbolTable } from './symbol-table.ts';
import { Presence, ValueKind } from './types.ts';
import type {
  EnumModel,
  ExtensionModel,
  FieldModel,
  FileModel,
  MessageModel,
  OneOfModel,
  ServiceModel,
  ValueType,
} from './types.ts';

interface PendingExtension {
  file: FileModel;
  node: ExtendNode;
  /** Proto scope where the `extend` was declared (package or message). */
  scope: string;
  /** Flat name of the enclosing message, when the `extend` is nested in one. */
  enclosingName: string | undefined;
  features: Features;
}

/** Context needed to build a field (of a message or of an extension). */
interface FieldOwner {
  file: FileModel;
  scope: string;
  features: Features;
}

export interface ResolveOptions {
  /** Keep field names as they are (`snake_case`) instead of camelCase. */
  shouldKeepCase?: boolean;
}

export interface ResolveResult {
  files: FileModel[];
  warnings: string[];
}

const fail = (message: string): ProtoError => new ProtoError(ProtoErrorCode.Resolution, message);

const findOption = (options: ProtoOption[], name: string): OptionValue | undefined =>
  options.find((option) => option.name === name)?.value;

const isDeprecated = (options: ProtoOption[]): boolean => {
  const value = findOption(options, 'deprecated');
  return value?.kind === OptionValueKind.Bool && value.value;
};

const contextOf = (message: MessageModel): FieldOwner => ({
  file: message.file,
  scope: message.fullName,
  features: message.features,
});

const baseFeatures = (ast: ProtoFileNode): Features => {
  if (ast.edition) {
    return EDITION_FEATURES;
  }
  return ast.syntax === Syntax.Proto3 ? PROTO3_FEATURES : PROTO2_FEATURES;
};

const jsonNameOf = (node: FieldNode): string => {
  const option = findOption(node.options, 'json_name');
  return option?.kind === OptionValueKind.String ? option.value : camelCase(node.name);
};

const isPackableType = (type: ValueType): boolean =>
  type.kind === ValueKind.Enum ||
  (type.kind === ValueKind.Scalar && SCALARS[type.scalar].isPackable);

class Resolver {
  #options: ResolveOptions;
  #symbols = new SymbolTable();
  #warnings: string[] = [];
  #pendingMessages: MessageModel[] = [];
  #pendingExtensions: PendingExtension[] = [];
  #extensionNumbers = new Map<string, string>();
  /** Identifiers already used per file (types, enums, guards, extensions, services). */
  #fileNames = new Map<FileModel, Set<string>>();

  constructor(options: ResolveOptions) {
    this.#options = options;
  }

  #warn(file: string, message: string): void {
    this.#warnings.push(`${file}: ${message}`);
  }

  #takenIn(file: FileModel): Set<string> {
    const existing = this.#fileNames.get(file);
    if (existing) {
      return existing;
    }
    const created = new Set<string>();
    this.#fileNames.set(file, created);
    return created;
  }

  #qualify(file: FileModel, path: string[]): string {
    return [file.package, ...path].filter(Boolean).join('.');
  }

  #declareFile(ast: ProtoFileNode): FileModel {
    const features = ast.edition
      ? applyFeatures(baseFeatures(ast), ast.options, ast.fileName)
      : baseFeatures(ast);
    const file: FileModel = {
      ast,
      fileName: ast.fileName,
      syntax: ast.syntax,
      package: ast.package ?? '',
      messages: [],
      enums: [],
      services: [],
      extensions: [],
      features,
    };
    for (const node of ast.enums) {
      this.#declareEnum(file, node, [], undefined, features);
    }
    for (const node of ast.messages) {
      this.#declareMessage(file, node, [], undefined, features);
    }
    for (const node of ast.extends) {
      this.#pendingExtensions.push({
        file,
        node,
        scope: ast.package ?? '',
        enclosingName: undefined,
        features,
      });
    }
    return file;
  }

  #declareEnum(
    file: FileModel,
    node: EnumNode,
    parentPath: string[],
    parentName: string | undefined,
    parent: Features,
  ): void {
    const features = file.ast.edition
      ? applyFeatures(parent, node.options, `${file.fileName}: enum ${node.name}`)
      : parent;
    const first = node.values[0];
    if (first === undefined) {
      throw fail(`${file.fileName}: the enum '${node.name}' has no values`);
    }
    if (file.ast.edition && features.enumType === EnumType.Open && first.number !== 0) {
      throw fail(`${file.fileName}: the first value of the open enum '${node.name}' must be 0`);
    }
    const taken = this.#takenIn(file);
    const tsName = uniqueName(
      parentName === undefined ? typeIdentifier(node.name) : `${parentName}_${node.name}`,
      taken,
    );
    taken.add(tsName);
    const guardName = uniqueName(`isKnown${tsName}`, taken);
    taken.add(guardName);
    const model: EnumModel = {
      kind: ValueKind.Enum,
      ast: node,
      fullName: this.#qualify(file, [...parentPath, node.name]),
      tsName,
      guardName,
      file,
      values: node.values.map((value) => ({
        name: value.name,
        number: value.number,
        comment: value.comment,
        isDeprecated: isDeprecated(value.options),
      })),
      defaultValue: first.number,
      isClosed: features.enumType === EnumType.Closed,
      comment: node.comment,
      isDeprecated: isDeprecated(node.options),
    };
    this.#checkEnumAliases(model);
    file.enums.push(model);
    this.#symbols.register(model);
  }

  #checkEnumAliases(model: EnumModel): void {
    const seen = new Set<number>();
    const isAliasAllowed = model.ast.options.some(
      (option) =>
        option.name === 'allow_alias' &&
        option.value.kind === OptionValueKind.Bool &&
        option.value.value,
    );
    for (const value of model.values) {
      if (seen.has(value.number) && !isAliasAllowed) {
        throw fail(
          `${model.file.fileName}: enum '${model.fullName}' repeats the value ${value.number} ` +
            `('${value.name}') without 'option allow_alias = true'`,
        );
      }
      seen.add(value.number);
    }
  }

  #declareMessage(
    file: FileModel,
    node: MessageNode,
    parentPath: string[],
    parentName: string | undefined,
    parent: Features,
  ): void {
    const path = [...parentPath, node.name];
    const features = file.ast.edition
      ? applyFeatures(parent, node.options, `${file.fileName}: message ${node.name}`)
      : parent;
    const taken = this.#takenIn(file);
    const tsName = uniqueName(
      parentName === undefined ? typeIdentifier(node.name) : `${parentName}_${node.name}`,
      taken,
    );
    taken.add(tsName);
    const initName = uniqueName(`${tsName}Init`, taken);
    taken.add(initName);

    const model: MessageModel = {
      kind: ValueKind.Message,
      ast: node,
      fullName: this.#qualify(file, path),
      tsName,
      initName,
      file,
      syntax: file.syntax,
      fields: [],
      oneOfs: [],
      isGroup: node.isGroup === true,
      isUsedDelimited: false,
      extensionRanges: node.extensionRanges.map((range) => ({ from: range.from, to: range.to })),
      features,
      comment: node.comment,
      isDeprecated: isDeprecated(node.options),
    };
    file.messages.push(model);
    this.#symbols.register(model);
    this.#pendingMessages.push(model);

    for (const child of node.enums) {
      this.#declareEnum(file, child, path, tsName, features);
    }
    for (const child of node.messages) {
      this.#declareMessage(file, child, path, tsName, features);
    }
    for (const child of node.extends) {
      this.#pendingExtensions.push({
        file,
        node: child,
        scope: model.fullName,
        enclosingName: tsName,
        features,
      });
    }
  }

  #resolveValueType(typeName: string, scope: string, context: string): ValueType {
    if (isScalarType(typeName)) {
      return { kind: ValueKind.Scalar, scalar: typeName };
    }
    const found = this.#symbols.resolve(typeName, scope);
    if (!found) {
      throw fail(`${context}: unknown type '${typeName}'`);
    }
    return found.kind === ValueKind.Enum
      ? { kind: ValueKind.Enum, enum: found }
      : { kind: ValueKind.Message, message: found };
  }

  #checkReserved(message: MessageModel, node: FieldNode): void {
    const { ast } = message;
    const where = `${message.file.fileName}: ${message.fullName}`;
    if (ast.reservedNames.includes(node.name)) {
      throw fail(`${where}: the name '${node.name}' is reserved`);
    }
    if (ast.reservedRanges.some((range) => node.number >= range.from && node.number <= range.to)) {
      throw fail(`${where}: the number ${node.number} is reserved`);
    }
  }

  #presenceOf(node: FieldNode, type: ValueType, features: Features, isRepeated: boolean): Presence {
    if (isRepeated) {
      return Presence.Repeated;
    }
    if (
      node.label === FieldLabel.Required ||
      features.fieldPresence === FieldPresence.LegacyRequired
    ) {
      return Presence.Required;
    }
    const isExplicit =
      features.fieldPresence === FieldPresence.Explicit ||
      node.label === FieldLabel.Optional ||
      node.oneOfIndex !== undefined ||
      type.kind === ValueKind.Message;
    return isExplicit ? Presence.Explicit : Presence.Implicit;
  }

  #buildMapField(
    owner: FieldOwner,
    node: FieldNode,
    features: Features,
    context: string,
  ): FieldModel {
    const keyType = node.map?.keyType ?? '';
    if (!isScalarType(keyType) || !SCALARS[keyType].isMapKey) {
      throw fail(`${context}: invalid map key type '${keyType}'`);
    }
    const value = this.#resolveValueType(node.map?.valueType ?? '', owner.scope, context);
    return {
      name: node.name,
      tsName: '',
      number: node.number,
      type: value,
      isRepeated: true,
      presence: Presence.Repeated,
      isPacked: false,
      isGroup: false,
      shouldVerifyUtf8: features.utf8Validation === Utf8Validation.Verify,
      jsonName: jsonNameOf(node),
      map: { key: keyType, value },
      comment: node.comment,
      isDeprecated: isDeprecated(node.options),
    };
  }

  #checkDefault(
    field: FieldModel,
    defaultOption: OptionValue,
    syntax: Syntax,
    context: string,
  ): void {
    const { type } = field;
    if (syntax === Syntax.Proto3) {
      throw fail(`${context}: 'default' is not allowed in proto3`);
    }
    if (field.presence === Presence.Implicit) {
      throw fail(`${context}: 'default' is not allowed on fields without explicit presence`);
    }
    if (field.isRepeated || type.kind === ValueKind.Message) {
      throw fail(`${context}: 'default' does not apply to this field`);
    }
    if (
      type.kind === ValueKind.Enum &&
      !(
        defaultOption.kind === OptionValueKind.Identifier &&
        type.enum.values.some((value) => value.name === defaultOption.value)
      )
    ) {
      throw fail(`${context}: invalid enum default value`);
    }
  }

  #buildField(owner: FieldOwner, node: FieldNode): FieldModel {
    const context = `${owner.file.fileName}: ${owner.scope}.${node.name}`;
    const features = owner.file.ast.edition
      ? applyFeatures(owner.features, node.options, context)
      : owner.features;

    if (node.map) {
      return this.#buildMapField(owner, node, features, context);
    }

    const type = this.#resolveValueType(node.typeName, owner.scope, context);
    const isRepeated = node.label === FieldLabel.Repeated;
    const isGroup =
      node.group !== undefined ||
      (type.kind === ValueKind.Message && features.messageEncoding === MessageEncoding.Delimited);
    const presence = this.#presenceOf(node, type, features, isRepeated);

    const packedOption = findOption(node.options, 'packed');
    let isPacked = false;
    if (isRepeated && isPackableType(type)) {
      isPacked =
        packedOption?.kind === OptionValueKind.Bool
          ? packedOption.value
          : features.repeatedFieldEncoding === RepeatedFieldEncoding.Packed;
    } else if (packedOption?.kind === OptionValueKind.Bool && packedOption.value) {
      this.#warn(
        owner.file.fileName,
        `${owner.scope}.${node.name}: 'packed' does not apply to this type`,
      );
    }

    if (isGroup && type.kind === ValueKind.Message) {
      type.message.isUsedDelimited = true;
    }

    const field: FieldModel = {
      name: node.name,
      tsName: '',
      number: node.number,
      type,
      isRepeated,
      presence,
      isPacked,
      isGroup,
      shouldVerifyUtf8:
        type.kind === ValueKind.Scalar &&
        type.scalar === ScalarType.String &&
        features.utf8Validation === Utf8Validation.Verify,
      jsonName: jsonNameOf(node),
      comment: node.comment,
      isDeprecated: isDeprecated(node.options),
    };

    const defaultOption = findOption(node.options, 'default');
    if (defaultOption) {
      this.#checkDefault(field, defaultOption, owner.file.syntax, context);
      field.defaultValue = defaultOption;
    }
    return field;
  }

  #resolveMessage(message: MessageModel): void {
    const { ast } = message;
    const fileName = message.file.fileName;
    const takenProperties = new Set<string>();
    const numbers = new Map<number, string>();
    const shouldKeepCase = this.#options.shouldKeepCase === true;

    const oneOfs: OneOfModel[] = ast.oneOfs.map((oneOf) => ({
      name: oneOf.name,
      tsName: '',
      fields: [],
      comment: oneOf.comment,
    }));

    for (const node of ast.fields) {
      const previous = numbers.get(node.number);
      if (previous) {
        throw fail(
          `${fileName}: ${message.fullName}: number ${node.number} is used by '${previous}' and '${node.name}'`,
        );
      }
      numbers.set(node.number, node.name);
      this.#checkReserved(message, node);

      const field = this.#buildField(contextOf(message), node);
      const wanted = propertyName(node.name, shouldKeepCase);
      field.tsName = uniqueName(wanted, takenProperties);
      if (field.tsName !== wanted) {
        this.#warn(
          fileName,
          `${message.fullName}.${node.name}: property renamed to '${field.tsName}'`,
        );
      }
      takenProperties.add(field.tsName);

      const oneOf = node.oneOfIndex === undefined ? undefined : oneOfs[node.oneOfIndex];
      if (oneOf) {
        field.oneof = oneOf;
        oneOf.fields.push(field);
      }
      message.fields.push(field);
    }

    for (const oneOf of oneOfs) {
      const wanted = propertyName(oneOf.name, shouldKeepCase);
      oneOf.tsName = takenProperties.has(wanted)
        ? uniqueName(`${wanted}Case`, takenProperties)
        : wanted;
      takenProperties.add(oneOf.tsName);
    }

    message.oneOfs = oneOfs.filter((oneOf) => oneOf.fields.length > 0);
    message.fields.sort((a, b) => a.number - b.number);
  }

  #resolveExtension(pending: PendingExtension): void {
    const { file, node, scope } = pending;
    const where = `${file.fileName}: extend ${node.extendee}`;
    const extendee = this.#symbols.resolve(node.extendee, scope);
    if (extendee?.kind !== ValueKind.Message) {
      throw fail(`${where}: unknown extended type`);
    }
    const taken = this.#takenIn(file);

    for (const fieldNode of node.fields) {
      const { number } = fieldNode;
      if (!extendee.extensionRanges.some((range) => number >= range.from && number <= range.to)) {
        throw fail(
          `${where}: number ${number} ('${fieldNode.name}') is outside the extension ranges of ${extendee.fullName}`,
        );
      }
      const key = `${extendee.fullName}#${number}`;
      const previous = this.#extensionNumbers.get(key);
      if (previous) {
        throw fail(`${where}: number ${number} is already used by the extension '${previous}'`);
      }
      const fullName = [scope, fieldNode.name].filter(Boolean).join('.');
      this.#extensionNumbers.set(key, fullName);

      const field = this.#buildField({ file, scope, features: pending.features }, fieldNode);
      const baseName = camelCase(fieldNode.name);
      const tsName = uniqueName(
        pending.enclosingName === undefined
          ? typeIdentifier(baseName)
          : `${pending.enclosingName}_${baseName}`,
        taken,
      );
      taken.add(tsName);
      field.tsName = tsName;
      const extension: ExtensionModel = {
        name: fieldNode.name,
        fullName,
        tsName,
        number,
        extendee,
        file,
        field,
        comment: fieldNode.comment,
        isDeprecated: isDeprecated(fieldNode.options),
      };
      file.extensions.push(extension);
    }
  }

  #resolveServices(file: FileModel): void {
    const taken = this.#takenIn(file);
    for (const node of file.ast.services) {
      const fullName = this.#qualify(file, [node.name]);
      const tsName = uniqueName(typeIdentifier(node.name), taken);
      taken.add(tsName);
      const definitionName = uniqueName(`${tsName}Definition`, taken);
      taken.add(definitionName);
      const service: ServiceModel = {
        ast: node,
        fullName,
        tsName,
        definitionName,
        file,
        methods: [],
        comment: node.comment,
        isDeprecated: isDeprecated(node.options),
      };
      for (const rpc of node.methods) {
        const context = `${file.fileName}: ${fullName}.${rpc.name}`;
        const request = this.#symbols.resolve(rpc.requestType, fullName);
        const response = this.#symbols.resolve(rpc.responseType, fullName);
        if (request?.kind !== ValueKind.Message) {
          throw fail(`${context}: invalid request type '${rpc.requestType}'`);
        }
        if (response?.kind !== ValueKind.Message) {
          throw fail(`${context}: invalid response type '${rpc.responseType}'`);
        }
        service.methods.push({
          name: rpc.name,
          tsName: methodName(rpc.name),
          request,
          response,
          isRequestStream: rpc.isRequestStream,
          isResponseStream: rpc.isResponseStream,
          comment: rpc.comment,
          isDeprecated: isDeprecated(rpc.options),
        });
      }
      file.services.push(service);
    }
  }

  run(asts: ProtoFileNode[]): ResolveResult {
    const files = asts.map((ast) => this.#declareFile(ast));
    for (const message of this.#pendingMessages) {
      this.#resolveMessage(message);
    }
    for (const pending of this.#pendingExtensions) {
      this.#resolveExtension(pending);
    }
    for (const file of files) {
      this.#resolveServices(file);
    }
    return { files, warnings: this.#warnings };
  }
}

/** Builds the resolved model from the ASTs, given in dependency order. Throws a `ProtoError`. */
export function resolveFiles(asts: ProtoFileNode[], options: ResolveOptions = {}): ResolveResult {
  return new Resolver(options).run(asts);
}
