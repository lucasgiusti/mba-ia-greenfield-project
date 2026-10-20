# phase-03-videos — Progress

**Status:** in_progress
**SIs:** 5/20 completed

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
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.7 — Exceções de domínio de vídeo e gerador de public_id
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.8 — VideoQueueModule e producer do job de processamento
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.9 — Endpoint POST /videos (pré-cadastro do rascunho + início do multipart)
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.10 — Endpoint GET /videos/:publicId/upload (re-sign / retomada)
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.11 — Endpoint POST /videos/:publicId/upload/complete (verificação + disparo do processamento)
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.12 — Endpoint DELETE /videos/:publicId/upload (abort idempotente)
- **Status:** pending
- **Tests:** —
- **Observations:** none

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
