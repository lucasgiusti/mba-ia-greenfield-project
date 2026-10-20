# phase-03-videos — Progress

**Status:** completed
**SIs:** 20/20 completed

### SI-03.1 — Tornar o harness de migrations re-executável
- **Status:** completed
- **Tests:** 3 passing (run twice consecutively, both green)
- **Observations:**
  - Added a first test asserting the clean schema (no managed tables, no migrations table, no managed enum types) right after beforeAll, to make the AC observable; suite ran twice consecutively on the same DB, both green.

### SI-03.2 — Infra: Redis, MinIO, bootstrap do bucket, serviço video-worker e FFmpeg na imagem
- **Status:** completed
- **Tests:** no tests (Infra) — AC verified manually
- **Observations:**
  - Digests re-read at implementation (2026-10-20) differ from the 2026-10-19 values in library-refs.md: minio sha256:cff197fef764642223ef9f4444c903d51aee9b544a7be8bc007fef6b7b00d136 (minio --version = RELEASE.2026-09-22T19-25-18Z, same release), minio-client latest-dev sha256:4ded9b0773ebf1afded36c4e91efad0d4e7dee91c6b3d5d29455732095afb2d0.
  - nestjs-api depends_on uses redis: service_healthy and minio-bootstrap: service_completed_successfully (same conditions as video-worker; plan did not specify conditions for nestjs-api).
  - video-worker has no command yet (inherits Dockerfile CMD tail -f /dev/null); the worker entrypoint is wired in SI-03.15.
  - STORAGE_ACCESS_KEY=streamtube / STORAGE_SECRET_KEY=streamtube-secret (MinIO requires >= 8-char root password) added to .env.example and to the local .env.
  - AC verified manually: all services running, minio-bootstrap Exited (0) on first and second run, maxmemory-policy noeviction, ffprobe/ffmpeg 5.1.9-0+deb12u1 in nestjs-api and video-worker, host GET /minio/health/live = 200.

### SI-03.3 — Dependências, namespaces de configuração e validação de env
- **Status:** completed
- **Tests:** 16 passing (env.validation.integration-spec.ts); app.e2e-spec.ts 1 passing
- **Observations:**
  - Installed versions: @nestjs/bullmq 11.0.5, bullmq 6.3.18 (saved as ^6.3.18), ioredis 5.11.1 (major fixed at ^5 — latest stable 5.x; 6.0.0 also satisfies the peer, chose 5 as the long-established line BullMQ documents), @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner 3.1153.0 in lockstep.
  - Joi schema also sets defaults for UPLOAD_* (10737418240 / 104857600 / 3600), REDIS_HOST=redis, REDIS_PORT=6379, STORAGE_REGION=us-east-1, STORAGE_BUCKET=streamtube so the defaults AC is observable from the validated value; the registerAs factories carry the same fallbacks.
  - The three factories are registered in the AppModule ConfigModule.forRoot load for now (action 5); SI-03.4 moves that ConfigModule into CoreModule.
  - Existing requiredEnv fixture of env.validation.integration-spec.ts extended with the new required STORAGE_* keys (otherwise the pre-existing SWAGGER_ENABLED tests would fail on missing required vars).
  - Local .env extended with STORAGE_ENDPOINT/STORAGE_PUBLIC_ENDPOINT/STORAGE_REGION/REDIS_*/UPLOAD_* keys; test/app.e2e-spec.ts GET / still 200. The .env.example MAIL_FROM angle-bracket issue (pre-existing) was left untouched, so the local .env differs from .env.example only in MAIL_FROM.

### SI-03.4 — CoreModule compartilhado (Config + TypeORM + conexão BullMQ)
- **Status:** completed
- **Tests:** 4 passing (core.module.integration-spec.ts); regression: 161 unit/integration + 52 e2e passing
- **Observations:**
  - The integration spec registers a test-only probe queue (BullModule.registerQueue) because BullModule.forRootAsync alone opens no Redis connection; the probe proves the real round-trip to the Compose redis host and is obliterated in afterAll.
  - bullmq 6 no longer exposes queue.client (backend abstraction: getBackend()/waitUntilReady()); the Redis round-trip is asserted with waitUntilReady + add + getJobCounts instead of a raw PING.
  - Regression AC verified: npm test -- --runInBand 24 suites / 161 tests green, npm run test:e2e 3 suites / 52 tests green, tsc --noEmit clean.

### SI-03.5 — StorageModule: clientes S3 interno/público e operações multipart
- **Status:** completed
- **Tests:** 16 passing (integration 11, service unit 4, module unit 1)
- **Observations:**
  - **Plan vs reality:** the Chainguard MinIO build (RELEASE.2026-09-22T19-25-18Z) answers 204 to a repeated AbortMultipartUpload (and even to an unknown upload id) instead of NoSuchUpload, so the planned assertion "abortMultipartUpload repetido gera StorageUploadNotFoundError" is impossible against the Compose MinIO. Smallest fix: the integration test asserts the repeated abort resolves (consistent with TD-04 idempotent abort) and exercises the NoSuchUpload → StorageUploadNotFoundError translation through listParts and completeMultipartUpload on the aborted upload id (both return NoSuchUpload 404, verified by probe). The translation code itself still maps NoSuchUpload on every call, including abort (AWS S3 behavior). SI-03.12 should note that abort on MinIO never surfaces NoSuchUpload.
  - Errors translated in a single private run() wrapper around every internal-client send; besides the planned names, S3ServiceException with name NoSuchUpload (not only the NoSuchUpload class) and NoSuchKey are mapped (to StorageUploadNotFoundError / StorageObjectNotFoundError) — defensive equivalents of the planned mappings; everything else is re-thrown unchanged.
  - headObject returns { contentLength, contentType }; listParts/completeMultipartUpload use { partNumber, etag } (UploadedPart); putObject takes the SDK PutObject Body type.
  - Extra integration assertions inside the planned test file: CORS (PUT with Origin → Access-Control-Expose-Headers contains ETag, per AC), headObject on a missing key → StorageObjectNotFoundError (AC), putObject round-trip. Unit spec uses real S3Client instances (signing is local) with distinct fake internal/public hosts.
  - No S3Client.destroy() wiring was needed: Jest exits cleanly without open handles.
  - **Lint (pre-existing, out of scope):** `npm run lint` exits 1 with 150 errors / 40 warnings, all in files this session did not create (auth.service*.spec, channels.service*, filters specs, mail.service.integration-spec, create-test-data-source, users.service.integration-spec, test/auth.e2e-spec, plus 2 lines in the pre-existing SWAGGER_ENABLED test of env.validation.integration-spec.ts). Files created/changed in SI-03.1–03.5 lint clean. Needs a separate cleanup task.

### SI-03.6 — Entidade Video, migration CreateVideos e extensão do harness de testes
- **Status:** completed
- **Tests:** 14 passing (video.entity.integration-spec 9, migrations.integration-spec 4, videos.module.spec 1); migrations spec run twice consecutively green; regression channels/users/auth 115 passing
- **Observations:**
  - Migration generated via `npm run migration:generate` in the container: `src/database/migrations/1792498981670-CreateVideos.ts` (class `CreateVideos1792498981670`). The CLI does not create an index for a FK column on Postgres, so `@Index()` was added on `Video.channel_id` to get the `(channel_id)` index the Data Model / action 2 require; the migration was then regenerated (first generation discarded unexecuted).
  - Adding `Channel.videos` (`@OneToMany`) makes TypeORM require `Video` in every DataSource that loads `Channel`; the explicit `ALL_ENTITIES` arrays of the 10 existing auth/users/channels specs gained `Video` (otherwise metadata building fails with "Entity metadata for Channel#videos was not found"). No behavior change in those specs.
  - `metadata` is typed as `VideoMetadata { width, height, video_codec, container_format, bitrate, size }` (nullable members); SI-03.14 fills it.
  - Migrations spec gained an explicit assertion test for `videos_status_enum`, the unique `public_id` index, the `channel_id` index and the FK to `channels` (AC of `migration:run`); the revert test now asserts `videos` + `videos_status_enum` are gone while the token tables remain.
  - `npm run migration:run` applied CreateVideos to the dev DB (verified with `\d videos`).

### SI-03.7 — Exceções de domínio de vídeo e gerador de public_id
- **Status:** completed
- **Tests:** 14 passing (public-id.util.spec 3, domain-exception.filter.spec 11 — 5 new)
- **Observations:**
  - `videos.constants.ts` also exports the derived type `AcceptedVideoMimeType` (union of `ACCEPTED_VIDEO_MIME_TYPES`) for the DTO field type.

### SI-03.8 — VideoQueueModule e producer do job de processamento
- **Status:** completed
- **Tests:** 4 passing (producer integration 3, module unit 1)
- **Observations:**
  - "No consumer in the API process" AC is asserted via `DiscoveryService` (no provider is a `WorkerHost`) instead of `queue.getWorkersCount()`, because the worker count is global per Redis queue and becomes 1 once the `video-worker` container runs the consumer (SI-03.15).
  - The module unit spec uses `lazyConnect: true` in the test `BullModule.forRoot` connection so compilation does not require Redis I/O.
  - The integration spec uses the real `CoreModule` (root BullMQ connection to the Compose `redis` host) + `VideoQueueModule`, obliterating the queue before each test and in `afterAll`.

### SI-03.9 — Endpoint POST /videos (pré-cadastro do rascunho + início do multipart)
- **Status:** completed
- **Tests:** 19 passing — videos.service.spec 6 (initUpload), videos.service.integration-spec 2, channels.service.integration-spec 2 new (5 total), videos.module.spec 1, test/videos-create.e2e-spec.ts 5 (spec-derived)
- **Observations:**
  - **Plan vs reality:** AC #2 / spec 1.1 "o UUID `id` não aparece em nenhum ponto do corpo da resposta" is impossible as written: each presigned part URL path carries the storage key `videos/{uuid}/source`, which TD-03 fixes on the UUID. Smallest fix: the e2e asserts no `id` field and that the UUID appears nowhere in the body outside `parts[].url` (the API never exposes it as an identifier, per TD-10 AMB-12). Worth a TD-03/TD-10 note if the URL path exposure matters.
  - Test modules that import `VideosModule` must also import `UsersModule`: with `autoLoadEntities`, `ChannelsModule` registers only `Channel`, and its `Channel#user` relation needs `User` (in the app it comes from `AuthModule → UsersModule`). `VideosModule` keeps exactly the imports the plan lists. The worker module (SI-03.15) will need the same `User` registration.
  - `initUpload` throws a plain `Error` if the authenticated user has no channel (every registered user gets one; no catalog code exists for this invariant violation → 500).
  - `findByUserId` uses `dataSource.getRepository(Channel)` to keep `ChannelsService`'s existing `DataSource`-only constructor.
  - `VideosService` already injects `VideoProcessingProducer` (used from SI-03.11) and `@Inject(uploadConfig.KEY)`.
  - New test helpers: `test/support/videos-e2e.ts` (AppModule boot with main.ts globals, per-test reset of storage/DB/throttler/queue, `registerConfirmAndLogin` with the auth e2e spy pattern) shared by the video e2e files, and `src/test/presigned-put.ts` (PUT to a URL signed for `STORAGE_PUBLIC_ENDPOINT` by connecting to `STORAGE_ENDPOINT` while keeping the signed Host header) for integration specs that must keep the real public endpoint.
  - `@ApiResponse` 201 uses `type: CreateVideoUploadResponseDto` (response DTO with explicit `@ApiProperty`).

### SI-03.10 — Endpoint GET /videos/:publicId/upload (re-sign / retomada)
- **Status:** completed
- **Tests:** 17 passing — videos.service.spec 8 new (findOwnedByPublicId 2, resignUpload 6), videos.service.integration-spec 2 new, test/videos-upload-resign.e2e-spec.ts 5 (spec-derived); SI-03.9 tests of the same files still green
- **Observations:**
  - `findOwnedByPublicId` resolves the row by `public_id`, then compares `channel_id` with `ChannelsService.findByUserId(userId)`; unknown and non-owned both raise `VideoNotFoundException` before any state check.
  - `resignUpload` also treats a `draft` row without `upload_id` (init failed between the row insert and `CreateMultipartUpload`) as `InvalidVideoStateException` — there is no upload to resume.
  - The integration spec PUTs part 1 through the real public-endpoint URL using `src/test/presigned-put.ts`; the e2e follows its spec (`STORAGE_PUBLIC_ENDPOINT=http://minio:9000` + `UPLOAD_PART_SIZE_BYTES=5242880` set before compiling, restored in `afterAll`) and uses `fetch` PUT. The config-change scenario boots a second AppModule instance with `UPLOAD_PART_SIZE_BYTES=10485760` (factories read `process.env` at compile) and closes it in `finally`.
  - Controller shares `PUBLIC_ID_PARAM` (`@ApiParam`) and `ERROR_ENVELOPE` (`getSchemaPath(ApiErrorEnvelope)`) constants across handlers.

### SI-03.11 — Endpoint POST /videos/:publicId/upload/complete (verificação + disparo do processamento)
- **Status:** completed
- **Tests:** 28 passing — videos.service.spec 12 new (completeUpload), videos.service.integration-spec 5 new, test/videos-upload-complete.e2e-spec.ts 6/6 (spec-derived; scenario 1.5 green only once SI-03.12 landed, see below)
- **Observations:**
  - **Cross-SI dependency in the spec:** scenario 1.5 (`ready-failed-ou-apos-abort-retorna-409`) calls `DELETE /videos/:publicId/upload`, which is SI-03.12. At SI-03.11 time the run was 5/6 with 1.5 failing only on that DELETE (404 route not found); the e2e was left as authored and went 6/6 after SI-03.12 (re-run recorded there). The integration spec covers "complete após abort → 409" with a direct `StorageService.abortMultipartUpload`.
  - Parts-list check is a pure set comparison against 1..ceil(declared_size / part_size) from the persisted row (duplicates, gaps and out-of-range numbers all → `InvalidUploadPartsException` before any S3 call).
  - A `draft` row without `upload_id` is treated as `InvalidVideoStateException` (same rule as re-sign).
  - The e2e tampered-ETag case gets `InvalidPart` from MinIO → `StorageInvalidPartsError` → 422, and the following re-sign still lists both parts (multipart left open).

### SI-03.12 — Endpoint DELETE /videos/:publicId/upload (abort idempotente)
- **Status:** completed
- **Tests:** 15 passing — videos.service.spec 7 new (abortUpload), videos.service.integration-spec 3 new, test/videos-upload-abort.e2e-spec.ts 5 (spec-derived); re-run of test/videos-upload-complete.e2e-spec.ts now 6/6 (scenario 1.5 uses this DELETE)
- **Observations:**
  - Per SI-03.5: this MinIO build answers 204 to a repeated/unknown-id `AbortMultipartUpload` instead of `NoSuchUpload`, so on Compose the "ignore `StorageUploadNotFoundError`" branch is exercised only by the unit spec (AWS S3 behavior); the integration/e2e repeated-abort cases pass through the plain 204 path. Either way the subsequent `DeleteObject` always runs and the response is the same 204.
  - `abortUpload` skips the abort call for a `draft` row without `upload_id` (nothing to abort) but still deletes the source key.
  - "Multipart already completed with row `draft`" is reproduced by calling `StorageService.completeMultipartUpload` directly; after the abort `HeadObject` is NotFound and a later `complete` is 409 `INVALID_VIDEO_STATE` (integration + e2e).
  - **Session check after SI-03.12 (out of scope, follow-up):** `npm run test:e2e` as defined in package.json (`jest --config ./test/jest-e2e.json`) does NOT run in band, contrary to nestjs-project/CLAUDE.md ("already configured"). With 7 e2e suites sharing one DB it fails (25 failed / 48 passed: FK violations in `cleanAllTables`, cross-suite contamination). `npm run test:e2e -- --runInBand` → 7 suites / 73 tests green. Fixed in this phase: `--runInBand` added to the `test:e2e` script (the new Phase 03 e2e suites are what made the parallel run break; aligns the script with nestjs-project/CLAUDE.md) → `npm run test:e2e` 7 suites / 73 tests green. Same session: `npm test -- --runInBand` 34 suites / 247 tests green; `tsc --noEmit` clean; `npm run lint` 0 errors (1 pre-existing warning in auth.service.integration-spec.ts).

### SI-03.13 — FfmpegService (wrapper tipado de ffprobe/ffmpeg via spawn) e gerador de vídeo de teste
- **Status:** completed
- **Tests:** 8 passing (ffmpeg.service.integration-spec.ts: probe 3, extractFrame 1, over presigned internal URL 4)
- **Observations:**
  - `ffmpeg -h protocol=http` in the image (FFmpeg 5.1.9) confirms `reconnect`, `reconnect_on_network_error`, `reconnect_delay_max` (and `seekable`, `multiple_requests`); `extractFrame` adds `-reconnect 1 -reconnect_on_network_error 1 -reconnect_delay_max 5` before `-i` only for http(s) inputs. Both invocations also pass `-v error` (and ffmpeg `-y` to overwrite the output path); no other options.
  - Error split (action 3 says non-zero ffprobe → `MediaNotDecodableError` but HTTP failure → `FfmpegExecutionError`; TD-09 wants network failures retried): for an http(s) input, a non-zero ffprobe exit is `MediaNotDecodableError` only when stderr shows a demux failure (`Invalid data found when processing input` / `moov atom not found`); any other HTTP failure (403, DNS, connection refused — stderr verified in the image) is `FfmpegExecutionError` (retryable). Local inputs: any non-zero exit is `MediaNotDecodableError`. Spawn failures and non-zero ffmpeg exits are `FfmpegExecutionError` with stderr. A probe output without a video stream or without `format.duration` is `MediaNotDecodableError`.
  - `generateTestVideo` encodes lavfi `testsrc` with libx264 (`-preset ultrafast -pix_fmt yuv420p`) and reaches the target size (`minSizeBytes`) deterministically by appending a trailing top-level ISO BMFF `free` box (a valid MP4; ffprobe reports `format.size` = file size). `generateRandomBytesFile` writes random bytes for the not-decodable path.
  - Extra tests beyond the table: extractFrame over the presigned internal URL (exercises the HTTP reconnect options), random bytes over HTTP → `MediaNotDecodableError`, 403 over HTTP → `FfmpegExecutionError`, probe of a missing local path.

### SI-03.14 — Processamento do vídeo: VideoProcessingService e VideoProcessingConsumer
- **Status:** completed
- **Tests:** 22 passing — video-processing.service.spec 6, video-processing.service.integration-spec 3, video-processing.consumer.spec 7, videos.service.integration-spec 6 new (worker state transitions); the 15 earlier tests of videos.service.integration-spec still green
- **Observations:**
  - `markReady`/`markFailed` are `UPDATE ... WHERE id = :id AND status = 'processing'` (no-op for any other state); `findProcessingById` returns the row only while `processing`, so a re-run job of a `ready`/`failed` video exits before touching storage/FFmpeg.
  - `VideoProcessingService.process` re-throws `FfmpegExecutionError` and storage errors unchanged (retryable through the queue's `attempts: 3` + exponential backoff from SI-03.8); only `MediaNotDecodableError` becomes `UnrecoverableError`. The JPEG is written to `os.tmpdir()/thumbnail-<uuid>-<random>.jpg`, read into memory for `PutObject` and removed in `finally`.
  - `onFailed` treats as terminal `err instanceof UnrecoverableError` (or `err.name === 'UnrecoverableError'`) or `job.attemptsMade >= job.opts.attempts` (BullMQ increments `attemptsMade` before emitting `failed`); intermediate failures are logged as warnings; a `markFailed` error is logged, never re-thrown; a `failed` event without a job is only logged.
  - The service integration spec builds `CoreModule + UsersModule + VideosModule + StorageModule` with `FfmpegService`/`VideoProcessingService` as local providers (no `VideoProcessingConsumer`, nothing enqueued), so it is independent of any queue consumer, including the `video-worker` container from SI-03.15.

### SI-03.15 — Entrypoint do worker e wiring do container video-worker
- **Status:** completed
- **Tests:** 4 passing (worker.module.integration-spec.ts); with the `video-worker` container consuming: SI-03.8–03.15 queue-related integration suites 54/54 and `npm run test:e2e` 7 suites / 73 tests green (run twice)
- **Observations:**
  - `WorkerModule` imports `CoreModule`, `UsersModule` and `VideoProcessingModule`. `UsersModule` (no controllers) is the smallest fix for the `Channel#user` relation (needs `User` registered, as noted in SI-03.9); no `AuthModule`. `VideosModule` brings `VideosController` into the graph, but `createApplicationContext` mounts no HTTP routes and opens no port (only Docker's embedded DNS socket is listening in the container).
  - `worker.ts` = `createApplicationContext(WorkerModule)` + `enableShutdownHooks()`; it also awaits `worker.waitUntilReady()` and logs `Video worker connected to Redis, consuming queue "video-processing"`, and logs `Video worker closed` on the BullMQ worker `closed` event (visible in `docker compose logs video-worker`).
  - **Test determinism with the container worker:** the container worker and the test processes share Redis/DB/MinIO, so a job enqueued by a test (complete e2e/integration) could be consumed by the container and flip `processing` rows to `ready`/`failed` (and `failed` makes a repeated `complete` 409) — a real race. Fix: new test helper `src/test/test-queue-prefix.ts` (`useTestQueuePrefix(builder)`) overrides the root BullMQ shared config (`getSharedConfigToken()`) with `prefix: 'bull-test'`; applied in `video-processing.producer.integration-spec.ts`, `videos.service.integration-spec.ts`, `test/support/videos-e2e.ts` and the new worker spec. The container worker consumes only the default `bull` prefix, so test jobs are never seen by it. No production code/config changed for this. SI-03.14's processing integration spec calls `VideoProcessingService` directly (nothing enqueued). Any future test that needs a consumer (SI-03.18) must start its own in-process `WorkerModule` with `useTestQueuePrefix`.
  - The worker integration spec boots `WorkerModule` through `Test.createTestingModule(...).compile()` + `init()` (a `NestApplicationContext`, same lifecycle as `createApplicationContext`) instead of `NestFactory.createApplicationContext`, because the test prefix override needs the testing builder; it asserts the consumer's worker runs on `video-processing` with concurrency 1, consumes a job (unknown video → completed, no effect), and is no longer running after `close()`; plus `AppModule` has no `VideoProcessingConsumer`.
  - **AC verified manually:** `docker compose up -d` starts `video-worker` running `npm run start:worker:dev` (logs show the connected/consuming line). A real flow on the default prefix (initUpload → 2 presigned part PUTs of a 6 MiB generated MP4 → completeUpload) went `processing` → `ready` in ~200 ms through the container worker, with `metadata` filled and `videos/{id}/thumbnail.jpg` (image/jpeg) stored; verification data deleted afterwards. The API process (`nestjs-api`) stays idle and AppModule has no consumer.
  - **Shutdown (deviation, compose):** with only `command` + `restart`, `docker compose stop video-worker` never ran the shutdown hooks: SIGTERM reaches npm (PID 1) → the Nest CLI watch process dies without signalling its child (it only tree-kills on a normal `exit`), and the app is SIGKILLed when PID 1 exits. Added `init: true` + `TINI_KILL_PROCESS_GROUP: "1"` so docker-init relays SIGTERM to the whole process group and the worker process runs `onApplicationShutdown` (`Video worker closed` logged). In dev watch mode this is still best-effort (2 of 3 stops logged the close; the npm → nest CLI chain can exit, and take the container down, before the async close finishes); jobs interrupted that way are recovered by BullMQ stalled-job detection (at-least-once, TD-01). The prod entrypoint is deterministic: `node dist/worker` as the container process logged `Video worker closed` on 3/3 `docker stop` (exit 143 = SIGTERM re-raised after the hooks).
  - Dev watch note: `nest start --watch` in `video-worker` and a manual `start:dev` in `nestjs-api` share `dist/` through the bind mount and `deleteOutDir: true`; each start re-emits the whole project, so they converge, but a start of one briefly deletes the other's `dist/`. Any new `.ts` file at the project root also triggers a worker rebuild (tsconfig default include).

### SI-03.16 — Endpoint GET /videos/:publicId/stream (reprodução via streaming)
- **Status:** completed
- **Tests:** 9 passing — videos.service.spec 5 new (getStreamUrl), videos.service.integration-spec 1 new, test/videos-stream.e2e-spec.ts 3 (spec-derived); the rest of both service suites still green (57 total)
- **Observations:**
  - The 404 → 409 rule lives in a private `findReadyOwnedByPublicId` (reused by download in SI-03.17); `getStreamUrl` calls `presignGetPublic(videoSourceKey(id), DELIVERY_URL_TTL_SECONDS)` with no disposition.
  - `VideoDeliveryUrlResponseDto` is in `src/videos/dto/video-delivery-url-response.dto.ts`.
  - `videos.service.integration-spec.ts` now sets `STORAGE_PUBLIC_ENDPOINT=http://minio:9000` before compiling (restored in `afterAll`), as the SI's Tests row asks, so the returned URL is fetched directly; the existing part-URL host assertion reads the env at run time and the presigned-put helper keeps working with that host.
  - The e2e fixture follows the spec (POST /videos 4096 bytes → PUT → complete → status set on the row); its complete enqueues under the test queue prefix, so the `video-worker` container never changes the row during the test.

### SI-03.17 — Endpoint GET /videos/:publicId/download (download com disposition attachment)
- **Status:** completed
- **Tests:** 12 passing — content-disposition.util.spec 4, videos.service.spec 5 new (getDownloadUrl), videos.service.integration-spec 1 new, test/videos-download.e2e-spec.ts 2 (spec-derived)
- **Observations:**
  - `buildAttachmentDisposition` strips C0 controls (U+0000–U+001F), DEL, `"` and `\` and keeps everything else (spaces, accents); it adds no fallback for a name that becomes empty (not in the plan; the DTO already requires a non-empty `filename`).
  - `getDownloadUrl` reuses the private `findReadyOwnedByPublicId` from SI-03.16 (404 before 409) and passes the disposition as `presignGetPublic`'s third argument (`ResponseContentDisposition`); MinIO returns `Content-Disposition: attachment; filename="clip.mp4"` and the full body (integration + e2e).
  - **Session check after SI-03.17 (video-worker container running and consuming):** `npm test -- --runInBand` 40 suites / 297 tests green; `npm run test:e2e` 9 suites / 78 tests green; `tsc --noEmit` exit 0; `npm run lint` 0 errors (1 pre-existing warning in auth.service.integration-spec.ts). The container worker logged no processing of test jobs.

### SI-03.18 — Verificação ponta a ponta do ciclo upload → processamento → streaming/download
- **Status:** completed
- **Tests:** 4 passing (test/video-lifecycle.e2e-spec.ts), with the `video-worker` container running and consuming (its log shows no processing of test jobs)
- **Observations:**
  - The in-process worker is built with `useTestQueuePrefix(Test.createTestingModule({ imports: [WorkerModule] })).compile()` + `init()` instead of `NestFactory.createApplicationContext(WorkerModule)` (action 1): the test prefix override needs the testing builder (same reasoning as SI-03.15). Lifecycle is the same `NestApplicationContext`; API (`createVideosE2eApp`) and worker run in the same Jest process.
  - To observe `processing` in the DB deterministically (otherwise the worker can flip the row to `ready` before the read), the main scenario pauses the in-process BullMQ worker (`consumer.worker.pause()`) around `complete`, asserts `processing`, then resumes; no other client call happens after `complete`. `draft` is asserted on the row right after `POST /videos`.
  - Polling is bounded (30 s, 200 ms interval, explicit error message with the last status). In practice each video reaches its terminal state in < 1 s.
  - `thumbnail_key` is not a column (the key is derived, `videoThumbnailKey(id)` per the Data Model); the AC is verified with `HeadObject` on `videos/{videoId}/thumbnail.jpg` (`image/jpeg`, size > 0). The failed path also asserts `duration_seconds`/`metadata` stay null and the source object remains with the declared size.
  - Extra assertions beyond the plan: `Content-Range: bytes 0-1023/<size>` and 1024-byte body on the stream fetch; full body length on the download fetch; distinct UUID `id` for the two videos.

### SI-03.19 — OpenAPI: atualizar `openapi.json` exportado com os endpoints de vídeo
- **Status:** completed
- **Tests:** 28 passing (openapi-export.integration-spec.ts: 9 existing + 19 new); test/swagger.e2e-spec.ts 6 passing
- **Observations:**
  - `openapi.json` regenerated with `npm run openapi:export`: 5 video paths / 6 operations added (`POST /videos`, `GET`/`DELETE /videos/{publicId}/upload`, `POST /videos/{publicId}/upload/complete`, `GET /videos/{publicId}/stream`, `GET /videos/{publicId}/download`), each with tag `videos`, `security: [{ access-token: [] }]`, exactly the API Contracts statuses, and every error response `$ref` `ApiErrorEnvelope`. The new tests assert the exact path set, the exact method set per path, the exact status set per operation, tag/security and the error `$ref`s.
  - AC "docs-json lists the same routes": verified manually by running `node dist/main` with `SWAGGER_ENABLED=true PORT=3999` inside `nestjs-api` and comparing `GET /api/docs-json` with the exported file: the 16 operations match in path, method, status set, security and tags.
  - **Pre-existing export gap (out of scope, follow-up):** `src/openapi-export.ts` does not call `SwaggerModule.loadPluginMetadata(metadata)` as `main.ts` does, so DTOs that rely only on the Swagger CLI plugin are exported with empty `properties` — already the case for every auth request DTO in the committed file, and now also `CreateVideoUploadDto` and `CompleteVideoUploadDto` (its `CompletedPartDto` item schema is missing). The live `/api/docs-json` has them. Response DTOs with explicit `@ApiProperty` are complete. Also from the plugin: `GET /` 200 schema and the `token` query param of `/auth/confirm-email` are missing from the export. The fix (load plugin metadata in `exportSpec`) is a separate task; the frontend contract file is incomplete for request bodies until then.

### SI-03.20 — Documentação: seção de vídeos nos CLAUDE.md coerente com o código
- **Status:** completed
- **Tests:** no tests (documentation only) — ACs verified against the code and the Docker environment
- **Observations:**
  - Root `CLAUDE.md`: `Message Queue** (BullMQ on Redis)` and a new "Videos" section (init / re-sign / complete / abort with method, path and status; `draft → processing → ready | failed`; queue `video-processing`, job `process`, `jobId` = UUID, 3 attempts + exponential backoff; worker entrypoint `src/worker.ts`; `public_id`; stream `206` / download `attachment`). The stale "`next-frontend/` — not yet initialized" line was left untouched (SI-03.20 does not ask for it).
  - `nestjs-project/CLAUDE.md`: services (`video-worker`, `mailpit`, `redis`, `minio` 9000/9001 Chainguard, `minio-bootstrap`), readiness checks, `npm run migration:run`, a "Video worker" commands block (`start:worker:dev` / `start:worker:prod`), FFmpeg in `Dockerfile.dev`, `STORAGE_ENDPOINT` vs `STORAGE_PUBLIC_ENDPOINT` + the new env keys, the `bull-test` test prefix note, `CoreModule`/`WorkerModule` architecture lines.
  - **Plan vs reality:** the plan's readiness check `docker compose ps minio-bootstrap` prints an empty table once the one-shot job exited (`ps` hides exited containers); documented `docker compose ps -a minio-bootstrap` (shows `Exited (0)`).
  - Verification: every path, script, env key (present in both `.env.example` and `src/config/env.validation.ts`), port and log line was grepped against the code/compose; `redis-cli ping` → PONG, MinIO health → 200, `ps -a minio-bootstrap` → Exited (0), `docker compose logs video-worker` shows the consuming line, `npm run start:worker:prod` in `video-worker` logged the same line (stopped with `timeout`), `start:worker:dev` is the container's running command.
