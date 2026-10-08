import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, CanActivate, ExecutionContext, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PermissionsService } from '../src/permissions/permissions.service.js';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard.js';
import {
  SettlementParticipantType,
  SettlementStatus,
  PaymentStatus,
  ReconciliationStatus,
  CommercialStatus,
  DisputeStatus,
} from '@prisma/client';
import {
  PERMISSIONS_LIST,
  ADMIN_BASELINE_PERMISSIONS,
} from '../src/permissions/permissions.constants.js';

class MockJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const userId = authHeader.split(' ')[1];
      if (userId) {
        req.user = { userId, email: `${userId}@example.com`, role: 'authenticated' };
        return true;
      }
    }
    throw new UnauthorizedException('Authentication required');
  }
}

describe('COMM-INTEGRATION-2: RBAC & Settlement API Integration (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let permissionsService: PermissionsService;

  // Workspaces
  let ws1Id: string;
  let ws2Id: string;

  // Users
  let ownerUserId: string;
  let adminUserId: string;
  let adminWithGenUserId: string;
  let memberNoPermUserId: string;
  let memberWithGenUserId: string;
  let buyerAUserId: string;
  let buyerBUserId: string;
  let vendorAUserId: string;
  let vendorBUserId: string;

  // Participants
  let buyerAId: string;
  let buyerBId: string;
  let vendorAId: string;
  let vendorBId: string;

  // Telephony & Commercial records
  let campaignId: string;
  let callAId: string;
  let callBId: string;
  let commercialAId: string;
  let commercialBId: string;

  // Settlement Batches
  let buyerBatchAId: string;
  let vendorBatchAId: string;
  let buyerBatchBId: string;
  let ws2BuyerBatchId: string;

  beforeAll(async () => {
    const dbUrl = process.env.DATABASE_URL || '';
    if (!dbUrl.includes('_test')) {
      throw new Error('Safety check failed: E2E tests must use the test database');
    }

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(MockJwtAuthGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);
    permissionsService = app.get(PermissionsService);

    // 1. Setup Workspaces
    const suffix = Math.random().toString(36).substring(7);
    const ws1 = await prisma.workspace.create({
      data: { name: 'Settlement WS 1', slug: `settle-ws1-${suffix}` },
    });
    ws1Id = ws1.id;

    const ws2 = await prisma.workspace.create({
      data: { name: 'Settlement WS 2', slug: `settle-ws2-${suffix}` },
    });
    ws2Id = ws2.id;

    // 2. Setup Participants
    const bA = await prisma.buyer.create({
      data: { workspace_id: ws1Id, name: 'Buyer Alpha', destination_number: '+18005550001' },
    });
    buyerAId = bA.id;

    const bB = await prisma.buyer.create({
      data: { workspace_id: ws1Id, name: 'Buyer Beta', destination_number: '+18005550002' },
    });
    buyerBId = bB.id;

    const vA = await prisma.vendor.create({
      data: { workspace_id: ws1Id, name: 'Vendor Alpha' },
    });
    vendorAId = vA.id;

    const vB = await prisma.vendor.create({
      data: { workspace_id: ws1Id, name: 'Vendor Beta' },
    });
    vendorBId = vB.id;

    // 3. Setup Users & Profiles
    ownerUserId = `u_owner_${suffix}`;
    adminUserId = `u_admin_${suffix}`;
    adminWithGenUserId = `u_admingen_${suffix}`;
    memberNoPermUserId = `u_noperm_${suffix}`;
    memberWithGenUserId = `u_memgen_${suffix}`;
    buyerAUserId = `u_buyerA_${suffix}`;
    buyerBUserId = `u_buyerB_${suffix}`;
    vendorAUserId = `u_vendorA_${suffix}`;
    vendorBUserId = `u_vendorB_${suffix}`;

    for (const uid of [
      ownerUserId,
      adminUserId,
      adminWithGenUserId,
      memberNoPermUserId,
      memberWithGenUserId,
      buyerAUserId,
      buyerBUserId,
      vendorAUserId,
      vendorBUserId,
    ]) {
      await prisma.profile.create({ data: { id: uid, display_name: uid } });
    }

    // Seed permissions
    await permissionsService.seedPermissions();
    const permSettleRead = await prisma.permission.findUnique({ where: { key: 'settlement:read' } });
    const permSettleGen = await prisma.permission.findUnique({ where: { key: 'settlement:generate' } });
    const permDispCreate = await prisma.permission.findUnique({ where: { key: 'dispute:create' } });

    // 4. Create Workspace Memberships
    await prisma.workspaceMember.create({
      data: { workspace_id: ws1Id, user_id: ownerUserId, role: 'OWNER', participant_type: 'INTERNAL' },
    });
    await prisma.workspaceMember.create({
      data: { workspace_id: ws1Id, user_id: adminUserId, role: 'ADMIN', participant_type: 'INTERNAL' },
    });
    const memAdminGen = await prisma.workspaceMember.create({
      data: { workspace_id: ws1Id, user_id: adminWithGenUserId, role: 'ADMIN', participant_type: 'INTERNAL' },
    });
    // Grant explicit settlement:generate to memAdminGen
    await prisma.workspaceMemberPermission.create({
      data: {
        workspace_id: ws1Id,
        workspace_member_id: memAdminGen.id,
        permission_id: permSettleGen!.id,
        scope_type: 'ALL',
      },
    });

    await prisma.workspaceMember.create({
      data: { workspace_id: ws1Id, user_id: memberNoPermUserId, role: 'MEMBER', participant_type: 'INTERNAL' },
    });

    const memGen = await prisma.workspaceMember.create({
      data: { workspace_id: ws1Id, user_id: memberWithGenUserId, role: 'MEMBER', participant_type: 'INTERNAL' },
    });
    // Grant explicit settlement:generate to memberWithGenUserId
    await prisma.workspaceMemberPermission.create({
      data: {
        workspace_id: ws1Id,
        workspace_member_id: memGen.id,
        permission_id: permSettleGen!.id,
        scope_type: 'ALL',
      },
    });

    // Buyer A Member
    const memBuyerA = await prisma.workspaceMember.create({
      data: {
        workspace_id: ws1Id,
        user_id: buyerAUserId,
        role: 'MEMBER',
        participant_type: 'BUYER',
        buyer_id: buyerAId,
      },
    });
    await prisma.workspaceMemberPermission.create({
      data: {
        workspace_id: ws1Id,
        workspace_member_id: memBuyerA.id,
        permission_id: permSettleRead!.id,
        scope_type: 'ALL',
      },
    });
    await prisma.workspaceMemberPermission.create({
      data: {
        workspace_id: ws1Id,
        workspace_member_id: memBuyerA.id,
        permission_id: permDispCreate!.id,
        scope_type: 'ALL',
      },
    });

    // Buyer B Member
    const memBuyerB = await prisma.workspaceMember.create({
      data: {
        workspace_id: ws1Id,
        user_id: buyerBUserId,
        role: 'MEMBER',
        participant_type: 'BUYER',
        buyer_id: buyerBId,
      },
    });
    await prisma.workspaceMemberPermission.create({
      data: {
        workspace_id: ws1Id,
        workspace_member_id: memBuyerB.id,
        permission_id: permSettleRead!.id,
        scope_type: 'ALL',
      },
    });

    // Vendor A Member
    const memVendorA = await prisma.workspaceMember.create({
      data: {
        workspace_id: ws1Id,
        user_id: vendorAUserId,
        role: 'MEMBER',
        participant_type: 'VENDOR',
        vendor_id: vendorAId,
      },
    });
    await prisma.workspaceMemberPermission.create({
      data: {
        workspace_id: ws1Id,
        workspace_member_id: memVendorA.id,
        permission_id: permSettleRead!.id,
        scope_type: 'ALL',
      },
    });

    // Vendor B Member
    const memVendorB = await prisma.workspaceMember.create({
      data: {
        workspace_id: ws1Id,
        user_id: vendorBUserId,
        role: 'MEMBER',
        participant_type: 'VENDOR',
        vendor_id: vendorBId,
      },
    });
    await prisma.workspaceMemberPermission.create({
      data: {
        workspace_id: ws1Id,
        workspace_member_id: memVendorB.id,
        permission_id: permSettleRead!.id,
        scope_type: 'ALL',
      },
    });

    // 5. Campaign & Calls & Commercials
    const camp = await prisma.campaign.create({
      data: {
        workspace_id: ws1Id,
        name: 'Auto Settle Campaign',
        currency: 'USD',
        default_revenue_amount: 150.0,
        default_payout_amount: 90.0,
      },
    });
    campaignId = camp.id;

    const phone = await prisma.phoneNumber.create({
      data: {
        workspace_id: ws1Id,
        phone_number: `+1911${Math.floor(1000000 + Math.random() * 9000000)}`,
        provider: 'telnyx',
      },
    });

    const cA = await prisma.call.create({
      data: {
        workspace_id: ws1Id,
        campaign_id: campaignId,
        provider: 'telnyx',
        provider_call_id: `call-a-${suffix}`,
        from_number: '+15550001',
        to_number: phone.phone_number,
        state: 'COMPLETED',
        started_at: new Date('2026-08-01T10:00:00Z'),
        ended_at: new Date('2026-08-01T10:05:00Z'),
      },
    });
    callAId = cA.id;

    const commA = await prisma.callCommercial.create({
      data: {
        workspace_id: ws1Id,
        call_id: callAId,
        campaign_id: campaignId,
        buyer_id: buyerAId,
        vendor_id: vendorAId,
        currency: 'USD',
        revenue: 150.0,
        payout: 90.0,
        cost: 3.5,
        profit: 56.5,
        qualified: true,
        converted: true,
        status: CommercialStatus.FINAL,
      },
    });
    commercialAId = commA.id;

    const cB = await prisma.call.create({
      data: {
        workspace_id: ws1Id,
        campaign_id: campaignId,
        provider: 'telnyx',
        provider_call_id: `call-b-${suffix}`,
        from_number: '+15550002',
        to_number: phone.phone_number,
        state: 'COMPLETED',
        started_at: new Date('2026-08-01T11:00:00Z'),
        ended_at: new Date('2026-08-01T11:05:00Z'),
      },
    });
    callBId = cB.id;

    const commB = await prisma.callCommercial.create({
      data: {
        workspace_id: ws1Id,
        call_id: callBId,
        campaign_id: campaignId,
        buyer_id: buyerBId,
        vendor_id: vendorBId,
        currency: 'USD',
        revenue: 150.0,
        payout: 90.0,
        cost: 4.0,
        profit: 56.0,
        qualified: true,
        converted: true,
        status: CommercialStatus.FINAL,
      },
    });
    commercialBId = commB.id;

    // 6. Pre-existing Batches & Items for GET endpoints
    const bBatchA = await prisma.settlementBatch.create({
      data: {
        workspace_id: ws1Id,
        batch_number: `SB-BUYER-A-${suffix}`,
        participant_type: SettlementParticipantType.BUYER,
        buyer_id: buyerAId,
        currency: 'USD',
        period_start: new Date('2026-08-01T00:00:00Z'),
        period_end: new Date('2026-08-02T00:00:00Z'),
        gross_amount: 150.0,
        adjustments_amount: 0.0,
        net_amount: 150.0,
        item_count: 1,
        settlement_status: SettlementStatus.DRAFT,
        payment_status: PaymentStatus.UNPROCESSED,
        reconciliation_status: ReconciliationStatus.UNRECONCILED,
        created_by_user_id: ownerUserId,
      },
    });
    buyerBatchAId = bBatchA.id;

    await prisma.settlementItem.create({
      data: {
        workspace_id: ws1Id,
        settlement_batch_id: buyerBatchAId,
        call_commercial_id: commercialAId,
        participant_type: SettlementParticipantType.BUYER,
        amount: 150.0,
        currency: 'USD',
      },
    });

    const vBatchA = await prisma.settlementBatch.create({
      data: {
        workspace_id: ws1Id,
        batch_number: `SB-VENDOR-A-${suffix}`,
        participant_type: SettlementParticipantType.VENDOR,
        vendor_id: vendorAId,
        currency: 'USD',
        period_start: new Date('2026-08-01T00:00:00Z'),
        period_end: new Date('2026-08-02T00:00:00Z'),
        gross_amount: 90.0,
        adjustments_amount: 0.0,
        net_amount: 90.0,
        item_count: 1,
        settlement_status: SettlementStatus.DRAFT,
        payment_status: PaymentStatus.UNPROCESSED,
        reconciliation_status: ReconciliationStatus.UNRECONCILED,
        created_by_user_id: ownerUserId,
      },
    });
    vendorBatchAId = vBatchA.id;

    await prisma.settlementItem.create({
      data: {
        workspace_id: ws1Id,
        settlement_batch_id: vendorBatchAId,
        call_commercial_id: commercialAId,
        participant_type: SettlementParticipantType.VENDOR,
        amount: 90.0,
        currency: 'USD',
      },
    });

    const bBatchB = await prisma.settlementBatch.create({
      data: {
        workspace_id: ws1Id,
        batch_number: `SB-BUYER-B-${suffix}`,
        participant_type: SettlementParticipantType.BUYER,
        buyer_id: buyerBId,
        currency: 'USD',
        period_start: new Date('2026-08-01T00:00:00Z'),
        period_end: new Date('2026-08-02T00:00:00Z'),
        gross_amount: 150.0,
        adjustments_amount: 0.0,
        net_amount: 150.0,
        item_count: 1,
        created_by_user_id: ownerUserId,
      },
    });
    buyerBatchBId = bBatchB.id;

    // Batch in Workspace 2 for IDOR test
    const ws2Batch = await prisma.settlementBatch.create({
      data: {
        workspace_id: ws2Id,
        batch_number: `SB-WS2-${suffix}`,
        participant_type: SettlementParticipantType.BUYER,
        buyer_id: buyerAId,
        currency: 'USD',
        period_start: new Date('2026-08-01T00:00:00Z'),
        period_end: new Date('2026-08-02T00:00:00Z'),
        gross_amount: 100.0,
        net_amount: 100.0,
        item_count: 0,
        created_by_user_id: ownerUserId,
      },
    });
    ws2BuyerBatchId = ws2Batch.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // =========================================================================
  // 1. RBAC PERMISSIONS REGISTRATION & BASELINE CHECKS
  // =========================================================================
  describe('1. RBAC Permissions Registration & Baseline Alignment (AD-04)', () => {
    it('1.1 should include all 6 frozen commercial and settlement permissions in registry', () => {
      const keys = PERMISSIONS_LIST.map((p) => p.key);
      expect(keys).toContain('commercial:read');
      expect(keys).toContain('commercial:export');
      expect(keys).toContain('dispute:create');
      expect(keys).toContain('dispute:manage');
      expect(keys).toContain('settlement:read');
      expect(keys).toContain('settlement:generate');
    });

    it('1.2 should include 5 baseline permissions in ADMIN_BASELINE_PERMISSIONS', () => {
      expect(ADMIN_BASELINE_PERMISSIONS).toContain('commercial:read');
      expect(ADMIN_BASELINE_PERMISSIONS).toContain('commercial:export');
      expect(ADMIN_BASELINE_PERMISSIONS).toContain('dispute:create');
      expect(ADMIN_BASELINE_PERMISSIONS).toContain('dispute:manage');
      expect(ADMIN_BASELINE_PERMISSIONS).toContain('settlement:read');
    });

    it('1.3 should strictly exclude settlement:generate from ADMIN_BASELINE_PERMISSIONS (OWNER-only baseline)', () => {
      expect(ADMIN_BASELINE_PERMISSIONS).not.toContain('settlement:generate');
    });

    it('1.4 hasPermission returns true for OWNER on settlement:generate', async () => {
      const hasPerm = await permissionsService.hasPermission(ws1Id, ownerUserId, 'settlement:generate');
      expect(hasPerm).toBe(true);
    });

    it('1.5 hasPermission returns false for default ADMIN on settlement:generate', async () => {
      const hasPerm = await permissionsService.hasPermission(ws1Id, adminUserId, 'settlement:generate');
      expect(hasPerm).toBe(false);
    });

    it('1.6 hasPermission returns true for ADMIN with explicit settlement:generate grant', async () => {
      const hasPerm = await permissionsService.hasPermission(ws1Id, adminWithGenUserId, 'settlement:generate');
      expect(hasPerm).toBe(true);
    });

    it('1.7 hasPermission returns false for MEMBER without settlement:read', async () => {
      const hasPerm = await permissionsService.hasPermission(ws1Id, memberNoPermUserId, 'settlement:read');
      expect(hasPerm).toBe(false);
    });
  });

  // =========================================================================
  // 2. DISPUTE CONTROLLER RBAC ALIGNMENT
  // =========================================================================
  describe('2. Dispute Controller RBAC Alignment (AD-04)', () => {
    it('2.1 Buyer with dispute:create can create dispute on eligible commercial', async () => {
      const res = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/call-commercials/${commercialAId}/dispute`)
        .set('Authorization', `Bearer ${buyerAUserId}`)
        .send({ reason: 'Lead disconnected immediately' });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.reason).toBe('Lead disconnected immediately');
    });

    it('2.2 Member without dispute:create is rejected with 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/call-commercials/${commercialBId}/dispute`)
        .set('Authorization', `Bearer ${memberNoPermUserId}`)
        .send({ reason: 'Unauthorized dispute attempt' });

      expect(res.status).toBe(403);
    });

    it('2.3 Admin with dispute:manage can resolve dispute', async () => {
      // Find created dispute
      const disp = await prisma.callDispute.findFirst({
        where: { call_commercial_id: commercialAId },
      });

      const res = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/disputes/${disp!.id}/resolve`)
        .set('Authorization', `Bearer ${adminUserId}`)
        .send({ status: DisputeStatus.ACCEPTED, resolution_notes: 'Approved by admin' });

      expect(res.status).toBe(201);
      expect(res.body.dispute.status).toBe(DisputeStatus.ACCEPTED);
    });

    it('2.4 Buyer without dispute:manage cannot resolve dispute (403 Forbidden)', async () => {
      const disp = await prisma.callDispute.findFirst({
        where: { call_commercial_id: commercialAId },
      });

      const res = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/disputes/${disp!.id}/resolve`)
        .set('Authorization', `Bearer ${buyerAUserId}`)
        .send({ status: DisputeStatus.ACCEPTED });

      expect(res.status).toBe(403);
    });
  });

  // =========================================================================
  // 3. SETTLEMENT GENERATION (POST /batches/generate) (AD-05)
  // =========================================================================
  describe('3. POST /workspaces/:workspaceId/settlements/batches/generate', () => {
    it('3.1 Owner can generate settlement batches (settlement:generate)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/settlements/batches/generate`)
        .set('Authorization', `Bearer ${ownerUserId}`)
        .send({
          participant_type: 'BUYER',
          period_start: '2026-08-01T00:00:00.000Z',
          period_end: '2026-08-02T00:00:00.000Z',
        });

      expect(res.status).toBe(201);
      expect(res.body.workspace_id).toBe(ws1Id);
      expect(res.body.participant_type).toBe('BUYER');
      expect(Array.isArray(res.body.batches)).toBe(true);
    });

    it('3.2 Admin WITHOUT explicit settlement:generate is rejected with 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/settlements/batches/generate`)
        .set('Authorization', `Bearer ${adminUserId}`)
        .send({
          participant_type: 'BUYER',
          period_start: '2026-08-01T00:00:00.000Z',
          period_end: '2026-08-02T00:00:00.000Z',
        });

      expect(res.status).toBe(403);
    });

    it('3.3 Member WITHOUT settlement:generate is rejected with 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/settlements/batches/generate`)
        .set('Authorization', `Bearer ${memberNoPermUserId}`)
        .send({
          participant_type: 'BUYER',
          period_start: '2026-08-01T00:00:00.000Z',
          period_end: '2026-08-02T00:00:00.000Z',
        });

      expect(res.status).toBe(403);
    });

    it('3.4 Admin WITH explicit settlement:generate is still rejected because settlement generation is OWNER-only', async () => {
      const res = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/settlements/batches/generate`)
        .set('Authorization', `Bearer ${adminWithGenUserId}`)
        .send({
          participant_type: 'VENDOR',
          period_start: '2026-08-01T00:00:00.000Z',
          period_end: '2026-08-02T00:00:00.000Z',
        });

      expect(res.status).toBe(403);
    });

    it('3.4b Member WITH explicit settlement:generate is still rejected because settlement generation is OWNER-only', async () => {
      const res = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/settlements/batches/generate`)
        .set('Authorization', `Bearer ${memberWithGenUserId}`)
        .send({
          participant_type: 'BUYER',
          period_start: '2026-08-01T00:00:00.000Z',
          period_end: '2026-08-02T00:00:00.000Z',
        });

      expect(res.status).toBe(403);
    });

    it('3.5 Rejects invalid period range where period_start >= period_end (400 Bad Request)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/settlements/batches/generate`)
        .set('Authorization', `Bearer ${ownerUserId}`)
        .send({
          participant_type: 'BUYER',
          period_start: '2026-08-05T00:00:00.000Z',
          period_end: '2026-08-01T00:00:00.000Z',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/period_start must be before period_end/i);
    });

    it('3.6 Rejects vendor_id when participant_type is BUYER (400 Bad Request)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/settlements/batches/generate`)
        .set('Authorization', `Bearer ${ownerUserId}`)
        .send({
          participant_type: 'BUYER',
          period_start: '2026-08-01T00:00:00.000Z',
          period_end: '2026-08-02T00:00:00.000Z',
          vendor_id: vendorAId,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/vendor_id cannot be provided when participant_type is BUYER/i);
    });

    it('3.7 Rejects buyer_id when participant_type is VENDOR (400 Bad Request)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/settlements/batches/generate`)
        .set('Authorization', `Bearer ${ownerUserId}`)
        .send({
          participant_type: 'VENDOR',
          period_start: '2026-08-01T00:00:00.000Z',
          period_end: '2026-08-02T00:00:00.000Z',
          buyer_id: buyerAId,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/buyer_id cannot be provided when participant_type is VENDOR/i);
    });
  });

  // =========================================================================
  // 4. SETTLEMENT BATCHES LISTING (GET /batches) (AD-05)
  // =========================================================================
  describe('4. GET /workspaces/:workspaceId/settlements/batches', () => {
    it('4.1 Member without settlement:read is rejected with 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .get(`/workspaces/${ws1Id}/settlements/batches`)
        .set('Authorization', `Bearer ${memberNoPermUserId}`);

      expect(res.status).toBe(403);
    });

    it('4.2 Owner sees all batches in the workspace', async () => {
      const res = await request(app.getHttpServer())
        .get(`/workspaces/${ws1Id}/settlements/batches`)
        .set('Authorization', `Bearer ${ownerUserId}`);

      expect(res.status).toBe(200);
      expect(res.body.batches.length).toBeGreaterThanOrEqual(3);
      const batchIds = res.body.batches.map((b: any) => b.id);
      expect(batchIds).toContain(buyerBatchAId);
      expect(batchIds).toContain(buyerBatchBId);
      expect(batchIds).toContain(vendorBatchAId);
    });

    it('4.3 Buyer is automatically scoped to their own buyer batches with financial sanitization', async () => {
      const res = await request(app.getHttpServer())
        .get(`/workspaces/${ws1Id}/settlements/batches`)
        .set('Authorization', `Bearer ${buyerAUserId}`);

      expect(res.status).toBe(200);
      expect(res.body.batches.length).toBeGreaterThanOrEqual(1);
      for (const batch of res.body.batches) {
        expect(batch.participant_type).toBe('BUYER');
        expect(batch.buyer_id).toBe(buyerAId);
        // Financial sanitization: never sees vendor economics
        expect(batch.vendor_id).toBeUndefined();
        expect(batch.payout).toBeUndefined();
        expect(batch.cost).toBeUndefined();
        expect(batch.profit).toBeUndefined();
      }
    });

    it('4.4 Buyer requesting vendor batches is rejected with 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .get(`/workspaces/${ws1Id}/settlements/batches?participant_type=VENDOR`)
        .set('Authorization', `Bearer ${buyerAUserId}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Buyer cannot access vendor data/i);
    });

    it('4.5 Buyer requesting another buyer account is rejected with 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .get(`/workspaces/${ws1Id}/settlements/batches?buyer_id=${buyerBId}`)
        .set('Authorization', `Bearer ${buyerAUserId}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Buyer can only access batches for their own account/i);
    });

    it('4.6 Vendor is automatically scoped to their own vendor batches with financial sanitization', async () => {
      const res = await request(app.getHttpServer())
        .get(`/workspaces/${ws1Id}/settlements/batches`)
        .set('Authorization', `Bearer ${vendorAUserId}`);

      expect(res.status).toBe(200);
      expect(res.body.batches.length).toBeGreaterThanOrEqual(1);
      for (const batch of res.body.batches) {
        expect(batch.participant_type).toBe('VENDOR');
        expect(batch.vendor_id).toBe(vendorAId);
        // Financial sanitization: never sees buyer economics
        expect(batch.buyer_id).toBeUndefined();
        expect(batch.revenue).toBeUndefined();
        expect(batch.cost).toBeUndefined();
        expect(batch.profit).toBeUndefined();
      }
    });

    it('4.7 Vendor requesting buyer batches is rejected with 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .get(`/workspaces/${ws1Id}/settlements/batches?participant_type=BUYER`)
        .set('Authorization', `Bearer ${vendorAUserId}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Vendor cannot access buyer data/i);
    });

    it('4.8 Vendor requesting another vendor account is rejected with 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .get(`/workspaces/${ws1Id}/settlements/batches?vendor_id=${vendorBId}`)
        .set('Authorization', `Bearer ${vendorAUserId}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Vendor can only access batches for their own account/i);
    });
  });

  // =========================================================================
  // 5. SETTLEMENT BATCH DETAIL (GET /batches/:batchId) (AD-05)
  // =========================================================================
  describe('5. GET /workspaces/:workspaceId/settlements/batches/:batchId', () => {
    it('5.1 Cross-workspace IDOR protection returns 404 Not Found', async () => {
      // ws2BuyerBatchId belongs to ws2Id, accessing it via ws1Id must return 404
      const res = await request(app.getHttpServer())
        .get(`/workspaces/${ws1Id}/settlements/batches/${ws2BuyerBatchId}`)
        .set('Authorization', `Bearer ${ownerUserId}`);

      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/Settlement batch not found/i);
    });

    it('5.2 Non-existent batch ID returns 404 Not Found', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const res = await request(app.getHttpServer())
        .get(`/workspaces/${ws1Id}/settlements/batches/${fakeId}`)
        .set('Authorization', `Bearer ${ownerUserId}`);

      expect(res.status).toBe(404);
    });

    it('5.3 Buyer can access their own batch with sanitization (no vendor_id or vendor economics)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/workspaces/${ws1Id}/settlements/batches/${buyerBatchAId}`)
        .set('Authorization', `Bearer ${buyerAUserId}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(buyerBatchAId);
      expect(res.body.buyer_id).toBe(buyerAId);
      expect(res.body.vendor_id).toBeUndefined();
      expect(res.body.payout).toBeUndefined();
      expect(res.body.cost).toBeUndefined();
      expect(res.body.profit).toBeUndefined();
    });

    it('5.4 Buyer attempting to access another buyer batch gets 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .get(`/workspaces/${ws1Id}/settlements/batches/${buyerBatchBId}`)
        .set('Authorization', `Bearer ${buyerAUserId}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Access denied to this settlement batch/i);
    });

    it('5.5 Buyer attempting to access vendor batch gets 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .get(`/workspaces/${ws1Id}/settlements/batches/${vendorBatchAId}`)
        .set('Authorization', `Bearer ${buyerAUserId}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Access denied to this settlement batch/i);
    });

    it('5.6 Vendor can access their own batch with sanitization (no buyer_id or buyer economics)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/workspaces/${ws1Id}/settlements/batches/${vendorBatchAId}`)
        .set('Authorization', `Bearer ${vendorAUserId}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(vendorBatchAId);
      expect(res.body.vendor_id).toBe(vendorAId);
      expect(res.body.buyer_id).toBeUndefined();
      expect(res.body.revenue).toBeUndefined();
      expect(res.body.cost).toBeUndefined();
      expect(res.body.profit).toBeUndefined();
    });

    it('5.7 Vendor attempting to access buyer batch gets 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .get(`/workspaces/${ws1Id}/settlements/batches/${buyerBatchAId}`)
        .set('Authorization', `Bearer ${vendorAUserId}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/Access denied to this settlement batch/i);
    });
  });

  // =========================================================================
  // 6. SETTLEMENT BATCH ITEMS & FINANCIAL SANITIZATION (AD-04, AD-05)
  // =========================================================================
  describe('6. GET /workspaces/:workspaceId/settlements/batches/:batchId/items', () => {
    it('6.1 Cross-workspace IDOR protection returns 404 Not Found', async () => {
      const res = await request(app.getHttpServer())
        .get(`/workspaces/${ws1Id}/settlements/batches/${ws2BuyerBatchId}/items`)
        .set('Authorization', `Bearer ${ownerUserId}`);

      expect(res.status).toBe(404);
    });

    it('6.2 Owner sees complete financial fields on commercial line items', async () => {
      const res = await request(app.getHttpServer())
        .get(`/workspaces/${ws1Id}/settlements/batches/${buyerBatchAId}/items`)
        .set('Authorization', `Bearer ${ownerUserId}`);

      expect(res.status).toBe(200);
      expect(res.body.items.length).toBe(1);
      const item = res.body.items[0];
      expect(item.commercial).toBeDefined();
      expect(item.commercial).toHaveProperty('revenue');
      expect(item.commercial).toHaveProperty('payout');
      expect(item.commercial).toHaveProperty('cost');
      expect(item.commercial).toHaveProperty('profit');
      expect(item.commercial).toHaveProperty('buyer_id');
      expect(item.commercial).toHaveProperty('vendor_id');
    });

    it('6.3 Admin sees complete financial fields on commercial line items', async () => {
      const res = await request(app.getHttpServer())
        .get(`/workspaces/${ws1Id}/settlements/batches/${vendorBatchAId}/items`)
        .set('Authorization', `Bearer ${adminUserId}`);

      expect(res.status).toBe(200);
      expect(res.body.items.length).toBe(1);
      const item = res.body.items[0];
      expect(item.commercial).toBeDefined();
      expect(item.commercial).toHaveProperty('revenue');
      expect(item.commercial).toHaveProperty('payout');
      expect(item.commercial).toHaveProperty('cost');
      expect(item.commercial).toHaveProperty('profit');
      expect(item.commercial).toHaveProperty('buyer_id');
      expect(item.commercial).toHaveProperty('vendor_id');
    });

    it('6.4 Buyer line items are sanitized: never sees payout, cost, profit, vendor_id', async () => {
      const res = await request(app.getHttpServer())
        .get(`/workspaces/${ws1Id}/settlements/batches/${buyerBatchAId}/items`)
        .set('Authorization', `Bearer ${buyerAUserId}`);

      expect(res.status).toBe(200);
      expect(res.body.items.length).toBe(1);
      const item = res.body.items[0];
      expect(item.vendor_id).toBeUndefined();

      expect(item.commercial).toBeDefined();
      // Permitted fields
      expect(item.commercial).toHaveProperty('revenue');
      expect(item.commercial).toHaveProperty('buyer_id');
      expect(item.commercial).toHaveProperty('qualified');
      expect(item.commercial).toHaveProperty('converted');
      // STRICTLY SANITIZED FIELDS
      expect(item.commercial.payout).toBeUndefined();
      expect(item.commercial.cost).toBeUndefined();
      expect(item.commercial.profit).toBeUndefined();
      expect(item.commercial.vendor_id).toBeUndefined();
    });

    it('6.5 Vendor line items are sanitized: never sees revenue, cost, profit, buyer_id', async () => {
      const res = await request(app.getHttpServer())
        .get(`/workspaces/${ws1Id}/settlements/batches/${vendorBatchAId}/items`)
        .set('Authorization', `Bearer ${vendorAUserId}`);

      expect(res.status).toBe(200);
      expect(res.body.items.length).toBe(1);
      const item = res.body.items[0];
      expect(item.buyer_id).toBeUndefined();

      expect(item.commercial).toBeDefined();
      // Permitted fields
      expect(item.commercial).toHaveProperty('payout');
      expect(item.commercial).toHaveProperty('vendor_id');
      expect(item.commercial).toHaveProperty('qualified');
      expect(item.commercial).toHaveProperty('converted');
      // STRICTLY SANITIZED FIELDS
      expect(item.commercial.revenue).toBeUndefined();
      expect(item.commercial.cost).toBeUndefined();
      expect(item.commercial.profit).toBeUndefined();
      expect(item.commercial.buyer_id).toBeUndefined();
    });

    it('6.6 Buyer requesting items of another buyer batch is rejected (403 Forbidden)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/workspaces/${ws1Id}/settlements/batches/${buyerBatchBId}/items`)
        .set('Authorization', `Bearer ${buyerAUserId}`);

      expect(res.status).toBe(403);
    });

    it('6.7 Vendor requesting items of another vendor or buyer batch is rejected (403 Forbidden)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/workspaces/${ws1Id}/settlements/batches/${buyerBatchAId}/items`)
        .set('Authorization', `Bearer ${vendorAUserId}`);

      expect(res.status).toBe(403);
    });
  });
});
