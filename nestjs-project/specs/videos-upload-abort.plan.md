---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.12
target_file: test/videos-upload-abort.e2e-spec.ts
---

# DELETE /videos/:publicId/upload — Test Plan

## Application Overview

`DELETE /videos/:publicId/upload` permite ao dono abandonar um upload em rascunho: aborta o multipart no MinIO (ignorando `NoSuchUpload`) e sempre executa `DeleteObject` em `videos/{videoId}/source`, liberando as partes e qualquer objeto já montado. O vídeo continua `draft` e a resposta é `204` sem body, inclusive em chamadas repetidas (idempotente). Não-dono → 404 `VIDEO_NOT_FOUND` antes da checagem de estado; vídeo não-`draft` → 409 `INVALID_VIDEO_STATE`.

## Test Scenarios

### 1. DELETE /videos/:publicId/upload (SI-03.12)

**Setup:** `beforeAll`: sobrescrever `STORAGE_PUBLIC_ENDPOINT=http://minio:9000` (host do browser não alcançável de dentro do container) e `UPLOAD_PART_SIZE_BYTES=5242880` antes de compilar; `Test.createTestingModule({ imports: [AppModule] }).compile()` com a config global de `main.ts` reproduzida como em `test/auth.e2e-spec.ts` (`ValidationPipe` + `DomainExceptionFilter` + `ValidationExceptionFilter`), contra Postgres, Redis e MinIO reais do Compose; `StorageService` obtido via `app.get` para inspeção/fixture direta no storage; `beforeEach`: `cleanAllTables(dataSource)`, `throttlerStorage.storage.clear()` e `obliterate({ force: true })` da fila `video-processing`; helper `registerConfirmAndLogin` (padrão de `test/auth.e2e-spec.ts`) para os usuários A (dono) e B (outro canal); fixture de rascunho de 2 partes: POST /videos como A com `{ filename: 'clip.mp4', mime_type: 'video/mp4', size: 6291456 }` e `fetch` PUT de bytes aleatórios nas URLs presigned (parte 1 = 5242880 bytes, parte 2 = 1048576 bytes), lendo o `ETag`; `afterAll`: `app.close()`.

#### 1.1. abort-de-draft-retorna-204-e-remove-multipart

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-20T11:42:37Z

**Steps:**
  1. Criar o rascunho de 2 partes como A e enviar a parte 1
  2. DELETE /videos/:publicId/upload com o token de A
    - expect: status `204` e corpo vazio
  3. Inspecionar storage e banco
    - expect: `StorageService.listParts(videoSourceKey(<uuid>), <upload_id>)` rejeita com `StorageUploadNotFoundError` (multipart deixou de existir)
    - expect: a linha continua `draft`

#### 1.2. abort-repetido-retorna-204

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-20T11:42:37Z

**Steps:**
  1. Criar o rascunho de 2 partes como A e chamar DELETE /videos/:publicId/upload com o token de A
    - expect: status `204`
  2. Repetir DELETE /videos/:publicId/upload no mesmo vídeo
    - expect: status `204` e corpo vazio
    - expect: a linha continua `draft`

#### 1.3. complete-apos-abort-retorna-409-inclusive-com-objeto-montado

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-20T11:42:37Z

**Steps:**
  1. Criar o rascunho de 2 partes como A, enviar as 2 partes, chamar DELETE /videos/:publicId/upload e em seguida POST /videos/:publicId/upload/complete com as partes e ETags corretos
    - expect: DELETE responde `204`
    - expect: complete responde `409` com `error: 'INVALID_VIDEO_STATE'`
  2. Criar outro rascunho de 2 partes como A, enviar as 2 partes e montar o multipart direto no storage (`StorageService.completeMultipartUpload(videoSourceKey(<uuid>), <upload_id>, parts)`), mantendo a linha `draft`
    - expect: `HeadObject` em `videos/{videoId}/source` encontra o objeto montado
  3. DELETE /videos/:publicId/upload desse segundo vídeo com o token de A
    - expect: status `204`
    - expect: `HeadObject` em `videos/{videoId}/source` responde não encontrado (objeto removido)
  4. POST /videos/:publicId/upload/complete desse segundo vídeo com as partes corretas
    - expect: status `409` com `INVALID_VIDEO_STATE`
    - expect: a linha continua `draft` e a fila `video-processing` não tem job para o vídeo

#### 1.4. estado-nao-draft-retorna-409

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-20T11:42:37Z

**Steps:**
  1. Criar o rascunho de 2 partes como A; para cada `status` em `processing`, `ready` e `failed`, atualizar a linha via `DataSource` e chamar DELETE /videos/:publicId/upload com o token de A
    - expect: em cada caso, status `409` e body `{ statusCode: 409, error: 'INVALID_VIDEO_STATE', message: 'Video is not in a valid state for this operation' }`
    - expect: a linha mantém o `status` atribuído e o multipart continua existindo (`listParts` não rejeita)

#### 1.5. nao-dono-retorna-404

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-20T11:42:37Z

**Steps:**
  1. Criar o rascunho de 2 partes como A; DELETE /videos/:publicId/upload com o token de B
    - expect: status `404` e body `{ statusCode: 404, error: 'VIDEO_NOT_FOUND', message: 'Video not found' }`
    - expect: o multipart de A continua existindo (`listParts` não rejeita) e a linha continua `draft`
  2. DELETE /videos/:publicId/upload do vídeo de A sem header `Authorization` (Authorization Matrix: Anonymous ✗)
    - expect: status `401`
