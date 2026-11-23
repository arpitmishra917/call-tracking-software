import { vi, describe, it, expect, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CommercialDisputesController } from '../../src/commercial/commercial-disputes.controller.js';
import { CommercialDisputesService } from '../../src/commercial/commercial-disputes.service.js';
import { JwtAuthGuard } from '../../src/auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../../src/authorization/workspace-roles.guard.js';
import { PermissionsGuard } from '../../src/authorization/permissions.guard.js';
import { DisputeStatus } from '@prisma/client';

describe('Layer 5 Contract Regression: Commercial Disputes API Boundaries', () => {
  let controller: CommercialDisputesController;
  let disputesServiceMock: any;

  const mockWorkspaceId = 'ws-contract-comm-1';
  const mockUserId = 'usr-contract-comm-1';
  const mockCallCommercialId = 'ccom-contract-101';
  const mockDisputeId = 'disp-contract-201';

  beforeEach(async () => {
    disputesServiceMock = {
      createDispute: vi.fn(),
      resolveDispute: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CommercialDisputesController],
      providers: [
        { provide: CommercialDisputesService, useValue: disputesServiceMock },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(WorkspaceRolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<CommercialDisputesController>(CommercialDisputesController);
  });

  describe('POST /workspaces/:workspaceId/call-commercials/:callCommercialId/dispute Contract', () => {
    it('creates dispute conforming to strict response schema', async () => {
      const mockCreatedDispute = {
        id: mockDisputeId,
        workspace_id: mockWorkspaceId,
        call_commercial_id: mockCallCommercialId,
        buyer_id: 'buyer-contract-1',
        reason: 'Call dropped within 5 seconds',
        description: 'Caller hung up immediately due to poor line quality',
        status: DisputeStatus.PENDING,
        created_by_user_id: mockUserId,
        created_at: new Date('2026-02-01T15:00:00Z'),
        updated_at: new Date('2026-02-01T15:00:00Z'),
        resolved_at: null,
        resolved_by_user_id: null,
        resolution_notes: null,
      };

      disputesServiceMock.createDispute.mockResolvedValue(mockCreatedDispute);

      const response = await controller.createDispute(
        mockWorkspaceId,
        mockCallCommercialId,
        { user: { userId: mockUserId } },
        {
          reason: 'Call dropped within 5 seconds',
          description: 'Caller hung up immediately due to poor line quality',
        } as any,
      );

      // Verify Contract Schema & Field Stability
      expect(response).toHaveProperty('id');
      expect(response).toHaveProperty('workspace_id');
      expect(response).toHaveProperty('call_commercial_id');
      expect(response).toHaveProperty('buyer_id');
      expect(response).toHaveProperty('reason');
      expect(response).toHaveProperty('status');
      expect(response).toHaveProperty('created_at');

      // Verify Strict Field Types
      expect(typeof response.id).toBe('string');
      expect(typeof response.workspace_id).toBe('string');
      expect(typeof response.call_commercial_id).toBe('string');
      expect(response.status).toBe(DisputeStatus.PENDING);
      expect(response.reason).toBe('Call dropped within 5 seconds');
    });

    it('rejects dispute creation when reason is missing or empty (400 Bad Request)', async () => {
      await expect(
        controller.createDispute(
          mockWorkspaceId,
          mockCallCommercialId,
          { user: { userId: mockUserId } },
          { reason: '' } as any, // empty reason
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        controller.createDispute(
          mockWorkspaceId,
          mockCallCommercialId,
          { user: { userId: mockUserId } },
          {} as any, // missing reason
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('POST /workspaces/:workspaceId/disputes/:disputeId/resolve Contract', () => {
    it('resolves dispute with ACCEPTED status and returns conforming response contract', async () => {
      const mockResolvedDispute = {
        id: mockDisputeId,
        workspace_id: mockWorkspaceId,
        call_commercial_id: mockCallCommercialId,
        status: DisputeStatus.ACCEPTED,
        resolution_notes: 'Verified bad audio quality, dispute accepted',
        resolved_at: new Date('2026-02-01T16:00:00Z'),
        resolved_by_user_id: mockUserId,
      };

      disputesServiceMock.resolveDispute.mockResolvedValue(mockResolvedDispute);

      const response = await controller.resolveDispute(
        mockWorkspaceId,
        mockDisputeId,
        { user: { userId: mockUserId } },
        {
          status: DisputeStatus.ACCEPTED,
          resolution_notes: 'Verified bad audio quality, dispute accepted',
        } as any,
      );

      expect(response).toHaveProperty('id');
      expect(response).toHaveProperty('status');
      expect(response).toHaveProperty('resolved_at');
      expect(response).toHaveProperty('resolved_by_user_id');
      expect(response.status).toBe(DisputeStatus.ACCEPTED);
      expect(response.resolution_notes).toBe('Verified bad audio quality, dispute accepted');
    });

    it('rejects invalid dispute resolution status (400 Bad Request)', async () => {
      await expect(
        controller.resolveDispute(
          mockWorkspaceId,
          mockDisputeId,
          { user: { userId: mockUserId } },
          { status: 'INVALID_STATUS' as any },
        ),
      ).rejects.toThrow(/Status must be ACCEPTED or REJECTED/i);
    });

    it('acceptDispute shortcut resolves dispute with ACCEPTED status', async () => {
      disputesServiceMock.resolveDispute.mockResolvedValue({
        id: mockDisputeId,
        status: DisputeStatus.ACCEPTED,
      });

      const response = await controller.acceptDispute(
        mockWorkspaceId,
        mockDisputeId,
        { user: { userId: mockUserId } },
        { resolution_notes: 'Approved' } as any,
      );

      expect(response.status).toBe(DisputeStatus.ACCEPTED);
      expect(disputesServiceMock.resolveDispute).toHaveBeenCalledWith(
        expect.objectContaining({
          status: DisputeStatus.ACCEPTED,
          resolutionNotes: 'Approved',
        }),
      );
    });
  });
});
