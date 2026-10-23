import type { ServiceModel } from '../model/types.ts';
import type { CodegenOptions } from '../options.ts';
import type { CodeWriter } from './code-writer.ts';
import type { ImportManager } from './import-manager.ts';
import { writeJsDoc } from './jsdoc.ts';

const literal = (value: string): string => JSON.stringify(value);

/**
 * Generates, for each `service`:
 * - an interface with one method per RPC, to implement a server or a client, and
 * - a `XxxDefinition` descriptor with paths and request/response classes, useful to plug in any
 *   transport (gRPC, gRPC-web, HTTP, ...).
 */
export function generateService(
  writer: CodeWriter,
  service: ServiceModel,
  imports: ImportManager,
  options: CodegenOptions,
): void {
  writeJsDoc(
    writer,
    {
      comment: service.comment,
      isDeprecated: service.isDeprecated,
      extra: [`Service \`${service.fullName}\`.`],
    },
    options.shouldIncludeComments,
  );
  writer.block(`export interface ${service.tsName} {`, () => {
    for (const method of service.methods) {
      const request = imports.init(method.request);
      const response = imports.value(method.response);
      const parameter = method.isRequestStream ? `AsyncIterable<${request}>` : request;
      const result = method.isResponseStream
        ? `AsyncIterable<${response}>`
        : `Promise<${response}>`;
      writeJsDoc(
        writer,
        {
          comment: method.comment,
          isDeprecated: method.isDeprecated,
          extra: [`RPC \`${method.name}\`.`],
        },
        options.shouldIncludeComments,
      );
      writer.line(`${method.tsName}(request: ${parameter}): ${result};`);
    }
  });
  writer.line();

  // The explicit type keeps the declaration emit independent of type inference.
  const methodTypes = service.methods.map((method) => {
    const path = `/${service.fullName}/${method.name}`;
    return (
      `readonly ${method.tsName}: { readonly name: ${literal(method.name)}; readonly path: ${literal(path)}; ` +
      `readonly requestType: typeof ${imports.value(method.request)}; ` +
      `readonly responseType: typeof ${imports.value(method.response)}; ` +
      `readonly isRequestStream: ${method.isRequestStream}; readonly isResponseStream: ${method.isResponseStream} }`
    );
  });
  writer.line(`/** Descriptor of the service \`${service.fullName}\`. */`);
  writer.block(
    `export const ${service.definitionName}: { readonly name: ${literal(service.fullName)}; readonly methods: { ${methodTypes.join('; ')} } } = {`,
    () => {
      writer.line(`name: ${literal(service.fullName)},`);
      writer.block(
        'methods: {',
        () => {
          for (const method of service.methods) {
            writer.block(
              `${method.tsName}: {`,
              () => {
                writer.line(`name: ${literal(method.name)},`);
                writer.line(`path: ${literal(`/${service.fullName}/${method.name}`)},`);
                writer.line(`requestType: ${imports.value(method.request)},`);
                writer.line(`responseType: ${imports.value(method.response)},`);
                writer.line(`isRequestStream: ${method.isRequestStream},`);
                writer.line(`isResponseStream: ${method.isResponseStream},`);
              },
              '},',
            );
          }
        },
        '},',
      );
    },
    '};',
  );
  writer.line();
}
