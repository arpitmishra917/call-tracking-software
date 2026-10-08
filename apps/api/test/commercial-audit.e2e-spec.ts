import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ForbiddenException, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { CallsService } from '../src/calls/calls.service.js';
import { CommercialEvaluatorService } from '../src/commercial/commercial-evaluator.service.js';
import { CommercialDisputesService } from '../src/commercial/commercial-disputes.service.js';
import { CommercialStatus, DisputeStatus, CallState, CallAttemptState, TransactionType, ReservationStatus, Prisma } from '@prisma/client';

describe('COMM-8 Commercial Finalization & Settlement Readiness Audit E2E', () => {
  const uniqueId = (base: string) => `${base}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  let app: INestApplication;
  let prisma: PrismaService;
  let callsService: CallsService;
  let evaluatorService: CommercialEvaluatorService;
  let disputesService: CommercialDisputesService;

  let workspace1: string;
  let workspace2: string;
  let campaign1: string;
  let buyerA: string;
  let buyerB: string;
  let vendorA: string;
  let vendorB: string;
  let trackingNumber1: string;

  let ownerUserId: string;
  let adminUserId: string;
  let internalMemberUserId: string;
  let buyerAUserId: string;
  let buyerBUserId: string;
  let vendorAUserId: string;
  let ws2OwnerUserId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get<PrismaService>(PrismaService);
    callsService = app.get<CallsService>(CallsService);
    evaluatorService = app.get<CommercialEvaluatorService>(CommercialEvaluatorService);
    disputesService = app.get<CommercialDisputesService>(CommercialDisputesService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    const url = process.env.DATABASE_URL || '';
    if (!url.includes('_test')) {
      throw new Error('Safety check failed: E2E tests must use the test database');
    }

    // 1. Workspaces
    const ws1 = await prisma.workspace.create({ data: { name: 'Audit WS 1', slug: 'audit-ws1-' + Math.random() } });
    workspace1 = ws1.id;
    const ws2 = await prisma.workspace.create({ data: { name: 'Audit WS 2', slug: 'audit-ws2-' + Math.random() } });
    workspace2 = ws2.id;

    // 2. Telephony & Campaign
    const c1 = await prisma.campaign.create({
      data: {
        workspace_id: workspace1,
        name: 'Audit Legal Campaign',
        currency: 'USD',
        default_revenue_amount: 150.0,
        default_payout_amount: 90.0,
        conversion_duration_secs: 60,
        duplicate_window_secs: 3600,
      },
    });
    campaign1 = c1.id;

    const bA = await prisma.buyer.create({
      data: { workspace_id: workspace1, name: 'Buyer Legal Corp', destination_number: '+18005550001' },
    });
    buyerA = bA.id;

    const bB = await prisma.buyer.create({
      data: { workspace_id: workspace1, name: 'Buyer Finance LLC', destination_number: '+18005550002' },
    });
    buyerB = bB.id;

    const vA = await prisma.vendor.create({
      data: { workspace_id: workspace1, name: 'Vendor PPC Affiliate' },
    });
    vendorA = vA.id;

    const vB = await prisma.vendor.create({
      data: { workspace_id: workspace1, name: 'Vendor SEO Media' },
    });
    vendorB = vB.id;

    const pn1 = await prisma.phoneNumber.create({
      data: {
        workspace_id: workspace1,
        phone_number: '+1900' + Math.floor(1000000 + Math.random() * 9000000).toString(),
        provider: 'telnyx',
        name: 'Audit Main Tracking',
        vendor_id: vendorA,
      },
    });
    trackingNumber1 = pn1.phone_number;

    // 3. Permissions
    const permCallRead = await prisma.permission.findUnique({ where: { key: 'call:read' } });
    if (!permCallRead) throw new Error('call:read permission not found');

    // 4. Users & Workspace Members
    ownerUserId = 'u_aud_own_' + Math.random().toString(36).substring(7);
    adminUserId = 'u_aud_adm_' + Math.random().toString(36).substring(7);
    internalMemberUserId = 'u_aud_mem_' + Math.random().toString(36).substring(7);
    buyerAUserId = 'u_aud_bya_' + Math.random().toString(36).substring(7);
    buyerBUserId = 'u_aud_byb_' + Math.random().toString(36).substring(7);
    vendorAUserId = 'u_aud_vna_' + Math.random().toString(36).substring(7);
    ws2OwnerUserId = 'u_aud_ws2_' + Math.random().toString(36).substring(7);

    for (const u of [ownerUserId, adminUserId, internalMemberUserId, buyerAUserId, buyerBUserId, vendorAUserId, ws2OwnerUserId]) {
      await prisma.profile.create({ data: { id: u, display_name: u } });
    }

    await prisma.workspaceMember.create({
      data: { workspace_id: workspace1, user_id: ownerUserId, role: 'OWNER', participant_type: 'INTERNAL' },
    });
    await prisma.workspaceMember.create({
      data: { workspace_id: workspace1, user_id: adminUserId, role: 'ADMIN', participant_type: 'INTERNAL' },
    });
    const memInt = await prisma.workspaceMember.create({
      data: { workspace_id: workspace1, user_id: internalMemberUserId, role: 'MEMBER', participant_type: 'INTERNAL' },
    });
    await prisma.workspaceMemberPermission.create({
      data: { workspace_id: workspace1, workspace_member_id: memInt.id, permission_id: permCallRead.id, scope_type: 'ALL' },
    });

    const memBuyerA = await prisma.workspaceMember.create({
      data: { workspace_id: workspace1, user_id: buyerAUserId, role: 'MEMBER', participant_type: 'BUYER', buyer_id: buyerA },
    });
    await prisma.workspaceMemberPermission.create({
      data: { workspace_id: workspace1, workspace_member_id: memBuyerA.id, permission_id: permCallRead.id, scope_type: 'ALL' },
    });

    const memBuyerB = await prisma.workspaceMember.create({
      data: { workspace_id: workspace1, user_id: buyerBUserId, role: 'MEMBER', participant_type: 'BUYER', buyer_id: buyerB },
    });
    await prisma.workspaceMemberPermission.create({
      data: { workspace_id: workspace1, workspace_member_id: memBuyerB.id, permission_id: permCallRead.id, scope_type: 'ALL' },
    });

    const memVendorA = await prisma.workspaceMember.create({
      data: { workspace_id: workspace1, user_id: vendorAUserId, role: 'MEMBER', participant_type: 'VENDOR', vendor_id: vendorA },
    });
    await prisma.workspaceMemberPermission.create({
      data: { workspace_id: workspace1, workspace_member_id: memVendorA.id, permission_id: permCallRead.id, scope_type: 'ALL' },
    });

    await prisma.workspaceMember.create({
      data: { workspace_id: workspace2, user_id: ws2OwnerUserId, role: 'OWNER', participant_type: 'INTERNAL' },
    });
  });

  // Helper to create completed call with settlement
  async function createCompletedCallWithSettlement(params: {
    durationSecs: number;
    costAmount: number; // in standard currency units, e.g. 1.25
    fromNumber?: string;
    buyerId?: string;
    answered?: boolean;
    createdAt?: Date;
  }) {
    const callDate = params.createdAt ?? new Date('2026-10-01T12:00:00Z');
    const call = await prisma.call.create({
      data: {
        workspace_id: workspace1,
        provider: 'telnyx',
        provider_call_id: uniqueId('call'),
        campaign_id: campaign1,
        to_number: trackingNumber1,
        from_number: params.fromNumber ?? '+15550001111',
        state: CallState.COMPLETED,
        duration_secs: params.durationSecs,
        started_at: callDate,
        answered_at: params.answered !== false ? new Date(callDate.getTime() + 5000) : null,
        ended_at: new Date(callDate.getTime() + params.durationSecs * 1000),
        created_at: callDate,
      },
    });

    if (params.buyerId) {
      await prisma.callAttempt.create({
        data: {
          call_id: call.id,
          buyer_id: params.buyerId,
          state: CallAttemptState.COMPLETED,
          started_at: call.started_at,
          answered_at: call.answered_at,
          ended_at: call.ended_at,
          created_at: callDate,
        },
      });
    }

    // Create settled reservation for completed call (AD-03)
    await prisma.callReservation.create({
      data: {
        workspace_id: workspace1,
        call_id: call.id,
        status: ReservationStatus.SETTLED,
        original_reserved_micro: BigInt(5_000_000),
        total_reserved_micro: BigInt(5_000_000),
        expires_at: new Date(callDate.getTime() + 3600000),
      },
    });

    // Create settlement transaction with cost
    await prisma.walletTransaction.create({
      data: {
        workspace_id: workspace1,
        type: TransactionType.DEBIT,
        reference_type: 'CALL_SETTLEMENT',
        reference_id: call.id,
        amount_minor: Math.round(params.costAmount * 100),
        amount_micro: BigInt(Math.round(params.costAmount * 1_000_000)),
        balance_after: 10000,
        balance_after_micro: BigInt(100_000_000),
        idempotency_key: uniqueId(`settle_${call.id}`),
      },
    });

    return call;
  }

  // 1. Commercial evaluation idempotency
  it('Scenario 1: Commercial evaluation idempotency (single call never creates duplicate CallCommercial)', async () => {
    const call = await createCompletedCallWithSettlement({ durationSecs: 90, costAmount: 2.5, buyerId: buyerA });

    const eval1 = await evaluatorService.evaluateCall(call.id);
    expect(eval1).not.toBeNull();

    const eval2 = await evaluatorService.evaluateCall(call.id);
    expect(eval2).not.toBeNull();
    expect(eval2!.id).toBe(eval1!.id);

    const count = await prisma.callCommercial.count({ where: { call_id: call.id } });
    expect(count).toBe(1);
  });

  // 2. Concurrent evaluation safety
  it('Scenario 2: Concurrent evaluation safety (parallel invocations return identical record)', async () => {
    const call = await createCompletedCallWithSettlement({ durationSecs: 90, costAmount: 2.5, buyerId: buyerA });

    const results = await Promise.all([
      evaluatorService.evaluateCall(call.id),
      evaluatorService.evaluateCall(call.id),
      evaluatorService.evaluateCall(call.id),
    ]);

    expect(results[0]).not.toBeNull();
    expect(results[1]!.id).toBe(results[0]!.id);
    expect(results[2]!.id).toBe(results[0]!.id);

    const totalRows = await prisma.callCommercial.count({ where: { call_id: call.id } });
    expect(totalRows).toBe(1);
  });

  // 3. Profit invariant
  it('Scenario 3: Profit invariant (profit = revenue - payout - cost) verified across all calculations', async () => {
    const call = await createCompletedCallWithSettlement({ durationSecs: 100, costAmount: 3.25, buyerId: buyerA });
    const comm = await evaluatorService.evaluateCall(call.id);

    expect(comm).not.toBeNull();
    const rev = new Prisma.Decimal(comm!.revenue);
    const pay = new Prisma.Decimal(comm!.payout);
    const cst = new Prisma.Decimal(comm!.cost);
    const prf = new Prisma.Decimal(comm!.profit);

    expect(prf.toString()).toBe(rev.sub(pay).sub(cst).toString());
  });

  // 4. Non-converted financial invariant
  it('Scenario 4: Non-converted financial invariant (revenue = 0, payout = 0, profit = -cost)', async () => {
    // duration 30s is below threshold 60s
    const call = await createCompletedCallWithSettlement({ durationSecs: 30, costAmount: 1.5, buyerId: buyerA });
    const comm = await evaluatorService.evaluateCall(call.id);

    expect(comm).not.toBeNull();
    expect(comm!.converted).toBe(false);
    expect(comm!.qualified).toBe(false);
    expect(new Prisma.Decimal(comm!.revenue).toNumber()).toBe(0);
    expect(new Prisma.Decimal(comm!.payout).toNumber()).toBe(0);
    expect(new Prisma.Decimal(comm!.cost).toNumber()).toBe(1.5);
    expect(new Prisma.Decimal(comm!.profit).toNumber()).toBe(-1.5);
  });

  // 5. Converted financial invariant
  it('Scenario 5: Converted financial invariant (revenue = default_revenue, payout = default_payout, profit = rev - pay - cost)', async () => {
    // duration 120s is >= threshold 60s
    const call = await createCompletedCallWithSettlement({ durationSecs: 120, costAmount: 4.0, buyerId: buyerA });
    const comm = await evaluatorService.evaluateCall(call.id);

    expect(comm).not.toBeNull();
    expect(comm!.converted).toBe(true);
    expect(comm!.qualified).toBe(true);
    expect(new Prisma.Decimal(comm!.revenue).toNumber()).toBe(150.0);
    expect(new Prisma.Decimal(comm!.payout).toNumber()).toBe(90.0);
    expect(new Prisma.Decimal(comm!.cost).toNumber()).toBe(4.0);
    // profit = 150 - 90 - 4 = 56
    expect(new Prisma.Decimal(comm!.profit).toNumber()).toBe(56.0);
  });

  // 6. Duplicate financial invariant
  it('Scenario 6: Duplicate financial invariant (converted duplicate still gets revenue and payout in V1)', async () => {
    const callerNum = '+15559998877';
    // Call 1
    const call1 = await createCompletedCallWithSettlement({
      durationSecs: 100,
      costAmount: 2.0,
      fromNumber: callerNum,
      buyerId: buyerA,
      createdAt: new Date('2026-10-01T10:00:00Z'),
    });
    const comm1 = await evaluatorService.evaluateCall(call1.id);
    expect(comm1!.duplicate).toBe(false);

    // Call 2: duplicate caller 10 mins later, converted
    const call2 = await createCompletedCallWithSettlement({
      durationSecs: 80,
      costAmount: 2.0,
      fromNumber: callerNum,
      buyerId: buyerA,
      createdAt: new Date('2026-10-01T10:10:00Z'),
    });
    const comm2 = await evaluatorService.evaluateCall(call2.id);

    expect(comm2!.duplicate).toBe(true);
    expect(comm2!.duplicate_of_call_id).toBe(call1.id);
    expect(comm2!.converted).toBe(true);
    // V1 frozen rule: duplicate status does NOT zero revenue/payout
    expect(new Prisma.Decimal(comm2!.revenue).toNumber()).toBe(150.0);
    expect(new Prisma.Decimal(comm2!.payout).toNumber()).toBe(90.0);
    expect(new Prisma.Decimal(comm2!.cost).toNumber()).toBe(2.0);
    expect(new Prisma.Decimal(comm2!.profit).toNumber()).toBe(58.0);
  });

  // 7. Accepted dispute invariant
  it('Scenario 7: Accepted dispute invariant (revenue=0, payout=0, cost unchanged, profit=-cost, status=ADJUSTED)', async () => {
    const call = await createCompletedCallWithSettlement({ durationSecs: 100, costAmount: 3.5, buyerId: buyerA });
    const comm = await evaluatorService.evaluateCall(call.id);

    // Buyer creates dispute
    const dispute = await disputesService.createDispute({
      workspaceId: workspace1,
      callCommercialId: comm!.id,
      userId: buyerAUserId,
      reason: 'Wrong intent / unqualified caller',
    });

    // Admin resolves dispute as ACCEPTED
    const result = await disputesService.resolveDispute({
      workspaceId: workspace1,
      disputeId: dispute.id,
      userId: adminUserId,
      status: 'ACCEPTED',
      resolutionNotes: 'Approved refund after review',
    });

    expect(result.dispute.status).toBe(DisputeStatus.ACCEPTED);
    expect(result.adjustment).toBeDefined();

    // Check adjusted CallCommercial
    const updatedComm = await prisma.callCommercial.findUnique({ where: { id: comm!.id } });
    expect(updatedComm!.status).toBe(CommercialStatus.ADJUSTED);
    expect(new Prisma.Decimal(updatedComm!.revenue).toNumber()).toBe(0);
    expect(new Prisma.Decimal(updatedComm!.payout).toNumber()).toBe(0);
    expect(new Prisma.Decimal(updatedComm!.cost).toNumber()).toBe(3.5);
    expect(new Prisma.Decimal(updatedComm!.profit).toNumber()).toBe(-3.5);

    // Check CallFinancialAdjustment
    expect(new Prisma.Decimal(result.adjustment!.original_revenue).toNumber()).toBe(150.0);
    expect(new Prisma.Decimal(result.adjustment!.original_payout).toNumber()).toBe(90.0);
    expect(new Prisma.Decimal(result.adjustment!.adjusted_revenue).toNumber()).toBe(0);
    expect(new Prisma.Decimal(result.adjustment!.adjusted_payout).toNumber()).toBe(0);
  });

  // 8. Rejected dispute invariant
  it('Scenario 8: Rejected dispute invariant (revenue and payout unchanged, status=REJECTED, no adjustment record)', async () => {
    const call = await createCompletedCallWithSettlement({ durationSecs: 100, costAmount: 3.0, buyerId: buyerA });
    const comm = await evaluatorService.evaluateCall(call.id);

    const dispute = await disputesService.createDispute({
      workspaceId: workspace1,
      callCommercialId: comm!.id,
      userId: buyerAUserId,
      reason: 'Buyer claimed wrong state',
    });

    const result = await disputesService.resolveDispute({
      workspaceId: workspace1,
      disputeId: dispute.id,
      userId: ownerUserId,
      status: 'REJECTED',
      resolutionNotes: 'Caller verified in valid state',
    });

    expect(result.dispute.status).toBe(DisputeStatus.REJECTED);
    expect(result.adjustment).toBeUndefined();

    const currentComm = await prisma.callCommercial.findUnique({ where: { id: comm!.id } });
    expect(new Prisma.Decimal(currentComm!.revenue).toNumber()).toBe(150.0);
    expect(new Prisma.Decimal(currentComm!.payout).toNumber()).toBe(90.0);
    expect(new Prisma.Decimal(currentComm!.cost).toNumber()).toBe(3.0);
    expect(new Prisma.Decimal(currentComm!.profit).toNumber()).toBe(57.0);

    const adjCount = await prisma.callFinancialAdjustment.count({ where: { dispute_id: dispute.id } });
    expect(adjCount).toBe(0);
  });

  // 9. Pending dispute invariant
  it('Scenario 9: Pending dispute invariant (no financial change while dispute is pending)', async () => {
    const call = await createCompletedCallWithSettlement({ durationSecs: 90, costAmount: 2.0, buyerId: buyerA });
    const comm = await evaluatorService.evaluateCall(call.id);

    const dispute = await disputesService.createDispute({
      workspaceId: workspace1,
      callCommercialId: comm!.id,
      userId: buyerAUserId,
      reason: 'Under review',
    });

    expect(dispute.status).toBe(DisputeStatus.PENDING);

    const currentComm = await prisma.callCommercial.findUnique({ where: { id: comm!.id } });
    expect(new Prisma.Decimal(currentComm!.revenue).toNumber()).toBe(150.0);
    expect(new Prisma.Decimal(currentComm!.payout).toNumber()).toBe(90.0);
    expect(new Prisma.Decimal(currentComm!.cost).toNumber()).toBe(2.0);
    expect(new Prisma.Decimal(currentComm!.profit).toNumber()).toBe(58.0);
    expect(currentComm!.status).toBe(CommercialStatus.PENDING);
  });

  // 10. Concurrent dispute resolution
  it('Scenario 10: Concurrent dispute resolution (serialized, only one succeeds)', async () => {
    const call = await createCompletedCallWithSettlement({ durationSecs: 90, costAmount: 2.0, buyerId: buyerA });
    const comm = await evaluatorService.evaluateCall(call.id);

    const dispute = await disputesService.createDispute({
      workspaceId: workspace1,
      callCommercialId: comm!.id,
      userId: buyerAUserId,
      reason: 'Concurrent test dispute',
    });

    // Try resolving twice simultaneously
    const results = await Promise.allSettled([
      disputesService.resolveDispute({
        workspaceId: workspace1,
        disputeId: dispute.id,
        userId: ownerUserId,
        status: 'ACCEPTED',
        resolutionNotes: 'Winner 1',
      }),
      disputesService.resolveDispute({
        workspaceId: workspace1,
        disputeId: dispute.id,
        userId: adminUserId,
        status: 'REJECTED',
        resolutionNotes: 'Winner 2',
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // Only 1 adjustment row can exist
    const totalAdjustments = await prisma.callFinancialAdjustment.count({ where: { dispute_id: dispute.id } });
    expect(totalAdjustments).toBeLessThanOrEqual(1);
  });

  // 11. Double-resolution protection
  it('Scenario 11: Double-resolution protection (cannot resolve an already resolved dispute)', async () => {
    const call = await createCompletedCallWithSettlement({ durationSecs: 90, costAmount: 2.0, buyerId: buyerA });
    const comm = await evaluatorService.evaluateCall(call.id);

    const dispute = await disputesService.createDispute({
      workspaceId: workspace1,
      callCommercialId: comm!.id,
      userId: buyerAUserId,
      reason: 'Double resolution test',
    });

    await disputesService.resolveDispute({
      workspaceId: workspace1,
      disputeId: dispute.id,
      userId: ownerUserId,
      status: 'ACCEPTED',
    });

    // Second resolution must fail with ConflictException
    await expect(
      disputesService.resolveDispute({
        workspaceId: workspace1,
        disputeId: dispute.id,
        userId: adminUserId,
        status: 'REJECTED',
      }),
    ).rejects.toThrow(ConflictException);
  });

  // 12. Historical campaign-change protection
  it('Scenario 12: Historical campaign-change protection (mutating campaign defaults does not alter existing CallCommercial)', async () => {
    const call = await createCompletedCallWithSettlement({ durationSecs: 100, costAmount: 2.0, buyerId: buyerA });
    const comm = await evaluatorService.evaluateCall(call.id);

    expect(new Prisma.Decimal(comm!.revenue).toNumber()).toBe(150.0);
    expect(new Prisma.Decimal(comm!.payout).toNumber()).toBe(90.0);

    // Mutate campaign defaults
    await prisma.campaign.update({
      where: { id: campaign1 },
      data: {
        default_revenue_amount: 500.0,
        default_payout_amount: 350.0,
      },
    });

    // Existing CallCommercial must retain historical snapshot values
    const commAfter = await prisma.callCommercial.findUnique({ where: { id: comm!.id } });
    expect(new Prisma.Decimal(commAfter!.revenue).toNumber()).toBe(150.0);
    expect(new Prisma.Decimal(commAfter!.payout).toNumber()).toBe(90.0);
  });

  // 13. Historical vendor-change protection
  it('Scenario 13: Historical vendor-change protection (reassigning phone vendor does not alter existing CallCommercial.vendor_id)', async () => {
    const call = await createCompletedCallWithSettlement({ durationSecs: 100, costAmount: 2.0, buyerId: buyerA });
    const comm = await evaluatorService.evaluateCall(call.id);
    expect(comm!.vendor_id).toBe(vendorA);

    // Reassign tracking phone number to vendorB
    await prisma.phoneNumber.update({
      where: {
        phone_number: trackingNumber1,
      },
      data: { vendor_id: vendorB },
    });

    const commAfter = await prisma.callCommercial.findUnique({ where: { id: comm!.id } });
    expect(commAfter!.vendor_id).toBe(vendorA);
  });

  // 14. Historical currency protection
  it('Scenario 14: Historical currency protection (changing campaign currency does not alter existing CallCommercial.currency)', async () => {
    const call = await createCompletedCallWithSettlement({ durationSecs: 100, costAmount: 2.0, buyerId: buyerA });
    const comm = await evaluatorService.evaluateCall(call.id);
    expect(comm!.currency).toBe('USD');

    // Change campaign currency to EUR
    await prisma.campaign.update({
      where: { id: campaign1 },
      data: { currency: 'EUR' },
    });

    const commAfter = await prisma.callCommercial.findUnique({ where: { id: comm!.id } });
    expect(commAfter!.currency).toBe('USD');
  });

  // 15. CallCommercial delete protection (RESTRICT)
  it('Scenario 15: CallCommercial delete protection (deleting Call throws foreign key RESTRICT error)', async () => {
    const call = await createCompletedCallWithSettlement({ durationSecs: 90, costAmount: 2.0, buyerId: buyerA });
    await evaluatorService.evaluateCall(call.id);

    // Attempting to delete the parent call must fail due to onDelete: Restrict
    await expect(
      prisma.call.delete({
        where: { id: call.id },
      }),
    ).rejects.toThrow();

    // Verify call and commercial still exist
    const survivingCall = await prisma.call.findUnique({ where: { id: call.id } });
    const survivingComm = await prisma.callCommercial.findUnique({ where: { call_id: call.id } });
    expect(survivingCall).not.toBeNull();
    expect(survivingComm).not.toBeNull();
  });

  // 16. Reporting consistency
  it('Scenario 16: Reporting consistency (reading persisted CallCommercial, not recalculating)', async () => {
    const call = await createCompletedCallWithSettlement({ durationSecs: 120, costAmount: 5.0, buyerId: buyerA });
    await evaluatorService.evaluateCall(call.id);

    const metrics = await callsService.getMetrics(workspace1, ownerUserId, {
      startDate: '2026-09-01T00:00:00.000Z',
      endDate: '2026-10-31T23:59:59.999Z',
    });

    expect(metrics.total).toBeGreaterThanOrEqual(1);
    expect(metrics).toHaveProperty('revenue');
    expect(metrics).toHaveProperty('payout');
    expect(metrics).toHaveProperty('cost');
    expect(metrics).toHaveProperty('profit');
    // Invariant holds in aggregated metrics
    const rev = metrics.revenue ?? 0;
    const pay = metrics.payout ?? 0;
    const cst = metrics.cost ?? 0;
    const prf = metrics.profit ?? 0;
    expect(prf).toBeCloseTo(rev - pay - cst, 4);
  });

  // 17. COMM-7 participant visibility regression
  it('Scenario 17: COMM-7 participant visibility regression across roles', async () => {
    const call = await createCompletedCallWithSettlement({ durationSecs: 120, costAmount: 5.0, buyerId: buyerA });
    await evaluatorService.evaluateCall(call.id);

    // OWNER: sees all metrics
    const ownerMetrics = await callsService.getMetrics(workspace1, ownerUserId, {});
    expect(ownerMetrics).toHaveProperty('revenue');
    expect(ownerMetrics).toHaveProperty('payout');
    expect(ownerMetrics).toHaveProperty('cost');
    expect(ownerMetrics).toHaveProperty('profit');

    // ADMIN: sees all metrics
    const adminMetrics = await callsService.getMetrics(workspace1, adminUserId, {});
    expect(adminMetrics).toHaveProperty('revenue');
    expect(adminMetrics).toHaveProperty('payout');
    expect(adminMetrics).toHaveProperty('cost');
    expect(adminMetrics).toHaveProperty('profit');

    // BUYER: sees revenue only, payout/cost/profit hidden
    const buyerMetrics = await callsService.getMetrics(workspace1, buyerAUserId, {});
    expect(buyerMetrics).toHaveProperty('revenue');
    expect(buyerMetrics).not.toHaveProperty('payout');
    expect(buyerMetrics).not.toHaveProperty('cost');
    expect(buyerMetrics).not.toHaveProperty('profit');

    // VENDOR: sees payout only, revenue/cost/profit hidden
    const vendorMetrics = await callsService.getMetrics(workspace1, vendorAUserId, {});
    expect(vendorMetrics).toHaveProperty('payout');
    expect(vendorMetrics).not.toHaveProperty('revenue');
    expect(vendorMetrics).not.toHaveProperty('cost');
    expect(vendorMetrics).not.toHaveProperty('profit');

    // INTERNAL MEMBER: no financial metrics
    const memberMetrics = await callsService.getMetrics(workspace1, internalMemberUserId, {});
    expect(memberMetrics).not.toHaveProperty('revenue');
    expect(memberMetrics).not.toHaveProperty('payout');
    expect(memberMetrics).not.toHaveProperty('cost');
    expect(memberMetrics).not.toHaveProperty('profit');
  });

  // 18. Cross-workspace isolation
  it('Scenario 18: Cross-workspace isolation (disputes & commercial records strictly workspace isolated)', async () => {
    const call = await createCompletedCallWithSettlement({ durationSecs: 90, costAmount: 2.0, buyerId: buyerA });
    const comm = await evaluatorService.evaluateCall(call.id);

    // User from workspace 2 attempts to dispute workspace 1 commercial record
    await expect(
      disputesService.createDispute({
        workspaceId: workspace2,
        callCommercialId: comm!.id,
        userId: ws2OwnerUserId,
        reason: 'Cross workspace exploit attempt',
      }),
    ).rejects.toThrow();

    // Dispute created in ws1
    const dispute = await disputesService.createDispute({
      workspaceId: workspace1,
      callCommercialId: comm!.id,
      userId: buyerAUserId,
      reason: 'Legitimate dispute',
    });

    // User in ws2 attempts to resolve ws1 dispute
    await expect(
      disputesService.resolveDispute({
        workspaceId: workspace2,
        disputeId: dispute.id,
        userId: ws2OwnerUserId,
        status: 'ACCEPTED',
      }),
    ).rejects.toThrow();
  });
});
