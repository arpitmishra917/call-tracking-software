import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsService } from '../permissions/permissions.service.js';
import {
  REQUIRE_PERMISSION_KEY,
  REQUIRE_RESOURCE_SCOPE_KEY,
} from './permissions.decorator.js';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private permissionsService: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermission = this.reflector.getAllAndOverride<string>(
      REQUIRE_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermission) {
      return true;
    }

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
        'Workspace ID is required for permission check',
      );
    }

    const scopeMetadata = this.reflector.getAllAndOverride<{
      resourceType: string;
      idParam: string;
    }>(REQUIRE_RESOURCE_SCOPE_KEY, [context.getHandler(), context.getClass()]);

    if (scopeMetadata) {
      const resourceId =
        request.params[scopeMetadata.idParam] ||
        request.query[scopeMetadata.idParam] ||
        request.body[scopeMetadata.idParam];

      if (!resourceId) {
        throw new ForbiddenException('Resource ID missing for scope check');
      }

      const hasScope = await this.permissionsService.hasResourceScope(
        workspaceId,
        user.userId,
        requiredPermission,
        resourceId,
      );

      if (!hasScope) {
        throw new ForbiddenException('Insufficient resource scope');
      }

      return true;
    }

    const hasPerm = await this.permissionsService.hasPermission(
      workspaceId,
      user.userId,
      requiredPermission,
    );

    if (!hasPerm) {
      throw new ForbiddenException('Insufficient permission');
    }

    return true;
  }
}
