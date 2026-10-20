export const VIDEO_PROCESSING_QUEUE = 'video-processing';
export const VIDEO_PROCESSING_JOB = 'process';
export const VIDEO_PROCESSING_ATTEMPTS = 3;
export const VIDEO_PROCESSING_BACKOFF_MS = 1000;

/** Job payload: the video UUID primary key (never the public_id). */
export type VideoProcessingJobData = { videoId: string };
