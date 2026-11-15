import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { normalizeE164, isValidPhoneNumber } from '../common/phone.utils.js';

export interface CreateDestinationNumberDto {
  destinationNumber: string;
  name?: string;
  timeout?: number;
  maxConcurrentCalls?: number | string;
  max_concurrent_calls?: number | string;
}

export interface UpdateDestinationNumberDto {
  name?: string;
  timeout?: number;
  maxConcurrentCalls?: number | string;
  max_concurrent_calls?: number | string;
  status?: string;
}

@Injectable()
export class DestinationNumbersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionsService: PermissionsService,
  ) {}

  private validateMaxConcurrentCalls(val: any): number {
    if (val === undefined || val === null || val === '') {
      return 1;
    }
    const num = Number(val);
    if (isNaN(num) || !Number.isInteger(num) || num <= 0) {
      throw new BadRequestException('Maximum concurrent calls must be a positive integer greater than 0.');
    }
    if (num > 1000) {
      throw new BadRequestException('Maximum concurrent calls cannot exceed 1000.');
    }
    return num;
  }

  private validateTimeout(val: any): number {
    if (val === undefined || val === null || val === '') {
      return 30;
    }
    const num = Number(val);
    if (isNaN(num) || !Number.isInteger(num) || num < 5 || num > 300) {
      throw new BadRequestException('Timeout must be an integer between 5 and 300 seconds.');
    }
    return num;
  }

  private validateStatus(status?: string): string {
    if (!status) return 'ACTIVE';
    const upper = status.toUpperCase();
    if (upper !== 'ACTIVE' && upper !== 'INACTIVE') {
      throw new BadRequestException('Status must be either ACTIVE or INACTIVE.');
    }
    return upper;
  }

  /**
   * Create an independent Destination Number attached exclusively to a Buyer in a Workspace.
   */
  async createDestinationNumber(
    workspaceId: string,
    buyerId: string,
    dto: CreateDestinationNumberDto,
  ) {
    if (!dto.destinationNumber || !isValidPhoneNumber(dto.destinationNumber)) {
      throw new BadRequestException('Invalid destination number. Must be valid E.164 format (e.g. +15551234567).');
    }

    const e164 = normalizeE164(dto.destinationNumber);
    if (!e164 || !e164.startsWith('+')) {
      throw new BadRequestException('Invalid destination number. Must be valid E.164 format (e.g. +15551234567).');
    }

    // 1. Verify Buyer exists and belongs to the workspace
    const buyer = await this.prisma.buyer.findUnique({
      where: { id: buyerId },
    });
    if (!buyer || buyer.workspace_id !== workspaceId) {
      throw new NotFoundException(`Buyer Organization with ID ${buyerId} not found in this workspace.`);
    }

    // 2. Enforce duplicate protection: number must be unique per workspace
    const existingNumber = await this.prisma.destinationNumber.findUnique({
      where: {
        workspace_id_destination_number: {
          workspace_id: workspaceId,
          destination_number: e164,
        },
      },
    });
    if (existingNumber) {
      throw new ConflictException(`Destination number ${e164} already exists in this workspace.`);
    }

    const maxCallsInput = dto.max_concurrent_calls !== undefined ? dto.max_concurrent_calls : dto.maxConcurrentCalls;
    const maxCalls = this.validateMaxConcurrentCalls(maxCallsInput);
    const timeout = this.validateTimeout(dto.timeout);

    return this.prisma.destinationNumber.create({
      data: {
        workspace_id: workspaceId,
        buyer_id: buyer.id,
        destination_number: e164,
        name: dto.name ? dto.name.trim() : `${buyer.name} Line`,
        timeout,
        max_concurrent_calls: maxCalls,
        status: 'ACTIVE',
      },
      include: {
        buyer: {
          select: { id: true, name: true, email: true, status: true },
        },
        campaign_destinations: {
          include: {
            campaign: { select: { id: true, name: true, status: true } },
          },
        },
      },
    });
  }

  /**
   * List all destination numbers for a specific Buyer with RBAC scoping.
   */
  async listBuyerDestinationNumbers(workspaceId: string, buyerId: string, userId: string = '') {
    // Verify Buyer exists and belongs to workspace
    const buyer = await this.prisma.buyer.findUnique({
      where: { id: buyerId },
    });
    if (!buyer || buyer.workspace_id !== workspaceId) {
      throw new NotFoundException(`Buyer Organization not found in this workspace.`);
    }

    if (userId) {
      const allowed = await this.isBuyerAccessAllowed(workspaceId, buyerId, userId);
      if (!allowed) {
        throw new ForbiddenException('Access to this Buyer Organization is denied.');
      }
    }

    return this.prisma.destinationNumber.findMany({
      where: {
        workspace_id: workspaceId,
        buyer_id: buyerId,
      },
      orderBy: { created_at: 'desc' },
      include: {
        buyer: {
          select: { id: true, name: true, email: true, status: true },
        },
        campaign_destinations: {
          include: {
            campaign: { select: { id: true, name: true, status: true } },
          },
        },
      },
    });
  }

  /**
   * List workspace-wide destination numbers with pagination and filtering.
   */
  async listWorkspaceDestinationNumbers(
    workspaceId: string,
    userId: string = '',
    filters?: { search?: string; status?: string; limit?: number; offset?: number },
  ) {
    const where: any = { workspace_id: workspaceId };

    if (userId) {
      const permissions = await this.permissionsService.getPermissionsForUser(workspaceId, userId);
      const readPerms = permissions.filter(p => p.key === 'buyer:read');
      if (readPerms.length === 0) throw new ForbiddenException('Missing buyer:read permission');

      const hasAll = readPerms.some(p => p.scope_type === 'ALL');
      if (!hasAll) {
        const allowedBuyerIds = await this.getAllowedBuyerIdsForUser(workspaceId, userId);
        if (allowedBuyerIds.length === 0) {
          return { items: [], total: 0 };
        }
        where.buyer_id = { in: allowedBuyerIds };
      }
    }

    if (filters?.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { destination_number: { contains: filters.search } },
        { buyer: { name: { contains: filters.search, mode: 'insensitive' } } },
      ];
    }

    if (filters?.status) {
      where.status = this.validateStatus(filters.status);
    }

    const [items, total] = await Promise.all([
      this.prisma.destinationNumber.findMany({
        where,
        include: {
          buyer: {
            select: { id: true, name: true, email: true, status: true },
          },
          campaign_destinations: {
            include: {
              campaign: { select: { id: true, name: true, status: true } },
            },
          },
        },
        orderBy: { created_at: 'desc' },
        skip: filters?.offset || 0,
        take: filters?.limit || 50,
      }),
      this.prisma.destinationNumber.count({ where }),
    ]);

    return { items, total };
  }

  /**
   * Retrieve a single destination number.
   */
  async getDestinationNumber(workspaceId: string, id: string, userId: string = '') {
    const destinationNumber = await this.prisma.destinationNumber.findUnique({
      where: { id },
      include: {
        buyer: {
          select: { id: true, name: true, email: true, status: true },
        },
        campaign_destinations: {
          include: {
            campaign: { select: { id: true, name: true, status: true } },
          },
        },
      },
    });

    if (!destinationNumber || destinationNumber.workspace_id !== workspaceId) {
      throw new NotFoundException(`Destination Number with ID ${id} not found in this workspace.`);
    }

    if (userId) {
      const allowed = await this.isBuyerAccessAllowed(workspaceId, destinationNumber.buyer_id, userId);
      if (!allowed) {
        throw new ForbiddenException('Access to this Destination Number is denied.');
      }
    }

    return destinationNumber;
  }

  /**
   * Update destination number details and status.
   */
  async updateDestinationNumber(
    workspaceId: string,
    id: string,
    dto: UpdateDestinationNumberDto,
    userId: string = '',
  ) {
    const existing = await this.getDestinationNumber(workspaceId, id, userId);

    const updateData: any = {};
    if (dto.name !== undefined) {
      updateData.name = dto.name ? dto.name.trim() : null;
    }
    if (dto.timeout !== undefined) {
      updateData.timeout = this.validateTimeout(dto.timeout);
    }
    const maxCallsInput = dto.max_concurrent_calls !== undefined ? dto.max_concurrent_calls : dto.maxConcurrentCalls;
    if (maxCallsInput !== undefined) {
      updateData.max_concurrent_calls = this.validateMaxConcurrentCalls(maxCallsInput);
    }
    if (dto.status !== undefined) {
      updateData.status = this.validateStatus(dto.status);
    }

    return this.prisma.destinationNumber.update({
      where: { id: existing.id },
      data: updateData,
      include: {
        buyer: {
          select: { id: true, name: true, email: true, status: true },
        },
        campaign_destinations: {
          include: {
            campaign: { select: { id: true, name: true, status: true } },
          },
        },
      },
    });
  }

  /**
   * Archive / toggle status of destination number.
   */
  async setStatus(workspaceId: string, id: string, status: 'ACTIVE' | 'INACTIVE', userId: string = '') {
    return this.updateDestinationNumber(workspaceId, id, { status }, userId);
  }

  /**
   * Delete destination number.
   */
  async deleteDestinationNumber(workspaceId: string, id: string, userId: string = '') {
    const existing = await this.getDestinationNumber(workspaceId, id, userId);
    return this.prisma.destinationNumber.delete({
      where: { id: existing.id },
    });
  }

  // --- Helper RBAC Methods ---

  private async isBuyerAccessAllowed(workspaceId: string, buyerId: string, userId: string): Promise<boolean> {
    const permissions = await this.permissionsService.getPermissionsForUser(workspaceId, userId);
    const readPerms = permissions.filter(p => p.key === 'buyer:read');
    if (readPerms.length === 0) return false;
    if (readPerms.some(p => p.scope_type === 'ALL')) return true;

    const allowedBuyerIds = await this.getAllowedBuyerIdsForUser(workspaceId, userId);
    return allowedBuyerIds.includes(buyerId);
  }

  private async getAllowedBuyerIdsForUser(workspaceId: string, userId: string): Promise<string[]> {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: userId } },
    });
    if (!member) return [];

    let buyerIds: string[] = [];
    if (this.prisma.workspaceMemberBuyer?.findMany) {
      const links = await this.prisma.workspaceMemberBuyer.findMany({
        where: { workspace_member_id: member.id, workspace_id: workspaceId },
      });
      if (links && links.length > 0) {
        buyerIds = links.map((l: any) => l.buyer_id);
      }
    }
    if (buyerIds.length === 0 && member.buyer_id) {
      buyerIds = [member.buyer_id];
    }
    return buyerIds;
  }
}
