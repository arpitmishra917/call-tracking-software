import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, CanActivate, ExecutionContext } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { WorkspaceRole } from '@prisma/client';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard.js';

class MockJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      request.user = { userId: authHeader.replace('Bearer ', '') };
      return true;
    }
    return false;
  }
}

describe('WebhooksController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let ownerToken: string;
  let adminToken: string;
  let memberToken: string;
  let viewerToken: string;
  let otherWorkspaceOwnerToken: string;

  let workspaceAId: string;
  let workspaceBId: string;
  let webhookId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
    .overrideGuard(JwtAuthGuard)
    .useClass(MockJwtAuthGuard)
    .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);

    // Create users and workspace A
    const owner = await prisma.profile.create({ data: { display_name: 'Owner' } });
    const admin = await prisma.profile.create({ data: { display_name: 'Admin' } });
    const member = await prisma.profile.create({ data: { display_name: 'Member' } });
    const viewer = await prisma.profile.create({ data: { display_name: 'Viewer' } });
    
    const wsA = await prisma.workspace.create({ data: { name: 'Workspace A', slug: 'ws-a-webhooks' } });
    workspaceAId = wsA.id;

    await prisma.workspaceMember.createMany({
      data: [
        { workspace_id: workspaceAId, user_id: owner.id, role: WorkspaceRole.OWNER },
        { workspace_id: workspaceAId, user_id: admin.id, role: WorkspaceRole.ADMIN },
        { workspace_id: workspaceAId, user_id: member.id, role: WorkspaceRole.MEMBER },
        { workspace_id: workspaceAId, user_id: viewer.id, role: WorkspaceRole.VIEWER },
      ],
    });

    // Create user and workspace B
    const otherOwner = await prisma.profile.create({ data: { display_name: 'Other Owner' } });
    const wsB = await prisma.workspace.create({ data: { name: 'Workspace B', slug: 'ws-b-webhooks' } });
    workspaceBId = wsB.id;
    await prisma.workspaceMember.create({ data: { workspace_id: workspaceBId, user_id: otherOwner.id, role: WorkspaceRole.OWNER } });

    ownerToken = `Bearer ${owner.id}`;
    adminToken = `Bearer ${admin.id}`;
    memberToken = `Bearer ${member.id}`;
    viewerToken = `Bearer ${viewer.id}`;
    otherWorkspaceOwnerToken = `Bearer ${otherOwner.id}`;
  });

  afterAll(async () => {
    await prisma.outboundWebhook.deleteMany({ where: { workspace_id: { in: [workspaceAId, workspaceBId] } } });
    await prisma.workspace.deleteMany({ where: { id: { in: [workspaceAId, workspaceBId] } } });
    await app.close();
  });

  it('OWNER can create webhook', async () => {
    const res = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceAId}/webhooks`)
      .set('Authorization', ownerToken)
      .send({ url: 'https://example.com/webhook' })
      .expect(201);
    
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('secret');
    expect(res.body.url).toBe('https://example.com/webhook');
    webhookId = res.body.id;
  });

  it('ADMIN can create webhook', async () => {
    const res = await request(app.getHttpServer())
      .post(`/workspaces/${workspaceAId}/webhooks`)
      .set('Authorization', adminToken)
      .send({ url: 'https://example.com/webhook2' })
      .expect(201);
    
    expect(res.body).toHaveProperty('id');
  });

  it('MEMBER cannot create webhook', async () => {
    await request(app.getHttpServer())
      .post(`/workspaces/${workspaceAId}/webhooks`)
      .set('Authorization', memberToken)
      .send({ url: 'https://example.com/member' })
      .expect(403);
  });

  it('VIEWER cannot create webhook', async () => {
    await request(app.getHttpServer())
      .post(`/workspaces/${workspaceAId}/webhooks`)
      .set('Authorization', viewerToken)
      .send({ url: 'https://example.com/viewer' })
      .expect(403);
  });

  it('Workspace can list its own webhooks', async () => {
    const res = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceAId}/webhooks`)
      .set('Authorization', ownerToken)
      .expect(200);
    
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0]).not.toHaveProperty('secret_encrypted');
  });

  it('Cannot access another workspaces webhooks', async () => {
    await request(app.getHttpServer())
      .get(`/workspaces/${workspaceAId}/webhooks`)
      .set('Authorization', otherWorkspaceOwnerToken)
      .expect(403);
  });

  it('Cannot delete another workspaces webhook', async () => {
    await request(app.getHttpServer())
      .delete(`/workspaces/${workspaceBId}/webhooks/${webhookId}`)
      .set('Authorization', otherWorkspaceOwnerToken)
      .expect(404);
  });

  it('OWNER can delete webhook', async () => {
    await request(app.getHttpServer())
      .delete(`/workspaces/${workspaceAId}/webhooks/${webhookId}`)
      .set('Authorization', ownerToken)
      .expect(200);
  });
});
