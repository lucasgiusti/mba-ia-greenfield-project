/** C0 control characters, DEL, double quote and backslash. */
// eslint-disable-next-line no-control-regex
const UNSAFE_FILENAME_CHARS = /[\u0000-\u001f\u007f"\\]/g;

/**
 * `attachment` Content-Disposition with the original file name, stripped of
 * the characters that could break out of the quoted `filename` parameter.
 */
export function buildAttachmentDisposition(originalFilename: string): string {
  const safeName = originalFilename.replace(UNSAFE_FILENAME_CHARS, '');
  return `attachment; filename="${safeName}"`;
}
