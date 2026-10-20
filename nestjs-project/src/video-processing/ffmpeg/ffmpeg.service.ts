import { spawn } from 'node:child_process';
import { Injectable } from '@nestjs/common';
import { FfmpegExecutionError, MediaNotDecodableError } from './ffmpeg.errors';

export interface ProbeResult {
  durationSeconds: number;
  width: number | null;
  height: number | null;
  video_codec: string | null;
  container_format: string | null;
  bitrate: number | null;
  size: number | null;
}

interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface FfprobeOutput {
  format?: {
    duration?: string;
    format_name?: string;
    bit_rate?: string;
    size?: string;
  };
  streams?: {
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
  }[];
}

/** Max delay (s) FFmpeg waits between HTTP reconnect attempts (FFmpeg 5.1 option). */
const HTTP_RECONNECT_DELAY_MAX_SECONDS = 5;

const toNumberOrNull = (value: string | undefined): number | null => {
  if (value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * ffprobe stderr when it read the bytes but could not demux them. Any other
 * failure on an HTTP input is a transport error (FfmpegExecutionError).
 */
const DEMUX_FAILURE_PATTERN =
  /Invalid data found when processing input|moov atom not found/i;

const isHttpInput = (input: string): boolean => /^https?:\/\//i.test(input);

/**
 * Typed wrapper over the two FFmpeg invocations of the worker. Always spawns
 * with an argument array (no shell), so inputs are never shell-interpreted.
 */
@Injectable()
export class FfmpegService {
  async probe(input: string): Promise<ProbeResult> {
    const result = await this.run('ffprobe', [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      input,
    ]);
    if (result.code !== 0) {
      if (isHttpInput(input) && !DEMUX_FAILURE_PATTERN.test(result.stderr)) {
        // The bytes were never read (403, DNS, refused, reset): transient.
        throw new FfmpegExecutionError(
          `ffprobe could not read the input over HTTP (exit code ${result.code})`,
          result.stderr,
        );
      }
      throw new MediaNotDecodableError(
        `ffprobe could not decode the input (exit code ${result.code})`,
        result.stderr,
      );
    }

    let output: FfprobeOutput;
    try {
      output = JSON.parse(result.stdout) as FfprobeOutput;
    } catch {
      throw new MediaNotDecodableError(
        'ffprobe returned an unreadable output',
        result.stderr,
      );
    }

    const video = output.streams?.find((s) => s.codec_type === 'video');
    const durationSeconds = toNumberOrNull(output.format?.duration);
    if (!video || durationSeconds === null) {
      throw new MediaNotDecodableError(
        'Input has no decodable video stream',
        result.stderr,
      );
    }

    return {
      durationSeconds,
      width: video.width ?? null,
      height: video.height ?? null,
      video_codec: video.codec_name ?? null,
      container_format: output.format?.format_name ?? null,
      bitrate: toNumberOrNull(output.format?.bit_rate),
      size: toNumberOrNull(output.format?.size),
    };
  }

  /** Writes one JPEG frame at `atSeconds`, scaled to 640 px wide (even height). */
  async extractFrame(
    input: string,
    atSeconds: number,
    outputPath: string,
  ): Promise<void> {
    const httpOptions = isHttpInput(input)
      ? [
          '-reconnect',
          '1',
          '-reconnect_on_network_error',
          '1',
          '-reconnect_delay_max',
          String(HTTP_RECONNECT_DELAY_MAX_SECONDS),
        ]
      : [];
    const result = await this.run('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-ss',
      String(atSeconds),
      ...httpOptions,
      '-i',
      input,
      '-frames:v',
      '1',
      '-vf',
      'scale=640:-2',
      '-f',
      'image2',
      outputPath,
    ]);
    if (result.code !== 0) {
      throw new FfmpegExecutionError(
        `ffmpeg frame extraction failed (exit code ${result.code})`,
        result.stderr,
      );
    }
  }

  private run(command: string, args: string[]): Promise<SpawnResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
      child.on('error', (err) => {
        reject(
          new FfmpegExecutionError(
            `Failed to spawn ${command}: ${err.message}`,
            Buffer.concat(stderr).toString(),
          ),
        );
      });
      child.on('close', (code) => {
        resolve({
          code,
          stdout: Buffer.concat(stdout).toString(),
          stderr: Buffer.concat(stderr).toString().trim(),
        });
      });
    });
  }
}
