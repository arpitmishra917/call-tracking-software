import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { CommercialDisputesService } from './commercial-disputes.service.js';
import { CommercialDisputesController } from './commercial-disputes.controller.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import {
  DisputeStatus,
  CommercialStatus,
  WorkspaceRole,
  Prisma,
} from '@prisma/client';
import {
  ForbiddenException,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';

describe('CommercialDisputes (COMM-5)', () => {
  let service: CommercialDisputesService;
  let controller: CommercialDisputesController;
  let prisma: any;
  let auditLogsService: any;

  const mockDate = new Date('2026-10-07T14:00:00.000Z');

  const getBaseBuyerMember = () => ({
    id: 'member-buyer-1',
    workspace_id: 'ws-1',
    user_id: 'user-buyer-1',
    role: WorkspaceRole.MEMBER,
    participant_type: 'BUYER',
    buyer_id: 'buyer-1',
    vendor_id: null,
  });

  const getBaseAdminMember = () => ({
    id: 'member-admin-1',
    workspace_id: 'ws-1',
    user_id: 'user-admin-1',
    role: WorkspaceRole.ADMIN,
    participant_type: 'INTERNAL',
    buyer_id: null,
    vendor_id: null,
  });

  const getBaseCommercial = () => ({
    id: 'comm-1',
    workspace_id: 'ws-1',
    call_id: 'call-1',
    campaign_id: 'camp-1',
    vendor_id: 'vendor-1',
    buyer_id: 'buyer-1',
    qualified: true,
    converted: true,
    duplicate: false,
    duplicate_of_call_id: null,
    currency: 'USD',
    revenue: new Prisma.Decimal('50.0000'),
    payout: new Prisma.Decimal('30.0000'),
    cost: new Prisma.Decimal('5.0000'),
    profit: new Prisma.Decimal('15.0000'),
    status: CommercialStatus.PENDING,
    finalizes_at: null,
    created_at: new Date(mockDate),
    updated_at: new Date(mockDate),
  });

  const getBaseDispute = () => ({
    id: 'dispute-1',
    workspace_id: 'ws-1',
    call_commercial_id: 'comm-1',
    buyer_id: 'buyer-1',
    reason: 'Wrong caller area code',
    description: 'Caller was out of service territory',
    status: DisputeStatus.PENDING,
    created_by_user_id: 'user-buyer-1',
    resolved_by_user_id: null,
    resolution_notes: null,
    resolved_at: null,
    created_at: new Date(mockDate),
    updated_at: new Date(mockDate),
    commercial: getBaseCommercial(),
  });

  beforeEach(async () => {
    prisma = {
      $transaction: vi.fn(async (cb) => cb(prisma)),
      workspaceMember: {
        findUnique: vi.fn().mockImplementation((args) => {
          const { workspace_id, user_id } = args.where.workspace_id_user_id;
          if (user_id === 'user-buyer-1') return Promise.resolve(getBaseBuyerMember());
          if (user_id === 'user-buyer-2')
            return Promise.resolve({
              ...getBaseBuyerMember(),
              id: 'member-buyer-2',
              user_id: 'user-buyer-2',
              buyer_id: 'buyer-2',
            });
          if (user_id === 'user-vendor-1')
            return Promise.resolve({
              ...getBaseBuyerMember(),
              id: 'member-vendor-1',
              user_id: 'user-vendor-1',
              participant_type: 'VENDOR',
              vendor_id: 'vendor-1',
              buyer_id: null,
            });
          if (user_id === 'user-admin-1') return Promise.resolve(getBaseAdminMember());
          if (user_id === 'user-regular-1')
            return Promise.resolve({
              ...getBaseAdminMember(),
              id: 'member-regular-1',
              user_id: 'user-regular-1',
              role: WorkspaceRole.MEMBER,
            });
          return Promise.resolve(null);
        }),
      },
      callCommercial: {
        findUnique: vi.fn().mockImplementation(() => Promise.resolve(getBaseCommercial())),
        update: vi.fn().mockImplementation((args) => Promise.resolve({ ...getBaseCommercial(), ...args.data })),
      },
      callDispute: {
        findUnique: vi.fn().mockImplementation(() => Promise.resolve(null)),
        create: vi.fn().mockImplementation((args) => Promise.resolve({ id: 'dispute-1', ...args.data })),
        update: vi.fn().mockImplementation((args) => Promise.resolve({ ...getBaseDispute(), ...args.data })),
      },
      callFinancialAdjustment: {
        findUnique: vi.fn().mockImplementation(() => Promise.resolve(null)),
        create: vi.fn().mockImplementation((args) => Promise.resolve({ id: 'adj-1', ...args.data })),
      },
      call: {
        update: vi.fn(),
      },
      walletTransaction: {
        update: vi.fn(),
      },
    };

    auditLogsService = {
      logAction: vi.fn().mockResolvedValue({ id: 'audit-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CommercialDisputesController],
      providers: [
        CommercialDisputesService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogsService, useValue: auditLogsService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(WorkspaceRolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    service = module.get<CommercialDisputesService>(CommercialDisputesService);
    controller = module.get<CommercialDisputesController>(CommercialDisputesController);
  });

  // 1. Buyer can create dispute for own commercial call
  it('1. Buyer can create dispute for own commercial call', async () => {
    const dispute = await service.createDispute({
      workspaceId: 'ws-1',
      callCommercialId: 'comm-1',
      userId: 'user-buyer-1',
      reason: 'Wrong caller area code',
      description: 'Out of territory',
    });

    expect(dispute).toBeDefined();
    expect(dispute.buyer_id).toBe('buyer-1');
    expect(dispute.status).toBe(DisputeStatus.PENDING);
    expect(prisma.callDispute.create).toHaveBeenCalledTimes(1);
    expect(auditLogsService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'commercial.dispute.created',
        workspaceId: 'ws-1',
        targetType: 'CallDispute',
      }),
    );
  });

  // 2. Buyer cannot dispute another buyer's call
  it("2. Buyer cannot dispute another buyer's call", async () => {
    await expect(
      service.createDispute({
        workspaceId: 'ws-1',
        callCommercialId: 'comm-1', // owned by buyer-1
        userId: 'user-buyer-2', // belongs to buyer-2
        reason: 'Invalid call',
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.callDispute.create).not.toHaveBeenCalled();
  });

  // 3. Vendor cannot create a buyer dispute
  it('3. Vendor cannot create a buyer dispute', async () => {
    await expect(
      service.createDispute({
        workspaceId: 'ws-1',
        callCommercialId: 'comm-1',
        userId: 'user-vendor-1',
        reason: 'Vendor disputing',
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.callDispute.create).not.toHaveBeenCalled();
  });

  // 4. Unauthenticated user cannot create dispute
  it('4. Unauthenticated user cannot create dispute', async () => {
    await expect(
      service.createDispute({
        workspaceId: 'ws-1',
        callCommercialId: 'comm-1',
        userId: 'user-unknown',
        reason: 'Invalid user',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  // 5. Cannot dispute missing CallCommercial
  it('5. Cannot dispute missing CallCommercial', async () => {
    prisma.callCommercial.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.createDispute({
        workspaceId: 'ws-1',
        callCommercialId: 'comm-missing',
        userId: 'user-buyer-1',
        reason: 'No record',
      }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.callDispute.create).not.toHaveBeenCalled();
  });

  // 6. Cannot create second dispute
  it('6. Cannot create second dispute', async () => {
    prisma.callDispute.findUnique.mockResolvedValueOnce(getBaseDispute());

    await expect(
      service.createDispute({
        workspaceId: 'ws-1',
        callCommercialId: 'comm-1',
        userId: 'user-buyer-1',
        reason: 'Duplicate dispute attempt',
      }),
    ).rejects.toThrow(ConflictException);
    expect(prisma.callDispute.create).not.toHaveBeenCalled();
  });

  // 7. New dispute starts PENDING
  it('7. New dispute starts PENDING', async () => {
    const dispute = await service.createDispute({
      workspaceId: 'ws-1',
      callCommercialId: 'comm-1',
      userId: 'user-buyer-1',
      reason: 'Valid reason',
    });
    expect(dispute.status).toBe(DisputeStatus.PENDING);
    expect(dispute.resolved_by_user_id).toBeUndefined(); // or null before update
  });

  // 8. Authorized manager/admin can accept
  it('8. Authorized manager/admin can accept', async () => {
    prisma.callDispute.findUnique.mockResolvedValueOnce(getBaseDispute());

    const result = await service.resolveDispute({
      workspaceId: 'ws-1',
      disputeId: 'dispute-1',
      userId: 'user-admin-1',
      status: DisputeStatus.ACCEPTED,
      resolutionNotes: 'Accepted with full refund',
    });

    expect(result.dispute.status).toBe(DisputeStatus.ACCEPTED);
    expect(result.dispute.resolved_by_user_id).toBe('user-admin-1');
    expect(result.adjustment).toBeDefined();
  });

  // 9. Authorized manager/admin can reject
  it('9. Authorized manager/admin can reject', async () => {
    prisma.callDispute.findUnique.mockResolvedValueOnce(getBaseDispute());

    const result = await service.resolveDispute({
      workspaceId: 'ws-1',
      disputeId: 'dispute-1',
      userId: 'user-admin-1',
      status: DisputeStatus.REJECTED,
      resolutionNotes: 'Rejected because caller was valid',
    });

    expect(result.dispute.status).toBe(DisputeStatus.REJECTED);
    expect(result.dispute.resolved_by_user_id).toBe('user-admin-1');
    expect(result.adjustment).toBeUndefined();
    expect(prisma.callFinancialAdjustment.create).not.toHaveBeenCalled();
    expect(prisma.callCommercial.update).not.toHaveBeenCalled();
  });

  // 10. Unauthorized user cannot resolve
  it('10. Unauthorized user cannot resolve (member or buyer)', async () => {
    await expect(
      service.resolveDispute({
        workspaceId: 'ws-1',
        disputeId: 'dispute-1',
        userId: 'user-regular-1', // role: MEMBER
        status: DisputeStatus.ACCEPTED,
      }),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      service.resolveDispute({
        workspaceId: 'ws-1',
        disputeId: 'dispute-1',
        userId: 'user-buyer-1', // role: MEMBER / buyer
        status: DisputeStatus.ACCEPTED,
      }),
    ).rejects.toThrow(ForbiddenException);

    expect(prisma.callDispute.update).not.toHaveBeenCalled();
  });

  // 11. Only PENDING disputes can resolve
  it('11. Only PENDING disputes can resolve', async () => {
    const acceptedDispute = { ...getBaseDispute(), status: DisputeStatus.ACCEPTED };
    prisma.callDispute.findUnique.mockResolvedValueOnce(acceptedDispute);

    await expect(
      service.resolveDispute({
        workspaceId: 'ws-1',
        disputeId: 'dispute-1',
        userId: 'user-admin-1',
        status: DisputeStatus.ACCEPTED,
      }),
    ).rejects.toThrow(ConflictException);

    const rejectedDispute = { ...getBaseDispute(), status: DisputeStatus.REJECTED };
    prisma.callDispute.findUnique.mockResolvedValueOnce(rejectedDispute);

    await expect(
      service.resolveDispute({
        workspaceId: 'ws-1',
        disputeId: 'dispute-1',
        userId: 'user-admin-1',
        status: DisputeStatus.REJECTED,
      }),
    ).rejects.toThrow(ConflictException);
  });

  // 12. Accepted dispute creates exactly one adjustment
  it('12. Accepted dispute creates exactly one adjustment', async () => {
    prisma.callDispute.findUnique.mockResolvedValueOnce(getBaseDispute());

    const result = await service.resolveDispute({
      workspaceId: 'ws-1',
      disputeId: 'dispute-1',
      userId: 'user-admin-1',
      status: DisputeStatus.ACCEPTED,
    });

    expect(prisma.callFinancialAdjustment.create).toHaveBeenCalledTimes(1);
    expect(result.adjustment).toBeDefined();
  });

  // 13. Accepted dispute sets revenue = 0
  it('13. Accepted dispute sets revenue = 0', async () => {
    prisma.callDispute.findUnique.mockResolvedValueOnce(getBaseDispute());

    await service.resolveDispute({
      workspaceId: 'ws-1',
      disputeId: 'dispute-1',
      userId: 'user-admin-1',
      status: DisputeStatus.ACCEPTED,
    });

    expect(prisma.callCommercial.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          revenue: new Prisma.Decimal('0.0000'),
        }),
      }),
    );
  });

  // 14. Accepted dispute sets payout = 0
  it('14. Accepted dispute sets payout = 0', async () => {
    prisma.callDispute.findUnique.mockResolvedValueOnce(getBaseDispute());

    await service.resolveDispute({
      workspaceId: 'ws-1',
      disputeId: 'dispute-1',
      userId: 'user-admin-1',
      status: DisputeStatus.ACCEPTED,
    });

    expect(prisma.callCommercial.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payout: new Prisma.Decimal('0.0000'),
        }),
      }),
    );
  });

  // 15. Accepted dispute leaves cost unchanged
  it('15. Accepted dispute leaves cost unchanged', async () => {
    prisma.callDispute.findUnique.mockResolvedValueOnce(getBaseDispute());

    await service.resolveDispute({
      workspaceId: 'ws-1',
      disputeId: 'dispute-1',
      userId: 'user-admin-1',
      status: DisputeStatus.ACCEPTED,
    });

    // cost is NOT updated in data
    expect(prisma.callCommercial.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({
          cost: expect.anything(),
        }),
      }),
    );
  });

  // 16. Accepted dispute recalculates profit = -cost
  it('16. Accepted dispute recalculates profit = -cost', async () => {
    prisma.callDispute.findUnique.mockResolvedValueOnce(getBaseDispute());

    await service.resolveDispute({
      workspaceId: 'ws-1',
      disputeId: 'dispute-1',
      userId: 'user-admin-1',
      status: DisputeStatus.ACCEPTED,
    });

    // cost was 5.0000 -> profit = 0 - 0 - 5.0000 = -5.0000
    expect(prisma.callCommercial.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          profit: new Prisma.Decimal('-5.0000'),
        }),
      }),
    );
  });

  // 17. Accepted dispute sets CallCommercial.status = ADJUSTED
  it('17. Accepted dispute sets CallCommercial.status = ADJUSTED', async () => {
    prisma.callDispute.findUnique.mockResolvedValueOnce(getBaseDispute());

    await service.resolveDispute({
      workspaceId: 'ws-1',
      disputeId: 'dispute-1',
      userId: 'user-admin-1',
      status: DisputeStatus.ACCEPTED,
    });

    expect(prisma.callCommercial.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: CommercialStatus.ADJUSTED,
        }),
      }),
    );
  });

  // 18. Accepted dispute sets resolved_by_user_id
  it('18. Accepted dispute sets resolved_by_user_id', async () => {
    prisma.callDispute.findUnique.mockResolvedValueOnce(getBaseDispute());

    await service.resolveDispute({
      workspaceId: 'ws-1',
      disputeId: 'dispute-1',
      userId: 'user-admin-1',
      status: DisputeStatus.ACCEPTED,
    });

    expect(prisma.callDispute.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          resolved_by_user_id: 'user-admin-1',
        }),
      }),
    );
  });

  // 19. Accepted dispute sets resolved_at
  it('19. Accepted dispute sets resolved_at', async () => {
    prisma.callDispute.findUnique.mockResolvedValueOnce(getBaseDispute());

    await service.resolveDispute({
      workspaceId: 'ws-1',
      disputeId: 'dispute-1',
      userId: 'user-admin-1',
      status: DisputeStatus.ACCEPTED,
    });

    expect(prisma.callDispute.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          resolved_at: expect.any(Date),
        }),
      }),
    );
  });

  // 20. Accepted dispute preserves original revenue/payout in adjustment
  it('20. Accepted dispute preserves original revenue/payout in adjustment', async () => {
    prisma.callDispute.findUnique.mockResolvedValueOnce(getBaseDispute());

    await service.resolveDispute({
      workspaceId: 'ws-1',
      disputeId: 'dispute-1',
      userId: 'user-admin-1',
      status: DisputeStatus.ACCEPTED,
      resolutionNotes: 'Audit test resolution',
    });

    expect(prisma.callFinancialAdjustment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          original_revenue: new Prisma.Decimal('50.0000'),
          original_payout: new Prisma.Decimal('30.0000'),
          adjusted_revenue: new Prisma.Decimal('0.0000'),
          adjusted_payout: new Prisma.Decimal('0.0000'),
          reason: 'Audit test resolution',
        }),
      }),
    );
  });

  // 21. Rejected dispute creates no adjustment
  it('21. Rejected dispute creates no adjustment', async () => {
    prisma.callDispute.findUnique.mockResolvedValueOnce(getBaseDispute());

    await service.resolveDispute({
      workspaceId: 'ws-1',
      disputeId: 'dispute-1',
      userId: 'user-admin-1',
      status: DisputeStatus.REJECTED,
    });

    expect(prisma.callFinancialAdjustment.create).not.toHaveBeenCalled();
  });

  // 22. Rejected dispute leaves financial values unchanged
  it('22. Rejected dispute leaves financial values unchanged', async () => {
    prisma.callDispute.findUnique.mockResolvedValueOnce(getBaseDispute());

    await service.resolveDispute({
      workspaceId: 'ws-1',
      disputeId: 'dispute-1',
      userId: 'user-admin-1',
      status: DisputeStatus.REJECTED,
    });

    expect(prisma.callCommercial.update).not.toHaveBeenCalled();
  });

  // 23. Rejected dispute leaves CallCommercial.status unchanged
  it('23. Rejected dispute leaves CallCommercial.status unchanged', async () => {
    prisma.callDispute.findUnique.mockResolvedValueOnce(getBaseDispute());

    await service.resolveDispute({
      workspaceId: 'ws-1',
      disputeId: 'dispute-1',
      userId: 'user-admin-1',
      status: DisputeStatus.REJECTED,
    });

    expect(prisma.callCommercial.update).not.toHaveBeenCalled();
  });

  // 24. Retried accepted resolution does not create a second adjustment
  it('24. Retried accepted resolution does not create a second adjustment', async () => {
    prisma.callDispute.findUnique.mockResolvedValueOnce({
      ...getBaseDispute(),
      status: DisputeStatus.ACCEPTED,
    });

    await expect(
      service.resolveDispute({
        workspaceId: 'ws-1',
        disputeId: 'dispute-1',
        userId: 'user-admin-1',
        status: DisputeStatus.ACCEPTED,
      }),
    ).rejects.toThrow(ConflictException);

    expect(prisma.callFinancialAdjustment.create).not.toHaveBeenCalled();
  });

  // 25. Concurrent resolution cannot create duplicate adjustment
  it('25. Concurrent resolution cannot create duplicate adjustment (P2002 conflict handled)', async () => {
    prisma.callDispute.findUnique.mockResolvedValueOnce(getBaseDispute());
    // Simulate unique constraint failure if another worker inserted adjustment concurrently
    prisma.callFinancialAdjustment.create.mockRejectedValueOnce({ code: 'P2002' });

    await expect(
      service.resolveDispute({
        workspaceId: 'ws-1',
        disputeId: 'dispute-1',
        userId: 'user-admin-1',
        status: DisputeStatus.ACCEPTED,
      }),
    ).rejects.toThrow();
  });

  // 26. Financial adjustment cannot be edited through application code/API
  it('26. Financial adjustment cannot be edited through application code/API', () => {
    expect((service as any).updateAdjustment).toBeUndefined();
    expect((controller as any).updateAdjustment).toBeUndefined();
  });

  // 27. Financial adjustment cannot be deleted through application code/API
  it('27. Financial adjustment cannot be deleted through application code/API', () => {
    expect((service as any).deleteAdjustment).toBeUndefined();
    expect((controller as any).deleteAdjustment).toBeUndefined();
  });

  // 28. Workspace isolation for dispute creation
  it('28. Workspace isolation for dispute creation', async () => {
    // Call commercial belongs to ws-1, but request comes for ws-2
    await expect(
      service.createDispute({
        workspaceId: 'ws-2',
        callCommercialId: 'comm-1',
        userId: 'user-buyer-1',
        reason: 'Cross tenant attempt',
      }),
    ).rejects.toThrow();
  });

  // 29. Workspace isolation for resolution
  it('29. Workspace isolation for resolution', async () => {
    // Dispute belongs to ws-1, request asks ws-2
    prisma.callDispute.findUnique.mockResolvedValueOnce(getBaseDispute());

    await expect(
      service.resolveDispute({
        workspaceId: 'ws-2',
        disputeId: 'dispute-1',
        userId: 'user-admin-1',
        status: DisputeStatus.ACCEPTED,
      }),
    ).rejects.toThrow();
  });

  // 30. Decimal calculations remain exact
  it('30. Decimal calculations remain exact', async () => {
    const commercial = {
      ...getBaseCommercial(),
      cost: new Prisma.Decimal('7.1234'),
    };
    prisma.callDispute.findUnique.mockResolvedValueOnce({
      ...getBaseDispute(),
      commercial,
    });

    await service.resolveDispute({
      workspaceId: 'ws-1',
      disputeId: 'dispute-1',
      userId: 'user-admin-1',
      status: DisputeStatus.ACCEPTED,
    });

    expect(prisma.callCommercial.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          profit: new Prisma.Decimal('-7.1234'),
        }),
      }),
    );
  });

  // 31. Currency remains unchanged
  it('31. Currency remains unchanged', async () => {
    prisma.callDispute.findUnique.mockResolvedValueOnce(getBaseDispute());

    await service.resolveDispute({
      workspaceId: 'ws-1',
      disputeId: 'dispute-1',
      userId: 'user-admin-1',
      status: DisputeStatus.ACCEPTED,
    });

    expect(prisma.callCommercial.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({
          currency: expect.anything(),
        }),
      }),
    );
  });

  // 32. Call state remains unchanged
  it('32. Call state remains unchanged', async () => {
    prisma.callDispute.findUnique.mockResolvedValueOnce(getBaseDispute());

    await service.resolveDispute({
      workspaceId: 'ws-1',
      disputeId: 'dispute-1',
      userId: 'user-admin-1',
      status: DisputeStatus.ACCEPTED,
    });

    expect(prisma.call.update).not.toHaveBeenCalled();
  });

  // 33. WalletTransaction remains unchanged
  it('33. WalletTransaction remains unchanged', async () => {
    prisma.callDispute.findUnique.mockResolvedValueOnce(getBaseDispute());

    await service.resolveDispute({
      workspaceId: 'ws-1',
      disputeId: 'dispute-1',
      userId: 'user-admin-1',
      status: DisputeStatus.ACCEPTED,
    });

    expect(prisma.walletTransaction.update).not.toHaveBeenCalled();
  });

  // Controller direct integration test for resolution endpoints
  it('Controller routes accept and reject properly', async () => {
    prisma.callDispute.findUnique.mockResolvedValue(getBaseDispute());

    const acceptRes = await controller.acceptDispute(
      'ws-1',
      'dispute-1',
      { user: { userId: 'user-admin-1' } },
      { resolution_notes: 'Accepted directly' },
    );
    expect(acceptRes.dispute.status).toBe(DisputeStatus.ACCEPTED);

    const rejectRes = await controller.rejectDispute(
      'ws-1',
      'dispute-1',
      { user: { userId: 'user-admin-1' } },
      { resolution_notes: 'Rejected directly' },
    );
    expect(rejectRes.dispute.status).toBe(DisputeStatus.REJECTED);
  });
});
