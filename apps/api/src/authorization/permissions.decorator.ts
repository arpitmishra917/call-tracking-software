import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PERMISSION_KEY = 'require_permission';
export const RequirePermission = (permission: string) =>
  SetMetadata(REQUIRE_PERMISSION_KEY, permission);

export const REQUIRE_RESOURCE_SCOPE_KEY = 'require_resource_scope';
export const RequireResourceScope = (resourceType: string, idParam: string) =>
  SetMetadata(REQUIRE_RESOURCE_SCOPE_KEY, { resourceType, idParam });
