import { Test } from '@nestjs/testing';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { VIDEO_PROCESSING_QUEUE } from './video-processing.constants';
import { VideoProcessingProducer } from './video-processing.producer';
import { VideoQueueModule } from './video-queue.module';

describe('VideoQueueModule', () => {
  it('should compile with a test BullModule.forRoot and expose the queue and the producer', async () => {
    const module = await Test.createTestingModule({
      imports: [
        BullModule.forRoot({
          connection: { host: 'redis', port: 6379, lazyConnect: true },
        }),
        VideoQueueModule,
      ],
    }).compile();

    expect(module.get(getQueueToken(VIDEO_PROCESSING_QUEUE))).toBeInstanceOf(
      Queue,
    );
    expect(module.get(VideoProcessingProducer)).toBeInstanceOf(
      VideoProcessingProducer,
    );
    await module.close();
  });
});
