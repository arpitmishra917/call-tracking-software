var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Injectable, ForbiddenException, } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
let AuthorizationService = class AuthorizationService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getUserWorkspaceRole(userId, workspaceId) {
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
    hasPermission(userRole, allowedRoles) {
        return allowedRoles.includes(userRole);
    }
    async validateWorkspaceAccess(userId, workspaceId, allowedRoles) {
        const role = await this.getUserWorkspaceRole(userId, workspaceId);
        if (!role) {
            throw new ForbiddenException('You do not have access to this workspace');
        }
        if (allowedRoles && allowedRoles.length > 0) {
            if (!this.hasPermission(role, allowedRoles)) {
                throw new ForbiddenException('Insufficient permissions for this workspace');
            }
        }
        return role;
    }
};
AuthorizationService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [PrismaService])
], AuthorizationService);
export { AuthorizationService };
//# sourceMappingURL=authorization.service.js.map