---
scope_type: phase
related_phases: [3]
status: pending
date: 2026-10-19
scope_description: "Backend foundation for video upload and processing: queue technology, 10GB direct-to-storage upload protocol, object-storage layout, draft pre-registration and completion trigger, status lifecycle and failure policy, worker topology, FFmpeg/ffprobe integration, unique video URL identifier, and streaming/download delivery."
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — backend that delivers every Phase 03 capability: storage integration (S3 API against MinIO), upload orchestration endpoints, `videos` entity + migration, queue producer, the video worker (FFmpeg/ffprobe) and the streaming/download endpoints. Gains new Compose services (object storage, queue backend if any, worker).
- `next-frontend/` — No open decision in this document: Phase 03 is backend-only (the video UI — upload screen, player, download button — is not part of this phase; the player and download button are Phase 05 bullets). The Cross-layer TDs below (TD-02, TD-04, TD-05, TD-10, TD-11) fix the HTTP/storage contract the frontend will consume later; the frontend side is implemented in its own phase, under the inherited strict-BFF rule (`next-frontend-config-base/TD-03`).

_Inherited constraints (not reopened):_

- Object storage is S3-compatible: MinIO locally in Docker, S3 in production. Only **how** it is used is decided here (TD-03). Note: the `minio/minio` GitHub repository was archived in April 2026 and the official community images stopped at `RELEASE.2025-09-07T16-13-09Z`; the Compose service must pin an explicit image tag (or a maintained fork). Pinning the tag is an implementation step, not a TD.
- Strict BFF (`next-frontend-config-base/TD-03`): the browser never calls the NestJS API directly. That TD already anticipated that video bytes would use object-storage URLs (presigned), not the backend URL. TD-02 and TD-11 build on this.
- Config via `@nestjs/config` + Joi + namespaced `registerAs` (`phase-01-configuracao-base/TD-01..TD-03`): new keys (storage, queue) extend `env.validation.ts`.
- Error contract `{ statusCode, error, message }` with domain codes (`phase-02-auth/TD-07`); authentication via custom JWT guards (`phase-02-auth/TD-02`); UUID primary keys (existing `users`/`channels` entities).
- Installed versions: `@nestjs/common`/`core` 11.1.16, `typeorm` 0.3.28, `express` 5.2.1, TypeScript 5.9.3, CommonJS project (no `"type": "module"`), base image `node:25.6.0-slim` (Debian 12 bookworm).

---

## TD-01: Message Queue Technology

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** The architecture diagram lists the Message Queue as "TBD" — this is the main stack decision of the phase. The workload is low-throughput and heavy-per-job (one job per uploaded video, each taking seconds to minutes of FFmpeg work). Required features: durable jobs, retries with backoff, detection of jobs whose worker died (stalled/expired), and a consumer running in a separate process (TD-07). PostgreSQL 17 is already in the stack.

**Options:**

### Option A: BullMQ on Redis (`@nestjs/bullmq` + `bullmq`)
- Redis-backed queue; the official NestJS "Queues" technique (`BullModule.forRoot`, `@Processor` + `WorkerHost`). Built-in attempts/exponential backoff, stalled-job detection, `UnrecoverableError` for non-retryable failures, `jobId` dedup. Current `bullmq` 6.3.x; use `@nestjs/bullmq` 11.0.x (12.0.0 is ESM-only).
- **Pros:** Canonical NestJS path — best docs and examples; richest feature set; mature on Redis.
- **Cons:** New infrastructure (Redis/Valkey container, must run with `maxmemory-policy noeviction`). Enqueue is not atomic with the DB write that marks the video `processing` (mitigated by `jobId = videoId` + idempotent worker).

### Option B: pg-boss (PostgreSQL-backed queue)
- Job queue stored in the existing PostgreSQL (`SKIP LOCKED`), v12.38, Node ≥22.12. Retries (`retryLimit`, `retryBackoff`), expiration, dead-letter queues.
- **Pros:** Zero new infrastructure. Job insert can share the transaction that updates the video row (no dual-write gap).
- **Cons:** No official NestJS module — a small custom provider/lifecycle wrapper is needed. Fewer examples in the Nest ecosystem; queue load lands on the primary database.

### Option C: RabbitMQ (`@golevelup/nestjs-rabbitmq` or `@nestjs/microservices` RMQ transport)
- AMQP broker; consumer subscribes to a durable queue. Retries/delays built with DLX + TTL or the delayed-message plugin.
- **Pros:** Real broker with routing/fan-out; language-agnostic consumers.
- **Cons:** Heaviest option for a single job type. Retry with backoff is not built-in. `@golevelup/nestjs-rabbitmq` 8.1+ needs `@nestjs/common` ≥11.1.17 (installed 11.1.16 → upgrade). `@nestjs/microservices` latest is 12.x; 11.2.x would be required.

### Option D: BullMQ 6 PostgreSQL backend (`createPostgresBackend`)
- BullMQ 6.0 (July 2026) added a PostgreSQL backend (LISTEN/NOTIFY, explicit `runMigrations`) with the same Queue/Worker API.
- **Pros:** BullMQ API without Redis.
- **Cons:** ~3 months old; BullMQ's own docs still call Redis "the most battle-tested option". `@nestjs/bullmq` (11.x and 12.0) does not expose the backend factory — it would need custom `queueClass`/`workerClass` overrides. Its migrations sit outside the TypeORM migration flow.

**Recommendation:** **Option A (BullMQ on Redis)** — it is the documented NestJS approach and covers retries, backoff, stalled detection and non-retryable errors with no custom code, which matters for 10GB jobs that can crash a worker mid-way. The one Redis container is a small cost. **Option B (pg-boss)** is a close second if avoiding new infrastructure matters more than framework integration: its transactional enqueue is a real advantage. Option D is not recommended yet because it is too new and has no Nest wiring.

**Decision:** _[pending]_

---

## TD-02: Large-File Upload Protocol (up to 10GB)

**Scope:** Cross-layer

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** 10GB files cannot go through the API's request cycle without tying up workers, memory, and connections. Under strict BFF they would also cross the Next.js server, adding a second hop. The plan also asks that the upload "permita retomar em caso de falha de conexão". S3 limits: single PUT ≤ 5 GiB, multipart parts 5 MiB–5 GiB, ≤ 10,000 parts. The protocol is a backend↔client handshake, so it is Cross-layer. Whichever option is chosen, presigned URLs must be signed with a **browser-reachable** storage endpoint (e.g. `localhost:9000` in dev), distinct from the internal Compose host (`minio:9000`). This creates a cross-component env-key pair (internal vs public endpoint) in Joi + Compose + runtime.

**Options:**

### Option A: S3 multipart upload with presigned part URLs (direct to storage)
- API (authenticated) validates the declared size (≤ 10GB) and type, creates the multipart upload and returns presigned `UploadPart` URLs (part size e.g. 64–100 MiB). The client PUTs parts directly to MinIO/S3, then calls the API to complete (`CompleteMultipartUpload` + `HeadObject` size check). Uses `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (3.1153.x).
- **Pros:** No video bytes go through the API or the BFF. Resumable per part (re-sign / `ListParts`). Parts upload in parallel. Same protocol on MinIO and S3.
- **Cons:** Several API round-trips (init / sign / complete). The bucket needs CORS that exposes `ETag` to the browser. Size limits are only enforced at init and at complete, not by the protocol itself. Abandoned multipart uploads must be aborted or cleaned up.

### Option B: tus resumable protocol through the API (`@tus/server` + `@tus/s3-store`)
- A tus endpoint mounted in NestJS (Express) receives `PATCH` chunks and streams them to S3 multipart via `@tus/s3-store` (2.0.x). The client uses `tus-js-client`/Uppy.
- **Pros:** Open, standard resumable protocol with mature clients. Upload state is handled by the library. The upload-finished hook is a natural completion trigger.
- **Cons:** Every byte goes through the API **and**, under strict BFF, through the Next.js server too. That directly works against "sem impacto na performance". Extra store/locking config for multi-instance setups.

### Option C: Streamed `multipart/form-data` through the API
- The API parses the request stream (busboy) and pipes it to `@aws-sdk/lib-storage` `Upload` without buffering.
- **Pros:** Simplest client (one form POST); constant memory on the server.
- **Cons:** Not resumable — a failure at 9GB restarts from zero. Holds one API (and BFF) connection for the whole upload. Bytes go through two servers.

**Recommendation:** **Option A (presigned multipart, direct to storage)** — it is the only option that keeps 10GB of traffic off both the NestJS API and the Next.js BFF while still being resumable. It also matches what `next-frontend-config-base/TD-03` already anticipated (video bytes use storage URLs, not the backend URL). The cost is a few small orchestration endpoints and a bucket CORS rule.

**Decision:** _[pending]_

---

## TD-03: Object Storage Layout (buckets and object keys)

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** Which storage to use is fixed (S3-compatible / MinIO); how to use it is not. The key layout is used by the API (presigning, completion), the worker (reading the source, writing the thumbnail), the DB columns that store keys, and the Compose bucket bootstrap. Bucket privacy also determines what TD-11 can do.

**Options:**

### Option A: Single private bucket, per-video prefix
- One bucket (e.g. `streamtube-media`) with keys like `videos/{videoId}/source` and `videos/{videoId}/thumbnail.jpg`. All access goes through presigned URLs.
- **Pros:** One bucket to bootstrap, configure (CORS) and set lifecycle rules on. Deleting a video means deleting one prefix. Keys can be derived from the video ID.
- **Cons:** Any policy difference (e.g. public thumbnails later) must be expressed per prefix, not per bucket.

### Option B: Separate buckets per asset type (`videos`, `thumbnails`)
- Source videos in a private bucket; thumbnails in their own bucket (possibly public-read later for cheap caching).
- **Pros:** Clear policy boundaries per bucket (privacy, lifecycle, CORS only on the upload bucket).
- **Cons:** Two buckets to bootstrap and configure in every environment. Deleting a video spans two buckets. More env keys.

### Option C: Owner-scoped prefixes (`users/{userId}/videos/{videoId}/...`)
- Same as A, but keys are grouped by owner.
- **Pros:** Per-user listing/quota accounting by prefix.
- **Cons:** Keys break if ownership ever changes. The owner ID becomes part of every storage URL. Quotas are not a Phase 03 capability.

**Recommendation:** **Option A (single private bucket, per-video prefix)** — the smallest setup that works across dev and prod. It keeps everything private by default, which leaves room for Phase 04 visibility rules (draft/unlisted). It lets the API and worker derive keys from the video ID. Splitting buckets can be added later without changing the video ID contract.

**Decision:** _[pending]_

---

## TD-04: Draft Pre-registration and Upload-Completion Trigger

**Scope:** Cross-layer

**Capability:** Transversal — covers: "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload", "Processamento automático do vídeo após upload (extração de duração e metadados)"

**Context:** The video row must exist (as a draft) as soon as the upload starts, and processing must start automatically when the upload finishes. With direct-to-storage upload (TD-02 A), the API does not see the bytes arrive, so some signal must report "upload finished". The choice touches the client handshake, the API, storage configuration and the queue. Depends on TD-02.

**Options:**

### Option A: Client-driven init/complete endpoints
- `init` creates the draft `videos` row + multipart upload and returns the video ID and part URLs. `complete` (called by the client) finalizes the multipart upload, verifies the object (`HeadObject`), moves the video to processing and enqueues the job (`jobId = videoId`).
- **Pros:** Synchronous, explicit, easy to test end-to-end. Same behavior on MinIO and S3. The API controls validation (size, ownership) at both ends.
- **Cons:** If the client never calls `complete`, the draft stays in its pre-processing state (needs a cleanup/expiry policy for abandoned drafts).

### Option B: Storage event notifications
- MinIO bucket notifications (webhook/AMQP/Redis target) or S3 Event Notifications (SQS/EventBridge) emit `ObjectCreated` → the API or worker enqueues processing.
- **Pros:** Triggered by the object actually existing, not by the client being well-behaved.
- **Cons:** Notification setup differs between MinIO (dev) and S3 (prod), so dev no longer mirrors prod. Needs an extra listener/endpoint. With multipart, the client still has to complete the upload, so `complete` exists anyway.

### Option C: Periodic reconciliation (scheduled scan)
- A scheduled job looks for drafts whose object now exists (`HeadObject`/`ListMultipartUploads`) and enqueues them.
- **Pros:** No dependence on client or storage callbacks; self-healing.
- **Cons:** Processing starts only after a polling delay (not "automatic after upload" in a user-visible sense). Adds a scheduler dependency and more storage API calls.

**Recommendation:** **Option A (client-driven init/complete)** — with presigned multipart the client must call `CompleteMultipartUpload` anyway. Routing that call through the API gives one deterministic point to verify the object and enqueue, with identical behavior on MinIO and S3. A cleanup policy for drafts that never complete is still needed. It can reuse the queue's delayed/scheduled jobs and does not need to be a separate TD.

**Decision:** _[pending]_

---

## TD-05: Video Status Lifecycle Model

**Scope:** Cross-layer

**Capability:** Transversal — covers: "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload", "Processamento automático do vídeo após upload (extração de duração e metadados)"

**Context:** A video goes through upload → processing → ready, or fails. The state is persisted (DB enum + migration), written by both the API and the worker, and exposed in API responses that the Phase 04 management panel will show ("status"). Phase 04 also adds "Fluxo de rascunho → publicação", so this TD decides whether "draft" is a processing state or a publication state.

**Options:**

### Option A: Single linear `status` enum
- One column: `draft` (pre-registered/uploading) → `processing` → `ready` | `failed`. Phase 04 would add `published`.
- **Pros:** Simplest model; matches the phase wording directly. One field to filter on.
- **Cons:** Mixes two concerns. In Phase 04 a ready-but-unpublished video is "ready", not "draft", so the meaning of `draft` changes, and any return to draft (unpublish, reprocess) breaks the linear order.

### Option B: Two orthogonal fields — publication `status` + `processing_status`
- `status` (publication): `draft` now; Phase 04 adds `published`. `processing_status`: `awaiting_upload` → `processing` → `ready` | `failed` (plus a `processing_error` text).
- **Pros:** Each field has one meaning. Phase 04 extends publication without touching processing semantics. "Can be published only when `processing_status = ready`" becomes a simple rule.
- **Cons:** Two fields to keep consistent and expose in the API contract. Slightly more upfront modeling.

**Recommendation:** **Option B (two orthogonal fields)** — the plan already treats "rascunho → publicação" as its own Phase 04 flow. Keeping draft/publish separate from upload/processing avoids redefining an enum (and migrating data) one phase later. Option A is acceptable if the team prefers literal simplicity now and accepts that Phase 04 will have to revisit the enum.

**Decision:** _[pending]_

---

## TD-06: Processing Failure Policy

**Scope:** Backend

**Capability:** Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** Processing can fail transiently (storage timeout, worker killed mid-job) or permanently (the file is not a decodable video, according to ffprobe). The policy decides how many retries, which errors skip retries, what the video's final state is, and what happens to stored objects. Depends on TD-01 (retry primitives) and TD-05 (terminal state).

**Options:**

### Option A: Bounded automatic retries, then terminal `failed` (keep data)
- Transient errors retry with exponential backoff (e.g. 3 attempts). Invalid-media errors fail immediately with no retry. After the last attempt the video is marked `failed` with a persisted reason. The source object is kept so the owner sees the error and can delete it or upload again.
- **Pros:** Absorbs transient failures automatically. The owner sees what happened. No silent data loss.
- **Cons:** Failed videos keep using storage until the owner deletes them.

### Option B: No automatic retry; manual reprocess endpoint
- Any error marks the video `failed`; an owner-only endpoint re-enqueues it.
- **Pros:** Simple and predictable; no hidden retry load.
- **Cons:** Transient blips (very likely with 10GB inputs) become user-visible failures. Adds an endpoint the plan does not ask for.

### Option C: Retries, then automatic cleanup (delete row and objects)
- Same retries as A; after the last attempt the draft and its objects are deleted.
- **Pros:** No storage left behind by failed uploads.
- **Cons:** The owner loses the record and the reason. A 10GB re-upload is the only recovery. Hard to debug.

**Recommendation:** **Option A (bounded retries, then terminal `failed`, keep data)** — it uses the queue's built-in backoff and non-retryable error support (TD-01) and keeps the failure visible in the status model (TD-05). Storage cost stays bounded because only failed videos are kept, and they remain deletable.

**Decision:** _[pending]_

---

## TD-07: Video Worker Runtime Topology

**Scope:** Backend

**Capability:** Transversal — covers: "Serviço de processamento em segundo plano (filas)", "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** FFmpeg/ffprobe work is CPU- and I/O-heavy. The architecture diagram shows a separate "Video Worker" container. The choice affects the Compose services, the Docker image (FFmpeg binaries), the app entrypoints and how the worker reuses entities and config. Depends on TD-01.

**Options:**

### Option A: Same codebase, separate entrypoint and Compose service
- `nestjs-project` gains a worker entrypoint (`NestFactory.createApplicationContext(WorkerModule)`, no HTTP listener) that registers only the queue consumer. A `video-worker` Compose service runs it from the same image (with FFmpeg installed).
- **Pros:** Matches the C4 diagram. CPU-heavy jobs never compete with API requests. Reuses entities, config namespaces and TypeORM setup with full DI. Scales independently.
- **Cons:** One more Compose service and process to run. Module boundaries must stop the worker from loading HTTP-only modules.

### Option B: In-process consumer inside the API (optionally a BullMQ sandboxed processor)
- The `@Processor` runs inside the API process. A sandboxed/forked processor moves job execution to a child process.
- **Pros:** No extra service; simplest dev setup.
- **Cons:** FFmpeg load shares the API container's CPU/memory, which works against "sem impacto na performance". Sandboxed processors lose DI (per NestJS docs), so services must be wired by hand. API and worker cannot scale separately.

### Option C: Separate subproject (`video-worker/` with its own `package.json`)
- A standalone Node service in the monorepo.
- **Pros:** Fully isolated dependencies and image.
- **Cons:** Duplicates entities, config/validation and DB wiring (or forces a shared package that the monorepo does not have today). More CI and Compose surface.

**Recommendation:** **Option A (same codebase, separate entrypoint and Compose service)** — it is the topology shown in the architecture diagram. It isolates FFmpeg load from the API and keeps one source of truth for entities and config. The only extra cost is a Compose service.

**Decision:** _[pending]_

---

## TD-08: FFmpeg / ffprobe Integration (binary source and invocation)

**Scope:** Backend

**Capability:** Transversal — covers: "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** The worker needs ffprobe (duration/metadata as JSON) and ffmpeg (one frame → image). The binary source affects the Dockerfile and the runtime code. `fluent-ffmpeg` — the long-standard wrapper — is **deprecated on npm and its repository was archived in May 2025**, so it is excluded. WASM builds (`@ffmpeg/ffmpeg`) are excluded too: their memory limits make them unsuitable for 10GB inputs.

**Options:**

### Option A: System FFmpeg from the base image's package manager + `child_process.spawn`
- `apt install ffmpeg` in the image (Debian 12 bookworm → FFmpeg 5.1.x). A thin typed wrapper spawns `ffprobe -v error -print_format json -show_format -show_streams` and `ffmpeg -ss <t> -i <input> -frames:v 1 <out>`.
- **Pros:** Distro-maintained binary with security updates. ffprobe and ffmpeg ship together. No npm dependency. Argument arrays (no shell) avoid injection.
- **Cons:** The wrapper (exit codes, stderr, timeouts) is ours to write and test. The FFmpeg version follows the distro (5.1 on bookworm).

### Option B: npm static binaries (`ffmpeg-static` + `ffprobe-static`) + `child_process.spawn`
- Binaries are downloaded at `npm install`; the code spawns the paths these packages export.
- **Pros:** The FFmpeg version is pinned through the lockfile. Works without changing the Dockerfile.
- **Cons:** `ffprobe-static` was last published in 2022 (3.1.0) — stale. Postinstall binary downloads make installs heavier and less reproducible. The same spawn wrapper is still needed.

**Recommendation:** **Option A (system FFmpeg + spawn)** — with the only maintained high-level wrapper gone, both options need a spawn wrapper anyway. The distro package is the better-maintained binary source, and the worker already needs its own image setup (TD-07).

**Decision:** _[pending]_

---

## TD-09: Worker Access to the Source Video

**Scope:** Backend

**Capability:** Transversal — covers: "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** The source can be up to 10GB in object storage. ffprobe needs the container index (for MP4 the `moov` atom may sit at the end of the file), and thumbnail extraction seeks to one timestamp. Neither needs the whole file. This determines the worker's disk/volume needs and its network usage. Depends on TD-07 and TD-08.

**Options:**

### Option A: Read through a short-lived presigned GET URL (HTTP range reads)
- The worker passes a presigned URL as the ffprobe/ffmpeg input; FFmpeg's HTTP protocol seeks with range requests (`seekable` auto-detected; `reconnect*` options for resilience).
- **Pros:** Reads only the bytes it needs (index + one frame region), not 10GB. No scratch disk/volume. Same path on MinIO and S3.
- **Cons:** Network failures surface as FFmpeg errors (needs reconnect flags + retries from TD-06). Pathological layouts (unindexed files) may cause many range requests.

### Option B: Download to a temporary file, then process locally
- Stream the object to worker scratch storage, run ffprobe/ffmpeg on the local file, then delete it.
- **Pros:** Simplest FFmpeg behavior (local seekable file). Easy to reason about and debug.
- **Cons:** Transfers the full 10GB per job before any work starts. Needs scratch space larger than the biggest upload (≥10GB per concurrent job).

**Recommendation:** **Option A (presigned GET with range reads)** — the phase only extracts metadata and one frame, so downloading up to 10GB per job is unnecessary. Range reads keep the worker container free of large scratch volumes. Option B is the fallback if real-world files show seek problems.

**Decision:** _[pending]_

---

## TD-10: Unique Video URL Identifier

**Scope:** Cross-layer

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** Every video needs a short, unique, never-conflicting identifier in its URL (see the plan's attention points: "URL curta e única"). It becomes part of the public contract (API routes, DB unique column, OpenAPI, future frontend routes and shared links). It should also be unguessable, because Phase 04 introduces unlisted videos ("somente via link"). Existing entities use UUID primary keys.

**Options:**

### Option A: Expose the UUID primary key
- The URL uses the `uuid` PK (36 chars).
- **Pros:** Zero extra code or column; unique and unguessable; consistent with existing entities.
- **Cons:** Long and not "curta". Ties public URLs to the internal PK.

### Option B: Random short public ID (base62/base64url, ~11 chars) in a unique column
- A `public_id` column with a unique index, generated from `node:crypto` random bytes (≈64 bits). On the (astronomically rare) unique violation, regenerate and retry. The UUID PK stays internal.
- **Pros:** Short, YouTube-like, unguessable (enough for unlisted links), separate from the PK. No dependency needed (note: `nanoid` 6 declares `node: ^22 || ^24 || >=26` — excludes Node 25 — and v5 is ESM-only).
- **Cons:** One extra column/index and a tiny generator with collision-retry logic to test.

### Option C: Sqids/Hashids encoding of a sequential number
- Encode an auto-increment integer into a short string.
- **Pros:** Short and collision-free by construction.
- **Cons:** Reversible and enumerable — Sqids explicitly says it is not for security, which breaks unlisted links. Needs a sequence alongside the UUID PK. `sqids` has not been published since 2023.

**Recommendation:** **Option B (random short public ID)** — it gives the short URL the plan asks for and the unguessability that Phase 04's unlisted links need. It also keeps the internal UUID PK convention untouched, using only `node:crypto` and a unique index.

**Decision:** _[pending]_

---

## TD-11: Video Delivery for Streaming and Download

**Scope:** Cross-layer

**Capability:** Transversal — covers: "Reprodução via streaming (sem necessidade de download completo)", "Download do vídeo pelo usuário"

**Context:** Playback must start without downloading the whole file, which requires HTTP Range / `206 Partial Content` support. Users must also be able to download the file. The architecture diagram shows the frontend streaming **from Object Storage**, and the strict BFF rule means anything served by the API would also cross the Next.js server. Adaptive streaming (HLS/DASH) is excluded: it requires transcoding, which is not a Phase 03 capability. Depends on TD-03 (private bucket) and TD-10 (identifier).

**Options:**

### Option A: API issues short-lived presigned GET URLs
- An API endpoint (resolved by public ID) authorizes the request and returns or redirects to a presigned `GetObject` URL. Storage serves Range/206 natively. Download uses the same mechanism with `ResponseContentDisposition: attachment; filename=...`.
- **Pros:** No video bytes go through the API or the BFF. Seeking works natively. Each request is authorized by the API, so Phase 04 draft/unlisted rules fit in. One mechanism covers streaming and download.
- **Cons:** URLs expire (the player must refresh after the TTL). A leaked URL works until it expires. The storage endpoint must be browser-reachable (same public-endpoint concern as TD-02).

### Option B: API proxy endpoint with Range support
- `GET /videos/:id/stream` parses `Range`, calls `GetObject` with that range and pipes it as `206` (`StreamableFile` + `Content-Range`/`Accept-Ranges`). Download is the same endpoint with `Content-Disposition: attachment`.
- **Pros:** Stable URLs; storage is never exposed to clients; full control over headers and access checks.
- **Cons:** All playback traffic goes through Nest **and** the Next.js BFF — the most expensive path for bandwidth and connections. Range parsing and edge cases (multi-range, 416) are ours to implement.

### Option C: Public-read objects served directly from storage/CDN
- Video objects are public-read; URLs are stable storage/CDN URLs built from the key.
- **Pros:** Simplest and most cache/CDN-friendly; native Range support.
- **Cons:** No access control: draft, failed and (Phase 04) unlisted videos are reachable by anyone with the key, and access cannot be revoked. Conflicts with the private bucket from TD-03 A.

**Recommendation:** **Option A (presigned GET URLs issued by the API)** — it matches the C4 diagram (frontend streams from storage) and keeps playback bytes off both servers. Range/206 comes from the storage itself, and the API stays the point where visibility rules are enforced. Download is the same endpoint with an `attachment` disposition.

**Decision:** _[pending]_

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Backend | Message queue technology | A (BullMQ on Redis via `@nestjs/bullmq` 11.x) | _[pending]_ |
| TD-02 | Cross-layer | Large-file upload protocol (10GB) | A (S3 multipart with presigned part URLs, direct to storage) | _[pending]_ |
| TD-03 | Backend | Object storage layout | A (single private bucket, per-video prefix) | _[pending]_ |
| TD-04 | Cross-layer | Draft pre-registration & upload-completion trigger | A (client-driven init/complete endpoints) | _[pending]_ |
| TD-05 | Cross-layer | Video status lifecycle model | B (publication `status` + `processing_status`) | _[pending]_ |
| TD-06 | Backend | Processing failure policy | A (bounded retries, then terminal `failed`, keep data) | _[pending]_ |
| TD-07 | Backend | Video worker runtime topology | A (same codebase, separate entrypoint + Compose service) | _[pending]_ |
| TD-08 | Backend | FFmpeg/ffprobe integration | A (system FFmpeg via apt + `child_process.spawn`) | _[pending]_ |
| TD-09 | Backend | Worker access to the source video | A (presigned GET with HTTP range reads) | _[pending]_ |
| TD-10 | Cross-layer | Unique video URL identifier | B (random short public ID, unique column) | _[pending]_ |
| TD-11 | Cross-layer | Video delivery for streaming & download | A (presigned GET URLs issued by the API) | _[pending]_ |
