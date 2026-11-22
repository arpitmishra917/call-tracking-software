import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, CallState, CallAttemptState } from '@prisma/client';
import { randomUUID } from 'crypto';
import { CallsService } from '../src/calls/calls.service.js';
import { ReservationRecoveryService } from '../src/telephony/reservation-recovery.service.js';
import { FakeTelephonyProvider } from '../src/telephony/fake.provider.js';
import { assertNonProductionDatabase } from '../src/common/database-isolation.util.js';

class MockWebhooksService {
  async queueEvent(): Promise<void> {}
}

describe('P2.2-B: Buyer Concurrency & Routing Transactions Integration Suite (Real PostgreSQL)', () => {
  const qaDbUrl =
    process.env.DATABASE_URL ||
    'postgresql://postgres:%2A222%2A2%23Arpit@localhost:5432/calltracking_mvp_test?schema=public';

  let prisma: PrismaClient;
  let callsService: CallsService;
  let recoveryService: ReservationRecoveryService;
  let fakeProvider: FakeTelephonyProvider;

  const createdWorkspaceIds: string[] = [];

  beforeAll(async () => {
    assertNonProductionDatabase(qaDbUrl, 'P2.2-B Buyer Concurrency Suite');
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: qaDbUrl,
        },
      },
    });
    await prisma.$connect();

    fakeProvider = new FakeTelephonyProvider();
    callsService = new CallsService(
      prisma as any,
      fakeProvider as any,
      new MockWebhooksService() as any,
      { getPricingConfig: () => ({ LOCAL_PER_MINUTE_MICRO: 45000n, TOLL_FREE_PER_MINUTE_MICRO: 55000n, RECORDING_PER_MINUTE_MICRO: 2500n }) } as any,
    );

    recoveryService = new ReservationRecoveryService(
      prisma as any,
      { releaseReservation: async () => {}, settleReservation: async () => {} } as any,
      { billUsage: async () => {} } as any,
      fakeProvider as any,
    );
  });

  afterAll(async () => {
    try {
      for (const wsId of createdWorkspaceIds) {
        await prisma.$executeRaw`DELETE FROM "buyer_reservations" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "call_attempts" WHERE call_id IN (SELECT id FROM "calls" WHERE workspace_id = ${wsId})`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "calls" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "campaign_destination_numbers" WHERE campaign_id IN (SELECT id FROM "campaigns" WHERE workspace_id = ${wsId})`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "campaign_buyers" WHERE campaign_id IN (SELECT id FROM "campaigns" WHERE workspace_id = ${wsId})`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "destination_numbers" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "buyers" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "campaigns" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "workspace_balances" WHERE workspace_id = ${wsId}`.catch(() => {});
        await prisma.$executeRaw`DELETE FROM "workspaces" WHERE id = ${wsId}`.catch(() => {});
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  async function createFixture() {
    const rawId = randomUUID();
    const wsId = `ws_p22b_${rawId}`;
    createdWorkspaceIds.push(wsId);

    await prisma.workspace.create({
      data: {
        id: wsId,
        name: `Buyer Concurrency WS ${rawId.slice(0, 8)}`,
        slug: `buyer-conc-${rawId}`,
        status: 'ACTIVE',
      },
    });

    const campaign = await prisma.campaign.create({
      data: {
        workspace_id: wsId,
        name: 'Concurrency Waterfall Campaign',
        status: 'ACTIVE',
      },
    });

    // Buyer 1: Capacity 1
    const buyer1 = await prisma.buyer.create({
      data: {
        workspace_id: wsId,
        name: 'Primary Buyer (Cap 1)',
        destination_number: '+15550001001',
        max_concurrent_calls: 1,
        status: 'ACTIVE',
      },
    });

    // Buyer 2: Capacity 2
    const buyer2 = await prisma.buyer.create({
      data: {
        workspace_id: wsId,
        name: 'Secondary Buyer (Cap 2)',
        destination_number: '+15550002002',
        max_concurrent_calls: 2,
        status: 'ACTIVE',
      },
    });

    // Attach buyers to campaign in waterfall priority
    await prisma.campaignBuyer.create({
      data: {
        workspace_id: wsId,
        campaign_id: campaign.id,
        buyer_id: buyer1.id,
        priority: 1,
        status: 'ACTIVE',
      },
    });

    await prisma.campaignBuyer.create({
      data: {
        workspace_id: wsId,
        campaign_id: campaign.id,
        buyer_id: buyer2.id,
        priority: 2,
        status: 'ACTIVE',
      },
    });

    return { wsId, campaignId: campaign.id, buyer1Id: buyer1.id, buyer2Id: buyer2.id };
  }

  async function createCallInRouting(wsId: string, campaignId: string): Promise<string> {
    const callId = `call_p22b_${randomUUID()}`;
    await prisma.call.create({
      data: {
        id: callId,
        workspace_id: wsId,
        campaign_id: campaignId,
        provider: 'telnyx',
        provider_call_id: `prov_${callId}`,
        from_number: '+15559998888',
        to_number: '+15557776666',
        state: CallState.ROUTING,
      },
    });
    return callId;
  }

  // 1. Concurrency limit enforcement
  it('1. Enforces buyer max_concurrent_calls limit: second call cannot route to buyer when capacity is 1', async () => {
    const { wsId, campaignId, buyer1Id } = await createFixture();

    const call1 = await createCallInRouting(wsId, campaignId);
    const route1 = await callsService.prepareNextBuyer(call1);

    expect(route1.action).toBe('DIAL');
    expect(route1.buyer?.id).toBe(buyer1Id);
    expect(route1.attempt).toBeDefined();

    // Verify 1 active reservation in PostgreSQL
    const reservations = await prisma.buyerReservation.findMany({
      where: { buyer_id: buyer1Id, status: 'ACTIVE' },
    });
    expect(reservations.length).toBe(1);
    expect(reservations[0].call_id).toBe(call1);
  });

  // 2. Simultaneous reservations race condition
  it('2. Simultaneous reservation race: 2 concurrent calls contend for 1 available slot -> exactly 1 dials Buyer 1, other waterfalls', async () => {
    const { wsId, campaignId, buyer1Id, buyer2Id } = await createFixture();

    const [callA, callB] = await Promise.all([
      createCallInRouting(wsId, campaignId),
      createCallInRouting(wsId, campaignId),
    ]);

    // Both calls invoke prepareNextBuyer concurrently against real PostgreSQL
    const [resA, resB] = await Promise.all([
      callsService.prepareNextBuyer(callA),
      callsService.prepareNextBuyer(callB),
    ]);

    expect(resA.action).toBe('DIAL');
    expect(resB.action).toBe('DIAL');

    // Exactly one call should have claimed Buyer 1 (cap 1), and the other should have fallen back to Buyer 2
    const buyer1Calls = [resA, resB].filter((r) => r.buyer?.id === buyer1Id);
    const buyer2Calls = [resA, resB].filter((r) => r.buyer?.id === buyer2Id);

    expect(buyer1Calls.length).toBe(1);
    expect(buyer2Calls.length).toBe(1);

    // Verify PostgreSQL row counts
    const b1Active = await prisma.buyerReservation.count({
      where: { buyer_id: buyer1Id, status: 'ACTIVE' },
    });
    const b2Active = await prisma.buyerReservation.count({
      where: { buyer_id: buyer2Id, status: 'ACTIVE' },
    });

    expect(b1Active).toBe(1);
    expect(b2Active).toBe(1);
  });

  // 3. Exhaustion & BUSY response
  it('3. Waterfall exhaustion: when both Buyer 1 (cap 1) and Buyer 2 (cap 2) are saturated, next call receives BUSY', async () => {
    const { wsId, campaignId } = await createFixture();

    // Fill capacity: Buyer 1 (1) + Buyer 2 (2) = 3 calls
    const c1 = await createCallInRouting(wsId, campaignId);
    const c2 = await createCallInRouting(wsId, campaignId);
    const c3 = await createCallInRouting(wsId, campaignId);

    const r1 = await callsService.prepareNextBuyer(c1);
    const r2 = await callsService.prepareNextBuyer(c2);
    const r3 = await callsService.prepareNextBuyer(c3);

    expect(r1.action).toBe('DIAL');
    expect(r2.action).toBe('DIAL');
    expect(r3.action).toBe('DIAL');

    // Call 4 arrives when all eligible buyers are at max concurrency
    const c4 = await createCallInRouting(wsId, campaignId);
    const r4 = await callsService.prepareNextBuyer(c4);

    expect(r4.action).toBe('BUSY');
    expect(r4.call?.state).toBe(CallState.FAILED);

    const dbCall4 = await prisma.call.findUniqueOrThrow({ where: { id: c4 } });
    expect(dbCall4.state).toBe(CallState.FAILED);
  });

  // 4. Waterfall release and slot reuse
  it('4. Releasing buyer reservation immediately restores capacity for subsequent callers', async () => {
    const { wsId, campaignId, buyer1Id } = await createFixture();

    const call1 = await createCallInRouting(wsId, campaignId);
    const route1 = await callsService.prepareNextBuyer(call1);
    expect(route1.buyer?.id).toBe(buyer1Id);

    // Release reservation on call 1 (e.g. call completed or cancelled)
    await callsService.releaseBuyerReservation(route1.attempt.id);

    const b1ActiveAfterRelease = await prisma.buyerReservation.count({
      where: { buyer_id: buyer1Id, status: 'ACTIVE' },
    });
    expect(b1ActiveAfterRelease).toBe(0);

    // Call 2 now gets Buyer 1 as primary target
    const call2 = await createCallInRouting(wsId, campaignId);
    const route2 = await callsService.prepareNextBuyer(call2);
    expect(route2.action).toBe('DIAL');
    expect(route2.buyer?.id).toBe(buyer1Id);
  });

  // 5. Stale buyer reservations recovery sweep
  it('5. Stale recovery: runRecoveryBatch automatically cleans up active buyer reservations for terminated calls', async () => {
    const { wsId, campaignId, buyer1Id } = await createFixture();

    const call = await createCallInRouting(wsId, campaignId);
    const route = await callsService.prepareNextBuyer(call);

    // Verify reservation is ACTIVE
    const beforeCount = await prisma.buyerReservation.count({
      where: { buyer_id: buyer1Id, status: 'ACTIVE' },
    });
    expect(beforeCount).toBe(1);

    // Simulate carrier hangup updating call state to COMPLETED without explicit buyer release
    await prisma.call.update({
      where: { id: call },
      data: { state: CallState.COMPLETED, ended_at: new Date() },
    });

    // Run recovery sweep
    await recoveryService.runRecoveryBatch();

    // Verify orphaned buyer reservation was swept to RELEASED
    const afterActiveCount = await prisma.buyerReservation.count({
      where: { buyer_id: buyer1Id, status: 'ACTIVE' },
    });
    expect(afterActiveCount).toBe(0);

    const afterReleasedCount = await prisma.buyerReservation.count({
      where: { buyer_id: buyer1Id, status: 'RELEASED' },
    });
    expect(afterReleasedCount).toBe(1);
  });
});
