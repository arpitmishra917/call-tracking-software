import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { CallsService } from '../src/calls/calls.service.js';
import { CommercialStatus, DisputeStatus } from '@prisma/client';

describe('COMM-6 Commercial Reporting Integration E2E', () => {
  const uniqueId = (base: string) => `${base}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  let app: INestApplication;
  let prisma: PrismaService;
  let service: CallsService;

  let workspace1: string;
  let workspace2: string;
  let campaign1: string;
  let campaign2: string;
  let buyer1: string;
  let buyer2: string;
  let trackingNumber1: string;
  let trackingNumber2: string;
  let user1: string;
  let user2: string;

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
    const url = process.env.DATABASE_URL || '';
    if (!url.includes('_test')) {
      throw new Error('Safety check failed: E2E tests must use the test database');
    }

    const ws1 = await prisma.workspace.create({ data: { name: 'CommRep WS 1', slug: 'comm-ws1-' + Math.random() } });
    workspace1 = ws1.id;
    const ws2 = await prisma.workspace.create({ data: { name: 'CommRep WS 2', slug: 'comm-ws2-' + Math.random() } });
    workspace2 = ws2.id;

    user1 = 'u_' + Math.random().toString(36).substring(7);
    user2 = 'u_' + Math.random().toString(36).substring(7);
    await prisma.profile.create({ data: { id: user1, display_name: 'Owner 1' } });
    await prisma.profile.create({ data: { id: user2, display_name: 'Owner 2' } });
    await prisma.workspaceMember.create({ data: { workspace_id: workspace1, user_id: user1, role: 'OWNER', participant_type: 'INTERNAL' } });
    await prisma.workspaceMember.create({ data: { workspace_id: workspace2, user_id: user2, role: 'OWNER', participant_type: 'INTERNAL' } });

    const c1 = await prisma.campaign.create({
      data: {
        workspace_id: workspace1,
        name: 'Auto Insurance US',
        currency: 'USD',
        default_revenue_amount: 50.0,
        default_payout_amount: 30.0,
        conversion_duration_secs: 60,
      },
    });
    campaign1 = c1.id;

    const c2 = await prisma.campaign.create({
      data: {
        workspace_id: workspace1,
        name: 'Home Security US',
        currency: 'USD',
        default_revenue_amount: 100.0,
        default_payout_amount: 60.0,
        conversion_duration_secs: 120,
      },
    });
    campaign2 = c2.id;

    const b1 = await prisma.buyer.create({
      data: { workspace_id: workspace1, name: 'Buyer Alpha', destination_number: '+18001112222' },
    });
    buyer1 = b1.id;

    const b2 = await prisma.buyer.create({
      data: { workspace_id: workspace1, name: 'Buyer Beta', destination_number: '+18003334444' },
    });
    buyer2 = b2.id;

    const pn1 = await prisma.phoneNumber.create({
      data: {
        workspace_id: workspace1,
        phone_number: '+1900' + Math.floor(1000000 + Math.random() * 9000000).toString(),
        provider: 'telnyx',
        name: 'Tracking Main',
      },
    });
    trackingNumber1 = pn1.phone_number;

    const pn2 = await prisma.phoneNumber.create({
      data: {
        workspace_id: workspace1,
        phone_number: '+1900' + Math.floor(1000000 + Math.random() * 9000000).toString(),
        provider: 'telnyx',
        name: 'Tracking Secondary',
      },
    });
    trackingNumber2 = pn2.phone_number;
  });

  // Helper to create Call + CallCommercial + CallAttempt
  async function createEvaluatedCall(params: {
    workspaceId: string;
    campaignId?: string;
    buyerId?: string;
    toNumber?: string;
    fromNumber?: string;
    state?: any;
    durationSecs?: number;
    revenue: number;
    payout: number;
    cost: number;
    profit: number;
    converted: boolean;
    qualified: boolean;
    duplicate: boolean;
    status?: CommercialStatus;
    currency?: string;
    createdAt?: Date;
  }) {
    const call = await prisma.call.create({
      data: {
        workspace_id: params.workspaceId,
        provider: 'telnyx',
        provider_call_id: uniqueId('call'),
        campaign_id: params.campaignId,
        to_number: params.toNumber || trackingNumber1,
        from_number: params.fromNumber || '+15551234567',
        state: params.state || 'COMPLETED',
        duration_secs: params.durationSecs ?? 75,
        started_at: params.createdAt || new Date('2026-09-01T10:00:00Z'),
        answered_at: params.createdAt || new Date('2026-09-01T10:00:05Z'),
        ended_at: new Date((params.createdAt ? params.createdAt.getTime() : new Date('2026-09-01T10:00:00Z').getTime()) + ((params.durationSecs ?? 75) * 1000)),
        created_at: params.createdAt || new Date('2026-09-01T10:00:00Z'),
      },
    });

    if (params.buyerId) {
      await prisma.callAttempt.create({
        data: {
          call_id: call.id,
          buyer_id: params.buyerId,
          state: 'COMPLETED',
          started_at: call.started_at,
          ended_at: call.ended_at,
          created_at: call.created_at,
        },
      });
    }

    const comm = await prisma.callCommercial.create({
      data: {
        workspace_id: params.workspaceId,
        call_id: call.id,
        campaign_id: params.campaignId || campaign1,
        buyer_id: params.buyerId,
        revenue: params.revenue,
        payout: params.payout,
        cost: params.cost,
        profit: params.profit,
        converted: params.converted,
        qualified: params.qualified,
        duplicate: params.duplicate,
        status: params.status || CommercialStatus.SETTLED,
        currency: params.currency || 'USD',
        created_at: call.created_at,
      },
    });

    return { call, commercial: comm };
  }

  // 1. KPI cards show correct revenue, payout, profit, cost, converted, qualified, duplicate, conversion rate
  it('CR-01: calculates aggregate revenue, payout, profit, cost, converted, qualified, duplicate, and conversion rate', async () => {
    // Call 1: converted, qualified, non-duplicate
    await createEvaluatedCall({
      workspaceId: workspace1,
      campaignId: campaign1,
      buyerId: buyer1,
      revenue: 50.0,
      payout: 30.0,
      cost: 2.5,
      profit: 17.5,
      converted: true,
      qualified: true,
      duplicate: false,
    });

    // Call 2: non-converted, non-qualified, non-duplicate
    await createEvaluatedCall({
      workspaceId: workspace1,
      campaignId: campaign1,
      buyerId: buyer1,
      revenue: 0.0,
      payout: 0.0,
      cost: 1.0,
      profit: -1.0,
      converted: false,
      qualified: false,
      duplicate: false,
    });

    // Call 3: converted, qualified, duplicate
    await createEvaluatedCall({
      workspaceId: workspace1,
      campaignId: campaign1,
      buyerId: buyer1,
      revenue: 50.0,
      payout: 30.0,
      cost: 2.0,
      profit: 18.0,
      converted: true,
      qualified: true,
      duplicate: true,
    });

    const metrics = await service.getMetrics(workspace1, user1, {});

    expect(metrics.total).toBe(3);
    expect(metrics.commercialCalls).toBe(3);
    expect(metrics.revenue).toBe(100.0);
    expect(metrics.payout).toBe(60.0);
    expect(metrics.cost).toBe(5.5);
    expect(metrics.profit).toBe(34.5);
    expect(metrics.converted).toBe(2);
    expect(metrics.qualified).toBe(2);
    expect(metrics.duplicate).toBe(1);
    expect(metrics.conversionRate).toBe(66.67);
  });

  // 2. Conversion rate handles 0 commercial calls gracefully (returns 0, not NaN or null)
  it('CR-02: returns 0 conversion rate and 0 commercial metrics when no commercial calls exist', async () => {
    // Operational call without commercial record
    await prisma.call.create({
      data: {
        workspace_id: workspace1,
        provider: 'telnyx',
        provider_call_id: uniqueId('op_call'),
        state: 'COMPLETED',
        to_number: trackingNumber1,
        from_number: '+15559998888',
      },
    });

    const metrics = await service.getMetrics(workspace1, user1, {});

    expect(metrics.total).toBe(1);
    expect(metrics.commercialCalls).toBe(0);
    expect(metrics.revenue).toBe(0);
    expect(metrics.payout).toBe(0);
    expect(metrics.cost).toBe(0);
    expect(metrics.profit).toBe(0);
    expect(metrics.converted).toBe(0);
    expect(metrics.qualified).toBe(0);
    expect(metrics.duplicate).toBe(0);
    expect(metrics.conversionRate).toBe(0);
  });

  // 3. Campaign performance breakdown shows commercial metrics per campaign
  it('CR-03: aggregates commercial metrics per campaign correctly', async () => {
    await createEvaluatedCall({
      workspaceId: workspace1,
      campaignId: campaign1,
      buyerId: buyer1,
      revenue: 50.0,
      payout: 30.0,
      cost: 2.0,
      profit: 18.0,
      converted: true,
      qualified: true,
      duplicate: false,
    });

    await createEvaluatedCall({
      workspaceId: workspace1,
      campaignId: campaign2,
      buyerId: buyer2,
      revenue: 100.0,
      payout: 60.0,
      cost: 5.0,
      profit: 35.0,
      converted: true,
      qualified: true,
      duplicate: false,
    });

    const metrics = await service.getMetrics(workspace1, user1, {});

    expect(metrics.campaigns[campaign1].revenue).toBe(50.0);
    expect(metrics.campaigns[campaign1].payout).toBe(30.0);
    expect(metrics.campaigns[campaign1].cost).toBe(2.0);
    expect(metrics.campaigns[campaign1].profit).toBe(18.0);
    expect(metrics.campaigns[campaign1].converted).toBe(1);
    expect(metrics.campaigns[campaign1].conversionRate).toBe(100);

    expect(metrics.campaigns[campaign2].revenue).toBe(100.0);
    expect(metrics.campaigns[campaign2].payout).toBe(60.0);
    expect(metrics.campaigns[campaign2].cost).toBe(5.0);
    expect(metrics.campaigns[campaign2].profit).toBe(35.0);
    expect(metrics.campaigns[campaign2].converted).toBe(1);
    expect(metrics.campaigns[campaign2].conversionRate).toBe(100);
  });

  // 4. Buyer performance breakdown shows commercial metrics per buyer
  it('CR-04: aggregates commercial metrics per buyer correctly', async () => {
    await createEvaluatedCall({
      workspaceId: workspace1,
      campaignId: campaign1,
      buyerId: buyer1,
      revenue: 50.0,
      payout: 30.0,
      cost: 2.0,
      profit: 18.0,
      converted: true,
      qualified: true,
      duplicate: false,
    });

    await createEvaluatedCall({
      workspaceId: workspace1,
      campaignId: campaign1,
      buyerId: buyer2,
      revenue: 0.0,
      payout: 0.0,
      cost: 1.0,
      profit: -1.0,
      converted: false,
      qualified: false,
      duplicate: false,
    });

    const metrics = await service.getMetrics(workspace1, user1, {});

    expect(metrics.buyers[buyer1].revenue).toBe(50.0);
    expect(metrics.buyers[buyer1].payout).toBe(30.0);
    expect(metrics.buyers[buyer1].profit).toBe(18.0);
    expect(metrics.buyers[buyer1].cost).toBe(2.0);
    expect(metrics.buyers[buyer1].converted).toBe(1);
    expect(metrics.buyers[buyer1].conversionRate).toBe(100);

    expect(metrics.buyers[buyer2].revenue).toBe(0);
    expect(metrics.buyers[buyer2].payout).toBe(0);
    expect(metrics.buyers[buyer2].profit).toBe(-1.0);
    expect(metrics.buyers[buyer2].cost).toBe(1.0);
    expect(metrics.buyers[buyer2].converted).toBe(0);
    expect(metrics.buyers[buyer2].conversionRate).toBe(0);
  });

  // 5. Tracking number breakdown includes commercial columns
  it('CR-05: aggregates commercial metrics per tracking number correctly', async () => {
    await createEvaluatedCall({
      workspaceId: workspace1,
      campaignId: campaign1,
      buyerId: buyer1,
      toNumber: trackingNumber1,
      revenue: 50.0,
      payout: 30.0,
      cost: 2.0,
      profit: 18.0,
      converted: true,
      qualified: true,
      duplicate: false,
    });

    await createEvaluatedCall({
      workspaceId: workspace1,
      campaignId: campaign2,
      buyerId: buyer2,
      toNumber: trackingNumber2,
      revenue: 100.0,
      payout: 60.0,
      cost: 4.0,
      profit: 36.0,
      converted: true,
      qualified: true,
      duplicate: false,
    });

    const metrics = await service.getMetrics(workspace1, user1, {});

    expect(metrics.trackingNumbers[trackingNumber1].revenue).toBe(50.0);
    expect(metrics.trackingNumbers[trackingNumber1].profit).toBe(18.0);
    expect(metrics.trackingNumbers[trackingNumber2].revenue).toBe(100.0);
    expect(metrics.trackingNumbers[trackingNumber2].profit).toBe(36.0);
  });

  // 6. Time-series buckets include commercial metrics
  it('CR-06: includes commercial metrics in time-series buckets', async () => {
    const day = new Date('2026-09-15T12:00:00Z');
    await createEvaluatedCall({
      workspaceId: workspace1,
      campaignId: campaign1,
      buyerId: buyer1,
      revenue: 50.0,
      payout: 30.0,
      cost: 3.0,
      profit: 17.0,
      converted: true,
      qualified: true,
      duplicate: false,
      createdAt: day,
    });

    const metrics = await service.getMetrics(workspace1, user1, { bucket: 'day' });

    expect(metrics.buckets.length).toBeGreaterThanOrEqual(1);
    const b = metrics.buckets[0];
    expect(b.revenue).toBe(50.0);
    expect(b.payout).toBe(30.0);
    expect(b.cost).toBe(3.0);
    expect(b.profit).toBe(17.0);
    expect(b.converted).toBe(1);
    expect(b.qualified).toBe(1);
    expect(b.commercialCalls).toBe(1);
    expect(b.conversionRate).toBe(100);
  });

  // 7. Accepted disputes reflect reduced revenue/payout in reporting without double adjustment
  it('CR-07: accurately reflects accepted dispute adjustments (revenue=0, payout=0, profit=-cost)', async () => {
    const { call, commercial } = await createEvaluatedCall({
      workspaceId: workspace1,
      campaignId: campaign1,
      buyerId: buyer1,
      revenue: 0.0, // Reversal from COMM-5 accepted dispute
      payout: 0.0,
      cost: 2.0,
      profit: -2.0,
      converted: true,
      qualified: true,
      duplicate: false,
      status: CommercialStatus.ADJUSTED,
    });

    const disp = await prisma.callDispute.create({
      data: {
        workspace_id: workspace1,
        call_commercial_id: commercial.id,
        buyer_id: buyer1,
        created_by_user_id: user1,
        reason: 'Wrong number test',
        status: DisputeStatus.ACCEPTED,
        resolved_at: new Date(),
        resolved_by_user_id: user1,
        resolution_notes: 'Full reversal',
      },
    });

    await prisma.callFinancialAdjustment.create({
      data: {
        workspace_id: workspace1,
        call_commercial_id: commercial.id,
        dispute_id: disp.id,
        original_revenue: 50.0,
        original_payout: 30.0,
        adjusted_revenue: 0.0,
        adjusted_payout: 0.0,
        reason: 'Accepted dispute full reversal',
      },
    });

    const metrics = await service.getMetrics(workspace1, user1, {});

    // Revenue and payout must be 0, profit must be -2.0, cost must be 2.0
    expect(metrics.revenue).toBe(0.0);
    expect(metrics.payout).toBe(0.0);
    expect(metrics.cost).toBe(2.0);
    expect(metrics.profit).toBe(-2.0);
    expect(metrics.converted).toBe(1);
  });

  // 8. Rejected disputes leave original revenue/payout intact
  it('CR-08: leaves original revenue and payout intact for rejected disputes', async () => {
    const { commercial } = await createEvaluatedCall({
      workspaceId: workspace1,
      campaignId: campaign1,
      buyerId: buyer1,
      revenue: 50.0,
      payout: 30.0,
      cost: 2.0,
      profit: 18.0,
      converted: true,
      qualified: true,
      duplicate: false,
      status: CommercialStatus.SETTLED,
    });

    await prisma.callDispute.create({
      data: {
        workspace_id: workspace1,
        call_commercial_id: commercial.id,
        buyer_id: buyer1,
        created_by_user_id: user1,
        reason: 'Invalid call claim',
        status: DisputeStatus.REJECTED,
        resolved_at: new Date(),
        resolved_by_user_id: user1,
        resolution_notes: 'Call was valid',
      },
    });

    const metrics = await service.getMetrics(workspace1, user1, {});

    expect(metrics.revenue).toBe(50.0);
    expect(metrics.payout).toBe(30.0);
    expect(metrics.cost).toBe(2.0);
    expect(metrics.profit).toBe(18.0);
  });

  // 9. Pending disputes leave current revenue/payout intact until resolved
  it('CR-09: leaves current economics intact while dispute is PENDING', async () => {
    const { commercial } = await createEvaluatedCall({
      workspaceId: workspace1,
      campaignId: campaign1,
      buyerId: buyer1,
      revenue: 50.0,
      payout: 30.0,
      cost: 2.0,
      profit: 18.0,
      converted: true,
      qualified: true,
      duplicate: false,
      status: CommercialStatus.DISPUTED,
    });

    await prisma.callDispute.create({
      data: {
        workspace_id: workspace1,
        call_commercial_id: commercial.id,
        buyer_id: buyer1,
        created_by_user_id: user1,
        reason: 'Under review',
        status: DisputeStatus.PENDING,
      },
    });

    const metrics = await service.getMetrics(workspace1, user1, {});

    expect(metrics.revenue).toBe(50.0);
    expect(metrics.payout).toBe(30.0);
    expect(metrics.profit).toBe(18.0);
  });

  // 10. Campaign filter narrows all commercial metrics to that campaign
  it('CR-10: filters commercial metrics strictly by campaignId', async () => {
    await createEvaluatedCall({
      workspaceId: workspace1,
      campaignId: campaign1,
      buyerId: buyer1,
      revenue: 50.0,
      payout: 30.0,
      cost: 2.0,
      profit: 18.0,
      converted: true,
      qualified: true,
      duplicate: false,
    });

    await createEvaluatedCall({
      workspaceId: workspace1,
      campaignId: campaign2,
      buyerId: buyer2,
      revenue: 100.0,
      payout: 60.0,
      cost: 5.0,
      profit: 35.0,
      converted: true,
      qualified: true,
      duplicate: false,
    });

    const metrics = await service.getMetrics(workspace1, user1, { campaignId: campaign1 });

    expect(metrics.revenue).toBe(50.0);
    expect(metrics.payout).toBe(30.0);
    expect(metrics.profit).toBe(18.0);
    expect(metrics.cost).toBe(2.0);
    expect(metrics.converted).toBe(1);
    expect(metrics.commercialCalls).toBe(1);
  });

  // 11. Buyer filter narrows all commercial metrics to that buyer
  it('CR-11: filters commercial metrics strictly by buyerId', async () => {
    await createEvaluatedCall({
      workspaceId: workspace1,
      campaignId: campaign1,
      buyerId: buyer1,
      revenue: 50.0,
      payout: 30.0,
      cost: 2.0,
      profit: 18.0,
      converted: true,
      qualified: true,
      duplicate: false,
    });

    await createEvaluatedCall({
      workspaceId: workspace1,
      campaignId: campaign1,
      buyerId: buyer2,
      revenue: 50.0,
      payout: 30.0,
      cost: 2.0,
      profit: 18.0,
      converted: true,
      qualified: true,
      duplicate: false,
    });

    const metrics = await service.getMetrics(workspace1, user1, { buyerId: buyer1 });

    expect(metrics.revenue).toBe(50.0);
    expect(metrics.payout).toBe(30.0);
    expect(metrics.commercialCalls).toBe(1);
  });

  // 12. Date range filter correctly bounds commercial metrics
  it('CR-12: date range filter correctly includes and excludes commercial metrics', async () => {
    const oldDate = new Date('2025-05-01T10:00:00Z');
    const newDate = new Date('2026-05-01T10:00:00Z');

    await createEvaluatedCall({
      workspaceId: workspace1,
      campaignId: campaign1,
      buyerId: buyer1,
      revenue: 50.0,
      payout: 30.0,
      cost: 2.0,
      profit: 18.0,
      converted: true,
      qualified: true,
      duplicate: false,
      createdAt: oldDate,
    });

    await createEvaluatedCall({
      workspaceId: workspace1,
      campaignId: campaign1,
      buyerId: buyer1,
      revenue: 100.0,
      payout: 60.0,
      cost: 4.0,
      profit: 36.0,
      converted: true,
      qualified: true,
      duplicate: false,
      createdAt: newDate,
    });

    const metrics = await service.getMetrics(workspace1, user1, { startDate: '2026-01-01T00:00:00Z' });

    expect(metrics.revenue).toBe(100.0);
    expect(metrics.payout).toBe(60.0);
    expect(metrics.profit).toBe(36.0);
    expect(metrics.commercialCalls).toBe(1);
  });

  // 13. Calls without CallCommercial do not inflate commercial metrics
  it('CR-13: calls without CallCommercial do not inflate commercial metrics', async () => {
    // 1 commercial call
    await createEvaluatedCall({
      workspaceId: workspace1,
      campaignId: campaign1,
      buyerId: buyer1,
      revenue: 50.0,
      payout: 30.0,
      cost: 2.0,
      profit: 18.0,
      converted: true,
      qualified: true,
      duplicate: false,
    });

    // 2 operational-only calls
    await prisma.call.create({
      data: {
        workspace_id: workspace1,
        provider: 'telnyx',
        provider_call_id: uniqueId('op_1'),
        state: 'COMPLETED',
        to_number: trackingNumber1,
        from_number: '+15551112222',
      },
    });
    await prisma.call.create({
      data: {
        workspace_id: workspace1,
        provider: 'telnyx',
        provider_call_id: uniqueId('op_2'),
        state: 'COMPLETED',
        to_number: trackingNumber1,
        from_number: '+15551113333',
      },
    });

    const metrics = await service.getMetrics(workspace1, user1, {});

    expect(metrics.total).toBe(3);
    expect(metrics.commercialCalls).toBe(1);
    expect(metrics.converted).toBe(1);
    expect(metrics.conversionRate).toBe(100);
    expect(metrics.revenue).toBe(50.0);
  });

  // 14. Calls with commercial evaluation maintain historical snapshot even if campaign changes
  it('CR-14: preserves snapshot economics even after campaign amounts are changed', async () => {
    const { commercial } = await createEvaluatedCall({
      workspaceId: workspace1,
      campaignId: campaign1,
      buyerId: buyer1,
      revenue: 50.0,
      payout: 30.0,
      cost: 2.0,
      profit: 18.0,
      converted: true,
      qualified: true,
      duplicate: false,
    });

    // Mutate campaign configuration
    await prisma.campaign.update({
      where: { id: campaign1 },
      data: {
        default_revenue_amount: 999.0,
        default_payout_amount: 888.0,
      },
    });

    const metrics = await service.getMetrics(workspace1, user1, {});

    // Must read snapshot values, NOT new campaign default values
    expect(metrics.revenue).toBe(50.0);
    expect(metrics.payout).toBe(30.0);
    expect(metrics.profit).toBe(18.0);
  });

  // 15. Call log table returns commercial fields for each call
  it('CR-15: getCalls returns commercial fields, buyer, and dispute status for each call', async () => {
    const { call, commercial } = await createEvaluatedCall({
      workspaceId: workspace1,
      campaignId: campaign1,
      buyerId: buyer1,
      revenue: 50.0,
      payout: 30.0,
      cost: 2.0,
      profit: 18.0,
      converted: true,
      qualified: true,
      duplicate: false,
      status: CommercialStatus.PENDING,
    });

    await prisma.callDispute.create({
      data: {
        workspace_id: workspace1,
        call_commercial_id: commercial.id,
        buyer_id: buyer1,
        created_by_user_id: user1,
        reason: 'Call quality poor',
        status: DisputeStatus.PENDING,
      },
    });

    const res = await service.getCalls(workspace1, user1, {});

    expect(res.items.length).toBe(1);
    const item = res.items[0];
    expect(item.commercial).toBeDefined();
    expect(item.commercial.revenue).toBe(50.0);
    expect(item.commercial.payout).toBe(30.0);
    expect(item.commercial.profit).toBe(18.0);
    expect(item.commercial.cost).toBe(2.0);
    expect(item.commercial.converted).toBe(true);
    expect(item.commercial.qualified).toBe(true);
    expect(item.commercial.duplicate).toBe(false);
    expect(item.commercial.currency).toBe('USD');
    expect(item.commercial.status).toBe(CommercialStatus.PENDING);
    expect(item.commercial.disputeStatus).toBe(DisputeStatus.PENDING);
    expect(item.commercial.disputeReason).toBe('Call quality poor');
    expect(item.commercial.buyer?.id).toBe(buyer1);
  });

  // 16. Call detail endpoint returns full commercial economics
  it('CR-16: getCallDetail returns complete commercial economics, dispute, and adjustment', async () => {
    const { call, commercial } = await createEvaluatedCall({
      workspaceId: workspace1,
      campaignId: campaign1,
      buyerId: buyer1,
      revenue: 0.0,
      payout: 0.0,
      cost: 2.5,
      profit: -2.5,
      converted: true,
      qualified: true,
      duplicate: false,
      status: CommercialStatus.ADJUSTED,
    });

    const dispute = await prisma.callDispute.create({
      data: {
        workspace_id: workspace1,
        call_commercial_id: commercial.id,
        buyer_id: buyer1,
        created_by_user_id: user1,
        reason: 'Wrong intent',
        status: DisputeStatus.ACCEPTED,
        resolved_at: new Date(),
        resolved_by_user_id: user1,
      },
    });

    const adjustment = await prisma.callFinancialAdjustment.create({
      data: {
        workspace_id: workspace1,
        call_commercial_id: commercial.id,
        dispute_id: dispute.id,
        original_revenue: 50.0,
        original_payout: 30.0,
        adjusted_revenue: 0.0,
        adjusted_payout: 0.0,
        reason: 'Accepted dispute full reversal',
      },
    });

    const detail = await service.getCallDetail(workspace1, call.id);

    expect(detail.commercial).toBeDefined();
    expect(Number(detail.commercial!.revenue)).toBe(0.0);
    expect(Number(detail.commercial!.payout)).toBe(0.0);
    expect(Number(detail.commercial!.cost)).toBe(2.5);
    expect(Number(detail.commercial!.profit)).toBe(-2.5);
    expect(detail.commercial!.status).toBe(CommercialStatus.ADJUSTED);
    expect(detail.commercial!.dispute).toBeDefined();
    expect(detail.commercial!.dispute?.status).toBe(DisputeStatus.ACCEPTED);
    expect(detail.commercial!.adjustment).toBeDefined();
    expect(Number(detail.commercial!.adjustment!.original_revenue)).toBe(50.0);
    expect(Number(detail.commercial!.adjustment!.adjusted_revenue)).toBe(0.0);
  });

  // 17. Tenant isolation: Workspace A commercial metrics never leak into Workspace B
  it('CR-17: strictly isolates commercial metrics between workspaces', async () => {
    await createEvaluatedCall({
      workspaceId: workspace1,
      campaignId: campaign1,
      buyerId: buyer1,
      revenue: 100.0,
      payout: 60.0,
      cost: 5.0,
      profit: 35.0,
      converted: true,
      qualified: true,
      duplicate: false,
    });

    const metricsWs2 = await service.getMetrics(workspace2, user2, {});

    expect(metricsWs2.total).toBe(0);
    expect(metricsWs2.commercialCalls).toBe(0);
    expect(metricsWs2.revenue).toBe(0);
    expect(metricsWs2.payout).toBe(0);
    expect(metricsWs2.profit).toBe(0);
    expect(metricsWs2.cost).toBe(0);
    expect(metricsWs2.converted).toBe(0);
  });

  // 18. Multi-currency guard throws BadRequestException when multiple currencies present without campaign filter
  it('CR-18: multi-currency guard prevents summing mixed currencies without campaign filter', async () => {
    // Call in USD
    await createEvaluatedCall({
      workspaceId: workspace1,
      campaignId: campaign1,
      buyerId: buyer1,
      revenue: 50.0,
      payout: 30.0,
      cost: 2.0,
      profit: 18.0,
      converted: true,
      qualified: true,
      duplicate: false,
      currency: 'USD',
    });

    // Call in EUR
    const cEur = await prisma.campaign.create({
      data: {
        workspace_id: workspace1,
        name: 'EUR Campaign',
        currency: 'EUR',
      },
    });

    await createEvaluatedCall({
      workspaceId: workspace1,
      campaignId: cEur.id,
      buyerId: buyer1,
      revenue: 40.0,
      payout: 25.0,
      cost: 1.5,
      profit: 13.5,
      converted: true,
      qualified: true,
      duplicate: false,
      currency: 'EUR',
    });

    // Query across all campaigns with mixed currencies should throw BadRequestException
    await expect(service.getMetrics(workspace1, user1, {})).rejects.toThrow(
      'Workspace contains commercial records with multiple currencies. Please filter by campaign to isolate currency.',
    );

    // But filtering by USD campaign works cleanly
    const metricsUsd = await service.getMetrics(workspace1, user1, { campaignId: campaign1 });
    expect(metricsUsd.revenue).toBe(50.0);
    expect(metricsUsd.currency).toBe('USD');

    // And filtering by EUR campaign works cleanly
    const metricsEur = await service.getMetrics(workspace1, user1, { campaignId: cEur.id });
    expect(metricsEur.revenue).toBe(40.0);
    expect(metricsEur.currency).toBe('EUR');
  });

  // 19. Decimal precision: Large numbers, fractional pennies, and negative profits calculate correctly
  it('CR-19: preserves numeric precision with fractional values and negative profit', async () => {
    await createEvaluatedCall({
      workspaceId: workspace1,
      campaignId: campaign1,
      buyerId: buyer1,
      revenue: 12.3456,
      payout: 7.8912,
      cost: 1.2344,
      profit: 3.2200,
      converted: true,
      qualified: true,
      duplicate: false,
    });

    await createEvaluatedCall({
      workspaceId: workspace1,
      campaignId: campaign1,
      buyerId: buyer1,
      revenue: 0.0,
      payout: 0.0,
      cost: 10.50,
      profit: -10.50, // Negative profit
      converted: false,
      qualified: false,
      duplicate: false,
    });

    const metrics = await service.getMetrics(workspace1, user1, {});

    expect(metrics.revenue).toBe(12.3456);
    expect(metrics.payout).toBe(7.8912);
    expect(metrics.cost).toBe(11.7344);
    expect(metrics.profit).toBe(-7.28);
  });

  // 20. Call with missing cost does not break reporting metrics
  it('CR-20: calls with cost=0 are aggregated cleanly', async () => {
    await createEvaluatedCall({
      workspaceId: workspace1,
      campaignId: campaign1,
      buyerId: buyer1,
      revenue: 50.0,
      payout: 30.0,
      cost: 0.0,
      profit: 20.0,
      converted: true,
      qualified: true,
      duplicate: false,
    });

    const metrics = await service.getMetrics(workspace1, user1, {});

    expect(metrics.revenue).toBe(50.0);
    expect(metrics.payout).toBe(30.0);
    expect(metrics.cost).toBe(0.0);
    expect(metrics.profit).toBe(20.0);
  });

  // 21. Call log list pagination preserves commercial fields on paginated subsets
  it('CR-21: getCalls pagination preserves commercial snapshot across pages', async () => {
    for (let i = 0; i < 5; i++) {
      await createEvaluatedCall({
        workspaceId: workspace1,
        campaignId: campaign1,
        buyerId: buyer1,
        revenue: (i + 1) * 10,
        payout: (i + 1) * 5,
        cost: 1.0,
        profit: (i + 1) * 5 - 1.0,
        converted: true,
        qualified: true,
        duplicate: false,
      });
    }

    const page1 = await service.getCalls(workspace1, user1, { limit: 2, offset: 0 });
    expect(page1.items.length).toBe(2);
    expect(page1.total).toBe(5);
    expect(page1.items[0].commercial).toBeDefined();
    expect(page1.items[0].commercial.revenue).toBeGreaterThan(0);

    const page2 = await service.getCalls(workspace1, user1, { limit: 2, offset: 2 });
    expect(page2.items.length).toBe(2);
    expect(page2.total).toBe(5);
    expect(page2.items[0].commercial).toBeDefined();
  });

  // 22. Status filter on COMPLETED vs FAILED respects commercial queries
  it('CR-22: status filter filters both operational and commercial metrics accurately', async () => {
    // 1 completed commercial call
    await createEvaluatedCall({
      workspaceId: workspace1,
      campaignId: campaign1,
      buyerId: buyer1,
      state: 'COMPLETED',
      revenue: 50.0,
      payout: 30.0,
      cost: 2.0,
      profit: 18.0,
      converted: true,
      qualified: true,
      duplicate: false,
    });

    // 1 failed commercial call
    await createEvaluatedCall({
      workspaceId: workspace1,
      campaignId: campaign1,
      buyerId: buyer1,
      state: 'FAILED',
      revenue: 0.0,
      payout: 0.0,
      cost: 1.0,
      profit: -1.0,
      converted: false,
      qualified: false,
      duplicate: false,
    });

    const resCompleted = await service.getMetrics(workspace1, user1, { status: 'COMPLETED' });
    expect(resCompleted.total).toBe(1);
    expect(resCompleted.commercialCalls).toBe(1);
    expect(resCompleted.revenue).toBe(50.0);

    const resFailed = await service.getMetrics(workspace1, user1, { status: 'FAILED' });
    expect(resFailed.total).toBe(1);
    expect(resFailed.commercialCalls).toBe(1);
    expect(resFailed.revenue).toBe(0.0);
    expect(resFailed.cost).toBe(1.0);
  });
});
