import type { ValidationResult } from 'joi';
import { envValidationSchema } from './env.validation';

type EnvResult = ValidationResult<Record<string, unknown>>;

const requiredEnv = {
  DB_USERNAME: 'user',
  DB_PASSWORD: 'pass',
  DB_NAME: 'db',
  JWT_SECRET: 'secret',
  JWT_REFRESH_SECRET: 'refresh-secret',
  STORAGE_ENDPOINT: 'http://minio:9000',
  STORAGE_PUBLIC_ENDPOINT: 'http://localhost:9000',
  STORAGE_ACCESS_KEY: 'access-key',
  STORAGE_SECRET_KEY: 'secret-key',
};

const validateWithout = (key: keyof typeof requiredEnv): EnvResult => {
  const env: Record<string, string> = { ...requiredEnv };
  delete env[key];
  return envValidationSchema.validate(env, {
    allowUnknown: true,
    abortEarly: false,
  });
};

const validate = (env: Record<string, string>): EnvResult =>
  envValidationSchema.validate(
    { ...requiredEnv, ...env },
    { allowUnknown: true, abortEarly: false },
  );

const validatedDefaults = (): Record<string, unknown> => {
  const result = validate({});
  expect(result.error).toBeUndefined();
  return result.value as Record<string, unknown>;
};

describe('envValidationSchema — SWAGGER_ENABLED', () => {
  it('should reject SWAGGER_ENABLED with an invalid value', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'invalid' });
    expect(error).toBeDefined();
    expect(error!.message).toContain('SWAGGER_ENABLED');
  });

  it('should accept SWAGGER_ENABLED=true', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'true' });
    expect(error).toBeUndefined();
  });

  it('should accept SWAGGER_ENABLED=false', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'false' });
    expect(error).toBeUndefined();
  });

  it('should apply default false when SWAGGER_ENABLED is not set', () => {
    const result = validate({});
    const value = result.value as { SWAGGER_ENABLED: string };
    expect(result.error).toBeUndefined();
    expect(value.SWAGGER_ENABLED).toBe('false');
  });
});

describe('envValidationSchema — storage', () => {
  it.each([
    'STORAGE_ENDPOINT',
    'STORAGE_PUBLIC_ENDPOINT',
    'STORAGE_ACCESS_KEY',
    'STORAGE_SECRET_KEY',
  ] as const)('should reject when %s is missing', (key) => {
    const { error } = validateWithout(key);
    expect(error).toBeDefined();
    expect(error!.message).toContain(key);
  });

  it('should reject a STORAGE_ENDPOINT that is not a URI', () => {
    const { error } = validate({ STORAGE_ENDPOINT: 'minio:9000 not a uri' });
    expect(error).toBeDefined();
    expect(error!.message).toContain('STORAGE_ENDPOINT');
  });

  it('should apply default region and bucket when not set', () => {
    const value = validatedDefaults();
    expect(value.STORAGE_REGION).toBe('us-east-1');
    expect(value.STORAGE_BUCKET).toBe('streamtube');
  });
});

describe('envValidationSchema — queue', () => {
  it('should apply Redis defaults pointing at the Compose service', () => {
    const value = validatedDefaults();
    expect(value.REDIS_HOST).toBe('redis');
    expect(value.REDIS_PORT).toBe(6379);
  });
});

describe('envValidationSchema — upload', () => {
  it('should apply upload defaults when not set', () => {
    const value = validatedDefaults();
    expect(value.UPLOAD_MAX_SIZE_BYTES).toBe(10737418240);
    expect(value.UPLOAD_PART_SIZE_BYTES).toBe(104857600);
    expect(value.UPLOAD_PART_URL_TTL_SECONDS).toBe(3600);
  });

  it('should reject UPLOAD_PART_SIZE_BYTES below the 5 MiB S3 minimum', () => {
    const { error } = validate({ UPLOAD_PART_SIZE_BYTES: '1048576' });
    expect(error).toBeDefined();
    expect(error!.message).toContain('UPLOAD_PART_SIZE_BYTES');
  });

  it('should accept UPLOAD_PART_SIZE_BYTES equal to 5 MiB', () => {
    const { error } = validate({ UPLOAD_PART_SIZE_BYTES: '5242880' });
    expect(error).toBeUndefined();
  });

  it.each(['UPLOAD_MAX_SIZE_BYTES', 'UPLOAD_PART_URL_TTL_SECONDS'])(
    'should reject a non-positive %s',
    (key) => {
      const { error } = validate({ [key]: '0' });
      expect(error).toBeDefined();
      expect(error!.message).toContain(key);
    },
  );
});
