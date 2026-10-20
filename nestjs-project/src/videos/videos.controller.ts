import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import {
  CompleteVideoUploadDto,
  CompleteVideoUploadResponseDto,
} from './dto/complete-video-upload.dto';
import { CreateVideoUploadDto } from './dto/create-video-upload.dto';
import {
  CreateVideoUploadResponseDto,
  ResignVideoUploadResponseDto,
} from './dto/video-upload-response.dto';
import { VideosService } from './videos.service';

const PUBLIC_ID_PARAM = {
  name: 'publicId',
  description: 'Public video id (11 characters)',
  example: 'Xb3k_9QmZ1a',
};

const ERROR_ENVELOPE = { $ref: getSchemaPath(ApiErrorEnvelope) };

@SkipThrottle()
@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Start a video upload',
    description:
      "Pre-registers the video as a draft in the authenticated user's channel, opens the multipart upload in storage and returns one presigned UploadPart URL per part, so the file goes straight from the client to storage.",
  })
  @ApiResponse({
    status: 201,
    description: 'Draft created and multipart upload started',
    type: CreateVideoUploadResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Validation failed (invalid body or size above the configured maximum)',
    schema: ERROR_ENVELOPE,
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: ERROR_ENVELOPE,
  })
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateVideoUploadDto,
  ): Promise<CreateVideoUploadResponseDto> {
    return this.videosService.initUpload(user.sub, dto);
  }

  @Get(':publicId/upload')
  @ApiBearerAuth('access-token')
  @ApiParam(PUBLIC_ID_PARAM)
  @ApiOperation({
    summary: 'Resume a video upload',
    description:
      'Returns the parts already uploaded (with their ETags) and fresh presigned UploadPart URLs only for the missing parts of a draft owned by the caller. Changes neither the video nor the processing queue.',
  })
  @ApiResponse({
    status: 200,
    description: 'Uploaded parts and URLs for the missing parts',
    type: ResignVideoUploadResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: ERROR_ENVELOPE,
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found or owned by another channel',
    schema: ERROR_ENVELOPE,
  })
  @ApiResponse({
    status: 409,
    description:
      'Video is not a draft or the multipart upload no longer exists',
    schema: ERROR_ENVELOPE,
  })
  async resignUpload(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ): Promise<ResignVideoUploadResponseDto> {
    return this.videosService.resignUpload(user.sub, publicId);
  }

  @Post(':publicId/upload/complete')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBearerAuth('access-token')
  @ApiParam(PUBLIC_ID_PARAM)
  @ApiBody({ type: CompleteVideoUploadDto })
  @ApiOperation({
    summary: 'Complete a video upload',
    description:
      'Completes the multipart upload with the uploaded parts and their ETags, verifies the assembled object against the declared size and starts background processing. Repeating it on a processing video is idempotent (same job).',
  })
  @ApiResponse({
    status: 202,
    description: 'Upload verified; processing started',
    type: CompleteVideoUploadResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed',
    schema: ERROR_ENVELOPE,
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: ERROR_ENVELOPE,
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found or owned by another channel',
    schema: ERROR_ENVELOPE,
  })
  @ApiResponse({
    status: 409,
    description:
      'Video is ready/failed, or the multipart upload no longer exists and no object was assembled',
    schema: ERROR_ENVELOPE,
  })
  @ApiResponse({
    status: 422,
    description:
      'INVALID_UPLOAD_PARTS (parts list rejected, upload stays open) or UPLOAD_VERIFICATION_FAILED (assembled size differs from the declared size; object discarded)',
    schema: ERROR_ENVELOPE,
  })
  async completeUpload(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Body() dto: CompleteVideoUploadDto,
  ): Promise<CompleteVideoUploadResponseDto> {
    return this.videosService.completeUpload(user.sub, publicId, dto);
  }

  @Delete(':publicId/upload')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiParam(PUBLIC_ID_PARAM)
  @ApiOperation({
    summary: 'Abort a video upload',
    description:
      'Abandons the upload of a draft owned by the caller: aborts the multipart upload and discards any assembled source object. The video stays a draft; repeating the call returns the same response.',
  })
  @ApiResponse({ status: 204, description: 'Upload aborted' })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: ERROR_ENVELOPE,
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found or owned by another channel',
    schema: ERROR_ENVELOPE,
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not a draft',
    schema: ERROR_ENVELOPE,
  })
  async abortUpload(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ): Promise<void> {
    await this.videosService.abortUpload(user.sub, publicId);
  }
}
