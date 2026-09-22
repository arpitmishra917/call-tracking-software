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
import { Controller, Get, Param, UseGuards, Inject, NotFoundException, } from '@nestjs/common';
import { ApiKeyAuthGuard } from '../auth/api-key.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TELEPHONY_PROVIDER } from '../telephony/call-controller.js';
let PublicRecordingsController = class PublicRecordingsController {
    prisma;
    telephonyProvider;
    constructor(prisma, telephonyProvider) {
        this.prisma = prisma;
        this.telephonyProvider = telephonyProvider;
    }
    async listRecordings(workspaceId) {
        return this.prisma.recording.findMany({
            where: { workspace_id: workspaceId },
            orderBy: { created_at: 'desc' },
            take: 50,
        });
    }
    async getRecording(workspaceId, id) {
        const recording = await this.prisma.recording.findUnique({
            where: { id },
        });
        if (!recording || recording.workspace_id !== workspaceId) {
            throw new NotFoundException('Recording not found');
        }
        const url = await this.telephonyProvider.getRecordingUrl(recording.provider_id);
        return { ...recording, url };
    }
};
__decorate([
    Get(),
    RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN, WorkspaceRole.MEMBER, WorkspaceRole.VIEWER),
    __param(0, Param('workspaceId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], PublicRecordingsController.prototype, "listRecordings", null);
__decorate([
    Get(':id'),
    RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN, WorkspaceRole.MEMBER, WorkspaceRole.VIEWER),
    __param(0, Param('workspaceId')),
    __param(1, Param('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], PublicRecordingsController.prototype, "getRecording", null);
PublicRecordingsController = __decorate([
    Controller('api/v1/workspaces/:workspaceId/recordings'),
    UseGuards(ApiKeyAuthGuard, WorkspaceRolesGuard),
    __param(1, Inject(TELEPHONY_PROVIDER)),
    __metadata("design:paramtypes", [PrismaService, Object])
], PublicRecordingsController);
export { PublicRecordingsController };
//# sourceMappingURL=public-recordings.controller.js.map