---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.9
target_file: test/videos-create.e2e-spec.ts
---

# POST /videos — Test Plan

## Application Overview

`POST /videos` inicia o upload de um vídeo: cria automaticamente o vídeo como rascunho (`status: 'draft'`) no canal do usuário autenticado, abre o multipart S3 no MinIO (`videos/{videoId}/source`) e devolve uma URL `UploadPart` presigned por parte (assinada com `STORAGE_PUBLIC_ENDPOINT`, TTL `UPLOAD_PART_URL_TTL_SECONDS`), para que arquivos de até 10GB sigam direto do cliente ao storage sem passar pela API. O `public_id` de 11 caracteres é o único identificador externo; o UUID nunca sai da API. O endpoint exige bearer token e fica fora do throttling de auth (`@SkipThrottle()`).

## Test Scenarios

### 1. POST /videos (SI-03.9)

**Setup:** `beforeAll`: `Test.createTestingModule({ imports: [AppModule] }).compile()` com a config global de `main.ts` reproduzida como em `test/auth.e2e-spec.ts` (`ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`, `DomainExceptionFilter`, `ValidationExceptionFilter`), contra Postgres, Redis e MinIO reais do Compose, com os defaults de upload (`UPLOAD_MAX_SIZE_BYTES=10737418240`, `UPLOAD_PART_SIZE_BYTES=104857600`, `UPLOAD_PART_URL_TTL_SECONDS=3600`); `beforeEach`: `cleanAllTables(dataSource)`, `throttlerStorage.storage.clear()` e `obliterate({ force: true })` da fila `video-processing`; helper `registerConfirmAndLogin` (mesmo padrão de `test/auth.e2e-spec.ts`) para obter o `access_token`; `afterAll`: `app.close()`.

#### 1.1. cria-rascunho-e-devolve-urls-de-parte

**Covers AC:** #1, #2
**Source:** auto
**Last sync:** 2026-10-20T11:42:37Z

**Steps:**
  1. POST /videos com `Authorization: Bearer <access_token>` e body `{ filename: 'clip.mp4', mime_type: 'video/mp4', size: 10737418240 }`
    - expect: status `201`
    - expect: body com `status: 'draft'`, `part_size: 104857600`, `part_count: 103`, `expires_in: 3600` e `public_id` string de 11 caracteres do alfabeto base64url (`[A-Za-z0-9_-]`)
    - expect: `parts` tem 103 itens `{ part_number, url }` com `part_number` de 1 a 103, cada `url` com o host de `STORAGE_PUBLIC_ENDPOINT`
    - expect: body não tem a propriedade `id`
  2. Consultar a tabela `videos` via `DataSource`
    - expect: exatamente uma linha, `status = 'draft'`, `channel_id` igual ao canal do usuário autenticado, `title = 'clip.mp4'`, `original_filename = 'clip.mp4'`, `mime_type = 'video/mp4'`, `declared_size = 10737418240`, `part_size = 104857600`, `upload_id` preenchido e `public_id` igual ao da resposta
    - expect: o UUID `id` da linha não aparece em nenhum ponto do corpo serializado da resposta

#### 1.2. size-acima-do-maximo-retorna-400-sem-criar-linha

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-20T11:42:37Z

**Steps:**
  1. POST /videos com token válido e body `{ filename: 'clip.mp4', mime_type: 'video/mp4', size: 10737418241 }`
    - expect: status `400`
    - expect: body `{ statusCode: 400, error: 'VALIDATION_ERROR', message }` com `message` citando o máximo de `10737418240` bytes
  2. Consultar a tabela `videos`
    - expect: zero linhas

#### 1.3. body-invalido-retorna-400-validation-error

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-20T11:42:37Z

**Steps:**
  1. POST /videos com token válido e body `{ filename: 'clip.png', mime_type: 'image/png', size: 1024 }`
    - expect: status `400` e `error: 'VALIDATION_ERROR'`
  2. POST /videos com token válido e body sem `filename`: `{ mime_type: 'video/mp4', size: 1024 }`
    - expect: status `400` e `error: 'VALIDATION_ERROR'`
  3. Consultar a tabela `videos`
    - expect: zero linhas

#### 1.4. sem-token-retorna-401

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-20T11:42:37Z

**Steps:**
  1. POST /videos sem header `Authorization` e com body válido `{ filename: 'clip.mp4', mime_type: 'video/mp4', size: 1024 }`
    - expect: status `401`
  2. Consultar a tabela `videos`
    - expect: zero linhas

#### 1.5. fora-do-throttling-de-auth

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-10-20T11:42:37Z

**Steps:**
  1. Disparar 11 chamadas sequenciais POST /videos com token válido e body `{ filename: 'clip.mp4', mime_type: 'video/mp4', size: 1024 }` dentro do mesmo minuto
    - expect: todas as 11 respostas têm status `201`; nenhuma retorna `429`
    - expect: a tabela `videos` tem 11 linhas com `public_id` distintos
