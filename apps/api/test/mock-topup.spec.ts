import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { randomUUID } from 'crypto';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../src/authorization/workspace-roles.guard.js';

describe('Mock Top-up E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let workspaceId: string;
  let otherWorkspaceId: string;

  beforeAll(async () => {
    const mockAuthGuard = {
      canActivate: (context: any) => {
        const req = context.switchToHttp().getRequest();
        req.user = { userId: 'fake-uuid', email: 'test@example.com' };
        return true;
      },
    };
    
    const mockRolesGuard = {
      canActivate: () => true,
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockAuthGuard)
      .overrideGuard(WorkspaceRolesGuard)
      .useValue(mockRolesGuard)
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
      }
    });
    workspaceId = ws1.id;

    // Create workspace 2 directly
    const ws2 = await prisma.workspace.create({
      data: {
        id: randomUUID(),
        name: 'Mock WS2',
        slug: `mock-ws2-${randomUUID()}`,
      }
    });
    otherWorkspaceId = ws2.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects mock top-up in production environment', async () => {
    process.env.NODE_ENV = 'production';
    const res = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/billing/wallet/mock-topup`)
      .send({ amountMinor: 2500 });
    
    expect(res.status).toBe(403);
    process.env.NODE_ENV = 'test'; // Restore
  });

  it('rejects mock top-up if WALLET_MOCK_PAYMENTS_ENABLED is missing', async () => {
    const old = process.env.WALLET_MOCK_PAYMENTS_ENABLED;
    delete process.env.WALLET_MOCK_PAYMENTS_ENABLED;
    const res = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/billing/wallet/mock-topup`)
      .send({ amountMinor: 2500 });
    
    expect(res.status).toBe(403);
    process.env.WALLET_MOCK_PAYMENTS_ENABLED = old; // Restore
  });

  it('accepts +$25 mock top-up in local development and isolates tenant', async () => {
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
       take: 1
    });
    expect(txs.length).toBe(1);
    expect(BigInt(txs[0].amount_micro)).toBe(amountMicro);
    
    // Check tenant isolation
    const ws2Balance = await prisma.workspaceBalance.findUnique({ where: { workspace_id: otherWorkspaceId } });
    expect(ws2Balance).toBeNull(); // Because no balance row is created until first transaction
  });

  it('repeated requests create separate transactions', async () => {
    process.env.WALLET_MOCK_PAYMENTS_ENABLED = 'true';
    
    await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/billing/wallet/mock-topup`)
      .send({ amountMinor: 5000 });
      
    await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/billing/wallet/mock-topup`)
      .send({ amountMinor: 5000 });

    const txs = await prisma.walletTransaction.findMany({ 
       where: { workspace_id: workspaceId, type: 'CREDIT' }
    });
    // Total 3: 1 from previous test + 2 from this test
    expect(txs.length).toBe(3);
  });
});
