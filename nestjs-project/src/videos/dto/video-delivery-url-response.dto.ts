import { ApiProperty } from '@nestjs/swagger';

/** Short-lived presigned GET URL of the video source (stream and download). */
export class VideoDeliveryUrlResponseDto {
  @ApiProperty({
    description:
      'Presigned GetObject URL of the video source, served by the storage itself (supports Range / 206 Partial Content)',
    example: 'http://localhost:9000/streamtube/videos/.../source?X-Amz-...',
  })
  url: string;

  @ApiProperty({ example: 3600, description: 'URL validity in seconds' })
  expires_in: number;
}
