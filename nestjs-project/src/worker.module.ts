import { Module } from '@nestjs/common';
import { CoreModule } from './core/core.module';
import { UsersModule } from './users/users.module';
import { VideoProcessingModule } from './video-processing/video-processing.module';

/**
 * Root module of the video worker (no HTTP server, no AuthModule): shared
 * infrastructure + the video-processing queue consumer. UsersModule only
 * registers the User entity required by the Channel#user relation.
 */
@Module({
  imports: [CoreModule, UsersModule, VideoProcessingModule],
})
export class WorkerModule {}
