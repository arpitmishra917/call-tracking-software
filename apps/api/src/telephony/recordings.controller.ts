import {
  Controller,
  Get,
  Param,
  UseGuards,
  Inject,
  forwardRef,
  NotFoundException,
  ForbiddenException,
  Req,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { RequirePermission, RequireResourceScope } from '../authorization/permissions.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { isCallAuthorizedForVendor } from '../calls/call-authorization.util.js';
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
    @Req() req?: any,
  ) {
    const recording = await this.prisma.recording.findUnique({
      where: { id: recordingId },
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

      if (member?.participant_type === 'BUYER') {
        if (!recording.call?.commercial || recording.call.commercial.buyer_id !== member.buyer_id) {
          throw new ForbiddenException('Access denied to recording');
        }
      } else if (member?.participant_type === 'VENDOR') {
        if (!member.vendor_id || !isCallAuthorizedForVendor(recording.call, workspaceId, member.vendor_id)) {
          throw new ForbiddenException('Access denied to recording');
        }
      }
    }

    let url: string | null = null;
    try {
      url = await this.telephonyProvider.getRecordingUrl(
        recording.provider_id,
      );
    } catch (err: any) {
      if (recording.recording_url) {
        url = recording.recording_url;
      } else {
        throw err;
      }
    }

    if ((!url || url.includes('mock.recording.url')) && recording.recording_url) {
      url = recording.recording_url;
    }

    return { url };
  }
}
