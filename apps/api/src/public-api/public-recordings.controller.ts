import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Inject,
  NotFoundException,
  ForbiddenException,
  Req,
} from '@nestjs/common';
import { ApiKeyAuthGuard } from '../auth/api-key.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { isCallAuthorizedForVendor } from '../calls/call-authorization.util.js';
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
  async listRecordings(
    @Param('workspaceId') workspaceId: string,
    @Req() req: any,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const where: any = { workspace_id: workspaceId };

    if (req?.user?.userId) {
      const member = await this.prisma.workspaceMember.findUnique({
        where: {
          workspace_id_user_id: {
            workspace_id: workspaceId,
            user_id: req.user.userId,
          },
        },
      });

      if (member?.participant_type === 'VENDOR') {
        if (!member.vendor_id) return [];
        where.call = {
          workspace_id: workspaceId,
          OR: [
            {
              attribution_source: 'INGRESS_ASSIGNED',
              attributed_vendor_id: member.vendor_id,
            },
            {
              attribution_source: 'LEGACY_COMMERCIAL',
              commercial: { vendor_id: member.vendor_id },
            },
          ],
        };
      } else if (member?.participant_type === 'BUYER') {
        if (!member.buyer_id) return [];
        where.call = { commercial: { buyer_id: member.buyer_id } };
      }
    }

    const take = limit ? Math.min(100, Math.max(1, parseInt(limit, 10))) : 50;
    const skip = offset !== undefined ? Math.max(0, parseInt(offset, 10)) : undefined;

    return this.prisma.recording.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take,
      ...(skip !== undefined ? { skip } : {}),
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
    @Req() req: any,
  ) {
    const recording = await this.prisma.recording.findUnique({
      where: { id },
      include: { call: { include: { commercial: true } } },
    });

    if (!recording || recording.workspace_id !== workspaceId) {
      throw new NotFoundException('Recording not found');
    }

    if (req?.user?.userId) {
      const member = await this.prisma.workspaceMember.findUnique({
        where: {
          workspace_id_user_id: {
            workspace_id: workspaceId,
            user_id: req.user.userId,
          },
        },
      });

      if (member?.participant_type === 'VENDOR') {
        if (!member.vendor_id || !isCallAuthorizedForVendor(recording.call, workspaceId, member.vendor_id)) {
          throw new ForbiddenException('Access denied to recording');
        }
      } else if (member?.participant_type === 'BUYER') {
        if (!member.buyer_id || recording.call?.commercial?.buyer_id !== member.buyer_id) {
          throw new ForbiddenException('Access denied to recording');
        }
      }
    }

    const url = await this.telephonyProvider.getRecordingUrl(
      recording.provider_id,
    );
    const { call, ...recordingData } = recording;
    return { ...recordingData, url };
  }
}
