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
  let user1: string;

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
    user1 = 'u_' + Math.random().toString(36).substring(7);
    let user2 = 'u_' + Math.random().toString(36).substring(7);
    await prisma.profile.create({ data: { id: user1, display_name: 'Owner' } });
    await prisma.profile.create({ data: { id: user2, display_name: 'Owner 2' } });
    await prisma.workspaceMember.create({ data: { workspace_id: workspace1, user_id: user1, role: 'OWNER', participant_type: 'INTERNAL' } });
    await prisma.workspaceMember.create({ data: { workspace_id: workspace2, user_id: user2, role: 'OWNER', participant_type: 'INTERNAL' } });
    
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
    
    const res = await service.getMetrics(workspace1, user1, {});
    expect(res.total).toBe(1);
  });

  it('R3A-04 & R3A-05: Returns 0 (not null/NaN) when no calls match', async () => {
    const res = await service.getMetrics(workspace1, user1, {});
    expect(res.total).toBe(0);
    expect(res.answered).toBe(0);
    expect(res.aclSecs).toBeNull(); 
  });
  
  it('R3A-28 & R3A-29: Tenant isolation applies to reporting queries', async () => {
    await prisma.call.create({
      data: { workspace_id: workspace2, provider: 'telnyx', provider_call_id: uniqueCallId('call_ws2'), from_number: '+1', to_number: '+2', state: 'COMPLETED' }
    });
    
    const res = await service.getMetrics(workspace1, user1, {});
    expect(res.total).toBe(0); // WS1 shouldn't see WS2's calls
  });
  
  it('R3A-14: Filtering by time range works correctly', async () => {
    await prisma.call.create({
      data: { workspace_id: workspace1, provider: 'telnyx', provider_call_id: uniqueCallId('call_old'), from_number: '+1', to_number: '+2', state: 'COMPLETED', created_at: new Date('2025-01-01T00:00:00Z') }
    });
    await prisma.call.create({
      data: { workspace_id: workspace1, provider: 'telnyx', provider_call_id: uniqueCallId('call_new'), from_number: '+1', to_number: '+2', state: 'COMPLETED', created_at: new Date('2026-09-01T00:00:00Z') }
    });
    
    const res = await service.getMetrics(workspace1, user1, { startDate: '2026-01-01T00:00:00Z' });
    expect(res.total).toBe(1);
  });
  
  it('R3A-20: Time-series foundation buckets calls by hour, day, or week', async () => {
    await prisma.call.create({
      data: { workspace_id: workspace1, provider: 'telnyx', provider_call_id: uniqueCallId('c1'), from_number: '+1', to_number: '+2', state: 'COMPLETED', created_at: new Date('2026-09-01T10:00:00Z') }
    });
    await prisma.call.create({
      data: { workspace_id: workspace1, provider: 'telnyx', provider_call_id: uniqueCallId('c2'), from_number: '+1', to_number: '+2', state: 'NO_ANSWER', created_at: new Date('2026-09-01T15:00:00Z') }
    });
    
    const res = await service.getMetrics(workspace1, user1, { bucket: 'day' });
    expect(res.buckets).toBeDefined();
    expect(res.buckets.length).toBe(1);
    expect(res.buckets[0].total).toBe(2);
    expect(res.buckets[0].answered).toBe(1);
    expect(res.buckets[0].missed).toBe(1);
  });

  it('Date Validation: Rejects invalid or reversed dates explicitly', async () => {
    await expect(service.getMetrics(workspace1, user1, { startDate: 'invalid-date' }))
      .rejects.toThrow('Invalid startDate');
      
    await expect(service.getMetrics(workspace1, user1, { startDate: '2026-09-10T00:00:00Z', endDate: '2026-09-01T00:00:00Z' }))
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
    
    let res = await service.getMetrics(workspace1, user1, { minDuration: '10', status: 'COMPLETED' });
    expect(res.total).toBe(2);
    
    res = await service.getMetrics(workspace1, user1, { minDuration: '10', status: 'COMPLETED', buyerId: buyer1 });
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
    
    const res = await service.getMetrics(workspace1, user1, {});
    
    expect(res.buyers[buyer1].total).toBe(1);
    expect(res.buyers[buyer1].answered).toBe(0);
    expect(res.buyers[buyer1].tclSecs).toBe(10);
    
    expect(res.buyers[b2.id].total).toBe(1);
    expect(res.buyers[b2.id].answered).toBe(1);
    expect(res.buyers[b2.id].tclSecs).toBe(290);
    
    expect(res.total).toBe(1); 
    expect(res.tclSecs).toBe(300); 
  });

  describe('REP-2: Blocked Caller Isolation & Authoritative Metrics', () => {
    it('TEST A: blocked-only dataset (failed = 0, blocked = 3)', async () => {
      const blockedNum = '+19998880001';
      await prisma.blockedCaller.create({
        data: { workspace_id: workspace1, phone_number: blockedNum, reason: 'Spam caller' },
      });

      for (let i = 0; i < 3; i++) {
        await prisma.call.create({
          data: {
            workspace_id: workspace1,
            provider: 'telnyx',
            provider_call_id: uniqueCallId(`c_blk_${i}`),
            from_number: blockedNum,
            to_number: trackingNumber1,
            state: 'FAILED',
          },
        });
      }

      const res = await service.getMetrics(workspace1, user1, {});
      expect(res.blocked).toBe(3);
      expect(res.failed).toBe(0);
    });

    it('TEST B: failed-only dataset (failed = 3, blocked = 0)', async () => {
      for (let i = 0; i < 3; i++) {
        await prisma.call.create({
          data: {
            workspace_id: workspace1,
            provider: 'telnyx',
            provider_call_id: uniqueCallId(`c_fail_${i}`),
            from_number: `+1777000000${i}`,
            to_number: trackingNumber1,
            state: 'FAILED',
          },
        });
      }

      const res = await service.getMetrics(workspace1, user1, {});
      expect(res.failed).toBe(3);
      expect(res.blocked).toBe(0);
    });

    it('TEST C: mixed dataset (failed = 5, blocked = 3)', async () => {
      const blockedNum = '+18889991111';
      await prisma.blockedCaller.create({
        data: { workspace_id: workspace1, phone_number: blockedNum },
      });

      // 3 blocked calls
      for (let i = 0; i < 3; i++) {
        await prisma.call.create({
          data: {
            workspace_id: workspace1,
            provider: 'telnyx',
            provider_call_id: uniqueCallId(`c_mixed_blk_${i}`),
            from_number: blockedNum,
            to_number: trackingNumber1,
            state: 'FAILED',
          },
        });
      }

      // 5 genuine failed calls
      for (let i = 0; i < 5; i++) {
        await prisma.call.create({
          data: {
            workspace_id: workspace1,
            provider: 'telnyx',
            provider_call_id: uniqueCallId(`c_mixed_fail_${i}`),
            from_number: `+1666000000${i}`,
            to_number: trackingNumber1,
            state: 'FAILED',
          },
        });
      }

      const res = await service.getMetrics(workspace1, user1, {});
      expect(res.failed).toBe(5);
      expect(res.blocked).toBe(3);
      expect(res.total).toBe(8);
    });

    it('TEST D: CANCELED remains included in missed', async () => {
      await prisma.call.create({
        data: {
          workspace_id: workspace1,
          provider: 'telnyx',
          provider_call_id: uniqueCallId('c_canc'),
          from_number: '+15551110001',
          to_number: trackingNumber1,
          state: 'CANCELED',
        },
      });
      await prisma.call.create({
        data: {
          workspace_id: workspace1,
          provider: 'telnyx',
          provider_call_id: uniqueCallId('c_noans'),
          from_number: '+15551110002',
          to_number: trackingNumber1,
          state: 'NO_ANSWER',
        },
      });

      const res = await service.getMetrics(workspace1, user1, {});
      expect(res.missed).toBe(2);
    });

    it('TEST E: answerRate calculation (answered=25, total=100 => 25)', async () => {
      // 25 answered calls
      for (let i = 0; i < 25; i++) {
        await prisma.call.create({
          data: {
            workspace_id: workspace1,
            provider: 'telnyx',
            provider_call_id: uniqueCallId(`c_ans_${i}`),
            from_number: '+1',
            to_number: trackingNumber1,
            state: 'COMPLETED',
          },
        });
      }
      // 75 missed calls (total 100)
      for (let i = 0; i < 75; i++) {
        await prisma.call.create({
          data: {
            workspace_id: workspace1,
            provider: 'telnyx',
            provider_call_id: uniqueCallId(`c_miss_${i}`),
            from_number: '+1',
            to_number: trackingNumber1,
            state: 'NO_ANSWER',
          },
        });
      }

      const res = await service.getMetrics(workspace1, user1, {});
      expect(res.total).toBe(100);
      expect(res.answered).toBe(25);
      expect(res.answerRate).toBe(25);
    });

    it('TEST F: answerRate zero total (total=0, answered=0 => 0)', async () => {
      const res = await service.getMetrics(workspace1, user1, {});
      expect(res.total).toBe(0);
      expect(res.answered).toBe(0);
      expect(res.answerRate).toBe(0);
      expect(Number.isNaN(res.answerRate)).toBe(false);
    });

    it('TEST G: date filters preserve semantics', async () => {
      const blockedNum = '+18883334444';
      await prisma.blockedCaller.create({
        data: { workspace_id: workspace1, phone_number: blockedNum },
      });

      // Call in 2026-08 (outside range)
      await prisma.call.create({
        data: {
          workspace_id: workspace1,
          provider: 'telnyx',
          provider_call_id: uniqueCallId('c_date_out'),
          from_number: blockedNum,
          to_number: trackingNumber1,
          state: 'FAILED',
          created_at: new Date('2026-08-15T00:00:00Z'),
        },
      });

      // Call in 2026-09 (inside range)
      await prisma.call.create({
        data: {
          workspace_id: workspace1,
          provider: 'telnyx',
          provider_call_id: uniqueCallId('c_date_in'),
          from_number: blockedNum,
          to_number: trackingNumber1,
          state: 'FAILED',
          created_at: new Date('2026-09-15T00:00:00Z'),
        },
      });

      const res = await service.getMetrics(workspace1, user1, {
        startDate: '2026-09-01T00:00:00Z',
        endDate: '2026-09-30T23:59:59Z',
      });
      expect(res.blocked).toBe(1);
      expect(res.failed).toBe(0);
    });

    it('TEST H: campaign filters preserve semantics', async () => {
      const blockedNum = '+18885556666';
      await prisma.blockedCaller.create({
        data: { workspace_id: workspace1, phone_number: blockedNum },
      });

      const camp2 = await prisma.campaign.create({
        data: { workspace_id: workspace1, name: 'Camp 2' },
      });

      // Call under campaign1
      await prisma.call.create({
        data: {
          workspace_id: workspace1,
          campaign_id: campaign1,
          provider: 'telnyx',
          provider_call_id: uniqueCallId('c_camp1'),
          from_number: blockedNum,
          to_number: trackingNumber1,
          state: 'FAILED',
        },
      });

      // Call under camp2
      await prisma.call.create({
        data: {
          workspace_id: workspace1,
          campaign_id: camp2.id,
          provider: 'telnyx',
          provider_call_id: uniqueCallId('c_camp2'),
          from_number: blockedNum,
          to_number: trackingNumber1,
          state: 'FAILED',
        },
      });

      const res = await service.getMetrics(workspace1, user1, { campaignId: campaign1 });
      expect(res.blocked).toBe(1);
      expect(res.failed).toBe(0);
    });

    it('TEST I: buyer filters preserve semantics', async () => {
      const c = await prisma.call.create({
        data: {
          workspace_id: workspace1,
          provider: 'telnyx',
          provider_call_id: uniqueCallId('c_buyer_attempt'),
          from_number: '+15554443333',
          to_number: trackingNumber1,
          state: 'FAILED',
        },
      });
      await prisma.callAttempt.create({
        data: { call_id: c.id, buyer_id: buyer1, state: 'FAILED' },
      });

      const res = await service.getMetrics(workspace1, user1, { buyerId: buyer1 });
      expect(res.failed).toBe(1);
      expect(res.blocked).toBe(0);
    });

    it('TEST J: tracking number filters preserve semantics', async () => {
      const blockedNum = '+19991112222';
      await prisma.blockedCaller.create({
        data: { workspace_id: workspace1, phone_number: blockedNum },
      });

      const otherTN = '+18889990000';
      await prisma.call.create({
        data: {
          workspace_id: workspace1,
          provider: 'telnyx',
          provider_call_id: uniqueCallId('c_tn1'),
          from_number: blockedNum,
          to_number: trackingNumber1,
          state: 'FAILED',
        },
      });
      await prisma.call.create({
        data: {
          workspace_id: workspace1,
          provider: 'telnyx',
          provider_call_id: uniqueCallId('c_tn2'),
          from_number: blockedNum,
          to_number: otherTN,
          state: 'FAILED',
        },
      });

      const res = await service.getMetrics(workspace1, user1, { trackingNumber: trackingNumber1 });
      expect(res.blocked).toBe(1);
      expect(res.total).toBe(1);
    });

    it('TEST K: tenant isolation: workspace A blocked caller never classifies workspace B call', async () => {
      const sharedNumber = '+15559998888';
      // Workspace 1 has blocked this number
      await prisma.blockedCaller.create({
        data: { workspace_id: workspace1, phone_number: sharedNumber },
      });

      // Workspace 2 has NOT blocked this number, but receives a failed call from it
      await prisma.call.create({
        data: {
          workspace_id: workspace2,
          provider: 'telnyx',
          provider_call_id: uniqueCallId('c_ws2_isolated'),
          from_number: sharedNumber,
          to_number: '+1000',
          state: 'FAILED',
        },
      });

      const user2 = (await prisma.workspaceMember.findFirst({ where: { workspace_id: workspace2 } }))!.user_id;
      const resWs2 = await service.getMetrics(workspace2, user2, {});
      expect(resWs2.failed).toBe(1);
      expect(resWs2.blocked).toBe(0); // Must NOT be counted as blocked in WS2!
    });

    it('TEST M: time-series failed count does not include BLOCKED_CALLER', async () => {
      const blockedNum = '+15557778888';
      await prisma.blockedCaller.create({
        data: { workspace_id: workspace1, phone_number: blockedNum },
      });

      const dayDate = new Date('2026-09-02T12:00:00Z');
      // 1 blocked call
      await prisma.call.create({
        data: {
          workspace_id: workspace1,
          provider: 'telnyx',
          provider_call_id: uniqueCallId('c_ts_blk'),
          from_number: blockedNum,
          to_number: trackingNumber1,
          state: 'FAILED',
          created_at: dayDate,
        },
      });
      // 2 genuine failed calls
      for (let i = 0; i < 2; i++) {
        await prisma.call.create({
          data: {
            workspace_id: workspace1,
            provider: 'telnyx',
            provider_call_id: uniqueCallId(`c_ts_fail_${i}`),
            from_number: `+1333000000${i}`,
            to_number: trackingNumber1,
            state: 'FAILED',
            created_at: dayDate,
          },
        });
      }

      const res = await service.getMetrics(workspace1, user1, { bucket: 'day' });
      expect(res.buckets).toBeDefined();
      expect(res.buckets.length).toBe(1);
      expect(res.buckets[0].failed).toBe(2);
      expect(res.buckets[0].blocked).toBe(1);
    });
  });
});
