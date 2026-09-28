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

    const workspaceId =
      request.params.workspaceId ||
      request.query.workspaceId ||
      request.body.workspaceId;

    if (!workspaceId) {
      throw new ForbiddenException(
        'Workspace ID is required for authorization',
      );
    }

    const role = await this.authorizationService.validateWorkspaceAccess(
      user.userId,
      workspaceId,
      requiredRoles,
      request.method,
      request.url,
    );

    request.workspaceRole = role;

    return true;
  }
}
