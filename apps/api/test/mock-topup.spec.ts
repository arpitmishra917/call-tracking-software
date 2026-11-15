import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { randomUUID } from 'crypto';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard.js';

describe('Mock Top-up E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let ownerUserId: string;
  let buyerUserId: string;
  let unauthUserId: string;
  let currentUserId: string;

  beforeAll(async () => {
    const mockAuthGuard = {
      canActivate: (context: any) => {
        const req = context.switchToHttp().getRequest();
        req.user = { userId: currentUserId, email: 'test@example.com' };
        return true;
      },
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockAuthGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    // Create workspace 1 directly
    const ws1 = await prisma.workspace.create({
      data: {
        id: randomUUID(),
        name: 'Mock WS1',
        slug: `mock-ws1-${randomUUID()}`,
      },
    });
    workspaceId = ws1.id;

    // Create workspace 2 directly
    const ws2 = await prisma.workspace.create({
      data: {
        id: randomUUID(),
        name: 'Mock WS2',
        slug: `mock-ws2-${randomUUID()}`,
      },
    });
    otherWorkspaceId = ws2.id;

    // Create Owner Profile & Membership in workspace 1
    const ownerProfile = await prisma.profile.create({
      data: { id: randomUUID(), display_name: 'Mock Topup Owner' },
    });
    ownerUserId = ownerProfile.id;

    await prisma.workspaceMember.create({
      data: {
        workspace_id: workspaceId,
        user_id: ownerUserId,
        role: 'OWNER',
        participant_type: 'INTERNAL',
      },
    });

    // Create Buyer Profile & Membership in workspace 1
    const buyerProfile = await prisma.profile.create({
      data: { id: randomUUID(), display_name: 'Mock Topup Buyer' },
    });
    buyerUserId = buyerProfile.id;

    await prisma.workspaceMember.create({
      data: {
        workspace_id: workspaceId,
        user_id: buyerUserId,
        role: 'MEMBER',
        participant_type: 'BUYER',
      },
    });

    unauthUserId = randomUUID();
    currentUserId = ownerUserId;
  });

  afterAll(async () => {
    try {
      if (workspaceId || otherWorkspaceId) {
        await prisma.walletTransaction.deleteMany({
          where: { workspace_id: { in: [workspaceId, otherWorkspaceId].filter(Boolean) } },
        });
        await prisma.workspaceBalance.deleteMany({
          where: { workspace_id: { in: [workspaceId, otherWorkspaceId].filter(Boolean) } },
        });
        await prisma.workspaceMember.deleteMany({
          where: { workspace_id: { in: [workspaceId, otherWorkspaceId].filter(Boolean) } },
        });
        await prisma.workspace.deleteMany({
          where: { id: { in: [workspaceId, otherWorkspaceId].filter(Boolean) } },
        });
      }
      if (ownerUserId || buyerUserId) {
        await prisma.profile.deleteMany({
          where: { id: { in: [ownerUserId, buyerUserId].filter(Boolean) } },
        });
      }
    } catch {
      // ignore cleanup errors
    }
    await app.close();
  });

  it('rejects mock top-up for unauthenticated/unauthorized non-member', async () => {
    currentUserId = unauthUserId;
    process.env.WALLET_MOCK_PAYMENTS_ENABLED = 'true';

    const res = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/billing/wallet/mock-topup`)
      .send({ amountMinor: 2500 });

    expect(res.status).toBe(403);
    currentUserId = ownerUserId; // restore
  });

  it('rejects mock top-up for Buyer participant', async () => {
    currentUserId = buyerUserId;
    process.env.WALLET_MOCK_PAYMENTS_ENABLED = 'true';

    const res = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/billing/wallet/mock-topup`)
      .send({ amountMinor: 2500 });

    expect(res.status).toBe(403);
    currentUserId = ownerUserId; // restore
  });

  it('rejects mock top-up in production environment for authorized owner', async () => {
    currentUserId = ownerUserId;
    process.env.NODE_ENV = 'production';
    const res = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/billing/wallet/mock-topup`)
      .send({ amountMinor: 2500 });

    expect(res.status).toBe(403);
    process.env.NODE_ENV = 'test'; // Restore
  });

  it('rejects mock top-up if WALLET_MOCK_PAYMENTS_ENABLED is missing for authorized owner', async () => {
    currentUserId = ownerUserId;
    const old = process.env.WALLET_MOCK_PAYMENTS_ENABLED;
    delete process.env.WALLET_MOCK_PAYMENTS_ENABLED;
    const res = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/billing/wallet/mock-topup`)
      .send({ amountMinor: 2500 });

    expect(res.status).toBe(403);
    process.env.WALLET_MOCK_PAYMENTS_ENABLED = old; // Restore
  });

  it('rejects mock top-up below minimum amount (<$25)', async () => {
    currentUserId = ownerUserId;
    process.env.WALLET_MOCK_PAYMENTS_ENABLED = 'true';

    const res = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/billing/wallet/mock-topup`)
      .send({ amountMinor: 1000 });

    expect(res.status).toBe(400);
  });

  it('accepts +$25 mock top-up in local development for authorized owner and isolates tenant', async () => {
    currentUserId = ownerUserId;
    process.env.WALLET_MOCK_PAYMENTS_ENABLED = 'true';

    const res = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/billing/wallet/mock-topup`)
      .send({ amountMinor: 2500 });

    expect(res.status).toBe(201);

    const postBalance = await prisma.workspaceBalance.findUnique({ where: { workspace_id: workspaceId } });
    const amountMicro = 2500n * 10000n;

    expect(BigInt(postBalance!.balance_micro)).toBe(amountMicro);

    // Check exactly one CREDIT transaction
    const txs = await prisma.walletTransaction.findMany({
      where: { workspace_id: workspaceId, type: 'CREDIT' },
      orderBy: { created_at: 'desc' },
      take: 1,
    });
    expect(txs.length).toBe(1);
    expect(BigInt(txs[0].amount_micro)).toBe(amountMicro);

    // Check tenant isolation
    const ws2Balance = await prisma.workspaceBalance.findUnique({ where: { workspace_id: otherWorkspaceId } });
    expect(ws2Balance).toBeNull(); // Because no balance row is created until first transaction
  });

  it('repeated requests create separate transactions', async () => {
    currentUserId = ownerUserId;
    process.env.WALLET_MOCK_PAYMENTS_ENABLED = 'true';

    await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/billing/wallet/mock-topup`)
      .send({ amountMinor: 5000 });

    await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/billing/wallet/mock-topup`)
      .send({ amountMinor: 5000 });

    const txs = await prisma.walletTransaction.findMany({
      where: { workspace_id: workspaceId, type: 'CREDIT' },
    });
    // Total 3: 1 from previous test + 2 from this test
    expect(txs.length).toBe(3);
  });
});
