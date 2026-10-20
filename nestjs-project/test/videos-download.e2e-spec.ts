import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { Video, VideoStatus } from '../src/videos/entities/video.entity';
import {
  createVideosE2eApp,
  registerConfirmAndLogin,
  resetVideosE2eState,
  type ErrorResponseBody,
  type VideosE2eContext,
} from './support/videos-e2e';

const FILE_SIZE = 4096; // single part
const INVALID_STATE = {
  statusCode: 409,
  error: 'INVALID_VIDEO_STATE',
  message: 'Video is not in a valid state for this operation',
};
const NOT_FOUND = {
  statusCode: 404,
  error: 'VIDEO_NOT_FOUND',
  message: 'Video not found',
};

describe('videos-download', () => {
  const originalPublicEndpoint = process.env.STORAGE_PUBLIC_ENDPOINT;
  const PUBLIC_ENDPOINT = 'http://minio:9000';
  let ctx: VideosE2eContext;
  let tokenA: string;
  let tokenB: string;
  let counter = 0;

  beforeAll(async () => {
    // The browser host (localhost:9000) is unreachable from inside the container.
    process.env.STORAGE_PUBLIC_ENDPOINT = PUBLIC_ENDPOINT;
    ctx = await createVideosE2eApp();
  });

  afterAll(async () => {
    await resetVideosE2eState(ctx);
    await ctx.app.close();
    process.env.STORAGE_PUBLIC_ENDPOINT = originalPublicEndpoint;
  });

  beforeEach(async () => {
    await resetVideosE2eState(ctx);
    const n = ++counter;
    tokenA = await registerConfirmAndLogin(
      ctx.app,
      `download_a_${n}@example.com`,
    );
    tokenB = await registerConfirmAndLogin(
      ctx.app,
      `download_b_${n}@example.com`,
    );
  });

  /**
   * A's video with a real source object, completed (→ processing). No worker
   * consumes the test queue here, so the wanted status is set on the row.
   */
  async function uploadedVideo(
    status: VideoStatus,
  ): Promise<{ publicId: string; bytes: Buffer }> {
    const bytes = randomBytes(FILE_SIZE);
    const init = await request(ctx.app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ filename: 'clip.mp4', mime_type: 'video/mp4', size: FILE_SIZE })
      .expect(201);
    const { public_id: publicId, parts } = init.body as {
      public_id: string;
      parts: { part_number: number; url: string }[];
    };
    const put = await fetch(parts[0].url, {
      method: 'PUT',
      body: new Uint8Array(bytes),
    });
    expect(put.status).toBe(200);
    await request(ctx.app.getHttpServer())
      .post(`/videos/${publicId}/upload/complete`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ parts: [{ part_number: 1, etag: put.headers.get('etag') }] })
      .expect(202);
    await setStatus(publicId, status);
    return { publicId, bytes };
  }

  const setStatus = (publicId: string, status: VideoStatus) =>
    ctx.dataSource
      .getRepository(Video)
      .update({ public_id: publicId }, { status });

  const getDownload = (publicId: string, token: string | null) => {
    const req = request(ctx.app.getHttpServer()).get(
      `/videos/${publicId}/download`,
    );
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req;
  };

  // 1. GET /videos/:publicId/download (SI-03.17)

  it('ready-do-dono-retorna-url-de-download-attachment', async () => {
    const { publicId, bytes } = await uploadedVideo(VideoStatus.READY);

    const res = await getDownload(publicId, tokenA);

    expect(res.status).toBe(200);
    const body = res.body as { url: string; expires_in: number };
    expect(body).toEqual({
      url: expect.any(String) as string,
      expires_in: 3600,
    });
    expect(new URL(body.url).host).toBe(new URL(PUBLIC_ENDPOINT).host);

    const file = await fetch(body.url);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-disposition')).toBe(
      'attachment; filename="clip.mp4"',
    );
    expect(Buffer.from(await file.arrayBuffer())).toEqual(bytes);
  });

  it('nao-ready-409-e-nao-dono-404', async () => {
    const { publicId } = await uploadedVideo(VideoStatus.READY);

    for (const status of [
      VideoStatus.DRAFT,
      VideoStatus.PROCESSING,
      VideoStatus.FAILED,
    ]) {
      await setStatus(publicId, status);

      const res = await getDownload(publicId, tokenA);

      expect(res.status).toBe(409);
      expect(res.body as ErrorResponseBody).toEqual(INVALID_STATE);
    }

    await setStatus(publicId, VideoStatus.READY);
    const otherChannel = await getDownload(publicId, tokenB);
    expect(otherChannel.status).toBe(404);
    expect(otherChannel.body as ErrorResponseBody).toEqual(NOT_FOUND);

    await setStatus(publicId, VideoStatus.DRAFT);
    const otherChannelDraft = await getDownload(publicId, tokenB);
    expect(otherChannelDraft.status).toBe(404);
    expect(otherChannelDraft.body as ErrorResponseBody).toEqual(NOT_FOUND);

    const anonymous = await getDownload(publicId, null);
    expect(anonymous.status).toBe(401);
  });
});
