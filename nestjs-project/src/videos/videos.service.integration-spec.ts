import { Test, type TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import uploadConfig from '../config/upload.config';
import { CoreModule } from '../core/core.module';
import { UsersModule } from '../users/users.module';
import { StorageService } from '../storage/storage.service';
import { videoSourceKey } from '../storage/storage.keys';
import {
  InvalidUploadPartsException,
  InvalidVideoStateException,
  UploadVerificationFailedException,
} from '../common/exceptions/domain.exception';
import {
  StorageObjectNotFoundError,
  StorageUploadNotFoundError,
} from '../storage/storage.errors';
import { cleanAllTables } from '../test/create-test-data-source';
import { putToPresignedUrl } from '../test/presigned-put';
import { User } from '../users/entities/user.entity';
import { VIDEO_PROCESSING_QUEUE } from '../video-processing/video-processing.constants';
import { Video, VideoStatus } from './entities/video.entity';
import { VideosModule } from './videos.module';
import { VideosService } from './videos.service';

/** S3 minimum part size, so a real 2-part upload stays small. */
const PART_SIZE = 5 * 1024 * 1024;
const TEST_UPLOAD_CONFIG = {
  maxSizeBytes: 10737418240,
  partSizeBytes: PART_SIZE,
  partUrlTtlSeconds: 600,
};

describe('VideosService (integration)', () => {
  let moduleRef: TestingModule;
  let service: VideosService;
  let storage: StorageService;
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let queue: Queue;
  const openUploads: { key: string; uploadId: string }[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      // UsersModule registers User, required by the Channel#user relation.
      imports: [CoreModule, UsersModule, VideosModule],
    })
      .overrideProvider(uploadConfig.KEY)
      .useValue(TEST_UPLOAD_CONFIG)
      .compile();
    await moduleRef.init();

    service = moduleRef.get(VideosService);
    storage = moduleRef.get(StorageService);
    dataSource = moduleRef.get(DataSource);
    videoRepository = dataSource.getRepository(Video);
    queue = moduleRef.get(getQueueToken(VIDEO_PROCESSING_QUEUE));
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    await queue.obliterate({ force: true });
  });

  afterEach(async () => {
    for (const { key, uploadId } of openUploads.splice(0)) {
      await storage.abortMultipartUpload(key, uploadId).catch(() => undefined);
      await storage.deleteObject(key);
    }
  });

  afterAll(async () => {
    await queue?.obliterate({ force: true });
    await moduleRef?.close();
  });

  let counter = 0;
  async function createUserWithChannel(): Promise<{
    user: User;
    channel: Channel;
  }> {
    const n = ++counter;
    const user = await dataSource.getRepository(User).save({
      email: `videos_svc_${n}@example.com`,
      password: 'hashed',
    });
    const channel = await dataSource.getRepository(Channel).save({
      name: `chan${n}`,
      nickname: `videos_svc_chan_${n}`,
      user_id: user.id,
    });
    return { user, channel };
  }

  async function initDraft(userId: string, size: number) {
    const result = await service.initUpload(userId, {
      filename: 'clip.mp4',
      mime_type: 'video/mp4',
      size,
    });
    const video = await videoRepository.findOneByOrFail({
      public_id: result.public_id,
    });
    openUploads.push({
      key: videoSourceKey(video.id),
      uploadId: video.upload_id!,
    });
    return { result, video };
  }

  /** PUTs `size` random bytes to the presigned URL of the given part. */
  async function uploadPart(
    parts: { part_number: number; url: string }[],
    partNumber: number,
    size: number,
  ): Promise<string> {
    const part = parts.find((p) => p.part_number === partNumber)!;
    const { status, etag } = await putToPresignedUrl(
      part.url,
      Buffer.alloc(size, partNumber),
    );
    expect(status).toBe(200);
    return etag!;
  }

  describe('initUpload', () => {
    it('should persist a draft row and open an empty multipart upload in MinIO', async () => {
      const { user, channel } = await createUserWithChannel();

      const { result, video } = await initDraft(user.id, PART_SIZE + 1);

      expect(video.status).toBe(VideoStatus.DRAFT);
      expect(video.channel_id).toBe(channel.id);
      expect(video.title).toBe('clip.mp4');
      expect(video.declared_size).toBe(PART_SIZE + 1);
      expect(video.part_size).toBe(PART_SIZE);
      expect(video.upload_id).toEqual(expect.any(String));
      expect(result.part_count).toBe(2);
      await expect(
        storage.listParts(videoSourceKey(video.id), video.upload_id!),
      ).resolves.toEqual([]);
    });

    it('should return part URLs signed for the STORAGE_PUBLIC_ENDPOINT host', async () => {
      const { user } = await createUserWithChannel();

      const { result } = await initDraft(user.id, PART_SIZE + 1);

      const publicHost = new URL(process.env.STORAGE_PUBLIC_ENDPOINT!).host;
      expect(result.parts.map((p) => new URL(p.url).host)).toEqual([
        publicHost,
        publicHost,
      ]);
    });
  });

  describe('resignUpload', () => {
    it('should return the uploaded part 1 with its ETag and a URL only for part 2, changing neither row nor queue', async () => {
      const { user } = await createUserWithChannel();
      const { result, video } = await initDraft(user.id, PART_SIZE + 1);
      const etag1 = await uploadPart(result.parts, 1, PART_SIZE);

      const resign = await service.resignUpload(user.id, result.public_id);

      expect(resign.uploaded_parts).toEqual([{ part_number: 1, etag: etag1 }]);
      expect(resign.parts.map((p) => p.part_number)).toEqual([2]);
      expect(resign.part_count).toBe(2);
      const after = await videoRepository.findOneByOrFail({ id: video.id });
      expect(after.status).toBe(VideoStatus.DRAFT);
      expect(after.upload_id).toBe(video.upload_id);
      await expect(queue.getJob(video.id)).resolves.toBeUndefined();
    });

    it('should throw InvalidVideoStateException after the multipart upload was aborted in storage', async () => {
      const { user } = await createUserWithChannel();
      const { result, video } = await initDraft(user.id, PART_SIZE + 1);
      await storage.abortMultipartUpload(
        videoSourceKey(video.id),
        video.upload_id!,
      );

      await expect(
        service.resignUpload(user.id, result.public_id),
      ).rejects.toBeInstanceOf(InvalidVideoStateException);
    });
  });

  describe('completeUpload', () => {
    const DECLARED = PART_SIZE + 1024 * 1024;

    async function uploadedDraft(lastPartSize = DECLARED - PART_SIZE) {
      const { user } = await createUserWithChannel();
      const { result, video } = await initDraft(user.id, DECLARED);
      const etag1 = await uploadPart(result.parts, 1, PART_SIZE);
      const etag2 = await uploadPart(result.parts, 2, lastPartSize);
      return {
        user,
        video,
        publicId: result.public_id,
        parts: [
          { part_number: 1, etag: etag1 },
          { part_number: 2, etag: etag2 },
        ],
      };
    }

    it('should move a real 2-part upload to processing and enqueue a job with jobId = UUID', async () => {
      const { user, video, publicId, parts } = await uploadedDraft();

      const result = await service.completeUpload(user.id, publicId, {
        parts,
      });

      expect(result).toEqual({ public_id: publicId, status: 'processing' });
      const row = await videoRepository.findOneByOrFail({ id: video.id });
      expect(row.status).toBe(VideoStatus.PROCESSING);
      const job = await queue.getJob(video.id);
      expect(job?.data).toEqual({ videoId: video.id });
      await expect(
        storage.headObject(videoSourceKey(video.id)),
      ).resolves.toMatchObject({ contentLength: DECLARED });
    });

    it('should keep a single job when complete is repeated on a processing video', async () => {
      const { user, video, publicId, parts } = await uploadedDraft();

      await service.completeUpload(user.id, publicId, { parts });
      await service.completeUpload(user.id, publicId, { parts });

      const jobs = await queue.getJobs(['waiting', 'delayed', 'active']);
      expect(jobs.map((j) => j.id)).toEqual([video.id]);
    });

    it('should reject a tampered ETag with InvalidUploadPartsException and keep the multipart upload open', async () => {
      const { user, video, publicId, parts } = await uploadedDraft();

      await expect(
        service.completeUpload(user.id, publicId, {
          parts: [parts[0], { part_number: 2, etag: `"${'0'.repeat(32)}"` }],
        }),
      ).rejects.toBeInstanceOf(InvalidUploadPartsException);

      await expect(
        storage.listParts(videoSourceKey(video.id), video.upload_id!),
      ).resolves.toHaveLength(2);
      const row = await videoRepository.findOneByOrFail({ id: video.id });
      expect(row.status).toBe(VideoStatus.DRAFT);
      await expect(queue.getJob(video.id)).resolves.toBeUndefined();
    });

    it('should discard an object smaller than declared and keep the row draft', async () => {
      const { user, video, publicId, parts } = await uploadedDraft(512 * 1024);

      await expect(
        service.completeUpload(user.id, publicId, { parts }),
      ).rejects.toBeInstanceOf(UploadVerificationFailedException);

      await expect(
        storage.headObject(videoSourceKey(video.id)),
      ).rejects.toBeInstanceOf(StorageObjectNotFoundError);
      const row = await videoRepository.findOneByOrFail({ id: video.id });
      expect(row.status).toBe(VideoStatus.DRAFT);
      await expect(queue.getJob(video.id)).resolves.toBeUndefined();
    });

    it('should throw InvalidVideoStateException when complete runs after the upload was aborted', async () => {
      const { user, video, publicId, parts } = await uploadedDraft();
      await storage.abortMultipartUpload(
        videoSourceKey(video.id),
        video.upload_id!,
      );

      await expect(
        service.completeUpload(user.id, publicId, { parts }),
      ).rejects.toBeInstanceOf(InvalidVideoStateException);
      await expect(queue.getJob(video.id)).resolves.toBeUndefined();
    });
  });

  describe('abortUpload', () => {
    it('should make the multipart upload disappear (listParts → StorageUploadNotFoundError) and keep the row draft', async () => {
      const { user } = await createUserWithChannel();
      const { result, video } = await initDraft(user.id, PART_SIZE + 1);
      await uploadPart(result.parts, 1, PART_SIZE);

      await service.abortUpload(user.id, result.public_id);

      await expect(
        storage.listParts(videoSourceKey(video.id), video.upload_id!),
      ).rejects.toBeInstanceOf(StorageUploadNotFoundError);
      const row = await videoRepository.findOneByOrFail({ id: video.id });
      expect(row.status).toBe(VideoStatus.DRAFT);
    });

    it('should not fail when repeated', async () => {
      const { user } = await createUserWithChannel();
      const { result } = await initDraft(user.id, PART_SIZE + 1);

      await service.abortUpload(user.id, result.public_id);

      await expect(
        service.abortUpload(user.id, result.public_id),
      ).resolves.toBeUndefined();
    });

    it('should remove an already assembled source of a draft so a later complete is InvalidVideoStateException', async () => {
      const { user } = await createUserWithChannel();
      const { result, video } = await initDraft(user.id, PART_SIZE + 1);
      const parts = [
        { partNumber: 1, etag: await uploadPart(result.parts, 1, PART_SIZE) },
        { partNumber: 2, etag: await uploadPart(result.parts, 2, 1) },
      ];
      const key = videoSourceKey(video.id);
      await storage.completeMultipartUpload(key, video.upload_id!, parts);
      await expect(storage.headObject(key)).resolves.toMatchObject({
        contentLength: PART_SIZE + 1,
      });

      await service.abortUpload(user.id, result.public_id);

      await expect(storage.headObject(key)).rejects.toBeInstanceOf(
        StorageObjectNotFoundError,
      );
      await expect(
        service.completeUpload(user.id, result.public_id, {
          parts: parts.map((p) => ({
            part_number: p.partNumber,
            etag: p.etag,
          })),
        }),
      ).rejects.toBeInstanceOf(InvalidVideoStateException);
    });
  });
});
