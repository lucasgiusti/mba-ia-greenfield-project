import { readFile, rm } from 'node:fs/promises';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { videoThumbnailKey, videoSourceKey } from '../src/storage/storage.keys';
import {
  generateRandomBytesFile,
  generateTestVideo,
  type GeneratedFile,
} from '../src/test/generate-test-video';
import { useTestQueuePrefix } from '../src/test/test-queue-prefix';
import { VideoProcessingConsumer } from '../src/video-processing/video-processing.consumer';
import { Video, VideoStatus } from '../src/videos/entities/video.entity';
import { WorkerModule } from '../src/worker.module';
import {
  createVideosE2eApp,
  registerConfirmAndLogin,
  resetVideosE2eState,
  type VideosE2eContext,
} from './support/videos-e2e';

interface PartUrl {
  part_number: number;
  url: string;
}

interface CompletedPart {
  part_number: number;
  etag: string;
}

interface DeliveryUrlBody {
  url: string;
  expires_in: number;
}

const PART_SIZE = 5242880; // 5 MiB
const TWO_PART_VIDEO_SIZE = 6291456; // 6 MiB → part 1 = 5 MiB, part 2 = 1 MiB
const PROCESSING_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 200;

jest.setTimeout(120_000);

describe('video-lifecycle', () => {
  const originalEnv = {
    STORAGE_PUBLIC_ENDPOINT: process.env.STORAGE_PUBLIC_ENDPOINT,
    UPLOAD_PART_SIZE_BYTES: process.env.UPLOAD_PART_SIZE_BYTES,
  };
  let ctx: VideosE2eContext;
  let worker: TestingModule;
  let consumer: VideoProcessingConsumer;
  let token: string;
  let counter = 0;
  const generated: GeneratedFile[] = [];

  beforeAll(async () => {
    // The browser host (localhost:9000) is unreachable from inside the container.
    process.env.STORAGE_PUBLIC_ENDPOINT = 'http://minio:9000';
    process.env.UPLOAD_PART_SIZE_BYTES = String(PART_SIZE);
    ctx = await createVideosE2eApp();

    // API and WorkerModule in the same process. The worker is built with the
    // testing builder (instead of NestFactory.createApplicationContext) so it
    // consumes the test queue prefix — the video-worker container (default
    // prefix) never sees these jobs.
    worker = await useTestQueuePrefix(
      Test.createTestingModule({ imports: [WorkerModule] }),
    ).compile();
    await worker.init();
    consumer = worker.get(VideoProcessingConsumer);
    await consumer.worker.waitUntilReady();
  });

  afterAll(async () => {
    await resetVideosE2eState(ctx);
    await worker?.close();
    await ctx.app.close();
    await Promise.all(generated.map((f) => rm(f.path, { force: true })));
    process.env.STORAGE_PUBLIC_ENDPOINT = originalEnv.STORAGE_PUBLIC_ENDPOINT;
    process.env.UPLOAD_PART_SIZE_BYTES = originalEnv.UPLOAD_PART_SIZE_BYTES;
  });

  beforeEach(async () => {
    if (consumer.worker.isPaused()) await consumer.worker.resume();
    await resetVideosE2eState(ctx);
    token = await registerConfirmAndLogin(
      ctx.app,
      `lifecycle_${++counter}@example.com`,
    );
  });

  const findRow = (publicId: string) =>
    ctx.dataSource
      .getRepository(Video)
      .findOneByOrFail({ public_id: publicId });

  /** Bounded polling until the row reaches one of the terminal states. */
  async function waitForTerminalStatus(publicId: string): Promise<Video> {
    const deadline = Date.now() + PROCESSING_TIMEOUT_MS;
    for (;;) {
      const row = await findRow(publicId);
      if (
        row.status === VideoStatus.READY ||
        row.status === VideoStatus.FAILED
      ) {
        return row;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `video ${publicId} still "${row.status}" after ${PROCESSING_TIMEOUT_MS} ms`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  /** POST /videos + presigned PUT of every part straight to MinIO. */
  async function initAndUpload(
    file: GeneratedFile,
  ): Promise<{ publicId: string; parts: CompletedPart[] }> {
    const init = await request(ctx.app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${token}`)
      .send({ filename: 'clip.mp4', mime_type: 'video/mp4', size: file.size })
      .expect(201);
    const body = init.body as { public_id: string; parts: PartUrl[] };
    expect(body.parts).toHaveLength(Math.ceil(file.size / PART_SIZE));

    const draft = await findRow(body.public_id);
    expect(draft.status).toBe(VideoStatus.DRAFT);

    const bytes = await readFile(file.path);
    const parts: CompletedPart[] = [];
    for (const part of body.parts) {
      const start = (part.part_number - 1) * PART_SIZE;
      const res = await fetch(part.url, {
        method: 'PUT',
        body: new Uint8Array(bytes.subarray(start, start + PART_SIZE)),
      });
      expect(res.status).toBe(200);
      const etag = res.headers.get('etag');
      expect(etag).toBeTruthy();
      parts.push({ part_number: part.part_number, etag: etag! });
    }
    return { publicId: body.public_id, parts };
  }

  const postComplete = (publicId: string, parts: CompletedPart[]) =>
    request(ctx.app.getHttpServer())
      .post(`/videos/${publicId}/upload/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ parts });

  /** Full client flow: init → PUT parts → complete → (worker) → terminal state. */
  async function uploadAndProcess(file: GeneratedFile): Promise<Video> {
    const { publicId, parts } = await initAndUpload(file);
    await postComplete(publicId, parts).expect(202);
    return waitForTerminalStatus(publicId);
  }

  async function newVideo(minSizeBytes = 0): Promise<GeneratedFile> {
    const file = await generateTestVideo({ minSizeBytes });
    generated.push(file);
    return file;
  }

  test('upload-multipart-real-de-duas-partes-vai-de-draft-a-processing-a-ready-com-metadados-e-thumbnail', async () => {
    const file = await newVideo(TWO_PART_VIDEO_SIZE);
    expect(file.size).toBeGreaterThan(PART_SIZE);
    const { publicId, parts } = await initAndUpload(file);
    expect(parts).toHaveLength(2);

    // Worker paused only to observe `processing` deterministically in the DB.
    await consumer.worker.pause();
    const complete = await postComplete(publicId, parts);
    expect(complete.status).toBe(202);
    expect(complete.body).toEqual({
      public_id: publicId,
      status: 'processing',
    });
    expect((await findRow(publicId)).status).toBe(VideoStatus.PROCESSING);
    await consumer.worker.resume();

    // No further client calls: the worker moves the row to `ready`.
    const row = await waitForTerminalStatus(publicId);

    expect(row.status).toBe(VideoStatus.READY);
    expect(row.duration_seconds).toBeGreaterThan(2.5);
    expect(row.duration_seconds).toBeLessThan(3.5);
    expect(row.metadata).toMatchObject({
      width: 320,
      height: 240,
      video_codec: 'h264',
      size: file.size,
    });
    await expect(
      ctx.storage.headObject(videoThumbnailKey(row.id)),
    ).resolves.toMatchObject({ contentType: 'image/jpeg' });
    const thumbnail = await ctx.storage.headObject(videoThumbnailKey(row.id));
    expect(thumbnail.contentLength).toBeGreaterThan(0);
  });

  test('video-ready-responde-206-no-stream-com-range-e-attachment-no-download', async () => {
    const file = await newVideo();
    const row = await uploadAndProcess(file);
    expect(row.status).toBe(VideoStatus.READY);

    const stream = await request(ctx.app.getHttpServer())
      .get(`/videos/${row.public_id}/stream`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const streamRes = await fetch((stream.body as DeliveryUrlBody).url, {
      headers: { Range: 'bytes=0-1023' },
    });
    expect(streamRes.status).toBe(206);
    expect(streamRes.headers.get('content-range')).toBe(
      `bytes 0-1023/${file.size}`,
    );
    expect((await streamRes.arrayBuffer()).byteLength).toBe(1024);

    const download = await request(ctx.app.getHttpServer())
      .get(`/videos/${row.public_id}/download`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const downloadRes = await fetch((download.body as DeliveryUrlBody).url);
    expect(downloadRes.status).toBe(200);
    expect(downloadRes.headers.get('content-disposition')).toMatch(
      /^attachment; filename="clip\.mp4"$/,
    );
    expect((await downloadRes.arrayBuffer()).byteLength).toBe(file.size);
  });

  test('dois-videos-do-mesmo-usuario-recebem-public-id-distintos', async () => {
    const first = await uploadAndProcess(await newVideo());
    const second = await uploadAndProcess(await newVideo());

    expect(first.status).toBe(VideoStatus.READY);
    expect(second.status).toBe(VideoStatus.READY);
    expect(first.public_id).not.toBe(second.public_id);
    expect(first.id).not.toBe(second.id);
  });

  test('arquivo-nao-decodificavel-termina-em-failed-e-permanece-no-banco-e-no-storage', async () => {
    const file = await generateRandomBytesFile();
    generated.push(file);

    const row = await uploadAndProcess(file);

    expect(row.status).toBe(VideoStatus.FAILED);
    expect(row.duration_seconds).toBeNull();
    expect(row.metadata).toBeNull();
    await expect(
      ctx.storage.headObject(videoSourceKey(row.id)),
    ).resolves.toMatchObject({ contentLength: file.size });
  });
});
