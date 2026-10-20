---
kind: phase
name: phase-03-videos
status: clean
issue_count: 0
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-10-20T08:25:07-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-20T08:25:07-03:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-10-20T08:25:07-03:00"
issues:
  - id: AMB-14
    status: resolved
    summary: "complete with a subset of parts: S3 accepts, size check then discards the upload"
    resolved_by: phase-03-videos/TD-04
  - id: AMB-13
    status: resolved
    summary: "complete: response undefined when S3 rejects the client parts list (InvalidPart etc.)"
    resolved_by: phase-03-videos/TD-04
  - id: IC-7
    status: resolved
    summary: "422 completion check: AMB-11 re-reads configured max; AMB-8 uses declared size only"
    resolved_by: phase-03-videos/TD-04
  - id: IC-6
    status: resolved
    summary: "abort succeeds on a draft whose upload was already completed; complete still works"
    resolved_by: phase-03-videos/TD-04
  - id: AMB-12
    status: resolved
    summary: "Identifier in external routes/responses undefined: UUID vs public_id"
    resolved_by: phase-03-videos/TD-10
  - id: AMB-11
    status: resolved
    summary: "complete retry after CompleteMultipartUpload succeeded but row still draft: stuck"
    resolved_by: phase-03-videos/TD-04
  - id: IC-4
    status: resolved
    summary: "MinIO server healthcheck impossible: shell-less image, mc/probe tool absent"
    resolved_by: clarification
  - id: IC-5
    status: resolved
    summary: "Abandoned-upload expiry relies on MinIO 24h default; S3 (prod) has none"
    resolved_by: phase-03-videos/TD-04
  - id: AMB-8
    status: resolved
    summary: "Re-sign and 422 check need declared size/part size, absent from draft row"
    resolved_by: phase-03-videos/TD-04
  - id: AMB-9
    status: resolved
    summary: "abort on a draft whose upload is already aborted/expired: response undefined"
    resolved_by: phase-03-videos/TD-04
  - id: AMB-10
    status: resolved
    summary: "Response for unknown or non-owned video on upload/stream endpoints undefined"
    resolved_by: phase-03-videos/TD-04
  - id: IC-3
    status: resolved
    summary: "TD-02 chosen as resumable; revisions drop re-sign/resume, fix 1h part-URL TTL"
    resolved_by: phase-03-videos/TD-02
  - id: AMB-7
    status: resolved
    summary: "complete/abort responses out of state or on failed check undefined"
    resolved_by: phase-03-videos/TD-04
  - id: IC-1
    status: resolved
    summary: "Presigned URLs signed with browser host (TD-02) are unreachable from worker (TD-09)"
    resolved_by: phase-03-videos/TD-02
  - id: IC-2
    status: resolved
    summary: "TD-02/TD-11 build on next-frontend-config-base/TD-03, absent from context.md"
    resolved_by: clarification
  - id: AMB-1
    status: resolved
    summary: "Upload validation contract undefined: formats, 10GB unit, part size, URL TTL"
    resolved_by: phase-03-videos/TD-02
  - id: AMB-2
    status: resolved
    summary: "Resumable-upload endpoint surface unclear (init/complete vs re-sign/ListParts)"
    resolved_by: phase-03-videos/TD-04
  - id: AMB-3
    status: resolved
    summary: "Draft video record contents, ownership FK and internal-ID usage unspecified"
    resolved_by: phase-03-videos/TD-04
  - id: AMB-4
    status: resolved
    summary: "Metadata fields to persist and thumbnail frame/format rules unspecified"
    resolved_by: phase-03-videos/TD-08
  - id: AMB-5
    status: resolved
    summary: "Streaming/download access rules, servable states and return-vs-redirect undefined"
    resolved_by: phase-03-videos/TD-11
  - id: AMB-6
    status: resolved
    summary: "complete endpoint idempotency and lost-enqueue recovery undefined"
    resolved_by: phase-03-videos/TD-04
  - id: MD-1
    status: resolved
    summary: "No TD fixes cleanup of abandoned drafts and incomplete multipart uploads"
    resolved_by: phase-03-videos/TD-04
  - id: DG-1
    status: resolved
    summary: "Migration test harness not re-runnable (enum types not dropped); must cover videos"
    resolved_by: clarification
  - id: DG-2
    status: resolved
    summary: "TD-06 relies on owner deleting failed videos; no phase plans video deletion"
    resolved_by: phase-03-videos/TD-06
  - id: OQ-1
    status: resolved
    summary: "phase-03-videos/TD-01 pending — Message Queue Technology"
    resolved_by: phase-03-videos/TD-01
  - id: OQ-2
    status: resolved
    summary: "phase-03-videos/TD-02 pending — Large-File Upload Protocol (up to 10GB)"
    resolved_by: phase-03-videos/TD-02
  - id: OQ-3
    status: resolved
    summary: "phase-03-videos/TD-03 pending — Object Storage Layout"
    resolved_by: phase-03-videos/TD-03
  - id: OQ-4
    status: resolved
    summary: "phase-03-videos/TD-04 pending — Draft Pre-registration and Upload-Completion Trigger"
    resolved_by: phase-03-videos/TD-04
  - id: OQ-5
    status: resolved
    summary: "phase-03-videos/TD-05 pending — Video Status Lifecycle Model"
    resolved_by: phase-03-videos/TD-05
  - id: OQ-6
    status: resolved
    summary: "phase-03-videos/TD-06 pending — Processing Failure Policy"
    resolved_by: phase-03-videos/TD-06
  - id: OQ-7
    status: resolved
    summary: "phase-03-videos/TD-07 pending — Video Worker Runtime Topology"
    resolved_by: phase-03-videos/TD-07
  - id: OQ-8
    status: resolved
    summary: "phase-03-videos/TD-08 pending — FFmpeg / ffprobe Integration"
    resolved_by: phase-03-videos/TD-08
  - id: OQ-9
    status: resolved
    summary: "phase-03-videos/TD-09 pending — Worker Access to the Source Video"
    resolved_by: phase-03-videos/TD-09
  - id: OQ-10
    status: resolved
    summary: "phase-03-videos/TD-10 pending — Unique Video URL Identifier"
    resolved_by: phase-03-videos/TD-10
  - id: OQ-11
    status: resolved
    summary: "phase-03-videos/TD-11 pending — Video Delivery for Streaming and Download"
    resolved_by: phase-03-videos/TD-11
advisories: []
---

# phase-03-videos — Validation

## Findings

### Inconsistencies

_None._

### Ambiguities

_None._

### Missing Decisions

_None._

### Dependency Gaps

_None._

### Inherited Constraint Conflicts

_None._

### Unresolved Open Questions

_None._

### UI Coverage Gaps

_None._

## Resolved Issues

- **IC-1** — Presigned URLs signed with browser host (TD-02) are unreachable from worker (TD-09). Resolved with option (a): two S3 endpoints with an explicit env-key pair — internal `STORAGE_ENDPOINT` (e.g. `http://minio:9000`) for API server-side calls and the worker (including the presigned GET handed to FFmpeg, signed with the internal host) and public `STORAGE_PUBLIC_ENDPOINT` (browser-reachable, e.g. `http://localhost:9000`) only for URLs returned to clients. Revisions appended to TD-02, TD-09 and TD-11. `resolved_by: phase-03-videos/TD-02`.
- **IC-2** — TD-02/TD-11 build on next-frontend-config-base/TD-03, absent from context.md. Resolved with option (a): rerun `/plan-context phase-03-videos` and accept `docs/decisions/technical-decisions-next-frontend-config-base.md` through the `decisions-correlator` confirmation, so `next-frontend-config-base/TD-03` (strict BFF) lands in `## Inherited Decisions Detail` and in `sources_mtime`. No decisions-doc edit; the context rerun is the pending action. `resolved_by: clarification`.
- **AMB-1** — Upload validation contract fixed on TD-02: MIME types `video/mp4`, `video/webm`, `video/quicktime`, `video/x-matroska`; max size 10 GiB (10737418240 bytes); part size 100 MiB; presigned URL TTL 1h; size, part size and TTL configurable via env keys. `resolved_by: phase-03-videos/TD-02`.
- **AMB-2** — Endpoint set fixed as `init` / `complete` / `abort`; multipart `upload_id` persisted on the video row; no resume / `ListParts` endpoint (not a phase capability). Revisions on TD-02 and TD-04. `resolved_by: phase-03-videos/TD-04`.
- **AMB-3** — Draft row: video belongs to a channel (FK `channel_id`, owner = authenticated user's channel); `title` from the `init` body, defaulting to the original filename; queue `jobId` and storage keys use the UUID PK; `public_id` only for the unique URL. Revisions on TD-04, TD-03, TD-10 and TD-01. `resolved_by: phase-03-videos/TD-04`.
- **AMB-4** — Persist `duration_seconds` plus a `metadata` jsonb (width, height, video codec, container format, bitrate, size); thumbnail = JPEG of the frame at 10% of the duration, scaled to width 640. Revision on TD-08. `resolved_by: phase-03-videos/TD-08`.
- **AMB-5** — Phase 03 stream/download are owner-only (authenticated channel owner); only `ready` videos are servable; presigned GET URL (TTL 1h) returned in a JSON body, no redirect; download URL uses `ResponseContentDisposition: attachment`. Revision on TD-11. `resolved_by: phase-03-videos/TD-11`.
- **AMB-6** — `complete` is idempotent: if the video is already `processing`, it re-enqueues with the same `jobId` (BullMQ dedup), recovering a lost enqueue; if `ready`/`failed`, no-op/conflict per the error catalog. Revisions on TD-04 and TD-01. `resolved_by: phase-03-videos/TD-04`.
- **MD-1** — Cleanup policy for abandoned uploads kept inside TD-04's choice (the issue's first explicit option, so no new TD/`/research` cycle): client `abort` endpoint + MinIO's default stale incomplete-multipart expiry (24h); abandoned draft rows remain `draft`; a dedicated cleanup job is out of scope and recorded as a separate future task. Revision on TD-04. `resolved_by: phase-03-videos/TD-04`.
- **DG-1** — Prior-phase migration test harness is not re-runnable. Resolution (plan-build input, not a TD): Phase 03 gets an initial prerequisite step that fixes `nestjs-project/src/database/migrations.integration-spec.ts` (drop the managed enum types too, so re-runs are idempotent) and extends it (`MANAGED_TABLES`, migration list, migration-count assertion) and `src/test/create-test-data-source.ts` `cleanAllTables` (clean `videos` before `channels`/`users`) for the new `videos` table/enum/migration. `resolved_by: clarification`.
- **DG-2** — TD-06 no longer relies on owner deletion: `failed` videos are retained (row + source object) for diagnosis; deletion is not part of the project plan's Phase 03 and is not introduced here. Revision on TD-06. `resolved_by: phase-03-videos/TD-06`.
- **OQ-1** — TD-01 decided: A (BullMQ on Redis); Libraries `@nestjs/bullmq@^11.0.5`, `bullmq@^6`, `ioredis@>=5` (bullmq 6 optional peer). `resolved_by: phase-03-videos/TD-01`.
- **OQ-2** — TD-02 decided: A (S3 multipart with presigned part URLs, direct to storage). `resolved_by: phase-03-videos/TD-02`.
- **OQ-3** — TD-03 decided: A (single private bucket, per-video prefix). `resolved_by: phase-03-videos/TD-03`.
- **OQ-4** — TD-04 decided: A (client-driven init/complete endpoints). `resolved_by: phase-03-videos/TD-04`.
- **OQ-5** — TD-05 decided: A (single linear enum `draft` → `processing` → `ready` | `failed`), diverging from Recommendation B for literal adherence to the challenge criterion "rascunho → processando → pronto/erro" (Note recorded on the TD). `resolved_by: phase-03-videos/TD-05`.
- **OQ-6** — TD-06 decided: A (bounded retries, then terminal `failed`, keep data). `resolved_by: phase-03-videos/TD-06`.
- **OQ-7** — TD-07 decided: A (same codebase, separate entrypoint and Compose service). `resolved_by: phase-03-videos/TD-07`.
- **OQ-8** — TD-08 decided: A (system FFmpeg via apt + `child_process.spawn`). `resolved_by: phase-03-videos/TD-08`.
- **OQ-9** — TD-09 decided: A (presigned GET with HTTP range reads). `resolved_by: phase-03-videos/TD-09`.
- **OQ-10** — TD-10 decided: B (random short public ID in a unique column). `resolved_by: phase-03-videos/TD-10`.
- **OQ-11** — TD-11 decided: A (presigned GET URLs issued by the API). `resolved_by: phase-03-videos/TD-11`.
- **IC-3** — TD-02 chosen as resumable; revisions dropped re-sign/resume and fixed a 1h part-URL TTL. Resolved with option (b): a re-sign endpoint for an existing `upload_id` of a caller-owned `draft` video, backed by S3 `ListParts`. It returns the uploaded parts (part number + `ETag`) and fresh public presigned URLs (configured TTL) for the missing parts, so a 10 GiB upload resumes after connection failure, reload or URL expiry (`docs/project-plan.md` Pontos de Atenção). It replaces the AMB-2 "no resume / `ListParts` / re-sign endpoint" clause. Revisions (same option letters) on TD-02 and TD-04. `resolved_by: phase-03-videos/TD-02`.
- **AMB-7** — Out-of-state / failed-check responses. Resolved with option (a), one rule. `complete` on `processing` stays the AMB-6 idempotent re-enqueue. `complete` on `ready`/`failed`, `abort` or re-sign on a non-`draft` video, and `complete` after abort/expiry (S3 `NoSuchUpload`) return 409 `INVALID_VIDEO_STATE` with no side effect. A failed `HeadObject` check (size above the configured max or different from the size declared at `init`) returns 422 `UPLOAD_VERIFICATION_FAILED`, discards the upload and leaves the row `draft`. Revision on TD-04. `resolved_by: phase-03-videos/TD-04`.
- **IC-4** — MinIO server healthcheck impossible (shell-less image, no `mc`/HTTP client). Resolved with option (c): no healthcheck on the `cgr.dev/chainguard/minio` server service; the bucket bootstrap runs on `cgr.dev/chainguard/minio-client:latest-dev` (has `/usr/bin/sh`; pinned by digest at implementation) with `depends_on: service_started` and the shell command `mc ready local && mc mb --ignore-existing local/<bucket>`. Verified by running the image on 2026-10-19: `mc ready` retries until the server answers, then exits 0; `mb --ignore-existing` is re-runnable. Edit in `library-refs.md` § MinIO server image (no TD change). `resolved_by: clarification`.
- **IC-5** — Abandoned-upload expiry relied on MinIO's 24h default; S3 has none. Resolved with option (b): the MinIO default stale-upload expiry (24h) is the policy for the Docker/MinIO environment of this phase; for S3 in production an `AbortIncompleteMultipartUpload` bucket lifecycle rule is recorded as a production-deployment task of Fase 07 ("Ambiente de produção e deploy", `docs/project-plan.md`), out of scope for Phase 03. Revisions on TD-04 and TD-03; `library-refs.md` stale-upload note scoped accordingly. `resolved_by: phase-03-videos/TD-04`.
- **AMB-8** — Re-sign and the 422 check need the declared size/part size. Resolved with option (a): the `videos` row persists the size declared at `init` (bigint bytes) and the part size used at `init`; re-sign and the 422 check use those persisted values, not the current config. Revisions on TD-04 and TD-02. `resolved_by: phase-03-videos/TD-04`.
- **AMB-9** — `abort` on a `draft` whose upload is already gone. Resolved with option (a): repeated `abort` is idempotent — S3 `NoSuchUpload` is ignored and the response is the same success response as the first `abort`. Revision on TD-04. `resolved_by: phase-03-videos/TD-04`.
- **AMB-10** — Response for unknown or non-owned video. Resolved with option (a): 404 `VIDEO_NOT_FOUND` (`VideoNotFoundException`) for both unknown and other-channel videos on re-sign/`complete`/`abort` and stream/download; existence not revealed (consistent with TD-10). Revisions on TD-04 and TD-11. `resolved_by: phase-03-videos/TD-04`.
- **AMB-11** — `complete` retry after `CompleteMultipartUpload` succeeded but the row stayed `draft`. Resolved with option (a): `complete` is retry-safe — on S3 `NoSuchUpload` with the row still `draft`, it runs `HeadObject` on `videos/{videoId}/source`; if the object exists it continues with the normal completion check (422 `UPLOAD_VERIFICATION_FAILED` + discard, row stays `draft`; or → `processing` + enqueue with `jobId` = UUID); if not, 409 `INVALID_VIDEO_STATE` as before. Re-sign after `NoSuchUpload` unchanged. Revision on TD-04; `library-refs.md` `complete` snippet updated. `resolved_by: phase-03-videos/TD-04`.
- **AMB-12** — Identifier in external routes/responses. Resolved with option (a): `public_id` is the only external video identifier. It is used in every route param (re-sign, `complete`, `abort`, stream, download) and in the `init` response. The UUID PK never leaves the API: it is used internally for storage keys, the BullMQ `jobId` and FKs. Revisions on TD-10 (clarifying the AMB-3 "only for the unique URL" wording), TD-04 and TD-11. `resolved_by: phase-03-videos/TD-10`.
- **IC-6** — `abort` reported success but left an already-completed upload completable. Resolved with option (a): on a `draft` video, `abort` also runs `DeleteObject` on `videos/{videoId}/source`. `DeleteObject` succeeds on a missing key, so `abort` stays idempotent, and `NoSuchUpload` is still ignored. A later `complete` then gets 409 `INVALID_VIDEO_STATE`, because `HeadObject` finds nothing. Revision (2026-10-20) on TD-04; `library-refs.md` `abort` snippet updated. `resolved_by: phase-03-videos/TD-04`.
- **IC-7** — The 422 completion check was worded two ways (AMB-8 vs AMB-7/AMB-11). Auto-resolved per the user's standing instruction with option (a): the check is only `ContentLength` ≠ persisted declared size, and the max is enforced at `init` only. Revision (2026-10-20) on TD-04; the `library-refs.md` snippet already matched. The `internalS3` command list now also names `DeleteObject` for `abort`. `resolved_by: phase-03-videos/TD-04`.
- **AMB-13** — `complete` had no defined response when S3 rejects the client parts list. Auto-resolved per the user's standing instruction with option (a): S3 `InvalidPart` / `InvalidPartOrder` / `EntityTooSmall` → 422 `INVALID_UPLOAD_PARTS` (`InvalidUploadPartsException`), no side effect. The upload stays open and the row stays `draft`, so the client can re-sign and retry. Revision (2026-10-20) on TD-04; `library-refs.md` `complete` snippet updated. `resolved_by: phase-03-videos/TD-04`.
- **AMB-14** — `complete` with a subset of parts was handled by the destructive 422 path. Auto-resolved per the user's standing instruction with option (a): before any S3 call, the part numbers must be exactly 1..ceil(persisted declared size / persisted part size), each once; otherwise 422 `INVALID_UPLOAD_PARTS`, no side effect, and the upload stays open. Revision (2026-10-20) on TD-04; `library-refs.md` `complete` snippet updated. `resolved_by: phase-03-videos/TD-04`.
