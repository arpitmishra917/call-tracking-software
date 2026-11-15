import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  sanitizeDatabaseUrl,
  validateDatabaseTarget,
  assertNonProductionDatabase,
  stripProductionEnvironmentVariables,
  FORBIDDEN_PRODUCTION_PATTERNS,
} from '../src/common/database-isolation.util.js';
import { ForbiddenException } from '@nestjs/common';

describe('Database Environment Isolation Safeguards', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('1. Missing QA / Test Database Configuration', () => {
    it('rejects undefined or empty database URL and fails closed', () => {
      const resUndef = validateDatabaseTarget(undefined);
      expect(resUndef.isValid).toBe(false);
      expect(resUndef.reason).toContain('missing or empty');

      const resEmpty = validateDatabaseTarget('');
      expect(resEmpty.isValid).toBe(false);
      expect(resEmpty.reason).toContain('missing or empty');

      expect(() => assertNonProductionDatabase(undefined)).toThrow(ForbiddenException);
      expect(() => assertNonProductionDatabase('')).toThrow(ForbiddenException);
    });
  });

  describe('2. Invalid Database Target Rejection', () => {
    it('rejects remote hostnames not on local loopback', () => {
      const remoteUrl = 'postgresql://admin:secret@db.staging.internal.com:5432/callflow_qa';
      const res = validateDatabaseTarget(remoteUrl);
      expect(res.isValid).toBe(false);
      expect(res.reason).toContain('not an isolated local loopback address');
      expect(() => assertNonProductionDatabase(remoteUrl)).toThrow(ForbiddenException);
    });

    it('rejects malformed database URLs', () => {
      const badUrl = 'not-a-valid-url';
      const res = validateDatabaseTarget(badUrl);
      expect(res.isValid).toBe(false);
      expect(res.reason).toContain('Malformed');
    });

    it('rejects non-test database when strict test isolation is required', () => {
      const devUrl = 'postgresql://postgres:pass@127.0.0.1:5432/callflow_production_clone';
      const res = validateDatabaseTarget(devUrl, { allowQa: false, allowTest: true });
      expect(res.isValid).toBe(false);
      expect(res.reason).toContain('must contain _test or _isolated');
    });
  });

  describe('3. Production-Like Target Rejection', () => {
    for (const pattern of FORBIDDEN_PRODUCTION_PATTERNS) {
      it(`hard rejects database URL containing forbidden pattern: "${pattern}"`, () => {
        const prodUrl = `postgresql://postgres.uwycbvnqnpnfisvvbabu:secret@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?pattern=${pattern}`;
        const res = validateDatabaseTarget(prodUrl);
        expect(res.isValid).toBe(false);
        expect(res.reason).toContain('Production database pattern detected');
        expect(() => assertNonProductionDatabase(prodUrl)).toThrow(ForbiddenException);
      });
    }

    it('hard rejects Supabase transaction pooler port 6543 even on localhost alias', () => {
      const poolerUrl = 'postgresql://user:pass@127.0.0.1:6543/callflow_qa';
      const res = validateDatabaseTarget(poolerUrl);
      expect(res.isValid).toBe(false);
      expect(res.reason).toContain('Production database pattern detected');
      expect(() => assertNonProductionDatabase(poolerUrl)).toThrow(ForbiddenException);
    });
  });

  describe('4. Conflicting Inherited Database Environment Variables', () => {
    it('strips inherited Supabase production keys from process.env', () => {
      process.env.SUPABASE_URL = 'https://uwycbvnqnpnfisvvbabu.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://uwycbvnqnpnfisvvbabu.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJh...';

      stripProductionEnvironmentVariables();

      expect(process.env.SUPABASE_URL).toBeUndefined();
      expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBeUndefined();
    });
  });

  describe('5. Valid Isolated QA and Test Configuration', () => {
    it('accepts isolated local QA database on port 5433 (callflow_qa)', () => {
      const qaUrl = 'postgresql://callflow_qa_user:qa_pass@127.0.0.1:5433/callflow_qa';
      const res = validateDatabaseTarget(qaUrl, { allowQa: true });
      expect(res.isValid).toBe(true);
      expect(res.sanitizedUrl).toBe('postgresql://callflow_qa_user:***@127.0.0.1:5433/callflow_qa');
      expect(() => assertNonProductionDatabase(qaUrl)).not.toThrow();
    });

    it('accepts isolated local test database with _test suffix', () => {
      const testUrl = 'postgresql://postgres:pass@localhost:5432/callflow_isolated_test';
      const res = validateDatabaseTarget(testUrl, { allowTest: true });
      expect(res.isValid).toBe(true);
      expect(res.sanitizedUrl).toBe('postgresql://postgres:***@localhost:5432/callflow_isolated_test');
      expect(() => assertNonProductionDatabase(testUrl)).not.toThrow();
    });
  });

  describe('6. Zero Credentials Exposed in Logs or Outputs', () => {
    it('masks database passwords reliably in sanitizeDatabaseUrl', () => {
      const raw = 'postgresql://super_secret_user:SuperSecretPassword123!@127.0.0.1:5433/callflow_qa';
      const sanitized = sanitizeDatabaseUrl(raw);
      expect(sanitized).not.toContain('SuperSecretPassword123!');
      expect(sanitized).toContain('super_secret_user:***@127.0.0.1:5433/callflow_qa');
    });

    it('ensures exception messages never leak password credentials', () => {
      const rawProd = 'postgresql://app_user:LeakedPassword999@aws-0-ap-northeast-1.pooler.supabase.com:6543/db';
      try {
        assertNonProductionDatabase(rawProd);
        expect.unreachable('Should have thrown ForbiddenException');
      } catch (err: any) {
        expect(err.message).not.toContain('LeakedPassword999');
      }
    });
  });
});
