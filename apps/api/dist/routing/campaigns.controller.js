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
import { Controller, Get, Post, Param, Body, UseGuards, } from '@nestjs/common';
import { CampaignsService } from './campaigns.service.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { WorkspaceRole } from '@prisma/client';
let CampaignsController = class CampaignsController {
    campaignsService;
    constructor(campaignsService) {
        this.campaignsService = campaignsService;
    }
    list(workspaceId) {
        return this.campaignsService.listCampaigns(workspaceId);
    }
    get(workspaceId, id) {
        return this.campaignsService.getCampaign(workspaceId, id);
    }
    create(workspaceId, name) {
        return this.campaignsService.createCampaign(workspaceId, name);
    }
    assignPhoneNumber(workspaceId, id, phoneNumberId) {
        return this.campaignsService.assignPhoneNumber(workspaceId, id, phoneNumberId);
    }
    addBuyer(workspaceId, id, body) {
        return this.campaignsService.addBuyerToCampaign(workspaceId, id, body.buyerId, body.priority);
    }
};
__decorate([
    Get(),
    __param(0, Param('workspaceId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CampaignsController.prototype, "list", null);
__decorate([
    Get(':id'),
    __param(0, Param('workspaceId')),
    __param(1, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], CampaignsController.prototype, "get", null);
__decorate([
    Post(),
    __param(0, Param('workspaceId')),
    __param(1, Body('name')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], CampaignsController.prototype, "create", null);
__decorate([
    Post(':id/phone-numbers'),
    __param(0, Param('workspaceId')),
    __param(1, Param('id')),
    __param(2, Body('phoneNumberId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", void 0)
], CampaignsController.prototype, "assignPhoneNumber", null);
__decorate([
    Post(':id/buyers'),
    __param(0, Param('workspaceId')),
    __param(1, Param('id')),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", void 0)
], CampaignsController.prototype, "addBuyer", null);
CampaignsController = __decorate([
    Controller('workspaces/:workspaceId/campaigns'),
    UseGuards(WorkspaceRolesGuard),
    RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN),
    __metadata("design:paramtypes", [CampaignsService])
], CampaignsController);
export { CampaignsController };
//# sourceMappingURL=campaigns.controller.js.map