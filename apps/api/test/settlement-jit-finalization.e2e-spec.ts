import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SettlementBatchService } from '../src/settlement/settlement-batch.service.js';
import {
  CommercialStatus,
  DisputeStatus,
  SettlementParticipantType,
  Prisma,
} from '@prisma/client';

describe('COMM-INTEGRATION-1A: AD-02 JIT Settlement Finalization E2E', () => {
  const uniqueId = (base: string) =>
    `${base}_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  let app: INestApplication;
  let prisma: PrismaService;
  let settlementService: SettlementBatchService;

  let workspaceA: string;
  let workspaceB: string;
  let buyerA: string;
  let vendorA: string;
  let campaignA: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    settlementService = app.get(SettlementBatchService);
  });

  beforeEach(async () => {
    // Seed test workspaces
    const wsA = await prisma.workspace.create({
      data: { name: 'JIT Workspace Alpha', slug: uniqueId('ws_alpha') },
    });
    workspaceA = wsA.id;

    const wsB = await prisma.workspace.create({
      data: { name: 'JIT Workspace Beta', slug: uniqueId('ws_beta') },
    });
    workspaceB = wsB.id;

    // Seed buyer, vendor, campaign
    const bA = await prisma.buyer.create({
      data: {
        workspace_id: workspaceA,
        name: 'JIT Buyer A',
        destination_number: '+18005550011',
      },
    });
    buyerA = bA.id;

    const vA = await prisma.vendor.create({
      data: {
        workspace_id: workspaceA,
        name: 'JIT Vendor A',
      },
    });
    vendorA = vA.id;

    const campA = await prisma.campaign.create({
      data: {
        workspace_id: workspaceA,
        name: 'JIT Campaign Alpha',
        default_revenue_amount: new Prisma.Decimal('100.0000'),
        default_payout_amount: new Prisma.Decimal('60.0000'),
        currency: 'USD',
      },
    });
    campaignA = campA.id;
  });

  async function createCallCommercial(options?: {
    workspaceId?: string;
    bId?: string | null;
    vId?: string | null;
    status?: CommercialStatus;
    finalizesAt?: Date | null;
    revenue?: string;
    payout?: string;
    cost?: string;
    currency?: string;
  }) {
    const wsId = options?.workspaceId ?? workspaceA;
    const call = await prisma.call.create({
      data: {
        workspace_id: wsId,
        provider: 'telnyx',
        provider_call_id: uniqueId('call_jit'),
        from_number: '+15550001111',
        to_number: '+15550002222',
        state: 'COMPLETED',
        started_at: new Date('2026-10-01T12:00:00Z'),
        ended_at: new Date('2026-10-01T12:02:00Z'),
      },
    });

    const rev = new Prisma.Decimal(options?.revenue ?? '100.0000');
    const pay = new Prisma.Decimal(options?.payout ?? '60.0000');
    const cst = new Prisma.Decimal(options?.cost ?? '10.0000');
    const prof = rev.sub(pay).sub(cst);

    return prisma.callCommercial.create({
      data: {
        workspace_id: wsId,
        call_id: call.id,
        campaign_id: campaignA,
        buyer_id: options?.bId === null ? null : (options?.bId ?? buyerA),
        vendor_id: options?.vId === null ? null : (options?.vId ?? vendorA),
        status: options?.status ?? CommercialStatus.PENDING,
        finalizes_at:
          options?.finalizesAt !== undefined
            ? options.finalizesAt
            : new Date('2026-10-05T12:00:00Z'), // Matured in the past
        currency: options?.currency ?? 'USD',
        revenue: rev,
        payout: pay,
        cost: cst,
        profit: prof,
        qualified: true,
        converted: true,
      },
    });
  }

  // 1. Buyer settlement JIT-finalizes a matured PENDING commercial record
  it('1. Buyer settlement JIT-finalizes a matured PENDING commercial record', async () => {
    const pStart = new Date('2026-10-01T00:00:00Z');
    const pEnd = new Date('2026-10-08T00:00:00Z');

    const comm = await createCallCommercial({
      status: CommercialStatus.PENDING,
      finalizesAt: new Date('2026-10-05T12:00:00Z'),
      revenue: '120.0000',
    });

    const res = await settlementService.generateBuyerSettlement({
      workspace_id: workspaceA,
      period_start: pStart,
      period_end: pEnd,
      buyer_id: buyerA,
    });

    expect(res.batches.length).toBe(1);
    expect(res.batches[0].gross_amount).toBe('120');

    const updated = await prisma.callCommercial.findUnique({
      where: { id: comm.id },
    });
    expect(updated?.status).toBe(CommercialStatus.FINAL);
  });

  // 2. Vendor settlement JIT-finalizes a matured PENDING commercial record
  it('2. Vendor settlement JIT-finalizes a matured PENDING commercial record', async () => {
    const pStart = new Date('2026-10-01T00:00:00Z');
    const pEnd = new Date('2026-10-08T00:00:00Z');

    const comm = await createCallCommercial({
      status: CommercialStatus.PENDING,
      finalizesAt: new Date('2026-10-05T12:00:00Z'),
      payout: '75.0000',
    });

    const res = await settlementService.generateVendorSettlement({
      workspace_id: workspaceA,
      period_start: pStart,
      period_end: pEnd,
      vendor_id: vendorA,
    });

    expect(res.batches.length).toBe(1);
    expect(res.batches[0].gross_amount).toBe('75');

    const updated = await prisma.callCommercial.findUnique({
      where: { id: comm.id },
    });
    expect(updated?.status).toBe(CommercialStatus.FINAL);
  });

  // 3. Unmatured PENDING remains PENDING and is not settled
  it('3. Unmatured PENDING remains PENDING and is not settled', async () => {
    const pStart = new Date();
    const pEnd = new Date(Date.now() + 10 * 86400 * 1000);
    const futureFinalizesAt = new Date(Date.now() + 2 * 86400 * 1000); // 2 days in future

    const comm = await createCallCommercial({
      status: CommercialStatus.PENDING,
      finalizesAt: futureFinalizesAt,
      revenue: '100.0000',
    });

    const res = await settlementService.generateBuyerSettlement({
      workspace_id: workspaceA,
      period_start: pStart,
      period_end: pEnd,
      buyer_id: buyerA,
    });

    expect(res.batches.length).toBe(0);

    const check = await prisma.callCommercial.findUnique({
      where: { id: comm.id },
    });
    expect(check?.status).toBe(CommercialStatus.PENDING);
  });

  // 4. Matured PENDING with active PENDING dispute remains PENDING
  it('4. Matured PENDING with active PENDING dispute remains PENDING and blocked from settlement', async () => {
    const pStart = new Date('2026-10-01T00:00:00Z');
    const pEnd = new Date('2026-10-08T00:00:00Z');

    const comm = await createCallCommercial({
      status: CommercialStatus.PENDING,
      finalizesAt: new Date('2026-10-05T12:00:00Z'),
      revenue: '150.0000',
    });

    await prisma.callDispute.create({
      data: {
        workspace_id: workspaceA,
        call_commercial_id: comm.id,
        buyer_id: buyerA,
        reason: 'Active defect dispute',
        status: DisputeStatus.PENDING,
        created_by_user_id: uniqueId('user'),
      },
    });

    const res = await settlementService.generateBuyerSettlement({
      workspace_id: workspaceA,
      period_start: pStart,
      period_end: pEnd,
      buyer_id: buyerA,
    });

    expect(res.batches.length).toBe(0);

    const check = await prisma.callCommercial.findUnique({
      where: { id: comm.id },
    });
    expect(check?.status).toBe(CommercialStatus.PENDING);
  });

  // 5. Matured PENDING with rejected/non-active dispute can finalize
  it('5. Matured PENDING with rejected dispute transitions to FINAL and settles', async () => {
    const pStart = new Date('2026-10-01T00:00:00Z');
    const pEnd = new Date('2026-10-08T00:00:00Z');

    const comm = await createCallCommercial({
      status: CommercialStatus.PENDING,
      finalizesAt: new Date('2026-10-05T12:00:00Z'),
      revenue: '100.0000',
    });

    await prisma.callDispute.create({
      data: {
        workspace_id: workspaceA,
        call_commercial_id: comm.id,
        buyer_id: buyerA,
        reason: 'Invalid buyer claim',
        status: DisputeStatus.REJECTED,
        resolved_at: new Date('2026-10-06T12:00:00Z'),
        resolution_notes: 'Claim dismissed',
        created_by_user_id: uniqueId('user'),
      },
    });

    const res = await settlementService.generateBuyerSettlement({
      workspace_id: workspaceA,
      period_start: pStart,
      period_end: pEnd,
      buyer_id: buyerA,
    });

    expect(res.batches.length).toBe(1);
    expect(res.batches[0].gross_amount).toBe('100');

    const updated = await prisma.callCommercial.findUnique({
      where: { id: comm.id },
    });
    expect(updated?.status).toBe(CommercialStatus.FINAL);
  });

  // 6-9. JIT transition does not alter revenue, payout, cost, or profit
  it('6-9. JIT transition strictly preserves financial immutability (revenue, payout, cost, profit)', async () => {
    const comm = await createCallCommercial({
      status: CommercialStatus.PENDING,
      finalizesAt: new Date('2026-10-04T12:00:00Z'),
      revenue: '250.5000',
      payout: '150.2500',
      cost: '25.1000',
    });

    const originalProfit = new Prisma.Decimal(comm.revenue)
      .sub(new Prisma.Decimal(comm.payout))
      .sub(new Prisma.Decimal(comm.cost));

    // Execute JIT sweep directly
    await settlementService.sweepMaturedPendingToFinal(prisma, workspaceA, new Date());

    const updated = await prisma.callCommercial.findUnique({
      where: { id: comm.id },
    });

    expect(updated?.status).toBe(CommercialStatus.FINAL);
    expect(new Prisma.Decimal(updated!.revenue).toString()).toBe('250.5');
    expect(new Prisma.Decimal(updated!.payout).toString()).toBe('150.25');
    expect(new Prisma.Decimal(updated!.cost).toString()).toBe('25.1');
    expect(new Prisma.Decimal(updated!.profit).toString()).toBe(originalProfit.toString());
  });

  // 10. Repeated JIT execution is idempotent
  it('10. Repeated JIT execution is idempotent (no-op on second pass)', async () => {
    const comm = await createCallCommercial({
      status: CommercialStatus.PENDING,
      finalizesAt: new Date('2026-10-04T12:00:00Z'),
      revenue: '99.0000',
    });

    const count1 = await settlementService.sweepMaturedPendingToFinal(prisma, workspaceA, new Date());
    expect(count1).toBeGreaterThanOrEqual(1);

    const count2 = await settlementService.sweepMaturedPendingToFinal(prisma, workspaceA, new Date());
    expect(count2).toBe(0);

    const check = await prisma.callCommercial.findUnique({
      where: { id: comm.id },
    });
    expect(check?.status).toBe(CommercialStatus.FINAL);
  });

  // 11. Existing FINAL records remain FINAL
  it('11. Existing FINAL records remain FINAL', async () => {
    const comm = await createCallCommercial({
      status: CommercialStatus.FINAL,
      finalizesAt: new Date('2026-10-03T12:00:00Z'),
      revenue: '80.0000',
    });

    await settlementService.sweepMaturedPendingToFinal(prisma, workspaceA, new Date());

    const check = await prisma.callCommercial.findUnique({
      where: { id: comm.id },
    });
    expect(check?.status).toBe(CommercialStatus.FINAL);
  });

  // 12. Existing SettlementItem uniqueness behavior remains intact
  it('12. Existing SettlementItem uniqueness behavior remains intact', async () => {
    const pStart = new Date('2026-10-01T00:00:00Z');
    const pEnd = new Date('2026-10-08T00:00:00Z');

    const comm = await createCallCommercial({
      status: CommercialStatus.PENDING,
      finalizesAt: new Date('2026-10-05T12:00:00Z'),
      revenue: '50.0000',
      payout: '30.0000',
    });

    // Run buyer generation
    const res1 = await settlementService.generateBuyerSettlement({
      workspace_id: workspaceA,
      period_start: pStart,
      period_end: pEnd,
      buyer_id: buyerA,
    });
    expect(res1.batches.length).toBe(1);

    // Run buyer generation again for same period
    const res2 = await settlementService.generateBuyerSettlement({
      workspace_id: workspaceA,
      period_start: pStart,
      period_end: pEnd,
      buyer_id: buyerA,
    });
    // Batch already exists, returns existing batch without creating duplicate items
    expect(res2.batches.length).toBe(1);
    expect(res2.batches[0].is_existing).toBe(true);

    // Verify exactly one BUYER settlement item exists for this CallCommercial
    const items = await prisma.settlementItem.findMany({
      where: {
        call_commercial_id: comm.id,
        participant_type: SettlementParticipantType.BUYER,
      },
    });
    expect(items.length).toBe(1);
  });

  // 13. Existing explicit period [period_start, period_end) behavior remains intact
  it('13. Existing explicit period [period_start, period_end) behavior remains intact', async () => {
    // Call matured at Oct 5 12:00:00
    await createCallCommercial({
      status: CommercialStatus.PENDING,
      finalizesAt: new Date('2026-10-05T12:00:00Z'),
      revenue: '70.0000',
    });

    // Period [Oct 6, Oct 8) does not include Oct 5
    const res = await settlementService.generateBuyerSettlement({
      workspace_id: workspaceA,
      period_start: new Date('2026-10-06T00:00:00Z'),
      period_end: new Date('2026-10-08T00:00:00Z'),
      buyer_id: buyerA,
    });

    expect(res.batches.length).toBe(0);
  });

  // 14. Buyer and Vendor paths remain independently correct
  it('14. Buyer and Vendor paths remain independently correct across different periods', async () => {
    const comm = await createCallCommercial({
      status: CommercialStatus.PENDING,
      finalizesAt: new Date('2026-10-05T12:00:00Z'),
      revenue: '100.0000',
      payout: '60.0000',
    });

    // Generate Buyer settlement
    const bRes = await settlementService.generateBuyerSettlement({
      workspace_id: workspaceA,
      period_start: new Date('2026-10-01T00:00:00Z'),
      period_end: new Date('2026-10-08T00:00:00Z'),
      buyer_id: buyerA,
    });
    expect(bRes.batches.length).toBe(1);
    expect(bRes.batches[0].participant_type).toBe(SettlementParticipantType.BUYER);
    expect(bRes.batches[0].gross_amount).toBe('100');

    // Generate Vendor settlement
    const vRes = await settlementService.generateVendorSettlement({
      workspace_id: workspaceA,
      period_start: new Date('2026-10-01T00:00:00Z'),
      period_end: new Date('2026-10-08T00:00:00Z'),
      vendor_id: vendorA,
    });
    expect(vRes.batches.length).toBe(1);
    expect(vRes.batches[0].participant_type).toBe(SettlementParticipantType.VENDOR);
    expect(vRes.batches[0].gross_amount).toBe('60');

    // Both items exist for same CallCommercial
    const allItems = await prisma.settlementItem.findMany({
      where: { call_commercial_id: comm.id },
    });
    expect(allItems.length).toBe(2);
  });
});
