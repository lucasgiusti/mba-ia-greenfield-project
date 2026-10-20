import { getSharedConfigToken } from '@nestjs/bullmq';
import type { ConfigType } from '@nestjs/config';
import type { TestingModuleBuilder } from '@nestjs/testing';
import queueConfig from '../config/queue.config';

/**
 * BullMQ key prefix used by test processes. The `video-worker` container
 * consumes the default prefix (`bull`) of the same Redis, so jobs enqueued by
 * tests under this prefix are never picked up by it — test assertions on the
 * queue and on `processing` rows stay deterministic.
 */
export const TEST_QUEUE_PREFIX = 'bull-test';

/** Overrides the root BullMQ config of CoreModule with the test prefix. */
export function useTestQueuePrefix(
  builder: TestingModuleBuilder,
): TestingModuleBuilder {
  return builder.overrideProvider(getSharedConfigToken()).useFactory({
    factory: (cfg: ConfigType<typeof queueConfig>) => ({
      connection: { host: cfg.host, port: cfg.port },
      prefix: TEST_QUEUE_PREFIX,
    }),
    inject: [queueConfig.KEY],
  });
}
