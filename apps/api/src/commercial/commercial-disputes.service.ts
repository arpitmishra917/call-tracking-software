import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import {
  Prisma,
  DisputeStatus,
  CommercialStatus,
  WorkspaceRole,
  CallDispute,
  CallFinancialAdjustment,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';

@Injectable()
export class CommercialDisputesService {
  private readonly logger = new Logger(CommercialDisputesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  /**
   * Buyer creates a commercial dispute against a CallCommercial record.
   * Only the Buyer participant associated with CallCommercial.buyer_id may dispute the call.
   */
  async createDispute(params: {
    workspaceId: string;
    callCommercialId: string;
    userId: string;
    reason: string;
    description?: string;
  }): Promise<CallDispute> {
    if (!params.reason || !params.reason.trim()) {
      throw new BadRequestException('Dispute reason is required');
    }

    // 1. Authenticate workspace member & verify buyer participant association
    const member = await this.prisma.workspaceMember.findUnique({
      where: {
        workspace_id_user_id: {
          workspace_id: params.workspaceId,
          user_id: params.userId,
        },
      },
    });

    if (!member) {
      throw new ForbiddenException('User is not a member of this workspace');
    }

    if (member.participant_type === 'VENDOR') {
      throw new ForbiddenException('Vendors cannot create buyer disputes');
    }

    if (member.participant_type !== 'BUYER' || !member.buyer_id) {
      throw new ForbiddenException('Only buyer participants can create disputes');
    }

    // 2. Fetch CallCommercial within tenant workspace
    const commercial = await this.prisma.callCommercial.findUnique({
      where: { id: params.callCommercialId },
    });

    if (!commercial || commercial.workspace_id !== params.workspaceId) {
      throw new NotFoundException('Call commercial record not found');
    }

    // 3. Buyer eligibility verification
    if (!commercial.buyer_id) {
      throw new BadRequestException('Cannot dispute a commercial call with no buyer attributed');
    }

    if (commercial.buyer_id !== member.buyer_id) {
      throw new ForbiddenException('Buyer can only dispute calls attributed to their own buyer account');
    }

    // 4. One dispute per CallCommercial check
    const existingDispute = await this.prisma.callDispute.findUnique({
      where: { call_commercial_id: params.callCommercialId },
    });

    if (existingDispute) {
      throw new ConflictException('A dispute already exists for this call commercial record');
    }

    // 5. Create dispute inside transaction with unique constraint safety
    return this.prisma.$transaction(async (tx) => {
      try {
        const dispute = await tx.callDispute.create({
          data: {
            workspace_id: params.workspaceId,
            call_commercial_id: params.callCommercialId,
            buyer_id: member.buyer_id!,
            reason: params.reason.trim(),
            description: params.description?.trim() || null,
            status: DisputeStatus.PENDING,
            created_by_user_id: params.userId,
          },
        });

        await this.auditLogsService.logAction({
          workspaceId: params.workspaceId,
          actorUserId: params.userId,
          actorMemberId: member.id,
          action: 'commercial.dispute.created',
          targetType: 'CallDispute',
          targetId: dispute.id,
          metadata: {
            callCommercialId: dispute.call_commercial_id,
            buyerId: dispute.buyer_id,
            reason: dispute.reason,
          },
        });

        return dispute;
      } catch (err: any) {
        if (err?.code === 'P2002') {
          throw new ConflictException('A dispute already exists for this call commercial record');
        }
        throw err;
      }
    });
  }

  /**
   * Authorized manager (Owner/Admin) resolves a PENDING dispute.
   * ACCEPTED: Reverses revenue and payout to 0, preserves cost, creates CallFinancialAdjustment, sets status ADJUSTED.
   * REJECTED: Updates status to REJECTED with notes, leaves financial state untouched.
   */
  async resolveDispute(params: {
    workspaceId: string;
    disputeId: string;
    userId: string;
    status: 'ACCEPTED' | 'REJECTED';
    resolutionNotes?: string;
  }): Promise<{ dispute: CallDispute; adjustment?: CallFinancialAdjustment }> {
    // 1. Verify resolver membership and role in workspace
    const member = await this.prisma.workspaceMember.findUnique({
      where: {
        workspace_id_user_id: {
          workspace_id: params.workspaceId,
          user_id: params.userId,
        },
      },
    });

    if (!member) {
      throw new ForbiddenException('User is not a member of this workspace');
    }

    if (member.role !== WorkspaceRole.OWNER && member.role !== WorkspaceRole.ADMIN) {
      throw new ForbiddenException('Only owners and admins can resolve disputes');
    }

    // 2. Transactional resolution
    return this.prisma.$transaction(async (tx) => {
      // Concurrency guard: acquire row lock to serialize concurrent resolutions
      if (typeof (tx as any).$queryRaw === 'function') {
        await (tx as any).$queryRaw`
          SELECT id FROM call_disputes WHERE id = ${params.disputeId} FOR UPDATE
        `;
      }

      // a. Read dispute
      const dispute = await tx.callDispute.findUnique({
        where: { id: params.disputeId },
        include: { commercial: true },
      });

      if (!dispute || dispute.workspace_id !== params.workspaceId) {
        throw new NotFoundException('Dispute not found');
      }

      // b. Verify status is PENDING (No reopening allowed in V1)
      if (dispute.status !== DisputeStatus.PENDING) {
        throw new ConflictException(`Cannot resolve a dispute that is already in ${dispute.status} state`);
      }

      const commercial = dispute.commercial;
      if (!commercial || commercial.workspace_id !== params.workspaceId) {
        throw new NotFoundException('Associated CallCommercial record not found');
      }

      const resolvedAt = new Date();

      // c. REJECTED flow
      if (params.status === DisputeStatus.REJECTED) {
        const updatedDispute = await tx.callDispute.update({
          where: { id: dispute.id },
          data: {
            status: DisputeStatus.REJECTED,
            resolved_by_user_id: params.userId,
            resolved_at: resolvedAt,
            resolution_notes: params.resolutionNotes?.trim() || null,
          },
        });

        await this.auditLogsService.logAction({
          workspaceId: params.workspaceId,
          actorUserId: params.userId,
          actorMemberId: member.id,
          action: 'commercial.dispute.rejected',
          targetType: 'CallDispute',
          targetId: dispute.id,
          metadata: {
            callCommercialId: dispute.call_commercial_id,
            resolutionNotes: params.resolutionNotes,
          },
        });

        return { dispute: updatedDispute };
      }

      // d. ACCEPTED flow - Full reversal
      // Check for existing adjustment (idempotency guard)
      const existingAdjustment = await tx.callFinancialAdjustment.findUnique({
        where: { dispute_id: dispute.id },
      });

      if (existingAdjustment) {
        throw new ConflictException('A financial adjustment has already been applied for this dispute');
      }

      // Capture original revenue and payout before reversal
      const originalRevenue = commercial.revenue;
      const originalPayout = commercial.payout;
      const adjustedRevenue = new Prisma.Decimal('0.0000');
      const adjustedPayout = new Prisma.Decimal('0.0000');

      // Create CallFinancialAdjustment audit record
      const adjustment = await tx.callFinancialAdjustment.create({
        data: {
          workspace_id: params.workspaceId,
          call_commercial_id: commercial.id,
          dispute_id: dispute.id,
          original_revenue: originalRevenue,
          original_payout: originalPayout,
          adjusted_revenue: adjustedRevenue,
          adjusted_payout: adjustedPayout,
          reason: params.resolutionNotes?.trim() || dispute.reason,
        },
      });

      // Recalculate profit: profit = adjusted_revenue - adjusted_payout - cost = -cost
      const newProfit = adjustedRevenue.sub(adjustedPayout).sub(commercial.cost);

      // Update CallCommercial
      await tx.callCommercial.update({
        where: { id: commercial.id },
        data: {
          revenue: adjustedRevenue,
          payout: adjustedPayout,
          profit: newProfit,
          status: CommercialStatus.ADJUSTED,
        },
      });

      // Update dispute to ACCEPTED
      const updatedDispute = await tx.callDispute.update({
        where: { id: dispute.id },
        data: {
          status: DisputeStatus.ACCEPTED,
          resolved_by_user_id: params.userId,
          resolved_at: resolvedAt,
          resolution_notes: params.resolutionNotes?.trim() || null,
        },
      });

      // Emit audit events
      await this.auditLogsService.logAction({
        workspaceId: params.workspaceId,
        actorUserId: params.userId,
        actorMemberId: member.id,
        action: 'commercial.dispute.accepted',
        targetType: 'CallDispute',
        targetId: dispute.id,
        metadata: {
          callCommercialId: dispute.call_commercial_id,
          resolutionNotes: params.resolutionNotes,
        },
      });

      await this.auditLogsService.logAction({
        workspaceId: params.workspaceId,
        actorUserId: params.userId,
        actorMemberId: member.id,
        action: 'commercial.financial_adjustment.created',
        targetType: 'CallFinancialAdjustment',
        targetId: adjustment.id,
        metadata: {
          disputeId: dispute.id,
          callCommercialId: dispute.call_commercial_id,
          originalRevenue: originalRevenue.toString(),
          originalPayout: originalPayout.toString(),
          adjustedRevenue: '0.0000',
          adjustedPayout: '0.0000',
        },
      });

      return { dispute: updatedDispute, adjustment };
    });
  }

  /**
   * Get dispute details by dispute ID within workspace.
   */
  async getDispute(workspaceId: string, disputeId: string, userId?: string): Promise<any> {
    const dispute = await this.prisma.callDispute.findUnique({
      where: { id: disputeId },
      include: {
        adjustment: true,
        commercial: true,
      },
    });

    if (!dispute || dispute.workspace_id !== workspaceId) {
      throw new NotFoundException('Dispute not found');
    }

    if (userId) {
      const member = await this.prisma.workspaceMember.findUnique({
        where: {
          workspace_id_user_id: {
            workspace_id: workspaceId,
            user_id: userId,
          },
        },
      });

      if (!member) {
        throw new ForbiddenException('User is not a member of this workspace');
      }

      if (member.role === 'OWNER' || member.role === 'ADMIN') {
        return dispute;
      }

      if (member.participant_type === 'VENDOR') {
        throw new ForbiddenException('Vendors cannot view buyer disputes');
      }

      if (member.participant_type === 'BUYER') {
        if (!member.buyer_id || dispute.buyer_id !== member.buyer_id) {
          throw new ForbiddenException('Buyer can only view disputes filed for their own buyer account');
        }

        const sanitized = { ...dispute };
        if (sanitized.commercial) {
          const { payout, cost, profit, vendor_id, ...commRest } = sanitized.commercial as any;
          sanitized.commercial = commRest;
        }
        if (sanitized.adjustment) {
          const { original_payout, adjusted_payout, ...adjRest } = sanitized.adjustment as any;
          sanitized.adjustment = adjRest;
        }
        return sanitized;
      }

      throw new ForbiddenException('Insufficient permission to view commercial disputes');
    }

    return dispute;
  }

  /**
   * Get dispute details by CallCommercial ID within workspace.
   */
  async getDisputeByCallCommercial(
    workspaceId: string,
    callCommercialId: string,
    userId?: string,
  ): Promise<any> {
    const dispute = await this.prisma.callDispute.findUnique({
      where: { call_commercial_id: callCommercialId },
      include: {
        adjustment: true,
        commercial: true,
      },
    });

    if (dispute && dispute.workspace_id !== workspaceId) {
      throw new NotFoundException('Dispute not found');
    }

    if (!dispute) {
      return null;
    }

    if (userId) {
      const member = await this.prisma.workspaceMember.findUnique({
        where: {
          workspace_id_user_id: {
            workspace_id: workspaceId,
            user_id: userId,
          },
        },
      });

      if (!member) {
        throw new ForbiddenException('User is not a member of this workspace');
      }

      if (member.role === 'OWNER' || member.role === 'ADMIN') {
        return dispute;
      }

      if (member.participant_type === 'VENDOR') {
        throw new ForbiddenException('Vendors cannot view buyer disputes');
      }

      if (member.participant_type === 'BUYER') {
        if (!member.buyer_id || dispute.buyer_id !== member.buyer_id) {
          throw new ForbiddenException('Buyer can only view disputes filed for their own buyer account');
        }

        const sanitized = { ...dispute };
        if (sanitized.commercial) {
          const { payout, cost, profit, vendor_id, ...commRest } = sanitized.commercial as any;
          sanitized.commercial = commRest;
        }
        if (sanitized.adjustment) {
          const { original_payout, adjusted_payout, ...adjRest } = sanitized.adjustment as any;
          sanitized.adjustment = adjRest;
        }
        return sanitized;
      }

      throw new ForbiddenException('Insufficient permission to view commercial disputes');
    }

    return dispute;
  }
}
