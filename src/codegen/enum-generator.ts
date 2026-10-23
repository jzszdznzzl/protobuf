import type { EnumModel } from '../model/types.ts';
import type { CodegenOptions } from '../options.ts';
import type { CodeWriter } from './code-writer.ts';
import { writeJsDoc } from './jsdoc.ts';

/**
 * Generates a protobuf enum as a frozen object plus a union type of the same name, and, for
 * closed enums, a type guard that tells whether a number is a declared value.
 */
export function generateEnum(writer: CodeWriter, model: EnumModel, options: CodegenOptions): void {
  const { tsName } = model;
  writeJsDoc(
    writer,
    {
      comment: model.comment,
      isDeprecated: model.isDeprecated,
      extra: [`Enum \`${model.fullName}\`.`],
    },
    options.shouldIncludeComments,
  );
  const shape = model.values.map((value) => `readonly ${value.name}: ${value.number}`).join('; ');
  writer.block(
    `export const ${tsName}: Readonly<{ ${shape} }> = Object.freeze({`,
    () => {
      for (const value of model.values) {
        writeJsDoc(
          writer,
          { comment: value.comment, isDeprecated: value.isDeprecated },
          options.shouldIncludeComments,
        );
        writer.line(`${value.name}: ${value.number},`);
      }
    },
    '} as const);',
  );
  writer.line(`export type ${tsName} = (typeof ${tsName})[keyof typeof ${tsName}];`);

  if (model.isClosed) {
    const numbers = [...new Set(model.values.map((value) => value.number))];
    writer.line();
    writer.line(
      `/** true if \`value\` is a declared value of \`${model.fullName}\` (closed enum). */`,
    );
    writer.block(`export function ${model.guardName}(value: number): value is ${tsName} {`, () => {
      writer.block('switch (value) {', () => {
        for (const number of numbers) {
          writer.line(`case ${number}:`);
        }
        writer.indent().line('return true;').dedent();
        writer.line('default:');
        writer.indent().line('return false;').dedent();
      });
    });
  }
  writer.line();
}
