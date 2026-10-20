---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.16
target_file: test/videos-stream.e2e-spec.ts
---

# GET /videos/:publicId/stream — Test Plan

## Application Overview

`GET /videos/:publicId/stream` entrega ao dono de um vídeo `ready` uma URL presigned `GetObject` de `videos/{videoId}/source`, assinada com `STORAGE_PUBLIC_ENDPOINT` e TTL de 3600 s, em resposta JSON `{ url, expires_in }` (sem redirect). O próprio storage atende `Range` com `206 Partial Content`, permitindo reproduzir sem download completo e sem os bytes passarem pela API. Owner-only na Fase 03: não-dono ou inexistente → 404 `VIDEO_NOT_FOUND` (antes do estado); não-`ready` → 409 `INVALID_VIDEO_STATE`; sem token → 401.

## Test Scenarios

### 1. GET /videos/:publicId/stream (SI-03.16)

**Setup:** `beforeAll`: sobrescrever `STORAGE_PUBLIC_ENDPOINT=http://minio:9000` (host do browser não alcançável de dentro do container) antes de compilar; `Test.createTestingModule({ imports: [AppModule] }).compile()` com a config global de `main.ts` reproduzida como em `test/auth.e2e-spec.ts` (`ValidationPipe` + `DomainExceptionFilter` + `ValidationExceptionFilter`), contra Postgres, Redis e MinIO reais do Compose; `beforeEach`: `cleanAllTables(dataSource)`, `throttlerStorage.storage.clear()` e `obliterate({ force: true })` da fila `video-processing`; helper `registerConfirmAndLogin` (padrão de `test/auth.e2e-spec.ts`) para os usuários A (dono) e B (outro canal); fixture de vídeo com objeto real: POST /videos como A com `{ filename: 'clip.mp4', mime_type: 'video/mp4', size: 4096 }` (1 parte), `fetch` PUT de 4096 bytes aleatórios na URL da parte lendo o `ETag`, POST /videos/:publicId/upload/complete (→ `processing`); o worker não roda neste spec (o ciclo com worker é coberto por SI-03.18), então o `status` desejado (`ready`, `draft`, `processing`, `failed`) é atribuído à linha via `DataSource`; `afterAll`: `app.close()`.

#### 1.1. ready-do-dono-retorna-url-de-streaming-com-range

**Covers AC:** #1, #2, #3
**Source:** auto
**Last sync:** 2026-10-20T11:42:37Z

**Steps:**
  1. Preparar o vídeo de A com objeto real e levar a linha a `ready`
  2. GET /videos/:publicId/stream com o token de A
    - expect: status `200` (não `3xx`) e nenhum header `Location`
    - expect: body `{ url: <string>, expires_in: 3600 }`
    - expect: `url` tem o host de `STORAGE_PUBLIC_ENDPOINT` configurado no processo de teste
    - expect: `url` não contém o parâmetro `response-content-disposition`
  3. `fetch` GET na `url` devolvida com header `Range: bytes=0-1023`
    - expect: status `206 Partial Content`
    - expect: header `Content-Range` começa com `bytes 0-1023/4096`
    - expect: corpo com exatamente 1024 bytes, iguais aos 1024 primeiros bytes enviados

#### 1.2. estado-nao-ready-retorna-409

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-20T11:42:37Z

**Steps:**
  1. Preparar o vídeo de A com objeto real; para cada `status` em `draft`, `processing` e `failed`, atualizar a linha via `DataSource` e chamar GET /videos/:publicId/stream com o token de A
    - expect: em cada caso, status `409` e body `{ statusCode: 409, error: 'INVALID_VIDEO_STATE', message: 'Video is not in a valid state for this operation' }`

#### 1.3. nao-dono-inexistente-404-e-sem-token-401

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-20T11:42:37Z

**Steps:**
  1. Preparar o vídeo de A com objeto real e levar a linha a `ready`; GET /videos/:publicId/stream com o token de B
    - expect: status `404` e body `{ statusCode: 404, error: 'VIDEO_NOT_FOUND', message: 'Video not found' }`
  2. Levar a linha a `draft` e repetir a chamada com o token de B
    - expect: status `404` com `VIDEO_NOT_FOUND` (checagem de dono antes da de estado)
  3. GET /videos/:publicId/stream com o token de A e um `public_id` inexistente de 11 caracteres
    - expect: status `404` com `VIDEO_NOT_FOUND`
  4. GET /videos/:publicId/stream do vídeo de A sem header `Authorization`
    - expect: status `401`
