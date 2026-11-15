import { vi, describe, it, expect, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { CampaignsService } from './campaigns.service.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CallsService } from '../calls/calls.service.js';
import { UsageService } from '../usage/usage.service.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { CallState, CallAttemptState } from '@prisma/client';

describe('Step 3 — Campaign Routing to Destination Numbers', () => {
  let campaignsService: CampaignsService;
  let callsService: CallsService;
  let prismaMock: any;

  const mockWorkspaceId = 'ws-test-123';
  const mockCampaignId = 'camp-test-456';
  const mockBuyerId = 'buyer-test-789';
  const mockDnId1 = 'dn-test-001';
  const mockDnId2 = 'dn-test-002';
  const mockCallId = 'call-test-999';

  beforeEach(async () => {
    prismaMock = {
      campaign: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
      },
      destinationNumber: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      campaignDestinationNumber: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      campaignBuyer: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
        update: vi.fn(),
      },
      call: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      callAttempt: {
        create: vi.fn(),
        findMany: vi.fn(),
      },
      buyerReservation: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue({ id: 'res-1' }),
      },
      workspaceMember: {
        findUnique: vi.fn(),
      },
      phoneNumber: {
        findUnique: vi.fn(),
      },
      $queryRaw: vi.fn().mockResolvedValue([{ active_count: 0 }]),
      $transaction: vi.fn(async (cb) => {
        if (typeof cb === 'function') {
          return cb(prismaMock);
        }
        return cb;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CampaignsService,
        CallsService,
        {
          provide: PermissionsService,
          useValue: {
            getPermissionsForUser: vi.fn().mockResolvedValue([{ key: 'campaign:read', scope_type: 'ALL' }]),
            hasPermission: vi.fn().mockResolvedValue(true),
            hasResourceScope: vi.fn().mockResolvedValue(true),
          },
        },
        {
          provide: UsageService,
          useValue: {
            trackUsage: vi.fn().mockResolvedValue({}),
          },
        },
        {
          provide: WebhooksService,
          useValue: {
            queueEvent: vi.fn().mockResolvedValue({}),
          },
        },
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    campaignsService = module.get<CampaignsService>(CampaignsService);
    callsService = module.get<CallsService>(CallsService);
  });

  describe('CampaignsService Destination Management (B3)', () => {
    it('1. should add a destination number to a campaign', async () => {
      prismaMock.campaign.findUnique.mockResolvedValue({ id: mockCampaignId, workspace_id: mockWorkspaceId });
      prismaMock.destinationNumber.findUnique.mockResolvedValue({
        id: mockDnId1,
        workspace_id: mockWorkspaceId,
        destination_number: '+15551112222',
      });
      prismaMock.campaignDestinationNumber.findUnique.mockResolvedValue(null);
      prismaMock.campaignDestinationNumber.findFirst.mockResolvedValue(null);
      prismaMock.campaignDestinationNumber.create.mockResolvedValue({
        id: 'cdn-1',
        campaign_id: mockCampaignId,
        destination_number_id: mockDnId1,
        priority: 1,
        weight: 100,
        status: 'ACTIVE',
      });

      const result = await campaignsService.addDestinationToCampaign(
        mockWorkspaceId,
        mockCampaignId,
        mockDnId1,
        1,
        100,
      );

      expect(prismaMock.campaignDestinationNumber.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            campaign_id: mockCampaignId,
            destination_number_id: mockDnId1,
            priority: 1,
            weight: 100,
          }),
        }),
      );
      expect(result.id).toBe('cdn-1');
    });

    it('2. should reject adding duplicate destination number to same campaign', async () => {
      prismaMock.campaign.findUnique.mockResolvedValue({ id: mockCampaignId, workspace_id: mockWorkspaceId });
      prismaMock.destinationNumber.findUnique.mockResolvedValue({ id: mockDnId1, workspace_id: mockWorkspaceId });
      prismaMock.campaignDestinationNumber.findUnique.mockResolvedValue({ id: 'existing-cdn' });

      await expect(
        campaignsService.addDestinationToCampaign(mockWorkspaceId, mockCampaignId, mockDnId1),
      ).rejects.toThrow(/already assigned/i);
    });

    it('3. should reject adding destination number from another workspace (Tenant Isolation)', async () => {
      prismaMock.campaign.findUnique.mockResolvedValue({ id: mockCampaignId, workspace_id: mockWorkspaceId });
      prismaMock.destinationNumber.findUnique.mockResolvedValue(null);

      await expect(
        campaignsService.addDestinationToCampaign(mockWorkspaceId, mockCampaignId, 'dn-other-ws'),
      ).rejects.toThrow(/not found in workspace/i);
    });

    it('4. should remove destination number from campaign', async () => {
      prismaMock.campaign.findUnique.mockResolvedValue({ id: mockCampaignId, workspace_id: mockWorkspaceId });
      prismaMock.campaignDestinationNumber.findFirst.mockResolvedValue({ id: 'cdn-1' });
      prismaMock.campaignDestinationNumber.delete.mockResolvedValue({ id: 'cdn-1' });

      const result = await campaignsService.removeDestinationFromCampaign(
        mockWorkspaceId,
        mockCampaignId,
        mockDnId1,
      );

      expect(prismaMock.campaignDestinationNumber.delete).toHaveBeenCalledWith({ where: { id: 'cdn-1' } });
      expect(result.id).toBe('cdn-1');
    });

    it('5. should reorder destinations in campaign', async () => {
      prismaMock.campaign.findUnique.mockResolvedValue({ id: mockCampaignId, workspace_id: mockWorkspaceId });
      prismaMock.campaignDestinationNumber.findMany.mockResolvedValue([
        { id: 'cdn-1', destination_number_id: mockDnId1, priority: 1 },
        { id: 'cdn-2', destination_number_id: mockDnId2, priority: 2 },
      ]);
      prismaMock.campaignDestinationNumber.update
        .mockResolvedValueOnce({ id: 'cdn-2', priority: 1 })
        .mockResolvedValueOnce({ id: 'cdn-1', priority: 2 });

      const result = await campaignsService.reorderDestinationsInCampaign(
        mockWorkspaceId,
        mockCampaignId,
        [mockDnId2, mockDnId1],
      );

      expect(prismaMock.campaignDestinationNumber.update).toHaveBeenCalledTimes(2);
      expect(prismaMock.campaignDestinationNumber.update).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ where: { id: 'cdn-2' }, data: { priority: 1 } }),
      );
    });
  });

  describe('Campaign Call Routing Engine (B1, B2, B5)', () => {
    it('Scenario 1: Campaign with one DestinationNumber routes and snapshots attempt', async () => {
      prismaMock.call.findUnique.mockResolvedValue({
        id: mockCallId,
        workspace_id: mockWorkspaceId,
        campaign_id: mockCampaignId,
        state: CallState.ROUTING,
        attempts: [],
      });

      prismaMock.campaign.findUnique.mockResolvedValue({
        id: mockCampaignId,
        status: 'ACTIVE',
        destination_numbers: [
          {
            id: 'cdn-1',
            priority: 1,
            weight: 100,
            status: 'ACTIVE',
            destination_number_id: mockDnId1,
            destination_number: {
              id: mockDnId1,
              workspace_id: mockWorkspaceId,
              buyer_id: mockBuyerId,
              destination_number: '+15551234567',
              timeout: 25,
              max_concurrent_calls: 5,
              status: 'ACTIVE',
              buyer: { id: mockBuyerId, name: 'Alpha Buyer', status: 'ACTIVE', max_concurrent_calls: 10 },
            },
          },
        ],
        buyers: [],
      });

      prismaMock.callAttempt.create.mockResolvedValue({
        id: 'attempt-1',
        attempt_number: 1,
        buyer_id: mockBuyerId,
        destination_number_id: mockDnId1,
        destination_number: '+15551234567',
        state: CallAttemptState.INITIATED,
      });

      const result = await callsService.prepareNextBuyer(mockCallId);

      expect(result.action).toBe('DIAL');
      expect(result.destinationNumber?.id).toBe(mockDnId1);
      expect(result.destinationNumber?.destination_number).toBe('+15551234567');
      expect(result.destinationNumber?.timeout).toBe(25);
      expect(result.buyer.id).toBe(mockBuyerId);
      expect(prismaMock.callAttempt.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            destination_number_id: mockDnId1,
            destination_number: '+15551234567',
            buyer_id: mockBuyerId,
          }),
        }),
      );
    });

    it('Scenario 2 & 3: Priority waterfall (priority ASC, weight DESC)', async () => {
      prismaMock.call.findUnique.mockResolvedValue({
        id: mockCallId,
        workspace_id: mockWorkspaceId,
        campaign_id: mockCampaignId,
        state: CallState.ROUTING,
        attempts: [],
      });

      prismaMock.campaign.findUnique.mockResolvedValue({
        id: mockCampaignId,
        status: 'ACTIVE',
        destination_numbers: [
          {
            id: 'cdn-1',
            priority: 1,
            weight: 50,
            status: 'ACTIVE',
            destination_number_id: mockDnId1,
            destination_number: {
              id: mockDnId1,
              workspace_id: mockWorkspaceId,
              buyer_id: 'buyer-1',
              destination_number: '+15551111111',
              timeout: 30,
              max_concurrent_calls: 2,
              status: 'ACTIVE',
              buyer: { id: 'buyer-1', status: 'ACTIVE' },
            },
          },
          {
            id: 'cdn-2',
            priority: 2,
            weight: 100,
            status: 'ACTIVE',
            destination_number_id: mockDnId2,
            destination_number: {
              id: mockDnId2,
              workspace_id: mockWorkspaceId,
              buyer_id: 'buyer-2',
              destination_number: '+15552222222',
              timeout: 30,
              max_concurrent_calls: 2,
              status: 'ACTIVE',
              buyer: { id: 'buyer-2', status: 'ACTIVE' },
            },
          },
        ],
        buyers: [],
      });

      prismaMock.callAttempt.create.mockResolvedValue({
        id: 'attempt-1',
        attempt_number: 1,
        destination_number_id: mockDnId1,
        destination_number: '+15551111111',
      });

      const result = await callsService.prepareNextBuyer(mockCallId);
      expect(result.action).toBe('DIAL');
      expect(result.destinationNumber?.id).toBe(mockDnId1);
    });

    it('Scenario 4: Disabled destination (status INACTIVE is skipped)', async () => {
      prismaMock.call.findUnique.mockResolvedValue({
        id: mockCallId,
        workspace_id: mockWorkspaceId,
        campaign_id: mockCampaignId,
        state: CallState.ROUTING,
        attempts: [],
      });

      prismaMock.campaign.findUnique.mockResolvedValue({
        id: mockCampaignId,
        status: 'ACTIVE',
        destination_numbers: [
          {
            id: 'cdn-1',
            priority: 1,
            weight: 100,
            status: 'ACTIVE',
            destination_number_id: mockDnId1,
            destination_number: {
              id: mockDnId1,
              workspace_id: mockWorkspaceId,
              buyer_id: 'buyer-1',
              destination_number: '+15551111111',
              status: 'INACTIVE', // Disabled destination
              buyer: { id: 'buyer-1', status: 'ACTIVE' },
            },
          },
          {
            id: 'cdn-2',
            priority: 2,
            weight: 100,
            status: 'ACTIVE',
            destination_number_id: mockDnId2,
            destination_number: {
              id: mockDnId2,
              workspace_id: mockWorkspaceId,
              buyer_id: 'buyer-2',
              destination_number: '+15552222222',
              status: 'ACTIVE',
              buyer: { id: 'buyer-2', status: 'ACTIVE' },
            },
          },
        ],
        buyers: [],
      });

      prismaMock.callAttempt.create.mockResolvedValue({
        id: 'attempt-1',
        destination_number_id: mockDnId2,
      });

      const result = await callsService.prepareNextBuyer(mockCallId);
      // DN1 is inactive, should skip to DN2
      expect(result.action).toBe('DIAL');
      expect(result.destinationNumber?.id).toBe(mockDnId2);
    });

    it('Scenario 5: Destination belonging to another workspace (Cross-workspace isolation)', async () => {
      prismaMock.call.findUnique.mockResolvedValue({
        id: mockCallId,
        workspace_id: mockWorkspaceId,
        campaign_id: mockCampaignId,
        state: CallState.ROUTING,
        attempts: [],
      });

      prismaMock.campaign.findUnique.mockResolvedValue({
        id: mockCampaignId,
        status: 'ACTIVE',
        destination_numbers: [
          {
            id: 'cdn-cross',
            priority: 1,
            weight: 100,
            status: 'ACTIVE',
            destination_number_id: 'dn-foreign',
            destination_number: {
              id: 'dn-foreign',
              workspace_id: 'ws-attacker-workspace', // Mismatched workspace!
              buyer_id: 'buyer-foreign',
              destination_number: '+15559999999',
              status: 'ACTIVE',
              buyer: { id: 'buyer-foreign', status: 'ACTIVE' },
            },
          },
        ],
        buyers: [],
      });

      prismaMock.call.update.mockResolvedValue({ id: mockCallId, state: CallState.FAILED });

      const result = await callsService.prepareNextBuyer(mockCallId);
      // Cross-workspace destination must be rejected, resulting in exhaustion
      expect(result.action).toBe('HANGUP');
    });

    it('Scenario 6: Single Buyer with multiple destination numbers routed correctly', async () => {
      prismaMock.call.findUnique.mockResolvedValue({
        id: mockCallId,
        workspace_id: mockWorkspaceId,
        campaign_id: mockCampaignId,
        state: CallState.ROUTING,
        attempts: [
          {
            id: 'attempt-1',
            attempt_number: 1,
            buyer_id: mockBuyerId,
            destination_number_id: mockDnId1,
            state: CallAttemptState.FAILED,
          },
        ],
      });

      prismaMock.campaign.findUnique.mockResolvedValue({
        id: mockCampaignId,
        status: 'ACTIVE',
        destination_numbers: [
          {
            id: 'cdn-1',
            priority: 1,
            weight: 100,
            status: 'ACTIVE',
            destination_number_id: mockDnId1,
            destination_number: {
              id: mockDnId1,
              workspace_id: mockWorkspaceId,
              buyer_id: mockBuyerId, // Same buyer
              destination_number: '+15551111111',
              status: 'ACTIVE',
              buyer: { id: mockBuyerId, status: 'ACTIVE' },
            },
          },
          {
            id: 'cdn-2',
            priority: 2,
            weight: 100,
            status: 'ACTIVE',
            destination_number_id: mockDnId2,
            destination_number: {
              id: mockDnId2,
              workspace_id: mockWorkspaceId,
              buyer_id: mockBuyerId, // Same buyer, secondary endpoint
              destination_number: '+15552222222',
              status: 'ACTIVE',
              buyer: { id: mockBuyerId, status: 'ACTIVE' },
            },
          },
        ],
        buyers: [],
      });

      prismaMock.callAttempt.create.mockResolvedValue({
        id: 'attempt-2',
        attempt_number: 2,
        destination_number_id: mockDnId2,
      });

      const result = await callsService.prepareNextBuyer(mockCallId);
      // DN1 already attempted, advances to DN2 under the SAME buyer org
      expect(result.action).toBe('DIAL');
      expect(result.destinationNumber?.id).toBe(mockDnId2);
      expect(result.buyer.id).toBe(mockBuyerId);
    });

    it('Scenario 7 & 8: Fallback to legacy CampaignBuyer waterfall when 0 destination numbers exist', async () => {
      prismaMock.call.findUnique.mockResolvedValue({
        id: mockCallId,
        workspace_id: mockWorkspaceId,
        campaign_id: mockCampaignId,
        state: CallState.ROUTING,
        attempts: [],
      });

      prismaMock.campaign.findUnique.mockResolvedValue({
        id: mockCampaignId,
        status: 'ACTIVE',
        destination_numbers: [], // No new destinations
        buyers: [
          {
            id: 'cb-legacy',
            priority: 1,
            buyer_id: 'legacy-buyer-1',
            buyer: {
              id: 'legacy-buyer-1',
              workspace_id: mockWorkspaceId,
              name: 'Legacy Buyer Org',
              destination_number: '+15550009999',
              timeout: 35,
              max_concurrent_calls: 3,
              status: 'ACTIVE',
            },
          },
        ],
      });

      prismaMock.callAttempt.create.mockResolvedValue({
        id: 'attempt-legacy-1',
        attempt_number: 1,
        buyer_id: 'legacy-buyer-1',
        destination_number: '+15550009999',
      });

      const result = await callsService.prepareNextBuyer(mockCallId);
      expect(result.action).toBe('DIAL');
      expect(result.buyer.id).toBe('legacy-buyer-1');
      expect(result.buyer.destination_number).toBe('+15550009999');
      // Verifies snapshotting even in fallback mode
      expect(prismaMock.callAttempt.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            buyer_id: 'legacy-buyer-1',
            destination_number: '+15550009999',
          }),
        }),
      );
    });

    it('Scenario 9: Destination snapshot persistence immutable in attempt record', async () => {
      prismaMock.call.findUnique.mockResolvedValue({
        id: mockCallId,
        workspace_id: mockWorkspaceId,
        campaign_id: mockCampaignId,
        state: CallState.ROUTING,
        attempts: [],
      });

      prismaMock.campaign.findUnique.mockResolvedValue({
        id: mockCampaignId,
        status: 'ACTIVE',
        destination_numbers: [
          {
            id: 'cdn-1',
            priority: 1,
            weight: 100,
            status: 'ACTIVE',
            destination_number_id: mockDnId1,
            destination_number: {
              id: mockDnId1,
              workspace_id: mockWorkspaceId,
              buyer_id: mockBuyerId,
              destination_number: '+15553334444',
              status: 'ACTIVE',
              buyer: { id: mockBuyerId, status: 'ACTIVE' },
            },
          },
        ],
        buyers: [],
      });

      prismaMock.callAttempt.create.mockImplementation(({ data }) => Promise.resolve({ id: 'att-snap', ...data }));

      const result = await callsService.prepareNextBuyer(mockCallId);
      expect(result.action).toBe('DIAL');
      expect(result.attempt.destination_number_id).toBe(mockDnId1);
      expect(result.attempt.destination_number).toBe('+15553334444');
    });

    it('Scenario 10: Concurrent call limits per destination number skips busy endpoints', async () => {
      prismaMock.call.findUnique.mockResolvedValue({
        id: mockCallId,
        workspace_id: mockWorkspaceId,
        campaign_id: mockCampaignId,
        state: CallState.ROUTING,
        attempts: [],
      });

      prismaMock.campaign.findUnique.mockResolvedValue({
        id: mockCampaignId,
        status: 'ACTIVE',
        destination_numbers: [
          {
            id: 'cdn-1',
            priority: 1,
            weight: 100,
            status: 'ACTIVE',
            destination_number_id: mockDnId1,
            destination_number: {
              id: mockDnId1,
              workspace_id: mockWorkspaceId,
              buyer_id: 'buyer-1',
              destination_number: '+15551111111',
              max_concurrent_calls: 1, // Max 1 concurrent call
              status: 'ACTIVE',
              buyer: { id: 'buyer-1', status: 'ACTIVE', max_concurrent_calls: 10 },
            },
          },
          {
            id: 'cdn-2',
            priority: 2,
            weight: 100,
            status: 'ACTIVE',
            destination_number_id: mockDnId2,
            destination_number: {
              id: mockDnId2,
              workspace_id: mockWorkspaceId,
              buyer_id: 'buyer-2',
              destination_number: '+15552222222',
              max_concurrent_calls: 5,
              status: 'ACTIVE',
              buyer: { id: 'buyer-2', status: 'ACTIVE', max_concurrent_calls: 10 },
            },
          },
        ],
        buyers: [],
      });

      // DN1 is at capacity (count: 1 >= maxLimit: 1), DN2 has capacity (count: 0 < maxLimit: 5)
      prismaMock.$queryRaw.mockImplementation((strings: any, ...values: any[]) => {
        const sql = strings?.join ? strings.join('?') : String(strings);
        if (sql.includes('call_attempts')) {
          const dnId = values[0];
          return Promise.resolve([{ count: dnId === mockDnId1 ? 1 : 0 }]);
        }
        if (sql.includes('destination_numbers')) {
          const dnId = values[0];
          return Promise.resolve([{ id: dnId, max_concurrent_calls: dnId === mockDnId1 ? 1 : 5 }]);
        }
        return Promise.resolve([{ count: 0, max_concurrent_calls: 10 }]);
      });

      prismaMock.callAttempt.create.mockResolvedValue({
        id: 'attempt-2',
        destination_number_id: mockDnId2,
      });

      const result = await callsService.prepareNextBuyer(mockCallId);
      // Should skip DN1 because it reached max_concurrent_calls, and select DN2
      expect(result.action).toBe('DIAL');
      expect(result.destinationNumber?.id).toBe(mockDnId2);
    });

    it('Scenario 11: Timeout behavior inherits destination_number.timeout', async () => {
      prismaMock.call.findUnique.mockResolvedValue({
        id: mockCallId,
        workspace_id: mockWorkspaceId,
        campaign_id: mockCampaignId,
        state: CallState.ROUTING,
        attempts: [],
      });

      prismaMock.campaign.findUnique.mockResolvedValue({
        id: mockCampaignId,
        status: 'ACTIVE',
        destination_numbers: [
          {
            id: 'cdn-1',
            priority: 1,
            weight: 100,
            status: 'ACTIVE',
            destination_number_id: mockDnId1,
            destination_number: {
              id: mockDnId1,
              workspace_id: mockWorkspaceId,
              buyer_id: mockBuyerId,
              destination_number: '+15559998888',
              timeout: 45, // Custom timeout 45s
              status: 'ACTIVE',
              buyer: { id: mockBuyerId, status: 'ACTIVE', timeout: 30 },
            },
          },
        ],
        buyers: [],
      });

      prismaMock.callAttempt.create.mockResolvedValue({ id: 'att-1' });

      const result = await callsService.prepareNextBuyer(mockCallId);
      expect(result.action).toBe('DIAL');
      expect(result.destinationNumber?.timeout).toBe(45);
    });

    it('Scenario 12: Failed destination causes waterfall to advance on next call', async () => {
      prismaMock.call.findUnique.mockResolvedValue({
        id: mockCallId,
        workspace_id: mockWorkspaceId,
        campaign_id: mockCampaignId,
        state: CallState.ROUTING,
        attempts: [
          {
            id: 'attempt-1',
            attempt_number: 1,
            destination_number_id: mockDnId1,
            state: CallAttemptState.FAILED,
          },
        ],
      });

      prismaMock.campaign.findUnique.mockResolvedValue({
        id: mockCampaignId,
        status: 'ACTIVE',
        destination_numbers: [
          {
            id: 'cdn-1',
            priority: 1,
            weight: 100,
            status: 'ACTIVE',
            destination_number_id: mockDnId1,
            destination_number: {
              id: mockDnId1,
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
            destination_number_id: mockDnId2,
            destination_number: {
              id: mockDnId2,
              workspace_id: mockWorkspaceId,
              buyer_id: 'buyer-2',
              destination_number: '+15552222222',
              status: 'ACTIVE',
              buyer: { id: 'buyer-2', status: 'ACTIVE' },
            },
          },
        ],
        buyers: [],
      });

      prismaMock.callAttempt.create.mockResolvedValue({
        id: 'attempt-2',
        attempt_number: 2,
        destination_number_id: mockDnId2,
      });

      const result = await callsService.prepareNextBuyer(mockCallId);
      expect(result.action).toBe('DIAL');
      expect(result.destinationNumber?.id).toBe(mockDnId2);
      expect(prismaMock.callAttempt.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            destination_number_id: mockDnId2,
          }),
        }),
      );
    });

    it('Scenario 13 & 14: Existing CampaignBuyer data & COMM settlement compatibility', async () => {
      prismaMock.campaign.findUnique.mockResolvedValue({
        id: mockCampaignId,
        buyers: [{ id: 'cb-1', buyer_id: 'b-1', priority: 1 }],
        destination_numbers: [{ id: 'cdn-1', destination_number_id: 'dn-1', priority: 1 }],
      });

      const campaign = await campaignsService.getCampaign(mockWorkspaceId, mockCampaignId);
      expect(campaign.buyers).toBeDefined();
      expect(campaign.destination_numbers).toBeDefined();
      expect(campaign.buyers.length).toBe(1);
      expect(campaign.destination_numbers.length).toBe(1);
    });
  });
});
