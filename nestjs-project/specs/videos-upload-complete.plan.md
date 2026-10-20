---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.11
target_file: test/videos-upload-complete.e2e-spec.ts
---

# POST /videos/:publicId/upload/complete — Test Plan

## Application Overview

`POST /videos/:publicId/upload/complete` é o ponto determinístico em que a API conclui o multipart (`CompleteMultipartUpload` no MinIO), verifica o objeto montado (`HeadObject` `ContentLength` = `declared_size`) e, aprovada a verificação, move o vídeo de `draft` para `processing` e enfileira o job `process` na fila `video-processing` com `jobId` = UUID do vídeo. É idempotente: repetir em vídeo `processing` devolve `202` e re-enfileira com o mesmo `jobId` (sem duplicar job). Lista de partes inválida → 422 `INVALID_UPLOAD_PARTS` sem efeito colateral; tamanho divergente → 422 `UPLOAD_VERIFICATION_FAILED` com o objeto descartado e a linha em `draft`; `ready`/`failed` ou multipart abortado sem objeto → 409 `INVALID_VIDEO_STATE`; não-dono → 404 `VIDEO_NOT_FOUND` antes de qualquer checagem de estado.

## Test Scenarios

### 1. POST /videos/:publicId/upload/complete (SI-03.11)

**Setup:** `beforeAll`: sobrescrever `STORAGE_PUBLIC_ENDPOINT=http://minio:9000` (host do browser não alcançável de dentro do container) e `UPLOAD_PART_SIZE_BYTES=5242880` antes de compilar; `Test.createTestingModule({ imports: [AppModule] }).compile()` com a config global de `main.ts` reproduzida como em `test/auth.e2e-spec.ts` (`ValidationPipe` + `DomainExceptionFilter` + `ValidationExceptionFilter`), contra Postgres, Redis e MinIO reais do Compose; nenhum worker é iniciado neste spec (o job fica na fila para inspeção); `Queue` obtida via `app.get(getQueueToken('video-processing'))`; `beforeEach`: `cleanAllTables(dataSource)`, `throttlerStorage.storage.clear()` e `obliterate({ force: true })` da fila; helper `registerConfirmAndLogin` (padrão de `test/auth.e2e-spec.ts`) para os usuários A (dono) e B (outro canal); fixture de rascunho de 2 partes: POST /videos como A com `{ filename: 'clip.mp4', mime_type: 'video/mp4', size: 6291456 }` (`part_count: 2`) e `fetch` PUT de bytes aleatórios em cada URL presigned (parte 1 = 5242880 bytes, parte 2 = 1048576 bytes), lendo o header `ETag` de cada resposta; `afterAll`: `app.close()`.

#### 1.1. complete-valido-move-para-processing-e-enfileira

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-20T11:42:37Z

**Steps:**
  1. Criar o rascunho de 2 partes como A e enviar as 2 partes
  2. POST /videos/:publicId/upload/complete com o token de A e body `{ parts: [{ part_number: 1, etag: <ETag 1> }, { part_number: 2, etag: <ETag 2> }] }`
    - expect: status `202` e body `{ public_id: <public_id>, status: 'processing' }`
  3. Inspecionar banco, fila e storage
    - expect: a linha está `processing`
    - expect: `queue.getJob(<uuid do vídeo>)` retorna um job `process` com payload `{ videoId: <uuid> }`
    - expect: `videos/{videoId}/source` existe no MinIO com `ContentLength = 6291456`

#### 1.2. complete-repetido-em-processing-e-idempotente

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-20T11:42:37Z

**Steps:**
  1. Executar o fluxo do cenário 1.1 até o `202`
  2. Repetir POST /videos/:publicId/upload/complete com o mesmo body e o token de A
    - expect: status `202` e body `{ public_id: <public_id>, status: 'processing' }`
  3. Inspecionar a fila
    - expect: existe exatamente um job na fila `video-processing` para o vídeo (`jobId` = UUID); a contagem total de jobs da fila é 1

#### 1.3. lista-de-partes-invalida-retorna-422-sem-efeito

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-20T11:42:37Z

**Steps:**
  1. Criar o rascunho de 2 partes como A e enviar as 2 partes
  2. POST complete com `parts` faltando um número: `[{ part_number: 1, etag: <ETag 1> }]`
    - expect: status `422` e body `{ statusCode: 422, error: 'INVALID_UPLOAD_PARTS', message: 'Upload parts list is invalid' }`
  3. POST complete repetindo um número: `[{ part_number: 1, etag: <ETag 1> }, { part_number: 1, etag: <ETag 1> }]`
    - expect: status `422` com `INVALID_UPLOAD_PARTS`
  4. POST complete com ETag adulterado: `[{ part_number: 1, etag: <ETag 1> }, { part_number: 2, etag: '"00000000000000000000000000000000"' }]`
    - expect: status `422` com `INVALID_UPLOAD_PARTS`
  5. Inspecionar banco e fila
    - expect: a linha continua `draft` com o mesmo `upload_id`
    - expect: a fila `video-processing` não tem job para o vídeo
  6. GET /videos/:publicId/upload com o token de A
    - expect: status `200` com `uploaded_parts` contendo as partes 1 e 2 (multipart continua aberto; re-sign ainda funciona)

#### 1.4. tamanho-divergente-retorna-422-e-descarta-objeto

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-20T11:42:37Z

**Steps:**
  1. Criar o rascunho de 2 partes como A (declarado `size: 6291456`) e enviar a parte 1 com 5242880 bytes e a parte 2 com 524288 bytes (objeto montado = 5767168 bytes)
  2. POST complete com as 2 partes e seus ETags corretos
    - expect: status `422` e body `{ statusCode: 422, error: 'UPLOAD_VERIFICATION_FAILED', message: 'Uploaded file does not match the declared size' }`
  3. Inspecionar banco, fila e storage
    - expect: a linha continua `draft`
    - expect: `HeadObject` em `videos/{videoId}/source` responde não encontrado (objeto removido)
    - expect: a fila `video-processing` não tem job para o vídeo

#### 1.5. ready-failed-ou-apos-abort-retorna-409

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-20T11:42:37Z

**Steps:**
  1. Criar o rascunho de 2 partes como A, enviar as 2 partes e, para cada `status` em `ready` e `failed`, atualizar a linha via `DataSource` e chamar POST complete com as partes corretas
    - expect: em cada caso, status `409` e body `{ statusCode: 409, error: 'INVALID_VIDEO_STATE', message: 'Video is not in a valid state for this operation' }`
    - expect: a linha mantém o `status` atribuído e a fila não tem job para o vídeo
  2. Criar outro rascunho de 2 partes como A, enviar as 2 partes e chamar DELETE /videos/:publicId/upload com o token de A
    - expect: status `204`
  3. POST complete nesse segundo vídeo com as partes corretas
    - expect: status `409` com `INVALID_VIDEO_STATE`
    - expect: a linha continua `draft` e a fila não tem job para o vídeo

#### 1.6. nao-dono-404-e-body-sem-parts-400

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-10-20T11:42:37Z

**Steps:**
  1. Criar o rascunho de 2 partes como A e enviar as 2 partes; POST complete com as partes corretas e o token de B
    - expect: status `404` e body `{ statusCode: 404, error: 'VIDEO_NOT_FOUND', message: 'Video not found' }`
    - expect: a linha de A continua `draft` e a fila não tem job
  2. POST complete no vídeo de A com o token de A e body `{}` (sem `parts`)
    - expect: status `400` com `error: 'VALIDATION_ERROR'`
  3. POST complete no vídeo de A sem header `Authorization` (Authorization Matrix: Anonymous ✗)
    - expect: status `401`
