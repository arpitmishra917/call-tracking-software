import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  TelephonyPricingConfig,
  DEFAULT_TELEPHONY_RATES,
  DEFAULT_TELEPHONY_RATES_MICRO,
  parseRateToMicro,
} from './telephony-pricing.config.js';

describe('TelephonyPricingConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset process.env to ensure isolated tests
    delete process.env.TELEPHONY_LOCAL_INBOUND_RATE;
    delete process.env.TELEPHONY_TOLL_FREE_RATE;
    delete process.env.TELEPHONY_RECORDING_STORAGE_RATE;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('parseRateToMicro helper', () => {
    it('returns default rate when input is undefined or empty', () => {
      expect(parseRateToMicro(undefined, '0.045', 'TEST_RATE')).toBe(45000n);
      expect(parseRateToMicro(null, '0.055', 'TEST_RATE')).toBe(55000n);
      expect(parseRateToMicro('', '0.0025', 'TEST_RATE')).toBe(2500n);
      expect(parseRateToMicro('   ', '0.045', 'TEST_RATE')).toBe(45000n);
    });

    it('parses valid numeric strings accurately to micro-dollars', () => {
      expect(parseRateToMicro('0.045', '0.045', 'TEST_RATE')).toBe(45000n);
      expect(parseRateToMicro('0.055', '0.055', 'TEST_RATE')).toBe(55000n);
      expect(parseRateToMicro('0.0025', '0.0025', 'TEST_RATE')).toBe(2500n);
      expect(parseRateToMicro('1.00', '0.045', 'TEST_RATE')).toBe(1000000n);
      expect(parseRateToMicro('0.1', '0.045', 'TEST_RATE')).toBe(100000n);
      expect(parseRateToMicro('0', '0.045', 'TEST_RATE')).toBe(0n);
      expect(parseRateToMicro('0.000001', '0.045', 'TEST_RATE')).toBe(1n);
    });

    it('rejects negative rates', () => {
      expect(() => parseRateToMicro('-0.045', '0.045', 'TEST_RATE')).toThrow(
        /rate cannot be negative/,
      );
      expect(() => parseRateToMicro('-1', '0.045', 'TEST_RATE')).toThrow(
        /rate cannot be negative/,
      );
    });

    it('rejects non-numeric strings', () => {
      expect(() => parseRateToMicro('abc', '0.045', 'TEST_RATE')).toThrow(
        /must be a valid numeric value/,
      );
      expect(() => parseRateToMicro('$0.045', '0.045', 'TEST_RATE')).toThrow(
        /must be a valid numeric value/,
      );
      expect(() => parseRateToMicro('0.045abc', '0.045', 'TEST_RATE')).toThrow(
        /must be a valid numeric value/,
      );
    });

    it('rejects non-finite values (Infinity, NaN)', () => {
      expect(() => parseRateToMicro('Infinity', '0.045', 'TEST_RATE')).toThrow(
        /must be a finite numeric value/,
      );
      expect(() => parseRateToMicro('-Infinity', '0.045', 'TEST_RATE')).toThrow(
        /must be a finite numeric value/,
      );
      expect(() => parseRateToMicro('NaN', '0.045', 'TEST_RATE')).toThrow(
        /must be a valid numeric value/,
      );
    });
  });

  describe('Default configuration loading', () => {
    it('uses specified defaults when all env variables are absent', () => {
      const config = new TelephonyPricingConfig({});
      expect(config.localInboundRateMicro).toBe(
        DEFAULT_TELEPHONY_RATES_MICRO.LOCAL_INBOUND_RATE_MICRO,
      );
      expect(config.tollFreeRateMicro).toBe(
        DEFAULT_TELEPHONY_RATES_MICRO.TOLL_FREE_RATE_MICRO,
      );
      expect(config.recordingStorageRateMicro).toBe(
        DEFAULT_TELEPHONY_RATES_MICRO.RECORDING_STORAGE_RATE_MICRO,
      );
    });

    it('uses defaults when env values are empty strings', () => {
      const config = new TelephonyPricingConfig({
        TELEPHONY_LOCAL_INBOUND_RATE: '',
        TELEPHONY_TOLL_FREE_RATE: '  ',
        TELEPHONY_RECORDING_STORAGE_RATE: '',
      });
      expect(config.localInboundRateMicro).toBe(45000n);
      expect(config.tollFreeRateMicro).toBe(55000n);
      expect(config.recordingStorageRateMicro).toBe(2500n);
    });
  });

  describe('Custom environment overrides', () => {
    it('loads custom rates from environment variables correctly', () => {
      const config = new TelephonyPricingConfig({
        TELEPHONY_LOCAL_INBOUND_RATE: '0.08',
        TELEPHONY_TOLL_FREE_RATE: '0.12',
        TELEPHONY_RECORDING_STORAGE_RATE: '0.005',
      });
      expect(config.localInboundRateMicro).toBe(80000n);
      expect(config.tollFreeRateMicro).toBe(120000n);
      expect(config.recordingStorageRateMicro).toBe(5000n);
    });

    it('supports partial overrides with fallbacks for omitted keys', () => {
      const config = new TelephonyPricingConfig({
        TELEPHONY_LOCAL_INBOUND_RATE: '0.065',
      });
      expect(config.localInboundRateMicro).toBe(65000n);
      expect(config.tollFreeRateMicro).toBe(55000n); // Default
      expect(config.recordingStorageRateMicro).toBe(2500n); // Default
    });

    it('does not depend on or get affected by unrelated environment variables', () => {
      const config = new TelephonyPricingConfig({
        UNRELATED_VARIABLE: 'something_else',
        NODE_ENV: 'production',
      });
      expect(config.localInboundRateMicro).toBe(45000n);
      expect(config.tollFreeRateMicro).toBe(55000n);
      expect(config.recordingStorageRateMicro).toBe(2500n);
    });
  });

  describe('Validation on initialization', () => {
    it('throws when TELEPHONY_LOCAL_INBOUND_RATE is invalid', () => {
      expect(
        () =>
          new TelephonyPricingConfig({
            TELEPHONY_LOCAL_INBOUND_RATE: 'not-a-number',
          }),
      ).toThrow(/Invalid TELEPHONY_LOCAL_INBOUND_RATE/);
    });

    it('throws when TELEPHONY_TOLL_FREE_RATE is negative', () => {
      expect(
        () =>
          new TelephonyPricingConfig({
            TELEPHONY_TOLL_FREE_RATE: '-0.05',
          }),
      ).toThrow(/Invalid TELEPHONY_TOLL_FREE_RATE: rate cannot be negative/);
    });

    it('throws when TELEPHONY_RECORDING_STORAGE_RATE is malformed', () => {
      expect(
        () =>
          new TelephonyPricingConfig({
            TELEPHONY_RECORDING_STORAGE_RATE: 'invalid_price',
          }),
      ).toThrow(/Invalid TELEPHONY_RECORDING_STORAGE_RATE/);
    });
  });

  describe('Rate category selection (getRateForNumberType)', () => {
    const config = new TelephonyPricingConfig({
      TELEPHONY_LOCAL_INBOUND_RATE: '0.045',
      TELEPHONY_TOLL_FREE_RATE: '0.055',
    });

    it('returns local rate for numberType === "local"', () => {
      expect(config.getRateForNumberType('local')).toBe(45000n);
    });

    it('returns toll-free rate for numberType === "toll_free"', () => {
      expect(config.getRateForNumberType('toll_free')).toBe(55000n);
    });

    it('falls back to local rate for null, undefined, or unrecognized types', () => {
      expect(config.getRateForNumberType(null)).toBe(45000n);
      expect(config.getRateForNumberType(undefined)).toBe(45000n);
      expect(config.getRateForNumberType('mobile')).toBe(45000n);
      expect(config.getRateForNumberType('')).toBe(45000n);
    });
  });
});
