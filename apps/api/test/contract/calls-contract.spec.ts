import { vi, describe, it, expect, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CallsController } from '../../src/calls/calls.controller.js';
import { CallsService } from '../../src/calls/calls.service.js';
import { JwtAuthGuard } from '../../src/auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../../src/authorization/workspace-roles.guard.js';
import { PermissionsGuard } from '../../src/authorization/permissions.guard.js';
import { PermissionsService } from '../../src/permissions/permissions.service.js';
import { CallState, CallAttemptState, CommercialStatus } from '@prisma/client';

describe('Layer 5 Contract Regression: Calls API Request & Response Boundaries', () => {
  let controller: CallsController;
  let callsServiceMock: any;

  const mockWorkspaceId = 'ws-contract-001';
  const mockUserId = 'usr-contract-001';

  beforeEach(async () => {
    callsServiceMock = {
      getCalls: vi.fn(),
      getCallDetail: vi.fn(),
      getMetrics: vi.fn(),
      getLiveCalls: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CallsController],
      providers: [
        { provide: CallsService, useValue: callsServiceMock },
        {
          provide: PermissionsService,
          useValue: {
            getPermissionsForUser: vi.fn().mockResolvedValue([{ key: 'call:read', scope_type: 'ALL' }]),
            hasPermission: vi.fn().mockResolvedValue(true),
            hasResourceScope: vi.fn().mockResolvedValue(true),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(WorkspaceRolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<CallsController>(CallsController);
  });

  describe('GET /workspaces/:workspaceId/calls Request Boundary Validation', () => {
    it('accepts valid query parameters and returns contract-conforming paginated list', async () => {
      const mockCallItem = {
        id: 'call-101',
        workspace_id: mockWorkspaceId,
        campaign_id: 'camp-101',
        vendor_id: 'ven-101',
        attributed_vendor_id: 'ven-101',
        attribution_source: 'INGRESS_ASSIGNED',
        provider: 'telnyx',
        provider_call_id: 'v3:call-101',
        from_number: '+15551234567',
        to_number: '+15559876543',
        state: CallState.COMPLETED,
        duration_secs: 120,
        talkDurationSecs: 110,
        totalDurationSecs: 120,
        created_at: new Date('2026-02-01T12:00:00Z'),
        started_at: new Date('2026-02-01T12:00:00Z'),
        answered_at: new Date('2026-02-01T12:00:10Z'),
        ended_at: new Date('2026-02-01T12:02:00Z'),
        attempts: [
          {
            id: 'att-1',
            attempt_number: 1,
            buyer_id: 'buyer-1',
            destination_number_id: 'dn-1',
            destination_number: '+15551112222',
            state: CallAttemptState.COMPLETED,
            duration_secs: 110,
          },
        ],
        commercial: {
          id: 'comm-1',
          status: CommercialStatus.PENDING,
          qualified: true,
          converted: true,
          duplicate: false,
          revenue: 45.0,
          payout: 25.0,
          cost: 1.2,
          profit: 18.8,
          currency: 'USD',
        },
        recordings: [],
      };

      callsServiceMock.getCalls.mockResolvedValue({
        items: [mockCallItem],
        total: 1,
      });

      const response = await controller.getCalls(
        mockWorkspaceId,
        { user: { userId: mockUserId } },
        'camp-101',
        undefined,
        undefined,
        CallState.COMPLETED,
        '+15551234567',
        '2026-02-01',
        '2026-02-02',
        undefined,
        'talk',
        '30',
        '300',
        '25',
        '0',
      );

      // Contract Boundary Invariants
      expect(response).toHaveProperty('items');
      expect(response).toHaveProperty('total');
      expect(Array.isArray(response.items)).toBe(true);
      expect(typeof response.total).toBe('number');
      expect(response.total).toBe(1);

      const item = response.items[0];
      // Detect Breaking Field Removals & Renames
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('workspace_id');
      expect(item).toHaveProperty('state');
      expect(item).toHaveProperty('from_number');
      expect(item).toHaveProperty('to_number');
      expect(item).toHaveProperty('duration_secs');
      expect(item).toHaveProperty('talkDurationSecs');
      expect(item).toHaveProperty('attempts');
      expect(item).toHaveProperty('commercial');

      // Detect Type Changes
      expect(typeof item.id).toBe('string');
      expect(typeof item.workspace_id).toBe('string');
      expect(Object.values(CallState)).toContain(item.state);
      expect(typeof item.from_number).toBe('string');
      expect(typeof item.duration_secs).toBe('number');
      expect(typeof item.talkDurationSecs).toBe('number');
      expect(Array.isArray(item.attempts)).toBe(true);

      // Verify Attempt Contract
      const attempt = item.attempts[0];
      expect(attempt).toHaveProperty('id');
      expect(attempt).toHaveProperty('attempt_number');
      expect(attempt).toHaveProperty('state');
      expect(attempt).toHaveProperty('buyer_id');
      expect(attempt).toHaveProperty('destination_number');
      expect(Object.values(CallAttemptState)).toContain(attempt.state);

      // Verify Commercial Contract
      expect(item.commercial).toHaveProperty('id');
      expect(item.commercial).toHaveProperty('status');
      expect(item.commercial).toHaveProperty('revenue');
      expect(item.commercial).toHaveProperty('currency');
      expect(typeof item.commercial.qualified).toBe('boolean');
      expect(typeof item.commercial.converted).toBe('boolean');
      expect(typeof item.commercial.revenue).toBe('number');
    });

    it('rejects min/max duration filtering when durationType is missing (400 Bad Request)', async () => {
      await expect(
        controller.getCalls(
          mockWorkspaceId,
          { user: { userId: mockUserId } },
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined, // durationType missing!
          '30',      // minDurationSecs provided
          undefined,
          '10',
          '0',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects invalid durationType not in [talk, total] (400 Bad Request)', async () => {
      await expect(
        controller.getCalls(
          mockWorkspaceId,
          { user: { userId: mockUserId } },
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          'invalid_type' as any,
          '10',
          '50',
          '10',
          '0',
        ),
      ).rejects.toThrow(/invalid durationType/i);
    });

    it('rejects limit > 100 or limit < 1 (Safe Pagination Bound Contract)', async () => {
      await expect(
        controller.getCalls(
          mockWorkspaceId,
          { user: { userId: mockUserId } },
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          '150', // limit too high
          '0',
        ),
      ).rejects.toThrow(/limit must be an integer between 1 and 100/i);

      await expect(
        controller.getCalls(
          mockWorkspaceId,
          { user: { userId: mockUserId } },
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          '0', // limit too low
          '0',
        ),
      ).rejects.toThrow(/limit must be an integer between 1 and 100/i);
    });

    it('rejects negative offset (Safe Pagination Bound Contract)', async () => {
      await expect(
        controller.getCalls(
          mockWorkspaceId,
          { user: { userId: mockUserId } },
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          '20',
          '-5', // negative offset
        ),
      ).rejects.toThrow(/offset must be a non-negative integer/i);
    });

    it('rejects minDurationSecs > maxDurationSecs (400 Bad Request)', async () => {
      await expect(
        controller.getCalls(
          mockWorkspaceId,
          { user: { userId: mockUserId } },
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          'talk',
          '100', // min > max
          '50',
          '10',
          '0',
        ),
      ).rejects.toThrow(/minDurationSecs cannot be greater than maxDurationSecs/i);
    });
  });

  describe('GET /workspaces/:workspaceId/calls/:callId Response Boundary Validation', () => {
    it('returns full call detail conforming to strict response contract', async () => {
      const mockDetail = {
        id: 'call-detail-001',
        workspace_id: mockWorkspaceId,
        campaign_id: 'camp-001',
        state: CallState.COMPLETED,
        from_number: '+15550001111',
        to_number: '+15559992222',
        duration_secs: 180,
        talkDurationSecs: 165,
        totalDurationSecs: 180,
        created_at: new Date(),
        campaign: { name: 'Solar Campaign' },
        attempts: [
          {
            id: 'attempt-001',
            attempt_number: 1,
            buyer_id: 'buyer-001',
            destination_number: '+15558883333',
            state: CallAttemptState.COMPLETED,
            buyer: { name: 'Apex Solar', destination_number: '+15558883333' },
          },
        ],
        commercial: {
          id: 'comm-001',
          status: CommercialStatus.FINAL,
          qualified: true,
          converted: true,
          duplicate: false,
          revenue: 75.0,
          payout: 40.0,
          cost: 2.0,
          profit: 33.0,
          currency: 'USD',
          dispute: null,
        },
        recordings: [{ id: 'rec-1', status: 'COMPLETED' }],
      };

      callsServiceMock.getCallDetail.mockResolvedValue(mockDetail);

      const result = await controller.getCallDetail(mockWorkspaceId, 'call-detail-001', {
        user: { userId: mockUserId },
      });

      // Strict field existence & naming checks
      expect(result.id).toBe('call-detail-001');
      expect(result.workspace_id).toBe(mockWorkspaceId);
      expect(result.state).toBe(CallState.COMPLETED);
      expect(result.campaign.name).toBe('Solar Campaign');
      expect(result.attempts).toHaveLength(1);
      expect(result.commercial.status).toBe(CommercialStatus.FINAL);
      expect(result.commercial.profit).toBe(33.0);
      expect(Array.isArray(result.recordings)).toBe(true);
    });

    it('propagates NotFoundException (404) when call detail is not found', async () => {
      callsServiceMock.getCallDetail.mockRejectedValue(new NotFoundException('Call not found'));

      await expect(
        controller.getCallDetail(mockWorkspaceId, 'non-existent-call', {
          user: { userId: mockUserId },
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('GET /workspaces/:workspaceId/calls/live-calls Response Contract', () => {
    it('returns exact { liveCalls: number } response schema', async () => {
      callsServiceMock.getLiveCalls.mockResolvedValue({ liveCalls: 4 });

      const response = await controller.getLiveCalls(mockWorkspaceId, {
        user: { userId: mockUserId },
      });

      expect(response).toBeDefined();
      expect(response).toHaveProperty('liveCalls');
      expect(typeof response.liveCalls).toBe('number');
      expect(response.liveCalls).toBe(4);
      // Ensure no unexpected fields leaked
      expect(Object.keys(response)).toEqual(['liveCalls']);
    });
  });
});
