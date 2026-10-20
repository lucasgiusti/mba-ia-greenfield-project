import { randomBytes } from 'node:crypto';
import request from 'supertest';
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

interface ResignBody {
  public_id: string;
  part_size: number;
  part_count: number;
  uploaded_parts: { part_number: number; etag: string }[];
  parts: PartUrl[];
  expires_in: number;
}

const PART_SIZE = 5242880;
const DRAFT_SIZE = 6291456; // 2 parts of 5 MiB

describe('videos-upload-resign', () => {
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
      `resign_a_${n}@example.com`,
    );
    tokenB = await registerConfirmAndLogin(
      ctx.app,
      `resign_b_${n}@example.com`,
    );
  });

  async function createDraft(): Promise<{
    publicId: string;
    parts: PartUrl[];
  }> {
    const res = await request(ctx.app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ filename: 'clip.mp4', mime_type: 'video/mp4', size: DRAFT_SIZE })
      .expect(201);
    const body = res.body as { public_id: string; parts: PartUrl[] };
    return { publicId: body.public_id, parts: body.parts };
  }

  const findRow = (publicId: string) =>
    ctx.dataSource
      .getRepository(Video)
      .findOneByOrFail({ public_id: publicId });

  const getResign = (
    publicId: string,
    token: string | null,
    server = ctx.app.getHttpServer(),
  ) => {
    const req = request(server).get(`/videos/${publicId}/upload`);
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req;
  };

  // 1. GET /videos/:publicId/upload (SI-03.10)

  test('retomada-devolve-parte-enviada-e-url-so-da-faltante', async () => {
    const { publicId, parts } = await createDraft();
    const put = await fetch(parts[0].url, {
      method: 'PUT',
      body: new Uint8Array(randomBytes(PART_SIZE)),
    });
    expect(put.status).toBe(200);
    const etag = put.headers.get('etag');
    expect(etag).toBeTruthy();
    const before = await findRow(publicId);

    const res = await getResign(publicId, tokenA);

    expect(res.status).toBe(200);
    const body = res.body as ResignBody;
    expect(body.public_id).toBe(publicId);
    expect(body.part_size).toBe(PART_SIZE);
    expect(body.part_count).toBe(2);
    expect(typeof body.expires_in).toBe('number');
    expect(body.uploaded_parts).toEqual([{ part_number: 1, etag }]);
    expect(body.parts).toHaveLength(1);
    expect(body.parts[0].part_number).toBe(2);
    expect(new URL(body.parts[0].url).host).toBe(
      new URL(process.env.STORAGE_PUBLIC_ENDPOINT!).host,
    );

    const after = await findRow(publicId);
    expect(after.status).toBe(VideoStatus.DRAFT);
    expect(after.upload_id).toBe(before.upload_id);
    await expect(ctx.queue.getJob(after.id)).resolves.toBeUndefined();
  });

  test('usa-part-size-persistido-apos-mudanca-de-config', async () => {
    const { publicId } = await createDraft();
    const row = await findRow(publicId);
    expect(row.part_size).toBe(PART_SIZE);
    expect(row.declared_size).toBe(DRAFT_SIZE);

    process.env.UPLOAD_PART_SIZE_BYTES = '10485760';
    const second = await createVideosE2eApp();
    try {
      const res = await getResign(publicId, tokenA, second.app.getHttpServer());

      expect(res.status).toBe(200);
      const body = res.body as ResignBody;
      expect(body.part_size).toBe(PART_SIZE);
      expect(body.part_count).toBe(2);
      expect(body.parts.map((p) => p.part_number)).toEqual([1, 2]);
      expect(body.uploaded_parts).toEqual([]);
    } finally {
      await second.app.close();
      process.env.UPLOAD_PART_SIZE_BYTES = String(PART_SIZE);
    }
  });

  test('nao-dono-ou-inexistente-retorna-404', async () => {
    const { publicId } = await createDraft();
    const notFound = {
      statusCode: 404,
      error: 'VIDEO_NOT_FOUND',
      message: 'Video not found',
    };

    const asB = await getResign(publicId, tokenB);
    expect(asB.status).toBe(404);
    expect(asB.body as ErrorResponseBody).toEqual(notFound);

    await ctx.dataSource
      .getRepository(Video)
      .update({ public_id: publicId }, { status: VideoStatus.READY });
    const asBReady = await getResign(publicId, tokenB);
    expect(asBReady.status).toBe(404);
    expect((asBReady.body as ErrorResponseBody).error).toBe('VIDEO_NOT_FOUND');

    const unknown = await getResign('AAAAAAAAAAA', tokenA);
    expect(unknown.status).toBe(404);
    expect((unknown.body as ErrorResponseBody).error).toBe('VIDEO_NOT_FOUND');

    const anonymous = await getResign(publicId, null);
    expect(anonymous.status).toBe(401);
  });

  test('estado-nao-draft-retorna-409', async () => {
    const { publicId } = await createDraft();
    const { upload_id: uploadId } = await findRow(publicId);

    for (const status of [
      VideoStatus.PROCESSING,
      VideoStatus.READY,
      VideoStatus.FAILED,
    ]) {
      await ctx.dataSource
        .getRepository(Video)
        .update({ public_id: publicId }, { status });

      const res = await getResign(publicId, tokenA);

      expect(res.status).toBe(409);
      expect(res.body as ErrorResponseBody).toEqual({
        statusCode: 409,
        error: 'INVALID_VIDEO_STATE',
        message: 'Video is not in a valid state for this operation',
      });
      const row = await findRow(publicId);
      expect(row.status).toBe(status);
      expect(row.upload_id).toBe(uploadId);
    }
  });

  test('multipart-abortado-retorna-409', async () => {
    const { publicId } = await createDraft();
    const row = await findRow(publicId);
    await ctx.storage.abortMultipartUpload(
      videoSourceKey(row.id),
      row.upload_id!,
    );

    const res = await getResign(publicId, tokenA);

    expect(res.status).toBe(409);
    expect((res.body as ErrorResponseBody).error).toBe('INVALID_VIDEO_STATE');
    const after = await findRow(publicId);
    expect(after.status).toBe(VideoStatus.DRAFT);
    expect(after.upload_id).toBe(row.upload_id);
  });
});
