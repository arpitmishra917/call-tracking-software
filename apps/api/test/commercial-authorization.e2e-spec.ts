import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { CallsService } from '../src/calls/calls.service.js';
import { CommercialDisputesService } from '../src/commercial/commercial-disputes.service.js';
import { CommercialStatus, DisputeStatus } from '@prisma/client';

describe('COMM-7 Commercial Reporting Authorization & Participant Visibility E2E', () => {
  const uniqueId = (base: string) => `${base}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  let app: INestApplication;
  let prisma: PrismaService;
  let callsService: CallsService;
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
  let vendorBUserId: string;
  let ws2OwnerUserId: string;

  let callBuyerAId: string;
  let callBuyerBId: string;
  let callVendorAId: string;
  let callVendorBId: string;
  let disputeBuyerAId: string;
  let disputeBuyerBId: string;
  let commBuyerAId: string;
  let commBuyerBId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get<PrismaService>(PrismaService);
    callsService = app.get<CallsService>(CallsService);
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
    const ws1 = await prisma.workspace.create({ data: { name: 'Auth WS 1', slug: 'auth-ws1-' + Math.random() } });
    workspace1 = ws1.id;
    const ws2 = await prisma.workspace.create({ data: { name: 'Auth WS 2', slug: 'auth-ws2-' + Math.random() } });
    workspace2 = ws2.id;

    // 2. Telephony & Campaign
    const c1 = await prisma.campaign.create({
      data: {
        workspace_id: workspace1,
        name: 'Auto Insurance Campaign',
        currency: 'USD',
        default_revenue_amount: 100.0,
        default_payout_amount: 60.0,
        conversion_duration_secs: 60,
      },
    });
    campaign1 = c1.id;

    const bA = await prisma.buyer.create({
      data: { workspace_id: workspace1, name: 'Buyer Alpha Corp', destination_number: '+18001110001' },
    });
    buyerA = bA.id;

    const bB = await prisma.buyer.create({
      data: { workspace_id: workspace1, name: 'Buyer Beta LLC', destination_number: '+18001110002' },
    });
    buyerB = bB.id;

    const vA = await prisma.vendor.create({
      data: { workspace_id: workspace1, name: 'Vendor Alpha Affiliate' },
    });
    vendorA = vA.id;

    const vB = await prisma.vendor.create({
      data: { workspace_id: workspace1, name: 'Vendor Beta Media' },
    });
    vendorB = vB.id;

    const pn1 = await prisma.phoneNumber.create({
      data: {
        workspace_id: workspace1,
        phone_number: '+1900' + Math.floor(1000000 + Math.random() * 9000000).toString(),
        provider: 'telnyx',
        name: 'Tracking Main',
      },
    });
    trackingNumber1 = pn1.phone_number;

    // 3. Permissions seeded
    const permCallRead = await prisma.permission.findUnique({ where: { key: 'call:read' } });
    if (!permCallRead) throw new Error('call:read permission not found in DB');

    // 4. Users & Workspace Members
    ownerUserId = 'u_owner_' + Math.random().toString(36).substring(7);
    adminUserId = 'u_admin_' + Math.random().toString(36).substring(7);
    internalMemberUserId = 'u_intmem_' + Math.random().toString(36).substring(7);
    buyerAUserId = 'u_buyerA_' + Math.random().toString(36).substring(7);
    buyerBUserId = 'u_buyerB_' + Math.random().toString(36).substring(7);
    vendorAUserId = 'u_vendorA_' + Math.random().toString(36).substring(7);
    vendorBUserId = 'u_vendorB_' + Math.random().toString(36).substring(7);
    ws2OwnerUserId = 'u_ws2owner_' + Math.random().toString(36).substring(7);

    for (const u of [ownerUserId, adminUserId, internalMemberUserId, buyerAUserId, buyerBUserId, vendorAUserId, vendorBUserId, ws2OwnerUserId]) {
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

    const memVendorB = await prisma.workspaceMember.create({
      data: { workspace_id: workspace1, user_id: vendorBUserId, role: 'MEMBER', participant_type: 'VENDOR', vendor_id: vendorB },
    });
    await prisma.workspaceMemberPermission.create({
      data: { workspace_id: workspace1, workspace_member_id: memVendorB.id, permission_id: permCallRead.id, scope_type: 'ALL' },
    });

    await prisma.workspaceMember.create({
      data: { workspace_id: workspace2, user_id: ws2OwnerUserId, role: 'OWNER', participant_type: 'INTERNAL' },
    });

    // 5. Calls & Commercial Records
    // Call 1: Buyer A + Vendor A
    const cA = await prisma.call.create({
      data: {
        workspace_id: workspace1,
        provider: 'telnyx',
        provider_call_id: uniqueId('callA'),
        campaign_id: campaign1,
        to_number: trackingNumber1,
        from_number: '+15551111111',
        state: 'COMPLETED',
        duration_secs: 100,
        started_at: new Date('2026-09-10T10:00:00Z'),
        answered_at: new Date('2026-09-10T10:00:05Z'),
        ended_at: new Date('2026-09-10T10:01:45Z'),
        created_at: new Date('2026-09-10T10:00:00Z'),
      },
    });
    callBuyerAId = cA.id;
    callVendorAId = cA.id;

    await prisma.callAttempt.create({
      data: {
        call_id: cA.id,
        buyer_id: buyerA,
        state: 'COMPLETED',
        started_at: cA.started_at,
        ended_at: cA.ended_at,
        created_at: cA.created_at,
      },
    });

    const commA = await prisma.callCommercial.create({
      data: {
        workspace_id: workspace1,
        call_id: cA.id,
        campaign_id: campaign1,
        buyer_id: buyerA,
        vendor_id: vendorA,
        revenue: 100.0,
        payout: 60.0,
        cost: 1.5,
        profit: 38.5,
        converted: true,
        qualified: true,
        duplicate: false,
        status: CommercialStatus.FINAL,
        currency: 'USD',
        created_at: cA.created_at,
      },
    });
    commBuyerAId = commA.id;

    // Create dispute on Buyer A's call
    const dispA = await prisma.callDispute.create({
      data: {
        workspace_id: workspace1,
        call_commercial_id: commA.id,
        buyer_id: buyerA,
        reason: 'Fraudulent lead',
        status: DisputeStatus.ACCEPTED,
        created_by_user_id: buyerAUserId,
        resolved_by_user_id: ownerUserId,
        resolved_at: new Date('2026-09-10T11:00:00Z'),
      },
    });
    disputeBuyerAId = dispA.id;

    await prisma.callFinancialAdjustment.create({
      data: {
        workspace_id: workspace1,
        call_commercial_id: commA.id,
        dispute_id: dispA.id,
        original_revenue: 100.0,
        original_payout: 60.0,
        adjusted_revenue: 0.0,
        adjusted_payout: 0.0,
        reason: 'Fraudulent lead',
      },
    });

    // Call 2: Buyer B + Vendor B
    const cB = await prisma.call.create({
      data: {
        workspace_id: workspace1,
        provider: 'telnyx',
        provider_call_id: uniqueId('callB'),
        campaign_id: campaign1,
        to_number: trackingNumber1,
        from_number: '+15552222222',
        state: 'COMPLETED',
        duration_secs: 120,
        started_at: new Date('2026-09-10T12:00:00Z'),
        answered_at: new Date('2026-09-10T12:00:05Z'),
        ended_at: new Date('2026-09-10T12:02:05Z'),
        created_at: new Date('2026-09-10T12:00:00Z'),
      },
    });
    callBuyerBId = cB.id;
    callVendorBId = cB.id;

    await prisma.callAttempt.create({
      data: {
        call_id: cB.id,
        buyer_id: buyerB,
        state: 'COMPLETED',
        started_at: cB.started_at,
        ended_at: cB.ended_at,
        created_at: cB.created_at,
      },
    });

    const commB = await prisma.callCommercial.create({
      data: {
        workspace_id: workspace1,
        call_id: cB.id,
        campaign_id: campaign1,
        buyer_id: buyerB,
        vendor_id: vendorB,
        revenue: 100.0,
        payout: 60.0,
        cost: 2.0,
        profit: 38.0,
        converted: true,
        qualified: true,
        duplicate: false,
        status: CommercialStatus.FINAL,
        currency: 'USD',
        created_at: cB.created_at,
      },
    });
    commBuyerBId = commB.id;

    const dispB = await prisma.callDispute.create({
      data: {
        workspace_id: workspace1,
        call_commercial_id: commB.id,
        buyer_id: buyerB,
        reason: 'Wrong number',
        status: DisputeStatus.PENDING,
        created_by_user_id: buyerBUserId,
      },
    });
    disputeBuyerBId = dispB.id;
  });

  // =========================================================================
  // 1. OWNER Commercial Visibility
  // =========================================================================
  describe('1. OWNER Visibility', () => {
    it('1.1 Owner sees full commercial fields in Call Log', async () => {
      const res = await callsService.getCalls(workspace1, ownerUserId, {});
      expect(res.items.length).toBe(2);
      for (const item of res.items) {
        expect(item.commercial).toBeDefined();
        expect(item.commercial).toHaveProperty('revenue');
        expect(item.commercial).toHaveProperty('payout');
        expect(item.commercial).toHaveProperty('cost');
        expect(item.commercial).toHaveProperty('profit');
        expect(item.commercial).toHaveProperty('qualified');
        expect(item.commercial).toHaveProperty('converted');
        expect(item.commercial).toHaveProperty('duplicate');
        expect(item.commercial).toHaveProperty('currency');
      }
    });

    it('1.2 Owner sees full commercial details and adjustments in Call Detail', async () => {
      const call = await callsService.getCallDetail(workspace1, callBuyerAId, ownerUserId);
      expect(call.commercial).toBeDefined();
      expect(call.commercial).toHaveProperty('revenue');
      expect(call.commercial).toHaveProperty('payout');
      expect(call.commercial).toHaveProperty('cost');
      expect(call.commercial).toHaveProperty('profit');
      expect(call.commercial.adjustment).toBeDefined();
      expect(call.commercial.adjustment).toHaveProperty('original_revenue');
      expect(call.commercial.adjustment).toHaveProperty('original_payout');
    });

    it('1.3 Owner sees full workspace-level economics in Metrics', async () => {
      const metrics = await callsService.getMetrics(workspace1, ownerUserId, {});
      expect(metrics).toHaveProperty('revenue');
      expect(metrics).toHaveProperty('payout');
      expect(metrics).toHaveProperty('cost');
      expect(metrics).toHaveProperty('profit');
      expect(metrics.total).toBe(2);
      expect(metrics.revenue).toBe(200);
      expect(metrics.payout).toBe(120);

      // Breakdowns
      const camp = Object.values(metrics.campaigns)[0] as any;
      expect(camp).toHaveProperty('revenue');
      expect(camp).toHaveProperty('payout');
      expect(camp).toHaveProperty('cost');
      expect(camp).toHaveProperty('profit');

      expect(Object.keys(metrics.buyers).length).toBe(2);
      const buyerAlpha = metrics.buyers[buyerA];
      expect(buyerAlpha).toHaveProperty('revenue');
      expect(buyerAlpha).toHaveProperty('payout');
      expect(buyerAlpha).toHaveProperty('profit');
    });
  });

  // =========================================================================
  // 2. ADMIN Commercial Visibility
  // =========================================================================
  describe('2. ADMIN Visibility', () => {
    it('2.1 Admin sees full commercial fields in Call Log, Detail, and Metrics', async () => {
      const res = await callsService.getCalls(workspace1, adminUserId, {});
      expect(res.items.length).toBe(2);
      expect(res.items[0].commercial).toHaveProperty('revenue');
      expect(res.items[0].commercial).toHaveProperty('payout');
      expect(res.items[0].commercial).toHaveProperty('profit');
      expect(res.items[0].commercial).toHaveProperty('cost');

      const detail = await callsService.getCallDetail(workspace1, callBuyerAId, adminUserId);
      expect(detail.commercial).toHaveProperty('revenue');
      expect(detail.commercial).toHaveProperty('payout');
      expect(detail.commercial).toHaveProperty('cost');
      expect(detail.commercial).toHaveProperty('profit');

      const metrics = await callsService.getMetrics(workspace1, adminUserId, {});
      expect(metrics).toHaveProperty('revenue');
      expect(metrics).toHaveProperty('payout');
      expect(metrics).toHaveProperty('cost');
      expect(metrics).toHaveProperty('profit');
    });
  });

  // =========================================================================
  // 3. INTERNAL MEMBER / VIEWER Commercial Visibility
  // =========================================================================
  describe('3. INTERNAL MEMBER / VIEWER Visibility', () => {
    it('3.1 Internal member Call Log omits revenue, payout, cost, profit', async () => {
      const res = await callsService.getCalls(workspace1, internalMemberUserId, {});
      expect(res.items.length).toBe(2);
      for (const item of res.items) {
        expect(item.commercial).toBeDefined();
        // Operational/status flags are present
        expect(item.commercial).toHaveProperty('id');
        expect(item.commercial).toHaveProperty('status');
        expect(item.commercial).toHaveProperty('qualified');
        expect(item.commercial).toHaveProperty('converted');
        expect(item.commercial).toHaveProperty('duplicate');
        expect(item.commercial).toHaveProperty('currency');
        // Financial economics MUST BE OMITTED
        expect(item.commercial).not.toHaveProperty('revenue');
        expect(item.commercial).not.toHaveProperty('payout');
        expect(item.commercial).not.toHaveProperty('cost');
        expect(item.commercial).not.toHaveProperty('profit');
      }
    });

    it('3.2 Internal member Call Detail omits revenue, payout, cost, profit, and adjustment', async () => {
      const detail = await callsService.getCallDetail(workspace1, callBuyerAId, internalMemberUserId);
      expect(detail).toBeDefined();
      expect(detail.from_number).toBe('+15551111111');
      expect(detail.commercial).toBeDefined();
      expect(detail.commercial).not.toHaveProperty('revenue');
      expect(detail.commercial).not.toHaveProperty('payout');
      expect(detail.commercial).not.toHaveProperty('cost');
      expect(detail.commercial).not.toHaveProperty('profit');
      expect(detail.commercial).not.toHaveProperty('adjustment');
    });

    it('3.3 Internal member Metrics omits financial totals across all objects', async () => {
      const metrics = await callsService.getMetrics(workspace1, internalMemberUserId, {});
      expect(metrics.total).toBe(2);
      expect(metrics.answered).toBe(2);
      // Main KPIs: financial fields omitted
      expect(metrics).not.toHaveProperty('revenue');
      expect(metrics).not.toHaveProperty('payout');
      expect(metrics).not.toHaveProperty('cost');
      expect(metrics).not.toHaveProperty('profit');

      // Breakdowns: financial fields omitted
      for (const c of Object.values(metrics.campaigns) as any[]) {
        expect(c).not.toHaveProperty('revenue');
        expect(c).not.toHaveProperty('payout');
        expect(c).not.toHaveProperty('cost');
        expect(c).not.toHaveProperty('profit');
      }

      for (const b of Object.values(metrics.buyers) as any[]) {
        expect(b).not.toHaveProperty('revenue');
        expect(b).not.toHaveProperty('payout');
        expect(b).not.toHaveProperty('cost');
        expect(b).not.toHaveProperty('profit');
      }
    });

    it('3.4 Internal member cannot access commercial disputes', async () => {
      await expect(
        disputesService.getDispute(workspace1, disputeBuyerAId, internalMemberUserId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // =========================================================================
  // 4. BUYER Participant Visibility
  // =========================================================================
  describe('4. BUYER Participant Visibility', () => {
    it('4.1 Buyer A Call Log is strictly scoped to Buyer A calls', async () => {
      const res = await callsService.getCalls(workspace1, buyerAUserId, {});
      expect(res.items.length).toBe(1);
      expect(res.items[0].id).toBe(callBuyerAId);
    });

    it('4.2 Buyer A Call Log contains revenue but OMITS payout, cost, profit, vendor', async () => {
      const res = await callsService.getCalls(workspace1, buyerAUserId, {});
      const comm = res.items[0].commercial;
      expect(comm).toBeDefined();
      expect(comm).toHaveProperty('revenue', 100);
      expect(comm).toHaveProperty('currency', 'USD');
      expect(comm).toHaveProperty('buyer');
      expect(comm).toHaveProperty('disputeStatus');
      // Prohibited keys MUST be omitted
      expect(comm).not.toHaveProperty('payout');
      expect(comm).not.toHaveProperty('cost');
      expect(comm).not.toHaveProperty('profit');
      expect(comm).not.toHaveProperty('vendor');
    });

    it('4.3 Buyer A parameter tampering with buyerId=BuyerB returns 0 calls (cannot widen scope)', async () => {
      const res = await callsService.getCalls(workspace1, buyerAUserId, { buyerId: buyerB });
      expect(res.items.length).toBe(0);
      expect(res.total).toBe(0);
    });

    it('4.4 Buyer A can view own Call Detail with sanitized commercial and adjustment', async () => {
      const call = await callsService.getCallDetail(workspace1, callBuyerAId, buyerAUserId);
      expect(call.id).toBe(callBuyerAId);
      expect(call.commercial).toBeDefined();
      expect(call.commercial).toHaveProperty('revenue');
      expect(call.commercial).not.toHaveProperty('payout');
      expect(call.commercial).not.toHaveProperty('cost');
      expect(call.commercial).not.toHaveProperty('profit');
      expect(call.commercial).not.toHaveProperty('vendor');

      // Adjustment: revenue allowed, payout omitted
      expect(call.commercial.adjustment).toBeDefined();
      expect(call.commercial.adjustment).toHaveProperty('original_revenue');
      expect(call.commercial.adjustment).toHaveProperty('adjusted_revenue');
      expect(call.commercial.adjustment).not.toHaveProperty('original_payout');
      expect(call.commercial.adjustment).not.toHaveProperty('adjusted_payout');
    });

    it('4.5 Buyer A cannot view Call Detail of Buyer B call (Forbidden)', async () => {
      await expect(
        callsService.getCallDetail(workspace1, callBuyerBId, buyerAUserId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('4.6 Buyer A Metrics contains only Buyer A data with sanitized fields', async () => {
      const metrics = await callsService.getMetrics(workspace1, buyerAUserId, {});
      expect(metrics.total).toBe(1);
      expect(metrics.commercialCalls).toBe(1);
      expect(metrics).toHaveProperty('revenue', 100);
      // Prohibited economics MUST be omitted
      expect(metrics).not.toHaveProperty('payout');
      expect(metrics).not.toHaveProperty('cost');
      expect(metrics).not.toHaveProperty('profit');

      // Buyers breakdown must ONLY include Buyer A
      expect(Object.keys(metrics.buyers)).toEqual([buyerA]);
      expect(metrics.buyers[buyerA]).toHaveProperty('revenue', 100);
      expect(metrics.buyers[buyerA]).not.toHaveProperty('payout');
      expect(metrics.buyers[buyerA]).not.toHaveProperty('cost');
      expect(metrics.buyers[buyerA]).not.toHaveProperty('profit');

      // Campaigns breakdown omits payout/cost/profit
      const camp = Object.values(metrics.campaigns)[0] as any;
      expect(camp).toHaveProperty('revenue', 100);
      expect(camp).not.toHaveProperty('payout');
      expect(camp).not.toHaveProperty('cost');
      expect(camp).not.toHaveProperty('profit');
    });

    it('4.7 Buyer A query parameter tampering on Metrics returns 0 metrics', async () => {
      const metrics = await callsService.getMetrics(workspace1, buyerAUserId, { buyerId: buyerB });
      expect(metrics.total).toBe(0);
      expect(metrics.commercialCalls).toBe(0);
      expect(metrics).toHaveProperty('revenue', 0);
      expect(metrics).not.toHaveProperty('payout');
    });

    it('4.8 Buyer A can view own dispute with payout/cost/profit omitted', async () => {
      const dispute = await disputesService.getDispute(workspace1, disputeBuyerAId, buyerAUserId);
      expect(dispute.id).toBe(disputeBuyerAId);
      expect(dispute.commercial).toBeDefined();
      expect(dispute.commercial).toHaveProperty('revenue');
      expect(dispute.commercial).not.toHaveProperty('payout');
      expect(dispute.commercial).not.toHaveProperty('cost');
      expect(dispute.commercial).not.toHaveProperty('profit');
      expect(dispute.adjustment).toBeDefined();
      expect(dispute.adjustment).toHaveProperty('original_revenue');
      expect(dispute.adjustment).not.toHaveProperty('original_payout');
    });

    it('4.9 Buyer A cannot view Buyer B dispute (Forbidden)', async () => {
      await expect(
        disputesService.getDispute(workspace1, disputeBuyerBId, buyerAUserId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // =========================================================================
  // 5. VENDOR Participant Visibility
  // =========================================================================
  describe('5. VENDOR Participant Visibility', () => {
    it('5.1 Vendor A Call Log is strictly scoped to Vendor A calls', async () => {
      const res = await callsService.getCalls(workspace1, vendorAUserId, {});
      expect(res.items.length).toBe(1);
      expect(res.items[0].id).toBe(callVendorAId);
    });

    it('5.2 Vendor A Call Log contains payout but OMITS revenue, cost, profit, buyer, disputes', async () => {
      const res = await callsService.getCalls(workspace1, vendorAUserId, {});
      const comm = res.items[0].commercial;
      expect(comm).toBeDefined();
      expect(comm).toHaveProperty('payout', 60);
      expect(comm).toHaveProperty('currency', 'USD');
      expect(comm).toHaveProperty('vendor');
      // Prohibited keys MUST be omitted
      expect(comm).not.toHaveProperty('revenue');
      expect(comm).not.toHaveProperty('cost');
      expect(comm).not.toHaveProperty('profit');
      expect(comm).not.toHaveProperty('buyer');
      expect(comm).not.toHaveProperty('disputeStatus');
      expect(comm).not.toHaveProperty('disputeReason');

      // Attempts must not leak buyer information
      for (const att of res.items[0].attempts) {
        expect(att).not.toHaveProperty('buyer');
        expect(att).not.toHaveProperty('buyer_id');
      }
    });

    it('5.3 Vendor A can view own Call Detail with sanitized commercial (payout only)', async () => {
      const call = await callsService.getCallDetail(workspace1, callVendorAId, vendorAUserId);
      expect(call.id).toBe(callVendorAId);
      expect(call.commercial).toBeDefined();
      expect(call.commercial).toHaveProperty('payout', 60);
      expect(call.commercial).toHaveProperty('vendor');
      expect(call.commercial).not.toHaveProperty('revenue');
      expect(call.commercial).not.toHaveProperty('cost');
      expect(call.commercial).not.toHaveProperty('profit');
      expect(call.commercial).not.toHaveProperty('buyer');
      expect(call.commercial).not.toHaveProperty('dispute');
      expect(call.commercial).not.toHaveProperty('adjustment');

      // Attempts must not leak buyer
      for (const att of call.attempts) {
        expect(att).not.toHaveProperty('buyer');
        expect(att).not.toHaveProperty('buyer_id');
      }
    });

    it('5.4 Vendor A cannot view Call Detail of Vendor B call (Forbidden)', async () => {
      await expect(
        callsService.getCallDetail(workspace1, callVendorBId, vendorAUserId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('5.5 Vendor A Metrics contains only Vendor A data with sanitized fields', async () => {
      const metrics = await callsService.getMetrics(workspace1, vendorAUserId, {});
      expect(metrics.total).toBe(1);
      expect(metrics.commercialCalls).toBe(1);
      expect(metrics).toHaveProperty('payout', 60);
      // Prohibited economics MUST be omitted
      expect(metrics).not.toHaveProperty('revenue');
      expect(metrics).not.toHaveProperty('cost');
      expect(metrics).not.toHaveProperty('profit');

      // Buyers breakdown MUST be empty for vendor
      expect(metrics.buyers).toEqual({});

      // Campaigns breakdown omits revenue/cost/profit
      const camp = Object.values(metrics.campaigns)[0] as any;
      expect(camp).toHaveProperty('payout', 60);
      expect(camp).not.toHaveProperty('revenue');
      expect(camp).not.toHaveProperty('cost');
      expect(camp).not.toHaveProperty('profit');
    });

    it('5.6 Vendor cannot view any buyer disputes (Forbidden)', async () => {
      await expect(
        disputesService.getDispute(workspace1, disputeBuyerAId, vendorAUserId),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        disputesService.getDispute(workspace1, disputeBuyerBId, vendorAUserId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // =========================================================================
  // 6. Cross-Workspace Isolation
  // =========================================================================
  describe('6. Cross-Workspace Isolation', () => {
    it('6.1 User from Workspace 2 cannot access Workspace 1 calls or metrics', async () => {
      await expect(
        callsService.getCallDetail(workspace1, callBuyerAId, ws2OwnerUserId),
      ).rejects.toThrow();

      await expect(
        disputesService.getDispute(workspace1, disputeBuyerAId, ws2OwnerUserId),
      ).rejects.toThrow();
    });
  });
});
