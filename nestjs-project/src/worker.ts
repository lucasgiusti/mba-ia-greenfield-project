import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { VideoProcessingConsumer } from './video-processing/video-processing.consumer';
import { WorkerModule } from './worker.module';

/** Video worker entrypoint: application context only, no HTTP listener. */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  // SIGTERM/SIGINT → onApplicationShutdown closes the BullMQ worker and queue.
  app.enableShutdownHooks();

  const { worker } = app.get(VideoProcessingConsumer);
  worker.on('closed', () => Logger.log('Video worker closed', 'Worker'));
  await worker.waitUntilReady();
  Logger.log(
    `Video worker connected to Redis, consuming queue "${worker.name}"`,
    'Worker',
  );
}
void bootstrap();
