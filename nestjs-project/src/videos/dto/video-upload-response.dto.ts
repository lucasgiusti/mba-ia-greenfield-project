import { ApiProperty } from '@nestjs/swagger';
import { VideoStatus } from '../entities/video.entity';

export class VideoUploadPartUrlDto {
  @ApiProperty({ example: 1, description: 'Multipart part number (1-based)' })
  part_number: number;

  @ApiProperty({
    description: 'Presigned UploadPart URL (PUT the part bytes to it)',
    example:
      'http://localhost:9000/streamtube/videos/.../source?partNumber=1&uploadId=...',
  })
  url: string;
}

export class CreateVideoUploadResponseDto {
  @ApiProperty({ example: 'Xb3k_9QmZ1a', description: 'Public video id' })
  public_id: string;

  @ApiProperty({ enum: [VideoStatus.DRAFT], example: VideoStatus.DRAFT })
  status: VideoStatus;

  @ApiProperty({ example: 104857600, description: 'Part size in bytes' })
  part_size: number;

  @ApiProperty({ example: 103, description: 'ceil(size / part_size)' })
  part_count: number;

  @ApiProperty({ type: [VideoUploadPartUrlDto] })
  parts: VideoUploadPartUrlDto[];

  @ApiProperty({ example: 3600, description: 'URL validity in seconds' })
  expires_in: number;
}

export class UploadedPartDto {
  @ApiProperty({ example: 1 })
  part_number: number;

  @ApiProperty({
    example: '"5d41402abc4b2a76b9719d911017c592"',
    description: 'ETag returned by the part upload (quotes included)',
  })
  etag: string;
}

export class ResignVideoUploadResponseDto {
  @ApiProperty({ example: 'Xb3k_9QmZ1a', description: 'Public video id' })
  public_id: string;

  @ApiProperty({
    example: 104857600,
    description: 'Part size persisted at init',
  })
  part_size: number;

  @ApiProperty({ example: 103, description: 'ceil(declared size / part size)' })
  part_count: number;

  @ApiProperty({
    type: [UploadedPartDto],
    description: 'Parts already uploaded',
  })
  uploaded_parts: UploadedPartDto[];

  @ApiProperty({
    type: [VideoUploadPartUrlDto],
    description: 'Fresh presigned URLs for the missing parts only',
  })
  parts: VideoUploadPartUrlDto[];

  @ApiProperty({ example: 3600, description: 'URL validity in seconds' })
  expires_in: number;
}
