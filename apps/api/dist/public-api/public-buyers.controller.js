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
import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { BuyersService } from '../routing/buyers.service.js';
import { ApiKeyAuthGuard } from '../auth/api-key.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { WorkspaceRole } from '@prisma/client';
let PublicBuyersController = class PublicBuyersController {
    buyersService;
    constructor(buyersService) {
        this.buyersService = buyersService;
    }
    async listBuyers(workspaceId) {
        return this.buyersService.listBuyers(workspaceId);
    }
    async getBuyer(workspaceId, id) {
        return this.buyersService.getBuyer(workspaceId, id);
    }
    async createBuyer(workspaceId, name, destinationNumberE164, timeout) {
        return this.buyersService.createBuyer(workspaceId, name, destinationNumberE164, timeout);
    }
};
__decorate([
    Get(),
    RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN, WorkspaceRole.MEMBER, WorkspaceRole.VIEWER),
    __param(0, Param('workspaceId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], PublicBuyersController.prototype, "listBuyers", null);
__decorate([
    Get(':id'),
    RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN, WorkspaceRole.MEMBER, WorkspaceRole.VIEWER),
    __param(0, Param('workspaceId')),
    __param(1, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], PublicBuyersController.prototype, "getBuyer", null);
__decorate([
    Post(),
    RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN),
    __param(0, Param('workspaceId')),
    __param(1, Body('name')),
    __param(2, Body('destinationNumberE164')),
    __param(3, Body('timeout')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, Number]),
    __metadata("design:returntype", Promise)
], PublicBuyersController.prototype, "createBuyer", null);
PublicBuyersController = __decorate([
    Controller('api/v1/workspaces/:workspaceId/buyers'),
    UseGuards(ApiKeyAuthGuard, WorkspaceRolesGuard),
    __metadata("design:paramtypes", [BuyersService])
], PublicBuyersController);
export { PublicBuyersController };
//# sourceMappingURL=public-buyers.controller.js.map