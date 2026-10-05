import * as ExcelJS from 'exceljs';
import { CallsService } from '../calls/calls.service.js';
import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { WorkspaceRole } from '@prisma/client';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService, private callsService: CallsService) {}

  private normalizeConfiguration(config: any) {
    if (!config || typeof config !== 'object') return {};
    const normalized: any = {};
    
    // Normalize Filters
    if (config.filters && typeof config.filters === 'object') {
      normalized.filters = {};
      const validFilters = ['startDate', 'endDate', 'campaignId', 'buyerId', 'trackingNumber', 'callerNumber', 'status', 'minDuration', 'maxDuration', 'minDurationSecs', 'maxDurationSecs', 'durationType'];
      for (const k of validFilters) {
        if (config.filters[k] !== undefined) normalized.filters[k] = config.filters[k];
      }
    }
    
    // Normalize groupBy and bucket
    const validGroupBys = ['Campaign', 'Buyer', 'Tracking Number', 'Status'];
    if (config.groupBy && validGroupBys.includes(config.groupBy)) {
      normalized.groupBy = config.groupBy;
    }
    const validBuckets = ['hour', 'day', 'week', 'month'];
    if (config.bucket && validBuckets.includes(config.bucket)) {
      normalized.bucket = config.bucket;
    }
    
    // Normalize columns
    if (config.columns && Array.isArray(config.columns)) {
      normalized.columns = [];
      const validColumnIds = new Set(['time', 'caller', 'trackingNumber', 'campaign', 'finalDestination', 'status', 'talkDuration', 'totalDuration', 'attempts', 'recording', 'actions']);
      let hasActions = false;
      for (const col of config.columns) {
        if (col && col.id && validColumnIds.has(col.id)) {
          if (col.id === 'actions') hasActions = true;
          normalized.columns.push({
            id: col.id,
            visible: col.id === 'actions' ? true : !!col.visible,
            order: typeof col.order === 'number' ? col.order : 99,
          });
        }
      }
      if (!hasActions) {
        normalized.columns.push({ id: 'actions', visible: true, order: 99 });
      }
    }
    
    return normalized;
  }

  async generateExport(workspaceId: string, userId: string, format: 'csv' | 'xlsx', filters: any, columns: any[]) {
    if (format !== 'csv' && format !== 'xlsx') {
      throw new BadRequestException('Invalid export format');
    }

    // Explicitly validate filters through normalization to ensure tenant safety
    const normalizedFilters = this.normalizeConfiguration({ filters }).filters || {};

    const { items } = await this.callsService.getCalls(workspaceId, userId, { ...normalizedFilters, limit: 10001 });

    if (items.length > 10000) {
      throw new BadRequestException('Export limit of 10,000 rows exceeded. Please narrow your filters.');
    }

    const exportCols = (columns || []).filter(c => c.visible && c.id !== 'actions').sort((a,b) => a.order - b.order);
    
    const headerMap: Record<string, string> = {
      'time': 'Date / Time',
      'caller': 'Caller',
      'trackingNumber': 'Tracking Number',
      'campaign': 'Campaign',
      'finalDestination': 'Final Destination',
      'status': 'Status',
      'talkDuration': 'Talk Duration',
      'totalDuration': 'Total Duration',
      'attempts': 'Attempts',
      'recording': 'Recording',
      'id': 'Call ID',
    };

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Report');

    let sheetColumns = exportCols.map(col => ({
      header: headerMap[col.id] || col.id,
      key: col.id,
      width: 20
    }));

    if (!sheetColumns.find(c => c.key === 'id')) {
      sheetColumns.push({ header: 'Call ID', key: 'id', width: 40 });
    }

    worksheet.columns = sheetColumns;

    const formatDuration = (secs: number) => {
      if (typeof secs !== 'number' || isNaN(secs)) return '00:00';
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const s = secs % 60;
      if (h > 0) return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
      return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    items.forEach(call => {
      const row: any = {};
      row['time'] = call.created_at ? new Date(call.created_at).toISOString() : '';
      row['caller'] = call.from_number || '';
      row['trackingNumber'] = call.to_number || '';
      row['campaign'] = call.campaign?.name || '';
      row['finalDestination'] = call.buyer?.name || '';
      row['status'] = call.state || '';
      row['talkDuration'] = formatDuration(call.duration_secs || 0);
      row['totalDuration'] = formatDuration(call.total_duration_secs || 0);
      row['attempts'] = call.attempts?.length || 0;
      row['recording'] = call.recordings && call.recordings.length > 0 ? 'Available' : 'None';
      
        row['id'] = call.id;

        // Formula injection neutralization
        Object.keys(row).forEach(k => {
          if (typeof row[k] === 'string' && /^[=+\-@]/.test(row[k])) {
            row[k] = "\t" + row[k];
          }
        });

        worksheet.addRow(row);

    });

    if (format === 'csv') {
      const buffer = await workbook.csv.writeBuffer();
      return { buffer, contentType: 'text/csv', extension: 'csv' };
    } else {
      const buffer = await workbook.xlsx.writeBuffer();
      return { buffer, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: 'xlsx' };
    }
  }



  async createSavedReport(workspaceId: string, userId: string, data: any) {
    if (!data.name || data.name.trim() === '') {
      throw new BadRequestException('Report name is required');
    }
    
    return this.prisma.savedReport.create({
      data: {
        workspace_id: workspaceId,
        created_by_user_id: userId || '',
        name: data.name.trim().substring(0, 100),
        visibility: data.visibility === 'SHARED' ? 'SHARED' : 'PERSONAL',
        configuration: this.normalizeConfiguration(data.configuration),
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
      updates.configuration = this.normalizeConfiguration(data.configuration);
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
