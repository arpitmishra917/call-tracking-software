var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Injectable, ForbiddenException, UnauthorizedException, } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WORKSPACE_ROLES_KEY } from './workspace-roles.decorator.js';
import { AuthorizationService } from './authorization.service.js';
let WorkspaceRolesGuard = class WorkspaceRolesGuard {
    reflector;
    authorizationService;
    constructor(reflector, authorizationService) {
        this.reflector = reflector;
        this.authorizationService = authorizationService;
    }
    async canActivate(context) {
        const requiredRoles = this.reflector.getAllAndOverride(WORKSPACE_ROLES_KEY, [context.getHandler(), context.getClass()]);
        const request = context.switchToHttp().getRequest();
        const user = request.user;
        if (!user || !user.userId) {
            throw new UnauthorizedException('Authentication required');
        }
        const workspaceId = request.params.workspaceId ||
            request.query.workspaceId ||
            request.body.workspaceId;
        if (!workspaceId) {
            throw new ForbiddenException('Workspace ID is required for authorization');
        }
        const role = await this.authorizationService.validateWorkspaceAccess(user.userId, workspaceId, requiredRoles);
        request.workspaceRole = role;
        return true;
    }
};
WorkspaceRolesGuard = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [Reflector,
        AuthorizationService])
], WorkspaceRolesGuard);
export { WorkspaceRolesGuard };
//# sourceMappingURL=workspace-roles.guard.js.map