import type { MessageModel } from '../model/types.ts';
import type { CodegenOptions } from '../options.ts';

/**
 * A message keeps unknown fields if the option is enabled or if it accepts extensions, which
 * are stored in the same structure.
 */
export function hasUnknown(
  message: MessageModel,
  options: Pick<CodegenOptions, 'shouldKeepUnknownFields'>,
): boolean {
  return options.shouldKeepUnknownFields || message.extensionRanges.length > 0;
}
