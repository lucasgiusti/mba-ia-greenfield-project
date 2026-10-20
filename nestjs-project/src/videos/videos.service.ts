import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
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
import { StorageService, type UploadedPart } from '../storage/storage.service';
import { videoSourceKey } from '../storage/storage.keys';
import { VideoProcessingProducer } from '../video-processing/video-processing.producer';
import type {
  CompleteVideoUploadDto,
  CompleteVideoUploadResponseDto,
} from './dto/complete-video-upload.dto';
import type { CreateVideoUploadDto } from './dto/create-video-upload.dto';
import type {
  CreateVideoUploadResponseDto,
  ResignVideoUploadResponseDto,
  VideoUploadPartUrlDto,
} from './dto/video-upload-response.dto';
import { Video, VideoStatus } from './entities/video.entity';
import { generatePublicId } from './public-id.util';
import { PUBLIC_ID_MAX_ATTEMPTS } from './videos.constants';

const PG_UNIQUE_VIOLATION = '23505';
const PUBLIC_ID_COLUMN = 'public_id';

function isPublicIdCollision(err: unknown): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const e = err as QueryFailedError & { code?: unknown; detail?: unknown };
  return (
    e.code === PG_UNIQUE_VIOLATION &&
    typeof e.detail === 'string' &&
    e.detail.includes(PUBLIC_ID_COLUMN)
  );
}

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly channelsService: ChannelsService,
    private readonly storageService: StorageService,
    private readonly producer: VideoProcessingProducer,
    @Inject(uploadConfig.KEY)
    private readonly upload: ConfigType<typeof uploadConfig>,
  ) {}

  /** Pre-registers the draft and opens the multipart upload (client uploads straight to storage). */
  async initUpload(
    userId: string,
    dto: CreateVideoUploadDto,
  ): Promise<CreateVideoUploadResponseDto> {
    if (dto.size > this.upload.maxSizeBytes) {
      throw new UploadSizeExceededException(this.upload.maxSizeBytes);
    }

    const channel = await this.channelsService.findByUserId(userId);
    if (!channel) {
      throw new Error(`Channel not found for user ${userId}`);
    }

    const video = await this.saveDraftWithUniquePublicId({
      channel_id: channel.id,
      status: VideoStatus.DRAFT,
      title: dto.title ?? dto.filename,
      original_filename: dto.filename,
      mime_type: dto.mime_type,
      declared_size: dto.size,
      part_size: this.upload.partSizeBytes,
    });

    const key = videoSourceKey(video.id);
    const uploadId = await this.storageService.createMultipartUpload(
      key,
      dto.mime_type,
    );
    await this.videoRepository.update(video.id, { upload_id: uploadId });

    const partCount = this.partCountOf(video);
    const partNumbers = Array.from({ length: partCount }, (_, i) => i + 1);

    return {
      public_id: video.public_id,
      status: VideoStatus.DRAFT,
      part_size: video.part_size,
      part_count: partCount,
      parts: await this.presignParts(key, uploadId, partNumbers),
      expires_in: this.upload.partUrlTtlSeconds,
    };
  }

  /**
   * Resolves public_id → row and enforces ownership before any state check:
   * unknown and non-owned videos are indistinguishable (404).
   */
  async findOwnedByPublicId(userId: string, publicId: string): Promise<Video> {
    const video = await this.videoRepository.findOne({
      where: { public_id: publicId },
    });
    if (!video) {
      throw new VideoNotFoundException();
    }
    const channel = await this.channelsService.findByUserId(userId);
    if (!channel || channel.id !== video.channel_id) {
      throw new VideoNotFoundException();
    }
    return video;
  }

  /** Resume: uploaded parts + fresh URLs for the missing ones; changes neither the row nor the queue. */
  async resignUpload(
    userId: string,
    publicId: string,
  ): Promise<ResignVideoUploadResponseDto> {
    const video = await this.findOwnedByPublicId(userId, publicId);
    if (video.status !== VideoStatus.DRAFT || !video.upload_id) {
      throw new InvalidVideoStateException();
    }

    const key = videoSourceKey(video.id);
    let uploaded: UploadedPart[];
    try {
      uploaded = await this.storageService.listParts(key, video.upload_id);
    } catch (err) {
      if (err instanceof StorageUploadNotFoundError) {
        throw new InvalidVideoStateException();
      }
      throw err;
    }

    // Persisted init parameters, never the current config (open upload).
    const partCount = this.partCountOf(video);
    const uploadedNumbers = new Set(uploaded.map((p) => p.partNumber));
    const missing = Array.from({ length: partCount }, (_, i) => i + 1).filter(
      (n) => !uploadedNumbers.has(n),
    );

    return {
      public_id: video.public_id,
      part_size: video.part_size,
      part_count: partCount,
      uploaded_parts: uploaded.map((p) => ({
        part_number: p.partNumber,
        etag: p.etag,
      })),
      parts: await this.presignParts(key, video.upload_id, missing),
      expires_in: this.upload.partUrlTtlSeconds,
    };
  }

  /**
   * Completes the multipart upload, verifies the assembled object and starts
   * processing. Idempotent: a `processing` video is re-enqueued with the same
   * jobId (recovers a lost enqueue) and retry-safe after a partial failure.
   */
  async completeUpload(
    userId: string,
    publicId: string,
    dto: CompleteVideoUploadDto,
  ): Promise<CompleteVideoUploadResponseDto> {
    const video = await this.findOwnedByPublicId(userId, publicId);

    if (video.status === VideoStatus.PROCESSING) {
      await this.producer.enqueue(video.id);
      return { public_id: video.public_id, status: VideoStatus.PROCESSING };
    }
    if (video.status !== VideoStatus.DRAFT || !video.upload_id) {
      throw new InvalidVideoStateException();
    }
    if (!this.isCompletePartsList(dto, this.partCountOf(video))) {
      throw new InvalidUploadPartsException();
    }

    const key = videoSourceKey(video.id);
    try {
      await this.storageService.completeMultipartUpload(
        key,
        video.upload_id,
        dto.parts.map((p) => ({ partNumber: p.part_number, etag: p.etag })),
      );
    } catch (err) {
      if (err instanceof StorageInvalidPartsError) {
        throw new InvalidUploadPartsException();
      }
      // NoSuchUpload: an earlier call may already have assembled the object;
      // HeadObject below decides (retry-safe on a draft row).
      if (!(err instanceof StorageUploadNotFoundError)) {
        throw err;
      }
    }

    let contentLength: number;
    try {
      ({ contentLength } = await this.storageService.headObject(key));
    } catch (err) {
      if (err instanceof StorageObjectNotFoundError) {
        throw new InvalidVideoStateException();
      }
      throw err;
    }
    if (contentLength !== video.declared_size) {
      await this.storageService.deleteObject(key);
      throw new UploadVerificationFailedException();
    }

    await this.videoRepository.update(video.id, {
      status: VideoStatus.PROCESSING,
    });
    await this.producer.enqueue(video.id);
    return { public_id: video.public_id, status: VideoStatus.PROCESSING };
  }

  /**
   * Abandons a draft upload: aborts the multipart upload and discards any
   * already assembled source object. Idempotent; the row stays `draft`.
   */
  async abortUpload(userId: string, publicId: string): Promise<void> {
    const video = await this.findOwnedByPublicId(userId, publicId);
    if (video.status !== VideoStatus.DRAFT) {
      throw new InvalidVideoStateException();
    }

    const key = videoSourceKey(video.id);
    if (video.upload_id) {
      try {
        await this.storageService.abortMultipartUpload(key, video.upload_id);
      } catch (err) {
        // Already aborted, completed or expired: same success response.
        if (!(err instanceof StorageUploadNotFoundError)) {
          throw err;
        }
      }
    }
    // DeleteObject succeeds on a missing key, so a repeated abort stays idempotent.
    await this.storageService.deleteObject(key);
  }

  /** Part numbers must be exactly 1..partCount, each listed once. */
  private isCompletePartsList(
    dto: CompleteVideoUploadDto,
    partCount: number,
  ): boolean {
    const numbers = new Set(dto.parts.map((p) => p.part_number));
    if (numbers.size !== dto.parts.length || numbers.size !== partCount) {
      return false;
    }
    for (let n = 1; n <= partCount; n++) {
      if (!numbers.has(n)) return false;
    }
    return true;
  }

  private partCountOf(video: Video): number {
    return Math.ceil(video.declared_size / video.part_size);
  }

  private async saveDraftWithUniquePublicId(
    fields: Partial<Video>,
  ): Promise<Video> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.videoRepository.save(
          this.videoRepository.create({
            ...fields,
            public_id: generatePublicId(),
          }),
        );
      } catch (err) {
        if (!isPublicIdCollision(err) || attempt >= PUBLIC_ID_MAX_ATTEMPTS) {
          throw err;
        }
      }
    }
  }

  private async presignParts(
    key: string,
    uploadId: string,
    partNumbers: number[],
  ): Promise<VideoUploadPartUrlDto[]> {
    return Promise.all(
      partNumbers.map(async (partNumber) => ({
        part_number: partNumber,
        url: await this.storageService.presignUploadPart(
          key,
          uploadId,
          partNumber,
          this.upload.partUrlTtlSeconds,
        ),
      })),
    );
  }
}
