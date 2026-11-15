import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { UsageBillingService, PRICING } from './usage-billing.service.js';
import { TelephonyPricingConfig } from './telephony-pricing.config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WalletService } from './wallet.service.js';

describe('UsageBillingService', () => {
  let service: UsageBillingService;
  let walletService: any;
  let prisma: any;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    delete process.env.TELEPHONY_LOCAL_INBOUND_RATE;
    delete process.env.TELEPHONY_TOLL_FREE_RATE;
    delete process.env.TELEPHONY_RECORDING_STORAGE_RATE;

    walletService = {
      releaseReservation: vi.fn().mockResolvedValue({ message: 'Released' }),
      settleReservation: vi.fn().mockResolvedValue({ status: 'SETTLED' }),
      debitWallet: vi.fn().mockResolvedValue({ id: 'tx_rec_1' }),
    };

    prisma = {};

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsageBillingService,
        TelephonyPricingConfig,
        { provide: WalletService, useValue: walletService },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<UsageBillingService>(UsageBillingService);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('calculateBillableMinutes (Ceiling Arithmetic)', () => {
    it('returns 0 for zero, negative, or NaN durations', () => {
      expect(service.calculateBillableMinutes(0)).toBe(0n);
      expect(service.calculateBillableMinutes(-1)).toBe(0n);
      expect(service.calculateBillableMinutes(-120)).toBe(0n);
      expect(service.calculateBillableMinutes(NaN)).toBe(0n);
    });

    it('rounds up 1 second to 1 full minute', () => {
      expect(service.calculateBillableMinutes(1)).toBe(1n);
    });

    it('rounds up 59 seconds to 1 full minute', () => {
      expect(service.calculateBillableMinutes(59)).toBe(1n);
    });

    it('treats exact 60 seconds as 1 minute', () => {
      expect(service.calculateBillableMinutes(60)).toBe(1n);
    });

    it('rounds up 61 seconds to 2 full minutes', () => {
      expect(service.calculateBillableMinutes(61)).toBe(2n);
    });

    it('treats exact 120 seconds as 2 minutes', () => {
      expect(service.calculateBillableMinutes(120)).toBe(2n);
    });

    it('rounds up 121 seconds to 3 full minutes', () => {
      expect(service.calculateBillableMinutes(121)).toBe(3n);
    });
  });

  describe('calculateInitialReservation (Pre-call Authorization)', () => {
    it('calculates 10-minute block using default local inbound rate', () => {
      // (45,000 + 2,500) * 10 = 475,000 micro-dollars ($0.475)
      const res = service.calculateInitialReservation('local');
      expect(res).toBe(475000n);
    });

    it('calculates 10-minute block using default toll-free inbound rate', () => {
      // (55,000 + 2,500) * 10 = 575,000 micro-dollars ($0.575)
      const res = service.calculateInitialReservation('toll_free');
      expect(res).toBe(575000n);
    });

    it('falls back to local inbound rate for null, undefined, or unknown types', () => {
      expect(service.calculateInitialReservation(null)).toBe(475000n);
      expect(service.calculateInitialReservation(undefined)).toBe(475000n);
      expect(service.calculateInitialReservation('unknown')).toBe(475000n);
    });

    it('uses configured custom environment rates for initial reservation', () => {
      const customConfig = new TelephonyPricingConfig({
        TELEPHONY_LOCAL_INBOUND_RATE: '0.10',
        TELEPHONY_TOLL_FREE_RATE: '0.15',
        TELEPHONY_RECORDING_STORAGE_RATE: '0.01',
      });
      const customService = new UsageBillingService(prisma, walletService, customConfig);

      // (100,000 + 10,000) * 10 = 1,100,000 micro-dollars
      expect(customService.calculateInitialReservation('local')).toBe(1100000n);
      // (150,000 + 10,000) * 10 = 1,600,000 micro-dollars
      expect(customService.calculateInitialReservation('toll_free')).toBe(1600000n);
    });
  });

  describe('billCallUsage (Settlement & Wallet Deductions)', () => {
    it('releases reservation without debiting when talk duration is 0', async () => {
      const res = await service.billCallUsage('ws_1', 'call_1', 'local', 0);
      expect(res).toEqual({
        billed: false,
        reason: 'Zero talk duration, reservation released',
      });
      expect(walletService.releaseReservation).toHaveBeenCalledWith('ws_1', 'call_1');
      expect(walletService.settleReservation).not.toHaveBeenCalled();
    });

    it('releases reservation when talk duration is negative', async () => {
      const res = await service.billCallUsage('ws_1', 'call_1', 'local', -15);
      expect(res.billed).toBe(false);
      expect(walletService.releaseReservation).toHaveBeenCalledWith('ws_1', 'call_1');
      expect(walletService.settleReservation).not.toHaveBeenCalled();
    });

    it('bills local inbound call at default rate ($0.045/min = 45,000µ)', async () => {
      // 65 seconds = 2 billable minutes. 2 * 45,000 = 90,000 micro-dollars ($0.09)
      const res = await service.billCallUsage('ws_1', 'call_1', 'local', 65);
      expect(res).toEqual({ billed: true, costMicro: 90000n });
      expect(walletService.settleReservation).toHaveBeenCalledWith(
        'ws_1',
        'call_1',
        90000n,
      );
    });

    it('bills toll-free inbound call at default rate ($0.055/min = 55,000µ)', async () => {
      // 65 seconds = 2 billable minutes. 2 * 55,000 = 110,000 micro-dollars ($0.11)
      const res = await service.billCallUsage('ws_1', 'call_1', 'toll_free', 65);
      expect(res).toEqual({ billed: true, costMicro: 110000n });
      expect(walletService.settleReservation).toHaveBeenCalledWith(
        'ws_1',
        'call_1',
        110000n,
      );
    });

    it('bills using configured environment rates when provided', async () => {
      const customConfig = new TelephonyPricingConfig({
        TELEPHONY_LOCAL_INBOUND_RATE: '0.08', // $0.08/min = 80,000µ
      });
      const customService = new UsageBillingService(prisma, walletService, customConfig);

      // 65 seconds = 2 minutes * 80,000 = 160,000 micro-dollars ($0.16)
      const res = await customService.billCallUsage('ws_1', 'call_1', 'local', 65);
      expect(res).toEqual({ billed: true, costMicro: 160000n });
      expect(walletService.settleReservation).toHaveBeenCalledWith(
        'ws_1',
        'call_1',
        160000n,
      );
    });
  });

  describe('billRecordingUsage (Recording Storage Billing)', () => {
    it('returns not billed when recording duration is 0 or negative', async () => {
      const res0 = await service.billRecordingUsage('ws_1', 'rec_1', 0);
      expect(res0).toEqual({ billed: false, reason: 'Missing duration' });
      expect(walletService.debitWallet).not.toHaveBeenCalled();

      const resNeg = await service.billRecordingUsage('ws_1', 'rec_1', -5);
      expect(resNeg).toEqual({ billed: false, reason: 'Missing duration' });
    });

    it('bills recording storage at default rate ($0.0025/min = 2,500µ)', async () => {
      // 65 seconds = 2 minutes * 2,500 = 5,000 micro-dollars ($0.005)
      const res = await service.billRecordingUsage('ws_1', 'rec_1', 65);
      expect(res).toEqual({ billed: true, costMicro: 5000n });
      expect(walletService.debitWallet).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'ws_1',
          amountMicro: 5000n,
          referenceType: 'RECORDING_STORAGE',
          referenceId: 'rec_1',
          idempotencyKey: 'recording:rec_1:usage',
          description: 'Recording usage: 2 min',
        }),
      );
    });

    it('bills recording storage at custom configured environment rate', async () => {
      const customConfig = new TelephonyPricingConfig({
        TELEPHONY_RECORDING_STORAGE_RATE: '0.006', // 6,000µ/min
      });
      const customService = new UsageBillingService(prisma, walletService, customConfig);

      // 65 seconds = 2 minutes * 6,000 = 12,000 micro-dollars
      const res = await customService.billRecordingUsage('ws_1', 'rec_1', 65);
      expect(res).toEqual({ billed: true, costMicro: 12000n });
      expect(walletService.debitWallet).toHaveBeenCalledWith(
        expect.objectContaining({
          amountMicro: 12000n,
        }),
      );
    });
  });

  describe('PRICING backward compatibility', () => {
    it('dynamically reads rates from active environment', () => {
      expect(PRICING.LOCAL_INBOUND_MICRO_PER_MIN).toBe(45000n);
      expect(PRICING.TOLL_FREE_INBOUND_MICRO_PER_MIN).toBe(55000n);
      expect(PRICING.RECORDING_MICRO_PER_MIN).toBe(2500n);

      process.env.TELEPHONY_LOCAL_INBOUND_RATE = '0.075';
      expect(PRICING.LOCAL_INBOUND_MICRO_PER_MIN).toBe(75000n);
    });
  });
});
