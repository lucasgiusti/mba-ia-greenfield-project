export const ACCEPTED_VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
] as const;

export type AcceptedVideoMimeType = (typeof ACCEPTED_VIDEO_MIME_TYPES)[number];

/** TTL of the presigned stream/download URLs. */
export const DELIVERY_URL_TTL_SECONDS = 3600;

/** Attempts to generate a non-colliding public_id at init. */
export const PUBLIC_ID_MAX_ATTEMPTS = 5;
