import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService, type ConfigType } from '@nestjs/config';
import {
  BullModule,
  getQueueToken,
  getSharedConfigToken,
  type BullRootModuleOptions,
} from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import storageConfig from '../config/storage.config';
import queueConfig from '../config/queue.config';
import uploadConfig from '../config/upload.config';
import { CoreModule } from './core.module';

const PROBE_QUEUE = 'core-module-probe';

describe('CoreModule (integration)', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      // The probe queue only exists to make BullMQ open a real Redis
      // connection with the root connection options from CoreModule.
      imports: [CoreModule, BullModule.registerQueue({ name: PROBE_QUEUE })],
    }).compile();
    await moduleRef.init();
  });

  afterAll(async () => {
    const queue = moduleRef.get<Queue>(getQueueToken(PROBE_QUEUE));
    await queue.obliterate({ force: true });
    await moduleRef.close();
  });

  it('should initialize the TypeORM DataSource against the db service', async () => {
    const dataSource = moduleRef.get(DataSource);

    expect(dataSource.isInitialized).toBe(true);
    await expect(dataSource.query('SELECT 1 AS ok')).resolves.toEqual([
      { ok: 1 },
    ]);
  });

  it('should expose the storage, queue and upload config namespaces', () => {
    const config = moduleRef.get(ConfigService);

    const storage = config.get<ConfigType<typeof storageConfig>>('storage');
    const queue = config.get<ConfigType<typeof queueConfig>>('queue');
    const upload = config.get<ConfigType<typeof uploadConfig>>('upload');

    expect(storage?.endpoint).toBe(process.env.STORAGE_ENDPOINT);
    expect(storage?.publicEndpoint).toBe(process.env.STORAGE_PUBLIC_ENDPOINT);
    expect(storage?.bucket).toBe(process.env.STORAGE_BUCKET);
    expect(queue).toEqual({
      host: process.env.REDIS_HOST,
      port: Number(process.env.REDIS_PORT),
    });
    expect(upload).toEqual({
      maxSizeBytes: Number(process.env.UPLOAD_MAX_SIZE_BYTES),
      partSizeBytes: Number(process.env.UPLOAD_PART_SIZE_BYTES),
      partUrlTtlSeconds: Number(process.env.UPLOAD_PART_URL_TTL_SECONDS),
    });
  });

  it('should configure the BullMQ root connection with the Compose Redis host', () => {
    const options = moduleRef.get<BullRootModuleOptions>(
      getSharedConfigToken(),
    );

    expect(options.connection).toEqual({ host: 'redis', port: 6379 });
  });

  it('should connect to the real Redis through the root connection', async () => {
    const queue = moduleRef.get<Queue>(getQueueToken(PROBE_QUEUE));

    await queue.waitUntilReady();
    await queue.add('probe', { ok: true });

    // Round-trip to Redis: the job written above is read back from the server.
    await expect(queue.getJobCounts('waiting')).resolves.toEqual({
      waiting: 1,
    });
  });
});
