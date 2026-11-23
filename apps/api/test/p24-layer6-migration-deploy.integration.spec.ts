import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { assertNonProductionDatabase } from '../src/common/database-isolation.util.js';

describe('P2.4 Layer 6: PostgreSQL Migration Regression & Deployment Suite (Real PostgreSQL)', () => {
  const qaDbUrl =
    process.env.DATABASE_URL && process.env.DATABASE_URL.includes('_test')
      ? process.env.DATABASE_URL
      : 'postgresql://postgres:%2A222%2A2%23Arpit@localhost:5432/calltracking_mvp_test?schema=public';

  const migrationsDir = path.resolve(__dirname, '../prisma/migrations');
  const schemaPath = path.resolve(__dirname, '../prisma/schema.prisma');

  let prisma: PrismaClient;

  beforeAll(async () => {
    assertNonProductionDatabase(qaDbUrl, 'P2.4 Layer 6 Migration Suite');
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: qaDbUrl,
        },
      },
    });
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // Helper: List all on-disk migration directories in sorted order
  function getMigrationDirectories(): string[] {
    return fs
      .readdirSync(migrationsDir)
      .filter((entry) => {
        const fullPath = path.join(migrationsDir, entry);
        return fs.statSync(fullPath).isDirectory() && /^\d{14}_/.test(entry);
      })
      .sort();
  }

  // =========================================================================
  // SECTION 1: MIGRATION DISK ARTIFACT & INVENTORY INTEGRITY
  // =========================================================================

  it('1. Migration File Inventory: Verifies exactly 37 chronological migration steps exist on disk', () => {
    const migrationDirs = getMigrationDirectories();

    // Exactly 37 migrations in CallFlow
    expect(migrationDirs.length).toBe(37);

    // Verify chronological naming convention and timestamp validity
    for (const dirName of migrationDirs) {
      const match = dirName.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_(.+)$/);
      expect(match).not.toBeNull();
      const [, year, month, day] = match!;
      expect(parseInt(year, 10)).toBeGreaterThanOrEqual(2026);
      expect(parseInt(month, 10)).toBeGreaterThanOrEqual(1);
      expect(parseInt(month, 10)).toBeLessThanOrEqual(12);
      expect(parseInt(day, 10)).toBeGreaterThanOrEqual(1);
      expect(parseInt(day, 10)).toBeLessThanOrEqual(31);
    }

    // Verify lockfile exists and specifies PostgreSQL provider
    const lockfilePath = path.join(migrationsDir, 'migration_lock.toml');
    expect(fs.existsSync(lockfilePath)).toBe(true);
    const lockContent = fs.readFileSync(lockfilePath, 'utf8');
    expect(lockContent).toContain('provider = "postgresql"');
  });

  it('2. Migration SQL Integrity: Verifies each migration contains non-empty valid SQL instructions', () => {
    const migrationDirs = getMigrationDirectories();

    for (const dirName of migrationDirs) {
      const sqlPath = path.join(migrationsDir, dirName, 'migration.sql');
      expect(fs.existsSync(sqlPath)).toBe(true);

      const sqlContent = fs.readFileSync(sqlPath, 'utf8').trim();
      expect(sqlContent.length).toBeGreaterThan(0);

      // Verify no syntax corruptions or merge conflicts
      expect(sqlContent).not.toContain('<<<<<<<');
      expect(sqlContent).not.toContain('=======');
      expect(sqlContent).not.toContain('>>>>>>>');
    }
  });

  // =========================================================================
  // SECTION 2: POSTGRESQL DATABASE MIGRATION AUDIT (_prisma_migrations)
  // =========================================================================

  it('3. PostgreSQL Migration Deployment Table: Verifies clean, ordered deployment of all 37 migrations in _prisma_migrations', async () => {
    interface PrismaMigrationRow {
      id: string;
      checksum: string;
      finished_at: Date | null;
      migration_name: string;
      logs: string | null;
      rolled_back_at: Date | null;
      started_at: Date;
      applied_steps_count: number;
    }

    const appliedMigrations = await prisma.$queryRaw<PrismaMigrationRow[]>`
      SELECT id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count
      FROM "_prisma_migrations"
      ORDER BY started_at ASC
    `;

    // Must have recorded all 37 migrations
    expect(appliedMigrations.length).toBe(37);

    const onDiskDirs = getMigrationDirectories();

    for (let i = 0; i < 37; i++) {
      const dbRow = appliedMigrations[i];
      const diskDir = onDiskDirs[i];

      // Exact ordered sequence match
      expect(dbRow.migration_name).toBe(diskDir);

      // Successfully finished
      expect(dbRow.finished_at).not.toBeNull();

      // Zero rollbacks
      expect(dbRow.rolled_back_at).toBeNull();

      // At least 1 step applied
      expect(dbRow.applied_steps_count).toBeGreaterThan(0);

      // Checksum present and valid
      expect(dbRow.checksum).toBeDefined();
      expect(dbRow.checksum.length).toBeGreaterThan(10);
    }
  });

  // =========================================================================
  // SECTION 3: SCHEMA INVARIANTS & CRITICAL CONSTRAINT VERIFICATION
  // =========================================================================

  it('4. Schema Constraint Invariants: Validates critical compound unique indexes in PostgreSQL catalog', async () => {
    interface IndexInfo {
      tablename: string;
      indexname: string;
      indexdef: string;
    }

    const indexes = await prisma.$queryRaw<IndexInfo[]>`
      SELECT tablename, indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
    `;

    const tableIndexMap = new Map<string, IndexInfo[]>();
    for (const idx of indexes) {
      if (!tableIndexMap.has(idx.tablename)) {
        tableIndexMap.set(idx.tablename, []);
      }
      tableIndexMap.get(idx.tablename)!.push(idx);
    }

    // 1. settlement_items: must have unique index on (call_commercial_id, participant_type)
    const settlementItemIndexes = tableIndexMap.get('settlement_items') || [];
    expect(
      settlementItemIndexes.some(
        (i) =>
          i.indexdef.includes('UNIQUE') &&
          i.indexdef.includes('call_commercial_id') &&
          i.indexdef.includes('participant_type'),
      ),
    ).toBe(true);

    // 2. settlement_batches: must have unique index on (workspace_id, batch_number)
    const settlementBatchIndexes = tableIndexMap.get('settlement_batches') || [];
    expect(
      settlementBatchIndexes.some(
        (i) =>
          i.indexdef.includes('UNIQUE') &&
          i.indexdef.includes('workspace_id') &&
          i.indexdef.includes('batch_number'),
      ),
    ).toBe(true);

    // 3. buyer_reservations: must have unique index on attempt_id
    const buyerResIndexes = tableIndexMap.get('buyer_reservations') || [];
    expect(
      buyerResIndexes.some(
        (i) =>
          i.indexdef.includes('UNIQUE') &&
          i.indexdef.includes('attempt_id'),
      ),
    ).toBe(true);

    // 4. wallet_transactions: must have unique index on idempotency_key
    const walletTxIndexes = tableIndexMap.get('wallet_transactions') || [];
    expect(
      walletTxIndexes.some(
        (i) =>
          i.indexdef.includes('UNIQUE') &&
          i.indexdef.includes('idempotency_key'),
      ),
    ).toBe(true);
  });

  // =========================================================================
  // SECTION 4: DRIFT VERIFICATION & DEPLOYMENT IDEMPOTENCY
  // =========================================================================

  it(
    '5. Drift Check: Prisma migrate status verifies zero unapplied or drifted migrations',
    () => {
      // Run `prisma migrate status` against current test database
      const output = execSync(
        `npx prisma migrate status --schema="${schemaPath}"`,
        {
          cwd: path.resolve(__dirname, '..'),
          env: {
            ...process.env,
            DATABASE_URL: qaDbUrl,
            DIRECT_URL: qaDbUrl,
          },
          encoding: 'utf8',
          timeout: 25000,
        },
      );

      expect(output).toContain('37 migrations found in prisma/migrations');
      expect(output).toContain('Database schema is up to date!');
    },
    30000,
  );

  it(
    '6. Deployment Idempotency: Re-running prisma migrate deploy against up-to-date database is a safe no-op',
    () => {
      // Re-running migrate deploy on an up-to-date database must succeed with code 0 and report 0 pending migrations
      const output = execSync(
        `npx prisma migrate deploy --schema="${schemaPath}"`,
        {
          cwd: path.resolve(__dirname, '..'),
          env: {
            ...process.env,
            DATABASE_URL: qaDbUrl,
            DIRECT_URL: qaDbUrl,
          },
          encoding: 'utf8',
          timeout: 25000,
        },
      );

      expect(output).toContain('37 migrations found in prisma/migrations');
      expect(output).toContain('No pending migrations to apply.');
    },
    30000,
  );
});
