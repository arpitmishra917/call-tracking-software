import { vi, describe, it, expect, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { CallsService } from '../calls/calls.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsageService } from '../usage/usage.service.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { CallState, CallAttemptState } from '@prisma/client';

function extractQueryInfo(query: any, ...values: any[]) {
  const text = Array.isArray(query)
    ? query.join(' ')
    : (Array.isArray(query?.strings) ? query.strings.join(' ') : String(query ?? ''));
  const allValues = Array.isArray(query)
    ? values
    : (Array.isArray(query?.values) ? query.values : values);
  return { text, allValues };
}

describe('Layer 1 & 2 Regression: Waterfall Overflow Routing Decisions & Isolation Invariants', () => {
  let callsService: CallsService;
  let prismaMock: any;
  let webhooksServiceMock: any;

  const mockWorkspaceId = 'ws-reg-waterfall';
  const mockCallId = 'call-reg-routing-1';
  const mockCampaignId = 'camp-reg-routing-1';

  beforeEach(async () => {
    prismaMock = {
      call: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      campaign: {
        findUnique: vi.fn(),
      },
      callAttempt: {
        create: vi.fn(),
        update: vi.fn(),
      },
      buyerReservation: {
        create: vi.fn().mockResolvedValue({ id: 'res-1' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      $queryRaw: vi.fn(),
      $transaction: vi.fn(async (cb) => {
        if (typeof cb === 'function') {
          return cb(prismaMock);
        }
        return cb;
      }),
    };

    webhooksServiceMock = {
      queueEvent: vi.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CallsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: UsageService, useValue: { recordUsage: vi.fn() } },
        { provide: WebhooksService, useValue: webhooksServiceMock },
        {
          provide: PermissionsService,
          useValue: {
            getPermissionsForUser: vi.fn().mockResolvedValue([]),
            hasPermission: vi.fn().mockResolvedValue(true),
            hasResourceScope: vi.fn().mockResolvedValue(true),
          },
        },
      ],
    }).compile();

    callsService = module.get<CallsService>(CallsService);
  });

  describe('Waterfall Priority & Destination Selection', () => {
    it('routes to highest priority active destination and creates attempt + buyer reservation', async () => {
      const call = {
        id: mockCallId,
        workspace_id: mockWorkspaceId,
        campaign_id: mockCampaignId,
        state: CallState.ROUTING,
        attempts: [],
      };

      const campaign = {
        id: mockCampaignId,
        status: 'ACTIVE',
        destination_numbers: [
          {
            id: 'cdn-1',
            priority: 1,
            weight: 100,
            status: 'ACTIVE',
            destination_number_id: 'dn-1',
            destination_number: {
              id: 'dn-1',
              workspace_id: mockWorkspaceId,
              buyer_id: 'buyer-1',
              destination_number: '+15551111111',
              timeout: 30,
              max_concurrent_calls: 5,
              status: 'ACTIVE',
              buyer: { id: 'buyer-1', status: 'ACTIVE', max_concurrent_calls: 10 },
            },
          },
          {
            id: 'cdn-2',
            priority: 2,
            weight: 100,
            status: 'ACTIVE',
            destination_number_id: 'dn-2',
            destination_number: {
              id: 'dn-2',
              workspace_id: mockWorkspaceId,
              buyer_id: 'buyer-2',
              destination_number: '+15552222222',
              timeout: 30,
              max_concurrent_calls: 5,
              status: 'ACTIVE',
              buyer: { id: 'buyer-2', status: 'ACTIVE', max_concurrent_calls: 10 },
            },
          },
        ],
      };

      prismaMock.call.findUnique.mockResolvedValue(call);
      prismaMock.campaign.findUnique.mockResolvedValue(campaign);

      prismaMock.$queryRaw.mockImplementation((query: any, ...values: any[]) => {
        const { text, allValues } = extractQueryInfo(query, ...values);
        if (text.includes('destination_numbers')) {
          return Promise.resolve([{ id: allValues[0] || 'dn-1', max_concurrent_calls: 5 }]);
        }
        if (text.includes('call_attempts')) {
          return Promise.resolve([{ count: 0 }]); // active attempts on dn-1 = 0
        }
        if (text.includes('buyers')) {
          return Promise.resolve([{ id: allValues[0] || 'buyer-1', max_concurrent_calls: 10 }]);
        }
        if (text.includes('buyer_reservations')) {
          return Promise.resolve([{ count: 0 }]);
        }
        return Promise.resolve([]);
      });

      const attemptRecord = {
        id: 'attempt-1',
        call_id: mockCallId,
        buyer_id: 'buyer-1',
        destination_number_id: 'dn-1',
        destination_number: '+15551111111',
        state: CallAttemptState.INITIATED,
      };
      prismaMock.callAttempt.create.mockResolvedValue(attemptRecord);

      const decision = await callsService.prepareNextBuyer(mockCallId);

      expect(decision.action).toBe('DIAL');
      expect(decision.destinationNumber.id).toBe('dn-1');
      expect(decision.buyer.id).toBe('buyer-1');
      expect(prismaMock.callAttempt.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          call_id: mockCallId,
          buyer_id: 'buyer-1',
          destination_number_id: 'dn-1',
          state: CallAttemptState.INITIATED,
        }),
      });
      expect(prismaMock.buyerReservation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          workspace_id: mockWorkspaceId,
          buyer_id: 'buyer-1',
          call_id: mockCallId,
          attempt_id: 'attempt-1',
          status: 'ACTIVE',
        }),
      });
      expect(webhooksServiceMock.queueEvent).toHaveBeenCalledWith(
        mockWorkspaceId,
        'call.attempt.started',
        attemptRecord,
      );
    });
  });

  describe('Waterfall Concurrency Saturation & Overflow', () => {
    it('overflows to next destination when primary destination is saturated (active >= max_concurrent_calls)', async () => {
      const call = {
        id: mockCallId,
        workspace_id: mockWorkspaceId,
        campaign_id: mockCampaignId,
        state: CallState.ROUTING,
        attempts: [],
      };

      const campaign = {
        id: mockCampaignId,
        status: 'ACTIVE',
        destination_numbers: [
          {
            id: 'cdn-1',
            priority: 1,
            weight: 100,
            status: 'ACTIVE',
            destination_number_id: 'dn-1',
            destination_number: {
              id: 'dn-1',
              workspace_id: mockWorkspaceId,
              buyer_id: 'buyer-1',
              destination_number: '+15551111111',
              timeout: 30,
              max_concurrent_calls: 2,
              status: 'ACTIVE',
              buyer: { id: 'buyer-1', status: 'ACTIVE', max_concurrent_calls: 10 },
            },
          },
          {
            id: 'cdn-2',
            priority: 2,
            weight: 100,
            status: 'ACTIVE',
            destination_number_id: 'dn-2',
            destination_number: {
              id: 'dn-2',
              workspace_id: mockWorkspaceId,
              buyer_id: 'buyer-2',
              destination_number: '+15552222222',
              timeout: 30,
              max_concurrent_calls: 5,
              status: 'ACTIVE',
              buyer: { id: 'buyer-2', status: 'ACTIVE', max_concurrent_calls: 10 },
            },
          },
        ],
      };

      prismaMock.call.findUnique.mockResolvedValue(call);
      prismaMock.campaign.findUnique.mockResolvedValue(campaign);

      prismaMock.$queryRaw.mockImplementation((query: any, ...values: any[]) => {
        const { text, allValues } = extractQueryInfo(query, ...values);
        if (text.includes('destination_numbers')) {
          if (allValues.includes('dn-1')) {
            return Promise.resolve([{ id: 'dn-1', max_concurrent_calls: 2 }]);
          }
          return Promise.resolve([{ id: 'dn-2', max_concurrent_calls: 5 }]);
        }
        if (text.includes('call_attempts')) {
          if (allValues.includes('dn-1')) {
            // dn-1 has 2 active calls (SATURATED)
            return Promise.resolve([{ count: 2 }]);
          }
          // dn-2 has 0 active calls (AVAILABLE)
          return Promise.resolve([{ count: 0 }]);
        }
        if (text.includes('buyers')) {
          return Promise.resolve([{ id: 'buyer-2', max_concurrent_calls: 10 }]);
        }
        if (text.includes('buyer_reservations')) {
          return Promise.resolve([{ count: 0 }]);
        }
        return Promise.resolve([]);
      });

      prismaMock.callAttempt.create.mockResolvedValue({
        id: 'attempt-2',
        call_id: mockCallId,
        buyer_id: 'buyer-2',
        destination_number_id: 'dn-2',
        state: CallAttemptState.INITIATED,
      });

      const decision = await callsService.prepareNextBuyer(mockCallId);

      // Verify it overflowed from dn-1 to dn-2!
      expect(decision.action).toBe('DIAL');
      expect(decision.destinationNumber.id).toBe('dn-2');
      expect(decision.buyer.id).toBe('buyer-2');
    });

    it('overflows to next destination when buyer organization capacity is saturated', async () => {
      const call = {
        id: mockCallId,
        workspace_id: mockWorkspaceId,
        campaign_id: mockCampaignId,
        state: CallState.ROUTING,
        attempts: [],
      };

      const campaign = {
        id: mockCampaignId,
        status: 'ACTIVE',
        destination_numbers: [
          {
            id: 'cdn-1',
            priority: 1,
            weight: 100,
            status: 'ACTIVE',
            destination_number_id: 'dn-1',
            destination_number: {
              id: 'dn-1',
              workspace_id: mockWorkspaceId,
              buyer_id: 'buyer-1',
              destination_number: '+15551111111',
              max_concurrent_calls: 10, // endpoint has room
              status: 'ACTIVE',
              buyer: { id: 'buyer-1', status: 'ACTIVE', max_concurrent_calls: 3 }, // buyer capped at 3
            },
          },
          {
            id: 'cdn-2',
            priority: 2,
            weight: 100,
            status: 'ACTIVE',
            destination_number_id: 'dn-2',
            destination_number: {
              id: 'dn-2',
              workspace_id: mockWorkspaceId,
              buyer_id: 'buyer-2',
              destination_number: '+15552222222',
              max_concurrent_calls: 10,
              status: 'ACTIVE',
              buyer: { id: 'buyer-2', status: 'ACTIVE', max_concurrent_calls: 5 },
            },
          },
        ],
      };

      prismaMock.call.findUnique.mockResolvedValue(call);
      prismaMock.campaign.findUnique.mockResolvedValue(campaign);

      prismaMock.$queryRaw.mockImplementation((query: any, ...values: any[]) => {
        const { text, allValues } = extractQueryInfo(query, ...values);
        if (text.includes('destination_numbers')) {
          return Promise.resolve([{ id: allValues[0] || 'dn-any', max_concurrent_calls: 10 }]);
        }
        if (text.includes('call_attempts')) {
          return Promise.resolve([{ count: 0 }]); // endpoints always free
        }
        if (text.includes('buyers')) {
          if (allValues.includes('buyer-1')) {
            return Promise.resolve([{ id: 'buyer-1', max_concurrent_calls: 3 }]);
          }
          return Promise.resolve([{ id: 'buyer-2', max_concurrent_calls: 5 }]);
        }
        if (text.includes('buyer_reservations')) {
          if (allValues.includes('buyer-1')) {
            // buyer-1 has 3 active reservations (SATURATED)
            return Promise.resolve([{ count: 3 }]);
          }
          // buyer-2 has 1 active reservation (AVAILABLE)
          return Promise.resolve([{ count: 1 }]);
        }
        return Promise.resolve([]);
      });

      prismaMock.callAttempt.create.mockResolvedValue({
        id: 'attempt-2',
        buyer_id: 'buyer-2',
        destination_number_id: 'dn-2',
      });

      const decision = await callsService.prepareNextBuyer(mockCallId);

      expect(decision.action).toBe('DIAL');
      expect(decision.destinationNumber.id).toBe('dn-2');
    });

    it('returns BUSY and marks call FAILED when ALL candidates in waterfall are concurrency-saturated', async () => {
      const call = {
        id: mockCallId,
        workspace_id: mockWorkspaceId,
        campaign_id: mockCampaignId,
        state: CallState.ROUTING,
        attempts: [],
      };

      const campaign = {
        id: mockCampaignId,
        status: 'ACTIVE',
        destination_numbers: [
          {
            id: 'cdn-1',
            priority: 1,
            weight: 100,
            status: 'ACTIVE',
            destination_number_id: 'dn-1',
            destination_number: {
              id: 'dn-1',
              workspace_id: mockWorkspaceId,
              buyer_id: 'buyer-1',
              destination_number: '+15551111111',
              max_concurrent_calls: 1,
              status: 'ACTIVE',
              buyer: { id: 'buyer-1', status: 'ACTIVE' },
            },
          },
        ],
      };

      prismaMock.call.findUnique.mockResolvedValue(call);
      prismaMock.campaign.findUnique.mockResolvedValue(campaign);

      prismaMock.$queryRaw.mockImplementation((query: any, ...values: any[]) => {
        const { text } = extractQueryInfo(query, ...values);
        if (text.includes('destination_numbers')) {
          return Promise.resolve([{ id: 'dn-1', max_concurrent_calls: 1 }]);
        }
        if (text.includes('call_attempts')) {
          return Promise.resolve([{ count: 1 }]); // 1 active attempt (Saturated)
        }
        return Promise.resolve([]);
      });

      const failedCall = { ...call, state: CallState.FAILED, ended_at: new Date() };
      prismaMock.call.update.mockResolvedValue(failedCall);

      const decision = await callsService.prepareNextBuyer(mockCallId);

      expect(decision.action).toBe('BUSY');
      expect(prismaMock.call.update).toHaveBeenCalledWith({
        where: { id: mockCallId },
        data: expect.objectContaining({ state: CallState.FAILED }),
      });
    });
  });

  describe('Multi-Tenant Boundary & Inactive Destination Deflection', () => {
    it('strictly defers / rejects foreign workspace destination numbers (Cross-Workspace Isolation)', async () => {
      const call = {
        id: mockCallId,
        workspace_id: mockWorkspaceId, // ws-reg-waterfall
        campaign_id: mockCampaignId,
        state: CallState.ROUTING,
        attempts: [],
      };

      const campaign = {
        id: mockCampaignId,
        status: 'ACTIVE',
        destination_numbers: [
          {
            id: 'cdn-foreign',
            priority: 1,
            weight: 100,
            status: 'ACTIVE',
            destination_number_id: 'dn-foreign',
            destination_number: {
              id: 'dn-foreign',
              workspace_id: 'ws-attacker-evil-corp', // Cross-tenant!
              buyer_id: 'buyer-foreign',
              destination_number: '+15559999999',
              status: 'ACTIVE',
              buyer: { id: 'buyer-foreign', status: 'ACTIVE' },
            },
          },
        ],
      };

      prismaMock.call.findUnique.mockResolvedValue(call);
      prismaMock.campaign.findUnique.mockResolvedValue(campaign);

      const noAnswerCall = { ...call, state: CallState.NO_ANSWER, ended_at: new Date() };
      prismaMock.call.update.mockResolvedValue(noAnswerCall);

      const decision = await callsService.prepareNextBuyer(mockCallId);

      // Foreign destination filtered out, leaving 0 remaining destinations -> HANGUP (NO_ANSWER)
      expect(decision.action).toBe('HANGUP');
      expect(prismaMock.call.update).toHaveBeenCalledWith({
        where: { id: mockCallId },
        data: expect.objectContaining({ state: CallState.NO_ANSWER }),
      });
      expect(prismaMock.callAttempt.create).not.toHaveBeenCalled();
    });

    it('skips disabled destinations (status: INACTIVE) and inactive buyers', async () => {
      const call = {
        id: mockCallId,
        workspace_id: mockWorkspaceId,
        campaign_id: mockCampaignId,
        state: CallState.ROUTING,
        attempts: [],
      };

      const campaign = {
        id: mockCampaignId,
        status: 'ACTIVE',
        destination_numbers: [
          {
            id: 'cdn-inactive-dn',
            priority: 1,
            weight: 100,
            status: 'ACTIVE',
            destination_number_id: 'dn-inactive',
            destination_number: {
              id: 'dn-inactive',
              workspace_id: mockWorkspaceId,
              buyer_id: 'buyer-1',
              destination_number: '+15551110001',
              status: 'INACTIVE', // Disabled!
              buyer: { id: 'buyer-1', status: 'ACTIVE' },
            },
          },
          {
            id: 'cdn-inactive-buyer',
            priority: 2,
            weight: 100,
            status: 'ACTIVE',
            destination_number_id: 'dn-buyer-inactive',
            destination_number: {
              id: 'dn-buyer-inactive',
              workspace_id: mockWorkspaceId,
              buyer_id: 'buyer-inactive',
              destination_number: '+15551110002',
              status: 'ACTIVE',
              buyer: { id: 'buyer-inactive', status: 'INACTIVE' }, // Disabled Buyer!
            },
          },
          {
            id: 'cdn-active-dn',
            priority: 3,
            weight: 100,
            status: 'ACTIVE',
            destination_number_id: 'dn-active',
            destination_number: {
              id: 'dn-active',
              workspace_id: mockWorkspaceId,
              buyer_id: 'buyer-3',
              destination_number: '+15551110003',
              status: 'ACTIVE',
              buyer: { id: 'buyer-3', status: 'ACTIVE' },
            },
          },
        ],
      };

      prismaMock.call.findUnique.mockResolvedValue(call);
      prismaMock.campaign.findUnique.mockResolvedValue(campaign);

      prismaMock.$queryRaw.mockImplementation((query: any, ...values: any[]) => {
        const { text, allValues } = extractQueryInfo(query, ...values);
        if (text.includes('destination_numbers')) {
          return Promise.resolve([{ id: allValues[0] || 'dn-active', max_concurrent_calls: 5 }]);
        }
        if (text.includes('call_attempts')) {
          return Promise.resolve([{ count: 0 }]);
        }
        if (text.includes('buyers')) {
          return Promise.resolve([{ id: allValues[0] || 'buyer-3', max_concurrent_calls: 5 }]);
        }
        if (text.includes('buyer_reservations')) {
          return Promise.resolve([{ count: 0 }]);
        }
        return Promise.resolve([]);
      });

      prismaMock.callAttempt.create.mockResolvedValue({
        id: 'attempt-3',
        destination_number_id: 'dn-active',
        buyer_id: 'buyer-3',
      });

      const decision = await callsService.prepareNextBuyer(mockCallId);

      // Skipped dn-inactive and buyer-inactive, dialed dn-active
      expect(decision.action).toBe('DIAL');
      expect(decision.destinationNumber.id).toBe('dn-active');
      expect(decision.buyer.id).toBe('buyer-3');
    });

    it('never redials an already attempted destination number on the same call', async () => {
      const call = {
        id: mockCallId,
        workspace_id: mockWorkspaceId,
        campaign_id: mockCampaignId,
        state: CallState.ROUTING,
        attempts: [
          {
            id: 'attempt-prior-1',
            destination_number_id: 'dn-1',
            destination_number: '+15551111111',
            state: CallAttemptState.NO_ANSWER,
          },
        ],
      };

      const campaign = {
        id: mockCampaignId,
        status: 'ACTIVE',
        destination_numbers: [
          {
            id: 'cdn-1',
            priority: 1,
            weight: 100,
            status: 'ACTIVE',
            destination_number_id: 'dn-1',
            destination_number: {
              id: 'dn-1',
              workspace_id: mockWorkspaceId,
              buyer_id: 'buyer-1',
              destination_number: '+15551111111',
              status: 'ACTIVE',
              buyer: { id: 'buyer-1', status: 'ACTIVE' },
            },
          },
          {
            id: 'cdn-2',
            priority: 2,
            weight: 100,
            status: 'ACTIVE',
            destination_number_id: 'dn-2',
            destination_number: {
              id: 'dn-2',
              workspace_id: mockWorkspaceId,
              buyer_id: 'buyer-2',
              destination_number: '+15552222222',
              status: 'ACTIVE',
              buyer: { id: 'buyer-2', status: 'ACTIVE' },
            },
          },
        ],
      };

      prismaMock.call.findUnique.mockResolvedValue(call);
      prismaMock.campaign.findUnique.mockResolvedValue(campaign);

      prismaMock.$queryRaw.mockImplementation((query: any, ...values: any[]) => {
        const { text, allValues } = extractQueryInfo(query, ...values);
        if (text.includes('destination_numbers')) {
          return Promise.resolve([{ id: allValues[0] || 'dn-2', max_concurrent_calls: 5 }]);
        }
        if (text.includes('call_attempts')) {
          return Promise.resolve([{ count: 0 }]);
        }
        if (text.includes('buyers')) {
          return Promise.resolve([{ id: allValues[0] || 'buyer-2', max_concurrent_calls: 5 }]);
        }
        if (text.includes('buyer_reservations')) {
          return Promise.resolve([{ count: 0 }]);
        }
        return Promise.resolve([]);
      });

      prismaMock.callAttempt.create.mockResolvedValue({
        id: 'attempt-2',
        destination_number_id: 'dn-2',
        buyer_id: 'buyer-2',
      });

      const decision = await callsService.prepareNextBuyer(mockCallId);

      // dn-1 was already attempted; automatically routed to dn-2
      expect(decision.action).toBe('DIAL');
      expect(decision.destinationNumber.id).toBe('dn-2');
    });
  });
});
