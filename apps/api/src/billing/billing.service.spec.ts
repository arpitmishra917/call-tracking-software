import { Test, TestingModule } from '@nestjs/testing';
import { BillingService } from './billing.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { vi, describe, it, expect, beforeEach } from 'vitest';

process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_mock';

describe('BillingService', () => {
  let service: BillingService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        {
          provide: PrismaService,
          useValue: {
            workspace: { findUnique: vi.fn() },
            invoice: { findMany: vi.fn(), upsert: vi.fn() },
            plan: { findMany: vi.fn(), findUnique: vi.fn() },
            billingCustomer: { findUnique: vi.fn(), create: vi.fn() },
            subscription: {
              upsert: vi.fn(),
              updateMany: vi.fn(),
              findUnique: vi.fn(),
            },
            usageRecord: { groupBy: vi.fn() },
            webhookEvent: {
              findUnique: vi.fn(),
              create: vi.fn(),
              update: vi.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<BillingService>(BillingService);
    prisma = module.get<PrismaService>(PrismaService);

    // Mock stripe
    (service as any).stripe = {
      customers: { create: vi.fn().mockResolvedValue({ id: 'cus_123' }) },
      checkout: {
        sessions: {
          create: vi.fn().mockResolvedValue({ url: 'http://checkout' }),
        },
      },
      billingPortal: {
        sessions: {
          create: vi.fn().mockResolvedValue({ url: 'http://portal' }),
        },
      },
      webhooks: { constructEvent: vi.fn() },
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue({
          status: 'active',
          current_period_start: 1,
          current_period_end: 2,
        }),
      },
    };
  });

  describe('getBillingState', () => {
    it('should throw if workspace not found', async () => {
      vi.spyOn(prisma.workspace, 'findUnique').mockResolvedValue(null);
      await expect(service.getBillingState('ws-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should calculate usage summary', async () => {
      vi.spyOn(prisma.workspace, 'findUnique').mockResolvedValue({
        id: 'ws-1',
        subscription: {
          current_period_start: new Date(),
          current_period_end: new Date(),
        },
      } as any);
      vi.spyOn(prisma.invoice, 'findMany').mockResolvedValue([]);
      vi.spyOn(prisma.plan, 'findMany').mockResolvedValue([]);
      vi.spyOn(prisma.usageRecord, 'groupBy').mockResolvedValue([
        { type: 'CALL_MINUTE', _sum: { quantity: 50 } } as any,
      ]);

      const result = await service.getBillingState('ws-1');
      expect(result.usage.summary.CALL_MINUTE).toBe(50);
      expect(result.usage.summary.PHONE_NUMBER).toBe(0);
    });
  });

  describe('createCheckoutSession', () => {
    it('should throw if plan invalid', async () => {
      vi.spyOn(prisma.plan, 'findUnique').mockResolvedValue(null);
      await expect(
        service.createCheckoutSession('ws-1', 'plan-1', 'url'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create stripe customer and checkout', async () => {
      vi.spyOn(prisma.plan, 'findUnique').mockResolvedValue({
        id: 'plan-1',
        provider_price_id: 'price_123',
      } as any);
      vi.spyOn(prisma.billingCustomer, 'findUnique').mockResolvedValue(null);
      vi.spyOn(prisma.workspace, 'findUnique').mockResolvedValue({
        name: 'test',
      } as any);
      vi.spyOn(prisma.billingCustomer, 'create').mockResolvedValue({
        provider_customer_id: 'cus_123',
      } as any);

      const res = await service.createCheckoutSession('ws-1', 'plan-1', 'url');
      expect(res.url).toBe('http://checkout');
      expect((service as any).stripe.customers.create).toHaveBeenCalled();
      expect(
        (service as any).stripe.checkout.sessions.create,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'subscription',
          client_reference_id: 'ws-1',
        }),
      );
    });
  });

  describe('handleWebhook', () => {
    it('should reject invalid signature', async () => {
      vi.spyOn(
        (service as any).stripe.webhooks,
        'constructEvent',
      ).mockImplementation(() => {
        throw new Error('Bad sig');
      });
      await expect(
        service.handleWebhook('sig', Buffer.from('')),
      ).rejects.toThrow(BadRequestException);
    });

    it('should ignore duplicate event', async () => {
      vi.spyOn(
        (service as any).stripe.webhooks,
        'constructEvent',
      ).mockReturnValue({ id: 'evt_1', type: 'unknown' });
      vi.spyOn(prisma.webhookEvent, 'findUnique').mockResolvedValue({
        status: 'PROCESSED',
      } as any);

      await service.handleWebhook('sig', Buffer.from(''));
      // Event ignored, no create called
      expect(prisma.webhookEvent.create).not.toHaveBeenCalled();
    });

    it('should process new checkout.session.completed', async () => {
      vi.spyOn(
        (service as any).stripe.webhooks,
        'constructEvent',
      ).mockReturnValue({
        id: 'evt_1',
        type: 'checkout.session.completed',
        data: {
          object: {
            mode: 'subscription',
            metadata: { workspaceId: 'ws-1', planId: 'pl-1' },
            subscription: 'sub_123',
          },
        },
      });
      vi.spyOn(prisma.webhookEvent, 'findUnique').mockResolvedValue(null);
      vi.spyOn(prisma.webhookEvent, 'create').mockResolvedValue({
        id: 'we_1',
      } as any);

      await service.handleWebhook('sig', Buffer.from(''));
      expect(prisma.subscription.upsert).toHaveBeenCalled();
      expect(prisma.webhookEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'PROCESSED' } }),
      );
    });
  });
});
