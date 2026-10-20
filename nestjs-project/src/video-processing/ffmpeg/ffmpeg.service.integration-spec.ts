import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import storageConfig from '../../config/storage.config';
import { StorageModule } from '../../storage/storage.module';
import { StorageService } from '../../storage/storage.service';
import { videoSourceKey } from '../../storage/storage.keys';
import {
  generateRandomBytesFile,
  generateTestVideo,
  type GeneratedFile,
} from '../../test/generate-test-video';
import { FfmpegExecutionError, MediaNotDecodableError } from './ffmpeg.errors';
import { FfmpegService } from './ffmpeg.service';

const execFileAsync = promisify(execFile);

/** Reads the first stream's dimensions/codec of an image with the real ffprobe. */
async function probeImage(
  path: string,
): Promise<{ width: number; height: number; codec_name: string }> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_streams',
    path,
  ]);
  const parsed = JSON.parse(stdout) as {
    streams: { width: number; height: number; codec_name: string }[];
  };
  return parsed.streams[0];
}

describe('FfmpegService (integration)', () => {
  const ffmpeg = new FfmpegService();
  const tmpFiles: string[] = [];
  let video: GeneratedFile;

  beforeAll(async () => {
    video = await generateTestVideo({
      durationSeconds: 3,
      width: 320,
      height: 240,
    });
    tmpFiles.push(video.path);
  });

  afterAll(async () => {
    for (const file of tmpFiles) {
      await rm(file, { force: true });
    }
  });

  describe('probe', () => {
    it('should return duration, dimensions, codec, container, bitrate and size of a generated MP4', async () => {
      const result = await ffmpeg.probe(video.path);

      expect(result.durationSeconds).toBeGreaterThanOrEqual(2.9);
      expect(result.durationSeconds).toBeLessThanOrEqual(3.1);
      expect(result.width).toBe(320);
      expect(result.height).toBe(240);
      expect(result.video_codec).toBe('h264');
      expect(result.container_format).toEqual(expect.stringContaining('mp4'));
      expect(result.bitrate).toBeGreaterThan(0);
      expect(result.size).toBe(video.size);
    });

    it('should reject a file that is not a video with MediaNotDecodableError', async () => {
      const notVideo = await generateRandomBytesFile();
      tmpFiles.push(notVideo.path);

      await expect(ffmpeg.probe(notVideo.path)).rejects.toBeInstanceOf(
        MediaNotDecodableError,
      );
    });

    it('should reject a missing input with MediaNotDecodableError', async () => {
      await expect(
        ffmpeg.probe(join(tmpdir(), `missing-${randomUUID()}.mp4`)),
      ).rejects.toBeInstanceOf(MediaNotDecodableError);
    });
  });

  describe('extractFrame', () => {
    it('should write a JPEG 640 px wide with an even height', async () => {
      const out = join(tmpdir(), `frame-${randomUUID()}.jpg`);
      tmpFiles.push(out);

      await ffmpeg.extractFrame(video.path, 0.3, out);

      const bytes = await readFile(out);
      expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
      const image = await probeImage(out);
      expect(image.codec_name).toBe('mjpeg');
      expect(image.width).toBe(640);
      expect(image.height % 2).toBe(0);
    });
  });

  describe('over HTTP (presigned internal URL)', () => {
    let moduleRef: TestingModule;
    let storage: StorageService;
    const key = videoSourceKey(randomUUID());

    beforeAll(async () => {
      moduleRef = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
          StorageModule,
        ],
      }).compile();
      storage = moduleRef.get(StorageService);
      await storage.putObject(key, await readFile(video.path), 'video/mp4');
    });

    afterAll(async () => {
      await storage.deleteObject(key);
      await moduleRef.close();
    });

    it('should probe the object through a URL signed for STORAGE_ENDPOINT', async () => {
      const url = await storage.presignGetInternal(key, 600);
      expect(new URL(url).origin).toBe(
        new URL(process.env.STORAGE_ENDPOINT!).origin,
      );

      const result = await ffmpeg.probe(url);

      expect(result.durationSeconds).toBeGreaterThanOrEqual(2.9);
      expect(result.width).toBe(320);
      expect(result.height).toBe(240);
      expect(result.size).toBe(video.size);
    });

    it('should reject a non-video object read over HTTP with MediaNotDecodableError', async () => {
      const notVideo = await generateRandomBytesFile();
      tmpFiles.push(notVideo.path);
      const badKey = videoSourceKey(randomUUID());
      await storage.putObject(
        badKey,
        await readFile(notVideo.path),
        'video/mp4',
      );
      try {
        const url = await storage.presignGetInternal(badKey, 600);
        await expect(ffmpeg.probe(url)).rejects.toBeInstanceOf(
          MediaNotDecodableError,
        );
      } finally {
        await storage.deleteObject(badKey);
      }
    });

    it('should reject an HTTP read failure (403 on a missing object) with FfmpegExecutionError carrying stderr', async () => {
      const url = await storage.presignGetInternal(
        videoSourceKey(randomUUID()),
        600,
      );

      const error = await ffmpeg.probe(url).catch((err: unknown) => err);

      expect(error).toBeInstanceOf(FfmpegExecutionError);
      expect((error as FfmpegExecutionError).stderr).toMatch(/403|404/);
    });

    it('should extract a frame through the URL with the HTTP reconnect options', async () => {
      const url = await storage.presignGetInternal(key, 600);
      const out = join(tmpdir(), `frame-${randomUUID()}.jpg`);
      tmpFiles.push(out);

      await ffmpeg.extractFrame(url, 0.3, out);

      expect((await probeImage(out)).width).toBe(640);
    });
  });
});
