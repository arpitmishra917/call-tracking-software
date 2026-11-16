import { Logger } from '@nestjs/common';
import { URL } from 'url';

const logger = new Logger('DatabasePoolerUtil');

export interface SanitizedDbConfig {
  host: string;
  port: string;
  poolerType: 'transaction' | 'session' | 'direct' | 'unknown';
  hasPgBouncer: boolean;
  queryParamKeys: string[];
}

/**
 * Checks if a database connection URL is targeting the Supabase Transaction Pooler (port 6543 or pooler.supabase.com with port 6543).
 */
export function isSupabaseTransactionPooler(rawUrl?: string): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  try {
    const parsed = new URL(rawUrl.trim());
    return parsed.port === '6543' || (parsed.hostname.includes('pooler.supabase.com') && (parsed.port === '6543' || parsed.port === ''));
  } catch {
    return rawUrl.includes(':6543') || rawUrl.includes('pooler.supabase.com');
  }
}

/**
 * Ensures that if a database connection URL is targeting a transaction pooler (port 6543 or pooler.supabase.com),
 * the `pgbouncer=true` query parameter is present to prevent prepared statement collisions (error 42P05).
 * Preserves all existing query parameters, username, password, host, and port.
 */
export function ensurePgBouncerParameter(rawUrl?: string): string | undefined {
  if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return rawUrl;
  }

  const trimmed = rawUrl.trim();

  try {
    const parsed = new URL(trimmed);
    const isPooler =
      parsed.port === '6543' ||
      parsed.hostname.includes('pooler.supabase.com');

    if (isPooler) {
      if (parsed.searchParams.get('pgbouncer') !== 'true') {
        parsed.searchParams.set('pgbouncer', 'true');
        logger.log(
          `[DATABASE_CONFIG] Supabase transaction pooler detected on ${parsed.hostname}:${parsed.port}. Automatically appended pgbouncer=true to prevent prepared statement collisions (error 42P05).`,
        );
        return parsed.toString();
      }
    }
    return trimmed;
  } catch {
    // Fallback regex if URL parsing fails on complex raw connection strings
    if (trimmed.includes(':6543') || trimmed.includes('pooler.supabase.com')) {
      if (!trimmed.includes('pgbouncer=true')) {
        const separator = trimmed.includes('?') ? '&' : '?';
        const updated = `${trimmed}${separator}pgbouncer=true`;
        logger.log(
          `[DATABASE_CONFIG] Appended pgbouncer=true to database connection string via fallback.`,
        );
        return updated;
      }
    }
    return trimmed;
  }
}

/**
 * Produces sanitized diagnostic information about the database connection configuration
 * without exposing sensitive passwords or tokens.
 */
export function inspectDatabaseConfig(rawUrl?: string): SanitizedDbConfig {
  if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return {
      host: '[MISSING]',
      port: '[MISSING]',
      poolerType: 'unknown',
      hasPgBouncer: false,
      queryParamKeys: [],
    };
  }

  try {
    const parsed = new URL(rawUrl.trim());
    const queryParamKeys = Array.from(parsed.searchParams.keys());
    const hasPgBouncer = parsed.searchParams.get('pgbouncer') === 'true';

    let poolerType: 'transaction' | 'session' | 'direct' | 'unknown' = 'unknown';
    if (parsed.port === '6543') {
      poolerType = 'transaction';
    } else if (parsed.port === '5432' && parsed.hostname.includes('pooler.supabase.com')) {
      poolerType = 'session';
    } else if (parsed.port === '5432' || parsed.hostname.startsWith('db.')) {
      poolerType = 'direct';
    }

    return {
      host: parsed.hostname,
      port: parsed.port || '5432',
      poolerType,
      hasPgBouncer,
      queryParamKeys,
    };
  } catch {
    return {
      host: '[UNPARSEABLE]',
      port: '[UNPARSEABLE]',
      poolerType: 'unknown',
      hasPgBouncer: rawUrl.includes('pgbouncer=true'),
      queryParamKeys: [],
    };
  }
}
