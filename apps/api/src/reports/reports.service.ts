import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { WorkspaceRole } from '@prisma/client';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  async createSavedReport(workspaceId: string, userId: string, data: any) {
    if (!data.name || data.name.trim() === '') {
      throw new BadRequestException('Report name is required');
    }
    
    return this.prisma.savedReport.create({
      data: {
        workspace_id: workspaceId,
        created_by_user_id: userId,
        name: data.name.trim().substring(0, 100),
        visibility: data.visibility === 'SHARED' ? 'SHARED' : 'PERSONAL',
        configuration: data.configuration || {},
      }
    });
  }

  async getReports(workspaceId: string, userId: string) {
    return this.prisma.savedReport.findMany({
      where: {
        workspace_id: workspaceId,
        OR: [
          { visibility: 'SHARED' },
          { created_by_user_id: userId }
        ]
      },
      include: {
        creator: { select: { display_name: true } }
      },
      orderBy: { created_at: 'desc' }
    });
  }

  async getReport(workspaceId: string, reportId: string, userId: string) {
    const report = await this.prisma.savedReport.findUnique({
      where: { id: reportId, workspace_id: workspaceId },
      include: {
        creator: { select: { display_name: true } }
      }
    });
    if (!report) throw new NotFoundException('Saved report not found');
    
    if (report.visibility === 'PERSONAL' && report.created_by_user_id !== userId) {
      throw new ForbiddenException('You do not have access to this personal report');
    }
    return report;
  }

  async updateReport(workspaceId: string, reportId: string, userId: string, role: WorkspaceRole, data: any) {
    const report = await this.getReport(workspaceId, reportId, userId);
    
    // Only creator or ADMIN/OWNER can modify shared reports. Personal reports can only be modified by creator.
    const isCreator = report.created_by_user_id === userId;
    const isAdmin = role === 'ADMIN' || role === 'OWNER';
    
    if (!isCreator) {
        if (report.visibility === 'PERSONAL' || !isAdmin) {
            throw new ForbiddenException('You do not have permission to modify this report');
        }
    }

    const updates: any = {};
    if (data.name !== undefined) {
      if (data.name.trim() === '') throw new BadRequestException('Report name cannot be empty');
      updates.name = data.name.trim().substring(0, 100);
    }
    if (data.visibility !== undefined) {
      updates.visibility = data.visibility === 'SHARED' ? 'SHARED' : 'PERSONAL';
    }
    if (data.configuration !== undefined) {
      updates.configuration = data.configuration;
    }

    return this.prisma.savedReport.update({
      where: { id: reportId },
      data: updates
    });
  }

  async deleteReport(workspaceId: string, reportId: string, userId: string, role: WorkspaceRole) {
    const report = await this.getReport(workspaceId, reportId, userId);
    
    const isCreator = report.created_by_user_id === userId;
    const isAdmin = role === 'ADMIN' || role === 'OWNER';
    
    if (!isCreator) {
        if (report.visibility === 'PERSONAL' || !isAdmin) {
            throw new ForbiddenException('You do not have permission to delete this report');
        }
    }
    
    await this.prisma.savedReport.delete({
      where: { id: reportId }
    });
    return { success: true };
  }
}
