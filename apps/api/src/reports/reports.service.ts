import * as ExcelJS from 'exceljs';
import { CallsService } from '../calls/calls.service.js';
import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { WorkspaceRole } from '@prisma/client';
import {
  isValidPhoneNumber,
  formatPhoneNumber,
  maskCallerPhoneNumber,
  formatCallerDisplay,
} from '../common/phone.utils.js';

export { isValidPhoneNumber, formatPhoneNumber, maskCallerPhoneNumber };

export function getFinalDestinationDisplay(call: any): string {
  if (!call) return '—';

  const stateStr = (call.state || '').toString().toUpperCase();
  const attempts: any[] = Array.isArray(call.attempts) ? call.attempts : [];
  
  const successfulAttempt = attempts.find((a: any) => {
    const state = (a?.state || '').toString().toUpperCase();
    return state === 'COMPLETED' || state === 'ANSWERED' || state === 'CONNECTED' || Boolean(a?.answered_at);
  });

  if (successfulAttempt) {
    const rawNum = 
      successfulAttempt?.buyer?.destination_number ||
      successfulAttempt?.destination_number ||
      call.destination_number ||
      call.buyer?.destination_number;

    if (isValidPhoneNumber(rawNum)) {
      return formatPhoneNumber(rawNum);
    }
    
    return 'Destination unavailable';
  }

  const isConnected = ['COMPLETED', 'CONNECTED', 'ANSWERED'].includes(stateStr) || Boolean(call.answered_at);
  const rawDirectNum = call.destination_number || call.buyer?.destination_number;

  if (isConnected && rawDirectNum) {
    if (isValidPhoneNumber(rawDirectNum)) {
      return formatPhoneNumber(rawDirectNum);
    }
    return 'Destination unavailable';
  }

  // If the call or an attempt is actively in progress, destination is pending
  const isCallInProgress = ['ROUTING', 'RINGING', 'INITIATED', 'DIALING'].includes(stateStr);
  const hasInProgressAttempt = attempts.some((a: any) => {
    const aState = (a?.state || '').toString().toUpperCase();
    return ['RINGING', 'INITIATED', 'DIALING'].includes(aState);
  });
  if (isCallInProgress || hasInProgressAttempt) {
    return '—';
  }

  const hasFailedAttempts = attempts.length > 0 && attempts.every((a: any) => {
    const state = (a?.state || '').toString().toUpperCase();
    return ['FAILED', 'NO_ANSWER', 'CANCELED', 'BUSY', 'REJECTED'].includes(state);
  });

  const isFailedCall = ['FAILED', 'NO_ANSWER', 'BUSY', 'CANCELED', 'MISSED', 'ABANDONED', 'BLOCKED', 'VOICEMAIL', 'COMPLETED'].includes(
    stateStr
  );

  if (hasFailedAttempts || isFailedCall) {
    return 'No successful destination';
  }

  return '—';
}

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService, private callsService: CallsService) {}

  private normalizeConfiguration(config: any) {
    if (!config || typeof config !== 'object') return {};
    const normalized: any = {};
    
    // Normalize Filters
    if (config.filters && typeof config.filters === 'object') {
      normalized.filters = {};
      const validFilters = ['startDate', 'endDate', 'campaignId', 'buyerId', 'vendorId', 'trackingNumber', 'callerNumber', 'status', 'minDuration', 'maxDuration', 'minDurationSecs', 'maxDurationSecs', 'durationType'];
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
      const validColumnIds = new Set(['time', 'caller', 'trackingNumber', 'campaign', 'finalDestination', 'status', 'talkDuration', 'totalDuration', 'revenue', 'payout', 'profit', 'commercial', 'attempts', 'recording', 'actions']);
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

    const ctx = await this.callsService.getParticipantContext(workspaceId, userId);
    const { items } = await this.callsService.getCalls(workspaceId, userId, { ...normalizedFilters, limit: 10001 });

    if (items.length > 10000) {
      throw new BadRequestException('Export limit of 10,000 rows exceeded. Please narrow your filters.');
    }

    let exportCols = (columns || []).filter(c => c.visible && c.id !== 'actions').sort((a,b) => a.order - b.order);
    if (ctx.isBuyer) {
      exportCols = exportCols.filter(c => c.id !== 'payout' && c.id !== 'profit');
    }
    if (ctx.isVendor) {
      exportCols = exportCols.filter(c => c.id !== 'finalDestination' && c.id !== 'revenue' && c.id !== 'profit');
    }
    
    const headerMap: Record<string, string> = {
      'time': 'Date / Time',
      'caller': 'Caller',
      'trackingNumber': 'Tracking Number',
      'campaign': 'Campaign',
      'finalDestination': 'Final Destination',
      'status': 'Status',
      'talkDuration': 'Talk Duration',
      'totalDuration': 'Total Duration',
      'revenue': 'Revenue',
      'payout': 'Payout',
      'profit': 'Profit',
      'commercial': 'Commercial',
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

    const formatDuration = (secs: number | null | undefined) => {
      if (typeof secs !== 'number' || isNaN(secs)) return '—';
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const s = secs % 60;
      if (h > 0) return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
      return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    items.forEach(call => {
      const row: any = {};
      row['time'] = call.created_at ? new Date(call.created_at).toISOString() : '';
      row['caller'] = formatCallerDisplay(call.from_number, ctx.isVendor);
      row['trackingNumber'] = call.to_number || '';
      row['campaign'] = call.campaign?.name || '';
      row['finalDestination'] = getFinalDestinationDisplay(call);
      row['status'] = call.state || '';
      row['talkDuration'] = formatDuration(call.talkDurationSecs != null ? call.talkDurationSecs : (call.duration_secs != null ? call.duration_secs : null));
      row['totalDuration'] = formatDuration(call.totalDurationSecs != null ? call.totalDurationSecs : null);
      row['attempts'] = call.attempts?.length || 0;
      row['recording'] = call.recordings && call.recordings.length > 0 ? 'Available' : 'None';
      
      if (exportCols.some(c => c.id === 'revenue')) {
        row['revenue'] = call.commercial && call.commercial.revenue !== undefined ? call.commercial.revenue : '—';
      }
      if (exportCols.some(c => c.id === 'payout')) {
        row['payout'] = call.commercial && call.commercial.payout !== undefined ? call.commercial.payout : '—';
      }
      if (exportCols.some(c => c.id === 'profit')) {
        row['profit'] = call.commercial && call.commercial.profit !== undefined ? call.commercial.profit : '—';
      }
      if (exportCols.some(c => c.id === 'commercial')) {
        if (call.commercial) {
          const parts = [call.commercial.status || 'EVALUATED'];
          if (call.commercial.converted) parts.push('Converted');
          if (call.commercial.qualified) parts.push('Qualified');
          if (call.commercial.duplicate) parts.push('Duplicate');
          row['commercial'] = parts.join(' - ');
        } else {
          row['commercial'] = 'Not evaluated';
        }
      }

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
      where: { id: reportId, workspace_id: workspaceId },
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
      where: { id: reportId, workspace_id: workspaceId }
    });
    return { success: true };
  }
}
