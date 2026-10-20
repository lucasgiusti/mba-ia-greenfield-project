import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { AuthService } from '../../src/auth/auth.service';
import { DomainExceptionFilter } from '../../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../../src/common/filters/validation-exception.filter';
import { cleanAllTables } from '../../src/test/create-test-data-source';
import { StorageService } from '../../src/storage/storage.service';
import { videoSourceKey } from '../../src/storage/storage.keys';
import { VIDEO_PROCESSING_QUEUE } from '../../src/video-processing/video-processing.constants';
import { Video } from '../../src/videos/entities/video.entity';

export interface ErrorResponseBody {
  statusCode: number;
  error: string;
  message: string | string[];
}

export interface VideosE2eContext {
  app: INestApplication<App>;
  dataSource: DataSource;
  queue: Queue;
  storage: StorageService;
  throttlerStorage: ThrottlerStorageService;
}

/** Boots AppModule with the global config of main.ts (pipes + filters). */
export async function createVideosE2eApp(): Promise<VideosE2eContext> {
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication<INestApplication<App>>();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(
    new DomainExceptionFilter(),
    new ValidationExceptionFilter(),
  );
  await app.init();

  return {
    app,
    dataSource: moduleFixture.get(DataSource),
    queue: moduleFixture.get<Queue>(getQueueToken(VIDEO_PROCESSING_QUEUE)),
    storage: moduleFixture.get(StorageService),
    throttlerStorage:
      moduleFixture.get<ThrottlerStorageService>(ThrottlerStorage),
  };
}

/**
 * Per-test reset: storage left by earlier tests (open multipart uploads and
 * source objects), DB rows, throttler counters and the processing queue.
 */
export async function resetVideosE2eState(
  ctx: VideosE2eContext,
): Promise<void> {
  const videos = await ctx.dataSource.getRepository(Video).find();
  for (const video of videos) {
    const key = videoSourceKey(video.id);
    if (video.upload_id) {
      // Already completed/aborted uploads are fine to skip.
      await ctx.storage
        .abortMultipartUpload(key, video.upload_id)
        .catch(() => undefined);
    }
    await ctx.storage.deleteObject(key);
  }
  await cleanAllTables(ctx.dataSource);
  ctx.throttlerStorage.storage.clear();
  await ctx.queue.obliterate({ force: true });
}

/** Same pattern as test/auth.e2e-spec.ts: capture the confirmation token, confirm, log in. */
export async function registerConfirmAndLogin(
  app: INestApplication<App>,
  email: string,
  password = 'password123',
): Promise<string> {
  const mailService = app.get(AuthService)['mailService'];
  let confirmationToken = '';
  jest
    .spyOn(mailService, 'sendConfirmationEmail')
    .mockImplementationOnce((_e: string, _n: string, t: string) => {
      confirmationToken = t;
      return Promise.resolve();
    });
  await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  await request(app.getHttpServer())
    .get('/auth/confirm-email')
    .query({ token: confirmationToken })
    .expect(204);
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password })
    .expect(200);
  return (res.body as { access_token: string }).access_token;
}
