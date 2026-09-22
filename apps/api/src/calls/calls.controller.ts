import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { CallsService } from './calls.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { CallState } from '@prisma/client';

@Controller('workspaces/:workspaceId/calls')
@UseGuards(JwtAuthGuard, WorkspaceRolesGuard)
export class CallsController {
  constructor(private readonly callsService: CallsService) {}

  @Get()
  async getCalls(
    @Param('workspaceId') workspaceId: string,
    @Query('campaignId') campaignId?: string,
    @Query('buyerId') buyerId?: string,
    @Query('status') status?: CallState,
    @Query('callerNumber') callerNumber?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
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

  @Get('metrics')
  async getMetrics(
    @Param('workspaceId') workspaceId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.callsService.getMetrics(workspaceId, { startDate, endDate });
  }

  @Get(':callId')
  async getCallDetail(
    @Param('workspaceId') workspaceId: string,
    @Param('callId') callId: string,
  ) {
    return this.callsService.getCallDetail(workspaceId, callId);
  }
}
