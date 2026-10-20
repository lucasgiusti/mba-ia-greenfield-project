import { randomUUID } from 'crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import storageConfig from '../config/storage.config';
import { StorageModule } from './storage.module';
import { StorageService, type UploadedPart } from './storage.service';
import {
  StorageInvalidPartsError,
  StorageObjectNotFoundError,
  StorageUploadNotFoundError,
} from './storage.errors';
import { videoSourceKey } from './storage.keys';

const PART_SIZE = 5 * 1024 * 1024; // S3 minimum part size
const CONTENT_TYPE = 'video/mp4';
const URL_TTL_SECONDS = 600;
const BROWSER_ORIGIN = 'http://localhost:3001';

describe('StorageService (integration)', () => {
  const originalPublicEndpoint = process.env.STORAGE_PUBLIC_ENDPOINT;
  let module: TestingModule;
  let storage: StorageService;
  const createdKeys: string[] = [];

  const newKey = (): string => {
    const key = videoSourceKey(randomUUID());
    createdKeys.push(key);
    return key;
  };

  const putPart = async (
    key: string,
    uploadId: string,
    partNumber: number,
    body: Buffer,
  ): Promise<UploadedPart & { exposedHeaders: string }> => {
    const url = await storage.presignUploadPart(
      key,
      uploadId,
      partNumber,
      URL_TTL_SECONDS,
    );
    const response = await fetch(url, {
      method: 'PUT',
      // A browser always sends Origin on a cross-origin PUT; MinIO answers
      // with the CORS headers that make ETag readable by the page.
      headers: { Origin: BROWSER_ORIGIN },
      body: new Uint8Array(body),
    });
    expect(response.status).toBe(200);
    const etag = response.headers.get('etag');
    expect(etag).toBeTruthy();
    return {
      partNumber,
      etag: etag!,
      exposedHeaders:
        response.headers.get('access-control-expose-headers') ?? '',
    };
  };

  beforeAll(async () => {
    // The browser host (localhost:9000) is unreachable from inside the
    // container, so "public" URLs are signed for the Compose service here.
    process.env.STORAGE_PUBLIC_ENDPOINT = 'http://minio:9000';

    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        StorageModule,
      ],
    }).compile();
    storage = module.get(StorageService);
  });

  afterAll(async () => {
    for (const key of createdKeys) {
      await storage.deleteObject(key);
    }
    await module.close();
    process.env.STORAGE_PUBLIC_ENDPOINT = originalPublicEndpoint;
  });

  describe('multipart upload through presigned part URLs', () => {
    const key = videoSourceKey(randomUUID());
    const partBodies = [
      Buffer.alloc(PART_SIZE, 0x61),
      Buffer.alloc(PART_SIZE, 0x62),
    ];
    let uploadId: string;
    let uploadedParts: UploadedPart[];
    let exposedHeaders: string[];

    beforeAll(async () => {
      createdKeys.push(key);
      uploadId = await storage.createMultipartUpload(key, CONTENT_TYPE);
      uploadedParts = [];
      exposedHeaders = [];
      for (const [index, body] of partBodies.entries()) {
        const { exposedHeaders: exposed, ...part } = await putPart(
          key,
          uploadId,
          index + 1,
          body,
        );
        uploadedParts.push(part);
        exposedHeaders.push(exposed);
      }
    });

    it('should expose the ETag header to browsers on part PUTs (CORS)', () => {
      for (const exposed of exposedHeaders) {
        expect(exposed.toLowerCase().split(/\s*,\s*/)).toContain('etag');
      }
    });

    it('should list the uploaded parts with their ETags', async () => {
      const parts = await storage.listParts(key, uploadId);

      expect(parts).toEqual(uploadedParts);
    });

    it('should complete with the part ETags and store an object of the summed size', async () => {
      // Out of order on purpose: the service sorts by part number.
      await storage.completeMultipartUpload(
        key,
        uploadId,
        [...uploadedParts].reverse(),
      );

      const head = await storage.headObject(key);
      expect(head.contentLength).toBe(PART_SIZE * partBodies.length);
      expect(head.contentType).toBe(CONTENT_TYPE);
    });

    it('should serve a byte range through an internal presigned GET', async () => {
      const url = await storage.presignGetInternal(key, URL_TTL_SECONDS);

      const response = await fetch(url, { headers: { Range: 'bytes=0-99' } });
      const body = Buffer.from(await response.arrayBuffer());

      expect(response.status).toBe(206);
      expect(body).toHaveLength(100);
      expect(body.equals(partBodies[0].subarray(0, 100))).toBe(true);
    });
  });

  describe('aborted multipart upload', () => {
    let key: string;
    let uploadId: string;

    beforeAll(async () => {
      key = newKey();
      uploadId = await storage.createMultipartUpload(key, CONTENT_TYPE);
      await storage.abortMultipartUpload(key, uploadId);
    });

    // This MinIO build answers 204 to a repeated AbortMultipartUpload instead
    // of NoSuchUpload, so the NoSuchUpload translation is exercised through
    // ListParts / CompleteMultipartUpload on the aborted upload id.
    it('should accept a repeated abort without error (MinIO answers 204)', async () => {
      await expect(
        storage.abortMultipartUpload(key, uploadId),
      ).resolves.toBeUndefined();
    });

    it('should raise StorageUploadNotFoundError when listing parts', async () => {
      await expect(storage.listParts(key, uploadId)).rejects.toBeInstanceOf(
        StorageUploadNotFoundError,
      );
    });

    it('should raise StorageUploadNotFoundError when completing', async () => {
      await expect(
        storage.completeMultipartUpload(key, uploadId, [
          { partNumber: 1, etag: '"00000000000000000000000000000000"' },
        ]),
      ).rejects.toBeInstanceOf(StorageUploadNotFoundError);
    });
  });

  it('should raise StorageInvalidPartsError when completing with a wrong ETag', async () => {
    const key = newKey();
    const uploadId = await storage.createMultipartUpload(key, CONTENT_TYPE);
    await putPart(key, uploadId, 1, Buffer.alloc(1024, 0x63));

    await expect(
      storage.completeMultipartUpload(key, uploadId, [
        { partNumber: 1, etag: '"00000000000000000000000000000000"' },
      ]),
    ).rejects.toBeInstanceOf(StorageInvalidPartsError);

    await storage.abortMultipartUpload(key, uploadId);
  });

  it('should raise StorageObjectNotFoundError on headObject of a missing key', async () => {
    await expect(storage.headObject(newKey())).rejects.toBeInstanceOf(
      StorageObjectNotFoundError,
    );
  });

  it('should not fail when deleting a missing key', async () => {
    await expect(storage.deleteObject(newKey())).resolves.toBeUndefined();
  });

  it('should store an object with putObject', async () => {
    const key = newKey();
    const body = Buffer.from('thumbnail-bytes');

    await storage.putObject(key, body, 'image/jpeg');

    const head = await storage.headObject(key);
    expect(head).toEqual({
      contentLength: body.length,
      contentType: 'image/jpeg',
    });
  });
});
