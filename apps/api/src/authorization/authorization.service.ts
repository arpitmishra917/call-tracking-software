import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { WorkspaceRole } from '@prisma/client';

@Injectable()
export class AuthorizationService {
  constructor(private prisma: PrismaService) {}

  async getUserWorkspaceRole(
    userId: string,
    workspaceId: string,
  ): Promise<WorkspaceRole | null> {
    const membership = await this.prisma.workspaceMember.findUnique({
      where: {
        workspace_id_user_id: {
          workspace_id: workspaceId,
          user_id: userId,
        },
      },
    });

    return membership ? membership.role : null;
  }

  hasPermission(
    userRole: WorkspaceRole,
    allowedRoles: WorkspaceRole[],
  ): boolean {
    return allowedRoles.includes(userRole);
  }

  async validateWorkspaceAccess(
    userId: string,
    workspaceId: string,
    allowedRoles?: WorkspaceRole[],
    method?: string,
    url?: string,
  ) {
    const membership = await this.prisma.workspaceMember.findUnique({
      where: {
        workspace_id_user_id: {
          workspace_id: workspaceId,
          user_id: userId,
        },
      },
      include: { workspace: true }
    });

    if (!membership) {
      throw new ForbiddenException('You do not have access to this workspace');
    }

    if (allowedRoles && allowedRoles.length > 0) {
      if (!this.hasPermission(membership.role, allowedRoles)) {
        throw new ForbiddenException(
          'Insufficient permissions for this workspace',
        );
      }
    }

    // Lifecycle enforcement: Block operational mutations if not ACTIVE
    if (membership.workspace.status !== 'ACTIVE' && method && method !== 'GET') {
      // Allow modifying the workspace status itself (for restoration)
      // Usually looks like /workspaces/:id/status
      if (url && url.match(/\/workspaces\/[^\/]+\/status$/)) {
        // Allowed
      } else {
        throw new ForbiddenException(`Operational actions are blocked because workspace is ${membership.workspace.status}`);
      }
    }

    return membership.role;
  }
}
