import {
  Controller,
  Get,
  Param,
  UseGuards,
  Inject,
  forwardRef,
  NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { RequirePermission, RequireResourceScope } from '../authorization/permissions.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { TelephonyProvider } from './telephony.provider.js';
import { TELEPHONY_PROVIDER } from './call-controller.js';

@Controller('workspaces/:workspaceId/recordings')
@UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard)
export class RecordingsController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => TELEPHONY_PROVIDER))
    private readonly telephonyProvider: TelephonyProvider,
  ) {}

  @Get(':recordingId/download')
  @RequirePermission('call:recording_read')
  @RequireResourceScope('recording', 'recordingId')
  async getRecordingUrl(
    @Param('workspaceId') workspaceId: string,
    @Param('recordingId') recordingId: string,
  ) {
    const recording = await this.prisma.recording.findUnique({
      where: { id: recordingId },
    });

    if (!recording || recording.workspace_id !== workspaceId) {
      throw new NotFoundException('Recording not found');
    }

    const url = await this.telephonyProvider.getRecordingUrl(
      recording.provider_id,
    );
    return { url };
  }
}
