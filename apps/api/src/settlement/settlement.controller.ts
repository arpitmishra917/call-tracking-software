import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { RequirePermission } from '../authorization/permissions.decorator.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettlementBatchService } from './settlement-batch.service.js';
import { GenerateSettlementBatchDto, ListSettlementBatchesDto } from './dto/index.js';
import { SettlementParticipantType, WorkspaceRole } from '@prisma/client';

@Controller('workspaces/:workspaceId/settlements')
@UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard)
export class SettlementController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settlementBatchService: SettlementBatchService,
  ) {}

  /**
   * Helper to retrieve and validate workspace member context.
   */
  private async getMemberContext(workspaceId: string, userId: string) {
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

    return member;
  }

  /**
   * Financial sanitization for settlement batch records.
   * Ensures Buyer never receives vendor economics (payout, cost, profit, vendor_id).
   * Ensures Vendor never receives buyer economics (revenue, cost, profit, buyer_id).
   */
  private sanitizeBatch(batch: any, participantType: string): any {
    if (!batch) return batch;
    const sanitized = { ...batch };
    if (participantType === 'BUYER') {
      delete sanitized.vendor_id;
      delete sanitized.payout;
      delete sanitized.cost;
      delete sanitized.profit;
    } else if (participantType === 'VENDOR') {
      delete sanitized.buyer_id;
      delete sanitized.revenue;
      delete sanitized.cost;
      delete sanitized.profit;
    }
    return sanitized;
  }

  /**
   * Financial sanitization for settlement line items and attached commercial records.
   * AD-04 / AD-05 Invariant:
   * - Buyer: never sees payout, cost, profit, vendor_id.
   * - Vendor: never sees revenue, cost, profit, buyer_id.
   */
  private sanitizeItem(item: any, participantType: string): any {
    if (!item) return item;
    const sanitized = { ...item };

    if (participantType === 'BUYER') {
      delete sanitized.vendor_id;
      if (sanitized.commercial) {
        const comm = { ...sanitized.commercial };
        delete comm.payout;
        delete comm.cost;
        delete comm.profit;
        delete comm.vendor_id;
        sanitized.commercial = comm;
      }
    } else if (participantType === 'VENDOR') {
      delete sanitized.buyer_id;
      if (sanitized.commercial) {
        const comm = { ...sanitized.commercial };
        delete comm.revenue;
        delete comm.cost;
        delete comm.profit;
        delete comm.buyer_id;
        sanitized.commercial = comm;
      }
    }

    return sanitized;
  }

  /**
   * POST /workspaces/:workspaceId/settlements/batches/generate
   * Generates settlement batches for a given period.
   * Requires settlement:generate permission AND authenticated workspace role == OWNER.
   */
  @Post('batches/generate')
  @UseGuards(WorkspaceRolesGuard)
  @RequireWorkspaceRoles(WorkspaceRole.OWNER)
  @RequirePermission('settlement:generate')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async generateBatch(
    @Param('workspaceId') workspaceId: string,
    @Request() req: any,
    @Body() dto: GenerateSettlementBatchDto,
  ) {
    const member = await this.getMemberContext(workspaceId, req.user.userId);
    if (member.role !== WorkspaceRole.OWNER) {
      throw new ForbiddenException('Only workspace owners can generate settlement batches');
    }

    const start = new Date(dto.period_start);
    const end = new Date(dto.period_end);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestException('Invalid date format for period boundaries');
    }

    if (start >= end) {
      throw new BadRequestException('period_start must be before period_end');
    }

    if (dto.participant_type === SettlementParticipantType.BUYER && dto.vendor_id) {
      throw new BadRequestException('vendor_id cannot be provided when participant_type is BUYER');
    }

    if (dto.participant_type === SettlementParticipantType.VENDOR && dto.buyer_id) {
      throw new BadRequestException('buyer_id cannot be provided when participant_type is VENDOR');
    }

    if (dto.participant_type === SettlementParticipantType.BUYER) {
      return this.settlementBatchService.generateBuyerSettlement({
        workspace_id: workspaceId,
        period_start: start,
        period_end: end,
        buyer_id: dto.buyer_id,
        created_by_user_id: req.user.userId,
      });
    } else if (dto.participant_type === SettlementParticipantType.VENDOR) {
      return this.settlementBatchService.generateVendorSettlement({
        workspace_id: workspaceId,
        period_start: start,
        period_end: end,
        vendor_id: dto.vendor_id,
        created_by_user_id: req.user.userId,
      });
    } else {
      throw new BadRequestException(`Unsupported participant_type: ${dto.participant_type}`);
    }
  }

  /**
   * GET /workspaces/:workspaceId/settlements/batches
   * Lists settlement batches with pagination, filters, and participant scoping.
   */
  @Get('batches')
  @RequirePermission('settlement:read')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async getBatches(
    @Param('workspaceId') workspaceId: string,
    @Request() req: any,
    @Query() query: ListSettlementBatchesDto,
  ) {
    const member = await this.getMemberContext(workspaceId, req.user.userId);

    let participantType = query.participant_type;
    let buyerId = query.buyer_id;
    let vendorId = query.vendor_id;

    if (member.participant_type === 'BUYER') {
      if (query.buyer_id && query.buyer_id !== member.buyer_id) {
        throw new ForbiddenException('Buyer can only access batches for their own account');
      }
      if (query.vendor_id || query.participant_type === SettlementParticipantType.VENDOR) {
        throw new ForbiddenException('Buyer cannot access vendor data');
      }
      participantType = SettlementParticipantType.BUYER;
      buyerId = member.buyer_id ?? undefined;
    } else if (member.participant_type === 'VENDOR') {
      if (query.vendor_id && query.vendor_id !== member.vendor_id) {
        throw new ForbiddenException('Vendor can only access batches for their own account');
      }
      if (query.buyer_id || query.participant_type === SettlementParticipantType.BUYER) {
        throw new ForbiddenException('Vendor cannot access buyer data');
      }
      participantType = SettlementParticipantType.VENDOR;
      vendorId = member.vendor_id ?? undefined;
    }

    const limit = query.limit ? parseInt(String(query.limit), 10) : 50;
    const offset = query.offset ? parseInt(String(query.offset), 10) : 0;
    const periodStart = query.period_start ? new Date(query.period_start) : undefined;
    const periodEnd = query.period_end ? new Date(query.period_end) : undefined;

    const result = await this.settlementBatchService.getBatches(workspaceId, {
      participant_type: participantType,
      buyer_id: buyerId,
      vendor_id: vendorId,
      settlement_status: query.settlement_status,
      payment_status: query.payment_status,
      reconciliation_status: query.reconciliation_status,
      period_start: periodStart,
      period_end: periodEnd,
      limit,
      offset,
    });

    const sanitizedBatches = result.batches.map((batch) =>
      this.sanitizeBatch(batch, member.participant_type),
    );

    return {
      batches: sanitizedBatches,
      items: sanitizedBatches,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    };
  }

  /**
   * GET /workspaces/:workspaceId/settlements/batches/:batchId
   * Retrieves summary details of a specific settlement batch.
   */
  @Get('batches/:batchId')
  @RequirePermission('settlement:read')
  async getBatchById(
    @Param('workspaceId') workspaceId: string,
    @Param('batchId') batchId: string,
    @Request() req: any,
  ) {
    const member = await this.getMemberContext(workspaceId, req.user.userId);

    const batch = await this.settlementBatchService.getBatchById(workspaceId, batchId);
    if (!batch) {
      throw new NotFoundException('Settlement batch not found');
    }

    if (member.participant_type === 'BUYER') {
      if (batch.participant_type !== SettlementParticipantType.BUYER || batch.buyer_id !== member.buyer_id) {
        throw new ForbiddenException('Access denied to this settlement batch');
      }
    } else if (member.participant_type === 'VENDOR') {
      if (batch.participant_type !== SettlementParticipantType.VENDOR || batch.vendor_id !== member.vendor_id) {
        throw new ForbiddenException('Access denied to this settlement batch');
      }
    }

    return this.sanitizeBatch(batch, member.participant_type);
  }

  /**
   * GET /workspaces/:workspaceId/settlements/batches/:batchId/items
   * Lists line items for a specific settlement batch with participant financial sanitization.
   */
  @Get('batches/:batchId/items')
  @RequirePermission('settlement:read')
  async getBatchItems(
    @Param('workspaceId') workspaceId: string,
    @Param('batchId') batchId: string,
    @Request() req: any,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
  ) {
    const member = await this.getMemberContext(workspaceId, req.user.userId);

    const batch = await this.settlementBatchService.getBatchById(workspaceId, batchId);
    if (!batch) {
      throw new NotFoundException('Settlement batch not found');
    }

    if (member.participant_type === 'BUYER') {
      if (batch.participant_type !== SettlementParticipantType.BUYER || batch.buyer_id !== member.buyer_id) {
        throw new ForbiddenException('Access denied to this settlement batch');
      }
    } else if (member.participant_type === 'VENDOR') {
      if (batch.participant_type !== SettlementParticipantType.VENDOR || batch.vendor_id !== member.vendor_id) {
        throw new ForbiddenException('Access denied to this settlement batch');
      }
    }

    const limit = limitStr ? parseInt(limitStr, 10) : 50;
    if (isNaN(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException('Limit must be an integer between 1 and 100');
    }
    const offset = offsetStr ? parseInt(offsetStr, 10) : 0;
    if (isNaN(offset) || offset < 0) {
      throw new BadRequestException('Offset must be a non-negative integer (>= 0)');
    }

    const result = await this.settlementBatchService.getBatchItems(workspaceId, batchId, {
      limit,
      offset,
    });

    const sanitizedItems = result.items.map((item) =>
      this.sanitizeItem(item, member.participant_type),
    );

    return {
      items: sanitizedItems,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    };
  }
}
