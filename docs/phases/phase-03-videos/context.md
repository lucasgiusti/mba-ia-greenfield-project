---
kind: phase
name: phase-03-videos
sources_mtime:
  docs/project-plan.md: "2026-10-19T19:10:41-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-20T08:25:07-03:00"
  docs/phases/phase-01-configuracao-base/context.md: "2026-10-19T19:11:29-03:00"
  docs/phases/phase-02-auth/context.md: "2026-10-19T19:11:29-03:00"
  docs/phases/phase-02-auth-frontend/context.md: "2026-10-19T19:11:29-03:00"
  .claude/skills/testing-guide-nestjs-project/SKILL.md: "2026-10-19T19:10:41-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-10-19T19:11:29-03:00"
  docs/decisions/technical-decisions-next-frontend-config-base.md: "2026-10-19T19:11:29-03:00"
---

# phase-03-videos — Context

## Scope

**Phase name:** Fase 03 — Upload e Processamento de Vídeos

**Capabilities** (literal, `docs/project-plan.md`):

- Serviço de armazenamento de arquivos (vídeos e thumbnails)
- Serviço de processamento em segundo plano (filas)
- Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance
- Pré-cadastro automático do vídeo como rascunho ao iniciar o upload
- Processamento automático do vídeo após upload (extração de duração e metadados)
- Geração automática de thumbnail a partir de um frame do vídeo
- URL única por vídeo, sem conflito com outros vídeos
- Reprodução via streaming (sem necessidade de download completo)
- Download do vídeo pelo usuário

**Out of scope:** _Not specified._

**Deliverables:** upload de até 10GB funcional, processamento automático do vídeo, streaming funcionando, URLs únicas geradas.

**Affected subprojects:** `nestjs-project/` — no specific note

**Deferred subprojects:** _None._

**Sequencing notes:** Depende de: Fase 01, Fase 02. Intro: "Upload de arquivos grandes sem travar o sistema, processamento automático do vídeo e geração de URL única."

**Neighbors (for boundary detection only):**

- **Phase 02:** Cadastro, Login e Gerenciamento de Conta (depende de: Fase 01)
- **Phase 04:** Gerenciamento de Vídeos e Canal (depende de: Fase 02, Fase 03)

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| phase-03-videos/TD-01 | phase | Backend | Message Queue Technology | decided | A (BullMQ on Redis — `@nestjs/bullmq` + `bullmq`) | @nestjs/bullmq@^11.0.5, bullmq@^6, ioredis@>=5 |
|     └─ Last revision: 2026-10-19 — `complete` idempotency / lost-enqueue recovery: when the video is already… | | | | | | |
| phase-03-videos/TD-02 | phase | Cross-layer | Large-File Upload Protocol (up to 10GB) | decided | A (S3 multipart upload with presigned part URLs, direct to storage) | @aws-sdk/client-s3@^3.1153.0, @aws-sdk/s3-request-presigner@^3.1153.0 |
|     └─ Last revision: 2026-10-19 — The re-sign part numbering (1..ceil(declared size / part size)) uses the declared size… | | | | | | |
| phase-03-videos/TD-03 | phase | Backend | Object Storage Layout (buckets and object keys) | decided | A (Single private bucket, per-video prefix) | — |
|     └─ Last revision: 2026-10-19 — Bucket lifecycle: the Phase 03 bootstrap creates the bucket only. On MinIO the server's… | | | | | | |
| phase-03-videos/TD-04 | phase | Cross-layer | Draft Pre-registration and Upload-Completion Trigger | decided | A (Client-driven init/complete endpoints) | — |
|     └─ Last revision: 2026-10-20 — Incomplete parts list on `complete`: before calling `CompleteMultipartUpload`,… | | | | | | |
| phase-03-videos/TD-05 | phase | Cross-layer | Video Status Lifecycle Model | decided | A (Single linear `status` enum: `draft` → `processing` → `ready` \| `failed`) | — |
| phase-03-videos/TD-06 | phase | Backend | Processing Failure Policy | decided | A (Bounded automatic retries, then terminal `failed`, keep data) | — |
|     └─ Last revision: 2026-10-19 — `failed` videos are retained (row + source object) for diagnosis. Video… | | | | | | |
| phase-03-videos/TD-07 | phase | Backend | Video Worker Runtime Topology | decided | A (Same codebase, separate entrypoint and Compose service) | — |
| phase-03-videos/TD-08 | phase | Backend | FFmpeg / ffprobe Integration (binary source and invocation) | decided | A (System FFmpeg from the base image's package manager + `child_process.spawn`) | — |
|     └─ Last revision: 2026-10-19 — Persisted processing output: `duration_seconds` plus a `metadata` jsonb column… | | | | | | |
| phase-03-videos/TD-09 | phase | Backend | Worker Access to the Source Video | decided | A (Read through a short-lived presigned GET URL — HTTP range reads) | @aws-sdk/client-s3@^3.1153.0, @aws-sdk/s3-request-presigner@^3.1153.0 |
|     └─ Last revision: 2026-10-19 — The presigned GET handed to ffprobe/ffmpeg is signed with the internal storage… | | | | | | |
| phase-03-videos/TD-10 | phase | Cross-layer | Unique Video URL Identifier | decided | B (Random short public ID in a unique column) | — |
|     └─ Last revision: 2026-10-19 — `public_id` is the only external video identifier. It is generated at `init`… | | | | | | |
| phase-03-videos/TD-11 | phase | Cross-layer | Video Delivery for Streaming and Download | decided | A (API issues short-lived presigned GET URLs) | @aws-sdk/client-s3@^3.1153.0, @aws-sdk/s3-request-presigner@^3.1153.0 |
|     └─ Last revision: 2026-10-19 — The stream and download endpoints take the video's `public_id` as their route… | | | | | | |

_Source files:_

- phase-03-videos — `docs/decisions/technical-decisions-phase-03-videos.md` (scope_type: phase, related_phases: [3])

## Capability Coverage

| Capability (from project-plan.md) | Covered by |
|-----------------------------------|------------|
| Serviço de armazenamento de arquivos (vídeos e thumbnails) | phase-03-videos/TD-03 |
| Serviço de processamento em segundo plano (filas) | phase-03-videos/TD-01, phase-03-videos/TD-07 |
| Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance | phase-03-videos/TD-02 |
| Pré-cadastro automático do vídeo como rascunho ao iniciar o upload | phase-03-videos/TD-04, phase-03-videos/TD-05 |
| Processamento automático do vídeo após upload (extração de duração e metadados) | phase-03-videos/TD-04, phase-03-videos/TD-05, phase-03-videos/TD-06, phase-03-videos/TD-07, phase-03-videos/TD-08, phase-03-videos/TD-09 |
| Geração automática de thumbnail a partir de um frame do vídeo | phase-03-videos/TD-07, phase-03-videos/TD-08, phase-03-videos/TD-09 |
| URL única por vídeo, sem conflito com outros vídeos | phase-03-videos/TD-10 |
| Reprodução via streaming (sem necessidade de download completo) | phase-03-videos/TD-11 |
| Download do vídeo pelo usuário | phase-03-videos/TD-11 |

## Decisions Detail

### phase-03-videos/TD-01

**Recommendation:** it is the documented NestJS approach and covers retries, backoff, stalled detection and non-retryable errors with no custom code, which matters for 10GB jobs that can crash a worker mid-way. The one Redis container is a small cost. **Option B (pg-boss)** is a close second if avoiding new infrastructure matters more than framework integration: its transactional enqueue is a real advantage. Option D is not recommended yet because it is too new and has no Nest wiring.
**Libraries:** @nestjs/bullmq@^11.0.5, bullmq@^6, ioredis@>=5

**Revisions:**
- 2026-10-19 — Library pin fixed: `@nestjs/bullmq@^11.0.5` + `bullmq@^6`, plus `ioredis` installed explicitly. Rationale: only `@nestjs/bullmq@11.0.5` declares `bullmq ^6.0.0` in its peerDependencies (11.0.0–11.0.4 stop at `^5.0.0`) and `@nestjs/bullmq@12.x` is ESM-only (`"type": "module"`), incompatible with the CommonJS project; bullmq 6 made `ioredis` an optional peer dependency (`>=5.0.0`) that Redis users must install themselves (OQ-1).
- 2026-10-19 — The queue `jobId` and the job payload's video reference are the video's UUID primary key, not `public_id` (TD-10). Rationale: AMB-3 — internal identifiers for storage keys and job IDs, `public_id` only in the URL.
- 2026-10-19 — `complete` idempotency / lost-enqueue recovery: when the video is already `processing`, a repeated `complete` re-enqueues with the same `jobId`; BullMQ ignores an add whose `jobId` already exists, so a live job is not duplicated and a lost enqueue (DB committed, Redis call failed) is recovered. When the video is `ready` or `failed`, `complete` is a no-op/conflict per the error catalog (`phase-02-auth/TD-07`). Rationale: AMB-6.

### phase-03-videos/TD-02

**Recommendation:** it is the only option that keeps 10GB of traffic off both the NestJS API and the Next.js BFF while still being resumable. It also matches what `next-frontend-config-base/TD-03` already anticipated (video bytes use storage URLs, not the backend URL). The cost is a few small orchestration endpoints and a bucket CORS rule.
**Libraries:** @aws-sdk/client-s3@^3.1153.0, @aws-sdk/s3-request-presigner@^3.1153.0

**Revisions:**
- 2026-10-19 — Two S3 endpoints with an explicit env-key pair: the internal endpoint (`STORAGE_ENDPOINT`, e.g. `http://minio:9000`, the Compose service name) is used for every API server-side S3 call and by the worker, including the presigned GET handed to FFmpeg (signed with the internal host, TD-09); the public endpoint (`STORAGE_PUBLIC_ENDPOINT`, browser-reachable, e.g. `http://localhost:9000`) is used only to sign URLs returned to clients (upload part URLs here, playback/download URLs in TD-11). SigV4 covers the host, so each URL is signed by the client bound to the host that will fetch it. Rationale: IC-1 — a URL signed for the public host cannot be fetched from inside a container and vice versa.
- 2026-10-19 — Upload validation contract fixed: accepted MIME types `video/mp4`, `video/webm`, `video/quicktime`, `video/x-matroska`; maximum size 10 GiB (10737418240 bytes); part size 100 MiB (104857600 bytes, so at most 103 parts, well under the S3 limit of 10,000); presigned URL TTL 1h. Size limit, part size and TTL are configurable via env keys (Joi-validated in `env.validation.ts`) with these values as defaults. Rationale: AMB-1.
- 2026-10-19 — Endpoint surface: `init` (creates the draft row + the S3 multipart upload and returns the presigned part URLs), `complete` (receives the parts with their ETags, completes the multipart upload and starts processing) and `abort` (aborts the multipart upload). The multipart `upload_id` is persisted on the video row. No resume / `ListParts` / re-sign endpoint — not a phase capability. Rationale: AMB-2.
- 2026-10-19 — Resume endpoint added, replacing the "No resume / `ListParts` / re-sign endpoint" clause of the AMB-2 revision above. A re-sign endpoint accepts an existing `upload_id` of a `draft` video owned by the caller. It calls S3 `ListParts` (internal endpoint, paginated) and returns the parts already uploaded (part number + `ETag`) plus fresh presigned `UploadPart` URLs for the missing part numbers (1..ceil(declared size / part size), from the size declared at `init`). The URLs are signed for the public endpoint (`STORAGE_PUBLIC_ENDPOINT`) with the configured part-URL TTL (default 1h, env-configurable). A 10 GiB upload can therefore continue after a connection failure, a page reload or expired URLs without a new `init`. This meets `docs/project-plan.md` Pontos de Atenção ("permita retomar em caso de falha de conexão") and keeps the "while still being resumable" premise of the Recommendation. Out-of-state calls follow the TD-04 AMB-7 revision. Rationale: IC-3.
- 2026-10-19 — The re-sign part numbering (1..ceil(declared size / part size)) uses the declared size and the part size persisted on the `videos` row at `init` (TD-04 AMB-8 revision), not the current part-size env value, so a configuration change cannot renumber the parts of an open upload. Rationale: AMB-8.

### phase-03-videos/TD-03

**Recommendation:** the smallest setup that works across dev and prod. It keeps everything private by default, which leaves room for Phase 04 visibility rules (draft/unlisted). It lets the API and worker derive keys from the video ID. Splitting buckets can be added later without changing the video ID contract.
**Libraries:** —

**Revisions:**
- 2026-10-19 — `{videoId}` in the object keys (`videos/{videoId}/source`, `videos/{videoId}/thumbnail.jpg`) is the video's UUID primary key; `public_id` (TD-10) is never part of a storage key. Rationale: AMB-3.
- 2026-10-19 — Bucket lifecycle: the Phase 03 bootstrap creates the bucket only. On MinIO the server's default stale-upload expiry (24h) removes abandoned multipart uploads. The S3 `AbortIncompleteMultipartUpload` lifecycle rule for production is a production-deployment task of Fase 07 ("Ambiente de produção e deploy", `docs/project-plan.md`), out of scope for Phase 03 (TD-04 IC-5 revision). Rationale: IC-5.

### phase-03-videos/TD-04

**Recommendation:** with presigned multipart the client must call `CompleteMultipartUpload` anyway. Routing that call through the API gives one deterministic point to verify the object and enqueue, with identical behavior on MinIO and S3. A cleanup policy for drafts that never complete is still needed. It can reuse the queue's delayed/scheduled jobs and does not need to be a separate TD.
**Libraries:** —

**Revisions:**
- 2026-10-19 — Endpoint set is `init` / `complete` / `abort` (see TD-02); the multipart `upload_id` is persisted on the `videos` row; no resume / `ListParts` endpoint. Rationale: AMB-2.
- 2026-10-19 — Draft row contents: the video belongs to a channel (FK `channel_id`; the owner is the authenticated user's channel); `title` comes from the `init` body and defaults to the original filename; the UUID primary key is used for the queue `jobId` and the storage keys, `public_id` (TD-10) only for the unique URL. Rationale: AMB-3.
- 2026-10-19 — `complete` is idempotent: if the video is already `processing`, it re-enqueues with the same `jobId` (BullMQ dedup, TD-01), which recovers a lost enqueue; if it is `ready` or `failed`, it is a no-op/conflict per the error catalog. Rationale: AMB-6.
- 2026-10-19 — Cleanup policy for abandoned uploads: the client calls `abort`; otherwise MinIO's default stale incomplete-multipart expiry (24h) removes the parts. Abandoned draft rows stay as `draft`. A dedicated cleanup job is out of scope for Phase 03 and is recorded as a separate future task. Rationale: MD-1.
- 2026-10-19 — Endpoint set becomes `init` / re-sign / `complete` / `abort`, replacing the "no resume / `ListParts` endpoint" clause of the AMB-2 revision above. Re-sign (TD-02 IC-3 revision) works only on an existing `upload_id` of a `draft` video owned by the caller: it uses `ListParts` to return the uploaded parts (part number + `ETag`) and fresh public presigned URLs for the missing parts, and changes neither the row nor the queue. Rationale: IC-3.
- 2026-10-19 — Out-of-state and failed-check responses, one rule. This fixes the "no-op/conflict per the error catalog" wording of the AMB-6 revisions here and on TD-01. `complete` on a `processing` video is still the idempotent re-enqueue (AMB-6). Every other out-of-state call returns **409** with the single video-state domain code `INVALID_VIDEO_STATE` (`InvalidVideoStateException`, same naming style as `nestjs-project/src/common/exceptions/domain.exception.ts`) and has no side effect: no state change, no enqueue, no S3 mutation. These calls are `complete` on `ready`/`failed`, `abort` on a non-`draft` video, re-sign on a non-`draft` video, and `complete` (or re-sign) after the multipart upload was aborted or expired (S3 `NoSuchUpload`). A failed completion check returns **422** with the domain code `UPLOAD_VERIFICATION_FAILED` (`UploadVerificationFailedException`). The check fails when the `HeadObject` `ContentLength` is above the configured max size or differs from the size declared at `init`. On that failure the upload is discarded and the row stays `draft`. Implementation note for plan-build: `HeadObject` runs after `CompleteMultipartUpload`, so at that point "aborting the multipart upload" means deleting the assembled source object. A later `complete`/re-sign on that `upload_id` then gets `NoSuchUpload` → 409 `INVALID_VIDEO_STATE`. Both codes go into the plan's Error Catalog (`phase-02-auth/TD-07`). Rationale: AMB-7.
- 2026-10-19 — Scope of the abandoned-multipart expiry in the MD-1 revision: MinIO's default stale-upload expiry (24h, `MINIO_API_STALE_UPLOADS_EXPIRY`) is the policy for the Docker/MinIO environment of this phase. AWS S3 has no default expiry for incomplete multipart uploads. For production, an `AbortIncompleteMultipartUpload` bucket lifecycle rule is recorded as a production-deployment task that belongs to Fase 07 ("Ambiente de produção e deploy", `docs/project-plan.md`) and is out of scope for Phase 03. Until that rule exists, the "expired" branch (S3 `NoSuchUpload`) of the AMB-7 revision fires only on MinIO, which qualifies Option A's "Same behavior on MinIO and S3" Pro for abandoned uploads. Rationale: IC-5.
- 2026-10-19 — Upload parameters persisted at `init`: the `videos` row also stores the size declared at `init` (bigint, bytes) and the part size used at `init` (bytes). Re-sign computes the missing parts as 1..ceil(persisted declared size / persisted part size), and the 422 `UPLOAD_VERIFICATION_FAILED` check compares `HeadObject` `ContentLength` with the persisted declared size; neither reads the current config for an open upload (`init` already rejects a declared size above the configured max). Rationale: AMB-8.
- 2026-10-19 — Repeated `abort` is idempotent: `abort` on a `draft` video whose multipart upload is already gone (aborted earlier, expired, or discarded by a failed 422 check) ignores the S3 `NoSuchUpload` from `AbortMultipartUpload` and returns the same success response as the first `abort`; the row stays `draft`. `abort` on a non-`draft` video is still 409 `INVALID_VIDEO_STATE` (AMB-7 revision). Rationale: AMB-9.
- 2026-10-19 — Unknown or non-owned video: re-sign, `complete` and `abort` return **404** with the domain code `VIDEO_NOT_FOUND` (`VideoNotFoundException`, same naming style as `nestjs-project/src/common/exceptions/domain.exception.ts`) both when the video does not exist and when it belongs to another channel, so the response does not reveal that the video exists (consistent with TD-10's unguessable identifiers). The existence/ownership check runs before the state check, so a non-owner never sees a 409. The code goes into the plan's Error Catalog (`phase-02-auth/TD-07`); stream/download follow the same rule (TD-11). Rationale: AMB-10.
- 2026-10-19 — `complete` is retry-safe after a partial failure on a `draft` video. This refines the `NoSuchUpload` branch of the AMB-7 revision for `complete` only. If `CompleteMultipartUpload` returns S3 `NoSuchUpload` while the row is still `draft` (for example, the multipart upload was already completed but the following `HeadObject`, the transition to `processing` or the response failed), `complete` runs `HeadObject` on the source key `videos/{videoId}/source` (TD-03). If the object exists, `complete` continues with the normal completion check. It returns 422 `UPLOAD_VERIFICATION_FAILED`, discards the object and leaves the row `draft` when `ContentLength` is above the configured max or differs from the persisted declared size (AMB-7/AMB-8 revisions). Otherwise it moves the row to `processing` and enqueues with `jobId` = the video UUID (AMB-3/AMB-6 revisions). If the object does not exist (upload aborted, expired, or discarded by an earlier failed 422 check), the response stays 409 `INVALID_VIDEO_STATE` with no side effect. If the storage instead answers a repeated `CompleteMultipartUpload` with success, the normal path applies unchanged. Re-sign after `NoSuchUpload` is unchanged (409 `INVALID_VIDEO_STATE`). Rationale: AMB-11.
- 2026-10-19 — External video identifier: the "video ID" that `init` returns and that re-sign, `complete` and `abort` take as their route param is the video's `public_id` (TD-10 AMB-12 revision), never the UUID primary key. The API resolves `public_id` → row (unique index) and then applies the AMB-10 existence/ownership check (404 `VIDEO_NOT_FOUND`). The UUID stays internal: storage keys (TD-03), queue `jobId` (TD-01) and FKs. Rationale: AMB-12.
- 2026-10-20 — `abort` on a `draft` video also discards an already assembled source object. This refines the AMB-9 revision. After `AbortMultipartUpload` (whose S3 `NoSuchUpload` is still ignored), `abort` runs `DeleteObject` on the source key `videos/{videoId}/source` (TD-03). S3 `DeleteObject` succeeds on a missing key, so repeated `abort` stays idempotent and returns the same success response; the row stays `draft`. This covers the state reachable through the AMB-11 revision (multipart upload already completed, row still `draft`): after a successful `abort`, a later `complete` gets `NoSuchUpload`, `HeadObject` finds no object, and the response is 409 `INVALID_VIDEO_STATE` with no side effect. `abort` on a non-`draft` video is still 409 `INVALID_VIDEO_STATE`. Rationale: IC-6.
- 2026-10-20 — The 422 `UPLOAD_VERIFICATION_FAILED` completion check has one condition: `HeadObject` `ContentLength` differs from the size persisted at `init` (AMB-8 revision). The configured max size is enforced only at `init`, which rejects a larger declared size, and is not re-read at `complete`. This replaces the "above the configured max size or" clause in the AMB-7 and AMB-11 revisions, so a config change between `init` and `complete` cannot fail an open upload. Rationale: IC-7 (auto-resolved per the user's standing instruction: the simplest option, consistent with AMB-8 and the existing `library-refs.md` snippet).
- 2026-10-20 — Rejected parts list on `complete`: when `CompleteMultipartUpload` fails with S3 `InvalidPart` (wrong or missing ETag, part not uploaded), `InvalidPartOrder` or `EntityTooSmall` (a non-last part below the 5 MiB S3 minimum), `complete` returns **422** with the domain code `INVALID_UPLOAD_PARTS` (`InvalidUploadPartsException`, same naming style as `nestjs-project/src/common/exceptions/domain.exception.ts`) and has no side effect. The multipart upload stays open, the row stays `draft`, and nothing is enqueued, so the client can call re-sign (which returns the uploaded parts with their `ETag`s, IC-3 revision) and retry `complete`. This is distinct from 422 `UPLOAD_VERIFICATION_FAILED`, which discards the assembled object. The code goes into the plan's Error Catalog (`phase-02-auth/TD-07`). Rationale: AMB-13 (auto-resolved per the user's standing instruction: the simplest option that keeps the AMB-2 request body and the IC-3 resume path).
- 2026-10-20 — Incomplete parts list on `complete`: before calling `CompleteMultipartUpload`, `complete` checks that the submitted part numbers are exactly 1..ceil(persisted declared size / persisted part size) (AMB-8 revision), each listed once. Otherwise it returns 422 `INVALID_UPLOAD_PARTS` with no side effect, as in the AMB-13 revision: the upload stays open, the row stays `draft`, and the client can re-sign and retry. This is needed because S3/MinIO accept a valid subset of parts and would assemble a smaller object that the IC-7 size check then discards. Rationale: AMB-14 (auto-resolved per the user's standing instruction: the option consistent with the AMB-13 intent and the IC-3 resume path).

### phase-03-videos/TD-05

**Recommendation:** the plan already treats "rascunho → publicação" as its own Phase 04 flow. Keeping draft/publish separate from upload/processing avoids redefining an enum (and migrating data) one phase later. Option A is acceptable if the team prefers literal simplicity now and accepts that Phase 04 will have to revisit the enum.
**Note:** Decision deliberately diverged from the Recommendation (Option B) — the single linear enum was chosen for literal adherence to the challenge acceptance criterion "rascunho → processando → pronto/erro". The cost already named in the Recommendation is accepted: Phase 04 will have to revisit the enum when publication is introduced.
**Libraries:** —

### phase-03-videos/TD-06

**Recommendation:** it uses the queue's built-in backoff and non-retryable error support (TD-01) and keeps the failure visible in the status model (TD-05). Storage cost stays bounded because only failed videos are kept, and they remain deletable.
**Libraries:** —

**Revisions:**
- 2026-10-19 — `failed` videos are retained (row + source object) for diagnosis. Video deletion is not part of the project plan's Phase 03 and is not introduced here, so the "they remain deletable" justification no longer applies; retention of failed videos is accepted. Rationale: DG-2.

### phase-03-videos/TD-07

**Recommendation:** it is the topology shown in the architecture diagram. It isolates FFmpeg load from the API and keeps one source of truth for entities and config. The only extra cost is a Compose service.
**Libraries:** —

### phase-03-videos/TD-08

**Recommendation:** with the only maintained high-level wrapper gone, both options need a spawn wrapper anyway. The distro package is the better-maintained binary source, and the worker already needs its own image setup (TD-07).
**Libraries:** —

**Revisions:**
- 2026-10-19 — Persisted processing output: `duration_seconds` plus a `metadata` jsonb column holding width, height, video codec, container format, bitrate and size (from ffprobe). Thumbnail rule: JPEG of the frame at 10% of the duration, scaled to width 640 (stored as `videos/{videoId}/thumbnail.jpg`, TD-03). Rationale: AMB-4.

### phase-03-videos/TD-09

**Recommendation:** the phase only extracts metadata and one frame, so downloading up to 10GB per job is unnecessary. Range reads keep the worker container free of large scratch volumes. Option B is the fallback if real-world files show seek problems.
**Libraries:** @aws-sdk/client-s3@^3.1153.0, @aws-sdk/s3-request-presigner@^3.1153.0

**Revisions:**
- 2026-10-19 — The presigned GET handed to ffprobe/ffmpeg is signed with the internal storage endpoint (`STORAGE_ENDPOINT`, e.g. `http://minio:9000`), never with the public one. Rationale: IC-1 — inside the `video-worker` container `localhost` is the container itself.

### phase-03-videos/TD-10

**Recommendation:** it gives the short URL the plan asks for and the unguessability that Phase 04's unlisted links need. It also keeps the internal UUID PK convention untouched, using only `node:crypto` and a unique index.
**Libraries:** —

**Revisions:**
- 2026-10-19 — `public_id` is used only for the unique video URL; the UUID primary key stays the internal identifier for the queue `jobId` (TD-01) and the storage keys (TD-03). Rationale: AMB-3.
- 2026-10-19 — `public_id` is the only external video identifier. It is generated at `init` and used in every video route param (re-sign, `complete`, `abort`, stream, download) and in every response that identifies a video, including the `init` response. The UUID primary key never leaves the API; it is used only internally for storage keys (TD-03), the queue `jobId` (TD-01) and foreign keys. This clarifies the AMB-3 revision above: "only for the unique URL" means `public_id` is never used as an internal key, not that the API exposes the UUID. Rationale: AMB-12.

### phase-03-videos/TD-11

**Recommendation:** it matches the C4 diagram (frontend streams from storage) and keeps playback bytes off both servers. Range/206 comes from the storage itself, and the API stays the point where visibility rules are enforced. Download is the same endpoint with an `attachment` disposition.
**Libraries:** @aws-sdk/client-s3@^3.1153.0, @aws-sdk/s3-request-presigner@^3.1153.0

**Revisions:**
- 2026-10-19 — Playback/download URLs are signed with the public storage endpoint (`STORAGE_PUBLIC_ENDPOINT`, browser-reachable), distinct from the internal endpoint used server-side (TD-02). Rationale: IC-1.
- 2026-10-19 — Access rules for Phase 03: stream and download are owner-only (authenticated user whose channel owns the video), because every video is still a draft; public access arrives with publication in a later phase. Only `ready` videos are servable. The endpoint returns the presigned GET URL (TTL 1h) in a JSON body — no redirect, which would make the BFF's `fetch` follow a 302 and pull the bytes through Next.js. The download URL is signed with `ResponseContentDisposition: attachment`. Rationale: AMB-5.
- 2026-10-19 — Stream and download return **404** `VIDEO_NOT_FOUND` (`VideoNotFoundException`, TD-04 AMB-10 revision) both for an unknown video and for a video owned by another channel; existence is not revealed (TD-10). The existence/ownership check runs before the `ready` check. Rationale: AMB-10.
- 2026-10-19 — The stream and download endpoints take the video's `public_id` as their route param (TD-10 AMB-12 revision), matching Option A's "resolved by public ID"; the UUID primary key is never accepted or returned. Rationale: AMB-12.

## Inherited Decisions Detail

### phase-01-configuracao-base/TD-01

**Recommendation:** Option A (@nestjs/config) — Official, core-team-maintained, guaranteed NestJS 11 compatibility. The `registerAs()` factory pattern solves the TypeORM CLI sharing problem: the factory function can be imported as a plain function by `data-source.ts` while also serving as a DI injection token inside NestJS. Building a custom module recreates solved functionality; third-party packages carry maintenance risk.
**Libraries:** `@nestjs/config@^4.x`

### phase-01-configuracao-base/TD-02

**Recommendation:** Option A (Joi) — First-class integration with `@nestjs/config` via `validationSchema`, requiring zero custom wiring. Handles string-to-number coercion natively. Using a different tool for env validation vs. request validation is reasonable — env config is validated once at startup, DTOs are validated per-request. Zod is elegant but adds a third validation paradigm to the project.
**Libraries:** `joi@^17.x`

### phase-01-configuracao-base/TD-03

**Recommendation:** Option B (Namespaced/grouped with registerAs) — The project roadmap explicitly calls for auth, email, and storage in upcoming phases. Namespaced configs provide clear file boundaries per domain, typed injection via `ConfigType<typeof databaseConfig>`, and natural scalability. The `registerAs()` factory is dual-purpose: DI token inside NestJS and plain importable function for `data-source.ts`. Initial files for Phase 01: `src/config/database.config.ts`, `src/config/app.config.ts`.
**Libraries:** —

### phase-01-configuracao-base/TD-04

**Recommendation:** Option A (Shared registerAs factory) — Natural outcome of choosing `@nestjs/config` with `registerAs`. The factory is already callable by design. `data-source.ts` imports it, calls `dotenv.config()`, then calls the factory. Zero duplication, minimal code, no extra abstraction.
**Libraries:** `dotenv` (transitive via `@nestjs/config`)

### phase-02-auth/TD-01

**Recommendation:** Argon2id — For a greenfield project in 2026, Argon2id is the OWASP-recommended choice. The native build dependency is a one-time Docker setup cost. The project has no legacy constraints favoring bcrypt. OWASP minimum: 19MiB memory, 2 iterations.
**Libraries:** `argon2@^0.41.x`

### phase-02-auth/TD-02

**Recommendation:** Option A (@nestjs/passport) — The project plan includes only email/password auth for now, but the plugin architecture costs little and future phases may add social login. Aligns with official NestJS docs, making onboarding and maintenance easier.
**Note:** Decision deliberately diverged from the Recommendation during implementation — custom guards were preferred over `@nestjs/passport` to keep the dependency surface smaller; social login is not on the near-term roadmap, so the plugin-architecture benefit did not justify the extra abstraction layer.
**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-03

**Recommendation:** Option A (Refresh Token Rotation) — Provides the strongest security model with automatic theft detection. The DB write overhead is acceptable for a video platform (auth refresh is infrequent vs. video operations). PostgreSQL is already in the stack, so no new infrastructure needed. Race conditions can be mitigated with a short grace period for the old token.
**Libraries:** —

### phase-02-auth/TD-04

**Recommendation:** Option B (Random Opaque Tokens in DB) — Revocability is important: when a user requests a new password reset, previous tokens should be invalidated. The DB table is trivial to implement, and the tokens table can also serve future needs (e.g., API keys). Keeps email tokens decoupled from the JWT auth system.
**Libraries:** —

### phase-02-auth/TD-05

**Recommendation:** Option A (@nestjs-modules/mailer) — Best NestJS integration with minimal boilerplate. Supports SMTP (matching the architecture diagram), works with MailHog/Mailpit for local development without external dependencies, and scales to any SMTP provider in production. Template engine support (Handlebars) simplifies email formatting. No vendor lock-in.
**Libraries:** `@nestjs-modules/mailer@^2.x`, `handlebars@^4.x`

### phase-02-auth/TD-06

**Recommendation:** Option A (class-validator + class-transformer) — This is a backend-only project (no shared schemas with frontend), so Zod's single-source-of-truth advantage is less impactful. class-validator is the documented NestJS approach, and the project already uses decorators extensively (TypeORM entities, NestJS DI). Fewer integration surprises with NestJS 11.
**Libraries:** `class-validator@^0.14.x`, `class-transformer@^0.5.x`

### phase-02-auth/TD-07

**Recommendation:** Option A (Custom Domain Exception Filter) — Provides machine-readable error codes that the Next.js frontend can switch on, without the overhead of RFC 9457's URI-based type system. The project is single-consumer (first-party frontend), so a simple `{ statusCode, error, message }` format with domain codes balances clarity and simplicity. The custom filter cost is low — two small files.
**Libraries:** —

### phase-02-auth/TD-08

**Recommendation:** Option A (@nestjs/throttler) — Native NestJS integration is decisive: the guard system allows scoping rate limiting to `AuthModule` only via module-level `APP_GUARD`, with `@SkipThrottle()` for exemptions. The project is single-instance with no distributed requirements, so in-memory storage is sufficient. Using express-rate-limit would bypass NestJS's DI and guard lifecycle for no clear benefit.
**Libraries:** `@nestjs/throttler@^6.x`

### phase-02-auth/TD-09

**Recommendation:** Option B (Opaque) — Since DB lookup is mandatory (TD-03), JWT signature adds no security value. Opaque tokens are shorter, leak no data, and are simpler to generate.
**Note:** Decision deliberately diverged from the Recommendation — JWT was kept to reuse the access-token signing/verification infrastructure (`@nestjs/jwt`), trading token size and base64-readability for a single token format across the codebase.
**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-10

**Recommendation:** Option A — The platform is a video sharing service with URL-based channel handles. A strict `[a-z0-9_]` allowlist is the simplest and most portable choice: no extra dependencies, no edge cases around hyphen positioning, and the `user_<random>` fallback provides a valid handle even for extreme email prefixes. Hyphens can always be added in a future iteration if user feedback justifies it.
**Libraries:** —

### phase-02-auth-frontend/TD-01

**Recommendation:** Three reasons. (1) **Architectural fit.** The strict-BFF model in `next-frontend-config-base/TD-03` already nominates the Route Handler as the only NestJS caller; cookie-based sessions are the natural match, and Auth.js's framework adds layers between the BFF and the cookie that buy nothing because the backend is the auth authority — Auth.js's value (DB adapters, OAuth providers, magic-link, `getServerSession` helpers) is mostly unused in this configuration. (2) **Smaller blast radius.** A ~50-LOC session helper is grep-friendly, debuggable, and test-friendly via the existing MSW+BFF integration test pattern; a misconfigured Auth.js callback is a longer fault-isolation loop. (3) **Compatibility with Next.js 16 / React 19.** Built-in `next/headers` `cookies()` is the canonical primitive both runtimes already use; Auth.js v5 versions track Next.js majors with a lag, adding compatibility risk that Option A does not have. Option C is rejected as unsafe (`localStorage` for refresh tokens) and architecturally regressive (loses RSC personalization).
**Libraries:** —

### phase-02-auth-frontend/TD-02

**Recommendation:** Three reasons. (1) **Defense in depth on the cookie content** — `httpOnly` blocks JS, encryption blocks accidental log/proxy inspection; the marginal cost is one ~3KB dep. (2) **Single cookie to manage** simplifies logout (one `session.destroy()` call) and avoids the orphan-cookie failure mode of Option A. (3) **Room to carry minimal user metadata** (`userId`, `email`, `channelSlug`) lets `app/layout.tsx` RSC render the authenticated chrome (avatar, channel name) without a per-render `/auth/me` round-trip — Phase 04+ gains compound here. Option A is a viable downgrade if the team rejects `iron-session` for any reason; the migration A→B (or B→A) is a one-Route-Handler refactor with no test changes downstream because the BFF interface is unchanged. Option C is rejected: it solves a problem (server-side revocation) the project does not have at the cost of infrastructure the project does not own.
**Libraries:** iron-session

### phase-02-auth-frontend/TD-03

**Recommendation:** The single-flight detail is non-trivial and goes in the helper from day one — tested by MSW with a "two concurrent intercepted upstream calls; one refresh expected" assertion. Option B's client-driven pattern is rejected because it doesn't replace Option A (RSC still needs server-side refresh) — adopting B means doing both. Option C's pre-emptive timer is rejected because the failure modes (multiple tabs, sleep/wake) outweigh the latency saving and force a `"use client"` shell near the root.
**Libraries:** —

### phase-02-auth-frontend/TD-04

**Recommendation:** Three reasons. (1) **Decoupled from TD-05** — works with Route Handlers OR Server Actions; the form code does not change if TD-05 is revisited later. (2) **Aligned with shadcn's canonical form primitive** — the project already commits to `radix-nova` shadcn (`components.json`); `npx shadcn@latest add form` produces react-hook-form wrappers; choosing react-hook-form means using the supported primitive instead of hand-rolling around it. (3) **Zod-first developer ergonomics match the rest of the FE foundation** — `next-frontend-config-base/TD-01` chose Zod 4 for env; the same schemas-as-source-of-truth pattern carries to forms with zero new validator paradigm. Option B is rejected for impedance with shadcn's primitive and for over-investing in progressive-enhancement that the strict-BFF model does not require. Option C is rejected for the per-field boilerplate and the loss of client-side feedback on a project that values quick, type-safe form iteration.
**Libraries:** react-hook-form, @hookform/resolvers

### phase-02-auth-frontend/TD-05

**Recommendation:** Three reasons. (1) **Strict-BFF alignment.** `next-frontend-config-base/TD-03` named Route Handlers as the BFF surface; Option A keeps every mutation visible under `app/api/**`. (2) **Test scaffold already exists** — `next-frontend/CLAUDE.md` § Testing and `next-frontend-msw-foundation` were authored for Route-Handlers-as-functions; Option A reuses them with zero invention. (3) **Single mutation surface** — Phase 02 sets the precedent for Phases 03–07; uniformity beats per-mutation idiom-picking when the cost of inconsistency compounds (Option C). Option B has real ergonomic appeal for the simplest forms but fragments the BFF surface and forces test-pattern reinvention; if the team later wants progressive enhancement for specific forms, the migration A→B is per-form and doesn't require touching unrelated routes — A is the safer default and the cheaper baseline.
**Libraries:** —

### phase-02-auth-frontend/TD-06

**Recommendation:** Two reinforcing reasons. (1) **No first-render flicker, no round-trip** — the session is delivered in the same response as the page HTML; the Client Provider hydrates with the correct initial state; users never see "Login" briefly turn into their avatar. (2) **No new BFF endpoint** — the cookie is the source of truth, RSC reads it, the Provider broadcasts it; the BFF surface stays minimal. The `router.refresh()` requirement after mid-session mutations is a small price (one line in the relevant mutation handler) for the structural benefits. Option B is rejected for the double-read-and-flicker; Option C is dominated by Option B and rejected.
**Libraries:** —

### phase-02-auth-frontend/TD-07

**Recommendation:** Three reasons. (1) **First-paint-correct** — the user sees the right outcome on the first paint, no skeleton, no flicker. (2) **Single integration pattern across both flows** — confirmation is RSC-only; reset is RSC + Client form (TD-04, TD-05 patterns reused) — both share the "RSC owns the token, Client Component owns the input" split. (3) **Email-prefetch behavior** is solved at the backend's idempotent-confirmation level (a small note for `/plan-build` to confirm; not a separate TD). Option B's Route-Handler-as-link-target adds redirects for no clean gain. Option C is dominated.
**Libraries:** —

### openapi-docs-nestjs/TD-01

**Recommendation:** **Option A (`@nestjs/swagger`)** — é a única opção que preserva as decisões anteriores (`class-validator` em TD-06 de phase-02-auth) sem re-platform; o CLI plugin com `classValidatorShim: true` aproveita os decoradores `class-validator` existentes para inferir schemas, mantendo o boilerplate baixo. Nestia tem mérito técnico real mas o custo de migração do stack de validação inviabiliza-a sem uma decisão upstream de supersede de TD-06. Manual authoring é descartado.
**Libraries:** @nestjs/swagger
**Revisions:**

- 2026-05-12 — Esclarece que o CLI plugin (`classValidatorShim: true`) cobre apenas inferência de schemas de DTOs a partir de `class-validator`; documentação de operações, respostas tipadas por status code, contratos de erro (alinhados ao envelope de phase-02-auth/TD-07) e exemplos exigem decoradores explícitos (`@ApiOperation`, `@ApiResponse`, `@ApiBody`, `@ApiParam`, `@ApiQuery`, `@ApiExtraModels`). _Rationale:_ openapi.json gerado pelo bootstrap atual está genérico — sem detalhes de parâmetros, schemas de retorno por status, nem contratos de erro — porque a base instalada se apoiou só na introspecção automática. Esta revisão fixa que enriquecimento via decoradores explícitos faz parte da Option A escolhida, não é trabalho fora do escopo do TD.

### openapi-docs-nestjs/TD-02

**Recommendation:** **Option C (Ambos)** — o custo marginal sobre Option A é apenas um npm script (~15 linhas) e o benefício é uma fundação correta para futura integração FE (codegen offline) sem perder a UI interativa que dev/QA usam. Option B sozinho pune a experiência de desenvolvimento em dev/local; Option A sozinho compromete o pipeline de codegen futuro. Combinar é dominante.
**Libraries:** —

### openapi-docs-nestjs/TD-03

**Recommendation:** **Option B (Apenas em dev/staging)** — alinha com a postura defensiva já estabelecida em phase 02 e não compromete consumidores legítimos (o `openapi.json` commitado em TD-02 cumpre o papel de "spec consultável fora da UI"). Re-abrir como Option A ou C é trivial no futuro se um caso de uso de API pública aparecer.
**Libraries:** —

### next-frontend-config-base/TD-01

**Recommendation:** Three converging reasons: (1) **Type-inference matches the FE's strict-TS culture** — `lib/env.ts` exports a typed `env` object with no `as` casts, satisfying the project's "Type Safety" working principle. (2) **Ecosystem gravity in Next.js / React 19** — Zod is the de-facto schema language for App Router (Server Actions inputs, form resolvers, future contract validation), so introducing it once at the env layer compounds value for forms in Phase 02+. (3) **Direct enablement of TD-02 Option A (`@t3-oss/env-nextjs`)** — t3-env's first-citizen validator. Backend parity with Joi is not load-bearing: env schemas are not shared FE↔BE (different runtimes, different key sets); two validators across two subprojects is a bounded cost.
**Libraries:** zod

### next-frontend-config-base/TD-02

**Recommendation:** The only option that combines (i) **type-level NEXT_PUBLIC_ prefix enforcement**, (ii) **runtime Proxy-based leak detection**, and (iii) **single-file, single-import-path consumer ergonomics**. Option B reaches roughly the same _structural_ outcome at higher implementation and maintenance cost, with a weaker guarantee (no prefix enforcement, no proxy). Option C is unsafe at any non-trivial team size. The marginal cost over B is one ~3KB dep — well-spent for the strongest boundary among the three.
**Libraries:** @t3-oss/env-nextjs

### next-frontend-config-base/TD-03

**Recommendation:** **Strict BFF — single server-only `API_URL`**. Aligned with the BFF testing strategy and architectural commitment already documented in `next-frontend/CLAUDE.md` (Route Handlers as the only NestJS caller; BFF tests stub `fetch` via MSW). Eliminates CORS, eliminates public exposure of the backend URL, and produces the smallest correct foundation. Option B's `NEXT_PUBLIC_API_URL` is a future-proofing concession with no current consumer — and adding a public key later is a non-breaking change, while removing one is breaking. Option C ties a foundational decision to infra work explicitly deferred elsewhere. The Docker networking gap (how server-in-container resolves the backend) is a separate orthogonal decision, surfaced below.
**Libraries:** —

## Inherited Conventions

- Backend config uses `@nestjs/config` with namespaced `registerAs(name, () => ({...}))` factories — one file per domain in `src/config/`. _(from phase 01)_
- Env variables are validated by a Joi schema in `src/config/env.validation.ts`, passed to `ConfigModule.forRoot({ validationSchema, validationOptions: { allowUnknown: true, abortEarly: false } })`. _(from phase 01)_
- Config is injected into modules via `ConfigType<typeof xxxConfig>` and `@Inject(xxxConfig.KEY)`; the same factory is importable as a plain function for non-DI contexts (e.g., TypeORM CLI). _(from phase 01)_
- `data-source.ts` loads `.env` via `import 'dotenv/config'` at the top, then imports `databaseConfig` and calls it as a plain function. _(from phase 01)_
- Database connection parameters (host, port, etc.) are sourced from a single `databaseConfig` factory — never duplicated between `AppModule` and `data-source.ts`. _(from phase 01)_
- `TypeOrmModule.forRootAsync` is used (not `forRoot`), with `imports: [ConfigModule]`, `inject: [databaseConfig.KEY]`, `useFactory` returning options including `autoLoadEntities: true`, `synchronize: false`. _(from phase 01)_

## Inherited Deferred Capabilities

| Capability | Status | Origin phase | Rationale |
|-----------|--------|--------------|-----------|
| Telas de frontend | deferred | phase-01-configuracao-base | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| Telas de cadastro, login, confirmação de conta e recuperação de senha | deferred | phase-02-auth | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| "Confirmação de conta via e-mail com link de ativação" | deferred | phase-02-auth-frontend | deferred_to_next_phase — UI landing screen de-scoped 2026-05-14; FE confirmation flow (TD-07) picked up by a future phase. BE side unchanged in `phase-02-auth`. |
| "Logout" | deferred | phase-02-auth-frontend | deferred_to_next_phase — logout button lives inside authenticated chrome (typically Phase 04). Phase 02 still implements POST `/api/auth/logout` (BFF route handler + `session.destroy()`) so the contract is ready when the chrome lands. |
| "Recuperação de senha (destination screen / set-new-password)" | deferred | phase-02-auth-frontend | deferred_to_next_phase — `/forgot-password` ships this phase sending the e-mail; the reset-password destination screen is absent from Figma → link destination remains a 404 until a later phase delivers the screen via `/screen-inventory` extension run. Documented as a known gap. |
| "Telas de cadastro, login, confirmação de conta e recuperação de senha" | deferred | phase-02-auth-frontend | a tela de confirmação da conta não será implementada nesta fase corrente, será adiada — the umbrella bullet's full coverage requires the confirmação and reset-password destination screens; both are deferred per Non-UI rows above. The 3 ship-this-phase telas (signup, login, forgot-password) are inventoried and covered by their own verbs; the umbrella bullet itself is deferred to the phase that lands the missing screens. |

## UI Inventory

_No screen inventory — UI↔API sync deferred. Run /screen-inventory 3 and then rerun /plan-context phase-03-videos to activate UI checks._

## Non-UI / Deferred Capabilities

_None._

## Testing Requirements

### nestjs-project

_(from `testing-guide-nestjs-project` Skill — § 3 Feature Implementation Checklist)_

| Artifact type | Required layers |
|---------------|-----------------|
| Entity (`*.entity.ts`) | Integration: constraints, defaults, `select: false` |
| Service with branching + DB | Unit: branch logic (mock repo) + Integration: DB contract |
| Service with DB only (no branching) | Integration: DB contract |
| Service with configured lib (JWT, cache) | Unit: real lib with test config |
| Service with side-effect dep (email, storage) | Integration: real capture service (Mailpit) or local adapter |
| Module with configured imports | Unit: compilation test |
| Controller | E2E only — do NOT write unit tests |
| DTO | E2E: one validation wiring test per endpoint |
| Guard (delegates to service for business logic) | E2E + Unit if complex internal logic |
| Guard (simple, delegates to Passport) | E2E only |
| Strategy (Passport) | E2E via guard |
| Pipe (custom transformation/validation) | Unit |
| Interceptor (response transform, logging) | Unit and/or E2E |
| Exception Filter | Unit + E2E |
| Middleware | E2E |

_(from `testing-guide-nestjs-project` Skill — `artifacts/future-types.md` § Queue Consumers / Processors)_

| Artifact type | Required layers |
|---------------|-----------------|
| Queue processor with business logic | Unit (mock deps) + Integration (real DB/storage) |
| Queue processor with only external system calls | Integration (real systems) |
