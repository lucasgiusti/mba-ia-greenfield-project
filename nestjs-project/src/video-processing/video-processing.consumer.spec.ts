import { Test } from '@nestjs/testing';
import { type Job, UnrecoverableError } from 'bullmq';
import { VideosService } from '../videos/videos.service';
import type { VideoProcessingJobData } from './video-processing.constants';
import { VideoProcessingConsumer } from './video-processing.consumer';
import { VideoProcessingService } from './video-processing.service';

const VIDEO_ID = '6f1c2a34-5b6d-4e7f-8a9b-0c1d2e3f4a5b';

const buildJob = (attemptsMade: number, attempts = 3) =>
  ({
    data: { videoId: VIDEO_ID },
    attemptsMade,
    opts: { attempts },
  }) as unknown as Job<VideoProcessingJobData>;

describe('VideoProcessingConsumer', () => {
  let consumer: VideoProcessingConsumer;
  let processing: { process: jest.Mock };
  let videos: { markFailed: jest.Mock };

  beforeEach(async () => {
    processing = { process: jest.fn().mockResolvedValue(undefined) };
    videos = { markFailed: jest.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        VideoProcessingConsumer,
        { provide: VideoProcessingService, useValue: processing },
        { provide: VideosService, useValue: videos },
      ],
    })
      .setLogger({
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
        verbose: jest.fn(),
      })
      .compile();
    consumer = moduleRef.get(VideoProcessingConsumer);
  });

  it('should delegate the job to VideoProcessingService with the video UUID', async () => {
    await consumer.process(buildJob(0));

    expect(processing.process).toHaveBeenCalledWith(VIDEO_ID);
  });

  it('should mark the video failed on an UnrecoverableError, even on the first attempt', async () => {
    await consumer.onFailed(buildJob(1), new UnrecoverableError('bad media'));

    expect(videos.markFailed).toHaveBeenCalledWith(VIDEO_ID);
  });

  it('should mark the video failed when the last attempt fails', async () => {
    await consumer.onFailed(buildJob(3), new Error('storage timeout'));

    expect(videos.markFailed).toHaveBeenCalledWith(VIDEO_ID);
  });

  it.each([1, 2])(
    'should not mark the video failed after intermediate attempt %i of 3',
    async (attemptsMade) => {
      await consumer.onFailed(buildJob(attemptsMade), new Error('timeout'));

      expect(videos.markFailed).not.toHaveBeenCalled();
    },
  );

  it('should log and not re-throw when marking the video failed errors', async () => {
    videos.markFailed.mockRejectedValue(new Error('db down'));

    await expect(
      consumer.onFailed(buildJob(3), new Error('timeout')),
    ).resolves.toBeUndefined();
  });

  it('should ignore a failed event without a job', async () => {
    await consumer.onFailed(undefined, new Error('lost'));

    expect(videos.markFailed).not.toHaveBeenCalled();
  });
});
