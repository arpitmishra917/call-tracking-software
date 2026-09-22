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
import { Controller, Get, Param, UseGuards, Inject, forwardRef, NotFoundException, } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TELEPHONY_PROVIDER } from './call-controller.js';
let RecordingsController = class RecordingsController {
    prisma;
    telephonyProvider;
    constructor(prisma, telephonyProvider) {
        this.prisma = prisma;
        this.telephonyProvider = telephonyProvider;
    }
    async getRecordingUrl(workspaceId, recordingId) {
        const recording = await this.prisma.recording.findUnique({
            where: { id: recordingId },
        });
        if (!recording || recording.workspace_id !== workspaceId) {
            throw new NotFoundException('Recording not found');
        }
        const url = await this.telephonyProvider.getRecordingUrl(recording.provider_id);
        return { url };
    }
};
__decorate([
    Get(':recordingId/download'),
    RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN, WorkspaceRole.MEMBER, WorkspaceRole.VIEWER),
    __param(0, Param('workspaceId')),
    __param(1, Param('recordingId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], RecordingsController.prototype, "getRecordingUrl", null);
RecordingsController = __decorate([
    Controller('workspaces/:workspaceId/recordings'),
    UseGuards(JwtAuthGuard, WorkspaceRolesGuard),
    __param(1, Inject(forwardRef(() => TELEPHONY_PROVIDER))),
    __metadata("design:paramtypes", [PrismaService, Object])
], RecordingsController);
export { RecordingsController };
//# sourceMappingURL=recordings.controller.js.map