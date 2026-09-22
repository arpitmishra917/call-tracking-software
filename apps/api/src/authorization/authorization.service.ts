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
  ) {
    const role = await this.getUserWorkspaceRole(userId, workspaceId);
    if (!role) {
      throw new ForbiddenException('You do not have access to this workspace');
    }

    if (allowedRoles && allowedRoles.length > 0) {
      if (!this.hasPermission(role, allowedRoles)) {
        throw new ForbiddenException(
          'Insufficient permissions for this workspace',
        );
      }
    }

    return role;
  }
}
