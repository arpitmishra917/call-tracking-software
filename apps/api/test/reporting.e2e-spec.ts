import { CallsService } from '../src/calls/calls.service.js';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Reporting API Foundation (R3-A)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  
  let service: CallsService;
  
  let workspace1: string;
  let workspace2: string;
  let campaign1: string;
  let buyer1: string;
  let trackingNumber1: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get<PrismaService>(PrismaService);
    service = app.get<CallsService>(CallsService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Ensure we are hitting the test database! 
    const url = process.env.DATABASE_URL || '';
    if (!url.includes('_test')) {
      throw new Error('Safety check failed: E2E tests must use the test database');
    }
    
    // Clear relevant tables
    await prisma.callAttempt.deleteMany();
    await prisma.recording.deleteMany();
    await prisma.call.deleteMany();
    await prisma.campaignBuyer.deleteMany();
    
    
    
    
    

    // Create workspaces
    const ws1 = await prisma.workspace.create({ data: { name: 'Reporting WS 1', slug: "rep-ws-1-" + Math.random() } });
    workspace1 = ws1.id;
    const ws2 = await prisma.workspace.create({ data: { name: 'Reporting WS 2', slug: "rep-ws-2-" + Math.random() } });
    workspace2 = ws2.id;
    
    const camp = await prisma.campaign.create({ data: { workspace_id: workspace1, name: 'Camp 1' } });
    campaign1 = camp.id;
    
    const buyer = await prisma.buyer.create({ data: { workspace_id: workspace1, name: 'Buyer 1', destination_number: '+1000000000' } });
    buyer1 = buyer.id;
    
    const pn = await prisma.phoneNumber.create({ 
      data: { workspace_id: workspace1, phone_number: "+1222333" + Math.floor(1000 + Math.random() * 9000).toString(), provider: 'telnyx', name: 'Tracking 1' } 
    });
    trackingNumber1 = pn.phone_number;
  });

  it('R3A-01: Correctly calculates Total call count based on actual calls', async () => {
    await prisma.call.create({
      data: { workspace_id: workspace1, provider: 'telnyx', provider_call_id: 'call_1', from_number: '+1', to_number: trackingNumber1, state: 'COMPLETED' }
    });
    
    const res = await service.getMetrics(workspace1, {});
    expect(res.total).toBe(1);
  });

  it('R3A-04 & R3A-05: Returns 0 (not null/NaN) when no calls match', async () => {
    const res = await service.getMetrics(workspace1, {});
    expect(res.total).toBe(0);
    expect(res.answered).toBe(0);
    expect(res.aclSecs).toBeNull(); 
  });
  
  it('R3A-28 & R3A-29: Tenant isolation applies to reporting queries', async () => {
    await prisma.call.create({
      data: { workspace_id: workspace2, provider: 'telnyx', provider_call_id: 'call_ws2', from_number: '+1', to_number: '+2', state: 'COMPLETED' }
    });
    
    const res = await service.getMetrics(workspace1, {});
    expect(res.total).toBe(0); // WS1 shouldn't see WS2's calls
  });
  
  it('R3A-14: Filtering by time range works correctly', async () => {
    await prisma.call.create({
      data: { workspace_id: workspace1, provider: 'telnyx', provider_call_id: 'call_old', from_number: '+1', to_number: '+2', state: 'COMPLETED', created_at: new Date('2025-01-01T00:00:00Z') }
    });
    await prisma.call.create({
      data: { workspace_id: workspace1, provider: 'telnyx', provider_call_id: 'call_new', from_number: '+1', to_number: '+2', state: 'COMPLETED', created_at: new Date('2026-09-01T00:00:00Z') }
    });
    
    const res = await service.getMetrics(workspace1, { startDate: '2026-01-01T00:00:00Z' });
    expect(res.total).toBe(1);
  });
  
  it('R3A-20: Time-series foundation buckets calls by hour, day, or week', async () => {
    await prisma.call.create({
      data: { workspace_id: workspace1, provider: 'telnyx', provider_call_id: 'c1', from_number: '+1', to_number: '+2', state: 'COMPLETED', created_at: new Date('2026-09-01T10:00:00Z') }
    });
    await prisma.call.create({
      data: { workspace_id: workspace1, provider: 'telnyx', provider_call_id: 'c2', from_number: '+1', to_number: '+2', state: 'NO_ANSWER', created_at: new Date('2026-09-01T15:00:00Z') }
    });
    
    const res = await service.getMetrics(workspace1, { bucket: 'day' });
    expect(res.buckets).toBeDefined();
    expect(res.buckets.length).toBe(1);
    expect(res.buckets[0].total).toBe(2);
    expect(res.buckets[0].answered).toBe(1);
    expect(res.buckets[0].missed).toBe(1);
  });
});
