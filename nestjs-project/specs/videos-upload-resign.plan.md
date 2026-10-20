---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.10
target_file: test/videos-upload-resign.e2e-spec.ts
---

# GET /videos/:publicId/upload — Test Plan

## Application Overview

`GET /videos/:publicId/upload` permite ao dono retomar um upload em rascunho após queda de conexão, reload ou expiração das URLs: devolve as partes já enviadas (`ListParts` paginado no MinIO) com seus ETags e URLs `UploadPart` presigned novas apenas para as partes faltantes, calculadas com `declared_size` / `part_size` persistidos no `init` (nunca o config atual). A chamada não altera a linha nem a fila. Ordem fixa das checagens: resolver `public_id` → existência/dono (404 `VIDEO_NOT_FOUND`) → estado (409 `INVALID_VIDEO_STATE` se não-`draft` ou se o multipart não existe mais).

## Test Scenarios

### 1. GET /videos/:publicId/upload (SI-03.10)

**Setup:** `beforeAll`: sobrescrever `STORAGE_PUBLIC_ENDPOINT=http://minio:9000` (o host do browser não é alcançável de dentro do container) e `UPLOAD_PART_SIZE_BYTES=5242880` antes de compilar; `Test.createTestingModule({ imports: [AppModule] }).compile()` com a config global de `main.ts` reproduzida como em `test/auth.e2e-spec.ts` (`ValidationPipe` + `DomainExceptionFilter` + `ValidationExceptionFilter`), contra Postgres, Redis e MinIO reais do Compose; `beforeEach`: `cleanAllTables(dataSource)`, `throttlerStorage.storage.clear()` e `obliterate({ force: true })` da fila `video-processing`; helper `registerConfirmAndLogin` (padrão de `test/auth.e2e-spec.ts`) para os usuários A (dono) e B (outro canal); fixture de rascunho de 2 partes: POST /videos como A com `{ filename: 'clip.mp4', mime_type: 'video/mp4', size: 6291456 }` (`part_count: 2`); envio de parte = `fetch` PUT de bytes aleatórios na URL presigned da parte, lendo o header `ETag`; `afterAll`: `app.close()`.

#### 1.1. retomada-devolve-parte-enviada-e-url-so-da-faltante

**Covers AC:** #1, #6
**Source:** auto
**Last sync:** 2026-10-20T11:42:37Z

**Steps:**
  1. Criar o rascunho de 2 partes como A e enviar por `fetch` PUT apenas a parte 1 (5242880 bytes), guardando o `ETag` devolvido
    - expect: o PUT responde `200` e expõe o header `ETag`
  2. Guardar via `DataSource` o `status` e o `upload_id` da linha
  3. GET /videos/:publicId/upload com o token de A
    - expect: status `200`
    - expect: body com `public_id` do vídeo, `part_size: 5242880`, `part_count: 2` e `expires_in` numérico
    - expect: `uploaded_parts` igual a `[{ part_number: 1, etag: <ETag do PUT> }]`
    - expect: `parts` contém um único item, `{ part_number: 2, url }`, com `url` no host de `STORAGE_PUBLIC_ENDPOINT`
  4. Reconsultar a linha e a fila
    - expect: `status` continua `draft` e `upload_id` igual ao guardado no passo 2
    - expect: a fila `video-processing` não tem job com `jobId` = UUID do vídeo

#### 1.2. usa-part-size-persistido-apos-mudanca-de-config

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-20T11:42:37Z

**Steps:**
  1. Criar o rascunho de 2 partes como A (app com `UPLOAD_PART_SIZE_BYTES=5242880`)
    - expect: linha persistida com `part_size = 5242880` e `declared_size = 6291456`
  2. Subir uma segunda instância da aplicação (mesmo setup global, mesmos Postgres/MinIO) compilada com `UPLOAD_PART_SIZE_BYTES=10485760` e chamar GET /videos/:publicId/upload com o token de A nessa instância
    - expect: status `200`
    - expect: `part_size: 5242880` e `part_count: 2` (valores persistidos no `init`, não `10485760` / `1` do config atual)
    - expect: `parts` contém URLs para as partes 1 e 2 e `uploaded_parts` é vazio
  3. Fechar a segunda instância (`app.close()`)

#### 1.3. nao-dono-ou-inexistente-retorna-404

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-20T11:42:37Z

**Steps:**
  1. Criar o rascunho de 2 partes como A; chamar GET /videos/:publicId/upload com o token de B
    - expect: status `404` e body `{ statusCode: 404, error: 'VIDEO_NOT_FOUND', message: 'Video not found' }`
  2. Levar a linha de A a `ready` via `DataSource` e repetir a chamada com o token de B
    - expect: status `404` com `VIDEO_NOT_FOUND` (checagem de dono antes da de estado)
  3. GET /videos/:publicId/upload com o token de A e um `public_id` inexistente de 11 caracteres
    - expect: status `404` com `VIDEO_NOT_FOUND`
  4. GET /videos/:publicId/upload do vídeo de A sem header `Authorization` (Authorization Matrix: Anonymous ✗)
    - expect: status `401`

#### 1.4. estado-nao-draft-retorna-409

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-20T11:42:37Z

**Steps:**
  1. Criar o rascunho de 2 partes como A; para cada `status` em `processing`, `ready` e `failed`, atualizar a linha via `DataSource` e chamar GET /videos/:publicId/upload com o token de A
    - expect: em cada caso, status `409` e body `{ statusCode: 409, error: 'INVALID_VIDEO_STATE', message: 'Video is not in a valid state for this operation' }`
    - expect: a linha mantém o `status` atribuído e `upload_id` inalterado

#### 1.5. multipart-abortado-retorna-409

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-20T11:42:37Z

**Steps:**
  1. Criar o rascunho de 2 partes como A e abortar o multipart direto no storage (`StorageService.abortMultipartUpload(videoSourceKey(<uuid>), <upload_id>)` obtido via `app.get`)
  2. GET /videos/:publicId/upload com o token de A
    - expect: status `409` com `error: 'INVALID_VIDEO_STATE'`
    - expect: a linha continua `draft` com o mesmo `upload_id`
