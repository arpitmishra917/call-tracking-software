import { SetMetadata } from '@nestjs/common';
export const WORKSPACE_ROLES_KEY = 'workspace_roles';
export const RequireWorkspaceRoles = (...roles) => SetMetadata(WORKSPACE_ROLES_KEY, roles);
//# sourceMappingURL=workspace-roles.decorator.js.map