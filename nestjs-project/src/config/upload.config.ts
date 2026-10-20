import { registerAs } from '@nestjs/config';

export default registerAs('upload', () => ({
  maxSizeBytes: parseInt(
    process.env.UPLOAD_MAX_SIZE_BYTES || '10737418240',
    10,
  ),
  partSizeBytes: parseInt(
    process.env.UPLOAD_PART_SIZE_BYTES || '104857600',
    10,
  ),
  partUrlTtlSeconds: parseInt(
    process.env.UPLOAD_PART_URL_TTL_SECONDS || '3600',
    10,
  ),
}));
