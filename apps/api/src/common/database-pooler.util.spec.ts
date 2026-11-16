import { describe, it, expect } from 'vitest';
import {
  isSupabaseTransactionPooler,
  ensurePgBouncerParameter,
  inspectDatabaseConfig,
} from './database-pooler.util.js';

describe('Database Pooler Configuration Utility', () => {
  const transactionPoolerUrlWithoutPgbouncer =
    'postgresql://postgres.uwycbvnqnpnfisvvbabu:secretpass@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?schema=public';
  const transactionPoolerUrlWithPgbouncer =
    'postgresql://postgres.uwycbvnqnpnfisvvbabu:secretpass@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?schema=public&pgbouncer=true';
  const sessionPoolerUrl =
    'postgresql://postgres.uwycbvnqnpnfisvvbabu:secretpass@aws-0-ap-south-1.pooler.supabase.com:5432/postgres';
  const directDatabaseUrl =
    'postgresql://postgres:secretpass@db.uwycbvnqnpnfisvvbabu.supabase.co:5432/postgres';

  describe('isSupabaseTransactionPooler', () => {
    it('returns true for port 6543 on pooler.supabase.com', () => {
      expect(isSupabaseTransactionPooler(transactionPoolerUrlWithoutPgbouncer)).toBe(true);
    });

    it('returns false for direct database connection (port 5432)', () => {
      expect(isSupabaseTransactionPooler(directDatabaseUrl)).toBe(false);
    });

    it('returns false for undefined or empty string', () => {
      expect(isSupabaseTransactionPooler(undefined)).toBe(false);
      expect(isSupabaseTransactionPooler('')).toBe(false);
    });
  });

  describe('ensurePgBouncerParameter', () => {
    it('appends pgbouncer=true to transaction pooler url when absent', () => {
      const result = ensurePgBouncerParameter(transactionPoolerUrlWithoutPgbouncer);
      expect(result).toBeDefined();
      expect(result).toContain('pgbouncer=true');
      expect(result).toContain('schema=public');
      // Verify password and credentials remain intact
      expect(result).toContain('secretpass');
    });

    it('preserves url unchanged when pgbouncer=true is already present', () => {
      const result = ensurePgBouncerParameter(transactionPoolerUrlWithPgbouncer);
      expect(result).toBe(transactionPoolerUrlWithPgbouncer);
    });

    it('does not append pgbouncer=true to direct connection URL', () => {
      const result = ensurePgBouncerParameter(directDatabaseUrl);
      expect(result).toBe(directDatabaseUrl);
      expect(result).not.toContain('pgbouncer=true');
    });

    it('handles falsy input safely', () => {
      expect(ensurePgBouncerParameter(undefined)).toBeUndefined();
      expect(ensurePgBouncerParameter('')).toBe('');
    });
  });

  describe('inspectDatabaseConfig', () => {
    it('extracts sanitized diagnostic information without exposing password', () => {
      const config = inspectDatabaseConfig(transactionPoolerUrlWithoutPgbouncer);
      expect(config.host).toBe('aws-0-ap-south-1.pooler.supabase.com');
      expect(config.port).toBe('6543');
      expect(config.poolerType).toBe('transaction');
      expect(config.hasPgBouncer).toBe(false);
      expect(config.queryParamKeys).toContain('schema');
      // Verify that no passwords leaked into returned config
      expect(JSON.stringify(config)).not.toContain('secretpass');
    });

    it('identifies pgbouncer=true presence', () => {
      const config = inspectDatabaseConfig(transactionPoolerUrlWithPgbouncer);
      expect(config.hasPgBouncer).toBe(true);
      expect(config.poolerType).toBe('transaction');
      expect(config.queryParamKeys).toContain('pgbouncer');
    });

    it('correctly identifies direct connection mode', () => {
      const config = inspectDatabaseConfig(directDatabaseUrl);
      expect(config.host).toBe('db.uwycbvnqnpnfisvvbabu.supabase.co');
      expect(config.port).toBe('5432');
      expect(config.poolerType).toBe('direct');
      expect(config.hasPgBouncer).toBe(false);
    });

    it('correctly identifies session pooler mode (port 5432 on pooler host)', () => {
      const config = inspectDatabaseConfig(sessionPoolerUrl);
      expect(config.host).toBe('aws-0-ap-south-1.pooler.supabase.com');
      expect(config.port).toBe('5432');
      expect(config.poolerType).toBe('session');
    });
  });
});
