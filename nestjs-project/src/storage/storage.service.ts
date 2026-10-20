import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  type PutObjectCommandInput,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import storageConfig from '../config/storage.config';
import {
  STORAGE_INTERNAL_CLIENT,
  STORAGE_PUBLIC_SIGNER,
} from './storage.constants';
import { translateStorageError } from './storage.errors';

export interface UploadedPart {
  partNumber: number;
  etag: string;
}

export interface StoredObjectHead {
  contentLength: number;
  contentType: string | undefined;
}

@Injectable()
export class StorageService {
  private readonly bucket: string;

  constructor(
    @Inject(STORAGE_INTERNAL_CLIENT) private readonly internalClient: S3Client,
    @Inject(STORAGE_PUBLIC_SIGNER) private readonly publicSigner: S3Client,
    @Inject(storageConfig.KEY) config: ConfigType<typeof storageConfig>,
  ) {
    this.bucket = config.bucket;
  }

  async createMultipartUpload(
    key: string,
    contentType: string,
  ): Promise<string> {
    const { UploadId } = await this.run(key, () =>
      this.internalClient.send(
        new CreateMultipartUploadCommand({
          Bucket: this.bucket,
          Key: key,
          ContentType: contentType,
        }),
      ),
    );
    if (!UploadId) {
      throw new Error(`Storage returned no UploadId for key ${key}`);
    }
    return UploadId;
  }

  /** Part URL for the client, signed for STORAGE_PUBLIC_ENDPOINT. */
  async presignUploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    ttlSeconds: number,
  ): Promise<string> {
    return getSignedUrl(
      this.publicSigner,
      new UploadPartCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
      }),
      { expiresIn: ttlSeconds },
    );
  }

  async listParts(key: string, uploadId: string): Promise<UploadedPart[]> {
    const parts: UploadedPart[] = [];
    let marker: string | undefined;
    do {
      const page = await this.run(key, () =>
        this.internalClient.send(
          new ListPartsCommand({
            Bucket: this.bucket,
            Key: key,
            UploadId: uploadId,
            PartNumberMarker: marker,
          }),
        ),
      );
      for (const part of page.Parts ?? []) {
        if (part.PartNumber !== undefined && part.ETag !== undefined) {
          parts.push({ partNumber: part.PartNumber, etag: part.ETag });
        }
      }
      marker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
    } while (marker);
    return parts;
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: UploadedPart[],
  ): Promise<void> {
    const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    await this.run(key, () =>
      this.internalClient.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: sorted.map((p) => ({
              PartNumber: p.partNumber,
              ETag: p.etag,
            })),
          },
        }),
      ),
    );
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    await this.run(key, () =>
      this.internalClient.send(
        new AbortMultipartUploadCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
        }),
      ),
    );
  }

  async headObject(key: string): Promise<StoredObjectHead> {
    const head = await this.run(key, () =>
      this.internalClient.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      ),
    );
    return {
      contentLength: head.ContentLength ?? 0,
      contentType: head.ContentType,
    };
  }

  /** Succeeds when the key does not exist (S3 DeleteObject semantics). */
  async deleteObject(key: string): Promise<void> {
    await this.run(key, () =>
      this.internalClient.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      ),
    );
  }

  async putObject(
    key: string,
    body: PutObjectCommandInput['Body'],
    contentType: string,
  ): Promise<void> {
    await this.run(key, () =>
      this.internalClient.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      ),
    );
  }

  /** GET URL for server-side consumers (worker), signed for STORAGE_ENDPOINT. */
  async presignGetInternal(key: string, ttlSeconds: number): Promise<string> {
    return getSignedUrl(
      this.internalClient,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: ttlSeconds },
    );
  }

  /** GET URL for clients, signed for STORAGE_PUBLIC_ENDPOINT. */
  async presignGetPublic(
    key: string,
    ttlSeconds: number,
    contentDisposition?: string,
  ): Promise<string> {
    return getSignedUrl(
      this.publicSigner,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: contentDisposition,
      }),
      { expiresIn: ttlSeconds },
    );
  }

  /** Translates S3 errors raised by a storage call into typed storage errors. */
  private async run<T>(key: string, call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      throw translateStorageError(error, key);
    }
  }
}
