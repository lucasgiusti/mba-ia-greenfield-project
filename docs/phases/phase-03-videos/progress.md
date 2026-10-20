# phase-03-videos — Progress

**Status:** in_progress
**SIs:** 12/20 completed

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
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.14 — Processamento do vídeo: VideoProcessingService e VideoProcessingConsumer
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.15 — Entrypoint do worker e wiring do container video-worker
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.16 — Endpoint GET /videos/:publicId/stream (reprodução via streaming)
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.17 — Endpoint GET /videos/:publicId/download (download com disposition attachment)
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.18 — Verificação ponta a ponta do ciclo upload → processamento → streaming/download
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.19 — OpenAPI: atualizar `openapi.json` exportado com os endpoints de vídeo
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.20 — Documentação: seção de vídeos nos CLAUDE.md coerente com o código
- **Status:** pending
- **Tests:** —
- **Observations:** none
