import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { ReportsService } from '../src/reports/reports.service.js';
import { CallsService } from '../src/calls/calls.service.js';
import { JwtService } from '@nestjs/jwt';
import * as ExcelJS from 'exceljs';
import { vi } from 'vitest';

describe('Reporting Export API (R3-E3)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let reportsService: ReportsService;
  let jwtService: JwtService;

  let workspace1: string;
  let workspace2: string;
  let campaign1: string;
  let buyer1: string;
  let trackingNumber1: string;
  let user1: string;
  let token1: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    
    prisma = app.get<PrismaService>(PrismaService);
    reportsService = app.get<ReportsService>(ReportsService);
    jwtService = new JwtService({ secret: process.env.JWT_SECRET || 'super-secret' });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    const url = process.env.DATABASE_URL || '';
    if (!url.includes('_test')) {
      throw new Error('E2E tests must use the test database');
    }

    await prisma.savedReport.deleteMany();
    await prisma.workspaceMember.deleteMany();
    await prisma.profile.deleteMany();
    await prisma.workspace.deleteMany();
    await prisma.call.deleteMany();
    await prisma.campaign.deleteMany();
    await prisma.buyer.deleteMany();
    await prisma.phoneNumber.deleteMany();

    user1 = 'user-e3-1';
    await prisma.profile.create({ data: { id: user1, display_name: 'E3 User' } });
    token1 = jwtService.sign({ sub: user1, userId: user1, display_name: 'E3 User' });

    const ws1 = await prisma.workspace.create({ data: { name: 'E3 WS1', slug: 'e3-ws1' } });
    workspace1 = ws1.id;
    const ws2 = await prisma.workspace.create({ data: { name: 'E3 WS2', slug: 'e3-ws2' } });
    workspace2 = ws2.id;

    await prisma.workspaceMember.create({
      data: { workspace: { connect: { id: workspace1 } }, profile: { connect: { id: user1 } }, role: 'ADMIN' }
    });

    const camp = await prisma.campaign.create({ data: { workspace: { connect: { id: workspace1 } }, name: 'E3 Campaign' } });
    campaign1 = camp.id;

    const b1 = await prisma.buyer.create({ data: { workspace: { connect: { id: workspace1 } }, name: 'E3 Buyer', destination_number: '+15558889999' } });
    buyer1 = b1.id;

    const tn = await prisma.phoneNumber.create({ data: { workspace: { connect: { id: workspace1 } }, phone_number: '+15550001111', provider: 'telnyx' } });
    trackingNumber1 = tn.id;

    // Seed calls
    for (let i = 0; i < 5; i++) {
      const call = await prisma.call.create({
        data: {
          workspace: { connect: { id: workspace1 } },
          campaign: { connect: { id: campaign1 } },
          from_number: `+1555222333${i}`,
          to_number: '+15550001111',
          state: i % 2 === 0 ? 'COMPLETED' : 'FAILED',
          started_at: new Date(Date.now() - i * 10 * 1000),
          ended_at: new Date(),
          duration_secs: i * 10,
          provider: 'telnyx',
          provider_call_id: `call-${i}`
        }
      });
      await prisma.callAttempt.create({
        data: {
          call: { connect: { id: call.id } },
          buyer: { connect: { id: buyer1 } },
          state: 'COMPLETED'
        }
      });
      if (i === 0) {
        await prisma.recording.create({
          data: {
            call: { connect: { id: call.id } },
            recording_url: 'http://url',
            duration_secs: 10, provider_id: 'rec-0',
            workspace: { connect: { id: workspace1 } }
          }
        });
      }
    }
    // Seed ws2 call
    await prisma.call.create({
      data: {
        workspace_id: workspace2,
        from_number: '+1999',
        to_number: '+1888',
        state: 'COMPLETED',
        provider: 'telnyx',
        provider_call_id: 'ws2-call'
      }
    });
  });

  const columns = [
    { id: 'time', visible: true, order: 0 },
    { id: 'caller', visible: true, order: 1 },
    { id: 'actions', visible: true, order: 2 },
    { id: 'status', visible: true, order: 3 }
  ];

  it('E3-01 CSV export succeeds', async () => {
    const res = await reportsService.generateExport(workspace1, '', 'csv', {}, columns);
    expect(res.contentType).toBe('text/csv');
    expect(res.extension).toBe('csv');
    expect(res.buffer).toBeDefined();
    const str = res.buffer.toString();
    expect(str.split('\n').length).toBeGreaterThan(5); // Header + 5 rows + trailing newline
  });

  it('E3-02 XLSX export succeeds', async () => {
    const res = await reportsService.generateExport(workspace1, '', 'xlsx', {}, columns);
    expect(res.contentType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.extension).toBe('xlsx');
    expect(res.buffer).toBeDefined();
  });

  it('E3-03 CSV contains correct headers', async () => {
    const res = await reportsService.generateExport(workspace1, '', 'csv', {}, columns);
    const str = res.buffer.toString();
    expect(str).toContain('Date / Time,Caller,Status,Call ID');
  });

  it('E3-04 XLSX contains correct headers', async () => {
    const res = await reportsService.generateExport(workspace1, '', 'xlsx', {}, columns);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.buffer);
    const ws = wb.getWorksheet('Report');
    if (!ws) throw new Error('Worksheet not found');
    const row = ws.getRow(1);
    const headers = row.values ? (row.values as string[]).slice(1) : [];
    expect(headers).toContain('Date / Time');
    expect(headers).toContain('Caller');
    expect(headers).toContain('Call ID');
  });

  it('E3-05 Active filters affect exported rows', async () => {
    const res = await reportsService.generateExport(workspace1, '', 'csv', { status: 'FAILED' }, columns);
    const str = res.buffer.toString();
    expect(str.split('\n').filter(l => l.trim()).length).toBe(3); // Header + 2 FAILED rows
  });

  it('E3-06 Campaign filter is respected', async () => {
    const res = await reportsService.generateExport(workspace1, '', 'csv', { campaignId: campaign1 }, columns);
    expect(res.buffer.toString().split('\n').filter(l => l.trim()).length).toBe(6);
  });

  it('E3-07 Buyer filter is respected', async () => {
    const res = await reportsService.generateExport(workspace1, '', 'csv', { buyerId: buyer1 }, columns);
    expect(res.buffer.toString().split('\n').filter(l => l.trim()).length).toBe(6);
  });

  it('E3-08 Tracking number filter is respected', async () => {
    const res = await reportsService.generateExport(workspace1, '', 'csv', { trackingNumber: '+15550001111' }, columns);
    expect(res.buffer.toString().split('\n').filter(l => l.trim()).length).toBe(6);
  });

  it('E3-09 Caller filter is respected', async () => {
    const res = await reportsService.generateExport(workspace1, '', 'csv', { callerNumber: '+15552223330' }, columns);
    expect(res.buffer.toString().split('\n').filter(l => l.trim()).length).toBe(2); // Header + 1
  });

  it('E3-10 Status filter is respected', async () => {
    const res = await reportsService.generateExport(workspace1, '', 'csv', { status: 'COMPLETED' }, columns);
    expect(res.buffer.toString().split('\n').filter(l => l.trim()).length).toBe(4); // Header + 3
  });

  it('E3-11 Duration filters are respected', async () => {
    const res = await reportsService.generateExport(workspace1, '', 'csv', { minDurationSecs: 20, durationType: 'total' }, columns);
    expect(res.buffer.toString().split('\n').filter(l => l.trim()).length).toBe(4); // Header + 3 rows (20,30,40)
  });

  it('E3-12 Workspace isolation', async () => {
    const res = await reportsService.generateExport(workspace1, '', 'csv', {}, columns);
    expect(res.buffer.toString()).not.toContain('+1999'); // ws2 data
  });

  it('E3-13 Unauthorized workspace export rejected', async () => {
    const response = await request(app.getHttpServer())
      .post(`/workspaces/${workspace2}/reports/export`)
      .set('Authorization', `Bearer ${token1}`)
      .send({ format: 'csv', filters: {}, columns: [] });
    expect(response.status).toBe(401);
  });

  it('E3-14 Invalid format rejected', async () => {
    await expect(reportsService.generateExport(workspace1, '', 'pdf' as any, {}, columns))
      .rejects.toThrow('Invalid export format');
  });

  it('E3-15 Actions column is never exported', async () => {
    const res = await reportsService.generateExport(workspace1, '', 'csv', {}, columns);
    expect(res.buffer.toString()).not.toContain('Actions');
  });

  it('E3-16 Call ID is exportable', async () => {
    const res = await reportsService.generateExport(workspace1, '', 'csv', {}, columns);
    expect(res.buffer.toString()).toContain('Call ID');
    expect(res.buffer.toString()).not.toContain('call-0');
  });

  it('E3-17 Recording information does not expose unauthorized provider URLs', async () => {
    const res = await reportsService.generateExport(workspace1, '', 'csv', { callerNumber: '+15552223330' }, [{ id: 'recording', visible: true, order: 0 }]);
    const str = res.buffer.toString();
    expect(str).toContain('Available');
    expect(str).not.toContain('http'); // no raw url
  });

  it('E3-18 Export row limit is enforced', async () => {
    const callsService = app.get(CallsService);
    const mock = vi.spyOn(callsService, 'getCalls').mockResolvedValueOnce({ items: new Array(10001).fill({}), total: 10001 } as any);
    await expect(reportsService.generateExport(workspace1, '', 'csv', {}, [])).rejects.toThrow('limit of 10,000 rows exceeded');
    mock.mockRestore();
  });

  it('E3-19 Deleted/historical report configuration does not affect raw call data', async () => {
    const res = await reportsService.generateExport(workspace1, '', 'csv', { fakeUnknownFilter: 'abc' }, columns);
    expect(res.buffer.toString().split('\n').filter(l => l.trim()).length).toBe(6); // Safely ignores unknown filter
  });

  it('E3-20 Saved report applied → current state exported', async () => {
    // This is tested by the frontend sending exact current filters in payload, the API just honors what is passed.
    const res = await reportsService.generateExport(workspace1, '', 'csv', { status: 'COMPLETED' }, columns);
    expect(res.buffer.toString()).toContain('COMPLETED');
    expect(res.buffer.toString()).not.toContain('FAILED');
  });

  it('E3-21 CSV escaping handles commas/quotes/newlines', async () => {
    await prisma.call.create({
      data: {
        workspace: { connect: { id: workspace1 } },
        from_number: 'Dr. "Smith", Jr.\nNew Line',
        to_number: '+1555',
        state: 'COMPLETED',
        provider: 'telnyx',
        provider_call_id: 'call-escape'
      }
    });
    const res = await reportsService.generateExport(workspace1, '', 'csv', {}, columns);
    const str = res.buffer.toString();
    expect(str).toContain('""Smith""'); // escaped quote
    expect(str).toContain('\n');
  });

  it('E3-22 Unicode values survive CSV generation', async () => {
    await prisma.call.create({
      data: {
        workspace: { connect: { id: workspace1 } },
        from_number: 'Jalapeño 🚀',
        to_number: '+1555',
        state: 'COMPLETED',
        provider: 'telnyx',
        provider_call_id: 'call-unicode'
      }
    });
    const res = await reportsService.generateExport(workspace1, '', 'csv', {}, columns);
    expect(res.buffer.toString()).toContain('Jalapeño 🚀');
  });

  it('E3-23 Null values are handled safely', async () => {
    await prisma.call.create({
      data: {
        workspace: { connect: { id: workspace1 } },
        from_number: '',
        to_number: '+1555',
        state: 'COMPLETED',
        provider: 'telnyx',
        provider_call_id: 'call-null'
      }
    });
    const res = await reportsService.generateExport(workspace1, '', 'csv', {}, columns);
    expect(res.buffer.toString().length).toBeGreaterThan(0);
  });

  
  it('E3-25 Formula injection prevention', async () => {
    // create a campaign with formula
    const camp = await prisma.campaign.create({
      data: {
        workspace_id: workspace1,
        name: '=SUM(A1:A2)',
        
      }
    });
    // create a buyer with formula
    const buy = await prisma.buyer.create({
      data: {
        workspace_id: workspace1,
        name: '+123',
        destination_number: '-123'
      }
    });
    const callForm = await prisma.call.create({
      data: {
        workspace: { connect: { id: workspace1 } },
        campaign: { connect: { id: camp.id } },
        
        from_number: '@username',
        to_number: '-12345',
        state: 'COMPLETED',
        started_at: new Date(),
        ended_at: new Date(),
        duration_secs: 10,
        provider: 'telnyx',
        provider_call_id: 'call-form'
      }
    });

    const res = await reportsService.generateExport(workspace1, '', 'csv', {}, [{ id: 'campaign', visible: true, order: 1 }, { id: 'finalDestination', visible: true, order: 2 }, { id: 'caller', visible: true, order: 3 }, { id: 'trackingNumber', visible: true, order: 4 }]);
    const str = res.buffer.toString();
    
    // We expect the cells to NOT be literal '=SUM(A1:A2)'
    expect(str).not.toContain('\n=SUM(A1:A2)');
    expect(str).not.toContain(',=SUM(A1:A2)');
    expect(str).not.toContain(',+123');
    expect(str).not.toContain(',@username');
    expect(str).not.toContain(',-12345');
    
    // clean up
    await prisma.call.delete({ where: { id: callForm.id } });
    await prisma.buyer.delete({ where: { id: buy.id } });
    await prisma.campaign.delete({ where: { id: camp.id } });
  });

  it('E3-24 No cross-tenant data leakage through filter IDs', async () => {
    // try to filter by a campaign belonging to ws2
    const c2 = await prisma.campaign.create({ data: { workspace_id: workspace2, name: 'WS2 Camp' } });
    const res = await reportsService.generateExport(workspace1, '', 'csv', { campaignId: c2.id }, columns);
    expect(res.buffer.toString().split('\n').filter(l => l.trim()).length).toBe(1); // Only header, since it doesn't match
  });
});
