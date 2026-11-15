import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  BadRequestException,
  Request,
} from '@nestjs/common';
import { CallsService } from './calls.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { RequirePermission, RequireResourceScope } from '../authorization/permissions.decorator.js';
import { CallState } from '@prisma/client';

@Controller('workspaces/:workspaceId/calls')
@UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard)
@RequirePermission('call:read')
export class CallsController {
  constructor(private readonly callsService: CallsService) {}

  @Get()
  async getCalls(
    @Param('workspaceId') workspaceId: string,
    @Request() req: any,
    @Query('campaignId') campaignId?: string,
    @Query('buyerId') buyerId?: string,
    @Query('vendorId') vendorId?: string,
    @Query('status') status?: CallState,
    @Query('callerNumber') callerNumber?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('trackingNumber') trackingNumber?: string,
    @Query('durationType') durationType?: 'talk' | 'total',
    @Query('minDurationSecs') minDurationSecs?: string,
    @Query('maxDurationSecs') maxDurationSecs?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {

    const min = minDurationSecs ? parseInt(minDurationSecs, 10) : undefined;
    const max = maxDurationSecs ? parseInt(maxDurationSecs, 10) : undefined;

    if (minDurationSecs || maxDurationSecs) {
      if (!durationType) {
        throw new BadRequestException('durationType is REQUIRED when min/max duration filtering is supplied.');
      }
    }
    
    if (durationType && durationType !== 'talk' && durationType !== 'total') {
      throw new BadRequestException('Invalid durationType. Allowed values: talk, total');
    }

    if (min !== undefined && (isNaN(min) || min < 0)) {
      throw new BadRequestException('minDurationSecs must be an integer >= 0');
    }
    if (max !== undefined && (isNaN(max) || max < 0)) {
      throw new BadRequestException('maxDurationSecs must be an integer >= 0');
    }
    if (min !== undefined && max !== undefined && min > max) {
      throw new BadRequestException('minDurationSecs cannot be greater than maxDurationSecs');
    }

    return this.callsService.getCalls(workspaceId, req?.user?.userId || '', {
      campaignId,
      buyerId,
      status,
      callerNumber,
      trackingNumber,
      durationType,
      minDurationSecs: min,
      maxDurationSecs: max,
      startDate,
      endDate,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get('metrics')
  async getMetrics(
    @Param('workspaceId') workspaceId: string,
    @Request() req: any,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('campaignId') campaignId?: string,
    @Query('buyerId') buyerId?: string,
    @Query('vendorId') vendorId?: string,
    @Query('trackingNumber') trackingNumber?: string,
    @Query('callerNumber') callerNumber?: string,
    @Query('status') status?: string,
    @Query('minDuration') minDuration?: string,
    @Query('maxDuration') maxDuration?: string,
    @Query('bucket') bucket?: string,
  ) {
    return this.callsService.getMetrics(workspaceId, req.user.userId, {
      startDate, endDate, campaignId, buyerId, vendorId, trackingNumber, callerNumber, status, minDuration, maxDuration, bucket
    });
  }


  @Get('live-calls')
  async getLiveCalls(
    @Param('workspaceId') workspaceId: string,
    @Request() req: any,
  ) {
    return this.callsService.getLiveCalls(workspaceId, req.user.userId);
  }

  @Get(':callId')
  @RequireResourceScope('call', 'callId')
  async getCallDetail(
    @Param('workspaceId') workspaceId: string,
    @Param('callId') callId: string,
    @Request() req?: any,
  ) {
    if (req?.user?.userId) {
      return this.callsService.getCallDetail(workspaceId, callId, req.user.userId);
    }
    return this.callsService.getCallDetail(workspaceId, callId);
  }
}
