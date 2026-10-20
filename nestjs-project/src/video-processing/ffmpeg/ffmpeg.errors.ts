/** ffprobe could not decode the input, or it has no video stream. Not retryable. */
export class MediaNotDecodableError extends Error {
  constructor(
    message: string,
    readonly stderr = '',
  ) {
    super(message);
    this.name = 'MediaNotDecodableError';
  }
}

/** ffmpeg/ffprobe could not be spawned or exited with an error (e.g. HTTP read). */
export class FfmpegExecutionError extends Error {
  constructor(
    message: string,
    readonly stderr = '',
  ) {
    super(stderr ? `${message}: ${stderr}` : message);
    this.name = 'FfmpegExecutionError';
  }
}
