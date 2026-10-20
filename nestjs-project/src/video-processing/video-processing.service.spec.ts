import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { Test } from '@nestjs/testing';
import { UnrecoverableError } from 'bullmq';
import { StorageService } from '../storage/storage.service';
import { videoSourceKey, videoThumbnailKey } from '../storage/storage.keys';
import { Video, VideoStatus } from '../videos/entities/video.entity';
import { DELIVERY_URL_TTL_SECONDS } from '../videos/videos.constants';
import { VideosService } from '../videos/videos.service';
import {
  FfmpegExecutionError,
  MediaNotDecodableError,
} from './ffmpeg/ffmpeg.errors';
import { FfmpegService, type ProbeResult } from './ffmpeg/ffmpeg.service';
import { VideoProcessingService } from './video-processing.service';

const VIDEO_ID = '6f1c2a34-5b6d-4e7f-8a9b-0c1d2e3f4a5b';
const SOURCE_URL = 'http://minio:9000/streamtube/videos/source?sig';
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01]);

const PROBE: ProbeResult = {
  durationSeconds: 20,
  width: 1280,
  height: 720,
  video_codec: 'h264',
  container_format: 'mov,mp4,m4a,3gp,3g2,mj2',
  bitrate: 800000,
  size: 2000000,
};

const processingVideo = (): Video =>
  ({ id: VIDEO_ID, status: VideoStatus.PROCESSING }) as Video;

describe('VideoProcessingService', () => {
  let service: VideoProcessingService;
  let videos: {
    findProcessingById: jest.Mock;
    markReady: jest.Mock;
  };
  let storage: { presignGetInternal: jest.Mock; putObject: jest.Mock };
  let ffmpeg: { probe: jest.Mock; extractFrame: jest.Mock };
  /** Path handed to extractFrame, captured to check its removal. */
  let framePath: string | undefined;

  beforeEach(async () => {
    framePath = undefined;
    videos = {
      findProcessingById: jest.fn().mockResolvedValue(processingVideo()),
      markReady: jest.fn().mockResolvedValue(undefined),
    };
    storage = {
      presignGetInternal: jest.fn().mockResolvedValue(SOURCE_URL),
      putObject: jest.fn().mockResolvedValue(undefined),
    };
    ffmpeg = {
      probe: jest.fn().mockResolvedValue(PROBE),
      extractFrame: jest.fn(async (_in: string, _at: number, out: string) => {
        framePath = out;
        await writeFile(out, JPEG_BYTES);
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        VideoProcessingService,
        { provide: VideosService, useValue: videos },
        { provide: StorageService, useValue: storage },
        { provide: FfmpegService, useValue: ffmpeg },
      ],
    }).compile();
    service = moduleRef.get(VideoProcessingService);
  });

  it('should do nothing when the video is missing or no longer processing (job re-run)', async () => {
    videos.findProcessingById.mockResolvedValue(null);

    await service.process(VIDEO_ID);

    expect(videos.findProcessingById).toHaveBeenCalledWith(VIDEO_ID);
    expect(storage.presignGetInternal).not.toHaveBeenCalled();
    expect(ffmpeg.probe).not.toHaveBeenCalled();
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(videos.markReady).not.toHaveBeenCalled();
  });

  it('should probe the internal presigned URL, store the thumbnail taken at 10% of the duration and mark ready', async () => {
    await service.process(VIDEO_ID);

    expect(storage.presignGetInternal).toHaveBeenCalledWith(
      videoSourceKey(VIDEO_ID),
      DELIVERY_URL_TTL_SECONDS,
    );
    expect(ffmpeg.probe).toHaveBeenCalledWith(SOURCE_URL);
    expect(ffmpeg.extractFrame).toHaveBeenCalledWith(
      SOURCE_URL,
      2,
      expect.stringMatching(/\.jpg$/),
    );
    expect(storage.putObject).toHaveBeenCalledWith(
      videoThumbnailKey(VIDEO_ID),
      JPEG_BYTES,
      'image/jpeg',
    );
    expect(videos.markReady).toHaveBeenCalledWith(VIDEO_ID, {
      duration_seconds: 20,
      metadata: {
        width: 1280,
        height: 720,
        video_codec: 'h264',
        container_format: 'mov,mp4,m4a,3gp,3g2,mj2',
        bitrate: 800000,
        size: 2000000,
      },
    });
  });

  it('should remove the temporary frame file after a successful run', async () => {
    await service.process(VIDEO_ID);

    expect(framePath).toBeDefined();
    expect(existsSync(framePath!)).toBe(false);
  });

  it('should throw UnrecoverableError without storing anything when ffprobe cannot decode the media', async () => {
    ffmpeg.probe.mockRejectedValue(new MediaNotDecodableError('bad media'));

    await expect(service.process(VIDEO_ID)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );

    expect(ffmpeg.extractFrame).not.toHaveBeenCalled();
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(videos.markReady).not.toHaveBeenCalled();
  });

  it('should re-throw a transient probe error unchanged (retryable)', async () => {
    const error = new FfmpegExecutionError('HTTP read failed');
    ffmpeg.probe.mockRejectedValue(error);

    await expect(service.process(VIDEO_ID)).rejects.toBe(error);
    expect(videos.markReady).not.toHaveBeenCalled();
  });

  it('should remove the temporary frame file and not mark ready when the thumbnail upload fails', async () => {
    const error = new Error('storage down');
    storage.putObject.mockRejectedValue(error);

    await expect(service.process(VIDEO_ID)).rejects.toBe(error);

    expect(framePath).toBeDefined();
    expect(existsSync(framePath!)).toBe(false);
    expect(videos.markReady).not.toHaveBeenCalled();
  });
});
