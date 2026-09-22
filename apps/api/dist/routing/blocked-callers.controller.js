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
import { BlockedCallersService } from './blocked-callers.service.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { WorkspaceRole } from '@prisma/client';
let BlockedCallersController = class BlockedCallersController {
    blockedCallersService;
    constructor(blockedCallersService) {
        this.blockedCallersService = blockedCallersService;
    }
    list(workspaceId) {
        return this.blockedCallersService.listBlockedCallers(workspaceId);
    }
    block(workspaceId, body) {
        return this.blockedCallersService.blockCaller(workspaceId, body.phoneNumber, body.reason);
    }
    unblock(workspaceId, id) {
        return this.blockedCallersService.unblockCaller(workspaceId, id);
    }
};
__decorate([
    Get(),
    __param(0, Param('workspaceId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], BlockedCallersController.prototype, "list", null);
__decorate([
    Post(),
    __param(0, Param('workspaceId')),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], BlockedCallersController.prototype, "block", null);
__decorate([
    Delete(':id'),
    __param(0, Param('workspaceId')),
    __param(1, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], BlockedCallersController.prototype, "unblock", null);
BlockedCallersController = __decorate([
    Controller('workspaces/:workspaceId/blocked-callers'),
    UseGuards(WorkspaceRolesGuard),
    RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN),
    __metadata("design:paramtypes", [BlockedCallersService])
], BlockedCallersController);
export { BlockedCallersController };
//# sourceMappingURL=blocked-callers.controller.js.map