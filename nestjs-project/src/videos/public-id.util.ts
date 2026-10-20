import { randomBytes } from 'node:crypto';

const PUBLIC_ID_BYTES = 8;

/** Unguessable 11-character URL-safe id ([A-Za-z0-9_-]) for the video URL. */
export function generatePublicId(): string {
  return randomBytes(PUBLIC_ID_BYTES).toString('base64url');
}
