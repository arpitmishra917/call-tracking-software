import { ForbiddenException, Logger } from '@nestjs/common';

const logger = new Logger('PaymentSafeguards');

export const ALLOWED_MOCK_ENVIRONMENTS = ['development', 'test', 'local'] as const;

/**
 * Returns true if current environment is considered production or fail-safe production mode.
 * Any missing, undefined, empty, or unrecognized environment fails closed as production.
 */
export function isProductionEnvironment(): boolean {
  const env = (process.env.NODE_ENV || '').toLowerCase().trim();
  if (!env || env === 'production' || env === 'prod' || env === 'live' || env === 'staging') {
    return true;
  }
  return !ALLOWED_MOCK_ENVIRONMENTS.includes(env as any);
}

/**
 * Checks whether mock payments and mock settlements are explicitly permitted.
 * Rules:
 * 1. Production unconditionally forbids mock payments, regardless of any flags.
 * 2. Non-production requires WALLET_MOCK_PAYMENTS_ENABLED === 'true'.
 * 3. Ambiguous or missing configuration fails safely (closed).
 */
export function isMockPaymentPermitted(): boolean {
  if (isProductionEnvironment()) {
    return false;
  }

  const isExplicitlyEnabled =
    (process.env.WALLET_MOCK_PAYMENTS_ENABLED || '').toLowerCase().trim() === 'true';
  return isExplicitlyEnabled;
}

/**
 * Asserts that mock payment execution is permitted. Throws ForbiddenException if not.
 */
export function assertMockPaymentPermitted(context: string): void {
  const currentEnv = process.env.NODE_ENV || 'undefined';

  if (isProductionEnvironment()) {
    logger.warn(
      `Mock payment attempt rejected in production-equivalent environment [env=${currentEnv}, context=${context}]`,
    );
    throw new ForbiddenException(
      `Mock payments and simulated execution are strictly forbidden in production or staging environments (${context}). Real provider integration required.`,
    );
  }

  if (!isMockPaymentPermitted()) {
    logger.warn(
      `Mock payment attempt rejected: WALLET_MOCK_PAYMENTS_ENABLED is not 'true' [env=${currentEnv}, context=${context}]`,
    );
    throw new ForbiddenException(
      `Mock payments are not enabled in this environment (${context}). Set WALLET_MOCK_PAYMENTS_ENABLED=true in non-production.`,
    );
  }
}
