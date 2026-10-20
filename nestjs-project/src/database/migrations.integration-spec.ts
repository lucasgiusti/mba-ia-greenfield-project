import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Channel } from '../channels/entities/channel.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { CreateUsersAndChannels1775687773260 } from './migrations/1775687773260-CreateUsersAndChannels';
import { CreateAuthTokens1777579850478 } from './migrations/1777579850478-CreateAuthTokens';
import { CreateVideos1792498981670 } from './migrations/1792498981670-CreateVideos';
import { Video } from '../videos/entities/video.entity';
import { createTestDataSource } from '../test/create-test-data-source';

const MANAGED_TABLES = [
  'users',
  'channels',
  'refresh_tokens',
  'verification_tokens',
  'videos',
];

const MANAGED_ENUM_TYPES = [
  'verification_tokens_type_enum',
  'videos_status_enum',
];

describe('Database migrations (integration)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = createTestDataSource(
      [User, Channel, RefreshToken, VerificationToken, Video],
      {
        synchronize: false,
        migrations: [
          CreateUsersAndChannels1775687773260,
          CreateAuthTokens1777579850478,
          CreateVideos1792498981670,
        ],
      },
    );

    await dataSource.initialize();

    // Sequential drops: concurrent DDL on FK-linked tables can deadlock.
    for (const table of [...MANAGED_TABLES, 'migrations']) {
      await dataSource.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    }
    // Enum types survive DROP TABLE; leaving them makes re-runs fail on CREATE TYPE.
    for (const enumType of MANAGED_ENUM_TYPES) {
      await dataSource.query(`DROP TYPE IF EXISTS "${enumType}" CASCADE`);
    }
  });

  afterAll(async () => {
    // The revert test undoes the last migration, leaving the videos table missing.
    // Re-apply so the shared DB is fully migrated when subsequent suites run.
    await dataSource.runMigrations();
    await dataSource.destroy();
  });

  it('should start from a clean schema without managed tables or enum types', async () => {
    const tables = await dataSource.query<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])`,
      [[...MANAGED_TABLES, 'migrations']],
    );
    const enumTypes = await dataSource.query<{ typname: string }[]>(
      `SELECT typname FROM pg_type WHERE typname = ANY($1::text[])`,
      [MANAGED_ENUM_TYPES],
    );

    expect(tables).toHaveLength(0);
    expect(enumTypes).toHaveLength(0);
  });

  it('should apply all migrations and create all managed tables', async () => {
    const ranMigrations = await dataSource.runMigrations();

    expect(ranMigrations).toHaveLength(3);

    const result = await dataSource.query<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])
       ORDER BY table_name`,
      [MANAGED_TABLES],
    );
    const tableNames = result.map((r) => r.table_name);
    expect(tableNames).toEqual([
      'channels',
      'refresh_tokens',
      'users',
      'verification_tokens',
      'videos',
    ]);
  });

  it('should create the videos_status_enum type, the unique public_id index and the channels FK', async () => {
    const enumTypes = await dataSource.query<{ typname: string }[]>(
      `SELECT typname FROM pg_type WHERE typname = 'videos_status_enum'`,
    );
    const uniqueIndexes = await dataSource.query<{ indexdef: string }[]>(
      `SELECT indexdef FROM pg_indexes
       WHERE tablename = 'videos' AND indexdef LIKE 'CREATE UNIQUE INDEX%'`,
    );
    const channelIdIndexes = await dataSource.query<{ indexdef: string }[]>(
      `SELECT indexdef FROM pg_indexes
       WHERE tablename = 'videos' AND indexdef LIKE '%(channel_id)%'`,
    );
    const foreignKeys = await dataSource.query<{ foreign_table: string }[]>(
      `SELECT ccu.table_name AS foreign_table
       FROM information_schema.table_constraints tc
       JOIN information_schema.constraint_column_usage ccu
         ON tc.constraint_name = ccu.constraint_name
       WHERE tc.table_name = 'videos' AND tc.constraint_type = 'FOREIGN KEY'`,
    );

    expect(enumTypes).toHaveLength(1);
    expect(uniqueIndexes.map((r) => r.indexdef).join(' ')).toContain(
      '(public_id)',
    );
    expect(channelIdIndexes).toHaveLength(1);
    expect(foreignKeys).toEqual([{ foreign_table: 'channels' }]);
  });

  it('should revert the last migration and remove videos and videos_status_enum', async () => {
    await dataSource.undoLastMigration();

    const tables = await dataSource.query<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'videos'`,
    );
    const enumTypes = await dataSource.query<{ typname: string }[]>(
      `SELECT typname FROM pg_type WHERE typname = 'videos_status_enum'`,
    );
    const remaining = await dataSource.query<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])`,
      [['refresh_tokens', 'verification_tokens']],
    );
    expect(tables).toHaveLength(0);
    expect(enumTypes).toHaveLength(0);
    expect(remaining).toHaveLength(2);
  });
});
