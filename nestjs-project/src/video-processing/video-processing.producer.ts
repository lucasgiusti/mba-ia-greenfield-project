import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  VIDEO_PROCESSING_JOB,
  VIDEO_PROCESSING_QUEUE,
  type VideoProcessingJobData,
} from './video-processing.constants';

@Injectable()
export class VideoProcessingProducer {
  constructor(
    @InjectQueue(VIDEO_PROCESSING_QUEUE)
    private readonly queue: Queue<VideoProcessingJobData>,
  ) {}

  /**
   * jobId = video UUID: BullMQ ignores an add whose jobId is still stored, so
   * a repeated enqueue for the same video never duplicates a live job.
   */
  async enqueue(videoId: string): Promise<void> {
    await this.queue.add(VIDEO_PROCESSING_JOB, { videoId }, { jobId: videoId });
  }
}
