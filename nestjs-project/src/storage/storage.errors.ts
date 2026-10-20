import { NoSuchUpload, S3ServiceException } from '@aws-sdk/client-s3';
import { S3_INVALID_PARTS_ERROR_NAMES } from './storage.constants';

export abstract class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** The multipart upload id does not exist (aborted, completed or expired). */
export class StorageUploadNotFoundError extends StorageError {
  constructor(key: string) {
    super(`Multipart upload not found for key ${key}`);
  }
}

/** Storage rejected the parts list sent to CompleteMultipartUpload. */
export class StorageInvalidPartsError extends StorageError {
  constructor(key: string, reason: string) {
    super(`Invalid multipart parts for key ${key}: ${reason}`);
  }
}

/** The object does not exist. */
export class StorageObjectNotFoundError extends StorageError {
  constructor(key: string) {
    super(`Object not found: ${key}`);
  }
}

/**
 * Translates S3 errors into typed storage errors. Errors not listed here are
 * returned unchanged so the caller re-throws them as-is.
 */
export const translateStorageError = (error: unknown, key: string): unknown => {
  if (error instanceof NoSuchUpload) {
    return new StorageUploadNotFoundError(key);
  }
  if (error instanceof S3ServiceException) {
    if (error.name === 'NoSuchUpload') {
      return new StorageUploadNotFoundError(key);
    }
    if (
      (S3_INVALID_PARTS_ERROR_NAMES as readonly string[]).includes(error.name)
    ) {
      return new StorageInvalidPartsError(key, error.name);
    }
    if (error.name === 'NotFound' || error.name === 'NoSuchKey') {
      return new StorageObjectNotFoundError(key);
    }
  }
  return error;
};
