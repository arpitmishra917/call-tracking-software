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
import { Controller, Get, Post, Delete, Param, Body, UseGuards, } from '@nestjs/common';
import { BlockedCallersService } from '../routing/blocked-callers.service.js';
import { ApiKeyAuthGuard } from '../auth/api-key.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { WorkspaceRole } from '@prisma/client';
let PublicBlockedNumbersController = class PublicBlockedNumbersController {
    blockedCallersService;
    constructor(blockedCallersService) {
        this.blockedCallersService = blockedCallersService;
    }
    async listBlockedNumbers(workspaceId) {
        return this.blockedCallersService.listBlockedCallers(workspaceId);
    }
    async blockNumber(workspaceId, phoneNumber, reason) {
        return this.blockedCallersService.blockCaller(workspaceId, phoneNumber, reason);
    }
    async unblockNumber(workspaceId, id) {
        return this.blockedCallersService.unblockCaller(workspaceId, id);
    }
};
__decorate([
    Get(),
    RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN, WorkspaceRole.MEMBER, WorkspaceRole.VIEWER),
    __param(0, Param('workspaceId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], PublicBlockedNumbersController.prototype, "listBlockedNumbers", null);
__decorate([
    Post(),
    RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN),
    __param(0, Param('workspaceId')),
    __param(1, Body('phoneNumber')),
    __param(2, Body('reason')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", Promise)
], PublicBlockedNumbersController.prototype, "blockNumber", null);
__decorate([
    Delete(':id'),
    RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN),
    __param(0, Param('workspaceId')),
    __param(1, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], PublicBlockedNumbersController.prototype, "unblockNumber", null);
PublicBlockedNumbersController = __decorate([
    Controller('api/v1/workspaces/:workspaceId/blocked-numbers'),
    UseGuards(ApiKeyAuthGuard, WorkspaceRolesGuard),
    __metadata("design:paramtypes", [BlockedCallersService])
], PublicBlockedNumbersController);
export { PublicBlockedNumbersController };
//# sourceMappingURL=public-blocked-numbers.controller.js.map