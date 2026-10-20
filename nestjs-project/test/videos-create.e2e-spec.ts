import request from 'supertest';
import { Channel } from '../src/channels/entities/channel.entity';
import { User } from '../src/users/entities/user.entity';
import { Video, VideoStatus } from '../src/videos/entities/video.entity';
import {
  createVideosE2eApp,
  registerConfirmAndLogin,
  resetVideosE2eState,
  type ErrorResponseBody,
  type VideosE2eContext,
} from './support/videos-e2e';

interface CreateVideoUploadBody {
  public_id: string;
  status: string;
  part_size: number;
  part_count: number;
  parts: { part_number: number; url: string }[];
  expires_in: number;
}

const TEN_GIB = 10737418240;

describe('videos-create', () => {
  let ctx: VideosE2eContext;
  let accessToken: string;
  let email: string;
  let emailCounter = 0;

  beforeAll(async () => {
    ctx = await createVideosE2eApp();
  });

  afterAll(async () => {
    await resetVideosE2eState(ctx);
    await ctx.app.close();
  });

  beforeEach(async () => {
    await resetVideosE2eState(ctx);
    email = `videos_create_${++emailCounter}@example.com`;
    accessToken = await registerConfirmAndLogin(ctx.app, email);
  });

  const postVideos = (body: object, token: string | null = accessToken) => {
    const req = request(ctx.app.getHttpServer()).post('/videos');
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req.send(body);
  };

  const countVideos = () => ctx.dataSource.getRepository(Video).count();

  // 1. POST /videos (SI-03.9)

  test('cria-rascunho-e-devolve-urls-de-parte', async () => {
    const res = await postVideos({
      filename: 'clip.mp4',
      mime_type: 'video/mp4',
      size: TEN_GIB,
    });

    expect(res.status).toBe(201);
    const body = res.body as CreateVideoUploadBody;
    expect(body.status).toBe('draft');
    expect(body.part_size).toBe(104857600);
    expect(body.part_count).toBe(103);
    expect(body.expires_in).toBe(3600);
    expect(body.public_id).toMatch(/^[A-Za-z0-9_-]{11}$/);
    expect(body.parts).toHaveLength(103);
    expect(body.parts.map((p) => p.part_number)).toEqual(
      Array.from({ length: 103 }, (_, i) => i + 1),
    );
    const publicHost = new URL(process.env.STORAGE_PUBLIC_ENDPOINT!).host;
    for (const part of body.parts) {
      expect(new URL(part.url).host).toBe(publicHost);
    }
    expect(body).not.toHaveProperty('id');

    const user = await ctx.dataSource
      .getRepository(User)
      .findOneByOrFail({ email });
    const channel = await ctx.dataSource
      .getRepository(Channel)
      .findOneByOrFail({ user_id: user.id });
    const rows = await ctx.dataSource.getRepository(Video).find();
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toMatchObject({
      status: VideoStatus.DRAFT,
      channel_id: channel.id,
      title: 'clip.mp4',
      original_filename: 'clip.mp4',
      mime_type: 'video/mp4',
      declared_size: TEN_GIB,
      part_size: 104857600,
      public_id: body.public_id,
    });
    expect(row.upload_id).toEqual(expect.any(String));
    // The presigned part URLs necessarily carry the storage key
    // videos/{uuid}/source (TD-03); outside them the UUID never appears.
    expect(JSON.stringify({ ...body, parts: undefined })).not.toContain(row.id);
  });

  test('size-acima-do-maximo-retorna-400-sem-criar-linha', async () => {
    const res = await postVideos({
      filename: 'clip.mp4',
      mime_type: 'video/mp4',
      size: TEN_GIB + 1,
    });

    expect(res.status).toBe(400);
    const body = res.body as ErrorResponseBody;
    expect(body.statusCode).toBe(400);
    expect(body.error).toBe('VALIDATION_ERROR');
    expect(body.message).toContain('10737418240');
    expect(await countVideos()).toBe(0);
  });

  test('body-invalido-retorna-400-validation-error', async () => {
    const wrongMime = await postVideos({
      filename: 'clip.png',
      mime_type: 'image/png',
      size: 1024,
    });
    expect(wrongMime.status).toBe(400);
    expect((wrongMime.body as ErrorResponseBody).error).toBe(
      'VALIDATION_ERROR',
    );

    const missingFilename = await postVideos({
      mime_type: 'video/mp4',
      size: 1024,
    });
    expect(missingFilename.status).toBe(400);
    expect((missingFilename.body as ErrorResponseBody).error).toBe(
      'VALIDATION_ERROR',
    );

    expect(await countVideos()).toBe(0);
  });

  test('sem-token-retorna-401', async () => {
    const res = await postVideos(
      { filename: 'clip.mp4', mime_type: 'video/mp4', size: 1024 },
      null,
    );

    expect(res.status).toBe(401);
    expect(await countVideos()).toBe(0);
  });

  test('fora-do-throttling-de-auth', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await postVideos({
        filename: 'clip.mp4',
        mime_type: 'video/mp4',
        size: 1024,
      });
      statuses.push(res.status);
    }

    expect(statuses).toEqual(Array.from({ length: 11 }, () => 201));
    const rows = await ctx.dataSource.getRepository(Video).find();
    expect(rows).toHaveLength(11);
    expect(new Set(rows.map((r) => r.public_id)).size).toBe(11);
  });
});
