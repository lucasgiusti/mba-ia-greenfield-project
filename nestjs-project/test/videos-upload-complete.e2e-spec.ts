import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { StorageObjectNotFoundError } from '../src/storage/storage.errors';
import { videoSourceKey } from '../src/storage/storage.keys';
import { Video, VideoStatus } from '../src/videos/entities/video.entity';
import {
  createVideosE2eApp,
  registerConfirmAndLogin,
  resetVideosE2eState,
  type ErrorResponseBody,
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

const PART_SIZE = 5242880;
const DRAFT_SIZE = 6291456; // part 1 = 5 MiB, part 2 = 1 MiB
const INVALID_STATE = {
  statusCode: 409,
  error: 'INVALID_VIDEO_STATE',
  message: 'Video is not in a valid state for this operation',
};

describe('videos-upload-complete', () => {
  const originalEnv = {
    STORAGE_PUBLIC_ENDPOINT: process.env.STORAGE_PUBLIC_ENDPOINT,
    UPLOAD_PART_SIZE_BYTES: process.env.UPLOAD_PART_SIZE_BYTES,
  };
  let ctx: VideosE2eContext;
  let tokenA: string;
  let tokenB: string;
  let counter = 0;

  beforeAll(async () => {
    // The browser host (localhost:9000) is unreachable from inside the container.
    process.env.STORAGE_PUBLIC_ENDPOINT = 'http://minio:9000';
    process.env.UPLOAD_PART_SIZE_BYTES = String(PART_SIZE);
    ctx = await createVideosE2eApp();
  });

  afterAll(async () => {
    await resetVideosE2eState(ctx);
    await ctx.app.close();
    process.env.STORAGE_PUBLIC_ENDPOINT = originalEnv.STORAGE_PUBLIC_ENDPOINT;
    process.env.UPLOAD_PART_SIZE_BYTES = originalEnv.UPLOAD_PART_SIZE_BYTES;
  });

  beforeEach(async () => {
    await resetVideosE2eState(ctx);
    const n = ++counter;
    tokenA = await registerConfirmAndLogin(
      ctx.app,
      `complete_a_${n}@example.com`,
    );
    tokenB = await registerConfirmAndLogin(
      ctx.app,
      `complete_b_${n}@example.com`,
    );
  });

  async function putPart(url: string, size: number): Promise<string> {
    const res = await fetch(url, {
      method: 'PUT',
      body: new Uint8Array(randomBytes(size)),
    });
    expect(res.status).toBe(200);
    const etag = res.headers.get('etag');
    expect(etag).toBeTruthy();
    return etag!;
  }

  /** 2-part draft of A with both parts uploaded. */
  async function uploadedDraft(
    lastPartSize = DRAFT_SIZE - PART_SIZE,
  ): Promise<{ publicId: string; parts: CompletedPart[] }> {
    const res = await request(ctx.app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ filename: 'clip.mp4', mime_type: 'video/mp4', size: DRAFT_SIZE })
      .expect(201);
    const body = res.body as { public_id: string; parts: PartUrl[] };
    const etag1 = await putPart(body.parts[0].url, PART_SIZE);
    const etag2 = await putPart(body.parts[1].url, lastPartSize);
    return {
      publicId: body.public_id,
      parts: [
        { part_number: 1, etag: etag1 },
        { part_number: 2, etag: etag2 },
      ],
    };
  }

  const postComplete = (
    publicId: string,
    body: object,
    token: string | null = tokenA,
  ) => {
    const req = request(ctx.app.getHttpServer()).post(
      `/videos/${publicId}/upload/complete`,
    );
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req.send(body);
  };

  const findRow = (publicId: string) =>
    ctx.dataSource
      .getRepository(Video)
      .findOneByOrFail({ public_id: publicId });

  // 1. POST /videos/:publicId/upload/complete (SI-03.11)

  test('complete-valido-move-para-processing-e-enfileira', async () => {
    const { publicId, parts } = await uploadedDraft();

    const res = await postComplete(publicId, { parts });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ public_id: publicId, status: 'processing' });
    const row = await findRow(publicId);
    expect(row.status).toBe(VideoStatus.PROCESSING);
    const job = await ctx.queue.getJob(row.id);
    expect(job?.name).toBe('process');
    expect(job?.data).toEqual({ videoId: row.id });
    await expect(
      ctx.storage.headObject(videoSourceKey(row.id)),
    ).resolves.toMatchObject({ contentLength: DRAFT_SIZE });
  });

  test('complete-repetido-em-processing-e-idempotente', async () => {
    const { publicId, parts } = await uploadedDraft();
    await postComplete(publicId, { parts }).expect(202);

    const res = await postComplete(publicId, { parts });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ public_id: publicId, status: 'processing' });
    const row = await findRow(publicId);
    const jobs = await ctx.queue.getJobs(['waiting', 'delayed', 'active']);
    expect(jobs.map((j) => j.id)).toEqual([row.id]);
    const counts = await ctx.queue.getJobCounts();
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(1);
  });

  test('lista-de-partes-invalida-retorna-422-sem-efeito', async () => {
    const { publicId, parts } = await uploadedDraft();
    const before = await findRow(publicId);
    const invalidParts = {
      statusCode: 422,
      error: 'INVALID_UPLOAD_PARTS',
      message: 'Upload parts list is invalid',
    };

    const missing = await postComplete(publicId, { parts: [parts[0]] });
    expect(missing.status).toBe(422);
    expect(missing.body as ErrorResponseBody).toEqual(invalidParts);

    const repeated = await postComplete(publicId, {
      parts: [parts[0], parts[0]],
    });
    expect(repeated.status).toBe(422);
    expect((repeated.body as ErrorResponseBody).error).toBe(
      'INVALID_UPLOAD_PARTS',
    );

    const tampered = await postComplete(publicId, {
      parts: [parts[0], { part_number: 2, etag: `"${'0'.repeat(32)}"` }],
    });
    expect(tampered.status).toBe(422);
    expect((tampered.body as ErrorResponseBody).error).toBe(
      'INVALID_UPLOAD_PARTS',
    );

    const after = await findRow(publicId);
    expect(after.status).toBe(VideoStatus.DRAFT);
    expect(after.upload_id).toBe(before.upload_id);
    await expect(ctx.queue.getJob(after.id)).resolves.toBeUndefined();

    const resign = await request(ctx.app.getHttpServer())
      .get(`/videos/${publicId}/upload`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(resign.status).toBe(200);
    expect(
      (resign.body as { uploaded_parts: CompletedPart[] }).uploaded_parts,
    ).toEqual(parts);
  });

  test('tamanho-divergente-retorna-422-e-descarta-objeto', async () => {
    const { publicId, parts } = await uploadedDraft(524288);

    const res = await postComplete(publicId, { parts });

    expect(res.status).toBe(422);
    expect(res.body as ErrorResponseBody).toEqual({
      statusCode: 422,
      error: 'UPLOAD_VERIFICATION_FAILED',
      message: 'Uploaded file does not match the declared size',
    });
    const row = await findRow(publicId);
    expect(row.status).toBe(VideoStatus.DRAFT);
    await expect(
      ctx.storage.headObject(videoSourceKey(row.id)),
    ).rejects.toBeInstanceOf(StorageObjectNotFoundError);
    await expect(ctx.queue.getJob(row.id)).resolves.toBeUndefined();
  });

  test('ready-failed-ou-apos-abort-retorna-409', async () => {
    const first = await uploadedDraft();
    for (const status of [VideoStatus.READY, VideoStatus.FAILED]) {
      await ctx.dataSource
        .getRepository(Video)
        .update({ public_id: first.publicId }, { status });

      const res = await postComplete(first.publicId, { parts: first.parts });

      expect(res.status).toBe(409);
      expect(res.body as ErrorResponseBody).toEqual(INVALID_STATE);
      const row = await findRow(first.publicId);
      expect(row.status).toBe(status);
      await expect(ctx.queue.getJob(row.id)).resolves.toBeUndefined();
    }

    const second = await uploadedDraft();
    await request(ctx.app.getHttpServer())
      .delete(`/videos/${second.publicId}/upload`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(204);

    const res = await postComplete(second.publicId, { parts: second.parts });

    expect(res.status).toBe(409);
    expect((res.body as ErrorResponseBody).error).toBe('INVALID_VIDEO_STATE');
    const row = await findRow(second.publicId);
    expect(row.status).toBe(VideoStatus.DRAFT);
    await expect(ctx.queue.getJob(row.id)).resolves.toBeUndefined();
  });

  test('nao-dono-404-e-body-sem-parts-400', async () => {
    const { publicId, parts } = await uploadedDraft();

    const asB = await postComplete(publicId, { parts }, tokenB);
    expect(asB.status).toBe(404);
    expect(asB.body as ErrorResponseBody).toEqual({
      statusCode: 404,
      error: 'VIDEO_NOT_FOUND',
      message: 'Video not found',
    });
    const row = await findRow(publicId);
    expect(row.status).toBe(VideoStatus.DRAFT);
    await expect(ctx.queue.getJob(row.id)).resolves.toBeUndefined();

    const noParts = await postComplete(publicId, {});
    expect(noParts.status).toBe(400);
    expect((noParts.body as ErrorResponseBody).error).toBe('VALIDATION_ERROR');

    const anonymous = await postComplete(publicId, { parts }, null);
    expect(anonymous.status).toBe(401);
  });
});
