import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isProductionEnvironment,
  isMockPaymentPermitted,
  assertMockPaymentPermitted,
} from '../src/billing/payment-safeguards.util.js';
import { MockPaymentProvider } from '../src/billing/mock-payment.provider.js';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { PaymentService } from '../src/settlement/payment.service.js';
import { BillingService } from '../src/billing/billing.service.js';
import {
  SettlementStatus,
  PaymentStatus,
  InstructionStatus,
  ExecutionStatus,
  Prisma,
} from '@prisma/client';

describe('Payment & Settlement Safeguards (Forensic Regression)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('1. Environment & Config Fail-Closed Safeguards', () => {
    it('treats production, prod, live, and staging as production environments', () => {
      for (const env of ['production', 'prod', 'live', 'staging', 'PRODUCTION', 'Prod']) {
        process.env.NODE_ENV = env;
        expect(isProductionEnvironment()).toBe(true);
      }
    });

    it('fails closed: treats missing, empty, or unknown NODE_ENV as production', () => {
      delete process.env.NODE_ENV;
      expect(isProductionEnvironment()).toBe(true);

      process.env.NODE_ENV = '';
      expect(isProductionEnvironment()).toBe(true);

      process.env.NODE_ENV = 'unknown_env';
      expect(isProductionEnvironment()).toBe(true);

      process.env.NODE_ENV = 'qa-cluster';
      expect(isProductionEnvironment()).toBe(true);
    });

    it('identifies development, test, and local as non-production environments', () => {
      for (const env of ['development', 'test', 'local', 'DEVELOPMENT', 'Test']) {
        process.env.NODE_ENV = env;
        expect(isProductionEnvironment()).toBe(false);
      }
    });

    it('production rejects mock payments even if WALLET_MOCK_PAYMENTS_ENABLED is explicitly true', () => {
      process.env.NODE_ENV = 'production';
      process.env.WALLET_MOCK_PAYMENTS_ENABLED = 'true';
      expect(isMockPaymentPermitted()).toBe(false);

      expect(() => assertMockPaymentPermitted('test-context')).toThrow(ForbiddenException);
    });

    it('production rejects mock payments when WALLET_MOCK_PAYMENTS_ENABLED is disabled', () => {
      process.env.NODE_ENV = 'production';
      process.env.WALLET_MOCK_PAYMENTS_ENABLED = 'false';
      expect(isMockPaymentPermitted()).toBe(false);

      expect(() => assertMockPaymentPermitted('test-context')).toThrow(ForbiddenException);
    });

    it('missing NODE_ENV rejects mock payments even if flag is true', () => {
      delete process.env.NODE_ENV;
      process.env.WALLET_MOCK_PAYMENTS_ENABLED = 'true';
      expect(isMockPaymentPermitted()).toBe(false);

      expect(() => assertMockPaymentPermitted('test-context')).toThrow(ForbiddenException);
    });

    it('non-production permits mock payments ONLY when WALLET_MOCK_PAYMENTS_ENABLED is true', () => {
      process.env.NODE_ENV = 'test';
      process.env.WALLET_MOCK_PAYMENTS_ENABLED = 'true';
      expect(isMockPaymentPermitted()).toBe(true);
      expect(() => assertMockPaymentPermitted('test-context')).not.toThrow();

      // Disabled flag
      process.env.WALLET_MOCK_PAYMENTS_ENABLED = 'false';
      expect(isMockPaymentPermitted()).toBe(false);
      expect(() => assertMockPaymentPermitted('test-context')).toThrow(ForbiddenException);

      // Missing flag
      delete process.env.WALLET_MOCK_PAYMENTS_ENABLED;
      expect(isMockPaymentPermitted()).toBe(false);
      expect(() => assertMockPaymentPermitted('test-context')).toThrow(ForbiddenException);
    });
  });

  describe('2. MockPaymentProvider Safeguards & Provenance', () => {
    let mockWalletService: any;
    let provider: MockPaymentProvider;

    beforeEach(() => {
      mockWalletService = {
        creditWallet: vi.fn().mockResolvedValue({ id: 'tx-1' }),
      };
      provider = new MockPaymentProvider(mockWalletService);
    });

    it('rejects top-up in production unconditionally (even with accidental flag)', async () => {
      process.env.NODE_ENV = 'production';
      process.env.WALLET_MOCK_PAYMENTS_ENABLED = 'true';

      await expect(provider.createWalletTopUp('ws-1', 5000, 'http://return')).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockWalletService.creditWallet).not.toHaveBeenCalled();
    });

    it('rejects top-up if WALLET_MOCK_PAYMENTS_ENABLED is missing', async () => {
      process.env.NODE_ENV = 'test';
      delete process.env.WALLET_MOCK_PAYMENTS_ENABLED;

      await expect(provider.createWalletTopUp('ws-1', 5000, 'http://return')).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockWalletService.creditWallet).not.toHaveBeenCalled();
    });

    it('credits wallet with explicit MOCK_PAYMENT referenceType and [TEST_FUNDS] description in dev/test', async () => {
      process.env.NODE_ENV = 'test';
      process.env.WALLET_MOCK_PAYMENTS_ENABLED = 'true';

      const res = await provider.createWalletTopUp('ws-1', 2500, 'http://return');

      expect(res.url).toBe('http://return');
      expect(res.referenceId).toMatch(/^mock_/);
      expect(mockWalletService.creditWallet).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'ws-1',
          amountMicro: 25000000n, // 2500 cents * 10000
          referenceType: 'MOCK_PAYMENT',
          description: expect.stringContaining('[TEST_FUNDS]'),
        }),
      );
    });

    it('rejects top-up below minimum 2500 minor units ($25)', async () => {
      process.env.NODE_ENV = 'test';
      process.env.WALLET_MOCK_PAYMENTS_ENABLED = 'true';

      await expect(provider.createWalletTopUp('ws-1', 2499, 'http://return')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockWalletService.creditWallet).not.toHaveBeenCalled();
    });
  });

  describe('3. PaymentService Settlement Execution Safeguards', () => {
    let mockPrisma: any;
    let paymentService: PaymentService;

    beforeEach(() => {
      mockPrisma = {
        $transaction: vi.fn(async (cb) => cb(mockPrisma)),
        settlementBatch: {
          findFirst: vi.fn(),
          update: vi.fn(),
        },
        paymentInstruction: {
          findFirst: vi.fn(),
          update: vi.fn(),
        },
        paymentExecution: {
          create: vi.fn(),
          findUnique: vi.fn(),
        },
      };
      paymentService = new PaymentService(mockPrisma);
    });

    it('strictly forbids provider=mock in production mode regardless of flag', async () => {
      process.env.NODE_ENV = 'production';
      process.env.WALLET_MOCK_PAYMENTS_ENABLED = 'true';

      await expect(
        paymentService.createPaymentExecution('ws-1', 'pi-1', {
          provider: 'mock',
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(mockPrisma.paymentExecution.create).not.toHaveBeenCalled();
    });

    it('strictly forbids provider=mock in dev/test when flag is disabled or missing', async () => {
      process.env.NODE_ENV = 'development';
      process.env.WALLET_MOCK_PAYMENTS_ENABLED = 'false';

      await expect(
        paymentService.createPaymentExecution('ws-1', 'pi-1', {
          provider: 'mock',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows real provider (wire) in production mode unaffected', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.WALLET_MOCK_PAYMENTS_ENABLED;

      const mockInstruction: any = {
        id: 'pi-wire-prod',
        workspace_id: 'ws-1',
        settlement_batch_id: 'batch-wire-prod',
        amount: new Prisma.Decimal('1000.0000'),
        currency: 'USD',
        status: InstructionStatus.CREATED,
        executions: [],
        batch: {
          id: 'batch-wire-prod',
          settlement_status: SettlementStatus.FINALIZED,
          payment_status: PaymentStatus.PENDING,
        },
      };

      mockPrisma.paymentInstruction.findFirst.mockResolvedValue(mockInstruction);
      mockPrisma.paymentExecution.create.mockResolvedValue({
        id: 'pe-wire-1',
        attempt_number: 1,
        provider: 'wire',
        status: ExecutionStatus.SUCCEEDED,
      });

      const res = await paymentService.createPaymentExecution('ws-1', 'pi-wire-prod', {
        provider: 'wire',
        simulate_status: 'SUCCEEDED',
      });

      expect(res.provider).toBe('wire');
      expect(mockPrisma.paymentExecution.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ provider: 'wire' }),
        }),
      );
    });

    it('allows provider=mock in test mode when explicitly enabled', async () => {
      process.env.NODE_ENV = 'test';
      process.env.WALLET_MOCK_PAYMENTS_ENABLED = 'true';

      const mockInstruction: any = {
        id: 'pi-mock-dev',
        workspace_id: 'ws-1',
        settlement_batch_id: 'batch-mock-dev',
        amount: new Prisma.Decimal('250.0000'),
        currency: 'USD',
        status: InstructionStatus.CREATED,
        executions: [],
        batch: {
          id: 'batch-mock-dev',
          settlement_status: SettlementStatus.FINALIZED,
          payment_status: PaymentStatus.PENDING,
        },
      };

      mockPrisma.paymentInstruction.findFirst.mockResolvedValue(mockInstruction);
      mockPrisma.paymentExecution.create.mockResolvedValue({
        id: 'pe-mock-dev',
        attempt_number: 1,
        provider: 'mock',
        status: ExecutionStatus.SUCCEEDED,
      });

      const res = await paymentService.createPaymentExecution('ws-1', 'pi-mock-dev', {
        provider: 'mock',
        simulate_status: 'SUCCEEDED',
      });

      expect(res.provider).toBe('mock');
      expect(mockPrisma.settlementBatch.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'batch-mock-dev' },
          data: expect.objectContaining({
            payment_status: PaymentStatus.SUCCEEDED,
            settlement_status: SettlementStatus.CLOSED,
          }),
        }),
      );
    });
  });

  describe('4. Stripe Webhook Verification and Idempotency Integrity', () => {
    let mockPrisma: any;
    let billingService: BillingService;

    beforeEach(() => {
      mockPrisma = {
        webhookEvent: {
          findUnique: vi.fn(),
          create: vi.fn(),
          update: vi.fn(),
        },
        subscription: {
          upsert: vi.fn(),
          updateMany: vi.fn(),
          findUnique: vi.fn(),
        },
        invoice: {
          upsert: vi.fn(),
        },
      };

      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret_123';
      billingService = new BillingService(mockPrisma);
    });

    it('rejects webhook with invalid signature', async () => {
      // Mock stripe.webhooks.constructEvent to throw signature verification error
      (billingService as any).stripe = {
        webhooks: {
          constructEvent: vi.fn().mockImplementation(() => {
            throw new Error('No signatures found matching the expected signature for payload');
          }),
        },
      };

      const payload = Buffer.from(JSON.stringify({ id: 'evt_123' }));
      await expect(
        billingService.handleWebhook('invalid_sig', payload),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.webhookEvent.create).not.toHaveBeenCalled();
    });

    it('ignores duplicate webhook event idempotently when already PROCESSED', async () => {
      (billingService as any).stripe = {
        webhooks: {
          constructEvent: vi.fn().mockReturnValue({
            id: 'evt_processed_123',
            type: 'customer.subscription.updated',
          }),
        },
      };

      mockPrisma.webhookEvent.findUnique.mockResolvedValue({
        id: 'wh-rec-1',
        provider: 'stripe',
        providerEventId: 'evt_processed_123',
        status: 'PROCESSED',
      });

      const payload = Buffer.from(JSON.stringify({ id: 'evt_processed_123' }));
      await billingService.handleWebhook('valid_sig', payload);

      // Verify no duplicate processing took place
      expect(mockPrisma.webhookEvent.create).not.toHaveBeenCalled();
      expect(mockPrisma.subscription.updateMany).not.toHaveBeenCalled();
    });

    it('processes new valid webhook event and marks as PROCESSED', async () => {
      const mockEvent = {
        id: 'evt_new_456',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_test_123',
            status: 'active',
            current_period_start: 1700000000,
            current_period_end: 1702592000,
            cancel_at_period_end: false,
          },
        },
      };

      (billingService as any).stripe = {
        webhooks: {
          constructEvent: vi.fn().mockReturnValue(mockEvent),
        },
      };

      mockPrisma.webhookEvent.findUnique.mockResolvedValue(null);
      mockPrisma.webhookEvent.create.mockResolvedValue({
        id: 'wh-rec-new',
        provider: 'stripe',
        providerEventId: 'evt_new_456',
        status: 'PENDING',
      });
      mockPrisma.subscription.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.webhookEvent.update.mockResolvedValue({ id: 'wh-rec-new', status: 'PROCESSED' });

      const payload = Buffer.from(JSON.stringify(mockEvent));
      await billingService.handleWebhook('valid_sig', payload);

      expect(mockPrisma.webhookEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            provider: 'stripe',
            providerEventId: 'evt_new_456',
            status: 'PENDING',
          }),
        }),
      );

      expect(mockPrisma.webhookEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'wh-rec-new' },
          data: { status: 'PROCESSED' },
        }),
      );
    });
  });
});
