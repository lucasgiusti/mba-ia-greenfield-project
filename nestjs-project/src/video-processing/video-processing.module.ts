import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { VideosModule } from '../videos/videos.module';
import { FfmpegService } from './ffmpeg/ffmpeg.service';
import { VideoProcessingConsumer } from './video-processing.consumer';
import { VideoProcessingService } from './video-processing.service';
import { VideoQueueModule } from './video-queue.module';

/** Consumer side of the video-processing queue: imported only by WorkerModule. */
@Module({
  imports: [VideoQueueModule, StorageModule, VideosModule],
  providers: [FfmpegService, VideoProcessingService, VideoProcessingConsumer],
})
export class VideoProcessingModule {}
