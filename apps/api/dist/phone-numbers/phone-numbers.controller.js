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
import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards, } from '@nestjs/common';
import { PhoneNumbersService } from './phone-numbers.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { WorkspaceRole } from '@prisma/client';
let PhoneNumbersController = class PhoneNumbersController {
    phoneNumbersService;
    constructor(phoneNumbersService) {
        this.phoneNumbersService = phoneNumbersService;
    }
    async listNumbers(workspaceId) {
        return this.phoneNumbersService.listWorkspaceNumbers(workspaceId);
    }
    async searchNumbers(workspaceId, countryCode, limit) {
        const limitNum = limit ? parseInt(limit, 10) : 5;
        return this.phoneNumbersService.searchAvailableNumbers(countryCode || 'US', limitNum);
    }
    async provisionNumber(workspaceId, phoneNumber, name) {
        return this.phoneNumbersService.provisionNumber(workspaceId, phoneNumber, name);
    }
    async updateNumber(workspaceId, id, name) {
        return this.phoneNumbersService.updateNumber(workspaceId, id, name);
    }
    async releaseNumber(workspaceId, id) {
        return this.phoneNumbersService.releaseNumber(workspaceId, id);
    }
};
__decorate([
    Get(),
    RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN, WorkspaceRole.MEMBER, WorkspaceRole.VIEWER),
    __param(0, Param('workspaceId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], PhoneNumbersController.prototype, "listNumbers", null);
__decorate([
    Get('search'),
    RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN),
    __param(0, Param('workspaceId')),
    __param(1, Query('countryCode')),
    __param(2, Query('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", Promise)
], PhoneNumbersController.prototype, "searchNumbers", null);
__decorate([
    Post(),
    RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN),
    __param(0, Param('workspaceId')),
    __param(1, Body('phoneNumber')),
    __param(2, Body('name')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", Promise)
], PhoneNumbersController.prototype, "provisionNumber", null);
__decorate([
    Put(':id'),
    RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN),
    __param(0, Param('workspaceId')),
    __param(1, Param('id')),
    __param(2, Body('name')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", Promise)
], PhoneNumbersController.prototype, "updateNumber", null);
__decorate([
    Delete(':id'),
    RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN),
    __param(0, Param('workspaceId')),
    __param(1, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], PhoneNumbersController.prototype, "releaseNumber", null);
PhoneNumbersController = __decorate([
    Controller('workspaces/:workspaceId/phone-numbers'),
    UseGuards(JwtAuthGuard, WorkspaceRolesGuard),
    __metadata("design:paramtypes", [PhoneNumbersService])
], PhoneNumbersController);
export { PhoneNumbersController };
//# sourceMappingURL=phone-numbers.controller.js.map