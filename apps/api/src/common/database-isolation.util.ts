import { ForbiddenException, Logger } from '@nestjs/common';

const logger = new Logger('DatabaseIsolation');

export const FORBIDDEN_PRODUCTION_PATTERNS = [
  'supabase.co',
  'pooler.supabase.com',
  'aws-0-ap-northeast-1',
  '6543',
  'uwycbvnqnpnfisvvbabu',
] as const;

export const ALLOWED_TEST_DB_PATTERNS = [
  '_test',
  '_isolated',
  'callflow_qa',
  ':5433',
] as const;

/**
 * Sanitizes a database connection URL by removing sensitive password credentials.
 * Ensures that no credentials are ever written to application logs, audit files, or errors.
 */
export function sanitizeDatabaseUrl(rawUrl?: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return '[EMPTY_OR_UNDEFINED_URL]';
  }

  try {
    const parsed = new URL(rawUrl);
    if (parsed.password) {
      parsed.password = '***';
    }
    return parsed.toString();
  } catch {
    // If URL parsing fails, mask any user:pass@ pattern via regex
    return rawUrl.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@');
  }
}

/**
 * Strips inherited production environment variables from process.env
 * to prevent accidental leak or cross-contamination during QA and test execution.
 */
export function stripProductionEnvironmentVariables(): void {
  const prodVarKeys = [
    'SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_SECRET_KEY',
    'SUPABASE_ANON_KEY',
    'SUPABASE_KEY',
  ];

  // If ANY environment variable contains a forbidden production pattern, strip all Supabase keys
  const hasProdIndicator = Object.entries(process.env).some(
    ([k, v]) =>
      typeof v === 'string' &&
      FORBIDDEN_PRODUCTION_PATTERNS.some((p) => v.toLowerCase().includes(p.toLowerCase())),
  );

  for (const key of prodVarKeys) {
    if (process.env[key]) {
      if (
        hasProdIndicator ||
        FORBIDDEN_PRODUCTION_PATTERNS.some((p) =>
          process.env[key]?.toLowerCase().includes(p.toLowerCase()),
        )
      ) {
        delete process.env[key];
        logger.log(`Stripped production environment variable: ${key}`);
      }
    }
  }
}

/**
 * Validates a database connection URL against strict non-production isolation rules.
 * Fails closed if the target cannot be verified as isolated and non-production.
 */
export function validateDatabaseTarget(
  dbUrl?: string,
  options?: {
    allowQa?: boolean;
    allowTest?: boolean;
    context?: string;
  },
): { isValid: boolean; sanitizedUrl: string; reason?: string } {
  const context = options?.context || 'database-target-check';

  if (!dbUrl || typeof dbUrl !== 'string' || dbUrl.trim() === '') {
    return {
      isValid: false,
      sanitizedUrl: '[MISSING]',
      reason: `DATABASE_URL is missing or empty in context: ${context}`,
    };
  }

  const sanitized = sanitizeDatabaseUrl(dbUrl);

  // 1. Check forbidden production patterns
  for (const forbidden of FORBIDDEN_PRODUCTION_PATTERNS) {
    if (dbUrl.toLowerCase().includes(forbidden.toLowerCase())) {
      return {
        isValid: false,
        sanitizedUrl: sanitized,
        reason: `Production database pattern detected: "${forbidden}". Refusing execution.`,
      };
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(dbUrl);
  } catch (err: any) {
    return {
      isValid: false,
      sanitizedUrl: sanitized,
      reason: `Malformed DATABASE_URL: ${err.message}`,
    };
  }

  // 2. Normalize and check hostnames (supporting IPv4, IPv6 loopback, and Docker host)
  const cleanHost = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();

  const isLocalhost =
    cleanHost === 'localhost' ||
    cleanHost === '127.0.0.1' ||
    cleanHost === '::1' ||
    cleanHost === '::ffff:127.0.0.1';

  const isDockerHost = cleanHost === 'host.docker.internal';

  // Strict enforcement: if host.docker.internal, ensure it routes strictly to local QA/test ports and DB
  if (isDockerHost) {
    const isAllowedDockerPort = parsed.port === '5433' || parsed.port === '5432';
    const isAllowedDockerDb =
      parsed.pathname.includes('callflow_qa') ||
      parsed.pathname.includes('_test') ||
      parsed.pathname.includes('_isolated');

    if (!isAllowedDockerPort || !isAllowedDockerDb) {
      return {
        isValid: false,
        sanitizedUrl: sanitized,
        reason: `host.docker.internal target must strictly specify QA/test port (5432/5433) and database (callflow_qa / _test).`,
      };
    }
  }

  if (!isLocalhost && !isDockerHost) {
    return {
      isValid: false,
      sanitizedUrl: sanitized,
      reason: `Database host "${parsed.hostname}" is not an isolated local loopback address (127.0.0.1 / localhost).`,
    };
  }

  // 3. For QA mode (port 5433 or callflow_qa database)
  const isQaTarget =
    parsed.port === '5433' ||
    parsed.pathname.includes('callflow_qa');

  // 4. For Test mode (_test or _isolated database)
  const isTestTarget =
    parsed.pathname.includes('_test') ||
    parsed.pathname.includes('_isolated');

  const allowQa = options?.allowQa ?? true;
  const allowTest = options?.allowTest ?? true;

  if (isQaTarget && allowQa) {
    return { isValid: true, sanitizedUrl: sanitized };
  }

  if (isTestTarget && allowTest) {
    return { isValid: true, sanitizedUrl: sanitized };
  }

  // Fallback check for safe local dev database if test or qa is not strictly required
  if (isLocalhost && !isQaTarget && !isTestTarget) {
    if (options?.allowTest && !options?.allowQa) {
      return {
        isValid: false,
        sanitizedUrl: sanitized,
        reason: `Database "${parsed.pathname}" is not an isolated test database (must contain _test or _isolated).`,
      };
    }
    return { isValid: true, sanitizedUrl: sanitized };
  }

  return {
    isValid: false,
    sanitizedUrl: sanitized,
    reason: `Database target does not meet isolation requirements. Target: ${sanitized}`,
  };
}

/**
 * Asserts that the target database is isolated and non-production.
 * Throws ForbiddenException if validation fails. Never exposes credentials.
 */
export function assertNonProductionDatabase(
  dbUrl?: string,
  context = 'general-db-guard',
): void {
  const result = validateDatabaseTarget(dbUrl, { context });
  if (!result.isValid) {
    logger.error(`Database isolation check failed [context=${context}]: ${result.reason}`);
    throw new ForbiddenException(
      `Database isolation boundary violation [context=${context}]: ${result.reason}. Safe target required.`,
    );
  }
}
