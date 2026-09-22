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
import { Controller, Get, Param, Query, UseGuards, } from '@nestjs/common';
import { CallsService } from './calls.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { CallState } from '@prisma/client';
let CallsController = class CallsController {
    callsService;
    constructor(callsService) {
        this.callsService = callsService;
    }
    async getCalls(workspaceId, campaignId, buyerId, status, callerNumber, startDate, endDate, limit, offset) {
        return this.callsService.getCalls(workspaceId, {
            campaignId,
            buyerId,
            status,
            callerNumber,
            startDate,
            endDate,
            limit: limit ? parseInt(limit, 10) : undefined,
            offset: offset ? parseInt(offset, 10) : undefined,
        });
    }
    async getMetrics(workspaceId, startDate, endDate) {
        return this.callsService.getMetrics(workspaceId, { startDate, endDate });
    }
    async getCallDetail(workspaceId, callId) {
        return this.callsService.getCallDetail(workspaceId, callId);
    }
};
__decorate([
    Get(),
    __param(0, Param('workspaceId')),
    __param(1, Query('campaignId')),
    __param(2, Query('buyerId')),
    __param(3, Query('status')),
    __param(4, Query('callerNumber')),
    __param(5, Query('startDate')),
    __param(6, Query('endDate')),
    __param(7, Query('limit')),
    __param(8, Query('offset')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, String, String, String, String, String]),
    __metadata("design:returntype", Promise)
], CallsController.prototype, "getCalls", null);
__decorate([
    Get('metrics'),
    __param(0, Param('workspaceId')),
    __param(1, Query('startDate')),
    __param(2, Query('endDate')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", Promise)
], CallsController.prototype, "getMetrics", null);
__decorate([
    Get(':callId'),
    __param(0, Param('workspaceId')),
    __param(1, Param('callId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], CallsController.prototype, "getCallDetail", null);
CallsController = __decorate([
    Controller('workspaces/:workspaceId/calls'),
    UseGuards(JwtAuthGuard, WorkspaceRolesGuard),
    __metadata("design:paramtypes", [CallsService])
], CallsController);
export { CallsController };
//# sourceMappingURL=calls.controller.js.map