/**
 * Folder with the well-known .proto files shipped with the package. This module sits one level
 * under the package root both in `src/` and in `dist/`, so the same relative URL works for both.
 */
export const BUILTIN_PROTO_DIR = new URL('../protos/', import.meta.url);
