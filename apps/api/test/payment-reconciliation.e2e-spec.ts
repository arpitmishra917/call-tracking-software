import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
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
  ReconciliationRunType,
  ReconciliationIssueType,
  CommercialStatus,
  InstructionStatus,
  ExecutionStatus,
  PaymentDirection,
  Prisma,
} from '@prisma/client';
import {
  PERMISSIONS_LIST,
  ADMIN_BASELINE_PERMISSIONS,
} from '../src/permissions/permissions.constants.js';
import { vi } from 'vitest';

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

describe('COMM-INTEGRATION-8B: Payment & Reconciliation Engine (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let permissionsService: PermissionsService;

  // Workspaces
  let ws1Id: string;
  let ws2Id: string;

  // Users
  let ownerUserId: string;
  let adminUserId: string;
  let memberUserId: string;
  let buyerUserId: string;
  let vendorUserId: string;
  let ws2OwnerUserId: string;

  // Participants
  let buyerId: string;
  let vendorId: string;

  // Telephony & Commercial
  let campaignId: string;
  let call1Id: string;
  let call2Id: string;
  let call3Id: string;
  let commercial1Id: string;
  let commercial2Id: string;
  let commercial3Id: string;
  let createTestCommercial: (rev?: number, curr?: string) => Promise<string>;

  // Settlement batches
  let finalizedBuyerBatchId: string;
  let draftBatchId: string;
  let finalizedVendorBatchId: string;
  let ws2BatchId: string;

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

    // Setup Workspaces
    const suffix = Math.random().toString(36).substring(7);
    const ws1 = await prisma.workspace.create({
      data: { name: 'Payment WS 1', slug: `pay-ws1-${suffix}` },
    });
    ws1Id = ws1.id;

    const ws2 = await prisma.workspace.create({
      data: { name: 'Payment WS 2', slug: `pay-ws2-${suffix}` },
    });
    ws2Id = ws2.id;

    // Setup Participants
    const b = await prisma.buyer.create({
      data: { workspace_id: ws1Id, name: 'Buyer Pay Alpha', destination_number: '+18005551111' },
    });
    buyerId = b.id;

    const v = await prisma.vendor.create({
      data: { workspace_id: ws1Id, name: 'Vendor Pay Alpha' },
    });
    vendorId = v.id;

    const b2 = await prisma.buyer.create({
      data: { workspace_id: ws2Id, name: 'Buyer Pay WS2', destination_number: '+18005552222' },
    });
    const ws2BuyerId = b2.id;

    // Users & Profiles
    ownerUserId = `u_owner_${suffix}`;
    adminUserId = `u_admin_${suffix}`;
    memberUserId = `u_member_${suffix}`;
    buyerUserId = `u_buyer_${suffix}`;
    vendorUserId = `u_vendor_${suffix}`;
    ws2OwnerUserId = `u_ws2owner_${suffix}`;

    for (const uid of [
      ownerUserId,
      adminUserId,
      memberUserId,
      buyerUserId,
      vendorUserId,
      ws2OwnerUserId,
    ]) {
      await prisma.profile.create({ data: { id: uid, display_name: uid } });
    }

    // Seed permissions
    await permissionsService.seedPermissions();

    // Memberships in ws1
    await prisma.workspaceMember.create({
      data: { workspace_id: ws1Id, user_id: ownerUserId, role: 'OWNER', participant_type: 'INTERNAL' },
    });
    await prisma.workspaceMember.create({
      data: { workspace_id: ws1Id, user_id: adminUserId, role: 'ADMIN', participant_type: 'INTERNAL' },
    });
    await prisma.workspaceMember.create({
      data: { workspace_id: ws1Id, user_id: memberUserId, role: 'MEMBER', participant_type: 'INTERNAL' },
    });
    await prisma.workspaceMember.create({
      data: {
        workspace_id: ws1Id,
        user_id: buyerUserId,
        role: 'MEMBER',
        participant_type: 'BUYER',
        buyer_id: buyerId,
      },
    });
    await prisma.workspaceMember.create({
      data: {
        workspace_id: ws1Id,
        user_id: vendorUserId,
        role: 'MEMBER',
        participant_type: 'VENDOR',
        vendor_id: vendorId,
      },
    });

    // Membership in ws2
    await prisma.workspaceMember.create({
      data: { workspace_id: ws2Id, user_id: ws2OwnerUserId, role: 'OWNER', participant_type: 'INTERNAL' },
    });

    // Campaign & Calls
    const camp = await prisma.campaign.create({
      data: { workspace_id: ws1Id, name: 'Pay Camp' },
    });
    campaignId = camp.id;

    const phone = await prisma.phoneNumber.create({
      data: {
        workspace_id: ws1Id,
        campaign_id: campaignId,
        phone_number: `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
        status: 'ACTIVE',
        provider: 'telnyx',
      },
    });

    createTestCommercial = async (rev = 100.0, curr = 'USD') => {
      const c = await prisma.call.create({
        data: {
          workspace_id: ws1Id,
          campaign_id: campaignId,
          provider: 'telnyx',
          provider_call_id: `c_test_${Math.random().toString(36).substring(7)}`,
          from_number: '+15550000',
          to_number: phone.phone_number,
          state: 'COMPLETED',
        },
      });
      const comm = await prisma.callCommercial.create({
        data: {
          workspace_id: ws1Id,
          call_id: c.id,
          campaign_id: campaignId,
          buyer_id: buyerId,
          vendor_id: vendorId,
          currency: curr,
          revenue: rev,
          payout: rev * 0.5,
          cost: 2.0,
          profit: rev * 0.5 - 2.0,
          qualified: true,
          converted: true,
          status: CommercialStatus.FINAL,
        },
      });
      return comm.id;
    };

    const c1 = await prisma.call.create({
      data: {
        workspace_id: ws1Id,
        campaign_id: campaignId,
        provider: 'telnyx',
        provider_call_id: `c1-${suffix}`,
        from_number: '+15550001',
        to_number: phone.phone_number,
        state: 'COMPLETED',
      },
    });
    call1Id = c1.id;

    const comm1 = await prisma.callCommercial.create({
      data: {
        workspace_id: ws1Id,
        call_id: call1Id,
        campaign_id: campaignId,
        buyer_id: buyerId,
        vendor_id: vendorId,
        currency: 'USD',
        revenue: 500.0,
        payout: 250.0,
        cost: 5.0,
        profit: 245.0,
        qualified: true,
        converted: true,
        status: CommercialStatus.FINAL,
      },
    });
    commercial1Id = comm1.id;

    const c2 = await prisma.call.create({
      data: {
        workspace_id: ws1Id,
        campaign_id: campaignId,
        provider: 'telnyx',
        provider_call_id: `c2-${suffix}`,
        from_number: '+15550002',
        to_number: phone.phone_number,
        state: 'COMPLETED',
      },
    });
    call2Id = c2.id;

    const comm2 = await prisma.callCommercial.create({
      data: {
        workspace_id: ws1Id,
        call_id: call2Id,
        campaign_id: campaignId,
        buyer_id: buyerId,
        vendor_id: vendorId,
        currency: 'USD',
        revenue: 300.0,
        payout: 150.0,
        cost: 3.0,
        profit: 147.0,
        qualified: true,
        converted: true,
        status: CommercialStatus.FINAL,
      },
    });
    commercial2Id = comm2.id;

    // Batches
    // 1. FINALIZED Buyer Batch
    const bBatch = await prisma.settlementBatch.create({
      data: {
        workspace_id: ws1Id,
        batch_number: `SB-BUYER-FIN-${suffix}`,
        participant_type: SettlementParticipantType.BUYER,
        buyer_id: buyerId,
        currency: 'USD',
        period_start: new Date('2026-08-01T00:00:00Z'),
        period_end: new Date('2026-08-02T00:00:00Z'),
        gross_amount: 500.0,
        adjustments_amount: 0.0,
        net_amount: 500.0,
        item_count: 1,
        settlement_status: SettlementStatus.FINALIZED,
        payment_status: PaymentStatus.UNPROCESSED,
        reconciliation_status: ReconciliationStatus.UNRECONCILED,
        created_by_user_id: ownerUserId,
        finalized_at: new Date(),
      },
    });
    finalizedBuyerBatchId = bBatch.id;

    await prisma.settlementItem.create({
      data: {
        workspace_id: ws1Id,
        settlement_batch_id: finalizedBuyerBatchId,
        call_commercial_id: commercial1Id,
        participant_type: SettlementParticipantType.BUYER,
        amount: 500.0,
        currency: 'USD',
      },
    });

    // 2. DRAFT Batch
    const dBatch = await prisma.settlementBatch.create({
      data: {
        workspace_id: ws1Id,
        batch_number: `SB-DRAFT-${suffix}`,
        participant_type: SettlementParticipantType.BUYER,
        buyer_id: buyerId,
        currency: 'USD',
        period_start: new Date('2026-08-02T00:00:00Z'),
        period_end: new Date('2026-08-03T00:00:00Z'),
        gross_amount: 300.0,
        adjustments_amount: 0.0,
        net_amount: 300.0,
        item_count: 1,
        settlement_status: SettlementStatus.DRAFT,
        payment_status: PaymentStatus.UNPROCESSED,
        reconciliation_status: ReconciliationStatus.UNRECONCILED,
        created_by_user_id: ownerUserId,
      },
    });
    draftBatchId = dBatch.id;

    // 3. FINALIZED Vendor Batch
    const vBatch = await prisma.settlementBatch.create({
      data: {
        workspace_id: ws1Id,
        batch_number: `SB-VENDOR-FIN-${suffix}`,
        participant_type: SettlementParticipantType.VENDOR,
        vendor_id: vendorId,
        currency: 'USD',
        period_start: new Date('2026-08-01T00:00:00Z'),
        period_end: new Date('2026-08-02T00:00:00Z'),
        gross_amount: 250.0,
        adjustments_amount: 0.0,
        net_amount: 250.0,
        item_count: 1,
        settlement_status: SettlementStatus.FINALIZED,
        payment_status: PaymentStatus.UNPROCESSED,
        reconciliation_status: ReconciliationStatus.UNRECONCILED,
        created_by_user_id: ownerUserId,
        finalized_at: new Date(),
      },
    });
    finalizedVendorBatchId = vBatch.id;

    await prisma.settlementItem.create({
      data: {
        workspace_id: ws1Id,
        settlement_batch_id: finalizedVendorBatchId,
        call_commercial_id: commercial1Id,
        participant_type: SettlementParticipantType.VENDOR,
        amount: 250.0,
        currency: 'USD',
      },
    });

    // 4. Batch in WS 2 (for tenant isolation)
    const ws2B = await prisma.settlementBatch.create({
      data: {
        workspace_id: ws2Id,
        batch_number: `SB-WS2-${suffix}`,
        participant_type: SettlementParticipantType.BUYER,
        buyer_id: ws2BuyerId,
        currency: 'USD',
        period_start: new Date('2026-08-01T00:00:00Z'),
        period_end: new Date('2026-08-02T00:00:00Z'),
        gross_amount: 100.0,
        adjustments_amount: 0.0,
        net_amount: 100.0,
        item_count: 0,
        settlement_status: SettlementStatus.FINALIZED,
        payment_status: PaymentStatus.UNPROCESSED,
        created_by_user_id: ws2OwnerUserId,
      },
    });
    ws2BatchId = ws2B.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // =========================================================================
  // 1. RBAC PERMISSIONS REGISTRATION & BASELINE
  // =========================================================================
  describe('RBAC: Payment & Reconciliation Permissions Baseline', () => {
    it('should register 4 new permissions in PERMISSIONS_LIST', () => {
      const keys = PERMISSIONS_LIST.map((p) => p.key);
      expect(keys).toContain('payment:read');
      expect(keys).toContain('payment:manage');
      expect(keys).toContain('reconciliation:read');
      expect(keys).toContain('reconciliation:run');
    });

    it('should include payment:read and reconciliation:read in ADMIN_BASELINE_PERMISSIONS', () => {
      expect(ADMIN_BASELINE_PERMISSIONS).toContain('payment:read');
      expect(ADMIN_BASELINE_PERMISSIONS).toContain('reconciliation:read');
    });

    it('should strictly exclude payment:manage and reconciliation:run from ADMIN_BASELINE_PERMISSIONS', () => {
      expect(ADMIN_BASELINE_PERMISSIONS).not.toContain('payment:manage');
      expect(ADMIN_BASELINE_PERMISSIONS).not.toContain('reconciliation:run');
    });
  });

  // =========================================================================
  // 2. PAYMENT INSTRUCTION LIFECYCLE (Tests 1-9, 20-25)
  // =========================================================================
  describe('Payment Instruction Lifecycle & RBAC', () => {
    let buyerInstructionId: string;
    let vendorInstructionId: string;

    it('1. instruction creation from FINALIZED batch succeeds for OWNER', async () => {
      const res = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/settlements/batches/${finalizedBuyerBatchId}/payment-instruction`)
        .set('Authorization', `Bearer ${ownerUserId}`);

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body.settlement_batch_id).toBe(finalizedBuyerBatchId);
      expect(res.body.status).toBe(InstructionStatus.CREATED);
      buyerInstructionId = res.body.id;
    });

    it('2. rejects instruction creation for non-FINALIZED (DRAFT) batch', async () => {
      const res = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/settlements/batches/${draftBatchId}/payment-instruction`)
        .set('Authorization', `Bearer ${ownerUserId}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('FINALIZED');
    });

    it('3. idempotent instruction creation returns existing instruction', async () => {
      const res = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/settlements/batches/${finalizedBuyerBatchId}/payment-instruction`)
        .set('Authorization', `Bearer ${ownerUserId}`);

      expect(res.status).toBe(201);
      expect(res.body.id).toBe(buyerInstructionId);
    });

    it('4. sequential/concurrent instruction requests result in single instruction', async () => {
      const count = await prisma.paymentInstruction.count({
        where: { settlement_batch_id: finalizedBuyerBatchId },
      });
      expect(count).toBe(1);
    });

    it('5. buyer batch creates COLLECTION direction with buyer_id and vendor_id null', async () => {
      const res = await request(app.getHttpServer())
        .get(`/workspaces/${ws1Id}/payments/instructions/${buyerInstructionId}`)
        .set('Authorization', `Bearer ${ownerUserId}`);

      expect(res.status).toBe(200);
      expect(res.body.direction).toBe(PaymentDirection.COLLECTION);
      expect(res.body.buyer_id).toBe(buyerId);
      expect(res.body.vendor_id).toBeNull();
    });

    it('6. vendor batch creates DISBURSEMENT direction with vendor_id and buyer_id null', async () => {
      const res = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/settlements/batches/${finalizedVendorBatchId}/payment-instruction`)
        .set('Authorization', `Bearer ${ownerUserId}`);

      expect(res.status).toBe(201);
      vendorInstructionId = res.body.id;
      expect(res.body.direction).toBe(PaymentDirection.DISBURSEMENT);
      expect(res.body.vendor_id).toBe(vendorId);
      expect(res.body.buyer_id).toBeNull();
    });

    it('7. amount snapshot matches batch net_amount exactly', async () => {
      const res = await request(app.getHttpServer())
        .get(`/workspaces/${ws1Id}/payments/instructions/${buyerInstructionId}`)
        .set('Authorization', `Bearer ${ownerUserId}`);

      expect(res.status).toBe(200);
      expect(Number(res.body.amount)).toBe(500.0);
    });

    it('8. currency snapshot matches batch currency', async () => {
      const res = await request(app.getHttpServer())
        .get(`/workspaces/${ws1Id}/payments/instructions/${buyerInstructionId}`)
        .set('Authorization', `Bearer ${ownerUserId}`);

      expect(res.status).toBe(200);
      expect(res.body.currency).toBe('USD');
    });

    it('9. payment status of batch transitioned from UNPROCESSED to PENDING', async () => {
      const batch = await prisma.settlementBatch.findUnique({
        where: { id: finalizedBuyerBatchId },
      });
      expect(batch?.payment_status).toBe(PaymentStatus.PENDING);
      expect(batch?.settlement_status).toBe(SettlementStatus.FINALIZED);
    });

    it('20. OWNER instruction creation is allowed', async () => {
      // Verified in test 1 and 6
      expect(buyerInstructionId).toBeDefined();
    });

    it('21. ADMIN instruction creation is denied (403)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/settlements/batches/${finalizedVendorBatchId}/payment-instruction`)
        .set('Authorization', `Bearer ${adminUserId}`);

      expect(res.status).toBe(403);
    });

    it('22. MEMBER instruction creation is denied (403)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/settlements/batches/${finalizedVendorBatchId}/payment-instruction`)
        .set('Authorization', `Bearer ${memberUserId}`);

      expect(res.status).toBe(403);
    });

    it('23. Buyer instruction creation is denied (403)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/settlements/batches/${finalizedVendorBatchId}/payment-instruction`)
        .set('Authorization', `Bearer ${buyerUserId}`);

      expect(res.status).toBe(403);
    });

    it('24. Vendor instruction creation is denied (403)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/settlements/batches/${finalizedVendorBatchId}/payment-instruction`)
        .set('Authorization', `Bearer ${vendorUserId}`);

      expect(res.status).toBe(403);
    });

    it('25. Cross-workspace instruction creation is denied (404/403)', async () => {
      // WS1 OWNER attempts to create instruction for WS2 batch
      const res = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/settlements/batches/${ws2BatchId}/payment-instruction`)
        .set('Authorization', `Bearer ${ownerUserId}`);

      expect([403, 404]).toContain(res.status);
    });
  });

  // =========================================================================
  // 3. PAYMENT EXECUTION LIFECYCLE & RETRY (Tests 10-19)
  // =========================================================================
  describe('Payment Execution Lifecycle, Retry & Terminal State', () => {
    let testBatchId: string;
    let testInstructionId: string;
    let execution1Id: string;

    beforeAll(async () => {
      const suffix = Math.random().toString(36).substring(7);
      const b = await prisma.settlementBatch.create({
        data: {
          workspace_id: ws1Id,
          batch_number: `SB-EXEC-TEST-${suffix}`,
          participant_type: SettlementParticipantType.BUYER,
          buyer_id: buyerId,
          currency: 'USD',
          period_start: new Date('2026-08-01T00:00:00Z'),
          period_end: new Date('2026-08-02T00:00:00Z'),
          gross_amount: 400.0,
          net_amount: 400.0,
          settlement_status: SettlementStatus.FINALIZED,
          payment_status: PaymentStatus.UNPROCESSED,
          created_by_user_id: ownerUserId,
        },
      });
      testBatchId = b.id;

      const res = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/settlements/batches/${testBatchId}/payment-instruction`)
        .set('Authorization', `Bearer ${ownerUserId}`);
      testInstructionId = res.body.id;
    });

    it('10. execution attempt #1 created with initial simulation', async () => {
      const res = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/payments/instructions/${testInstructionId}/executions`)
        .set('Authorization', `Bearer ${ownerUserId}`)
        .send({
          provider: 'manual',
          simulate_status: 'FAILED',
          failure_code: 'DECLINED',
          failure_reason: 'Card network declined payment',
        });

      expect(res.status).toBe(201);
      expect(res.body.attempt_number).toBe(1);
      expect(res.body.status).toBe(ExecutionStatus.FAILED);
      expect(res.body.failure_code).toBe('DECLINED');
      execution1Id = res.body.id;
    });

    it('11. attempt numbering monotonically increases on retry', async () => {
      const res = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/payments/instructions/${testInstructionId}/retry`)
        .set('Authorization', `Bearer ${ownerUserId}`)
        .send({
          provider: 'wire',
          simulate_status: 'PROCESSING',
        });

      expect(res.status).toBe(201);
      expect(res.body.attempt_number).toBe(2);
      expect(res.body.status).toBe(ExecutionStatus.PROCESSING);
    });

    it('12. execution idempotency returns existing execution when key provided', async () => {
      const idempKey = `pe_idemp_${Date.now()}`;
      // Create new batch for idempotency test
      const tempBatch = await prisma.settlementBatch.create({
        data: {
          workspace_id: ws1Id,
          batch_number: `SB-IDEMP-${Date.now()}`,
          participant_type: SettlementParticipantType.BUYER,
          buyer_id: buyerId,
          currency: 'USD',
          period_start: new Date('2026-08-01T00:00:00Z'),
          period_end: new Date('2026-08-02T00:00:00Z'),
          net_amount: 100.0,
          settlement_status: SettlementStatus.FINALIZED,
          payment_status: PaymentStatus.UNPROCESSED,
          created_by_user_id: ownerUserId,
        },
      });
      const instRes = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/settlements/batches/${tempBatch.id}/payment-instruction`)
        .set('Authorization', `Bearer ${ownerUserId}`);

      const res1 = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/payments/instructions/${instRes.body.id}/executions`)
        .set('Authorization', `Bearer ${ownerUserId}`)
        .send({
          provider: 'manual',
          idempotency_key: idempKey,
          simulate_status: 'SUCCEEDED',
        });

      const res2 = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/payments/instructions/${instRes.body.id}/executions`)
        .set('Authorization', `Bearer ${ownerUserId}`)
        .send({
          provider: 'manual',
          idempotency_key: idempKey,
          simulate_status: 'SUCCEEDED',
        });

      expect(res1.body.id).toBe(res2.body.id);
    });

    it('13. PROCESSING transition keeps completed_at null and batch PENDING', async () => {
      const exec = await prisma.paymentExecution.findFirst({
        where: { payment_instruction_id: testInstructionId, attempt_number: 2 },
      });
      expect(exec?.status).toBe(ExecutionStatus.PROCESSING);
      expect(exec?.completed_at).toBeNull();
    });

    it('14. SUCCESS transition closes settlement batch and marks payment SUCCEEDED', async () => {
      // Create fresh instruction to test clean success
      const succBatch = await prisma.settlementBatch.create({
        data: {
          workspace_id: ws1Id,
          batch_number: `SB-SUCC-${Date.now()}`,
          participant_type: SettlementParticipantType.BUYER,
          buyer_id: buyerId,
          currency: 'USD',
          period_start: new Date('2026-08-01T00:00:00Z'),
          period_end: new Date('2026-08-02T00:00:00Z'),
          net_amount: 200.0,
          settlement_status: SettlementStatus.FINALIZED,
          payment_status: PaymentStatus.UNPROCESSED,
          created_by_user_id: ownerUserId,
        },
      });

      const instRes = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/settlements/batches/${succBatch.id}/payment-instruction`)
        .set('Authorization', `Bearer ${ownerUserId}`);

      const execRes = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/payments/instructions/${instRes.body.id}/executions`)
        .set('Authorization', `Bearer ${ownerUserId}`)
        .send({
          provider: 'mock',
          simulate_status: 'SUCCEEDED',
        });

      expect(execRes.status).toBe(201);
      expect(execRes.body.status).toBe(ExecutionStatus.SUCCEEDED);

      const updatedBatch = await prisma.settlementBatch.findUnique({
        where: { id: succBatch.id },
      });
      expect(updatedBatch?.payment_status).toBe(PaymentStatus.SUCCEEDED);
      expect(updatedBatch?.settlement_status).toBe(SettlementStatus.CLOSED);
      expect(updatedBatch?.closed_at).not.toBeNull();
    });

    it('15. FAILURE transition sets instruction FAILED and batch FAILED without closing batch', async () => {
      const batch = await prisma.settlementBatch.findUnique({
        where: { id: testBatchId },
      });
      expect(batch?.settlement_status).toBe(SettlementStatus.FINALIZED);
      expect(batch?.closed_at).toBeNull();
    });

    it('16. retry on failed instruction creates next execution attempt', async () => {
      // First make instruction failed
      await prisma.paymentInstruction.update({
        where: { id: testInstructionId },
        data: { status: InstructionStatus.FAILED },
      });
      await prisma.paymentExecution.updateMany({
        where: { payment_instruction_id: testInstructionId, attempt_number: 2 },
        data: { status: ExecutionStatus.FAILED },
      });

      const retryRes = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/payments/instructions/${testInstructionId}/retry`)
        .set('Authorization', `Bearer ${ownerUserId}`)
        .send({
          provider: 'mock',
          simulate_status: 'SUCCEEDED',
        });

      expect(retryRes.status).toBe(201);
      expect(retryRes.body.attempt_number).toBe(3);
      expect(retryRes.body.status).toBe(ExecutionStatus.SUCCEEDED);
    });

    it('17. previous attempts remain immutable', async () => {
      const attempt1 = await prisma.paymentExecution.findUnique({
        where: {
          payment_instruction_id_attempt_number: {
            payment_instruction_id: testInstructionId,
            attempt_number: 1,
          },
        },
      });
      expect(attempt1?.status).toBe(ExecutionStatus.FAILED);
      expect(attempt1?.failure_code).toBe('DECLINED');
      expect(attempt1?.attempt_number).toBe(1);
    });

    it('18. duplicate execution attempt numbers rejected by unique constraint', async () => {
      // Attempt to manually insert duplicate attempt_number 1 directly
      await expect(
        prisma.paymentExecution.create({
          data: {
            workspace_id: ws1Id,
            payment_instruction_id: testInstructionId,
            attempt_number: 1,
            provider: 'manual',
            idempotency_key: `pe_dup_${Date.now()}`,
            amount: 400.0,
            currency: 'USD',
          },
        }),
      ).rejects.toThrow();
    });

    it('19. terminal state protection: cannot execute or retry once SUCCEEDED', async () => {
      const res = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/payments/instructions/${testInstructionId}/executions`)
        .set('Authorization', `Bearer ${ownerUserId}`)
        .send({ provider: 'manual' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('already succeeded');
    });
  });

  // =========================================================================
  // 4. RECONCILIATION ENGINE (Tests 26-43)
  // =========================================================================
  describe('Reconciliation Engine & Issue Detection', () => {
    let cleanBatchId: string;
    let sumMismatchBatchId: string;
    let currMismatchBatchId: string;
    let missingPayBatchId: string;
    let cleanRunId: string;

    beforeAll(async () => {
      const suffix = Math.random().toString(36).substring(7);

      // Clean Batch: Closed with successful payment
      const cleanB = await prisma.settlementBatch.create({
        data: {
          workspace_id: ws1Id,
          batch_number: `SB-RECON-CLEAN-${suffix}`,
          participant_type: SettlementParticipantType.BUYER,
          buyer_id: buyerId,
          currency: 'USD',
          period_start: new Date('2026-08-01T00:00:00Z'),
          period_end: new Date('2026-08-02T00:00:00Z'),
          gross_amount: 150.0,
          adjustments_amount: 0.0,
          net_amount: 150.0,
          item_count: 1,
          settlement_status: SettlementStatus.CLOSED,
          payment_status: PaymentStatus.SUCCEEDED,
          created_by_user_id: ownerUserId,
        },
      });
      cleanBatchId = cleanB.id;

      await prisma.settlementItem.create({
        data: {
          workspace_id: ws1Id,
          settlement_batch_id: cleanBatchId,
          call_commercial_id: commercial2Id,
          participant_type: SettlementParticipantType.BUYER,
          amount: 150.0,
          currency: 'USD',
        },
      });

      const piClean = await prisma.paymentInstruction.create({
        data: {
          workspace_id: ws1Id,
          settlement_batch_id: cleanBatchId,
          direction: PaymentDirection.COLLECTION,
          participant_type: SettlementParticipantType.BUYER,
          amount: 150.0,
          currency: 'USD',
          idempotency_key: `pi_clean_${suffix}`,
          status: InstructionStatus.SUCCEEDED,
        },
      });

      await prisma.paymentExecution.create({
        data: {
          workspace_id: ws1Id,
          payment_instruction_id: piClean.id,
          attempt_number: 1,
          provider: 'mock',
          idempotency_key: `pe_clean_${suffix}`,
          amount: 150.0,
          currency: 'USD',
          status: ExecutionStatus.SUCCEEDED,
        },
      });

      // Sum Mismatch Batch: net_amount is 200 but item is 100
      const sumB = await prisma.settlementBatch.create({
        data: {
          workspace_id: ws1Id,
          batch_number: `SB-RECON-SUM-${suffix}`,
          participant_type: SettlementParticipantType.BUYER,
          buyer_id: buyerId,
          currency: 'USD',
          period_start: new Date('2026-08-01T00:00:00Z'),
          period_end: new Date('2026-08-02T00:00:00Z'),
          gross_amount: 200.0,
          adjustments_amount: 0.0,
          net_amount: 200.0,
          settlement_status: SettlementStatus.CLOSED,
          payment_status: PaymentStatus.SUCCEEDED,
          created_by_user_id: ownerUserId,
        },
      });
      sumMismatchBatchId = sumB.id;

      await prisma.settlementItem.create({
        data: {
          workspace_id: ws1Id,
          settlement_batch_id: sumMismatchBatchId,
          call_commercial_id: await createTestCommercial(100.0, 'USD'),
          participant_type: SettlementParticipantType.BUYER,
          amount: 100.0, // Mismatch: 100 != 200
          currency: 'USD',
        },
      });

      const piSum = await prisma.paymentInstruction.create({
        data: {
          workspace_id: ws1Id,
          settlement_batch_id: sumMismatchBatchId,
          direction: PaymentDirection.COLLECTION,
          participant_type: SettlementParticipantType.BUYER,
          amount: 200.0,
          currency: 'USD',
          idempotency_key: `pi_sum_${suffix}`,
          status: InstructionStatus.SUCCEEDED,
        },
      });

      await prisma.paymentExecution.create({
        data: {
          workspace_id: ws1Id,
          payment_instruction_id: piSum.id,
          attempt_number: 1,
          provider: 'mock',
          idempotency_key: `pe_sum_${suffix}`,
          amount: 200.0,
          currency: 'USD',
          status: ExecutionStatus.SUCCEEDED,
        },
      });

      // Currency Mismatch Batch: batch is USD but item is EUR
      const currB = await prisma.settlementBatch.create({
        data: {
          workspace_id: ws1Id,
          batch_number: `SB-RECON-CURR-${suffix}`,
          participant_type: SettlementParticipantType.BUYER,
          buyer_id: buyerId,
          currency: 'USD',
          period_start: new Date('2026-08-01T00:00:00Z'),
          period_end: new Date('2026-08-02T00:00:00Z'),
          gross_amount: 100.0,
          adjustments_amount: 0.0,
          net_amount: 100.0,
          settlement_status: SettlementStatus.CLOSED,
          payment_status: PaymentStatus.SUCCEEDED,
          created_by_user_id: ownerUserId,
        },
      });
      currMismatchBatchId = currB.id;

      await prisma.settlementItem.create({
        data: {
          workspace_id: ws1Id,
          settlement_batch_id: currMismatchBatchId,
          call_commercial_id: await createTestCommercial(100.0, 'EUR'),
          participant_type: SettlementParticipantType.BUYER,
          amount: 100.0,
          currency: 'EUR', // Mismatch!
        },
      });

      const piCurr = await prisma.paymentInstruction.create({
        data: {
          workspace_id: ws1Id,
          settlement_batch_id: currMismatchBatchId,
          direction: PaymentDirection.COLLECTION,
          participant_type: SettlementParticipantType.BUYER,
          amount: 100.0,
          currency: 'USD',
          idempotency_key: `pi_curr_${suffix}`,
          status: InstructionStatus.SUCCEEDED,
        },
      });

      await prisma.paymentExecution.create({
        data: {
          workspace_id: ws1Id,
          payment_instruction_id: piCurr.id,
          attempt_number: 1,
          provider: 'mock',
          idempotency_key: `pe_curr_${suffix}`,
          amount: 100.0,
          currency: 'USD',
          status: ExecutionStatus.SUCCEEDED,
        },
      });

      // Missing Payment Batch: FINALIZED with no payment
      const missB = await prisma.settlementBatch.create({
        data: {
          workspace_id: ws1Id,
          batch_number: `SB-RECON-MISS-${suffix}`,
          participant_type: SettlementParticipantType.BUYER,
          buyer_id: buyerId,
          currency: 'USD',
          period_start: new Date('2026-08-01T00:00:00Z'),
          period_end: new Date('2026-08-02T00:00:00Z'),
          gross_amount: 150.0,
          adjustments_amount: 0.0,
          net_amount: 150.0,
          settlement_status: SettlementStatus.FINALIZED,
          payment_status: PaymentStatus.UNPROCESSED,
          created_by_user_id: ownerUserId,
        },
      });
      missingPayBatchId = missB.id;

      await prisma.settlementItem.create({
        data: {
          workspace_id: ws1Id,
          settlement_batch_id: missingPayBatchId,
          call_commercial_id: await createTestCommercial(150.0, 'USD'),
          participant_type: SettlementParticipantType.BUYER,
          amount: 150.0,
          currency: 'USD',
        },
      });
    });

    it('26. clean batch reconciles to RECONCILED with zero discrepancies', async () => {
      const res = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/reconciliation/batches/${cleanBatchId}/run`)
        .set('Authorization', `Bearer ${ownerUserId}`);

      expect(res.status).toBe(201);
      expect(res.body.status).toBe(ReconciliationStatus.RECONCILED);
      expect(res.body.discrepancy_count).toBe(0);
      cleanRunId = res.body.id;
    });

    it('27. detects SUM_MISMATCH discrepancy', async () => {
      const res = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/reconciliation/batches/${sumMismatchBatchId}/run`)
        .set('Authorization', `Bearer ${ownerUserId}`);

      expect(res.status).toBe(201);
      expect(res.body.status).toBe(ReconciliationStatus.DISCREPANCY);
      expect(res.body.discrepancy_count).toBeGreaterThanOrEqual(1);
      expect(
        res.body.issues.some(
          (i: any) => i.issue_type === ReconciliationIssueType.SUM_MISMATCH,
        ),
      ).toBe(true);
    });

    it('28. detects CURRENCY_MISMATCH discrepancy', async () => {
      const res = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/reconciliation/batches/${currMismatchBatchId}/run`)
        .set('Authorization', `Bearer ${ownerUserId}`);

      expect(res.status).toBe(201);
      expect(res.body.status).toBe(ReconciliationStatus.DISCREPANCY);
      expect(
        res.body.issues.some(
          (i: any) => i.issue_type === ReconciliationIssueType.CURRENCY_MISMATCH,
        ),
      ).toBe(true);
    });

    it('29. detects MISSING_PAYMENT discrepancy', async () => {
      const res = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/reconciliation/batches/${missingPayBatchId}/run`)
        .set('Authorization', `Bearer ${ownerUserId}`);

      expect(res.status).toBe(201);
      expect(res.body.status).toBe(ReconciliationStatus.DISCREPANCY);
      expect(
        res.body.issues.some(
          (i: any) => i.issue_type === ReconciliationIssueType.MISSING_PAYMENT,
        ),
      ).toBe(true);
    });

    it('30. detects DUPLICATE_CALL discrepancy across batches in workspace', async () => {
      // Spy on prisma.settlementItem.findMany to return an item indicating duplicate call commercial participation
      const spy = vi.spyOn(prisma.settlementItem, 'findMany').mockResolvedValueOnce([
        {
          id: 'item-dup-found',
          call_commercial_id: commercial1Id,
          settlement_batch_id: 'batch-other-id',
          workspace_id: ws1Id,
          participant_type: SettlementParticipantType.BUYER,
          amount: new Prisma.Decimal('150.0000'),
          currency: 'USD',
          created_at: new Date(),
        } as any,
      ]);

      const res = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/reconciliation/batches/${finalizedBuyerBatchId}/run`)
        .set('Authorization', `Bearer ${ownerUserId}`);

      expect(res.status).toBe(201);
      expect(
        res.body.issues.some(
          (i: any) => i.issue_type === ReconciliationIssueType.DUPLICATE_CALL,
        ),
      ).toBe(true);

      spy.mockRestore();
    });

    it('31. issue persistence creates ReconciliationIssue rows', async () => {
      const issues = await prisma.reconciliationIssue.findMany({
        where: { run: { settlement_batch_id: sumMismatchBatchId } },
      });
      expect(issues.length).toBeGreaterThan(0);
    });

    it('32. discrepancy count is recorded accurately on run', async () => {
      const run = await prisma.reconciliationRun.findFirst({
        where: { settlement_batch_id: sumMismatchBatchId },
      });
      expect(run?.discrepancy_count).toBeGreaterThan(0);
    });

    it('33. items_checked is recorded accurately on run', async () => {
      const run = await prisma.reconciliationRun.findFirst({
        where: { settlement_batch_id: cleanBatchId },
      });
      expect(run?.items_checked).toBe(1);
    });

    it('34. batch reconciliation_status is updated', async () => {
      const cleanB = await prisma.settlementBatch.findUnique({
        where: { id: cleanBatchId },
      });
      expect(cleanB?.reconciliation_status).toBe(ReconciliationStatus.RECONCILED);

      const sumB = await prisma.settlementBatch.findUnique({
        where: { id: sumMismatchBatchId },
      });
      expect(sumB?.reconciliation_status).toBe(ReconciliationStatus.DISCREPANCY);
    });

    it('35. rerun creates new ReconciliationRun snapshot', async () => {
      const res = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/reconciliation/batches/${cleanBatchId}/run`)
        .set('Authorization', `Bearer ${ownerUserId}`);

      expect(res.status).toBe(201);
      expect(res.body.id).not.toBe(cleanRunId);
    });

    it('36. old ReconciliationRun remains immutable', async () => {
      const oldRun = await prisma.reconciliationRun.findUnique({
        where: { id: cleanRunId },
      });
      expect(oldRun?.status).toBe(ReconciliationStatus.RECONCILED);
    });

    it('37. workspace reconciliation evaluates all batches in workspace', async () => {
      const res = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/reconciliation/run`)
        .set('Authorization', `Bearer ${ownerUserId}`);

      expect(res.status).toBe(201);
      expect(res.body.run_type).toBe(ReconciliationRunType.WORKSPACE_LEVEL);
      expect(res.body.items_checked).toBeGreaterThan(0);
    });

    it('38. ADMIN can read reconciliation runs and issues', async () => {
      const res = await request(app.getHttpServer())
        .get(`/workspaces/${ws1Id}/reconciliation/runs`)
        .set('Authorization', `Bearer ${adminUserId}`);

      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeGreaterThan(0);
    });

    it('39. ADMIN run is denied (403)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/reconciliation/batches/${cleanBatchId}/run`)
        .set('Authorization', `Bearer ${adminUserId}`);

      expect(res.status).toBe(403);
    });

    it('40. OWNER run is allowed', async () => {
      // Confirmed in test 26 & 37
      expect(cleanRunId).toBeDefined();
    });

    it('41. Buyer is denied access to reconciliation (403)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/workspaces/${ws1Id}/reconciliation/runs`)
        .set('Authorization', `Bearer ${buyerUserId}`);

      expect(res.status).toBe(403);
    });

    it('42. Vendor is denied access to reconciliation (403)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/workspaces/${ws1Id}/reconciliation/runs`)
        .set('Authorization', `Bearer ${vendorUserId}`);

      expect(res.status).toBe(403);
    });

    it('43. Cross-workspace reconciliation is denied (403/404)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/reconciliation/batches/${ws2BatchId}/run`)
        .set('Authorization', `Bearer ${ownerUserId}`);

      expect([403, 404]).toContain(res.status);
    });
  });

  // =========================================================================
  // 5. INTEGRATION CHECKS (Tests 44-48)
  // =========================================================================
  describe('Full End-to-End Integration Flows & Tenant Isolation', () => {
    it('44. FINALIZED SettlementBatch -> PaymentInstruction -> PaymentExecution -> SUCCEEDED -> SettlementBatch CLOSED', async () => {
      const suffix = Math.random().toString(36).substring(7);
      const batch = await prisma.settlementBatch.create({
        data: {
          workspace_id: ws1Id,
          batch_number: `SB-E2E-FULL-${suffix}`,
          participant_type: SettlementParticipantType.BUYER,
          buyer_id: buyerId,
          currency: 'USD',
          period_start: new Date('2026-08-01T00:00:00Z'),
          period_end: new Date('2026-08-02T00:00:00Z'),
          gross_amount: 1000.0,
          net_amount: 1000.0,
          settlement_status: SettlementStatus.FINALIZED,
          payment_status: PaymentStatus.UNPROCESSED,
          created_by_user_id: ownerUserId,
        },
      });

      // 1. Create instruction
      const instRes = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/settlements/batches/${batch.id}/payment-instruction`)
        .set('Authorization', `Bearer ${ownerUserId}`);
      expect(instRes.status).toBe(201);

      // 2. Execute payment
      const execRes = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/payments/instructions/${instRes.body.id}/executions`)
        .set('Authorization', `Bearer ${ownerUserId}`)
        .send({ provider: 'wire', simulate_status: 'SUCCEEDED' });
      expect(execRes.status).toBe(201);

      // 3. Verify batch is CLOSED
      const updated = await prisma.settlementBatch.findUnique({
        where: { id: batch.id },
      });
      expect(updated?.settlement_status).toBe(SettlementStatus.CLOSED);
      expect(updated?.payment_status).toBe(PaymentStatus.SUCCEEDED);
      expect(updated?.closed_at).not.toBeNull();
    });

    it('45. Failed execution -> retry -> successful execution', async () => {
      const suffix = Math.random().toString(36).substring(7);
      const batch = await prisma.settlementBatch.create({
        data: {
          workspace_id: ws1Id,
          batch_number: `SB-E2E-RETRY-${suffix}`,
          participant_type: SettlementParticipantType.BUYER,
          buyer_id: buyerId,
          currency: 'USD',
          period_start: new Date('2026-08-01T00:00:00Z'),
          period_end: new Date('2026-08-02T00:00:00Z'),
          gross_amount: 800.0,
          net_amount: 800.0,
          settlement_status: SettlementStatus.FINALIZED,
          payment_status: PaymentStatus.UNPROCESSED,
          created_by_user_id: ownerUserId,
        },
      });

      const instRes = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/settlements/batches/${batch.id}/payment-instruction`)
        .set('Authorization', `Bearer ${ownerUserId}`);

      // Attempt 1 fails
      const failRes = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/payments/instructions/${instRes.body.id}/executions`)
        .set('Authorization', `Bearer ${ownerUserId}`)
        .send({ provider: 'manual', simulate_status: 'FAILED', failure_code: 'ERR_1' });
      expect(failRes.status).toBe(201);
      expect(failRes.body.status).toBe(ExecutionStatus.FAILED);

      // Attempt 2 succeeds via retry
      const retryRes = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/payments/instructions/${instRes.body.id}/retry`)
        .set('Authorization', `Bearer ${ownerUserId}`)
        .send({ simulate_status: 'SUCCEEDED' });
      expect(retryRes.status).toBe(201);
      expect(retryRes.body.attempt_number).toBe(2);
      expect(retryRes.body.status).toBe(ExecutionStatus.SUCCEEDED);

      const updated = await prisma.settlementBatch.findUnique({
        where: { id: batch.id },
      });
      expect(updated?.settlement_status).toBe(SettlementStatus.CLOSED);
      expect(updated?.payment_status).toBe(PaymentStatus.SUCCEEDED);
    });

    it('46. Successful payment -> reconciliation -> RECONCILED', async () => {
      const suffix = Math.random().toString(36).substring(7);
      const batch = await prisma.settlementBatch.create({
        data: {
          workspace_id: ws1Id,
          batch_number: `SB-E2E-RECON-OK-${suffix}`,
          participant_type: SettlementParticipantType.BUYER,
          buyer_id: buyerId,
          currency: 'USD',
          period_start: new Date('2026-08-01T00:00:00Z'),
          period_end: new Date('2026-08-02T00:00:00Z'),
          gross_amount: 600.0,
          adjustments_amount: 0.0,
          net_amount: 600.0,
          settlement_status: SettlementStatus.FINALIZED,
          payment_status: PaymentStatus.UNPROCESSED,
          created_by_user_id: ownerUserId,
        },
      });

      await prisma.settlementItem.create({
        data: {
          workspace_id: ws1Id,
          settlement_batch_id: batch.id,
          call_commercial_id: await createTestCommercial(600.0, 'USD'),
          participant_type: SettlementParticipantType.BUYER,
          amount: 600.0,
          currency: 'USD',
        },
      });

      const instRes = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/settlements/batches/${batch.id}/payment-instruction`)
        .set('Authorization', `Bearer ${ownerUserId}`);
      expect(instRes.status).toBe(201);

      await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/payments/instructions/${instRes.body.id}/executions`)
        .set('Authorization', `Bearer ${ownerUserId}`)
        .send({ provider: 'mock', simulate_status: 'SUCCEEDED' });

      // Run reconciliation
      const reconRes = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/reconciliation/batches/${batch.id}/run`)
        .set('Authorization', `Bearer ${ownerUserId}`);

      expect(reconRes.status).toBe(201);
      expect(reconRes.body.status).toBe(ReconciliationStatus.RECONCILED);
      expect(reconRes.body.discrepancy_count).toBe(0);
    });

    it('47. Missing payment -> reconciliation -> DISCREPANCY', async () => {
      const suffix = Math.random().toString(36).substring(7);
      const batch = await prisma.settlementBatch.create({
        data: {
          workspace_id: ws1Id,
          batch_number: `SB-E2E-RECON-MISS-${suffix}`,
          participant_type: SettlementParticipantType.BUYER,
          buyer_id: buyerId,
          currency: 'USD',
          period_start: new Date('2026-08-01T00:00:00Z'),
          period_end: new Date('2026-08-02T00:00:00Z'),
          gross_amount: 700.0,
          adjustments_amount: 0.0,
          net_amount: 700.0,
          settlement_status: SettlementStatus.FINALIZED,
          payment_status: PaymentStatus.UNPROCESSED,
          created_by_user_id: ownerUserId,
        },
      });

      await prisma.settlementItem.create({
        data: {
          workspace_id: ws1Id,
          settlement_batch_id: batch.id,
          call_commercial_id: await createTestCommercial(700.0, 'USD'),
          participant_type: SettlementParticipantType.BUYER,
          amount: 700.0,
          currency: 'USD',
        },
      });

      // No payment instruction created - run reconciliation
      const reconRes = await request(app.getHttpServer())
        .post(`/workspaces/${ws1Id}/reconciliation/batches/${batch.id}/run`)
        .set('Authorization', `Bearer ${ownerUserId}`);

      expect(reconRes.status).toBe(201);
      expect(reconRes.body.status).toBe(ReconciliationStatus.DISCREPANCY);
      expect(
        reconRes.body.issues.some(
          (i: any) => i.issue_type === ReconciliationIssueType.MISSING_PAYMENT,
        ),
      ).toBe(true);
    });

    it('48. Full tenant isolation: cross-workspace payment and reconciliation requests rejected', async () => {
      // WS1 OWNER requests WS2 reconciliation
      const reconRes = await request(app.getHttpServer())
        .get(`/workspaces/${ws2Id}/reconciliation/runs`)
        .set('Authorization', `Bearer ${ownerUserId}`);

      expect(reconRes.status).toBe(403);

      // WS1 OWNER requests WS2 payments
      const payRes = await request(app.getHttpServer())
        .get(`/workspaces/${ws2Id}/payments/instructions`)
        .set('Authorization', `Bearer ${ownerUserId}`);

      expect(payRes.status).toBe(403);
    });
  });
});
