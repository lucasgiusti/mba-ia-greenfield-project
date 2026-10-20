import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { AppModule } from './app.module';
import {
  TEST_QUEUE_PREFIX,
  useTestQueuePrefix,
} from './test/test-queue-prefix';
import {
  VIDEO_PROCESSING_JOB,
  VIDEO_PROCESSING_QUEUE,
} from './video-processing/video-processing.constants';
import { VideoProcessingConsumer } from './video-processing/video-processing.consumer';
import { WorkerModule } from './worker.module';

const JOB_TIMEOUT_MS = 10_000;

describe('WorkerModule (integration)', () => {
  describe('worker application context', () => {
    let context: TestingModule;
    let consumer: VideoProcessingConsumer;
    let queue: Queue;

    beforeAll(async () => {
      // Test prefix: the in-process worker never competes with the
      // video-worker container (default prefix) for real jobs.
      context = await useTestQueuePrefix(
        Test.createTestingModule({ imports: [WorkerModule] }),
      ).compile();
      context.enableShutdownHooks();
      await context.init();
      consumer = context.get(VideoProcessingConsumer);
      queue = context.get(getQueueToken(VIDEO_PROCESSING_QUEUE));
      await queue.obliterate({ force: true });
    });

    afterAll(async () => {
      await context?.close();
    });

    it('should resolve VideoProcessingConsumer with a running BullMQ worker on the video-processing queue', async () => {
      expect(consumer).toBeInstanceOf(VideoProcessingConsumer);
      await consumer.worker.waitUntilReady();
      expect(consumer.worker.name).toBe(VIDEO_PROCESSING_QUEUE);
      expect(consumer.worker.opts.prefix).toBe(TEST_QUEUE_PREFIX);
      expect(consumer.worker.opts.concurrency).toBe(1);
      expect(consumer.worker.isRunning()).toBe(true);
    });

    it('should consume a process job (unknown video → completed without effect)', async () => {
      const videoId = randomUUID();
      const completed = new Promise<Job>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('job not consumed in time')),
          JOB_TIMEOUT_MS,
        );
        consumer.worker.on('completed', (job: Job) => {
          if (job.id === videoId) {
            clearTimeout(timer);
            resolve(job);
          }
        });
      });

      await queue.add(VIDEO_PROCESSING_JOB, { videoId }, { jobId: videoId });

      await expect(completed).resolves.toMatchObject({ id: videoId });
      await expect(queue.getJobState(videoId)).resolves.toBe('completed');
    });

    it('should close the worker and the queue on shutdown', async () => {
      const worker = consumer.worker;
      await queue.obliterate({ force: true });

      await context.close();

      expect(worker.isRunning()).toBe(false);
      expect(worker.closing).toBeDefined();
    });
  });

  describe('API AppModule', () => {
    it('should not contain VideoProcessingConsumer (the API never consumes jobs)', async () => {
      const app = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      try {
        expect(() =>
          app.get(VideoProcessingConsumer, { strict: false }),
        ).toThrow();
      } finally {
        await app.close();
      }
    });
  });
});
