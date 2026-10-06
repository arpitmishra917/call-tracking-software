import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface AuditLogCreateInput {
  workspaceId: string;
  actorUserId?: string;
  actorMemberId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: any;
}

@Injectable()
export class AuditLogsService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async logAction(input: AuditLogCreateInput) {
    const { metadata, ...rest } = input;
    // Strip sensitive fields from metadata if any exist just in case
    let safeMetadata = metadata;
    if (metadata && typeof metadata === 'object') {
      safeMetadata = { ...metadata };
      const sensitiveKeys = ['password', 'token', 'secret', 'key', 'jwt', 'stripe'];
      for (const key of Object.keys(safeMetadata)) {
        if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk) && key.toLowerCase() !== 'permissionkey')) {
          safeMetadata[key] = '[REDACTED]';
        }
      }
    }

    return this.prisma.securityAuditLog.create({
      data: {
        workspace_id: rest.workspaceId,
        actor_user_id: rest.actorUserId,
        actor_member_id: rest.actorMemberId,
        action: rest.action,
        target_type: rest.targetType,
        target_id: rest.targetId,
        metadata: safeMetadata ? safeMetadata : undefined,
      },
    });
  }

  async getAuditLogs(workspaceId: string, userId: string, filters: any = {}) {
    const where: any = { workspace_id: workspaceId };

    if (filters.action) {
      where.action = filters.action;
    }
    if (filters.targetType) {
      where.target_type = filters.targetType;
    }
    if (filters.targetId) {
      where.target_id = filters.targetId;
    }
    if (filters.actorMemberId) {
      where.actor_member_id = filters.actorMemberId;
    }
    if (filters.startDate || filters.endDate) {
      where.created_at = {};
      if (filters.startDate) where.created_at.gte = new Date(filters.startDate);
      if (filters.endDate) where.created_at.lte = new Date(filters.endDate);
    }

    const limit = parseInt(filters.limit, 10) || 50;
    const offset = parseInt(filters.offset, 10) || 0;
    const safeLimit = Math.min(limit, 100);

    const [items, total] = await Promise.all([
      this.prisma.securityAuditLog.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: safeLimit,
        skip: offset,
      }),
      this.prisma.securityAuditLog.count({ where }),
    ]);

    return { items, total };
  }
}
