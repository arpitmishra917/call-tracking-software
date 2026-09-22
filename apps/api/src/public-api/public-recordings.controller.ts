import {
  Controller,
  Get,
  Param,
  UseGuards,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { ApiKeyAuthGuard } from '../auth/api-key.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TELEPHONY_PROVIDER } from '../telephony/call-controller.js';
import type { TelephonyProvider } from '../telephony/telephony.provider.js';

@Controller('api/v1/workspaces/:workspaceId/recordings')
@UseGuards(ApiKeyAuthGuard, WorkspaceRolesGuard)
export class PublicRecordingsController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(TELEPHONY_PROVIDER)
    private readonly telephonyProvider: TelephonyProvider,
  ) {}

  @Get()
  @RequireWorkspaceRoles(
    WorkspaceRole.OWNER,
    WorkspaceRole.ADMIN,
    WorkspaceRole.MEMBER,
    WorkspaceRole.VIEWER,
  )
  async listRecordings(@Param('workspaceId') workspaceId: string) {
    return this.prisma.recording.findMany({
      where: { workspace_id: workspaceId },
      orderBy: { created_at: 'desc' },
      take: 50,
    });
  }

  @Get(':id')
  @RequireWorkspaceRoles(
    WorkspaceRole.OWNER,
    WorkspaceRole.ADMIN,
    WorkspaceRole.MEMBER,
    WorkspaceRole.VIEWER,
  )
  async getRecording(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
  ) {
    const recording = await this.prisma.recording.findUnique({
      where: { id },
    });

    if (!recording || recording.workspace_id !== workspaceId) {
      throw new NotFoundException('Recording not found');
    }

    const url = await this.telephonyProvider.getRecordingUrl(
      recording.provider_id,
    );
    return { ...recording, url };
  }
}
