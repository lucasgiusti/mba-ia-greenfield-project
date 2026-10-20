import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { Channel } from '../../channels/entities/channel.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { Video, VideoStatus } from './video.entity';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];
const TEN_GIB = 10737418240;
const PART_SIZE = 104857600;

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  let counter = 0;
  async function createChannel(): Promise<Channel> {
    const n = ++counter;
    const user = await userRepository.save(
      userRepository.create({
        email: `video_user_${n}@example.com`,
        password: 'hashed',
      }),
    );
    return channelRepository.save(
      channelRepository.create({
        name: `Channel ${n}`,
        nickname: `video_chan_${n}`,
        user_id: user.id,
      }),
    );
  }

  function buildVideo(channelId: string, overrides: Partial<Video> = {}) {
    const n = ++counter;
    return videoRepository.create({
      public_id: `pub${String(n).padStart(8, '0')}`,
      channel_id: channelId,
      title: `clip-${n}.mp4`,
      original_filename: `clip-${n}.mp4`,
      mime_type: 'video/mp4',
      declared_size: 1024,
      part_size: PART_SIZE,
      ...overrides,
    });
  }

  it('should enforce a unique public_id', async () => {
    const channel = await createChannel();
    await videoRepository.save(
      buildVideo(channel.id, { public_id: 'dupPublicId' }),
    );

    await expect(
      videoRepository.save(
        buildVideo(channel.id, { public_id: 'dupPublicId' }),
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('should default status to draft when not set', async () => {
    const channel = await createChannel();
    const saved = await videoRepository.save(buildVideo(channel.id));

    const found = await videoRepository.findOneByOrFail({ id: saved.id });
    expect(found.status).toBe(VideoStatus.DRAFT);
  });

  it('should reject a status outside the enum', async () => {
    const channel = await createChannel();
    const saved = await videoRepository.save(buildVideo(channel.id));

    await expect(
      dataSource.query(`UPDATE "videos" SET "status" = $1 WHERE "id" = $2`, [
        'published',
        saved.id,
      ]),
    ).rejects.toMatchObject({ code: '22P02' });
  });

  it('should allow null upload_id, duration_seconds and metadata', async () => {
    const channel = await createChannel();
    const saved = await videoRepository.save(buildVideo(channel.id));

    const found = await videoRepository.findOneByOrFail({ id: saved.id });
    expect(found.upload_id).toBeNull();
    expect(found.duration_seconds).toBeNull();
    expect(found.metadata).toBeNull();
  });

  it('should read declared_size of 10 GiB back as a number', async () => {
    const channel = await createChannel();
    const saved = await videoRepository.save(
      buildVideo(channel.id, { declared_size: TEN_GIB }),
    );

    const found = await videoRepository.findOneByOrFail({ id: saved.id });
    expect(found.declared_size).toBe(TEN_GIB);
    expect(typeof found.declared_size).toBe('number');
  });

  it('should require channel_id', async () => {
    await expect(
      dataSource.query(
        `INSERT INTO "videos" ("public_id", "title", "original_filename", "mime_type", "declared_size", "part_size")
         VALUES ('noChannel01', 't', 'f', 'video/mp4', 1, 1)`,
      ),
    ).rejects.toMatchObject({ code: '23502' });
  });

  it('should reject a channel_id that does not reference a channel', async () => {
    await expect(
      videoRepository.save(buildVideo('00000000-0000-4000-8000-000000000000')),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('should load the relation between video and channel in both directions', async () => {
    const channel = await createChannel();
    const saved = await videoRepository.save(buildVideo(channel.id));

    const video = await videoRepository.findOneOrFail({
      where: { id: saved.id },
      relations: ['channel'],
    });
    const loadedChannel = await channelRepository.findOneOrFail({
      where: { id: channel.id },
      relations: ['videos'],
    });

    expect(video.channel.id).toBe(channel.id);
    expect(loadedChannel.videos.map((v) => v.id)).toEqual([saved.id]);
  });

  it('should let cleanAllTables wipe videos linked to channels without FK violations', async () => {
    const channel = await createChannel();
    await videoRepository.save(buildVideo(channel.id));

    await expect(cleanAllTables(dataSource)).resolves.toBeUndefined();
    expect(await videoRepository.count()).toBe(0);
    expect(await channelRepository.count()).toBe(0);
  });
});
