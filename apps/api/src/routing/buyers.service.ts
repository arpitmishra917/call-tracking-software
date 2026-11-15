import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PermissionsService } from '../permissions/permissions.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { normalizeE164 } from '../common/phone.utils.js';

@Injectable()
export class BuyersService {
  constructor(private prisma: PrismaService, private permissionsService: PermissionsService) {}

  private validateMaxConcurrentCalls(val: any): number {
    if (val === undefined || val === null || val === '') {
      throw new BadRequestException('Maximum concurrent calls (max_concurrent_calls) is required.');
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

  async listBuyers(workspaceId: string, userId: string = '', filters?: { search?: string; status?: string; limit?: number; offset?: number }) {

    const permissions = await this.permissionsService.getPermissionsForUser(workspaceId, userId);
    const readPerms = permissions.filter(p => p.key === 'buyer:read');
    if (readPerms.length === 0) throw new ForbiddenException('Missing buyer:read permission');

    const hasAll = readPerms.some(p => p.scope_type === 'ALL');
    const hasAssigned = readPerms.some(p => p.scope_type === 'ASSIGNED');
    const allowedResourceIds = readPerms.filter(p => p.resource_id).map(p => p.resource_id);

    const where: any = { workspace_id: workspaceId };

    if (!hasAll) {
      let authOrConditions: any[] = [];
      if (hasAssigned) {
        const member = await this.prisma.workspaceMember.findUnique({
          where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: userId } }
        });
        if (member) {
          let buyerIds: string[] = [];
          if (this.prisma.workspaceMemberBuyer?.findMany) {
            const links = await this.prisma.workspaceMemberBuyer.findMany({
              where: { workspace_member_id: member.id, workspace_id: workspaceId },
            });
            if (links && links.length > 0) {
              buyerIds = links.map((l: any) => l.buyer_id);
            } else if (links && links.length === 0) {
              buyerIds = [];
            } else if (member.buyer_id) {
              buyerIds = [member.buyer_id];
            }
          } else if (member.buyer_id) {
            buyerIds = [member.buyer_id];
          }

          if (buyerIds.length > 0) {
            authOrConditions.push({ id: { in: buyerIds } });
          }
        }
      }
      if (allowedResourceIds.length > 0) {
        authOrConditions.push({ id: { in: allowedResourceIds } });
      }
      if (authOrConditions.length === 0) {
        return { items: [], total: 0 };
      }
      where.AND = [{ OR: authOrConditions }];
    }
    if (filters?.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { destination_number: { contains: filters.search } }
      ];
    }
    if (filters?.status) {
      where.status = filters.status;
    }

    const [items, total] = await Promise.all([
      this.prisma.buyer.findMany({
        where,
        include: {
          destination_numbers: true,
        },
        orderBy: { created_at: 'desc' },
        skip: filters?.offset || 0,
        take: filters?.limit || 50,
      }),
      this.prisma.buyer.count({ where }),
    ]);
    return { items, total };
  }

  async getBuyer(workspaceId: string, id: string) {
    const buyer = await this.prisma.buyer.findUnique({
      where: { id, workspace_id: workspaceId },
      include: {
        destination_numbers: true,
        campaigns: {
          include: {
            campaign: true,
          },
        },
      },
    });
    if (!buyer) throw new NotFoundException('Buyer not found');
    return buyer;
  }

  async createBuyer(
    workspaceId: string,
    name: string,
    email?: string,
    destinationNumber?: string | number,
    timeout: number = 30,
    maxConcurrentCalls?: number | string | null,
  ): Promise<any> {
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new BadRequestException('Buyer Organization name is required.');
    }

    // Backward compatibility adapter for legacy signature: createBuyer(workspaceId, name, destinationNumber, timeout, maxConcurrentCalls)
    if (email && /^\+?[0-9]{7,15}$/.test(email.trim()) && typeof destinationNumber === 'number') {
      const legacyDestination = email;
      const legacyTimeout = destinationNumber;
      const legacyMaxCalls = arguments.length >= 5 ? arguments[4] : undefined;
      return this.createBuyer(
        workspaceId,
        name,
        `${name.trim().toLowerCase().replace(/[^a-z0-9]/g, '') || 'buyer'}@example.com`,
        legacyDestination,
        legacyTimeout,
        legacyMaxCalls,
      );
    }

    if (!email || typeof email !== 'string' || !email.trim()) {
      throw new BadRequestException('Buyer Organization email is required.');
    }
    const trimmedEmail = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      throw new BadRequestException('Invalid email format for Buyer Organization.');
    }

    let e164 = '';
    let validatedLimit = 1;
    if (destinationNumber) {
      const normalized = normalizeE164(String(destinationNumber));
      if (!normalized) throw new BadRequestException('Invalid destination number');
      e164 = normalized;
      validatedLimit = this.validateMaxConcurrentCalls(maxConcurrentCalls);
    } else if (maxConcurrentCalls !== undefined && maxConcurrentCalls !== null && maxConcurrentCalls !== '') {
      validatedLimit = this.validateMaxConcurrentCalls(maxConcurrentCalls);
    }

    const buyer = await this.prisma.buyer.create({
      data: {
        workspace_id: workspaceId,
        name: name.trim(),
        email: trimmedEmail,
        destination_number: e164,
        timeout: timeout || 30,
        max_concurrent_calls: validatedLimit,
        status: 'ACTIVE',
      },
    });

    if (buyer?.id && e164 && this.prisma.destinationNumber?.create) {
      await this.prisma.destinationNumber.create({
        data: {
          workspace_id: workspaceId,
          buyer_id: buyer.id,
          destination_number: e164,
          name: `${buyer.name || name} Primary`,
          timeout: timeout || 30,
          max_concurrent_calls: validatedLimit,
          status: 'ACTIVE',
        },
      });
    }

    if (buyer?.id) {
      try {
        return await this.getBuyer(workspaceId, buyer.id);
      } catch {
        return buyer;
      }
    }

    return buyer;
  }

  async updateBuyer(
    workspaceId: string,
    id: string,
    data: {
      name?: string;
      email?: string;
      destinationNumber?: string;
      timeout?: number;
      max_concurrent_calls?: number | string | null;
      maxConcurrentCalls?: number | string | null;
      status?: string;
    },
  ) {
    const buyer = await this.getBuyer(workspaceId, id);

    let e164: string | undefined;
    if (data.destinationNumber) {
      e164 = normalizeE164(data.destinationNumber);
      if (!e164) throw new BadRequestException('Invalid destination number');
    }

    let maxCalls: number | undefined;
    const rawMax =
      data.max_concurrent_calls !== undefined
        ? data.max_concurrent_calls
        : data.maxConcurrentCalls;
    if (rawMax !== undefined) {
      maxCalls = this.validateMaxConcurrentCalls(rawMax);
    }

    let validEmail: string | undefined;
    if (data.email !== undefined) {
      const trimmed = data.email.trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmed)) {
        throw new BadRequestException('Invalid email format for Buyer Organization.');
      }
      validEmail = trimmed;
    }

    return this.prisma.buyer.update({
      where: { id: buyer.id },
      data: {
        ...(data.name && { name: data.name }),
        ...(validEmail && { email: validEmail }),
        ...(e164 && { destination_number: e164 }),
        ...(data.timeout !== undefined && { timeout: data.timeout }),
        ...(maxCalls !== undefined && { max_concurrent_calls: maxCalls }),
        ...(data.status && { status: data.status }),
      },
    });
  }
}
