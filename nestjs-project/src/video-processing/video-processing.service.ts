import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { StorageService } from '../storage/storage.service';
import { videoSourceKey, videoThumbnailKey } from '../storage/storage.keys';
import { DELIVERY_URL_TTL_SECONDS } from '../videos/videos.constants';
import { VideosService } from '../videos/videos.service';
import { MediaNotDecodableError } from './ffmpeg/ffmpeg.errors';
import { FfmpegService, type ProbeResult } from './ffmpeg/ffmpeg.service';

/** Thumbnail frame position, as a fraction of the duration. */
const THUMBNAIL_POSITION = 0.1;

@Injectable()
export class VideoProcessingService {
  constructor(
    private readonly videosService: VideosService,
    private readonly storageService: StorageService,
    private readonly ffmpeg: FfmpegService,
  ) {}

  /**
   * Extracts duration/metadata and the thumbnail, then moves the video to
   * `ready`. Idempotent: a video that is no longer `processing` is skipped.
   * Media ffprobe cannot decode raises UnrecoverableError (no retry); any
   * other error propagates so BullMQ retries the job.
   */
  async process(videoId: string): Promise<void> {
    const video = await this.videosService.findProcessingById(videoId);
    if (!video) {
      return;
    }

    // Signed for STORAGE_ENDPOINT: FFmpeg reads only the ranges it needs.
    const sourceUrl = await this.storageService.presignGetInternal(
      videoSourceKey(video.id),
      DELIVERY_URL_TTL_SECONDS,
    );

    let probe: ProbeResult;
    try {
      probe = await this.ffmpeg.probe(sourceUrl);
    } catch (err) {
      if (err instanceof MediaNotDecodableError) {
        throw new UnrecoverableError(err.message);
      }
      throw err;
    }

    const thumbnailPath = join(
      tmpdir(),
      `thumbnail-${video.id}-${randomUUID()}.jpg`,
    );
    try {
      await this.ffmpeg.extractFrame(
        sourceUrl,
        probe.durationSeconds * THUMBNAIL_POSITION,
        thumbnailPath,
      );
      await this.storageService.putObject(
        videoThumbnailKey(video.id),
        await readFile(thumbnailPath),
        'image/jpeg',
      );
    } finally {
      await rm(thumbnailPath, { force: true });
    }

    await this.videosService.markReady(video.id, {
      duration_seconds: probe.durationSeconds,
      metadata: {
        width: probe.width,
        height: probe.height,
        video_codec: probe.video_codec,
        container_format: probe.container_format,
        bitrate: probe.bitrate,
        size: probe.size,
      },
    });
  }
}
