import type { SourcePosition } from './ast/types.ts';

export const ProtoErrorCode = Object.freeze({
  InvalidOptions: 'invalid_options',
  Syntax: 'syntax',
  Import: 'import',
  Resolution: 'resolution',
  Emit: 'emit',
} as const);

export type ProtoErrorCode = (typeof ProtoErrorCode)[keyof typeof ProtoErrorCode];

interface ProtoErrorDetails {
  fileName?: string;
  position?: SourcePosition;
  cause?: unknown;
}

/**
 * A problem with the user's input (.proto files or options), never a bug in the generator.
 * The passes unwind with it and `generate` turns it into a `Result`.
 */
export class ProtoError extends Error {
  #code: ProtoErrorCode;
  #fileName: string | undefined;
  #position: SourcePosition | undefined;

  constructor(code: ProtoErrorCode, message: string, details: ProtoErrorDetails = {}) {
    super(message, { cause: details.cause });
    this.name = 'ProtoError';
    this.#code = code;
    this.#fileName = details.fileName;
    this.#position = details.position;
  }

  get code(): ProtoErrorCode {
    return this.#code;
  }

  get fileName(): string | undefined {
    return this.#fileName;
  }

  get position(): SourcePosition | undefined {
    return this.#position;
  }
}

export function syntaxError(
  message: string,
  fileName: string,
  position: SourcePosition,
): ProtoError {
  return new ProtoError(
    ProtoErrorCode.Syntax,
    `${fileName}:${position.line}:${position.column}: ${message}`,
    { fileName, position },
  );
}
