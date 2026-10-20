---
kind: phase
name: phase-03-videos
test_specs_aware: true
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-10-20T08:25:07-03:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-10-20T08:25:07-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-20T08:25:07-03:00"
  docs/project-plan.md: "2026-10-19T19:10:41-03:00"
  docs/phases/phase-01-configuracao-base/context.md: "2026-10-19T19:11:29-03:00"
  docs/phases/phase-02-auth/context.md: "2026-10-19T19:11:29-03:00"
  docs/phases/phase-02-auth-frontend/context.md: "2026-10-19T19:11:29-03:00"
  .claude/skills/testing-guide-nestjs-project/SKILL.md: "2026-10-19T19:10:41-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-10-19T19:11:29-03:00"
  docs/decisions/technical-decisions-next-frontend-config-base.md: "2026-10-19T19:11:29-03:00"
---

# Phase 03 — Upload e Processamento de Vídeos

## Objective

Entregar no `nestjs-project/` o serviço de armazenamento de arquivos (vídeos e thumbnails) e o serviço de processamento em segundo plano (filas), com upload de vídeos de até 10GB direto ao storage sem impacto na performance, pré-cadastro automático do vídeo como rascunho ao iniciar o upload, processamento automático após o upload (extração de duração e metadados + geração automática de thumbnail a partir de um frame), URL única por vídeo sem conflito, reprodução via streaming (sem download completo) e download do vídeo pelo usuário.

---

## Step Implementations

### SI-03.1 — Tornar o harness de migrations re-executável

**Description:** Pré-requisito (DG-1): o `migrations.integration-spec.ts` herdado só derruba tabelas e deixa os tipos enum gerenciados (`verification_tokens_type_enum`) no banco, então uma segunda execução falha ao recriá-los; este SI corrige o harness antes de a fase adicionar a tabela/enum `videos`.

**Technical actions:**

1. Em `nestjs-project/src/database/migrations.integration-spec.ts`, adicionar a lista `MANAGED_ENUM_TYPES` (hoje `['verification_tokens_type_enum']`) e, no `beforeAll`, executar sequencialmente (não em `Promise.all`) `DROP TABLE IF EXISTS "<table>" CASCADE` para cada tabela gerenciada + `migrations`, seguido de `DROP TYPE IF EXISTS "<enum>" CASCADE` para cada tipo enum gerenciado — garante schema limpo e re-execuções idempotentes
2. Manter o `afterAll` restaurando o schema (`runMigrations()` antes de `destroy()`), conforme `.claude/rules/typeorm-migrations.md` § "Migration Tests Must Restore DB State"

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| Migration harness | Integration: rodar a suíte duas vezes seguidas no mesmo banco passa nas duas; após o `beforeAll` nenhuma tabela nem tipo enum gerenciado existe | `nestjs-project/src/database/migrations.integration-spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- Executar `npm test -- src/database/migrations.integration-spec.ts --runInBand` duas vezes consecutivas no mesmo banco passa nas duas execuções
- Após o `beforeAll`, `SELECT typname FROM pg_type WHERE typname = 'verification_tokens_type_enum'` retorna zero linhas antes de `runMigrations()`
- Ao final da suíte, todas as migrations estão aplicadas (outras suítes do mesmo run encontram `users`, `channels`, `refresh_tokens`, `verification_tokens`)

---

### SI-03.2 — Infra: Redis, MinIO, bootstrap do bucket, serviço video-worker e FFmpeg na imagem

**Description:** Adiciona ao `nestjs-project/compose.yaml` a infraestrutura de fila e de object storage e o container separado do worker, e instala FFmpeg/ffprobe na imagem de dev (usada pela API, pelo worker e pelas suítes de teste que rodam dentro do container).

**Technical actions:**

1. Em `nestjs-project/compose.yaml`, adicionar o serviço `redis` com imagem `redis:8.2.10-bookworm`, `command: ["redis-server", "--maxmemory-policy", "noeviction"]`, porta `6379` e healthcheck `redis-cli ping` (per `phase-03-videos/TD-01`; tag de `library-refs.md` § Redis / Valkey image)
2. Adicionar o serviço `minio` com `image: cgr.dev/chainguard/minio@sha256:<digest lido na implementação>`, `command: server /data --console-address ":9001"`, portas `9000`/`9001`, `MINIO_ROOT_USER: ${STORAGE_ACCESS_KEY}` / `MINIO_ROOT_PASSWORD: ${STORAGE_SECRET_KEY}`, volume nomeado `minio-data:/data` (UID 65532) e **sem healthcheck** (imagem sem shell) (per `phase-03-videos/TD-03`; `library-refs.md` § MinIO server image, IC-4)
3. Adicionar o serviço one-shot `minio-bootstrap` em `cgr.dev/chainguard/minio-client:latest-dev` pinado por digest, `depends_on: { minio: { condition: service_started } }`, `MC_HOST_local: http://${STORAGE_ACCESS_KEY}:${STORAGE_SECRET_KEY}@minio:9000`, `entrypoint: ["/bin/sh", "-c"]`, `command: ["mc ready local && mc mb --ignore-existing local/${STORAGE_BUCKET}"]`, `restart: "no"` — sem regras de lifecycle (per `phase-03-videos/TD-03` IC-5)
4. Adicionar o serviço `video-worker` com o mesmo `build` (`Dockerfile.dev`) e o mesmo volume `.:/home/node/app` do `nestjs-api`, `depends_on` `db` (`service_healthy`), `redis` (`service_healthy`) e `minio-bootstrap` (`service_completed_successfully`); acrescentar `redis` e `minio-bootstrap` ao `depends_on` do `nestjs-api`; declarar `volumes: { minio-data: {} }` (per `phase-03-videos/TD-07`). Hosts entre serviços são sempre nomes de serviço do Compose (`redis`, `minio`), nunca `localhost`
5. Em `nestjs-project/Dockerfile.dev`, trocar a linha de apt por `apt update && apt install -y procps curl ffmpeg` (pacote Debian bookworm `ffmpeg` 5.1.x, traz `ffmpeg` e `ffprobe`) (per `phase-03-videos/TD-08`); adicionar `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` e `STORAGE_BUCKET` (default `streamtube`) a `.env.example`, pois o Compose os interpola

**Tests:** _(empty — Infra)_

**Dependencies:** none

**Acceptance criteria:**

- `docker compose up -d` deixa `nestjs-api`, `video-worker`, `db`, `redis` e `minio` em `running` e `minio-bootstrap` em `exited (0)`
- `docker compose exec redis redis-cli config get maxmemory-policy` retorna `noeviction`
- Rodar `docker compose up minio-bootstrap` uma segunda vez também termina com exit 0 e o bucket `${STORAGE_BUCKET}` continua existindo (bootstrap re-executável)
- `docker compose exec nestjs-api ffprobe -version` e `docker compose exec video-worker ffmpeg -version` reportam FFmpeg 5.1.x
- `curl -s -o /dev/null -w '%{http_code}' http://localhost:9000/minio/health/live` no host retorna `200`

---

### SI-03.3 — Dependências, namespaces de configuração e validação de env

**Description:** Instala as bibliotecas decididas para fila e storage e cria os namespaces `storage`, `queue` e `upload` no padrão `registerAs` herdado da Fase 01, estendendo o schema Joi e o `.env.example`.

**Technical actions:**

1. Instalar em `nestjs-project`: `@nestjs/bullmq@^11.0.5` (12.x é ESM-only), `bullmq@^6`, `ioredis` (peer `>=5`; fixar o major na instalação), `@aws-sdk/client-s3@^3.1153.0` e `@aws-sdk/s3-request-presigner@^3.1153.0` em lockstep (per `phase-03-videos/TD-01`, `phase-03-videos/TD-02`)
2. Criar `src/config/storage.config.ts` — `registerAs('storage', ...)` com `endpoint` (`STORAGE_ENDPOINT`, ex.: `http://minio:9000`), `publicEndpoint` (`STORAGE_PUBLIC_ENDPOINT`, ex.: `http://localhost:9000`), `region` (`STORAGE_REGION`, default `us-east-1`), `accessKey` (`STORAGE_ACCESS_KEY`), `secretKey` (`STORAGE_SECRET_KEY`), `bucket` (`STORAGE_BUCKET`, default `streamtube`) (per `phase-03-videos/TD-02` IC-1, `phase-03-videos/TD-03`)
3. Criar `src/config/queue.config.ts` — `registerAs('queue', ...)` com `host` (`REDIS_HOST`, default `redis`) e `port` (`REDIS_PORT`, default `6379`); criar `src/config/upload.config.ts` — `registerAs('upload', ...)` com `maxSizeBytes` (`UPLOAD_MAX_SIZE_BYTES`, default `10737418240`), `partSizeBytes` (`UPLOAD_PART_SIZE_BYTES`, default `104857600`) e `partUrlTtlSeconds` (`UPLOAD_PART_URL_TTL_SECONDS`, default `3600`) (per `phase-03-videos/TD-01`, `phase-03-videos/TD-02` AMB-1)
4. Estender `src/config/env.validation.ts`: `STORAGE_ENDPOINT` e `STORAGE_PUBLIC_ENDPOINT` (`Joi.string().uri().required()`), `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` (required), `STORAGE_REGION`, `STORAGE_BUCKET`, `REDIS_HOST`, `REDIS_PORT` com defaults, `UPLOAD_MAX_SIZE_BYTES` (`Joi.number().integer().positive()`), `UPLOAD_PART_SIZE_BYTES` (`Joi.number().integer().min(5242880)` — mínimo S3 de 5 MiB por parte), `UPLOAD_PART_URL_TTL_SECONDS` (`Joi.number().integer().positive()`)
5. Atualizar `.env.example` com todas as chaves novas e valores compatíveis com o Compose (`STORAGE_ENDPOINT=http://minio:9000`, `STORAGE_PUBLIC_ENDPOINT=http://localhost:9000`, `REDIS_HOST=redis`); registrar os três factories no `load` do `ConfigModule.forRoot`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `envValidationSchema` | Integration: rejeita ausência de `STORAGE_ENDPOINT` / `STORAGE_PUBLIC_ENDPOINT` / credenciais; rejeita `UPLOAD_PART_SIZE_BYTES` < 5242880; aplica defaults de upload e Redis | `nestjs-project/src/config/env.validation.integration-spec.ts` |

**Dependencies:** SI-03.2 — os valores de host do `.env.example` referenciam serviços criados lá

**Acceptance criteria:**

- A aplicação inicia com o `.env.example` copiado para `.env` — o E2E existente `GET /` continua retornando 200
- Iniciar sem `STORAGE_ENDPOINT` (ou sem `STORAGE_PUBLIC_ENDPOINT`) falha na validação Joi no bootstrap
- Sem `UPLOAD_MAX_SIZE_BYTES`, `UPLOAD_PART_SIZE_BYTES` e `UPLOAD_PART_URL_TTL_SECONDS`, os valores efetivos são `10737418240`, `104857600` e `3600`
- `UPLOAD_PART_SIZE_BYTES=1048576` é rejeitado na validação

---

### SI-03.4 — CoreModule compartilhado (Config + TypeORM + conexão BullMQ)

**Description:** Extrai a infraestrutura global hoje inline em `AppModule` para um `CoreModule` reutilizado pela API e pelo worker (fonte única de entidades e config, per `phase-03-videos/TD-07`) e acrescenta a conexão raiz do BullMQ com Redis.

**Technical actions:**

1. Criar `src/core/core.module.ts` — `CoreModule` com `ConfigModule.forRoot({ isGlobal: true, load: [appConfig, authConfig, databaseConfig, mailConfig, swaggerConfig, storageConfig, queueConfig, uploadConfig], validationSchema: envValidationSchema, validationOptions: { allowUnknown: true, abortEarly: false } })` e o mesmo `TypeOrmModule.forRootAsync` (`inject: [databaseConfig.KEY]`, `autoLoadEntities: true`, `synchronize: false`) movido do `AppModule` (convenções herdadas da Fase 01)
2. Adicionar ao `CoreModule` `BullModule.forRootAsync({ imports: [ConfigModule], inject: [queueConfig.KEY], useFactory: (cfg) => ({ connection: { host: cfg.host, port: cfg.port } }) })` (per `phase-03-videos/TD-01`; `library-refs.md` § @nestjs/bullmq)
3. Atualizar `src/app.module.ts` para importar `CoreModule` no lugar dos `ConfigModule.forRoot` / `TypeOrmModule.forRootAsync` inline, mantendo `AuthModule`, `AppController` e `AppService`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `CoreModule` | Integration: compila e inicializa contra `db` e `redis` reais; `DataSource` inicializado; `ConfigService` expõe os namespaces `storage`, `queue`, `upload` | `nestjs-project/src/core/core.module.integration-spec.ts` |

**Dependencies:** SI-03.3

**Acceptance criteria:**

- A aplicação inicia e `GET /` retorna 200 com `AppModule` importando apenas `CoreModule` + módulos de domínio
- Todas as suítes existentes (unit, integration, e2e de auth e swagger) continuam passando sem alteração de comportamento
- Com `REDIS_HOST=redis`, o processo conecta no Redis do Compose; o host nunca é `localhost`

---

### SI-03.5 — StorageModule: clientes S3 interno/público e operações multipart

**Description:** Entrega o serviço de armazenamento de arquivos sobre a API S3 (MinIO), com um cliente para chamadas server-side no endpoint interno e outro usado só para assinar URLs entregues a clientes no endpoint público.

**Technical actions:**

1. Criar `src/storage/storage.module.ts` — providers `STORAGE_INTERNAL_CLIENT` e `STORAGE_PUBLIC_SIGNER` (tokens em `src/storage/storage.constants.ts`), ambos `new S3Client({ region, credentials, forcePathStyle: true, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED', endpoint })` via `useFactory` com `inject: [storageConfig.KEY]` — `endpoint` = `STORAGE_ENDPOINT` no interno e `STORAGE_PUBLIC_ENDPOINT` no signer; exporta `StorageService` (per `phase-03-videos/TD-02` IC-1; `library-refs.md` § @aws-sdk/client-s3)
2. Criar `src/storage/storage.service.ts` — `StorageService` com: `createMultipartUpload(key, contentType)`, `presignUploadPart(key, uploadId, partNumber, ttl)` (signer público), `listParts(key, uploadId)` (paginado por `PartNumberMarker` até `IsTruncated = false`), `completeMultipartUpload(key, uploadId, parts)` (ordenado por `PartNumber`), `abortMultipartUpload(key, uploadId)`, `headObject(key)`, `deleteObject(key)`, `putObject(key, body, contentType)`, `presignGetInternal(key, ttl)` (cliente interno, para o worker — per `phase-03-videos/TD-09`) e `presignGetPublic(key, ttl, contentDisposition?)` (signer público — per `phase-03-videos/TD-11`); todas as chamadas que enviam requisições usam o cliente interno
3. Traduzir erros S3 em erros tipados de storage (`src/storage/storage.errors.ts`): `NoSuchUpload` → `StorageUploadNotFoundError`; `S3ServiceException` com `name` em `InvalidPart` / `InvalidPartOrder` / `EntityTooSmall` → `StorageInvalidPartsError`; `NotFound` do `HeadObject` → `StorageObjectNotFoundError`; demais erros propagam sem alteração (regra "Never Swallow Errors")
4. Criar `src/storage/storage.keys.ts` — `videoSourceKey(videoId)` = `videos/${videoId}/source` e `videoThumbnailKey(videoId)` = `videos/${videoId}/thumbnail.jpg`, sempre com o UUID PK (per `phase-03-videos/TD-03`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `StorageService` | Integration (MinIO real do Compose): multipart com 2 partes de 5 MiB enviadas por `fetch` PUT nas URLs presigned → `ETag` legível → `completeMultipartUpload` → `headObject` com `ContentLength` correto; `listParts` retorna as partes enviadas; `abortMultipartUpload` repetido gera `StorageUploadNotFoundError`; ETag errado gera `StorageInvalidPartsError`; `deleteObject` em chave ausente não falha; `presignGetInternal` + header `Range: bytes=0-99` responde `206` | `nestjs-project/src/storage/storage.service.integration-spec.ts` |
| `StorageService` | Unit: URLs de `presignUploadPart` / `presignGetPublic` têm host de `STORAGE_PUBLIC_ENDPOINT` e `presignGetInternal` tem host de `STORAGE_ENDPOINT`; `presignGetPublic` com disposition inclui `response-content-disposition` | `nestjs-project/src/storage/storage.service.spec.ts` |
| `StorageModule` | Unit: compilação com `storageConfig` global | `nestjs-project/src/storage/storage.module.spec.ts` |

Nos testes de integração, as URLs "públicas" são assinadas com `STORAGE_PUBLIC_ENDPOINT=http://minio:9000` sobrescrito no processo de teste, porque o host do browser (`localhost:9000`) não é alcançável de dentro do container.

**Dependencies:** SI-03.2, SI-03.3

**Acceptance criteria:**

- Um objeto enviado em duas partes por PUT direto nas URLs presigned fica disponível em `videos/{videoId}/source` com o tamanho igual à soma das partes, sem que os bytes passem pela API
- A resposta do PUT de parte expõe o header `ETag` (CORS do MinIO) e esse valor é aceito por `CompleteMultipartUpload`
- GET em URL presigned com `Range: bytes=0-99` retorna `206 Partial Content` e 100 bytes
- URLs para clientes são assinadas para `STORAGE_PUBLIC_ENDPOINT`; URLs para o worker são assinadas para `STORAGE_ENDPOINT`
- `NoSuchUpload`, rejeição da lista de partes e objeto ausente chegam ao chamador como erros de storage distintos

---

### SI-03.6 — Entidade Video, migration CreateVideos e extensão do harness de testes

**Description:** Cria a tabela `videos` com o ciclo de status linear e os parâmetros de upload persistidos, e estende o harness de migrations e o `cleanAllTables` para a nova tabela/enum (DG-1).

**Technical actions:**

1. Criar `src/videos/entities/video.entity.ts` — `@Entity('videos')` com as colunas de `### Data Model → Video` (`id`, `public_id` unique varchar(11), `channel_id`, `title`, `original_filename`, `mime_type`, `status` enum `VideoStatus` = `draft | processing | ready | failed` default `draft`, `upload_id` nullable, `declared_size` bigint com transformer para `number`, `part_size` integer, `duration_seconds` double precision nullable, `metadata` jsonb nullable, `created_at`, `updated_at`) e `@ManyToOne(() => Channel, (channel) => channel.videos)` + `@JoinColumn({ name: 'channel_id' })`; adicionar `@OneToMany(() => Video, (video) => video.channel) videos: Video[]` em `src/channels/entities/channel.entity.ts` (per `phase-03-videos/TD-05`, `phase-03-videos/TD-04`, `phase-03-videos/TD-08`, `phase-03-videos/TD-10`)
2. Gerar a migration via `npm run migration:generate -- src/database/migrations/CreateVideos` e revisar: cria `videos_status_enum`, a tabela, o índice único de `public_id`, o índice de `channel_id` e a FK para `channels`; `down` remove tabela e tipo
3. Criar `src/videos/videos.module.ts` — `VideosModule` com `TypeOrmModule.forFeature([Video])` e exports `[TypeOrmModule]`; registrar em `AppModule`
4. Estender `src/database/migrations.integration-spec.ts`: `Video` no array de entidades, `CreateVideos<timestamp>` importada explicitamente na lista de migrations, `'videos'` em `MANAGED_TABLES`, `'videos_status_enum'` em `MANAGED_ENUM_TYPES`, contagem esperada `toHaveLength(3)` e caso de revert da última migration removendo `videos` e `videos_status_enum` (DG-1)
5. Em `src/test/create-test-data-source.ts`, `cleanAllTables` passa a executar `DELETE FROM "videos"` antes de `channels`/`users` (FK)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `Video` | Integration: `public_id` único; `status` default `draft` e enum rejeita outro valor; `upload_id` / `duration_seconds` / `metadata` nullable; `declared_size` de 10737418240 volta como `number`; FK `channel_id` obrigatória; relação com `Channel` | `nestjs-project/src/videos/entities/video.entity.integration-spec.ts` |
| Migrations | Integration: 3 migrations aplicadas criam `videos`; `undoLastMigration` remove `videos` e `videos_status_enum`; re-execução idempotente | `nestjs-project/src/database/migrations.integration-spec.ts` |
| `VideosModule` | Unit: compilação com `TypeOrmModule.forFeature([Video])` | `nestjs-project/src/videos/videos.module.spec.ts` |

**Dependencies:** SI-03.1 — o harness precisa derrubar tipos enum antes de ganhar o enum de `videos`; SI-03.4 — `AppModule` já usa `CoreModule`

**Acceptance criteria:**

- `npm run migration:run` cria a tabela `videos` com colunas, tipo `videos_status_enum`, índice único em `public_id` e FK para `channels`
- Inserir dois vídeos com o mesmo `public_id` falha com violação de unique constraint
- Inserir `status = 'published'` é rejeitado pelo enum; um vídeo novo sem status explícito fica `draft`
- `npm run migration:revert` remove `videos` e `videos_status_enum`
- `cleanAllTables` limpa o banco mesmo com vídeos vinculados a canais (sem violação de FK)

---

### SI-03.7 — Exceções de domínio de vídeo e gerador de public_id

**Description:** Define as exceções do `### Error Catalog` desta fase e o gerador do identificador público curto e aleatório usado na URL única do vídeo.

**Technical actions:**

1. Em `src/common/exceptions/domain.exception.ts`, adicionar `VideoNotFoundException` (`VIDEO_NOT_FOUND`, 404), `InvalidVideoStateException` (`INVALID_VIDEO_STATE`, 409), `InvalidUploadPartsException` (`INVALID_UPLOAD_PARTS`, 422), `UploadVerificationFailedException` (`UPLOAD_VERIFICATION_FAILED`, 422) e `UploadSizeExceededException` (`VALIDATION_ERROR`, 400, mensagem com o máximo configurado), no mesmo estilo das existentes (per `phase-03-videos/TD-04` AMB-7, AMB-10, AMB-13; `phase-02-auth/TD-07`)
2. Criar `src/videos/public-id.util.ts` — `generatePublicId(): string` = `randomBytes(8).toString('base64url')` de `node:crypto` (11 caracteres `[A-Za-z0-9_-]`) (per `phase-03-videos/TD-10`)
3. Criar `src/videos/videos.constants.ts` — `ACCEPTED_VIDEO_MIME_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska'] as const`, `DELIVERY_URL_TTL_SECONDS = 3600` e `PUBLIC_ID_MAX_ATTEMPTS = 5` (per `phase-03-videos/TD-02` AMB-1, `phase-03-videos/TD-11` AMB-5)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `generatePublicId` | Unit: 11 caracteres, só alfabeto base64url, 10.000 chamadas sem repetição | `nestjs-project/src/videos/public-id.util.spec.ts` |
| `DomainExceptionFilter` | Unit: cada nova exceção vira `{ statusCode, error, message }` com o status/código do catálogo | `nestjs-project/src/common/filters/domain-exception.filter.spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- Um serviço que lança `VideoNotFoundException` resulta em `{ statusCode: 404, error: 'VIDEO_NOT_FOUND', message: 'Video not found' }`
- `InvalidVideoStateException`, `InvalidUploadPartsException` e `UploadVerificationFailedException` resultam em 409 `INVALID_VIDEO_STATE`, 422 `INVALID_UPLOAD_PARTS` e 422 `UPLOAD_VERIFICATION_FAILED`
- `generatePublicId()` retorna strings de 11 caracteres seguras para URL

---

### SI-03.8 — VideoQueueModule e producer do job de processamento

**Description:** Registra a fila `video-processing` do lado da API (somente producer, sem `@Processor`) e o producer que enfileira com `jobId` = UUID do vídeo, base do `complete` idempotente.

**Technical actions:**

1. Criar `src/video-processing/video-processing.constants.ts` — `VIDEO_PROCESSING_QUEUE = 'video-processing'`, `VIDEO_PROCESSING_JOB = 'process'`, `VIDEO_PROCESSING_ATTEMPTS = 3`, `VIDEO_PROCESSING_BACKOFF_MS = 1000`; tipo `VideoProcessingJobData = { videoId: string }` (per `### Events/Messages`)
2. Criar `src/video-processing/video-queue.module.ts` — `BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE, defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 1000 } } })`, provider `VideoProcessingProducer`, exports `[BullModule, VideoProcessingProducer]` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-06`, `phase-03-videos/TD-07`)
3. Criar `src/video-processing/video-processing.producer.ts` — `VideoProcessingProducer` com `@InjectQueue(VIDEO_PROCESSING_QUEUE)` e `enqueue(videoId: string): Promise<void>` = `queue.add(VIDEO_PROCESSING_JOB, { videoId }, { jobId: videoId })` (per `phase-03-videos/TD-01` AMB-3/AMB-6)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoProcessingProducer` | Integration (Redis real): `enqueue` cria job com `jobId` = UUID, payload `{ videoId }`, `attempts: 3`; segundo `enqueue` com o mesmo UUID enquanto o job existe não cria outro job; fila limpa com `obliterate({ force: true })` entre testes | `nestjs-project/src/video-processing/video-processing.producer.integration-spec.ts` |
| `VideoQueueModule` | Unit: compilação com `BullModule.forRoot` de teste + `registerQueue` | `nestjs-project/src/video-processing/video-queue.module.spec.ts` |

**Dependencies:** SI-03.4 — conexão raiz do BullMQ

**Acceptance criteria:**

- `enqueue(videoId)` cria na fila `video-processing` um job `process` com `jobId` igual ao UUID e payload `{ "videoId": "<uuid>" }`
- Chamar `enqueue` duas vezes para o mesmo vídeo deixa exatamente um job na fila
- O módulo da API registra a fila sem nenhum consumidor (nenhum `Worker` BullMQ é criado no processo da API)

---

### SI-03.9 — Endpoint POST /videos (pré-cadastro do rascunho + início do multipart)

**Route:** POST /videos
**Test Specs:** see `nestjs-project/specs/videos-create.plan.md`
**Authorization:** Authenticated (vídeo criado no canal do usuário)

**Description:** Ao iniciar o upload, cria automaticamente o vídeo como rascunho no canal do usuário, abre o multipart S3 e devolve as URLs presigned de cada parte, para que até 10GB sigam direto do cliente ao storage.

**Technical actions:**

1. Em `src/channels/channels.service.ts`, adicionar `findByUserId(userId: string): Promise<Channel | null>`; `VideosModule` importa `ChannelsModule`, `StorageModule` e `VideoQueueModule`
2. Criar `src/videos/dto/create-video-upload.dto.ts` — `CreateVideoUploadDto` (`filename`, `mime_type`, `size`, `title?`, regras de `#### Validation Rules — Videos`) e `src/videos/dto/video-upload-response.dto.ts` — DTOs de resposta com `@ApiProperty` (`VideoUploadPartUrlDto { part_number, url }`, `CreateVideoUploadResponseDto { public_id, status, part_size, part_count, parts, expires_in }`)
3. Criar `src/videos/videos.service.ts` — `initUpload(userId, dto)`: rejeita `size > upload.maxSizeBytes` com `UploadSizeExceededException`; resolve o canal do usuário; salva o `Video` (`status: 'draft'`, `title = dto.title ?? dto.filename`, `original_filename`, `mime_type`, `declared_size = size`, `part_size = upload.partSizeBytes`) com `public_id = generatePublicId()`, regerando em violação `23505` de `public_id` até `PUBLIC_ID_MAX_ATTEMPTS`; chama `createMultipartUpload(videoSourceKey(video.id), mime_type)` e persiste `upload_id`; gera `ceil(size / part_size)` URLs `presignUploadPart` com TTL `upload.partUrlTtlSeconds` (per `phase-03-videos/TD-02`, `phase-03-videos/TD-04`, `phase-03-videos/TD-10`)
4. Criar `src/videos/videos.controller.ts` — `@SkipThrottle()` + `@ApiTags('videos')` + `@Controller('videos')`; `@Post()` com `@HttpCode(201)`, `@ApiBearerAuth('access-token')`, `@ApiOperation`, `@ApiResponse` 201 (`CreateVideoUploadResponseDto`), 400 e 401 com `getSchemaPath(ApiErrorEnvelope)`; usa `@CurrentUser()` e delega a `VideosService.initUpload` (per `openapi-docs-nestjs/TD-01`, `phase-02-auth/TD-08`)
5. Registrar `VideosController` e `VideosService` em `VideosModule` (`imports` → `controllers` → `providers` → `exports`), exportando `VideosService` para o worker

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.initUpload` | Unit: rejeita `size` acima do máximo sem tocar repo/storage; `title` default = `filename`; `part_count = ceil(size / part_size)`; regera `public_id` em colisão `23505` e falha após o limite (mock repo/storage) | `nestjs-project/src/videos/videos.service.spec.ts` |
| `VideosService.initUpload` | Integration (Postgres + MinIO reais): linha `draft` persistida com `channel_id`, `upload_id`, `declared_size`, `part_size`; multipart existe no MinIO (`listParts` vazio); URLs devolvidas têm o host de `STORAGE_PUBLIC_ENDPOINT` | `nestjs-project/src/videos/videos.service.integration-spec.ts` |
| `ChannelsService.findByUserId` | Integration: retorna o canal do usuário e `null` para usuário sem canal | `nestjs-project/src/channels/channels.service.integration-spec.ts` |

_E2E rows omitted — os cenários HTTP desta rota ficam no spec gerado por `/plan-test-specs` (campo **Test Specs:**)._

**Dependencies:** SI-03.5, SI-03.6, SI-03.7, SI-03.8

**Acceptance criteria:**

- `POST /videos` com `{ filename: 'clip.mp4', mime_type: 'video/mp4', size: 10737418240 }` e token válido retorna `201` com `status: 'draft'`, `part_size: 104857600`, `part_count: 103` e 103 URLs de parte
- Após o `201`, existe um vídeo `draft` no canal do usuário com `title = 'clip.mp4'`, `public_id` de 11 caracteres e `upload_id` preenchido; o UUID do vídeo não aparece na resposta
- `POST /videos` com `size: 10737418241` retorna `400` com `error: 'VALIDATION_ERROR'` e nenhuma linha é criada
- `POST /videos` com `mime_type: 'image/png'` ou sem `filename` retorna `400` com `error: 'VALIDATION_ERROR'`
- `POST /videos` sem token retorna `401`
- Mais de 10 chamadas `POST /videos` no mesmo minuto não retornam `429` (endpoint fora do throttling de auth)

---

### SI-03.10 — Endpoint GET /videos/:publicId/upload (re-sign / retomada)

**Route:** GET /videos/:publicId/upload
**Test Specs:** see `nestjs-project/specs/videos-upload-resign.plan.md`
**Authorization:** Owner

**Description:** Permite retomar um upload de até 10GB após queda de conexão, reload ou expiração das URLs, devolvendo as partes já enviadas e URLs novas só para as faltantes, sem novo `init` e sem alterar linha nem fila.

**Technical actions:**

1. Em `VideosService`, criar `findOwnedByPublicId(userId, publicId): Promise<Video>` — resolve `public_id` → linha e lança `VideoNotFoundException` se não existir ou se `channel_id` ≠ canal do usuário (antes de qualquer checagem de estado); reutilizado pelos SIs de `complete`, `abort`, stream e download (per `phase-03-videos/TD-04` AMB-10, AMB-12)
2. Em `VideosService`, criar `resignUpload(userId, publicId)`: exige `status = 'draft'` (senão `InvalidVideoStateException`); `listParts(videoSourceKey(id), upload_id)` — `StorageUploadNotFoundError` vira `InvalidVideoStateException`; faltantes = `1..ceil(declared_size / part_size)` (valores persistidos, nunca o config atual) menos as enviadas; `presignUploadPart` para cada faltante com TTL `upload.partUrlTtlSeconds` (per `phase-03-videos/TD-02` IC-3, AMB-8)
3. Criar `ResignVideoUploadResponseDto` (`public_id`, `part_size`, `part_count`, `uploaded_parts: { part_number, etag }[]`, `parts: { part_number, url }[]`, `expires_in`) com `@ApiProperty`
4. Em `VideosController`, `@Get(':publicId/upload')` com `@ApiBearerAuth('access-token')`, `@ApiParam({ name: 'publicId' })`, `@ApiOperation`, `@ApiResponse` 200, 401, 404 e 409 (envelope compartilhado)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.resignUpload` / `findOwnedByPublicId` | Unit: não-dono → `VideoNotFoundException` mesmo com vídeo `ready`; não-`draft` → `InvalidVideoStateException`; faltantes calculadas com `declared_size`/`part_size` persistidos mesmo com config diferente; `StorageUploadNotFoundError` → `InvalidVideoStateException` | `nestjs-project/src/videos/videos.service.spec.ts` |
| `VideosService.resignUpload` | Integration (Postgres + MinIO reais): após PUT real da parte 1 de 2, devolve `uploaded_parts = [{ part_number: 1, etag }]` e URL só para a parte 2; linha e fila inalteradas; após `AbortMultipartUpload` direto no storage → `InvalidVideoStateException` | `nestjs-project/src/videos/videos.service.integration-spec.ts` |

_E2E rows omitted — os cenários HTTP desta rota ficam no spec gerado por `/plan-test-specs` (campo **Test Specs:**)._

**Dependencies:** SI-03.9

**Acceptance criteria:**

- `GET /videos/:publicId/upload` de um `draft` do próprio usuário com a parte 1 de 2 já enviada retorna `200` com `uploaded_parts` contendo a parte 1 e seu `ETag`, e `parts` contendo apenas a URL da parte 2
- A resposta usa o `part_size` persistido no `init` mesmo que `UPLOAD_PART_SIZE_BYTES` tenha mudado depois
- `GET /videos/:publicId/upload` de um vídeo de outro canal ou de `public_id` inexistente retorna `404` com `VIDEO_NOT_FOUND`
- `GET /videos/:publicId/upload` de um vídeo `processing`, `ready` ou `failed` retorna `409` com `INVALID_VIDEO_STATE`
- `GET /videos/:publicId/upload` após o multipart ter sido abortado retorna `409` com `INVALID_VIDEO_STATE`
- A chamada não muda `status` nem `upload_id` e não cria job na fila

---

### SI-03.11 — Endpoint POST /videos/:publicId/upload/complete (verificação + disparo do processamento)

**Route:** POST /videos/:publicId/upload/complete
**Test Specs:** see `nestjs-project/specs/videos-upload-complete.plan.md`
**Authorization:** Owner

**Description:** Ponto determinístico em que a API conclui o multipart, verifica o objeto montado e dispara automaticamente o processamento em segundo plano após o upload, de forma idempotente e segura para retry.

**Technical actions:**

1. Criar `src/videos/dto/complete-video-upload.dto.ts` — `CompleteVideoUploadDto { parts: CompletedPartDto[] }` e `CompletedPartDto { part_number, etag }` (regras de `#### Validation Rules — Videos`); `CompleteVideoUploadResponseDto { public_id, status }` com `@ApiProperty`
2. Em `VideosService.completeUpload(userId, publicId, dto)`: `findOwnedByPublicId`; `processing` → `producer.enqueue(video.id)` e retorna `{ public_id, status: 'processing' }` (re-enqueue idempotente, per `phase-03-videos/TD-01`, `phase-03-videos/TD-04` AMB-6); qualquer status ≠ `draft` → `InvalidVideoStateException`; números de parte ≠ exatamente `1..ceil(declared_size / part_size)`, cada um uma vez → `InvalidUploadPartsException` antes de qualquer chamada S3 (per `phase-03-videos/TD-04` AMB-14)
3. Ainda em `completeUpload`: `completeMultipartUpload` — `StorageInvalidPartsError` → `InvalidUploadPartsException` sem efeito colateral (upload continua aberto, per AMB-13); `StorageUploadNotFoundError` segue para o `headObject` (retry-safe, per AMB-11); `headObject(videoSourceKey(id))` — `StorageObjectNotFoundError` → `InvalidVideoStateException`; `ContentLength` ≠ `declared_size` → `deleteObject(videoSourceKey(id))` e `UploadVerificationFailedException`, linha continua `draft` (per AMB-7, AMB-8, IC-7)
4. Verificação aprovada: atualizar a linha para `status = 'processing'` e só então `producer.enqueue(video.id)` (`jobId` = UUID); um enqueue perdido após o commit é recuperado pelo próximo `complete` (ramo `processing`)
5. Em `VideosController`, `@Post(':publicId/upload/complete')` com `@HttpCode(202)`, `@ApiBearerAuth('access-token')`, `@ApiParam`, `@ApiBody`, `@ApiOperation`, `@ApiResponse` 202, 400, 401, 404, 409 e 422 (envelope compartilhado)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.completeUpload` | Unit: ramos `processing` (re-enqueue sem chamar S3), `ready`/`failed` → 409, lista incompleta/duplicada → 422 sem chamar S3, `StorageInvalidPartsError` → 422 sem `deleteObject`, `NoSuchUpload` + objeto presente → segue verificação, `NoSuchUpload` + objeto ausente → 409, tamanho divergente → `deleteObject` + 422 com linha `draft`, sucesso → update antes do enqueue | `nestjs-project/src/videos/videos.service.spec.ts` |
| `VideosService.completeUpload` | Integration (Postgres + MinIO + Redis reais): upload real de 2 partes → `processing` + job `jobId` = UUID; segundo `complete` → ainda um job; ETag adulterado → 422 com multipart ainda aberto (`listParts` ok); objeto menor que o declarado → objeto removido e linha `draft`; `complete` após `abort` → 409 | `nestjs-project/src/videos/videos.service.integration-spec.ts` |

_E2E rows omitted — os cenários HTTP desta rota ficam no spec gerado por `/plan-test-specs` (campo **Test Specs:**)._

**Dependencies:** SI-03.10 — reutiliza `findOwnedByPublicId`; SI-03.8 — producer

**Acceptance criteria:**

- `POST /videos/:publicId/upload/complete` com todas as partes e ETags corretos de um `draft` retorna `202` com `status: 'processing'` e cria na fila um job com `jobId` = UUID do vídeo
- Repetir o `complete` em um vídeo `processing` retorna `202` e a fila continua com um único job para o vídeo
- `complete` com `parts` faltando um número, repetindo um número ou com ETag inválido retorna `422` com `INVALID_UPLOAD_PARTS`; a linha continua `draft`, nada é enfileirado e um re-sign seguinte ainda funciona
- `complete` cujo objeto montado tem tamanho diferente do `size` declarado no `init` retorna `422` com `UPLOAD_VERIFICATION_FAILED`, a linha continua `draft` e `videos/{videoId}/source` deixa de existir
- `complete` em vídeo `ready` ou `failed`, ou após `abort`, retorna `409` com `INVALID_VIDEO_STATE` sem efeito colateral
- `complete` em vídeo de outro canal retorna `404` com `VIDEO_NOT_FOUND`; body sem `parts` retorna `400` com `VALIDATION_ERROR`

---

### SI-03.12 — Endpoint DELETE /videos/:publicId/upload (abort idempotente)

**Route:** DELETE /videos/:publicId/upload
**Test Specs:** see `nestjs-project/specs/videos-upload-abort.plan.md`
**Authorization:** Owner

**Description:** Permite ao cliente abandonar um upload em rascunho, liberando as partes e qualquer objeto já montado; o rascunho permanece `draft` e chamadas repetidas têm a mesma resposta.

**Technical actions:**

1. Em `VideosService.abortUpload(userId, publicId)`: `findOwnedByPublicId`; status ≠ `draft` → `InvalidVideoStateException`; `abortMultipartUpload(videoSourceKey(id), upload_id)` ignorando `StorageUploadNotFoundError`; depois `deleteObject(videoSourceKey(id))` sempre (sucesso em chave ausente); linha continua `draft` (per `phase-03-videos/TD-04` AMB-9, IC-6, MD-1)
2. Em `VideosController`, `@Delete(':publicId/upload')` com `@HttpCode(204)`, `@ApiBearerAuth('access-token')`, `@ApiParam`, `@ApiOperation`, `@ApiResponse` 204 (sem `schema`), 401, 404 e 409 (envelope compartilhado)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.abortUpload` | Unit: não-`draft` → 409 sem chamar storage; `StorageUploadNotFoundError` é ignorado e `deleteObject` ainda roda; outros erros de storage propagam | `nestjs-project/src/videos/videos.service.spec.ts` |
| `VideosService.abortUpload` | Integration (Postgres + MinIO reais): após abort, `listParts` gera `StorageUploadNotFoundError`; abort repetido não falha; multipart já completado com linha `draft` → abort remove `videos/{videoId}/source` e `complete` seguinte → `InvalidVideoStateException` | `nestjs-project/src/videos/videos.service.integration-spec.ts` |

_E2E rows omitted — os cenários HTTP desta rota ficam no spec gerado por `/plan-test-specs` (campo **Test Specs:**)._

**Dependencies:** SI-03.10 — reutiliza `findOwnedByPublicId`

**Acceptance criteria:**

- `DELETE /videos/:publicId/upload` de um `draft` do próprio usuário retorna `204` sem body; o multipart deixa de existir e o vídeo continua `draft`
- Repetir o `DELETE` no mesmo vídeo retorna `204` novamente
- Após o `DELETE`, `POST /videos/:publicId/upload/complete` retorna `409` com `INVALID_VIDEO_STATE`, inclusive quando o multipart já tinha sido montado antes do abort
- `DELETE` em vídeo `processing`, `ready` ou `failed` retorna `409` com `INVALID_VIDEO_STATE`
- `DELETE` em vídeo de outro canal retorna `404` com `VIDEO_NOT_FOUND`

---

### SI-03.13 — FfmpegService (wrapper tipado de ffprobe/ffmpeg via spawn) e gerador de vídeo de teste

**Description:** Encapsula as duas invocações de FFmpeg da fase — extração de metadados e extração de um frame — com `child_process.spawn` e arrays de argumentos (sem shell), e fornece um vídeo de teste real gerado pelo próprio FFmpeg para as suítes de integração e E2E.

**Technical actions:**

1. Criar `src/video-processing/ffmpeg/ffmpeg.service.ts` — `FfmpegService.probe(input: string): Promise<ProbeResult>` executa `ffprobe -v error -print_format json -show_format -show_streams <input>` e mapeia `format.duration` → `durationSeconds`, `format.format_name` → `container_format`, `format.bit_rate` → `bitrate`, `format.size` → `size` e o primeiro stream de vídeo → `width`, `height`, `video_codec` (`codec_name`) (per `phase-03-videos/TD-08` AMB-4)
2. `FfmpegService.extractFrame(input, atSeconds, outputPath): Promise<void>` executa `ffmpeg -ss <atSeconds> -i <input> -frames:v 1 -vf scale=640:-2 -f image2 <outputPath>`; para entradas HTTP, acrescenta apenas opções existentes no FFmpeg 5.1 (`-reconnect 1 -reconnect_on_network_error 1 -reconnect_delay_max <n>`), conferidas com `ffmpeg -h protocol=http` na imagem (per `phase-03-videos/TD-08`, `phase-03-videos/TD-09`; `library-refs.md` § FFmpeg)
3. Erros: saída não-zero do ffprobe ou ausência de stream de vídeo → `MediaNotDecodableError` (`src/video-processing/ffmpeg/ffmpeg.errors.ts`); falha de spawn/HTTP → `FfmpegExecutionError` com stderr; nenhum erro é engolido
4. Criar `src/test/generate-test-video.ts` — helper de teste que gera, com `ffmpeg -f lavfi -i testsrc=duration=<s>:size=<w>x<h>:rate=25`, um MP4 em `os.tmpdir()` com tamanho alvo configurável (≥ 6 MiB para forçar 2 partes de 5 MiB nos testes) e retorna `{ path, size }`; e um arquivo de bytes aleatórios para o caminho "não decodificável"

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `FfmpegService` | Integration (FFmpeg real da imagem): `probe` de vídeo gerado retorna duração ≈ a gerada, `width`/`height`/`video_codec`/`container_format` corretos; `probe` de bytes aleatórios → `MediaNotDecodableError`; `extractFrame` gera JPEG de largura 640; `probe` via URL presigned interna do MinIO (range reads) funciona | `nestjs-project/src/video-processing/ffmpeg/ffmpeg.service.integration-spec.ts` |

**Dependencies:** SI-03.2 — FFmpeg instalado na imagem; SI-03.5 — URL presigned interna para o caso HTTP

**Acceptance criteria:**

- `probe` de um MP4 de 3 s 320x240 gerado no teste retorna `durationSeconds` entre 2,9 e 3,1, `width: 320`, `height: 240` e `video_codec`/`container_format` não vazios
- `probe` de um arquivo que não é vídeo rejeita com `MediaNotDecodableError`
- `extractFrame(input, 0.3, out.jpg)` cria um JPEG válido com largura 640 e altura par
- `probe` recebendo uma URL presigned assinada para `STORAGE_ENDPOINT` lê o objeto do MinIO sem baixá-lo para o disco do container

---

### SI-03.14 — Processamento do vídeo: VideoProcessingService e VideoProcessingConsumer

**Description:** Implementa o job em segundo plano que extrai duração e metadados, gera a thumbnail a partir de um frame e leva o vídeo a `ready`, com retries limitados e estado terminal `failed` mantendo os dados.

**Technical actions:**

1. Em `VideosService`, adicionar as transições de estado usadas pelo worker: `findProcessingById(id): Promise<Video | null>`, `markReady(id, { duration_seconds, metadata })` e `markFailed(id)` — cada update condicionado a `status = 'processing'` (a regra de estado fica no dono da entidade) (per `phase-03-videos/TD-05`, `phase-03-videos/TD-06`)
2. Criar `src/video-processing/video-processing.service.ts` — `process(videoId)`: vídeo não-`processing` → retorna sem efeito (job reexecutado é idempotente); `presignGetInternal(videoSourceKey(id), DELIVERY_URL_TTL_SECONDS)`; `ffmpeg.probe(url)`; `MediaNotDecodableError` → lança `UnrecoverableError` do `bullmq`; `extractFrame(url, duration * 0.1, <tmp>.jpg)`; `putObject(videoThumbnailKey(id), jpeg, 'image/jpeg')`; remove o arquivo temporário (`finally`); `markReady` com `duration_seconds` e `metadata { width, height, video_codec, container_format, bitrate, size }` (per `phase-03-videos/TD-08`, `phase-03-videos/TD-09`)
3. Criar `src/video-processing/video-processing.consumer.ts` — `@Processor(VIDEO_PROCESSING_QUEUE, { concurrency: 1 })` estendendo `WorkerHost`; `process(job)` delega a `VideoProcessingService.process(job.data.videoId)`; `@OnWorkerEvent('failed')` chama `markFailed` quando `err` é `UnrecoverableError` ou `job.attemptsMade >= job.opts.attempts`, registrando o erro em log (contexto de background task: log sem rethrow) (per `phase-03-videos/TD-06`)
4. Criar `src/video-processing/video-processing.module.ts` — `VideoProcessingModule` importando `VideoQueueModule`, `StorageModule` e `VideosModule`; providers `FfmpegService`, `VideoProcessingService`, `VideoProcessingConsumer`; importado **somente** pelo `WorkerModule` (per `phase-03-videos/TD-07`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoProcessingService` | Unit: vídeo ausente/não-`processing` → sem chamadas a storage/ffmpeg; `MediaNotDecodableError` → `UnrecoverableError` sem `putObject`; thumbnail em 10% da duração; arquivo temporário removido em sucesso e falha (mock storage/ffmpeg/VideosService) | `nestjs-project/src/video-processing/video-processing.service.spec.ts` |
| `VideoProcessingService` | Integration (Postgres + MinIO + FFmpeg reais): vídeo gerado enviado ao MinIO, linha `processing` → após `process`, linha `ready` com `duration_seconds` e `metadata` preenchidos e `videos/{videoId}/thumbnail.jpg` existente (JPEG, largura 640); bytes aleatórios → `UnrecoverableError` e objeto source mantido | `nestjs-project/src/video-processing/video-processing.service.integration-spec.ts` |
| `VideoProcessingConsumer` | Unit: `onFailed` marca `failed` em `UnrecoverableError` e na última tentativa; não marca em tentativas intermediárias | `nestjs-project/src/video-processing/video-processing.consumer.spec.ts` |
| `VideosService` transições | Integration: `markReady`/`markFailed` só alteram linhas `processing` | `nestjs-project/src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.11 — vídeos chegam a `processing` e o `VideosService` existe; SI-03.13 — `FfmpegService`

**Acceptance criteria:**

- Processar um vídeo `processing` válido deixa a linha `ready` com `duration_seconds` > 0 e `metadata` contendo `width`, `height`, `video_codec`, `container_format`, `bitrate` e `size`
- Após o processamento existe `videos/{videoId}/thumbnail.jpg` no bucket, JPEG com largura 640, extraído do frame em 10% da duração
- Um arquivo que o ffprobe não decodifica leva o vídeo a `failed` sem novas tentativas; linha e `videos/{videoId}/source` continuam existindo
- Uma falha transitória é retentada até 3 tentativas com backoff exponencial; esgotadas, o vídeo fica `failed`
- Reprocessar um job de um vídeo já `ready` não altera a linha nem a thumbnail

---

### SI-03.15 — Entrypoint do worker e wiring do container video-worker

**Description:** Dá ao worker o seu próprio entrypoint no mesmo codebase, sem servidor HTTP, para rodar isolado no container `video-worker` e consumir a fila `video-processing`.

**Technical actions:**

1. Criar `src/worker.module.ts` — `WorkerModule` importando `CoreModule` e `VideoProcessingModule` (sem controllers HTTP, sem `AuthModule`) (per `phase-03-videos/TD-07`)
2. Criar `src/worker.ts` — `NestFactory.createApplicationContext(WorkerModule)` seguido de `app.enableShutdownHooks()`, para que o `onApplicationShutdown` do `@nestjs/bullmq` feche worker e fila no `SIGTERM` (`library-refs.md` § @nestjs/bullmq)
3. Adicionar ao `package.json` os scripts `start:worker:dev` (`nest start --watch --entryFile worker`) e `start:worker:prod` (`node dist/worker`)
4. No `compose.yaml`, o serviço `video-worker` roda `command: ["npm", "run", "start:worker:dev"]` com `restart: unless-stopped`, para que o worker suba consumindo a fila `video-processing` junto com a stack (`docker compose up -d`), como exige o escopo da fase ("um worker que a consome", container separado per `phase-03-videos/TD-07`). A regra do `nestjs-project/CLAUDE.md` de não iniciar a aplicação sem pedido continua valendo para o servidor HTTP (`nestjs-api`), que segue subindo ocioso

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `WorkerModule` | Integration (Postgres + Redis reais): `createApplicationContext(WorkerModule)` inicializa, resolve `VideoProcessingConsumer` e fecha sem handles abertos; `AppModule` compilado não contém `VideoProcessingConsumer` (API não consome jobs) | `nestjs-project/src/worker.module.integration-spec.ts` |

**Dependencies:** SI-03.14

**Acceptance criteria:**

- `docker compose up -d` deixa o `video-worker` executando `start:worker:dev`: o worker inicia sem abrir porta HTTP e passa a consumir a fila `video-processing` (`docker compose logs video-worker` mostra o worker conectado)
- Com o worker rodando, um vídeo levado a `processing` via `complete` chega a `ready` sem intervenção
- `docker compose stop video-worker` encerra o processo de forma limpa (fila e worker fechados pelos shutdown hooks)
- O processo da API (`nestjs-api`) não processa jobs mesmo com a fila populada

---

### SI-03.16 — Endpoint GET /videos/:publicId/stream (reprodução via streaming)

**Route:** GET /videos/:publicId/stream
**Test Specs:** see `nestjs-project/specs/videos-stream.plan.md`
**Authorization:** Owner

**Description:** Entrega ao dono uma URL presigned de curta duração do próprio storage, que atende `Range`/`206`, para reproduzir o vídeo sem download completo e sem os bytes passarem pela API nem pelo BFF.

**Technical actions:**

1. Em `VideosService.getStreamUrl(userId, publicId)`: `findOwnedByPublicId`; status ≠ `ready` → `InvalidVideoStateException`; `presignGetPublic(videoSourceKey(id), DELIVERY_URL_TTL_SECONDS)`; retorna `{ url, expires_in }` (per `phase-03-videos/TD-11` AMB-5, AMB-10, IC-1)
2. Criar `VideoDeliveryUrlResponseDto { url, expires_in }` com `@ApiProperty` (reutilizado pelo download)
3. Em `VideosController`, `@Get(':publicId/stream')` com `@ApiBearerAuth('access-token')`, `@ApiParam`, `@ApiOperation`, `@ApiResponse` 200, 401, 404 e 409 (envelope compartilhado); resposta JSON, sem redirect

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.getStreamUrl` | Unit: não-dono → 404 antes da checagem de estado; `draft`/`processing`/`failed` → 409; `ready` → URL sem `response-content-disposition` | `nestjs-project/src/videos/videos.service.spec.ts` |
| `VideosService.getStreamUrl` | Integration (Postgres + MinIO reais): URL devolvida responde `206` com `Content-Range` a um GET com `Range: bytes=0-1023` (com `STORAGE_PUBLIC_ENDPOINT` apontando para `minio:9000` no teste) | `nestjs-project/src/videos/videos.service.integration-spec.ts` |

_E2E rows omitted — os cenários HTTP desta rota ficam no spec gerado por `/plan-test-specs` (campo **Test Specs:**)._

**Dependencies:** SI-03.10 — reutiliza `findOwnedByPublicId`

**Acceptance criteria:**

- `GET /videos/:publicId/stream` de um vídeo `ready` do próprio usuário retorna `200` com `{ url, expires_in: 3600 }`, sem redirect
- Um GET na `url` devolvida com `Range: bytes=0-1023` retorna `206 Partial Content` com 1024 bytes
- A `url` é assinada para o host de `STORAGE_PUBLIC_ENDPOINT`
- `GET /videos/:publicId/stream` de vídeo `draft`, `processing` ou `failed` retorna `409` com `INVALID_VIDEO_STATE`
- `GET /videos/:publicId/stream` de vídeo de outro canal ou inexistente retorna `404` com `VIDEO_NOT_FOUND`; sem token retorna `401`

---

### SI-03.17 — Endpoint GET /videos/:publicId/download (download com disposition attachment)

**Route:** GET /videos/:publicId/download
**Test Specs:** see `nestjs-project/specs/videos-download.plan.md`
**Authorization:** Owner

**Description:** Permite ao dono baixar o vídeo pelo mesmo mecanismo do streaming, com a URL presigned forçando `Content-Disposition: attachment` e o nome original do arquivo.

**Technical actions:**

1. Criar `src/videos/content-disposition.util.ts` — `buildAttachmentDisposition(originalFilename)` que remove caracteres de controle, `"` e `\` e retorna `attachment; filename="<nome seguro>"` (per `phase-03-videos/TD-11`; `library-refs.md` § Download disposition)
2. Em `VideosService.getDownloadUrl(userId, publicId)`: mesma ordem de checagens do stream (404 → 409 se ≠ `ready`); `presignGetPublic(videoSourceKey(id), DELIVERY_URL_TTL_SECONDS, buildAttachmentDisposition(original_filename))`; retorna `{ url, expires_in }`
3. Em `VideosController`, `@Get(':publicId/download')` com `@ApiBearerAuth('access-token')`, `@ApiParam`, `@ApiOperation`, `@ApiResponse` 200 (`VideoDeliveryUrlResponseDto`), 401, 404 e 409 (envelope compartilhado)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `buildAttachmentDisposition` | Unit: aspas, barras invertidas e caracteres de controle removidos; nome comum preservado | `nestjs-project/src/videos/content-disposition.util.spec.ts` |
| `VideosService.getDownloadUrl` | Unit: 404 antes do 409; ≠ `ready` → 409; disposition repassada ao storage | `nestjs-project/src/videos/videos.service.spec.ts` |
| `VideosService.getDownloadUrl` | Integration (Postgres + MinIO reais): GET na URL devolvida responde `200` com `Content-Disposition: attachment; filename="<original_filename>"` e o corpo completo | `nestjs-project/src/videos/videos.service.integration-spec.ts` |

_E2E rows omitted — os cenários HTTP desta rota ficam no spec gerado por `/plan-test-specs` (campo **Test Specs:**)._

**Dependencies:** SI-03.16 — reutiliza `VideoDeliveryUrlResponseDto` e a regra de estado

**Acceptance criteria:**

- `GET /videos/:publicId/download` de um vídeo `ready` do próprio usuário retorna `200` com `{ url, expires_in: 3600 }`
- Um GET na `url` devolvida retorna o arquivo completo com `Content-Disposition: attachment; filename="clip.mp4"` para um vídeo enviado como `clip.mp4`
- `GET /videos/:publicId/download` de vídeo não-`ready` retorna `409` com `INVALID_VIDEO_STATE`; de outro canal retorna `404` com `VIDEO_NOT_FOUND`

---

### SI-03.18 — Verificação ponta a ponta do ciclo upload → processamento → streaming/download

**Description:** Prova o fluxo completo da fase contra a infraestrutura real do Compose (Postgres, Redis, MinIO, FFmpeg), sem mocks: upload multipart presigned de um vídeo gerado, processamento em segundo plano até `ready`, streaming com `206` e download com `attachment`.

**Technical actions:**

1. Criar `test/video-lifecycle.e2e-spec.ts` — `beforeAll`: sobrescrever `STORAGE_PUBLIC_ENDPOINT=http://minio:9000` (host do browser não é alcançável do container) e `UPLOAD_PART_SIZE_BYTES=5242880` antes de compilar; subir a API (`AppModule` + `ValidationPipe`/filtros globais como em `test/auth.e2e-spec.ts`) e o worker no mesmo processo (`NestFactory.createApplicationContext(WorkerModule)`); `beforeEach`: `cleanAllTables` e `obliterate({ force: true })` da fila; `afterAll`: fechar API e worker
2. Fluxo: registrar + confirmar + logar um usuário; gerar com `generate-test-video` um MP4 > 5 MiB (2 partes); `POST /videos`; `fetch` PUT de cada parte nas URLs devolvidas lendo o `ETag`; `POST /videos/:publicId/upload/complete`; aguardar com polling limitado (timeout explícito) a linha chegar a `ready`
3. Asserções finais: `duration_seconds` e `metadata` preenchidos; `videos/{videoId}/thumbnail.jpg` existe no MinIO; dois uploads geram `public_id` distintos; `GET /videos/:publicId/stream` → `fetch` com `Range: bytes=0-1023` responde `206`; `GET /videos/:publicId/download` → `fetch` responde com `Content-Disposition: attachment`; caminho de falha: bytes aleatórios declarados como `video/mp4` terminam em `failed`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| Ciclo de vida do vídeo (API + worker + storage + fila) | E2E: upload multipart real → `processing` → `ready` com metadados e thumbnail → stream `206` → download `attachment`; arquivo inválido → `failed`; `public_id` único por vídeo | `nestjs-project/test/video-lifecycle.e2e-spec.ts` |

**Dependencies:** SI-03.11, SI-03.15, SI-03.17

**Acceptance criteria:**

- Um vídeo real de duas partes enviado direto ao MinIO pelas URLs presigned passa por `draft` → `processing` → `ready` sem chamadas adicionais do cliente após o `complete`
- O vídeo `ready` tem `duration_seconds`, `metadata` e `videos/{videoId}/thumbnail.jpg`
- A URL de stream do vídeo `ready` responde `206 Partial Content` a uma requisição com `Range`
- A URL de download responde com `Content-Disposition: attachment`
- Dois vídeos enviados pelo mesmo usuário recebem `public_id` diferentes
- Um arquivo não decodificável termina em `failed` e permanece no banco e no storage

---

### SI-03.19 — OpenAPI: atualizar `openapi.json` exportado com os endpoints de vídeo

**Description:** Mantém o contrato consumido pelo frontend coerente com o código: os seis endpoints de vídeo aparecem no `openapi.json` exportado com respostas por status, envelope de erro e bearer auth (per `openapi-docs-nestjs/TD-01`, `openapi-docs-nestjs/TD-02`).

**Technical actions:**

1. Estender `src/openapi-export.integration-spec.ts` com asserções para `/videos`, `/videos/{publicId}/upload`, `/videos/{publicId}/upload/complete`, `/videos/{publicId}/stream` e `/videos/{publicId}/download`: métodos esperados, tag `videos`, `security` com `access-token`, códigos de resposta de `### API Contracts` e erros referenciando `ApiErrorEnvelope`
2. Regenerar `nestjs-project/openapi.json` com `docker compose exec nestjs-api npm run openapi:export` e versionar o arquivo

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `exportSpec` | Integration: documento exportado contém as rotas de vídeo com métodos, status (201/200/202/204/400/401/404/409/422) e `$ref` para `ApiErrorEnvelope` | `nestjs-project/src/openapi-export.integration-spec.ts` |

**Dependencies:** SI-03.9, SI-03.10, SI-03.11, SI-03.12, SI-03.16, SI-03.17

**Acceptance criteria:**

- `nestjs-project/openapi.json` contém `POST /videos`, `GET` e `DELETE /videos/{publicId}/upload`, `POST /videos/{publicId}/upload/complete`, `GET /videos/{publicId}/stream` e `GET /videos/{publicId}/download`
- Cada operação de vídeo declara `security` `access-token` e todas as respostas de erro documentadas apontam para `ApiErrorEnvelope`
- O `GET /api/docs-json` do Swagger (com `SWAGGER_ENABLED=true`) lista as mesmas rotas que o arquivo exportado

---

### SI-03.20 — Documentação: seção de vídeos nos CLAUDE.md coerente com o código

**Description:** Atualiza os CLAUDE.md da raiz e do `nestjs-project` para refletir a fila, o storage, o worker e os novos comandos/serviços reais desta fase.

**Technical actions:**

1. Em `CLAUDE.md` (raiz), trocar `**Message Queue** (TBD)` por `**Message Queue** (BullMQ on Redis)` e adicionar uma seção "Videos" descrevendo: upload multipart presigned direto ao MinIO (`init` / re-sign / `complete` / `abort`), ciclo `draft → processing → ready | failed`, fila `video-processing` (`jobId` = UUID), worker separado com FFmpeg/ffprobe, `public_id` como único identificador externo e streaming/download via URL presigned (per `phase-03-videos/TD-01` a `phase-03-videos/TD-11`)
2. Em `nestjs-project/CLAUDE.md`, atualizar "Services" (`redis`, `minio` com portas 9000/9001, `minio-bootstrap`, `video-worker`), a verificação de prontidão (`docker compose exec redis redis-cli ping`, `docker compose ps minio-bootstrap` com exit 0), os comandos `npm run start:worker:dev` / `start:worker:prod` executados em `video-worker` e a nota `STORAGE_ENDPOINT` (interno, `minio:9000`) vs `STORAGE_PUBLIC_ENDPOINT` (browser, `localhost:9000`)

**Tests:** _(empty — documentation only; coerência verificada pelos ACs contra o código)_

**Dependencies:** SI-03.15, SI-03.18

**Acceptance criteria:**

- O `CLAUDE.md` da raiz não contém mais `Message Queue** (TBD)` e possui a seção de vídeos citando apenas nomes que existem no código (fila `video-processing`, status `draft`/`processing`/`ready`/`failed`, rotas `/videos/...`)
- `nestjs-project/CLAUDE.md` lista `redis`, `minio`, `minio-bootstrap` e `video-worker` com as mesmas portas e nomes do `compose.yaml`
- Os comandos documentados (`npm run start:worker:dev`, checagens de prontidão) executam com sucesso no ambiente Docker

---

## Technical Specifications

### Data Model

#### Video

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK, generated | Identificador interno: chaves de storage (`videos/{videoId}/source`, `videos/{videoId}/thumbnail.jpg`), `jobId` da fila e FKs; nunca sai da API (per `phase-03-videos/TD-10`, `phase-03-videos/TD-03`, `phase-03-videos/TD-01`) |
| public_id | varchar(11) | unique, not null | Único identificador externo; gerado no `init` com `node:crypto` (random, base64url) (per `phase-03-videos/TD-10`) |
| channel_id | uuid | FK → channels.id, not null | Dono = canal do usuário autenticado (per `phase-03-videos/TD-04`) |
| title | varchar(255) | not null | Vem do body do `init`; default = nome original do arquivo (per `phase-03-videos/TD-04`) |
| original_filename | varchar(255) | not null | Base do `title` default e do `filename` da disposition de download (per `phase-03-videos/TD-04`, `phase-03-videos/TD-11`) |
| mime_type | varchar(100) | not null | Um de `video/mp4`, `video/webm`, `video/quicktime`, `video/x-matroska`; usado como `ContentType` do `CreateMultipartUpload` (per `phase-03-videos/TD-02`) |
| status | enum `videos_status_enum` | not null, default `'draft'`, values: `'draft'`, `'processing'`, `'ready'`, `'failed'` | Ciclo linear `draft` → `processing` → `ready` \| `failed` (per `phase-03-videos/TD-05`) |
| upload_id | varchar | nullable | `UploadId` do multipart S3 persistido no `init` (per `phase-03-videos/TD-02`, `phase-03-videos/TD-04`) |
| declared_size | bigint | not null | Tamanho declarado no `init`, em bytes; transformer bigint ↔ `number` (≤ 10 GiB cabe em safe integer) (per `phase-03-videos/TD-04` AMB-8) |
| part_size | integer | not null | Tamanho de parte usado no `init`, em bytes (per `phase-03-videos/TD-04` AMB-8) |
| duration_seconds | double precision | nullable | Preenchido pelo worker a partir de `format.duration` do ffprobe (per `phase-03-videos/TD-08`) |
| metadata | jsonb | nullable | `{ width, height, video_codec, container_format, bitrate, size }` vindos do ffprobe (per `phase-03-videos/TD-08`) |
| created_at | timestamp | not null, auto-generated | `@CreateDateColumn` |
| updated_at | timestamp | not null, auto-generated | `@UpdateDateColumn` |

**Relations:** Video → Channel (many-to-one via `channel_id`); Channel → Video (one-to-many, lado inverso adicionado em `Channel.videos`)
**Indexes:** `(public_id)` — unique; `(channel_id)` — FK
**Migration:** `CreateVideos` (gerada via CLI) cria a tabela `videos` e o tipo `videos_status_enum`; `down` remove ambos.

#### Channel (modificado)

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| — | — | — | Nenhuma coluna nova; apenas o lado inverso `@OneToMany(() => Video, (video) => video.channel) videos: Video[]` (regra "Always define both sides of a relationship") |

#### Object storage layout (bucket privado único)

| Key | Escrito por | Conteúdo |
|-----|-------------|----------|
| `videos/{videoId}/source` | Browser via `UploadPart` presigned + `CompleteMultipartUpload` (API) | Arquivo de vídeo original (per `phase-03-videos/TD-03`) |
| `videos/{videoId}/thumbnail.jpg` | Worker (`PutObject`) | JPEG do frame em 10% da duração, largura 640 (per `phase-03-videos/TD-08`) |

`{videoId}` é sempre o UUID PK, nunca o `public_id` (per `phase-03-videos/TD-03` AMB-3).

### API Contracts

Todos os endpoints abaixo exigem `Authorization: Bearer <access_token>` (guard JWT global), são isentos de rate limiting (`@SkipThrottle()` no `VideosController`, já que o `ThrottlerGuard` é `APP_GUARD` registrado em `src/auth/auth.module.ts`) e usam o envelope de erro `{ statusCode, error, message }` (per `phase-02-auth/TD-07`). O parâmetro `:publicId` é sempre o `public_id` do vídeo; o UUID nunca é aceito nem retornado (per `phase-03-videos/TD-10` AMB-12). URLs presigned devolvidas ao cliente são assinadas com `STORAGE_PUBLIC_ENDPOINT`; chamadas server-side usam `STORAGE_ENDPOINT` (per `phase-03-videos/TD-02` IC-1).

#### POST /videos (SI-03.9)

**Request headers:**
- Authorization: Bearer <access_token>
- Content-Type: application/json

**Request body:**
- filename: string, required — non-empty, max 255 characters
- mime_type: string, required — one of `video/mp4`, `video/webm`, `video/quicktime`, `video/x-matroska`
- size: integer, required — bytes, min 1, max `UPLOAD_MAX_SIZE_BYTES` (default 10737418240)
- title: string, optional — max 255 characters; default = `filename`

**Response 201:**
- public_id: string
- status: string (`'draft'`)
- part_size: number — bytes (persistido no `init`)
- part_count: number — `ceil(size / part_size)`
- parts: array of `{ part_number: number, url: string }` — uma URL `UploadPart` presigned por parte, TTL `UPLOAD_PART_URL_TTL_SECONDS`
- expires_in: number — segundos de validade das URLs

**Error responses:**
- 400 VALIDATION_ERROR: body inválido (campo ausente, `mime_type` fora da lista, `size` não inteiro/≤ 0) ou `size` acima do máximo configurado
- 401: access token ausente ou inválido

---

#### GET /videos/:publicId/upload (SI-03.10)

**Request headers:**
- Authorization: Bearer <access_token>

**Response 200:**
- public_id: string
- part_size: number
- part_count: number — `ceil(declared_size / part_size)` com os valores persistidos no `init`
- uploaded_parts: array of `{ part_number: number, etag: string }` — resultado paginado de `ListParts`
- parts: array of `{ part_number: number, url: string }` — URLs `UploadPart` presigned novas apenas para as partes faltantes
- expires_in: number

**Error responses:**
- 404 VIDEO_NOT_FOUND: vídeo inexistente ou de outro canal
- 409 INVALID_VIDEO_STATE: vídeo não está `draft`, ou o multipart foi abortado/expirou (S3 `NoSuchUpload`)
- 401: access token ausente ou inválido

---

#### POST /videos/:publicId/upload/complete (SI-03.11)

**Request headers:**
- Authorization: Bearer <access_token>
- Content-Type: application/json

**Request body:**
- parts: array, required, min 1 item — cada item `{ part_number: integer ≥ 1, etag: string non-empty }`

**Response 202:**
- public_id: string
- status: string (`'processing'`)

**Error responses:**
- 400 VALIDATION_ERROR: body inválido
- 404 VIDEO_NOT_FOUND: vídeo inexistente ou de outro canal
- 409 INVALID_VIDEO_STATE: vídeo `ready`/`failed`, ou `NoSuchUpload` sem objeto montado em `videos/{videoId}/source`
- 422 INVALID_UPLOAD_PARTS: números de parte diferentes de exatamente `1..part_count` (cada um uma vez), ou S3 `InvalidPart` / `InvalidPartOrder` / `EntityTooSmall`; sem efeito colateral, upload continua aberto
- 422 UPLOAD_VERIFICATION_FAILED: `HeadObject` `ContentLength` ≠ `declared_size`; objeto montado é descartado e a linha fica `draft`
- 401: access token ausente ou inválido

`complete` em vídeo já `processing` retorna `202` e re-enfileira com o mesmo `jobId` (idempotente; per `phase-03-videos/TD-01`, `phase-03-videos/TD-04` AMB-6).

---

#### DELETE /videos/:publicId/upload (SI-03.12)

**Request headers:**
- Authorization: Bearer <access_token>

**Response 204:** No content.

**Error responses:**
- 404 VIDEO_NOT_FOUND: vídeo inexistente ou de outro canal
- 409 INVALID_VIDEO_STATE: vídeo não está `draft`
- 401: access token ausente ou inválido

Repetido em `draft` é idempotente: `NoSuchUpload` do `AbortMultipartUpload` é ignorado e `DeleteObject` na source key sempre roda (per `phase-03-videos/TD-04` AMB-9, IC-6).

---

#### GET /videos/:publicId/stream (SI-03.16)

**Request headers:**
- Authorization: Bearer <access_token>

**Response 200:**
- url: string — presigned `GetObject` de `videos/{videoId}/source` (TTL 3600 s); o storage responde `Range` com `206 Partial Content`
- expires_in: number

**Error responses:**
- 404 VIDEO_NOT_FOUND: vídeo inexistente ou de outro canal
- 409 INVALID_VIDEO_STATE: vídeo não está `ready`
- 401: access token ausente ou inválido

---

#### GET /videos/:publicId/download (SI-03.17)

**Request headers:**
- Authorization: Bearer <access_token>

**Response 200:**
- url: string — presigned `GetObject` com `ResponseContentDisposition: attachment; filename="<original_filename sanitizado>"` (TTL 3600 s)
- expires_in: number

**Error responses:**
- 404 VIDEO_NOT_FOUND: vídeo inexistente ou de outro canal
- 409 INVALID_VIDEO_STATE: vídeo não está `ready`
- 401: access token ausente ou inválido

---

#### Validation Rules — Videos

| Field | Rule | Source |
|-------|------|--------|
| filename | `@IsString() @IsNotEmpty() @MaxLength(255)` | `phase-03-videos/TD-04` |
| title | `@IsOptional() @IsString() @MaxLength(255)` | `phase-03-videos/TD-04` |
| mime_type | `@IsIn(ACCEPTED_VIDEO_MIME_TYPES)` | `phase-03-videos/TD-02` AMB-1 |
| size | `@IsInt() @Min(1)` no DTO; `size ≤ UPLOAD_MAX_SIZE_BYTES` no service (valor vem do config, não é estático) | `phase-03-videos/TD-02` AMB-1, `phase-03-videos/TD-04` IC-7 |
| parts | `@IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => CompletedPartDto)` | `phase-03-videos/TD-02` AMB-2 |
| parts[].part_number | `@IsInt() @Min(1)` | `phase-03-videos/TD-04` AMB-14 |
| parts[].etag | `@IsString() @IsNotEmpty()` | `phase-03-videos/TD-02` |

### Authorization Matrix

| Endpoint | Anonymous | Authenticated | Owner (canal do usuário) | Notes |
|----------|-----------|---------------|--------------------------|-------|
| POST /videos | ✗ | ✓ | — | O vídeo é criado no canal do usuário autenticado |
| GET /videos/:publicId/upload | ✗ | ✗ (404) | ✓ | Não-dono recebe 404 `VIDEO_NOT_FOUND` antes de qualquer checagem de estado |
| POST /videos/:publicId/upload/complete | ✗ | ✗ (404) | ✓ | Idem |
| DELETE /videos/:publicId/upload | ✗ | ✗ (404) | ✓ | Idem |
| GET /videos/:publicId/stream | ✗ | ✗ (404) | ✓ | Owner-only na Fase 03 (todo vídeo ainda é rascunho; acesso público chega com publicação) (per `phase-03-videos/TD-11` AMB-5) |
| GET /videos/:publicId/download | ✗ | ✗ (404) | ✓ | Idem |

Anonymous → 401 (guard JWT global). Ordem fixa: resolver `public_id` → checar existência/dono (404) → checar estado (409) (per `phase-03-videos/TD-04` AMB-10, `phase-03-videos/TD-11`).

### Error Catalog

Formato herdado de `phase-02-auth/TD-07`: `{ statusCode: number, error: string, message: string }`. Novas exceções em `src/common/exceptions/domain.exception.ts`, mesmo estilo das existentes.

| Code | HTTP | Exception | Message | Trigger |
|------|------|-----------|---------|---------|
| VIDEO_NOT_FOUND | 404 | `VideoNotFoundException` | Video not found | `public_id` inexistente ou vídeo de outro canal em re-sign, `complete`, `abort`, stream, download |
| INVALID_VIDEO_STATE | 409 | `InvalidVideoStateException` | Video is not in a valid state for this operation | `complete` em `ready`/`failed`; `abort` ou re-sign em não-`draft`; re-sign após `NoSuchUpload`; `complete` após `NoSuchUpload` sem objeto montado; stream/download em não-`ready` |
| INVALID_UPLOAD_PARTS | 422 | `InvalidUploadPartsException` | Upload parts list is invalid | `complete` com números de parte ≠ `1..part_count` (cada um uma vez) ou S3 `InvalidPart` / `InvalidPartOrder` / `EntityTooSmall` |
| UPLOAD_VERIFICATION_FAILED | 422 | `UploadVerificationFailedException` | Uploaded file does not match the declared size | `HeadObject` `ContentLength` ≠ `declared_size` após `CompleteMultipartUpload` |
| VALIDATION_ERROR | 400 | `UploadSizeExceededException` (+ `ValidationExceptionFilter` existente para DTOs) | size must not be greater than {max} bytes | `POST /videos` com `size` > `UPLOAD_MAX_SIZE_BYTES` (DTO cobre os demais casos de 400) |

### Events/Messages

#### video-processing / `process`

**Payload:**

```json
{ "videoId": "uuid" }
```

**Job options:** `jobId` = `videoId` (UUID PK; dedup de job vivo); `attempts: 3`; `backoff: { type: 'exponential', delay: 1000 }` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-06`)

**Producer:** `VideoProcessingProducer` (API, `VideoQueueModule` — registra a fila sem `@Processor`) (per `phase-03-videos/TD-01`, `phase-03-videos/TD-07`)
**Consumer:** `VideoProcessingConsumer` (`@Processor('video-processing', { concurrency: 1 })`, `WorkerHost`) registrado só no `WorkerModule` do container `video-worker` (per `phase-03-videos/TD-07`)
**Trigger:** `POST /videos/:publicId/upload/complete` com verificação aprovada (`draft` → `processing`), ou `complete` repetido em vídeo já `processing` (re-enqueue idempotente) (per `phase-03-videos/TD-04`)
**Processing:** presigned GET interno (`STORAGE_ENDPOINT`) → `ffprobe -v error -print_format json -show_format -show_streams` → `duration_seconds` + `metadata` → `ffmpeg -ss <10% da duração> -i <url> -frames:v 1 -vf scale=640:-2 -f image2` → `PutObject videos/{videoId}/thumbnail.jpg` → `status = 'ready'` (per `phase-03-videos/TD-08`, `phase-03-videos/TD-09`)
**Failure:** mídia que o ffprobe não decodifica → `UnrecoverableError` (sem retry); erro transitório → retry com backoff; ao esgotar tentativas ou em erro irrecuperável, `status = 'failed'` e linha + objeto source são mantidos (per `phase-03-videos/TD-06`)
**Delivery semantics:** at-least-once (job pode reexecutar após stall/retry; o processamento é idempotente para um vídeo `processing`) (per `phase-03-videos/TD-01`)

---

## Dependency Map

```
SI-03.1 (root — DG-1, harness de migrations)
SI-03.2 (root — infra Compose + FFmpeg)
└── SI-03.3 — depends on SI-03.2 (hosts do .env.example)
    ├── SI-03.4 — CoreModule (Config + TypeORM + BullMQ)
    │   ├── SI-03.6 — depends on SI-03.1 + SI-03.4 (entidade Video + migration)
    │   └── SI-03.8 — producer da fila
    └── SI-03.5 — depends on SI-03.2 + SI-03.3 (StorageModule)
        └── SI-03.13 — depends on SI-03.2 + SI-03.5 (FfmpegService)
SI-03.7 (root — exceções de domínio + public_id)

SI-03.5 + SI-03.6 + SI-03.7 + SI-03.8
└── SI-03.9 — POST /videos
    └── SI-03.10 — GET /videos/:publicId/upload (findOwnedByPublicId)
        ├── SI-03.11 — depends on SI-03.10 + SI-03.8 (complete)
        ├── SI-03.12 — DELETE /videos/:publicId/upload
        └── SI-03.16 — GET /videos/:publicId/stream
            └── SI-03.17 — GET /videos/:publicId/download

SI-03.11 + SI-03.13
└── SI-03.14 — processamento (service + consumer)
    └── SI-03.15 — entrypoint do worker

SI-03.11 + SI-03.15 + SI-03.17
└── SI-03.18 — E2E do ciclo completo

SI-03.9 + SI-03.10 + SI-03.11 + SI-03.12 + SI-03.16 + SI-03.17
└── SI-03.19 — openapi.json

SI-03.15 + SI-03.18
└── SI-03.20 — CLAUDE.md
```

Linearized implementation order: SI-03.1 → SI-03.2 → SI-03.3 → SI-03.4 → SI-03.5 → SI-03.6 → SI-03.7 → SI-03.8 → SI-03.9 → SI-03.10 → SI-03.11 → SI-03.12 → SI-03.13 → SI-03.14 → SI-03.15 → SI-03.16 → SI-03.17 → SI-03.18 → SI-03.19 → SI-03.20

---

## Deliverables

- [ ] SI-03.1 — Tornar o harness de migrations re-executável
- [ ] SI-03.2 — Infra: Redis, MinIO, bootstrap do bucket, serviço video-worker e FFmpeg na imagem
- [ ] SI-03.3 — Dependências, namespaces de configuração e validação de env
- [ ] SI-03.4 — CoreModule compartilhado (Config + TypeORM + conexão BullMQ)
- [ ] SI-03.5 — StorageModule: clientes S3 interno/público e operações multipart
- [ ] SI-03.6 — Entidade Video, migration CreateVideos e extensão do harness de testes
- [ ] SI-03.7 — Exceções de domínio de vídeo e gerador de public_id
- [ ] SI-03.8 — VideoQueueModule e producer do job de processamento
- [ ] SI-03.9 — Endpoint POST /videos (pré-cadastro do rascunho + início do multipart)
- [ ] SI-03.10 — Endpoint GET /videos/:publicId/upload (re-sign / retomada)
- [ ] SI-03.11 — Endpoint POST /videos/:publicId/upload/complete (verificação + disparo do processamento)
- [ ] SI-03.12 — Endpoint DELETE /videos/:publicId/upload (abort idempotente)
- [ ] SI-03.13 — FfmpegService (wrapper tipado de ffprobe/ffmpeg via spawn) e gerador de vídeo de teste
- [ ] SI-03.14 — Processamento do vídeo: VideoProcessingService e VideoProcessingConsumer
- [ ] SI-03.15 — Entrypoint do worker e wiring do container video-worker
- [ ] SI-03.16 — Endpoint GET /videos/:publicId/stream (reprodução via streaming)
- [ ] SI-03.17 — Endpoint GET /videos/:publicId/download (download com disposition attachment)
- [ ] SI-03.18 — Verificação ponta a ponta do ciclo upload → processamento → streaming/download
- [ ] SI-03.19 — OpenAPI: atualizar `openapi.json` exportado com os endpoints de vídeo
- [ ] SI-03.20 — Documentação: seção de vídeos nos CLAUDE.md coerente com o código

**Full test suites:**

- [ ] Backend tests pass (`docker compose exec nestjs-api npm test -- --runInBand`)
- [ ] E2E tests pass (`docker compose exec nestjs-api npm run test:e2e`)
- [ ] Type/compilation checks pass (`docker compose exec nestjs-api npx tsc --noEmit`)
- [ ] Lint passes (`docker compose exec nestjs-api npm run lint`)
- [ ] Project builds successfully (`docker compose exec nestjs-api npm run build`) — `dist/main.js` e `dist/worker.js` gerados
