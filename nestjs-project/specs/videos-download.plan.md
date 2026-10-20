---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.17
target_file: test/videos-download.e2e-spec.ts
---

# GET /videos/:publicId/download — Test Plan

## Application Overview

`GET /videos/:publicId/download` permite ao dono baixar um vídeo `ready` pelo mesmo mecanismo do streaming: devolve `{ url, expires_in: 3600 }` com uma URL presigned `GetObject` de `videos/{videoId}/source` assinada com `STORAGE_PUBLIC_ENDPOINT` e `ResponseContentDisposition: attachment; filename="<original_filename sanitizado>"`, de modo que o storage entregue o arquivo completo como anexo com o nome original. Mesma ordem de checagens do stream: não-dono ou inexistente → 404 `VIDEO_NOT_FOUND`; não-`ready` → 409 `INVALID_VIDEO_STATE`; sem token → 401.

## Test Scenarios

### 1. GET /videos/:publicId/download (SI-03.17)

**Setup:** `beforeAll`: sobrescrever `STORAGE_PUBLIC_ENDPOINT=http://minio:9000` (host do browser não alcançável de dentro do container) antes de compilar; `Test.createTestingModule({ imports: [AppModule] }).compile()` com a config global de `main.ts` reproduzida como em `test/auth.e2e-spec.ts` (`ValidationPipe` + `DomainExceptionFilter` + `ValidationExceptionFilter`), contra Postgres, Redis e MinIO reais do Compose; `beforeEach`: `cleanAllTables(dataSource)`, `throttlerStorage.storage.clear()` e `obliterate({ force: true })` da fila `video-processing`; helper `registerConfirmAndLogin` (padrão de `test/auth.e2e-spec.ts`) para os usuários A (dono) e B (outro canal); fixture de vídeo com objeto real: POST /videos como A com `{ filename: 'clip.mp4', mime_type: 'video/mp4', size: 4096 }` (1 parte), `fetch` PUT de 4096 bytes aleatórios na URL da parte lendo o `ETag`, POST /videos/:publicId/upload/complete (→ `processing`); o worker não roda neste spec (o ciclo com worker é coberto por SI-03.18), então o `status` desejado é atribuído à linha via `DataSource`; `afterAll`: `app.close()`.

#### 1.1. ready-do-dono-retorna-url-de-download-attachment

**Covers AC:** #1, #2
**Source:** auto
**Last sync:** 2026-10-20T11:42:37Z

**Steps:**
  1. Preparar o vídeo `clip.mp4` de A com objeto real e levar a linha a `ready`
  2. GET /videos/:publicId/download com o token de A
    - expect: status `200`
    - expect: body `{ url: <string>, expires_in: 3600 }`
    - expect: `url` tem o host de `STORAGE_PUBLIC_ENDPOINT` configurado no processo de teste
  3. `fetch` GET na `url` devolvida, sem header `Range`
    - expect: status `200`
    - expect: header `Content-Disposition` igual a `attachment; filename="clip.mp4"`
    - expect: corpo com os 4096 bytes enviados, byte a byte

#### 1.2. nao-ready-409-e-nao-dono-404

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-20T11:42:37Z

**Steps:**
  1. Preparar o vídeo de A com objeto real; para cada `status` em `draft`, `processing` e `failed`, atualizar a linha via `DataSource` e chamar GET /videos/:publicId/download com o token de A
    - expect: em cada caso, status `409` e body `{ statusCode: 409, error: 'INVALID_VIDEO_STATE', message: 'Video is not in a valid state for this operation' }`
  2. Levar a linha a `ready` e chamar GET /videos/:publicId/download com o token de B
    - expect: status `404` e body `{ statusCode: 404, error: 'VIDEO_NOT_FOUND', message: 'Video not found' }`
  3. Levar a linha a `draft` e repetir a chamada com o token de B
    - expect: status `404` com `VIDEO_NOT_FOUND` (checagem de dono antes da de estado)
  4. GET /videos/:publicId/download do vídeo de A sem header `Authorization` (Authorization Matrix: Anonymous ✗)
    - expect: status `401`
