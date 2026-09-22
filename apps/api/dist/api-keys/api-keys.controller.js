var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { Controller, Get, Post, Delete, Param, Body, UseGuards, Req, } from '@nestjs/common';
import { ApiKeysService } from './api-keys.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { WorkspaceRole } from '@prisma/client';
let ApiKeysController = class ApiKeysController {
    apiKeysService;
    constructor(apiKeysService) {
        this.apiKeysService = apiKeysService;
    }
    async listKeys(workspaceId) {
        return this.apiKeysService.listApiKeys(workspaceId);
    }
    async createKey(workspaceId, name, req) {
        return this.apiKeysService.createApiKey(workspaceId, req.user.userId, name);
    }
    async revokeKey(workspaceId, id) {
        return this.apiKeysService.revokeApiKey(workspaceId, id);
    }
};
__decorate([
    Get(),
    RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN),
    __param(0, Param('workspaceId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ApiKeysController.prototype, "listKeys", null);
__decorate([
    Post(),
    RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN),
    __param(0, Param('workspaceId')),
    __param(1, Body('name')),
    __param(2, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", Promise)
], ApiKeysController.prototype, "createKey", null);
__decorate([
    Delete(':id'),
    RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN),
    __param(0, Param('workspaceId')),
    __param(1, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], ApiKeysController.prototype, "revokeKey", null);
ApiKeysController = __decorate([
    Controller('workspaces/:workspaceId/api-keys'),
    UseGuards(JwtAuthGuard, WorkspaceRolesGuard),
    __metadata("design:paramtypes", [ApiKeysService])
], ApiKeysController);
export { ApiKeysController };
//# sourceMappingURL=api-keys.controller.js.map