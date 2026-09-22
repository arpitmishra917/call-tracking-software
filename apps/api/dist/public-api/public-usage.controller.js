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
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiKeyAuthGuard } from '../auth/api-key.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { WorkspaceRole } from '@prisma/client';
import { BillingService } from '../billing/billing.service.js';
let PublicUsageController = class PublicUsageController {
    billingService;
    constructor(billingService) {
        this.billingService = billingService;
    }
    async getUsage(workspaceId) {
        const billingState = await this.billingService.getBillingState(workspaceId);
        return billingState.usage;
    }
};
__decorate([
    Get(),
    RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN),
    __param(0, Param('workspaceId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], PublicUsageController.prototype, "getUsage", null);
PublicUsageController = __decorate([
    Controller('api/v1/workspaces/:workspaceId/usage'),
    UseGuards(ApiKeyAuthGuard, WorkspaceRolesGuard),
    __metadata("design:paramtypes", [BillingService])
], PublicUsageController);
export { PublicUsageController };
//# sourceMappingURL=public-usage.controller.js.map