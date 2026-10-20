import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface GeneratedFile {
  path: string;
  size: number;
}

export interface TestVideoOptions {
  durationSeconds?: number;
  width?: number;
  height?: number;
  /** Minimum file size; ≥ 6 MiB forces 2 parts of 5 MiB in upload tests. */
  minSizeBytes?: number;
}

/** ISO BMFF `free` box header size (32-bit size + 4-char type). */
const FREE_BOX_HEADER_BYTES = 8;

const runFfmpeg = (args: string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    const stderr: Buffer[] = [];
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `ffmpeg exited with ${code}: ${Buffer.concat(stderr).toString()}`,
          ),
        );
    });
  });

/**
 * Generates a real H.264 MP4 (lavfi testsrc) in os.tmpdir(). When the encoded
 * file is smaller than `minSizeBytes`, a trailing top-level `free` box pads it
 * to the exact size — still a valid MP4 that ffprobe/ffmpeg read normally.
 */
export async function generateTestVideo(
  options: TestVideoOptions = {},
): Promise<GeneratedFile> {
  const {
    durationSeconds = 3,
    width = 320,
    height = 240,
    minSizeBytes = 0,
  } = options;
  const path = join(tmpdir(), `test-video-${randomUUID()}.mp4`);

  await runFfmpeg([
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `testsrc=duration=${durationSeconds}:size=${width}x${height}:rate=25`,
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    path,
  ]);

  const encodedSize = (await stat(path)).size;
  const padding = minSizeBytes - encodedSize;
  if (padding > 0) {
    const boxSize = Math.max(padding, FREE_BOX_HEADER_BYTES);
    const box = Buffer.alloc(boxSize);
    box.writeUInt32BE(boxSize, 0);
    box.write('free', 4, 'ascii');
    await appendFile(path, box);
  }

  return { path, size: (await stat(path)).size };
}

/** Random bytes with a video extension: the "not decodable" input. */
export async function generateRandomBytesFile(
  sizeBytes = 64 * 1024,
): Promise<GeneratedFile> {
  const path = join(tmpdir(), `not-a-video-${randomUUID()}.mp4`);
  await writeFile(path, randomBytes(sizeBytes));
  return { path, size: sizeBytes };
}
