import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { VideoStatus } from '../entities/video.entity';

export class CompletedPartDto {
  /** Multipart part number (1-based). */
  @IsInt()
  @Min(1)
  part_number: number;

  /** ETag returned by the part upload, quotes included. */
  @IsString()
  @IsNotEmpty()
  etag: string;
}

export class CompleteVideoUploadDto {
  /** Every uploaded part, exactly 1..part_count, each once. */
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CompletedPartDto)
  parts: CompletedPartDto[];
}

export class CompleteVideoUploadResponseDto {
  @ApiProperty({ example: 'Xb3k_9QmZ1a', description: 'Public video id' })
  public_id: string;

  @ApiProperty({
    enum: [VideoStatus.PROCESSING],
    example: VideoStatus.PROCESSING,
  })
  status: VideoStatus;
}
