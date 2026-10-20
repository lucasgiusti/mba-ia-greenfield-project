import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { type Job, UnrecoverableError } from 'bullmq';
import { VideosService } from '../videos/videos.service';
import {
  VIDEO_PROCESSING_QUEUE,
  type VideoProcessingJobData,
} from './video-processing.constants';
import { VideoProcessingService } from './video-processing.service';

@Processor(VIDEO_PROCESSING_QUEUE, { concurrency: 1 })
export class VideoProcessingConsumer extends WorkerHost {
  private readonly logger = new Logger(VideoProcessingConsumer.name);

  constructor(
    private readonly processingService: VideoProcessingService,
    private readonly videosService: VideosService,
  ) {
    super();
  }

  async process(job: Job<VideoProcessingJobData>): Promise<void> {
    await this.processingService.process(job.data.videoId);
  }

  /**
   * Terminal failure (unrecoverable error or last attempt) → `failed`.
   * Background task: errors are logged, never re-thrown.
   */
  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<VideoProcessingJobData> | undefined,
    err: Error,
  ): Promise<void> {
    if (!job) {
      this.logger.error(`Video processing job failed: ${err.message}`);
      return;
    }
    const { videoId } = job.data;
    const isFinal =
      err instanceof UnrecoverableError ||
      err.name === 'UnrecoverableError' ||
      job.attemptsMade >= (job.opts.attempts ?? 1);

    if (!isFinal) {
      this.logger.warn(
        `Video ${videoId}: attempt ${job.attemptsMade}/${job.opts.attempts} failed, will retry: ${err.message}`,
      );
      return;
    }

    try {
      await this.videosService.markFailed(videoId);
      this.logger.error(
        `Video ${videoId} marked as failed after ${job.attemptsMade} attempt(s): ${err.message}`,
        err.stack,
      );
    } catch (markErr) {
      this.logger.error(
        `Video ${videoId}: could not mark as failed (${err.message})`,
        markErr instanceof Error ? markErr.stack : String(markErr),
      );
    }
  }
}
