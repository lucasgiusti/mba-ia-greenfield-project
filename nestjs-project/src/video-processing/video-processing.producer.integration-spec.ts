import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { DiscoveryModule, DiscoveryService } from '@nestjs/core';
import { WorkerHost, getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { CoreModule } from '../core/core.module';
import { useTestQueuePrefix } from '../test/test-queue-prefix';
import {
  VIDEO_PROCESSING_JOB,
  VIDEO_PROCESSING_QUEUE,
  type VideoProcessingJobData,
} from './video-processing.constants';
import { VideoProcessingProducer } from './video-processing.producer';
import { VideoQueueModule } from './video-queue.module';

describe('VideoProcessingProducer (integration)', () => {
  let moduleRef: TestingModule;
  let producer: VideoProcessingProducer;
  let queue: Queue<VideoProcessingJobData>;

  beforeAll(async () => {
    moduleRef = await useTestQueuePrefix(
      Test.createTestingModule({
        imports: [CoreModule, DiscoveryModule, VideoQueueModule],
      }),
    ).compile();
    await moduleRef.init();
    producer = moduleRef.get(VideoProcessingProducer);
    queue = moduleRef.get(getQueueToken(VIDEO_PROCESSING_QUEUE));
    await queue.waitUntilReady();
  });

  beforeEach(async () => {
    await queue.obliterate({ force: true });
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await moduleRef.close();
  });

  it('should create a process job with jobId = video UUID, payload { videoId } and 3 attempts', async () => {
    const videoId = randomUUID();

    await producer.enqueue(videoId);

    const job = await queue.getJob(videoId);
    expect(job).toBeDefined();
    expect(job?.id).toBe(videoId);
    expect(job?.name).toBe(VIDEO_PROCESSING_JOB);
    expect(job?.data).toEqual({ videoId });
    expect(job?.opts.attempts).toBe(3);
    expect(job?.opts.backoff).toEqual({ type: 'exponential', delay: 1000 });
  });

  it('should not create a second job when the same video is enqueued again while the job exists', async () => {
    const videoId = randomUUID();

    await producer.enqueue(videoId);
    await producer.enqueue(videoId);

    const jobs = await queue.getJobs(['waiting', 'delayed', 'active']);
    expect(jobs.map((j) => j.id)).toEqual([videoId]);
  });

  it('should register the queue without any consumer (no WorkerHost provider) in the API process', () => {
    const consumers = moduleRef
      .get(DiscoveryService)
      .getProviders()
      .filter((wrapper) => wrapper.instance instanceof WorkerHost);

    expect(consumers).toHaveLength(0);
  });
});
