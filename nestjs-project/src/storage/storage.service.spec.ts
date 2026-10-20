import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import storageConfig from '../config/storage.config';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';
import { videoSourceKey } from './storage.keys';

const INTERNAL_ENDPOINT = 'http://internal-storage.test:9000';
const PUBLIC_ENDPOINT = 'http://public-storage.test:9100';

describe('StorageService', () => {
  const originalEnv = { ...process.env };
  let module: TestingModule;
  let service: StorageService;
  const key = videoSourceKey('0b6f8a52-2f4e-4c34-9a0d-6a1f1d2c3b4a');

  beforeAll(async () => {
    process.env.STORAGE_ENDPOINT = INTERNAL_ENDPOINT;
    process.env.STORAGE_PUBLIC_ENDPOINT = PUBLIC_ENDPOINT;
    process.env.STORAGE_ACCESS_KEY = 'unit-access-key';
    process.env.STORAGE_SECRET_KEY = 'unit-secret-key';

    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [storageConfig],
        }),
        StorageModule,
      ],
    }).compile();
    service = module.get(StorageService);
  });

  afterAll(async () => {
    await module.close();
    process.env = originalEnv;
  });

  it('should sign upload part URLs for the public endpoint', async () => {
    const url = new URL(
      await service.presignUploadPart(key, 'upload-id', 3, 3600),
    );

    expect(url.origin).toBe(PUBLIC_ENDPOINT);
    expect(url.searchParams.get('partNumber')).toBe('3');
    expect(url.searchParams.get('uploadId')).toBe('upload-id');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('3600');
  });

  it('should sign public GET URLs for the public endpoint', async () => {
    const url = new URL(await service.presignGetPublic(key, 600));

    expect(url.origin).toBe(PUBLIC_ENDPOINT);
    expect(url.searchParams.has('response-content-disposition')).toBe(false);
  });

  it('should sign internal GET URLs for the internal endpoint', async () => {
    const url = new URL(await service.presignGetInternal(key, 600));

    expect(url.origin).toBe(INTERNAL_ENDPOINT);
  });

  it('should include response-content-disposition when a disposition is given', async () => {
    const disposition = 'attachment; filename="my-video.mp4"';

    const url = new URL(await service.presignGetPublic(key, 600, disposition));

    expect(url.searchParams.get('response-content-disposition')).toBe(
      disposition,
    );
  });
});
