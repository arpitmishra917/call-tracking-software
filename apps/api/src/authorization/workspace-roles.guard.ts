import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WorkspaceRole } from '@prisma/client';
import { WORKSPACE_ROLES_KEY } from './workspace-roles.decorator.js';
import { AuthorizationService } from './authorization.service.js';

@Injectable()
export class WorkspaceRolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private authorizationService: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<WorkspaceRole[]>(
      WORKSPACE_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.userId) {
      throw new UnauthorizedException('Authentication required');
    }

    // Try to extract workspaceId from params, query, or body
    const workspaceId =
      request.params.workspaceId ||
      request.query.workspaceId ||
      request.body.workspaceId;

    if (!workspaceId) {
      // If there is no workspaceId in the request, we cannot validate workspace access.
      // We'll deny access to be safe for any endpoint guarded by this.
      throw new ForbiddenException(
        'Workspace ID is required for authorization',
      );
    }

    // This will throw ForbiddenException if user is not a member or lacks role
    const role = await this.authorizationService.validateWorkspaceAccess(
      user.userId,
      workspaceId,
      requiredRoles,
    );

    // Attach the resolved role to the request for convenience in controllers
    request.workspaceRole = role;

    return true;
  }
}
