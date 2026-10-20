---
libs:
  "@nestjs/bullmq":
    version: "^11.0.5"
    context7_id: "/nestjs/bull"
    fetched_at: "2026-10-19T20:32:49-03:00"
  bullmq:
    version: "^6"
    context7_id: "/taskforcesh/bullmq"
    fetched_at: "2026-10-19T20:32:49-03:00"
  ioredis:
    version: ">=5"
    context7_id: "/taskforcesh/bullmq"
    fetched_at: "2026-10-19T20:32:49-03:00"
  "@aws-sdk/client-s3":
    version: "^3.1153.0"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-10-19T20:32:49-03:00"
  "@aws-sdk/s3-request-presigner":
    version: "^3.1153.0"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-10-19T20:32:49-03:00"
sources_mtime:
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-20T08:25:07-03:00"
---

# phase-03-videos — Library References

Distilled docs for the libraries decided in this slice. Pulled via Context7 and cross-checked against the npm registry on 2026-10-19. Re-fetch when the underlying TD changes (resolve refreshes this file when the lib set in `## Decisions Index` drifts from the cached set here). The last section, "Infrastructure images and system packages", covers runtime pieces that are not npm libraries (Redis/Valkey, MinIO, FFmpeg). They are recorded here for `/plan-build` and are not keys in `libs:`. The MinIO entry was revised on 2026-10-19 (the image source moved to Chainguard) and the `ListParts` resume call was added for IC-3. On 2026-10-19 (round 3) the MinIO healthcheck/bootstrap guidance was corrected (IC-4), the stale-upload expiry was scoped to MinIO (IC-5), and the S3 snippets were aligned with the AMB-8/AMB-9 revisions. On 2026-10-19 (round 4) the `complete` snippet was made retry-safe on `NoSuchUpload` (AMB-11). On 2026-10-20 the `abort` snippet gained a `DeleteObject` on the source key (IC-6). The `complete` snippet also maps S3 parts-list rejections to 422 `INVALID_UPLOAD_PARTS` (AMB-13). It also checks that the parts list is complete before calling S3 (AMB-14).

## @nestjs/bullmq

**Source:** `/nestjs/bull` (Context7) — High reputation, benchmark 86.5. Maps to `phase-03-videos/TD-01` Decision A.

**Version pin (npm registry, verified):** `@nestjs/bullmq@^11.0.5`.

- `11.0.5` (2026-08-07) is the only 11.x release whose peerDependencies accept `bullmq ^6.0.0` (`^3 || ^4 || ^5 || ^6`). `11.0.0`–`11.0.4` stop at `^5.0.0`.
- `12.0.0` (latest, 2026-08-27) is `"type": "module"` (ESM-only). The project is CommonJS, so 12.x is excluded.
- Peers: `@nestjs/common` / `@nestjs/core` `^10 || ^11`. The project has 11.1.16, which is compatible. Depends on `@nestjs/bull-shared@^11.0.5`.

### Root connection (`forRootAsync`), following the project's config convention

```ts
import { BullModule } from '@nestjs/bullmq';

BullModule.forRootAsync({
  imports: [ConfigModule],
  inject: [queueConfig.KEY],                 // registerAs('queue', ...) namespace (phase-01 TD-03)
  useFactory: (cfg: ConfigType<typeof queueConfig>) => ({
    connection: { host: cfg.host, port: cfg.port }, // host = Compose service name, never localhost
  }),
});
```

### Queue registration, producer, consumer

```ts
BullModule.registerQueue({
  name: 'video-processing',
  defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
});

@Injectable()
export class VideoProcessingProducer {
  constructor(@InjectQueue('video-processing') private readonly queue: Queue) {}
  enqueue(videoId: string) {
    return this.queue.add('process', { videoId }, { jobId: videoId }); // UUID PK (TD-01 revision)
  }
}

@Processor('video-processing', { concurrency: 1 })
export class VideoProcessingConsumer extends WorkerHost {
  async process(job: Job<{ videoId: string }>): Promise<void> { /* ffprobe + thumbnail */ }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) { /* mark `failed` once attempts are exhausted (TD-06) */ }
}
```

- `WorkerHost.process(job, token?)`: a rejection marks the attempt as failed, subject to `attempts`/`backoff`. The resolved value becomes `returnvalue`.
- `this.worker` (the underlying BullMQ `Worker`) is available only from `onApplicationBootstrap` onward.
- `registerQueue` attaches `onApplicationShutdown`, which closes the workers and the queue. The worker entrypoint (TD-07, `NestFactory.createApplicationContext(WorkerModule)`) must call `app.enableShutdownHooks()` so that hook runs.
- Only the worker's module should register the `@Processor` provider. The API registers the queue for the producer only, so it never consumes jobs (TD-07 module boundary).
- Testing: the token is `getQueueToken('video-processing')` (`BullQueue_video-processing`), so a test can override the queue provider with a mock in unit tests.

## bullmq

**Source:** `/taskforcesh/bullmq` (Context7, versions up to v6.3.11) — High reputation. Maps to `phase-03-videos/TD-01` Decision A.

**Version pin (npm registry, verified):** `bullmq@^6` (latest `6.3.17`; ships CJS at `./dist/cjs/index.js`; `engines.node >=14.17.0`).

- **Breaking change in v6:** `ioredis` is no longer a direct dependency. It is an optional peer (`ioredis >=5.0.0`; `redis >=5.0.0`, `pg` and `bullmq-otel` are also optional peers), so Redis users must install `ioredis` explicitly (see the next section).
- **`jobId` dedup:** "The job will be ignored if the ID already exists in the queue." Custom IDs must not be purely numeric (`Error: Custom Id cannot be integers`) and must not contain `:`. A UUID meets both rules. The ID only dedups while the job is still stored, so a completed or failed job that was removed (`removeOnComplete` / `removeOnFail`) can be added again. The `complete` idempotency rule (TD-01/TD-04 revisions) relies on this: re-adding while the job is live is a no-op, and re-adding after a lost enqueue creates the job.
- **Retries:** `attempts` + `backoff: { type: 'exponential', delay }` retries after `2^(attempts-1) * delay` ms.
- **Non-retryable errors:** `throw new UnrecoverableError(msg)` moves the job to failed immediately, ignoring `attempts`. Use it for media that ffprobe cannot decode (TD-06).
- **Stalled jobs / long jobs:** a worker holds a lock for `lockDuration` (worker option) and renews it while the job runs. If a worker dies, the job is detected as stalled and retried. Long FFmpeg jobs keep the lock as long as the event loop is not blocked, which holds because `child_process.spawn` is async.
- **Connection:** a Worker needs a connection with `maxRetriesPerRequest: null`. BullMQ enforces this on the connections it creates from options, and throws if you pass a manually created client without it.
- **Redis server:** must run with `maxmemory-policy noeviction` (TD-01 Cons).

## ioredis

**Source:** BullMQ connection docs (`/taskforcesh/bullmq`, "Connections" guide + v6 changelog); npm registry.

**Version (npm registry, verified):** peer range `>=5` from bullmq 6. Latest stable is `6.0.0` (2026-07-31; CJS, `main: ./built/index.js`, `engines.node >=20`). `5.11.1` is the latest 5.x. Either satisfies the peer range. Pin the exact major at install time.

- BullMQ creates its connections with ioredis by default and passes the connection options to the ioredis constructor. With `connection: { host, port }` in `forRootAsync`, the project never constructs ioredis directly, but the package must be in `dependencies`.
- `Worker` and `QueueEvents` duplicate the connection internally for blocking commands, so expect more than one Redis connection per process.

## @aws-sdk/client-s3

**Source:** `/aws/aws-sdk-js-v3` (Context7) — High reputation. Maps to `phase-03-videos/TD-02`, `TD-09`, `TD-11`.

**Version pin (npm registry, verified):** `^3.1153.0` (latest; `engines.node >=20`). Keep it in lockstep with `@aws-sdk/s3-request-presigner`.

### Two clients, one per endpoint (TD-02 revision, IC-1)

```ts
const base = {
  region: cfg.region,
  credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
  forcePathStyle: true,                         // MinIO: host/bucket/key instead of bucket subdomain
  requestChecksumCalculation: 'WHEN_REQUIRED',  // see checksum note below
  responseChecksumValidation: 'WHEN_REQUIRED',
} as const;

const internalS3 = new S3Client({ ...base, endpoint: cfg.endpoint });       // STORAGE_ENDPOINT, e.g. http://minio:9000
const publicSigner = new S3Client({ ...base, endpoint: cfg.publicEndpoint }); // STORAGE_PUBLIC_ENDPOINT, e.g. http://localhost:9000
```

- `internalS3` sends every server-side command (`CreateMultipartUpload`, `ListParts` for re-sign, `CompleteMultipartUpload`, `AbortMultipartUpload`, `HeadObject`, `DeleteObject` for a failed completion check and for `abort` (TD-04 IC-6), `PutObject` for the thumbnail) and signs the worker's GET for FFmpeg (TD-09).
- `publicSigner` is used **only** with `getSignedUrl` for URLs handed to clients (`UploadPart` URLs, playback/download GETs). It never sends requests itself.
- **Checksum default:** `requestChecksumCalculation` defaults to `WHEN_SUPPORTED`, which adds flexible-checksum headers to every operation that models them (e.g. `PutObject`, `UploadPart`). For S3-compatible third-party storage and for browser-uploaded presigned parts, set `WHEN_REQUIRED` (see aws-sdk-js-v3 issue #6810, referenced from `supplemental-docs/CLIENTS.md`). Otherwise a presigned `UploadPart` can carry a checksum the browser's raw `PUT` does not satisfy. Verify against MinIO in the integration test.

### Multipart commands (TD-02 / TD-04)

```ts
// init
const { UploadId } = await internalS3.send(new CreateMultipartUploadCommand({
  Bucket, Key: `videos/${videoId}/source`, ContentType: mimeType,
}));
// part URLs: partCount = ceil(size / partSize) — 100 MiB parts → ≤ 103 parts for 10 GiB
const url = await getSignedUrl(publicSigner,
  new UploadPartCommand({ Bucket, Key, UploadId, PartNumber: n }), { expiresIn: 3600 });

// complete — first, the parts list must be exactly 1..ceil(row.declaredSize / row.partSize), each once
// (TD-04 AMB-14 revision); otherwise 422 INVALID_UPLOAD_PARTS before any S3 call (S3 accepts a subset)
try {
  await internalS3.send(new CompleteMultipartUploadCommand({
    Bucket, Key, UploadId,
    MultipartUpload: { Parts: parts.map(p => ({ PartNumber: p.partNumber, ETag: p.etag })) },
  }));
} catch (e) {
  // client-caused parts rejection (TD-04 AMB-13 revision): 422 INVALID_UPLOAD_PARTS, no side effect,
  // upload stays open so the client can re-sign and retry. These are S3ServiceException instances
  // distinguished by `name` (only NoSuchUpload is exported as its own class).
  if (e instanceof S3ServiceException && ['InvalidPart', 'InvalidPartOrder', 'EntityTooSmall'].includes(e.name)) {
    throw new InvalidUploadPartsException();
  }
  if (!(e instanceof NoSuchUpload)) throw e;
  // retry-safe on a draft row (TD-04 AMB-11 revision): the upload may already have been completed
  // by an earlier call that failed afterwards. HeadObject below decides: object present → normal check;
  // absent (NotFound: aborted / expired / discarded by a 422) → 409 INVALID_VIDEO_STATE, no side effect
}
const head = await internalS3.send(new HeadObjectCommand({ Bucket, Key })); // ContentLength === row.declaredSize (TD-04 AMB-7/AMB-8)

// re-sign / resume (TD-02/TD-04 IC-3 revisions) — parts already uploaded for this upload_id
const uploaded: { partNumber: number; etag: string }[] = [];
let marker: string | undefined;
do {
  const page = await internalS3.send(new ListPartsCommand({ Bucket, Key, UploadId, PartNumberMarker: marker }));
  for (const p of page.Parts ?? []) uploaded.push({ partNumber: p.PartNumber!, etag: p.ETag! });
  marker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
} while (marker);
// missing = [1..ceil(row.declaredSize / row.partSize)] \ uploaded → getSignedUrl(publicSigner, UploadPartCommand, { expiresIn: ttl })
//   declaredSize and partSize come from the videos row persisted at init, never from current config (TD-04 AMB-8 revision)
// NoSuchUpload (aborted, or expired after 24h on MinIO) → 409 INVALID_VIDEO_STATE (TD-04 AMB-7 revision)

// abort — idempotent on a draft (TD-04 AMB-9 + IC-6 revisions): NoSuchUpload is swallowed, same success response
try {
  await internalS3.send(new AbortMultipartUploadCommand({ Bucket, Key, UploadId }));
} catch (e) {
  if (!(e instanceof NoSuchUpload)) throw e; // NoSuchUpload is exported by @aws-sdk/client-s3
}
// discard an already assembled source (upload completed but row still draft, TD-04 AMB-11/IC-6);
// DeleteObject succeeds on a missing key, so a repeated abort stays idempotent
await internalS3.send(new DeleteObjectCommand({ Bucket, Key }));
```

- `ListParts` returns at most 1,000 parts per page (`MaxParts`), paginated via `PartNumberMarker` / `NextPartNumberMarker` / `IsTruncated`. With ≤ 103 parts one page is enough, but keep the loop. Each `Part` carries `PartNumber`, `ETag` (quoted), `Size` and `LastModified`.
- S3 limits: parts 5 MiB–5 GiB (the last part may be smaller), at most 10,000 parts, single `PUT` at most 5 GiB.
- `Parts` must be sorted by `PartNumber`, and each `ETag` must be the value returned by the part upload, quotes included. The browser can read `ETag` only when storage CORS exposes it. The SDK's own `lib-storage` fails with "Missing Bucket CORS configuration for ETag header?" when the header is missing.

### Download disposition (TD-11)

```ts
new GetObjectCommand({ Bucket, Key, ResponseContentDisposition: `attachment; filename="${safeName}"` })
```

## @aws-sdk/s3-request-presigner

**Source:** `/aws/aws-sdk-js-v3` — `packages/s3-request-presigner/README.md`. Maps to `phase-03-videos/TD-02`, `TD-09`, `TD-11`.

**Version pin (npm registry, verified):** `^3.1153.0`.

```ts
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
const url = await getSignedUrl(client, command, { expiresIn: 3600 }); // default 900 s; 1h per TD-02 revision
```

- The URL is SigV4-signed for the client's endpoint host. It cannot be rewritten to another host after signing, which is why there are two clients (IC-1).
- `unhoistableHeaders: new Set([...])` forces specific `x-amz-*` headers to be signed as headers that the caller must send. It is not needed for the plain part/GET URLs used here.
- Playback (TD-11): `getSignedUrl(publicSigner, new GetObjectCommand({ Bucket, Key }), { expiresIn: 3600 })`. Storage serves `Range` / `206` natively. Worker (TD-09): the same call with `internalS3`.

## Infrastructure images and system packages (not npm libraries)

### FFmpeg / ffprobe — Debian bookworm apt package (TD-08)

- **Package (Debian sources API + packages.debian.org, verified):** `ffmpeg` `7:5.1.9-0+deb12u1` in `bookworm` (FFmpeg 5.1.x). It matches the `node:25.6.0-slim` base image (Debian 12 bookworm; `nestjs-project/Dockerfile.dev` already does `apt update && apt install -y procps curl`). The package ships both `ffmpeg` and `ffprobe`.
- **Docs:** `/websites/ffmpeg_ffmpeg-all` (Context7). Those docs track current FFmpeg, so they list options newer than 5.1 (e.g. `reconnect_max_retries`, `reconnect_delay_total_max`, `respect_retry_after`). **Discrepancy flagged:** use only options that exist in 5.1. The `reconnect`, `reconnect_streamed`, `reconnect_on_network_error`, `reconnect_on_http_error`, `reconnect_delay_max`, `seekable` and `multiple_requests` HTTP options do. Confirm with `ffmpeg -h protocol=http` inside the image.
- Invocations (TD-08, argument arrays via `spawn`, no shell):
  - metadata: `ffprobe -v error -print_format json -show_format -show_streams <presigned-internal-url>`. Read `format.duration`, `format.format_name`, `format.bit_rate`, `format.size`, and the first video stream's `width`, `height` and `codec_name` (AMB-4 revision on TD-08).
  - thumbnail: `ffmpeg -ss <10% of duration> -i <url> -frames:v 1 -vf scale=640:-2 -f image2 <out>.jpg`. `-ss` before `-i` does an input seek, so it reads only around the frame. `-2` keeps the height even.
  - HTTP input: `seekable` auto-detects range support (`-1`), and the `reconnect*` options add resilience (TD-09). The URL must be signed for `STORAGE_ENDPOINT` (the internal host).

### MinIO server image (TD-02/TD-03, inherited constraint)

Storage stays MinIO (inherited constraint unchanged). Only the image source changes.

- **Image change (environment fact, 2026-10-19):** `minio/minio` can no longer be pulled. The Docker Hub repo is gone and `quay.io/minio/minio` returns `401`. The upstream `github.com/minio/minio` repo is archived; its last tag is `RELEASE.2025-10-15T17-29-55Z`. Use instead:
  - **Server:** `cgr.dev/chainguard/minio`. It is MinIO `RELEASE.2026-09-22T19-25-18Z` built from source: Wolfi package `minio` `0.20260922.192518`, from the `github.com/chainguard-forks/minio` tag `RELEASE.2026-09-22T19-25-18Z`. Anonymous pull works (verified 2026-10-19). The `:latest` index digest on that date was `sha256:2915cb406f38ed6ff9634de0a3e4a9423e2dda06a6f1aca18f8c968aa37a01f6`.
  - **Bucket bootstrap:** `cgr.dev/chainguard/minio-client:latest-dev` (IC-4; the `-dev` variant ships a shell, `/usr/bin/sh`). Its `:latest-dev` index digest on 2026-10-19 was `sha256:f4ffdb6d79586e6255d138641ab5e6b0dca8f188df4291fd62a3278785bbe468` (the plain `:latest` digest that day, shell-less, was `sha256:7d0cf8f3de478cd4d2a8df4efcff9563091e298c8916122bbbbedb2ce08edcad`).
  - **Pin both by digest at implementation** (`image: cgr.dev/chainguard/minio@sha256:…`). The free tier exposes only `latest`/`latest-dev`, so there are no version tags to pin. Re-read the digest at implementation time and confirm the version with `minio --version`.
- **Image shape (verified from the image config):** the entrypoint is `/usr/bin/minio` with no default args, so Compose must set `command: server /data --console-address ":9001"`. The client image's entrypoint is `/usr/bin/mc`. Both run as the non-root UID `65532`, so the data volume must be writable by that UID; a named volume works. The server image has no shell, no `mc` and no HTTP client, and neither image declares a healthcheck. A Compose healthcheck runs inside the service's own container, so **the `minio` server service has no healthcheck** (IC-4). Readiness is checked from the bootstrap container instead (next bullet).
- **Docs:** `/minio/minio` (Context7, upstream master), re-checked against the fork's source at tag `RELEASE.2026-09-22T19-25-18Z`.
  - **Stale-upload expiry (re-verified at that tag, `internal/config/api/api.go`):** `MINIO_API_STALE_UPLOADS_EXPIRY` (default `24h`) and `MINIO_API_STALE_UPLOADS_CLEANUP_INTERVAL` (default `6h`) are unchanged. The MD-1 cleanup policy relies on them (TD-04 revision). Keep the defaults; there is no need to set them. **Scope (IC-5, TD-04 revision):** this expiry is MinIO-only, i.e. the Docker environment of this phase. AWS S3 has no default expiry for incomplete multipart uploads; production needs an `AbortIncompleteMultipartUpload` bucket lifecycle rule, recorded as a Fase 07 deployment task (out of scope here). The Phase 03 bootstrap does not apply lifecycle rules. A resumable upload (IC-3 re-sign) must therefore finish within 24h of `init`. After that the `upload_id` is gone (`NoSuchUpload` → 409 `INVALID_VIDEO_STATE`, TD-04 AMB-7 revision).
  - **CORS (re-verified at that tag):** `MINIO_API_CORS_ALLOW_ORIGIN` (csv, default `*`) is unchanged. Per `docs/minio-limits.md`, per-bucket CORS (`PutBucketCors`) is not supported and CORS is server-wide. `cmd/api-router.go` `corsHandler` sets `ExposedHeaders: commonS3Headers`, which includes `ETag`. The browser can therefore read `ETag` on part `PUT`s without extra config. Still assert this in an integration/e2e check.
  - **`ListParts`** (IC-3 re-sign) is a standard S3 API supported by MinIO. It is not in the `minio-limits.md` unsupported list.
- Bucket bootstrap (single private bucket, TD-03; IC-4 option c) is a one-shot Compose service on `cgr.dev/chainguard/minio-client:latest-dev`, pinned by digest at implementation. It uses `depends_on: { minio: { condition: service_started } }` (there is no server healthcheck to wait on). Set `MC_HOST_local=http://<user>:<pass>@minio:9000` in its environment, override the `/usr/bin/mc` entrypoint with the shell and run `mc ready local && mc mb --ignore-existing local/<bucket>`:

  ```yaml
  minio-bootstrap:
    image: cgr.dev/chainguard/minio-client:latest-dev   # pin @sha256:… at implementation
    depends_on:
      minio:
        condition: service_started
    environment:
      MC_HOST_local: http://${STORAGE_ACCESS_KEY}:${STORAGE_SECRET_KEY}@minio:9000
    entrypoint: ["/bin/sh", "-c"]
    command: ["mc ready local && mc mb --ignore-existing local/${STORAGE_BUCKET}"]
    restart: "no"
  ```

  - **`mc ready TARGET` (verified 2026-10-19 by running the image):** "checks if the cluster is ready or not" via `GET /minio/health/cluster`. It **blocks and retries** until the server answers: started before the server, it printed `The cluster 'local' is unreachable: … no such host` and then `The cluster 'local' is ready` once MinIO came up, exiting 0. Flags of interest: `--cluster-read` (read quorum), `--maintenance`. It needs no healthcheck on the server.
  - **`mc mb --ignore-existing` (`-p`)** "ignore[s] if bucket/directory already exists"; a second run on the same bucket exited 0 (verified), so the bootstrap is re-runnable.
  - Services that need the bucket (API, worker) can wait with `depends_on: { minio-bootstrap: { condition: service_completed_successfully } }`.
  - Docs: `/minio/mc`; behavior above confirmed against the image itself.

### Redis / Valkey image (TD-01)

- TD-01 says "Redis/Valkey container" but does not fix the image. The tags below exist on Docker Hub (verified 2026-10-19); pin one at implementation:
  - `redis`: `8.2.10-bookworm`, `7.4.11-bookworm`, `8.10.2` (trixie), among others.
  - `valkey/valkey`: `9.1.2`, `8.1.10-alpine`, `9.0.6-alpine`, among others.
- Required server setting: `maxmemory-policy noeviction` (BullMQ). The Compose host must be the service name (root `CLAUDE.md` § Docker Networking).
