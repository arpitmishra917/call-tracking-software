import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { ReportsService } from '../src/reports/reports.service.js';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

describe('ReportsService (Isolation Tests)', () => {
  let service: ReportsService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ReportsService, PrismaService],
    }).compile();

    service = module.get<ReportsService>(ReportsService);
    prisma = module.get<PrismaService>(PrismaService);
    
    // Seed
    await prisma.savedReport.deleteMany();
    await prisma.workspaceMember.deleteMany();
    await prisma.profile.deleteMany();
    await prisma.workspace.deleteMany();
    
    await prisma.profile.create({ data: { id: 'u1' } });
    await prisma.profile.create({ data: { id: 'u2' } });
    await prisma.workspace.create({ data: { id: 'w1', name: 'W1', slug: 'w1' } });
    await prisma.workspace.create({ data: { id: 'w2', name: 'W2', slug: 'w2' } });
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
  
  it('E2-08 Cross-workspace report mutation is rejected', async () => {
    const r = await service.createSavedReport('w1', 'u1', { name: 'S3', visibility: 'SHARED' });
    await expect(service.updateReport('w2', r.id, 'u1', 'ADMIN', { name: 'Hacked' })).rejects.toThrow();
  });
  
  it('E2-12 Invalid configuration rejected safely (empty name)', async () => {
    await expect(service.createSavedReport('w1', 'u1', { name: '   ' })).rejects.toThrow(BadRequestException);
  });
  
  it('E2-19 Creator ownership preserved after update', async () => {
    const r = await service.createSavedReport('w1', 'u1', { name: 'Upd' });
    const updated = await service.updateReport('w1', r.id, 'u1', 'ADMIN', { name: 'Updated' });
    expect(updated.created_by_user_id).toBe('u1');
    expect(updated.name).toBe('Updated');
  });
});
