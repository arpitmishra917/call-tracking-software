import type { Response } from 'express';
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  Request,
  Res,
} from '@nestjs/common';
import { ReportsService } from './reports.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { RequirePermission } from '../authorization/permissions.decorator.js';

@Controller('workspaces/:workspaceId/reports')
@UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard)
export class ReportsController {

  @Post('export')
  @RequirePermission('report:export')
  async exportReport(
    @Param('workspaceId') workspaceId: string,
    @Request() req: any,
    @Body() payload: any,
    @Res() res: Response,
  ) {
    const { format, filters, columns } = payload;
    const userId = req.user?.userId || req.user?.sub || req.user?.id;
    const { buffer, contentType, extension } = await this.reportsService.generateExport(workspaceId, userId, format, filters, columns);

    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `callflow-report-${dateStr}.${extension}`;

    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Access-Control-Expose-Headers': 'Content-Disposition',
    });

    res.send(buffer);
  }

  constructor(private readonly reportsService: ReportsService) {}

  @Post()
  @RequirePermission('report:manage')
  async createReport(
    @Param('workspaceId') workspaceId: string,
    @Body() body: any,
    @Request() req: any,
  ) {
    return this.reportsService.createSavedReport(workspaceId, req.user.userId, body);
  }

  @Get()
  @RequirePermission('report:read')
  async getReports(
    @Param('workspaceId') workspaceId: string,
    @Request() req: any,
  ) {
    return this.reportsService.getReports(workspaceId, req.user.userId);
  }

  @Get(':reportId')
  @RequirePermission('report:read')
  async getReport(
    @Param('workspaceId') workspaceId: string,
    @Param('reportId') reportId: string,
    @Request() req: any,
  ) {
    return this.reportsService.getReport(workspaceId, reportId, req.user.userId);
  }

  @Patch(':reportId')
  @RequirePermission('report:manage')
  async updateReport(
    @Param('workspaceId') workspaceId: string,
    @Param('reportId') reportId: string,
    @Body() body: any,
    @Request() req: any,
  ) {
    return this.reportsService.updateReport(workspaceId, reportId, req.user.userId, req.workspaceRole, body);
  }

  @Delete(':reportId')
  @RequirePermission('report:manage')
  async deleteReport(
    @Param('workspaceId') workspaceId: string,
    @Param('reportId') reportId: string,
    @Request() req: any,
  ) {
    return this.reportsService.deleteReport(workspaceId, reportId, req.user.userId, req.workspaceRole);
  }
}
