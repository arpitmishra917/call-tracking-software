import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { BuyersService } from './buyers.service.js';
import { CampaignsService } from './campaigns.service.js';
import { CallsService } from '../calls/calls.service.js';
import { CallController, TELEPHONY_PROVIDER } from '../telephony/call-controller.js';
import { FakeTelephonyProvider } from '../telephony/fake.provider.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { UsageService } from '../usage/usage.service.js';
import { UsageBillingService } from '../billing/usage-billing.service.js';
import { WalletService } from '../billing/wallet.service.js';
import { CommercialEvaluatorService } from '../commercial/commercial-evaluator.service.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { CallState, CallAttemptState } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';

describe('Buyer Concurrency Limits & Safe Call Routing', () => {
  let buyersService: BuyersService;
  let callsService: CallsService;
  let callController: CallController;
  let fakeProvider: FakeTelephonyProvider;
  let prisma: any;
  let usageBillingService: any;
  let walletService: any;
  let commercialEvaluatorService: any;

  beforeEach(async () => {
    fakeProvider = new FakeTelephonyProvider();
    usageBillingService = {
      billCallUsage: vi.fn().mockResolvedValue({ success: true }),
      billRecordingUsage: vi.fn().mockResolvedValue({ success: true }),
    };
    walletService = {
      reserveBalance: vi.fn().mockResolvedValue({ success: true }),
      releaseReservation: vi.fn().mockResolvedValue({ success: true }),
      settleUsage: vi.fn().mockResolvedValue({ success: true }),
    };
    commercialEvaluatorService = {
      evaluateCall: vi.fn().mockResolvedValue({ success: true }),
    };

    prisma = {
      $transaction: vi.fn().mockImplementation(async (cb) => cb(prisma)),
      $queryRaw: vi.fn().mockResolvedValue([]),
      buyer: {
        create: vi.fn(),
        update: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
      },
      buyerReservation: {
        create: vi.fn().mockResolvedValue({ id: 'res_1', status: 'ACTIVE' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      call: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      callAttempt: {
        create: vi.fn().mockResolvedValue({ id: 'att_1', state: CallAttemptState.INITIATED }),
        update: vi.fn().mockResolvedValue({ id: 'att_1' }),
        findUnique: vi.fn(),
      },
      campaign: {
        findUnique: vi.fn(),
      },
      phoneNumber: {
        findFirst: vi.fn().mockResolvedValue({ number_type: 'LOCAL', phone_number: '+15559876543' }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BuyersService,
        CampaignsService,
        CallsService,
        CallController,
        {
          provide: TELEPHONY_PROVIDER,
          useValue: fakeProvider,
        },
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: PermissionsService,
          useValue: {
            hasResourceScope: async () => true,
            hasPermission: async () => true,
            getPermissionsForUser: async () => [{ key: 'buyer:create', scope_type: 'ALL' }],
          },
        },
        {
          provide: UsageService,
          useValue: { recordUsage: vi.fn() },
        },
        {
          provide: UsageBillingService,
          useValue: usageBillingService,
        },
        {
          provide: WalletService,
          useValue: walletService,
        },
        {
          provide: CommercialEvaluatorService,
          useValue: commercialEvaluatorService,
        },
        {
          provide: WebhooksService,
          useValue: { queueEvent: vi.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    buyersService = module.get<BuyersService>(BuyersService);
    callsService = module.get<CallsService>(CallsService);
    callController = module.get<CallController>(CallController);
  });

  describe('1. Mandatory Concurrency Limit Validation', () => {
    it('rejects buyer creation if max_concurrent_calls is missing', async () => {
      await expect(
        buyersService.createBuyer('ws_1', 'Buyer A', '+15551234567', 30, undefined as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects buyer creation if max_concurrent_calls is null', async () => {
      await expect(
        buyersService.createBuyer('ws_1', 'Buyer A', '+15551234567', 30, null as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects buyer creation if max_concurrent_calls is <= 0', async () => {
      await expect(
        buyersService.createBuyer('ws_1', 'Buyer A', '+15551234567', 30, 0),
      ).rejects.toThrow(/positive integer/i);

      await expect(
        buyersService.createBuyer('ws_1', 'Buyer A', '+15551234567', 30, -3),
      ).rejects.toThrow(/positive integer/i);
    });

    it('rejects buyer creation if max_concurrent_calls is not an integer', async () => {
      await expect(
        buyersService.createBuyer('ws_1', 'Buyer A', '+15551234567', 30, 2.5),
      ).rejects.toThrow(/positive integer/i);

      await expect(
        buyersService.createBuyer('ws_1', 'Buyer A', '+15551234567', 30, 'abc' as any),
      ).rejects.toThrow(/positive integer/i);
    });

    it('rejects buyer creation if max_concurrent_calls > 1000', async () => {
      await expect(
        buyersService.createBuyer('ws_1', 'Buyer A', '+15551234567', 30, 1001),
      ).rejects.toThrow('cannot exceed 1000');
    });

    it('persists buyer when valid max_concurrent_calls is provided', async () => {
      prisma.buyer.create.mockResolvedValue({
        id: 'buyer_1',
        name: 'Valid Buyer',
        destination_number: '+15551234567',
        max_concurrent_calls: 3,
        timeout: 30,
        status: 'ACTIVE',
      });

      const result = await buyersService.createBuyer('ws_1', 'Valid Buyer', '+15551234567', 30, 3);
      expect(result.max_concurrent_calls).toBe(3);
      expect(prisma.buyer.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          max_concurrent_calls: 3,
        }),
      });
    });

    it('validates max_concurrent_calls on update', async () => {
      prisma.buyer.findUnique.mockResolvedValue({
        id: 'b1',
        workspace_id: 'ws_1',
        status: 'ACTIVE',
      });

      await expect(
        buyersService.updateBuyer('ws_1', 'b1', { max_concurrent_calls: -1 }),
      ).rejects.toThrow(BadRequestException);

      prisma.buyer.update.mockResolvedValue({ id: 'b1', max_concurrent_calls: 10 });
      const updated = await buyersService.updateBuyer('ws_1', 'b1', { max_concurrent_calls: 10 });
      expect(updated.max_concurrent_calls).toBe(10);
    });
  });

  describe('2. Atomic Capacity Reservation in CallsService', () => {
    it('reserves capacity slot when buyer has available capacity', async () => {
      const callId = 'call_1';
      prisma.call.findUnique.mockResolvedValue({
        id: callId,
        workspace_id: 'ws_1',
        campaign_id: 'camp_1',
        state: CallState.ROUTING,
        attempts: [],
      });

      prisma.campaign.findUnique.mockResolvedValue({
        id: 'camp_1',
        status: 'ACTIVE',
        buyers: [
          {
            buyer_id: 'buyer_1',
            priority: 1,
            status: 'ACTIVE',
            buyer: { id: 'buyer_1', name: 'Buyer 1', status: 'ACTIVE', destination_number: '+15551111111' },
          },
        ],
      });

      // Mock row lock for buyer
      prisma.$queryRaw.mockImplementation((query: any) => {
        const text = Array.isArray(query) ? query.join(' ') : JSON.stringify(query);
        if (text.includes('buyers') && text.includes('FOR UPDATE')) {
          return Promise.resolve([{ id: 'buyer_1', max_concurrent_calls: 2 }]);
        }
        if (text.includes('buyer_reservations') && text.includes('COUNT')) {
          return Promise.resolve([{ count: 0 }]); // 0 active reservations, limit is 2
        }
        return Promise.resolve([]);
      });

      const result = await callsService.prepareNextBuyer(callId);

      expect(result.action).toBe('DIAL');
      expect(result.buyer.id).toBe('buyer_1');
      expect(prisma.buyerReservation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          workspace_id: 'ws_1',
          buyer_id: 'buyer_1',
          call_id: callId,
          status: 'ACTIVE',
        }),
      });
    });

    it('skips full buyer and dials next eligible buyer in priority order', async () => {
      const callId = 'call_1';
      prisma.call.findUnique.mockResolvedValue({
        id: callId,
        workspace_id: 'ws_1',
        campaign_id: 'camp_1',
        state: CallState.ROUTING,
        attempts: [],
      });

      prisma.campaign.findUnique.mockResolvedValue({
        id: 'camp_1',
        status: 'ACTIVE',
        buyers: [
          {
            buyer_id: 'buyer_1',
            priority: 1,
            status: 'ACTIVE',
            buyer: { id: 'buyer_1', name: 'Buyer 1 (Full)', status: 'ACTIVE', destination_number: '+15551111111' },
          },
          {
            buyer_id: 'buyer_2',
            priority: 2,
            status: 'ACTIVE',
            buyer: { id: 'buyer_2', name: 'Buyer 2 (Available)', status: 'ACTIVE', destination_number: '+15552222222' },
          },
        ],
      });

      let checkedBuyer1 = false;
      prisma.$queryRaw.mockImplementation((query: any, ...values: any[]) => {
        const text = Array.isArray(query) ? query.join(' ') : JSON.stringify(query);
        if (text.includes('buyers') && text.includes('FOR UPDATE')) {
          const buyerId = values[0];
          return Promise.resolve([{ id: buyerId, max_concurrent_calls: 1 }]);
        }
        if (text.includes('buyer_reservations')) {
          if (!checkedBuyer1) {
            checkedBuyer1 = true;
            return Promise.resolve([{ count: 1 }]); // buyer_1 has 1 active reservation (at capacity 1)
          }
          return Promise.resolve([{ count: 0 }]); // buyer_2 has 0 active reservations (available)
        }
        return Promise.resolve([]);
      });

      const result = await callsService.prepareNextBuyer(callId);

      expect(result.action).toBe('DIAL');
      expect(result.buyer.id).toBe('buyer_2');
      expect(prisma.buyerReservation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          buyer_id: 'buyer_2',
          status: 'ACTIVE',
        }),
      });
    });

    it('returns BUSY immediately when all eligible buyers are at maximum capacity', async () => {
      const callId = 'call_1';
      prisma.call.findUnique.mockResolvedValue({
        id: callId,
        workspace_id: 'ws_1',
        campaign_id: 'camp_1',
        state: CallState.ROUTING,
        attempts: [],
      });

      prisma.campaign.findUnique.mockResolvedValue({
        id: 'camp_1',
        status: 'ACTIVE',
        buyers: [
          {
            buyer_id: 'buyer_1',
            priority: 1,
            status: 'ACTIVE',
            buyer: { id: 'buyer_1', name: 'Buyer 1', status: 'ACTIVE', destination_number: '+15551111111' },
          },
          {
            buyer_id: 'buyer_2',
            priority: 2,
            status: 'ACTIVE',
            buyer: { id: 'buyer_2', name: 'Buyer 2', status: 'ACTIVE', destination_number: '+15552222222' },
          },
        ],
      });

      prisma.$queryRaw.mockImplementation((query: any, ...values: any[]) => {
        const text = Array.isArray(query) ? query.join(' ') : JSON.stringify(query);
        if (text.includes('buyers') && text.includes('FOR UPDATE')) {
          return Promise.resolve([{ id: values[0] || 'buyer', max_concurrent_calls: 1 }]);
        }
        if (text.includes('buyer_reservations')) {
          // Both buyers are currently at capacity (count: 1 >= limit: 1)
          return Promise.resolve([{ count: 1 }]);
        }
        return Promise.resolve([]);
      });

      prisma.call.update.mockResolvedValue({
        id: callId,
        state: CallState.FAILED,
      });

      const result = await callsService.prepareNextBuyer(callId);

      expect(result.action).toBe('BUSY');
      expect(result.call.state).toBe(CallState.FAILED);
      expect(prisma.callAttempt.create).not.toHaveBeenCalled();
      expect(prisma.buyerReservation.create).not.toHaveBeenCalled();
    });
  });

  describe('3. CallController Immediate Busy Handling & Wallet Settlement', () => {
    it('hangs up caller with BUSY and immediately releases unused wallet balance', async () => {
      const call = {
        id: 'call_busy_1',
        provider_call_id: 'telnyx_call_leg_123',
        workspace_id: 'ws_1',
        to_number: '+15559876543',
        state: CallState.ROUTING,
      };

      vi.spyOn(callsService, 'prepareNextBuyer').mockResolvedValue({
        action: 'BUSY',
        call: { ...call, state: CallState.FAILED },
      });

      await (callController as any).dialNextBuyer(call);

      const actions = fakeProvider.getActions();
      const hangupAction = actions.find((a) => a.action === 'hangup');
      expect(hangupAction).toBeDefined();
      expect(hangupAction?.callId).toBe('telnyx_call_leg_123');
      expect(hangupAction?.reason).toBe('BUSY');

      expect(usageBillingService.billCallUsage).toHaveBeenCalledWith(
        'ws_1',
        'call_busy_1',
        'LOCAL',
        0,
      );
    });
  });

  describe('4. Reservation Release on Terminal States', () => {
    it('releases buyer reservation on terminal attempt transition', async () => {
      prisma.callAttempt.findUnique.mockResolvedValue({
        id: 'att_1',
        call_id: 'c1',
        state: CallAttemptState.RINGING,
      });
      prisma.callAttempt.update.mockResolvedValue({
        id: 'att_1',
        state: CallAttemptState.FAILED,
      });

      await callsService.transitionAttempt('att_1', CallAttemptState.FAILED);

      expect(prisma.buyerReservation.updateMany).toHaveBeenCalledWith({
        where: {
          attempt_id: 'att_1',
          status: 'ACTIVE',
        },
        data: expect.objectContaining({
          status: 'RELEASED',
        }),
      });
    });

    it('releases buyer reservation when dialBuyer fails in CallController', async () => {
      const call = {
        id: 'call_fail_1',
        provider_call_id: 'leg_caller',
        workspace_id: 'ws_1',
        to_number: '+15559876543',
        state: CallState.ROUTING,
      };

      vi.spyOn(callsService, 'prepareNextBuyer')
        .mockResolvedValueOnce({
          action: 'DIAL',
          call,
          attempt: { id: 'att_failing' },
          buyer: { id: 'buyer_err', destination_number: '+15559999999', timeout: 30 },
        })
        .mockResolvedValueOnce({
          action: 'NONE',
        });

      vi.spyOn(fakeProvider, 'dialBuyer').mockRejectedValue(new Error('Telephony network failure'));
      const releaseSpy = vi.spyOn(callsService, 'releaseBuyerReservation').mockResolvedValue(undefined);
      const transitionSpy = vi.spyOn(callsService, 'transitionAttempt').mockResolvedValue({} as any);

      await (callController as any).dialNextBuyer(call);

      expect(releaseSpy).toHaveBeenCalledWith('att_failing');
      expect(transitionSpy).toHaveBeenCalledWith('att_failing', CallAttemptState.FAILED);
    });
  });
});
