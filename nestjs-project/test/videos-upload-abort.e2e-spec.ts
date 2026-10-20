import { randomBytes } from 'node:crypto';
import request from 'supertest';
import {
  StorageObjectNotFoundError,
  StorageUploadNotFoundError,
} from '../src/storage/storage.errors';
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

describe('videos-upload-abort', () => {
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
    tokenA = await registerConfirmAndLogin(ctx.app, `abort_a_${n}@example.com`);
    tokenB = await registerConfirmAndLogin(ctx.app, `abort_b_${n}@example.com`);
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

  /** 2-part draft of A; `uploadedParts` of them are PUT to storage. */
  async function createDraft(
    uploadedParts: 0 | 1 | 2,
  ): Promise<{ publicId: string; row: Video; parts: CompletedPart[] }> {
    const res = await request(ctx.app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ filename: 'clip.mp4', mime_type: 'video/mp4', size: DRAFT_SIZE })
      .expect(201);
    const body = res.body as { public_id: string; parts: PartUrl[] };
    const sizes = [PART_SIZE, DRAFT_SIZE - PART_SIZE];
    const parts: CompletedPart[] = [];
    for (let i = 0; i < uploadedParts; i++) {
      parts.push({
        part_number: i + 1,
        etag: await putPart(body.parts[i].url, sizes[i]),
      });
    }
    return {
      publicId: body.public_id,
      row: await findRow(body.public_id),
      parts,
    };
  }

  const deleteUpload = (publicId: string, token: string | null = tokenA) => {
    const req = request(ctx.app.getHttpServer()).delete(
      `/videos/${publicId}/upload`,
    );
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req;
  };

  const postComplete = (publicId: string, parts: CompletedPart[]) =>
    request(ctx.app.getHttpServer())
      .post(`/videos/${publicId}/upload/complete`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ parts });

  const findRow = (publicId: string) =>
    ctx.dataSource
      .getRepository(Video)
      .findOneByOrFail({ public_id: publicId });

  // 1. DELETE /videos/:publicId/upload (SI-03.12)

  test('abort-de-draft-retorna-204-e-remove-multipart', async () => {
    const { publicId, row } = await createDraft(1);

    const res = await deleteUpload(publicId);

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    await expect(
      ctx.storage.listParts(videoSourceKey(row.id), row.upload_id!),
    ).rejects.toBeInstanceOf(StorageUploadNotFoundError);
    expect((await findRow(publicId)).status).toBe(VideoStatus.DRAFT);
  });

  test('abort-repetido-retorna-204', async () => {
    const { publicId } = await createDraft(0);
    await deleteUpload(publicId).expect(204);

    const res = await deleteUpload(publicId);

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect((await findRow(publicId)).status).toBe(VideoStatus.DRAFT);
  });

  test('complete-apos-abort-retorna-409-inclusive-com-objeto-montado', async () => {
    const first = await createDraft(2);
    await deleteUpload(first.publicId).expect(204);
    const firstComplete = await postComplete(first.publicId, first.parts);
    expect(firstComplete.status).toBe(409);
    expect((firstComplete.body as ErrorResponseBody).error).toBe(
      'INVALID_VIDEO_STATE',
    );

    const second = await createDraft(2);
    const key = videoSourceKey(second.row.id);
    await ctx.storage.completeMultipartUpload(
      key,
      second.row.upload_id!,
      second.parts.map((p) => ({ partNumber: p.part_number, etag: p.etag })),
    );
    await expect(ctx.storage.headObject(key)).resolves.toMatchObject({
      contentLength: DRAFT_SIZE,
    });

    await deleteUpload(second.publicId).expect(204);
    await expect(ctx.storage.headObject(key)).rejects.toBeInstanceOf(
      StorageObjectNotFoundError,
    );

    const secondComplete = await postComplete(second.publicId, second.parts);
    expect(secondComplete.status).toBe(409);
    expect((secondComplete.body as ErrorResponseBody).error).toBe(
      'INVALID_VIDEO_STATE',
    );
    expect((await findRow(second.publicId)).status).toBe(VideoStatus.DRAFT);
    await expect(ctx.queue.getJob(second.row.id)).resolves.toBeUndefined();
  });

  test('estado-nao-draft-retorna-409', async () => {
    const { publicId, row } = await createDraft(0);

    for (const status of [
      VideoStatus.PROCESSING,
      VideoStatus.READY,
      VideoStatus.FAILED,
    ]) {
      await ctx.dataSource
        .getRepository(Video)
        .update({ public_id: publicId }, { status });

      const res = await deleteUpload(publicId);

      expect(res.status).toBe(409);
      expect(res.body as ErrorResponseBody).toEqual({
        statusCode: 409,
        error: 'INVALID_VIDEO_STATE',
        message: 'Video is not in a valid state for this operation',
      });
      expect((await findRow(publicId)).status).toBe(status);
      await expect(
        ctx.storage.listParts(videoSourceKey(row.id), row.upload_id!),
      ).resolves.toEqual([]);
    }
  });

  test('nao-dono-retorna-404', async () => {
    const { publicId, row } = await createDraft(0);

    const asB = await deleteUpload(publicId, tokenB);

    expect(asB.status).toBe(404);
    expect(asB.body as ErrorResponseBody).toEqual({
      statusCode: 404,
      error: 'VIDEO_NOT_FOUND',
      message: 'Video not found',
    });
    await expect(
      ctx.storage.listParts(videoSourceKey(row.id), row.upload_id!),
    ).resolves.toEqual([]);
    expect((await findRow(publicId)).status).toBe(VideoStatus.DRAFT);

    const anonymous = await deleteUpload(publicId, null);
    expect(anonymous.status).toBe(401);
  });
});
