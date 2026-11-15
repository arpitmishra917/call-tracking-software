import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const DEFAULT_TELEPHONY_RATES = {
  LOCAL_INBOUND_RATE: '0.045',
  TOLL_FREE_RATE: '0.055',
  RECORDING_STORAGE_RATE: '0.0025',
} as const;

export const DEFAULT_TELEPHONY_RATES_MICRO = {
  LOCAL_INBOUND_RATE_MICRO: 45000n,
  TOLL_FREE_RATE_MICRO: 55000n,
  RECORDING_STORAGE_RATE_MICRO: 2500n,
} as const;

/**
 * Validates and converts a USD per-minute rate string to internal integer micro-dollars.
 * $1.00 USD = 1,000,000 micro-dollars.
 *
 * Rejects non-numeric, non-finite, negative, or malformed strings.
 * Falls back to defaultValue if value is undefined, null, or empty string.
 */
export function parseRateToMicro(
  value: string | undefined | null,
  defaultValue: string,
  envVarName: string,
): bigint {
  const str =
    value === undefined || value === null || value.trim() === ''
      ? defaultValue
      : value.trim();

  // Validate numeric string format
  const num = Number(str);
  if (isNaN(num)) {
    throw new Error(
      `Invalid ${envVarName}: rate must be a valid numeric value, received "${value}"`,
    );
  }
  if (!isFinite(num)) {
    throw new Error(
      `Invalid ${envVarName}: rate must be a finite numeric value, received "${value}"`,
    );
  }
  if (num < 0) {
    throw new Error(
      `Invalid ${envVarName}: rate cannot be negative, received "${value}"`,
    );
  }

  // Exact decimal arithmetic to avoid floating-point rounding errors
  try {
    const decimal = new Prisma.Decimal(str);
    const microDecimal = decimal.mul(1_000_000);

    if (!microDecimal.isInteger()) {
      return BigInt(microDecimal.round().toFixed(0));
    }
    return BigInt(microDecimal.toFixed(0));
  } catch (err: any) {
    throw new Error(
      `Invalid ${envVarName}: unable to parse decimal rate "${value}": ${err.message}`,
    );
  }
}

@Injectable()
export class TelephonyPricingConfig {
  private readonly logger = new Logger(TelephonyPricingConfig.name);

  public readonly localInboundRateMicro: bigint;
  public readonly tollFreeRateMicro: bigint;
  public readonly recordingStorageRateMicro: bigint;

  constructor(
    @Optional()
    @Inject('CUSTOM_ENV')
    customEnv?: Record<string, string | undefined>,
  ) {
    const env = customEnv ?? process.env;

    this.localInboundRateMicro = parseRateToMicro(
      env.TELEPHONY_LOCAL_INBOUND_RATE,
      DEFAULT_TELEPHONY_RATES.LOCAL_INBOUND_RATE,
      'TELEPHONY_LOCAL_INBOUND_RATE',
    );

    this.tollFreeRateMicro = parseRateToMicro(
      env.TELEPHONY_TOLL_FREE_RATE,
      DEFAULT_TELEPHONY_RATES.TOLL_FREE_RATE,
      'TELEPHONY_TOLL_FREE_RATE',
    );

    this.recordingStorageRateMicro = parseRateToMicro(
      env.TELEPHONY_RECORDING_STORAGE_RATE,
      DEFAULT_TELEPHONY_RATES.RECORDING_STORAGE_RATE,
      'TELEPHONY_RECORDING_STORAGE_RATE',
    );

    this.logger.log(
      `TelephonyPricingConfig initialized: LOCAL=${this.localInboundRateMicro}µ/min, TOLL_FREE=${this.tollFreeRateMicro}µ/min, RECORDING=${this.recordingStorageRateMicro}µ/min`,
    );
  }

  /**
   * Resolves the per-minute rate for a given phone number type.
   * Defaults to local inbound rate for 'local', null, undefined, or unknown types.
   */
  getRateForNumberType(numberType: string | null | undefined): bigint {
    if (numberType === 'local') {
      return this.localInboundRateMicro;
    }
    if (numberType === 'toll_free') {
      return this.tollFreeRateMicro;
    }
    return this.localInboundRateMicro;
  }
}
