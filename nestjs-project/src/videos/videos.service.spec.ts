import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import { ChannelsService } from '../channels/channels.service';
import {
  InvalidUploadPartsException,
  InvalidVideoStateException,
  UploadSizeExceededException,
  UploadVerificationFailedException,
  VideoNotFoundException,
} from '../common/exceptions/domain.exception';
import uploadConfig from '../config/upload.config';
import {
  StorageInvalidPartsError,
  StorageObjectNotFoundError,
  StorageUploadNotFoundError,
} from '../storage/storage.errors';
import { StorageService } from '../storage/storage.service';
import { VideoProcessingProducer } from '../video-processing/video-processing.producer';
import { Video, VideoStatus } from './entities/video.entity';
import { PUBLIC_ID_MAX_ATTEMPTS } from './videos.constants';
import { VideosService } from './videos.service';

const USER_ID = 'user-uuid';
const CHANNEL_ID = 'channel-uuid';
const VIDEO_ID = '11111111-1111-4111-8111-111111111111';
const PART_SIZE = 104857600;
const MAX_SIZE = 10737418240;
const TTL = 3600;

const PUBLIC_ID = 'Xb3k_9QmZ1a';
const SOURCE_KEY = `videos/${VIDEO_ID}/source`;

function buildVideo(overrides: Partial<Video> = {}): Video {
  return {
    id: VIDEO_ID,
    public_id: PUBLIC_ID,
    channel_id: CHANNEL_ID,
    title: 'clip.mp4',
    original_filename: 'clip.mp4',
    mime_type: 'video/mp4',
    status: VideoStatus.DRAFT,
    upload_id: 'upload-1',
    declared_size: 3 * 5242880,
    part_size: 5242880,
    duration_seconds: null,
    metadata: null,
    created_at: new Date(),
    updated_at: new Date(),
    channel: undefined as unknown as Video['channel'],
    ...overrides,
  };
}

function publicIdCollision(): QueryFailedError {
  const err = new QueryFailedError('INSERT', [], new Error('duplicate'));
  Object.assign(err, {
    code: '23505',
    detail: 'Key (public_id)=(abc) already exists.',
  });
  return err;
}

describe('VideosService', () => {
  let service: VideosService;
  let videoRepository: {
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    findOne: jest.Mock;
  };
  let channelsService: { findByUserId: jest.Mock };
  let storageService: {
    createMultipartUpload: jest.Mock;
    presignUploadPart: jest.Mock;
    listParts: jest.Mock;
    completeMultipartUpload: jest.Mock;
    abortMultipartUpload: jest.Mock;
    headObject: jest.Mock;
    deleteObject: jest.Mock;
  };
  let producer: { enqueue: jest.Mock };
  let upload: {
    maxSizeBytes: number;
    partSizeBytes: number;
    partUrlTtlSeconds: number;
  };

  beforeEach(async () => {
    videoRepository = {
      create: jest.fn((fields: Partial<Video>) => ({ ...fields })),
      save: jest.fn((video: Partial<Video>) =>
        Promise.resolve({ ...video, id: VIDEO_ID }),
      ),
      update: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn(),
    };
    channelsService = {
      findByUserId: jest
        .fn()
        .mockResolvedValue({ id: CHANNEL_ID, user_id: USER_ID }),
    };
    storageService = {
      createMultipartUpload: jest.fn().mockResolvedValue('upload-1'),
      presignUploadPart: jest.fn(
        (_key: string, _uploadId: string, partNumber: number) =>
          Promise.resolve(`http://public/part/${partNumber}`),
      ),
      listParts: jest.fn(),
      completeMultipartUpload: jest.fn(),
      abortMultipartUpload: jest.fn(),
      headObject: jest.fn(),
      deleteObject: jest.fn(),
    };
    producer = { enqueue: jest.fn().mockResolvedValue(undefined) };
    upload = {
      maxSizeBytes: MAX_SIZE,
      partSizeBytes: PART_SIZE,
      partUrlTtlSeconds: TTL,
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        VideosService,
        { provide: getRepositoryToken(Video), useValue: videoRepository },
        { provide: ChannelsService, useValue: channelsService },
        { provide: StorageService, useValue: storageService },
        { provide: VideoProcessingProducer, useValue: producer },
        { provide: uploadConfig.KEY, useValue: upload },
      ],
    }).compile();

    service = moduleRef.get(VideosService);
  });

  describe('initUpload', () => {
    const dto = { filename: 'clip.mp4', mime_type: 'video/mp4' as const };

    it('should reject a size above the configured maximum without touching repo or storage', async () => {
      await expect(
        service.initUpload(USER_ID, { ...dto, size: MAX_SIZE + 1 }),
      ).rejects.toBeInstanceOf(UploadSizeExceededException);

      expect(channelsService.findByUserId).not.toHaveBeenCalled();
      expect(videoRepository.save).not.toHaveBeenCalled();
      expect(storageService.createMultipartUpload).not.toHaveBeenCalled();
    });

    it('should default the title to the filename and persist the upload parameters', async () => {
      await service.initUpload(USER_ID, { ...dto, size: 1024 });

      expect(videoRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          channel_id: CHANNEL_ID,
          status: VideoStatus.DRAFT,
          title: 'clip.mp4',
          original_filename: 'clip.mp4',
          mime_type: 'video/mp4',
          declared_size: 1024,
          part_size: PART_SIZE,
        }),
      );
      expect(storageService.createMultipartUpload).toHaveBeenCalledWith(
        `videos/${VIDEO_ID}/source`,
        'video/mp4',
      );
      expect(videoRepository.update).toHaveBeenCalledWith(VIDEO_ID, {
        upload_id: 'upload-1',
      });
    });

    it('should use the given title when present', async () => {
      await service.initUpload(USER_ID, {
        ...dto,
        size: 1024,
        title: 'My trip',
      });

      expect(videoRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'My trip' }),
      );
    });

    it('should return ceil(size / part_size) part URLs numbered from 1 without exposing the UUID', async () => {
      const result = await service.initUpload(USER_ID, {
        ...dto,
        size: MAX_SIZE,
      });

      expect(result.part_count).toBe(103);
      expect(result.parts).toHaveLength(103);
      expect(result.parts[0]).toEqual({
        part_number: 1,
        url: 'http://public/part/1',
      });
      expect(result.parts[102].part_number).toBe(103);
      expect(result.expires_in).toBe(TTL);
      expect(result.status).toBe(VideoStatus.DRAFT);
      expect(storageService.presignUploadPart).toHaveBeenCalledWith(
        `videos/${VIDEO_ID}/source`,
        'upload-1',
        103,
        TTL,
      );
      expect(JSON.stringify(result)).not.toContain(VIDEO_ID);
    });

    it('should regenerate the public_id on a 23505 collision and succeed', async () => {
      videoRepository.save
        .mockRejectedValueOnce(publicIdCollision())
        .mockImplementationOnce((video: Partial<Video>) =>
          Promise.resolve({ ...video, id: VIDEO_ID }),
        );

      const result = await service.initUpload(USER_ID, { ...dto, size: 1 });

      expect(videoRepository.save).toHaveBeenCalledTimes(2);
      const first = (videoRepository.save.mock.calls[0] as [Video])[0];
      const second = (videoRepository.save.mock.calls[1] as [Video])[0];
      expect(first.public_id).not.toBe(second.public_id);
      expect(result.public_id).toBe(second.public_id);
    });

    it('should fail after PUBLIC_ID_MAX_ATTEMPTS collisions', async () => {
      videoRepository.save.mockRejectedValue(publicIdCollision());

      await expect(
        service.initUpload(USER_ID, { ...dto, size: 1 }),
      ).rejects.toBeInstanceOf(QueryFailedError);

      expect(videoRepository.save).toHaveBeenCalledTimes(
        PUBLIC_ID_MAX_ATTEMPTS,
      );
      expect(storageService.createMultipartUpload).not.toHaveBeenCalled();
    });
  });

  describe('findOwnedByPublicId', () => {
    it('should throw VideoNotFoundException when the public_id does not exist', async () => {
      videoRepository.findOne.mockResolvedValue(null);

      await expect(
        service.findOwnedByPublicId(USER_ID, PUBLIC_ID),
      ).rejects.toBeInstanceOf(VideoNotFoundException);
    });

    it('should return the video owned by the caller channel', async () => {
      const video = buildVideo();
      videoRepository.findOne.mockResolvedValue(video);

      await expect(
        service.findOwnedByPublicId(USER_ID, PUBLIC_ID),
      ).resolves.toBe(video);
      expect(videoRepository.findOne).toHaveBeenCalledWith({
        where: { public_id: PUBLIC_ID },
      });
    });
  });

  describe('resignUpload', () => {
    it('should throw VideoNotFoundException for a non-owner even when the video is ready', async () => {
      videoRepository.findOne.mockResolvedValue(
        buildVideo({ status: VideoStatus.READY, channel_id: 'other-channel' }),
      );

      await expect(
        service.resignUpload(USER_ID, PUBLIC_ID),
      ).rejects.toBeInstanceOf(VideoNotFoundException);
      expect(storageService.listParts).not.toHaveBeenCalled();
    });

    it.each([VideoStatus.PROCESSING, VideoStatus.READY, VideoStatus.FAILED])(
      'should throw InvalidVideoStateException for a %s video',
      async (status) => {
        videoRepository.findOne.mockResolvedValue(buildVideo({ status }));

        await expect(
          service.resignUpload(USER_ID, PUBLIC_ID),
        ).rejects.toBeInstanceOf(InvalidVideoStateException);
        expect(storageService.listParts).not.toHaveBeenCalled();
      },
    );

    it('should compute the missing parts from the persisted declared_size/part_size, not the current config', async () => {
      upload.partSizeBytes = 999; // config changed after init
      videoRepository.findOne.mockResolvedValue(buildVideo());
      storageService.listParts.mockResolvedValue([
        { partNumber: 2, etag: '"etag-2"' },
      ]);

      const result = await service.resignUpload(USER_ID, PUBLIC_ID);

      expect(storageService.listParts).toHaveBeenCalledWith(
        SOURCE_KEY,
        'upload-1',
      );
      expect(result).toEqual({
        public_id: PUBLIC_ID,
        part_size: 5242880,
        part_count: 3,
        uploaded_parts: [{ part_number: 2, etag: '"etag-2"' }],
        parts: [
          { part_number: 1, url: 'http://public/part/1' },
          { part_number: 3, url: 'http://public/part/3' },
        ],
        expires_in: TTL,
      });
      expect(videoRepository.update).not.toHaveBeenCalled();
      expect(producer.enqueue).not.toHaveBeenCalled();
    });

    it('should map StorageUploadNotFoundError to InvalidVideoStateException', async () => {
      videoRepository.findOne.mockResolvedValue(buildVideo());
      storageService.listParts.mockRejectedValue(
        new StorageUploadNotFoundError(SOURCE_KEY),
      );

      await expect(
        service.resignUpload(USER_ID, PUBLIC_ID),
      ).rejects.toBeInstanceOf(InvalidVideoStateException);
    });
  });

  describe('completeUpload', () => {
    const allParts = {
      parts: [
        { part_number: 1, etag: '"e1"' },
        { part_number: 2, etag: '"e2"' },
        { part_number: 3, etag: '"e3"' },
      ],
    };

    it('should re-enqueue a processing video without calling storage', async () => {
      videoRepository.findOne.mockResolvedValue(
        buildVideo({ status: VideoStatus.PROCESSING }),
      );

      const result = await service.completeUpload(USER_ID, PUBLIC_ID, allParts);

      expect(result).toEqual({
        public_id: PUBLIC_ID,
        status: VideoStatus.PROCESSING,
      });
      expect(producer.enqueue).toHaveBeenCalledWith(VIDEO_ID);
      expect(storageService.completeMultipartUpload).not.toHaveBeenCalled();
      expect(storageService.headObject).not.toHaveBeenCalled();
      expect(videoRepository.update).not.toHaveBeenCalled();
    });

    it.each([VideoStatus.READY, VideoStatus.FAILED])(
      'should throw InvalidVideoStateException for a %s video without side effects',
      async (status) => {
        videoRepository.findOne.mockResolvedValue(buildVideo({ status }));

        await expect(
          service.completeUpload(USER_ID, PUBLIC_ID, allParts),
        ).rejects.toBeInstanceOf(InvalidVideoStateException);
        expect(storageService.completeMultipartUpload).not.toHaveBeenCalled();
        expect(producer.enqueue).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['incomplete', [1, 2]],
      ['duplicated', [1, 2, 2]],
      ['duplicated with the full count', [1, 1, 3]],
      ['out of range', [1, 2, 4]],
    ])(
      'should throw InvalidUploadPartsException for an %s parts list without calling storage',
      async (_label, numbers) => {
        videoRepository.findOne.mockResolvedValue(buildVideo());

        await expect(
          service.completeUpload(USER_ID, PUBLIC_ID, {
            parts: numbers.map((n) => ({ part_number: n, etag: `"e${n}"` })),
          }),
        ).rejects.toBeInstanceOf(InvalidUploadPartsException);
        expect(storageService.completeMultipartUpload).not.toHaveBeenCalled();
      },
    );

    it('should map StorageInvalidPartsError to InvalidUploadPartsException without deleting anything', async () => {
      videoRepository.findOne.mockResolvedValue(buildVideo());
      storageService.completeMultipartUpload.mockRejectedValue(
        new StorageInvalidPartsError(SOURCE_KEY, 'InvalidPart'),
      );

      await expect(
        service.completeUpload(USER_ID, PUBLIC_ID, allParts),
      ).rejects.toBeInstanceOf(InvalidUploadPartsException);
      expect(storageService.deleteObject).not.toHaveBeenCalled();
      expect(storageService.headObject).not.toHaveBeenCalled();
      expect(producer.enqueue).not.toHaveBeenCalled();
    });

    it('should continue with the verification on NoSuchUpload when the object exists', async () => {
      const video = buildVideo();
      videoRepository.findOne.mockResolvedValue(video);
      storageService.completeMultipartUpload.mockRejectedValue(
        new StorageUploadNotFoundError(SOURCE_KEY),
      );
      storageService.headObject.mockResolvedValue({
        contentLength: video.declared_size,
        contentType: 'video/mp4',
      });

      const result = await service.completeUpload(USER_ID, PUBLIC_ID, allParts);

      expect(result.status).toBe(VideoStatus.PROCESSING);
      expect(storageService.headObject).toHaveBeenCalledWith(SOURCE_KEY);
      expect(producer.enqueue).toHaveBeenCalledWith(VIDEO_ID);
    });

    it('should throw InvalidVideoStateException on NoSuchUpload when the object is missing', async () => {
      videoRepository.findOne.mockResolvedValue(buildVideo());
      storageService.completeMultipartUpload.mockRejectedValue(
        new StorageUploadNotFoundError(SOURCE_KEY),
      );
      storageService.headObject.mockRejectedValue(
        new StorageObjectNotFoundError(SOURCE_KEY),
      );

      await expect(
        service.completeUpload(USER_ID, PUBLIC_ID, allParts),
      ).rejects.toBeInstanceOf(InvalidVideoStateException);
      expect(videoRepository.update).not.toHaveBeenCalled();
      expect(producer.enqueue).not.toHaveBeenCalled();
    });

    it('should delete the object and throw UploadVerificationFailedException when the size differs, keeping the row draft', async () => {
      const video = buildVideo();
      videoRepository.findOne.mockResolvedValue(video);
      storageService.headObject.mockResolvedValue({
        contentLength: video.declared_size - 1,
        contentType: 'video/mp4',
      });

      await expect(
        service.completeUpload(USER_ID, PUBLIC_ID, allParts),
      ).rejects.toBeInstanceOf(UploadVerificationFailedException);
      expect(storageService.deleteObject).toHaveBeenCalledWith(SOURCE_KEY);
      expect(videoRepository.update).not.toHaveBeenCalled();
      expect(producer.enqueue).not.toHaveBeenCalled();
    });

    it('should move the row to processing before enqueuing with the video UUID', async () => {
      const video = buildVideo();
      videoRepository.findOne.mockResolvedValue(video);
      storageService.headObject.mockResolvedValue({
        contentLength: video.declared_size,
        contentType: 'video/mp4',
      });
      const calls: string[] = [];
      videoRepository.update.mockImplementation(() => {
        calls.push('update');
        return Promise.resolve(undefined);
      });
      producer.enqueue.mockImplementation(() => {
        calls.push('enqueue');
        return Promise.resolve();
      });

      const result = await service.completeUpload(USER_ID, PUBLIC_ID, allParts);

      expect(storageService.completeMultipartUpload).toHaveBeenCalledWith(
        SOURCE_KEY,
        'upload-1',
        [
          { partNumber: 1, etag: '"e1"' },
          { partNumber: 2, etag: '"e2"' },
          { partNumber: 3, etag: '"e3"' },
        ],
      );
      expect(videoRepository.update).toHaveBeenCalledWith(VIDEO_ID, {
        status: VideoStatus.PROCESSING,
      });
      expect(producer.enqueue).toHaveBeenCalledWith(VIDEO_ID);
      expect(calls).toEqual(['update', 'enqueue']);
      expect(result).toEqual({
        public_id: PUBLIC_ID,
        status: VideoStatus.PROCESSING,
      });
    });
  });

  describe('abortUpload', () => {
    it.each([VideoStatus.PROCESSING, VideoStatus.READY, VideoStatus.FAILED])(
      'should throw InvalidVideoStateException for a %s video without calling storage',
      async (status) => {
        videoRepository.findOne.mockResolvedValue(buildVideo({ status }));

        await expect(
          service.abortUpload(USER_ID, PUBLIC_ID),
        ).rejects.toBeInstanceOf(InvalidVideoStateException);
        expect(storageService.abortMultipartUpload).not.toHaveBeenCalled();
        expect(storageService.deleteObject).not.toHaveBeenCalled();
      },
    );

    it('should throw VideoNotFoundException for a non-owner without calling storage', async () => {
      videoRepository.findOne.mockResolvedValue(
        buildVideo({ channel_id: 'other-channel' }),
      );

      await expect(
        service.abortUpload(USER_ID, PUBLIC_ID),
      ).rejects.toBeInstanceOf(VideoNotFoundException);
      expect(storageService.abortMultipartUpload).not.toHaveBeenCalled();
    });

    it('should abort the multipart upload and delete the source object', async () => {
      videoRepository.findOne.mockResolvedValue(buildVideo());
      storageService.abortMultipartUpload.mockResolvedValue(undefined);
      storageService.deleteObject.mockResolvedValue(undefined);

      await service.abortUpload(USER_ID, PUBLIC_ID);

      expect(storageService.abortMultipartUpload).toHaveBeenCalledWith(
        SOURCE_KEY,
        'upload-1',
      );
      expect(storageService.deleteObject).toHaveBeenCalledWith(SOURCE_KEY);
      expect(videoRepository.update).not.toHaveBeenCalled();
    });

    it('should ignore StorageUploadNotFoundError and still delete the source object', async () => {
      videoRepository.findOne.mockResolvedValue(buildVideo());
      storageService.abortMultipartUpload.mockRejectedValue(
        new StorageUploadNotFoundError(SOURCE_KEY),
      );
      storageService.deleteObject.mockResolvedValue(undefined);

      await expect(
        service.abortUpload(USER_ID, PUBLIC_ID),
      ).resolves.toBeUndefined();
      expect(storageService.deleteObject).toHaveBeenCalledWith(SOURCE_KEY);
    });

    it('should propagate other storage errors', async () => {
      videoRepository.findOne.mockResolvedValue(buildVideo());
      const failure = new Error('storage unavailable');
      storageService.abortMultipartUpload.mockRejectedValue(failure);

      await expect(service.abortUpload(USER_ID, PUBLIC_ID)).rejects.toBe(
        failure,
      );
      expect(storageService.deleteObject).not.toHaveBeenCalled();
    });
  });
});
