import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import {
  VIDEO_PROCESSING_ATTEMPTS,
  VIDEO_PROCESSING_BACKOFF_MS,
  VIDEO_PROCESSING_QUEUE,
} from './video-processing.constants';
import { VideoProcessingProducer } from './video-processing.producer';

/** Producer side of the video-processing queue: no @Processor is registered here. */
@Module({
  imports: [
    BullModule.registerQueue({
      name: VIDEO_PROCESSING_QUEUE,
      defaultJobOptions: {
        attempts: VIDEO_PROCESSING_ATTEMPTS,
        backoff: { type: 'exponential', delay: VIDEO_PROCESSING_BACKOFF_MS },
      },
    }),
  ],
  providers: [VideoProcessingProducer],
  exports: [BullModule, VideoProcessingProducer],
})
export class VideoQueueModule {}
