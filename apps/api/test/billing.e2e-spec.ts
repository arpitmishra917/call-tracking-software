import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard.js';

class MockJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const token = request.headers.authorization;
    if (token) {
      const userId = token.split(' ')[1];
      if (userId) {
        request.user = {
          userId,
          email: 'test@example.com',
          role: 'authenticated',
        };
        return true;
      }
    }
    throw new UnauthorizedException();
  }
}

describe('Billing E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let ownerToken: string;
  let otherOwnerToken: string;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let user1Id = 'bill-u1';
  let user2Id = 'bill-u2';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(MockJwtAuthGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);

    // Setup profiles
    await prisma.profile.upsert({
      where: { id: user1Id },
      update: {},
      create: { id: user1Id, display_name: 'Bill U1' },
    });
    await prisma.profile.upsert({
      where: { id: user2Id },
      update: {},
      create: { id: user2Id, display_name: 'Bill U2' },
    });

    // Setup workspaces
    const ws1 = await prisma.workspace.create({
      data: { name: 'Billing WS 1', slug: 'bill-ws-1-' + Date.now() },
    });
    workspaceId = ws1.id;
    await prisma.workspaceMember.create({
      data: { workspace_id: workspaceId, user_id: user1Id, role: 'OWNER' },
    });
    ownerToken = `Bearer ${user1Id}`;

    const ws2 = await prisma.workspace.create({
      data: { name: 'Billing WS 2', slug: 'bill-ws-2-' + Date.now() },
    });
    otherWorkspaceId = ws2.id;
    await prisma.workspaceMember.create({
      data: { workspace_id: otherWorkspaceId, user_id: user2Id, role: 'OWNER' },
    });
    otherOwnerToken = `Bearer ${user2Id}`;

    // Mock plan
    await prisma.plan.create({
      data: {
        id: 'plan_test',
        name: 'Test Plan',
        amount: 1000,
        interval: 'MONTH',
        currency: 'usd',
        provider_price_id: 'price_mock',
      },
    });

    // Mock usage record
    await prisma.usageRecord.create({
      data: {
        workspace_id: workspaceId,
        type: 'CALL_MINUTE',
        quantity: 120,
        idempotency_key: 'test_key_1',
      },
    });
  });

  afterAll(async () => {
    await prisma.usageRecord.deleteMany({
      where: { idempotency_key: 'test_key_1' },
    });
    await prisma.plan.deleteMany({ where: { id: 'plan_test' } });
    await prisma.workspace.deleteMany({
      where: { id: { in: [workspaceId, otherWorkspaceId] } },
    });
    await prisma.profile.deleteMany({
      where: { id: { in: [user1Id, user2Id] } },
    });
    await prisma.$disconnect();
    await app.close();
  });

  it('GET /workspaces/:id/billing - should return billing state and usage', async () => {
    const res = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/billing`)
      .set('Authorization', ownerToken)
      .expect(200);

    expect(res.body.usage.summary.CALL_MINUTE).toBe(120);
    expect(res.body.plans.length).toBeGreaterThan(0);
  });

  it('GET /workspaces/:id/billing - tenant isolation blocks cross-workspace', async () => {
    await request(app.getHttpServer())
      .get(`/workspaces/${workspaceId}/billing`)
      .set('Authorization', otherOwnerToken)
      .expect(403);
  });

  it('POST /workspaces/:id/billing/checkout - blocked cross-workspace', async () => {
    await request(app.getHttpServer())
      .post(`/workspaces/${workspaceId}/billing/checkout`)
      .set('Authorization', otherOwnerToken)
      .send({ planId: 'plan_test', returnUrl: 'http://test' })
      .expect(403);
  });

  it('POST /webhooks/stripe - missing signature', async () => {
    const res = await request(app.getHttpServer())
      .post('/webhooks/stripe')
      .send({ type: 'test' })
      .expect(201);
    expect(res.body).toEqual({ received: false });
  });
});
