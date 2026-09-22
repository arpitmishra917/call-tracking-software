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
import { BuyersService } from './buyers.service.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { WorkspaceRole } from '@prisma/client';
let BuyersController = class BuyersController {
    buyersService;
    constructor(buyersService) {
        this.buyersService = buyersService;
    }
    list(workspaceId) {
        return this.buyersService.listBuyers(workspaceId);
    }
    get(workspaceId, id) {
        return this.buyersService.getBuyer(workspaceId, id);
    }
    create(workspaceId, body) {
        return this.buyersService.createBuyer(workspaceId, body.name, body.destinationNumber, body.timeout);
    }
};
__decorate([
    Get(),
    __param(0, Param('workspaceId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], BuyersController.prototype, "list", null);
__decorate([
    Get(':id'),
    __param(0, Param('workspaceId')),
    __param(1, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], BuyersController.prototype, "get", null);
__decorate([
    Post(),
    __param(0, Param('workspaceId')),
    __param(1, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], BuyersController.prototype, "create", null);
BuyersController = __decorate([
    Controller('workspaces/:workspaceId/buyers'),
    UseGuards(WorkspaceRolesGuard),
    RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN),
    __metadata("design:paramtypes", [BuyersService])
], BuyersController);
export { BuyersController };
//# sourceMappingURL=buyers.controller.js.map