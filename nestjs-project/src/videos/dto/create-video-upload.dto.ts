import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import {
  ACCEPTED_VIDEO_MIME_TYPES,
  type AcceptedVideoMimeType,
} from '../videos.constants';

export class CreateVideoUploadDto {
  /** Original file name; also the default title. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  filename: string;

  /** MIME type of the video file. */
  @IsIn(ACCEPTED_VIDEO_MIME_TYPES)
  mime_type: AcceptedVideoMimeType;

  /** File size in bytes; must not exceed UPLOAD_MAX_SIZE_BYTES (default 10737418240). */
  @IsInt()
  @Min(1)
  size: number;

  /** Video title; defaults to the file name. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;
}
