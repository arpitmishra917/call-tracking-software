import { PermissionsService } from '../src/permissions/permissions.service';
import { CallsService } from '../src/calls/calls.service';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { ReportsService } from '../src/reports/reports.service.js';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

describe('ReportsService (Isolation Tests)', () => {
  let service: ReportsService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ReportsService, PrismaService, { provide: CallsService, useValue: {} }, { provide: PermissionsService, useValue: {} }],
    }).compile();

    service = module.get<ReportsService>(ReportsService);
    prisma = module.get<PrismaService>(PrismaService);
    
    // Seed DB
    await prisma.savedReport.deleteMany();
    await prisma.workspaceMember.deleteMany();
    await prisma.profile.deleteMany();
    await prisma.workspace.deleteMany();
    await prisma.call.deleteMany();
    
    await prisma.profile.create({ data: { id: 'u1' } });
    await prisma.profile.create({ data: { id: 'u2' } });
    await prisma.profile.create({ data: { id: 'u3' } });
    await prisma.workspace.create({ data: { id: 'w1', name: 'W1', slug: 'w1' } });
    await prisma.workspace.create({ data: { id: 'w2', name: 'W2', slug: 'w2' } });
    
    // Member u1 is ADMIN in w1, u2 is MEMBER in w1. u3 is in w2.
    await prisma.workspaceMember.create({ data: { workspace_id: 'w1', user_id: 'u1', role: 'ADMIN' } });
    await prisma.workspaceMember.create({ data: { workspace_id: 'w1', user_id: 'u2', role: 'MEMBER' } });
    await prisma.workspaceMember.create({ data: { workspace_id: 'w2', user_id: 'u3', role: 'MEMBER' } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('E2-01 Create personal saved report', async () => {
    const r = await service.createSavedReport('w1', 'u1', { name: 'P1', visibility: 'PERSONAL', configuration: {} });
    expect(r.id).toBeDefined();
    expect(r.visibility).toBe('PERSONAL');
  });

  it('E2-02 Create shared saved report', async () => {
    const r = await service.createSavedReport('w1', 'u1', { name: 'S1', visibility: 'SHARED', configuration: {} });
    expect(r.visibility).toBe('SHARED');
  });

  it('E2-03 List workspace reports', async () => {
    const reports = await service.getReports('w1', 'u1');
    expect(reports.length).toBeGreaterThanOrEqual(2);
  });

  it('E2-04 Personal report visible to creator', async () => {
    const r = await service.createSavedReport('w1', 'u1', { name: 'P2', visibility: 'PERSONAL' });
    const fetched = await service.getReport('w1', r.id, 'u1');
    expect(fetched.id).toBe(r.id);
  });

  it('E2-05 Personal report not visible to another member', async () => {
    const r = await service.createSavedReport('w1', 'u1', { name: 'P3', visibility: 'PERSONAL' });
    await expect(service.getReport('w1', r.id, 'u2')).rejects.toThrow(ForbiddenException);
  });

  it('E2-06 Shared report visible to authorized workspace member', async () => {
    const r = await service.createSavedReport('w1', 'u1', { name: 'S2', visibility: 'SHARED' });
    const fetched = await service.getReport('w1', r.id, 'u2');
    expect(fetched.id).toBe(r.id);
  });

  it('E2-07 Cross-workspace GET/access must be rejected', async () => {
    const r = await service.createSavedReport('w1', 'u1', { name: 'S4', visibility: 'SHARED' });
    await expect(service.getReport('w2', r.id, 'u3')).rejects.toThrow(NotFoundException);
  });

  it('E2-08 Cross-workspace report mutation is rejected', async () => {
    const r = await service.createSavedReport('w1', 'u1', { name: 'S3', visibility: 'SHARED' });
    await expect(service.updateReport('w2', r.id, 'u1', 'ADMIN', { name: 'Hacked' })).rejects.toThrow();
  });

  it('E2-09 Rename report', async () => {
    const r = await service.createSavedReport('w1', 'u1', { name: 'Old' });
    const updated = await service.updateReport('w1', r.id, 'u1', 'ADMIN', { name: 'New' });
    expect(updated.name).toBe('New');
  });

  it('E2-10 Delete report', async () => {
    const r = await service.createSavedReport('w1', 'u1', { name: 'ToDelete' });
    await service.deleteReport('w1', r.id, 'u1', 'ADMIN');
    await expect(service.getReport('w1', r.id, 'u1')).rejects.toThrow(NotFoundException);
  });

  it('E2-11 Unauthorized deletion rejected', async () => {
    const r = await service.createSavedReport('w1', 'u1', { name: 'S5', visibility: 'SHARED' });
    // u2 is MEMBER, not owner/admin, not creator
    await expect(service.deleteReport('w1', r.id, 'u2', 'MEMBER')).rejects.toThrow(ForbiddenException);
  });

  it('E2-12 Invalid configuration rejected safely', async () => {
    await expect(service.createSavedReport('w1', 'u1', { name: '   ' })).rejects.toThrow(BadRequestException);
  });

  it('E2-13 Unknown column IDs are safely normalized/ignored', async () => {
    const config = { columns: [{ id: 'fakeCol', visible: true, order: 1 }] };
    const r = await service.createSavedReport('w1', 'u1', { name: 'Cols', configuration: config });
    const c = r.configuration as any;
    expect(c.columns.find((x:any) => x.id === 'fakeCol')).toBeUndefined();
  });

  it('E2-14 Invalid groupBy/bucket rejected or normalized safely', async () => {
    const config = { groupBy: 'FakeGroup', bucket: 'FakeBucket' };
    const r = await service.createSavedReport('w1', 'u1', { name: 'Grp', configuration: config });
    const c = r.configuration as any;
    expect(c.groupBy).toBeUndefined();
    expect(c.bucket).toBeUndefined();
  });

  it('E2-15 Saved configuration contains configuration only, never report result rows', async () => {
    const config = { results: [1,2,3] };
    const r = await service.createSavedReport('w1', 'u1', { name: 'Data', configuration: config });
    const c = r.configuration as any;
    expect(c.results).toBeUndefined();
  });

  it('E2-16 Applying saved config reproduces equivalent state (shape check)', async () => {
    const config = { filters: { status: 'COMPLETED' }, bucket: 'day' };
    const r = await service.createSavedReport('w1', 'u1', { name: 'State', configuration: config });
    const c = r.configuration as any;
    expect(c.filters.status).toBe('COMPLETED');
    expect(c.bucket).toBe('day');
  });

  it('E2-17 Actions column cannot be removed from saved configuration', async () => {
    const config = { columns: [{ id: 'time', visible: true }] };
    const r = await service.createSavedReport('w1', 'u1', { name: 'ActionsTest', configuration: config });
    const c = r.configuration as any;
    expect(c.columns.find((x:any) => x.id === 'actions')).toBeDefined();
    expect(c.columns.find((x:any) => x.id === 'actions').visible).toBe(true);
  });

  it('E2-18 Explicit tenant isolation', async () => {
    const r = await service.createSavedReport('w1', 'u1', { name: 'S6', visibility: 'SHARED' });
    const r2 = await service.createSavedReport('w2', 'u3', { name: 'S7', visibility: 'SHARED' });
    const w1Reports = await service.getReports('w1', 'u1');
    expect(w1Reports.map(x=>x.id)).not.toContain(r2.id);
  });

  it('E2-19 Creator ownership preserved after update', async () => {
    const r = await service.createSavedReport('w1', 'u1', { name: 'Upd' });
    const updated = await service.updateReport('w1', r.id, 'u1', 'ADMIN', { name: 'Updated' });
    expect(updated.created_by_user_id).toBe('u1');
  });

  it('E2-20 Deleting a saved report does not modify historical calls', async () => {
    const r = await service.createSavedReport('w1', 'u1', { name: 'ToDeleteCall' });
    
    await prisma.call.create({
      data: {
        id: 'call1',
        workspace_id: 'w1',
        from_number: '+1',
        to_number: '+2',
        state: 'COMPLETED',
        provider: 'telnyx',
        provider_call_id: 'test_call_1'
      }
    });

    await service.deleteReport('w1', r.id, 'u1', 'ADMIN');
    
    const call = await prisma.call.findUnique({ where: { id: 'call1' } });
    expect(call).toBeDefined();
    expect(call?.id).toBe('call1');
  });
});
