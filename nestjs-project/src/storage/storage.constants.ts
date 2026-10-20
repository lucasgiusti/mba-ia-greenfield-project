/** S3 client that sends every server-side request (endpoint STORAGE_ENDPOINT). */
export const STORAGE_INTERNAL_CLIENT = Symbol('STORAGE_INTERNAL_CLIENT');

/**
 * S3 client used only to sign URLs handed to clients (endpoint
 * STORAGE_PUBLIC_ENDPOINT). It never sends requests itself.
 */
export const STORAGE_PUBLIC_SIGNER = Symbol('STORAGE_PUBLIC_SIGNER');

/** S3 error names that mean the client-supplied parts list was rejected. */
export const S3_INVALID_PARTS_ERROR_NAMES = [
  'InvalidPart',
  'InvalidPartOrder',
  'EntityTooSmall',
] as const;
