import { execFile } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { Test, type TestingModule } from '@nestjs/testing';
import { UnrecoverableError } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { CoreModule } from '../core/core.module';
import { StorageObjectNotFoundError } from '../storage/storage.errors';
import { StorageModule } from '../storage/storage.module';
import { StorageService } from '../storage/storage.service';
import { videoSourceKey, videoThumbnailKey } from '../storage/storage.keys';
import { cleanAllTables } from '../test/create-test-data-source';
import {
  generateRandomBytesFile,
  generateTestVideo,
  type GeneratedFile,
} from '../test/generate-test-video';
import { User } from '../users/entities/user.entity';
import { UsersModule } from '../users/users.module';
import { Video, VideoStatus } from '../videos/entities/video.entity';
import { generatePublicId } from '../videos/public-id.util';
import { VideosModule } from '../videos/videos.module';
import { FfmpegService } from './ffmpeg/ffmpeg.service';
import { VideoProcessingService } from './video-processing.service';

const execFileAsync = promisify(execFile);

/**
 * Exercises VideoProcessingService directly (no queue): the container
 * video-worker never sees these videos because nothing is enqueued.
 */
describe('VideoProcessingService (integration)', () => {
  let moduleRef: TestingModule;
  let service: VideoProcessingService;
  let storage: StorageService;
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let channel: Channel;
  let validVideo: GeneratedFile;
  let notVideo: GeneratedFile;
  const createdKeys: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      // UsersModule registers User, required by the Channel#user relation.
      imports: [CoreModule, UsersModule, VideosModule, StorageModule],
      providers: [FfmpegService, VideoProcessingService],
    }).compile();

    service = moduleRef.get(VideoProcessingService);
    storage = moduleRef.get(StorageService);
    dataSource = moduleRef.get(DataSource);
    videoRepository = dataSource.getRepository(Video);

    validVideo = await generateTestVideo({
      durationSeconds: 4,
      width: 320,
      height: 240,
    });
    notVideo = await generateRandomBytesFile();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    const user = await dataSource.getRepository(User).save({
      email: 'video_processing_svc@example.com',
      password: 'hashed',
    });
    channel = await dataSource.getRepository(Channel).save({
      name: 'proc',
      nickname: 'video_processing_svc',
      user_id: user.id,
    });
  });

  afterEach(async () => {
    for (const key of createdKeys.splice(0)) {
      await storage.deleteObject(key);
    }
  });

  afterAll(async () => {
    await rm(validVideo.path, { force: true });
    await rm(notVideo.path, { force: true });
    await cleanAllTables(dataSource);
    await moduleRef.close();
  });

  /** Inserts a row in `status` and uploads `file` as its source object. */
  async function seedVideo(
    status: VideoStatus,
    file: GeneratedFile,
  ): Promise<Video> {
    const video = await videoRepository.save(
      videoRepository.create({
        public_id: generatePublicId(),
        channel_id: channel.id,
        title: 'clip.mp4',
        original_filename: 'clip.mp4',
        mime_type: 'video/mp4',
        status,
        upload_id: 'completed-upload',
        declared_size: file.size,
        part_size: 5 * 1024 * 1024,
      }),
    );
    createdKeys.push(videoSourceKey(video.id), videoThumbnailKey(video.id));
    await storage.putObject(
      videoSourceKey(video.id),
      await readFile(file.path),
      'video/mp4',
    );
    return video;
  }

  async function probeStoredThumbnail(videoId: string) {
    const url = await storage.presignGetInternal(
      videoThumbnailKey(videoId),
      600,
    );
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_streams',
      url,
    ]);
    return (
      JSON.parse(stdout) as {
        streams: { codec_name: string; width: number; height: number }[];
      }
    ).streams[0];
  }

  it('should move a processing video to ready with duration, metadata and a 640 px JPEG thumbnail', async () => {
    const video = await seedVideo(VideoStatus.PROCESSING, validVideo);

    await service.process(video.id);

    const row = await videoRepository.findOneByOrFail({ id: video.id });
    expect(row.status).toBe(VideoStatus.READY);
    expect(row.duration_seconds).toBeGreaterThanOrEqual(3.9);
    expect(row.duration_seconds).toBeLessThanOrEqual(4.1);
    const metadata = row.metadata!;
    expect(Object.keys(metadata).sort()).toEqual(
      [
        'bitrate',
        'container_format',
        'height',
        'size',
        'video_codec',
        'width',
      ].sort(),
    );
    expect(metadata.width).toBe(320);
    expect(metadata.height).toBe(240);
    expect(metadata.video_codec).toBe('h264');
    expect(metadata.container_format).toContain('mp4');
    expect(metadata.bitrate).toBeGreaterThan(0);
    expect(metadata.size).toBe(validVideo.size);

    const head = await storage.headObject(videoThumbnailKey(video.id));
    expect(head.contentType).toBe('image/jpeg');
    const thumbnail = await probeStoredThumbnail(video.id);
    expect(thumbnail.codec_name).toBe('mjpeg');
    expect(thumbnail.width).toBe(640);
    expect(thumbnail.height % 2).toBe(0);
  });

  it('should throw UnrecoverableError for random bytes, keeping the row and the source object', async () => {
    const video = await seedVideo(VideoStatus.PROCESSING, notVideo);

    await expect(service.process(video.id)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );

    const row = await videoRepository.findOneByOrFail({ id: video.id });
    expect(row.status).toBe(VideoStatus.PROCESSING);
    await expect(
      storage.headObject(videoSourceKey(video.id)),
    ).resolves.toMatchObject({ contentLength: notVideo.size });
    await expect(
      storage.headObject(videoThumbnailKey(video.id)),
    ).rejects.toBeInstanceOf(StorageObjectNotFoundError);
  });

  it('should leave a ready video untouched when its job runs again', async () => {
    const video = await seedVideo(VideoStatus.READY, validVideo);
    const before = await videoRepository.findOneByOrFail({ id: video.id });

    await service.process(video.id);

    const after = await videoRepository.findOneByOrFail({ id: video.id });
    expect(after).toEqual(before);
    await expect(
      storage.headObject(videoThumbnailKey(video.id)),
    ).rejects.toBeInstanceOf(StorageObjectNotFoundError);
  });
});
