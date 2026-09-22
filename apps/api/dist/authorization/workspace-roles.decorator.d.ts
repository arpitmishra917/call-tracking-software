import { WorkspaceRole } from '@prisma/client';
export declare const WORKSPACE_ROLES_KEY = "workspace_roles";
export declare const RequireWorkspaceRoles: (...roles: WorkspaceRole[]) => import("@nestjs/common").CustomDecorator<string>;
