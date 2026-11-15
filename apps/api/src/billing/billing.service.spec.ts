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
            phoneNumber: { count: vi.fn() },
            workspaceBalance: { findUnique: vi.fn() },
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

  
  describe('getBalance', () => {
    it('1. new workspace balance = 0', async () => {
      vi.spyOn(prisma.workspace, 'findUnique').mockResolvedValue({ id: 'ws-1' } as any);
      vi.spyOn(prisma.workspaceBalance, 'findUnique').mockResolvedValue(null);
      const res = await service.getBalance('ws-1');
      expect(res.balance.amountMinor).toBe(0);
      expect(res.balance.currency).toBe('USD');
    });

    it('2. balance retrieval', async () => {
      vi.spyOn(prisma.workspace, 'findUnique').mockResolvedValue({ id: 'ws-1' } as any);
      vi.spyOn(prisma.workspaceBalance, 'findUnique').mockResolvedValue({
        workspace_id: 'ws-1',
        balance_minor: 5000,
        currency: 'USD'
      } as any);
      const res = await service.getBalance('ws-1');
      expect(res.balance.amountMinor).toBe(5000);
      expect(res.balance.currency).toBe('USD');
    });

    it('3. workspace isolation', async () => {
      vi.spyOn(prisma.workspace, 'findUnique').mockResolvedValue({ id: 'ws-2' } as any);
      const spy = vi.spyOn(prisma.workspaceBalance, 'findUnique').mockResolvedValue(null);
      await service.getBalance('ws-2');
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ where: { workspace_id: 'ws-2' } }));
    });

    it('4. unauthorized workspace access / workspace not found', async () => {
      vi.spyOn(prisma.workspace, 'findUnique').mockResolvedValue(null);
      await expect(service.getBalance('ws-invalid')).rejects.toThrow('Workspace not found');
    });
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

    it('should return active phone numbers inventory count of 3 when three ACTIVE numbers exist', async () => {
      vi.spyOn(prisma.workspace, 'findUnique').mockResolvedValue({
        id: 'ws-1',
      } as any);
      vi.spyOn(prisma.invoice, 'findMany').mockResolvedValue([]);
      vi.spyOn(prisma.plan, 'findMany').mockResolvedValue([]);
      vi.spyOn(prisma.usageRecord, 'groupBy').mockResolvedValue([]);
      const countSpy = vi.spyOn(prisma.phoneNumber, 'count').mockResolvedValue(3);

      const result = await service.getBillingState('ws-1');
      expect(result.usage.active_phone_numbers).toBe(3);
      expect(countSpy).toHaveBeenCalledWith({
        where: {
          workspace_id: 'ws-1',
          status: 'ACTIVE',
        },
      });
    });

    it('should exclude RELEASED numbers from active phone numbers inventory', async () => {
      vi.spyOn(prisma.workspace, 'findUnique').mockResolvedValue({
        id: 'ws-1',
      } as any);
      vi.spyOn(prisma.invoice, 'findMany').mockResolvedValue([]);
      vi.spyOn(prisma.plan, 'findMany').mockResolvedValue([]);
      vi.spyOn(prisma.usageRecord, 'groupBy').mockResolvedValue([]);
      const countSpy = vi.spyOn(prisma.phoneNumber, 'count').mockResolvedValue(3);

      const result = await service.getBillingState('ws-1');
      expect(countSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'ACTIVE',
          }),
        }),
      );
      expect(countSpy.mock.calls[0][0].where.status).not.toBe('RELEASED');
      expect(result.usage.active_phone_numbers).toBe(3);
    });

    it('should exclude numbers belonging to another workspace', async () => {
      vi.spyOn(prisma.workspace, 'findUnique').mockResolvedValue({
        id: 'ws-tenant-a',
      } as any);
      vi.spyOn(prisma.invoice, 'findMany').mockResolvedValue([]);
      vi.spyOn(prisma.plan, 'findMany').mockResolvedValue([]);
      vi.spyOn(prisma.usageRecord, 'groupBy').mockResolvedValue([]);
      const countSpy = vi.spyOn(prisma.phoneNumber, 'count').mockResolvedValue(2);

      await service.getBillingState('ws-tenant-a');
      expect(countSpy).toHaveBeenCalledWith({
        where: {
          workspace_id: 'ws-tenant-a',
          status: 'ACTIVE',
        },
      });
    });

    it('should preserve PHONE_NUMBER UsageRecord aggregation unchanged', async () => {
      vi.spyOn(prisma.workspace, 'findUnique').mockResolvedValue({
        id: 'ws-1',
      } as any);
      vi.spyOn(prisma.invoice, 'findMany').mockResolvedValue([]);
      vi.spyOn(prisma.plan, 'findMany').mockResolvedValue([]);
      vi.spyOn(prisma.usageRecord, 'groupBy').mockResolvedValue([
        { type: 'PHONE_NUMBER', _sum: { quantity: 7 } } as any,
      ]);
      vi.spyOn(prisma.phoneNumber, 'count').mockResolvedValue(3);

      const result = await service.getBillingState('ws-1');
      expect(result.usage.summary.PHONE_NUMBER).toBe(7);
      expect(result.usage.active_phone_numbers).toBe(3);
    });

    it('should preserve CALL_MINUTE and RECORDING_STORAGE metrics unchanged', async () => {
      vi.spyOn(prisma.workspace, 'findUnique').mockResolvedValue({
        id: 'ws-1',
      } as any);
      vi.spyOn(prisma.invoice, 'findMany').mockResolvedValue([]);
      vi.spyOn(prisma.plan, 'findMany').mockResolvedValue([]);
      vi.spyOn(prisma.usageRecord, 'groupBy').mockResolvedValue([
        { type: 'CALL_MINUTE', _sum: { quantity: 120 } } as any,
        { type: 'RECORDING_STORAGE', _sum: { quantity: 45 } } as any,
      ]);
      vi.spyOn(prisma.phoneNumber, 'count').mockResolvedValue(3);

      const result = await service.getBillingState('ws-1');
      expect(result.usage.summary.CALL_MINUTE).toBe(120);
      expect(result.usage.summary.RECORDING_STORAGE).toBe(45);
      expect(result.usage.active_phone_numbers).toBe(3);
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
