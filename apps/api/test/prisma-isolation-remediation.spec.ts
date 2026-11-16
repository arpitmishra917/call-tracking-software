import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  assertNonProductionDatabase,
  stripProductionEnvironmentVariables,
  validateDatabaseTarget,
} from '../src/common/database-isolation.util.js';
import { ForbiddenException } from '@nestjs/common';

describe('Prisma Production Isolation Remediation Tests (Phase DEPLOY-2R)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('1. Production Environment (NODE_ENV=production)', () => {
    it('1.1. In production, Supabase-shaped DATABASE_URL is not rejected on PrismaService.onModuleInit', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.APP_ENV;
      delete process.env.VITEST;

      const prodDbUrl =
        'postgresql://postgres.uwycbvnqnpnfisvvbabu:mock_secret_password@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres';
      process.env.DATABASE_URL = prodDbUrl;
      process.env.SUPABASE_URL = 'https://uwycbvnqnpnfisvvbabu.supabase.co';

      const prisma = new PrismaService();
      // Intercept PrismaClient $connect to avoid actual network calls
      const connectSpy = vi.spyOn(prisma, '$connect').mockResolvedValue(undefined as any);

      await expect(prisma.onModuleInit()).resolves.not.toThrow();
      expect(connectSpy).toHaveBeenCalledTimes(1);
    });

    it('1.2. In production, SUPABASE_URL and Supabase credentials are NOT stripped', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.APP_ENV;
      delete process.env.VITEST;

      const prodDbUrl =
        'postgresql://postgres.uwycbvnqnpnfisvvbabu:mock_secret@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres';
      process.env.DATABASE_URL = prodDbUrl;
      process.env.SUPABASE_URL = 'https://uwycbvnqnpnfisvvbabu.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock_service_role_key_prod';

      const prisma = new PrismaService();
      vi.spyOn(prisma, '$connect').mockResolvedValue(undefined as any);

      await prisma.onModuleInit();

      expect(process.env.SUPABASE_URL).toBe('https://uwycbvnqnpnfisvvbabu.supabase.co');
      expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBe('mock_service_role_key_prod');
    });
  });

  describe('2. QA Environment (APP_ENV=qa)', () => {
    it('2.1. In QA environment, production-looking DATABASE_URL is rejected with ForbiddenException', async () => {
      process.env.NODE_ENV = 'development';
      process.env.APP_ENV = 'qa';
      delete process.env.VITEST;

      const prodDbUrl =
        'postgresql://postgres.uwycbvnqnpnfisvvbabu:mock_secret@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres';
      process.env.DATABASE_URL = prodDbUrl;

      const prisma = new PrismaService();
      const connectSpy = vi.spyOn(prisma, '$connect').mockResolvedValue(undefined as any);

      await expect(prisma.onModuleInit()).rejects.toThrow(ForbiddenException);
      expect(connectSpy).not.toHaveBeenCalled();
    });

    it('2.2. In QA environment, valid QA database on port 5433 is permitted', async () => {
      process.env.NODE_ENV = 'development';
      process.env.APP_ENV = 'qa';
      delete process.env.VITEST;

      const qaDbUrl = 'postgresql://postgres:postgres@localhost:5433/callflow_qa';
      process.env.DATABASE_URL = qaDbUrl;

      const prisma = new PrismaService();
      const connectSpy = vi.spyOn(prisma, '$connect').mockResolvedValue(undefined as any);

      await expect(prisma.onModuleInit()).resolves.not.toThrow();
      expect(connectSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('3. Automated Test Environment (NODE_ENV=test or VITEST)', () => {
    it('3.1. In test environment, production-looking DATABASE_URL is rejected with ForbiddenException', async () => {
      process.env.NODE_ENV = 'test';
      delete process.env.APP_ENV;

      const prodDbUrl = 'postgresql://postgres:secret@supabase.co:5432/postgres';
      process.env.DATABASE_URL = prodDbUrl;

      const prisma = new PrismaService();
      const connectSpy = vi.spyOn(prisma, '$connect').mockResolvedValue(undefined as any);

      await expect(prisma.onModuleInit()).rejects.toThrow(ForbiddenException);
      expect(connectSpy).not.toHaveBeenCalled();
    });

    it('3.2. In test environment, local isolated test database is permitted', async () => {
      process.env.NODE_ENV = 'test';
      delete process.env.APP_ENV;

      const testDbUrl = 'postgresql://postgres:postgres@127.0.0.1:5432/callflow_test';
      process.env.DATABASE_URL = testDbUrl;

      const prisma = new PrismaService();
      const connectSpy = vi.spyOn(prisma, '$connect').mockResolvedValue(undefined as any);

      await expect(prisma.onModuleInit()).resolves.not.toThrow();
      expect(connectSpy).toHaveBeenCalledTimes(1);
    });

    it('3.3. In test environment, stripProductionEnvironmentVariables strips production keys if prod pattern exists', () => {
      process.env.NODE_ENV = 'test';
      process.env.DATABASE_URL = 'postgresql://mock@pooler.supabase.com:6543/postgres';
      process.env.SUPABASE_URL = 'https://uwycbvnqnpnfisvvbabu.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'secret_key';

      stripProductionEnvironmentVariables();

      expect(process.env.SUPABASE_URL).toBeUndefined();
      expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    });
  });

  describe('4. Normal Development Environment (NODE_ENV=development)', () => {
    it('4.1. In development, normal local database target connects without stripping environment variables', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.APP_ENV;
      delete process.env.VITEST;

      const devDbUrl = 'postgresql://postgres:postgres@localhost:5432/callflow_dev';
      process.env.DATABASE_URL = devDbUrl;
      process.env.SUPABASE_URL = 'https://dev-project.supabase.co';

      const prisma = new PrismaService();
      const connectSpy = vi.spyOn(prisma, '$connect').mockResolvedValue(undefined as any);

      await expect(prisma.onModuleInit()).resolves.not.toThrow();
      expect(connectSpy).toHaveBeenCalledTimes(1);
      expect(process.env.SUPABASE_URL).toBe('https://dev-project.supabase.co');
    });
  });

  describe('5. Destructive Test Setup Fail-Closed Protection', () => {
    it('5.1. Fails closed when DATABASE_URL is missing or empty', () => {
      expect(() => assertNonProductionDatabase(undefined, 'destructive-setup-test')).toThrow(
        ForbiddenException,
      );
      expect(() => assertNonProductionDatabase('', 'destructive-setup-test')).toThrow(
        ForbiddenException,
      );
      expect(() => assertNonProductionDatabase('   ', 'destructive-setup-test')).toThrow(
        ForbiddenException,
      );
    });

    it('5.2. Fails closed when target hostname is remote and non-loopback', () => {
      const remoteDb = 'postgresql://postgres:pass@192.168.1.100:5432/my_test_db';
      expect(() => assertNonProductionDatabase(remoteDb, 'destructive-setup-test')).toThrow(
        ForbiddenException,
      );
    });

    it('5.3. Fails closed when URL is malformed', () => {
      const malformedDb = 'not-a-valid-url-at-all';
      expect(() => assertNonProductionDatabase(malformedDb, 'destructive-setup-test')).toThrow(
        ForbiddenException,
      );
    });

    it('5.4. Fails closed if host.docker.internal does not target allowed port/db', () => {
      const dockerProd = 'postgresql://postgres:pass@host.docker.internal:5432/production_db';
      const result = validateDatabaseTarget(dockerProd, { allowTest: true, allowQa: false });
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('host.docker.internal target must strictly specify QA/test port');
    });
  });
});
