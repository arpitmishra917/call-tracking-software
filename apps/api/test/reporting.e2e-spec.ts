import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { CallsService } from '../src/calls/calls.service.js';

describe('Reporting API Foundation (R3-A)', () => {
  const uniqueCallId = (base: string) => `${base}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
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
      data: { workspace_id: workspace1, provider: 'telnyx', provider_call_id: uniqueCallId('call_1'), from_number: '+1', to_number: trackingNumber1, state: 'COMPLETED' }
    });
    
    const res = await service.getMetrics(workspace1, '', {});
    expect(res.total).toBe(1);
  });

  it('R3A-04 & R3A-05: Returns 0 (not null/NaN) when no calls match', async () => {
    const res = await service.getMetrics(workspace1, '', {});
    expect(res.total).toBe(0);
    expect(res.answered).toBe(0);
    expect(res.aclSecs).toBeNull(); 
  });
  
  it('R3A-28 & R3A-29: Tenant isolation applies to reporting queries', async () => {
    await prisma.call.create({
      data: { workspace_id: workspace2, provider: 'telnyx', provider_call_id: uniqueCallId('call_ws2'), from_number: '+1', to_number: '+2', state: 'COMPLETED' }
    });
    
    const res = await service.getMetrics(workspace1, '', {});
    expect(res.total).toBe(0); // WS1 shouldn't see WS2's calls
  });
  
  it('R3A-14: Filtering by time range works correctly', async () => {
    await prisma.call.create({
      data: { workspace_id: workspace1, provider: 'telnyx', provider_call_id: uniqueCallId('call_old'), from_number: '+1', to_number: '+2', state: 'COMPLETED', created_at: new Date('2025-01-01T00:00:00Z') }
    });
    await prisma.call.create({
      data: { workspace_id: workspace1, provider: 'telnyx', provider_call_id: uniqueCallId('call_new'), from_number: '+1', to_number: '+2', state: 'COMPLETED', created_at: new Date('2026-09-01T00:00:00Z') }
    });
    
    const res = await service.getMetrics(workspace1, '', { startDate: '2026-01-01T00:00:00Z' });
    expect(res.total).toBe(1);
  });
  
  it('R3A-20: Time-series foundation buckets calls by hour, day, or week', async () => {
    await prisma.call.create({
      data: { workspace_id: workspace1, provider: 'telnyx', provider_call_id: uniqueCallId('c1'), from_number: '+1', to_number: '+2', state: 'COMPLETED', created_at: new Date('2026-09-01T10:00:00Z') }
    });
    await prisma.call.create({
      data: { workspace_id: workspace1, provider: 'telnyx', provider_call_id: uniqueCallId('c2'), from_number: '+1', to_number: '+2', state: 'NO_ANSWER', created_at: new Date('2026-09-01T15:00:00Z') }
    });
    
    const res = await service.getMetrics(workspace1, '', { bucket: 'day' });
    expect(res.buckets).toBeDefined();
    expect(res.buckets.length).toBe(1);
    expect(res.buckets[0].total).toBe(2);
    expect(res.buckets[0].answered).toBe(1);
    expect(res.buckets[0].missed).toBe(1);
  });

  it('Date Validation: Rejects invalid or reversed dates explicitly', async () => {
    await expect(service.getMetrics(workspace1, '', { startDate: 'invalid-date' }))
      .rejects.toThrow('Invalid startDate');
      
    await expect(service.getMetrics(workspace1, '', { startDate: '2026-09-10T00:00:00Z', endDate: '2026-09-01T00:00:00Z' }))
      .rejects.toThrow('startDate cannot be after endDate');
  });

  it('Filter Matrix: Testing combination of status, minDuration, buyerId', async () => {
    const c1 = await prisma.call.create({
      data: { workspace_id: workspace1, provider: 'telnyx', provider_call_id: uniqueCallId('c_filt1'), from_number: '+1', to_number: '+2', state: 'COMPLETED', duration_secs: 15 }
    });
    const c2 = await prisma.call.create({
      data: { workspace_id: workspace1, provider: 'telnyx', provider_call_id: uniqueCallId('c_filt2'), from_number: '+1', to_number: '+2', state: 'COMPLETED', duration_secs: 45 }
    });
    const c3 = await prisma.call.create({
      data: { workspace_id: workspace1, provider: 'telnyx', provider_call_id: uniqueCallId('c_filt3'), from_number: '+1', to_number: '+2', state: 'NO_ANSWER', duration_secs: 5 }
    });
    await prisma.callAttempt.create({
      data: { call_id: c2.id, buyer_id: buyer1, state: 'COMPLETED' }
    });
    
    let res = await service.getMetrics(workspace1, '', { minDuration: '10', status: 'COMPLETED' });
    expect(res.total).toBe(2);
    
    res = await service.getMetrics(workspace1, '', { minDuration: '10', status: 'COMPLETED', buyerId: buyer1 });
    expect(res.total).toBe(1);
    expect(res.avgDuration).toBe(45);
  });

  it('Buyer Aggregation: Validates separation of buyer attempts vs parent call', async () => {
    const b2 = await prisma.buyer.create({ data: { workspace_id: workspace1, name: 'Buyer 2', destination_number: '+2000' } });
    
    const pCall = await prisma.call.create({
      data: { workspace_id: workspace1, provider: 'telnyx', provider_call_id: uniqueCallId('p_call'), from_number: '+1', to_number: '+2', state: 'COMPLETED', started_at: new Date('2026-09-01T10:00:00Z'), ended_at: new Date('2026-09-01T10:05:00Z') }
    });
    
    await prisma.callAttempt.create({
      data: { call_id: pCall.id, buyer_id: buyer1, state: 'NO_ANSWER', started_at: new Date('2026-09-01T10:00:00Z'), ended_at: new Date('2026-09-01T10:00:10Z') }
    });
    await prisma.callAttempt.create({
      data: { call_id: pCall.id, buyer_id: b2.id, state: 'COMPLETED', started_at: new Date('2026-09-01T10:00:10Z'), ended_at: new Date('2026-09-01T10:05:00Z') }
    });
    
    const res = await service.getMetrics(workspace1, '', {});
    
    expect(res.buyers[buyer1].total).toBe(1);
    expect(res.buyers[buyer1].answered).toBe(0);
    expect(res.buyers[buyer1].tclSecs).toBe(10);
    
    expect(res.buyers[b2.id].total).toBe(1);
    expect(res.buyers[b2.id].answered).toBe(1);
    expect(res.buyers[b2.id].tclSecs).toBe(290);
    
    expect(res.total).toBe(1); 
    expect(res.tclSecs).toBe(300); 
  });
});
