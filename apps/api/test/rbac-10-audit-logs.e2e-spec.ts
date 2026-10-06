import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard.js';

class MockJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const token = req.headers.authorization;
    if (token) {
      const userId = token.split(' ')[1];
      if (userId) {
        req.user = { userId, email: 'test@example.com', role: 'authenticated' };
        return true;
      }
    }
    throw new UnauthorizedException();
  }
}

describe('RBAC-10 Audit Logs (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  
  let user1Token: string;
  let user1Id: string;
  let user2Token: string;
  let user2Id: string;
  
  let ws1Id: string;
  let ws2Id: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(MockJwtAuthGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    
    prisma = app.get(PrismaService);
    
    // Create users
    user1Id = 'user-audit-1';
    user2Id = 'user-audit-2';
    
    await prisma.profile.upsert({ where: { id: user1Id }, update: {}, create: { id: user1Id, display_name: 'User 1' } });
    await prisma.profile.upsert({ where: { id: user2Id }, update: {}, create: { id: user2Id, display_name: 'User 2' } });
    
    user1Token = user1Id;
    user2Token = user2Id;
    
    // Create Workspaces
    const ws1Res = await request(app.getHttpServer())
      .post('/workspaces')
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ name: 'Audit WS 1' });
    ws1Id = ws1Res.body.id;

    const ws2Res = await request(app.getHttpServer())
      .post('/workspaces')
      .set('Authorization', `Bearer ${user2Token}`)
      .send({ name: 'Audit WS 2' });
    ws2Id = ws2Res.body.id;

  });

  afterAll(async () => {
    // Clean up test data
    await prisma.workspaceMemberPermission.deleteMany({
      where: { workspace_id: { in: [ws1Id, ws2Id].filter(Boolean) } }
    });
    await prisma.securityAuditLog.deleteMany({
      where: { workspace_id: { in: [ws1Id, ws2Id].filter(Boolean) } }
    });
    await prisma.workspaceInvitation.deleteMany({
      where: { workspace_id: { in: [ws1Id, ws2Id].filter(Boolean) } }
    });
    await prisma.workspaceMember.deleteMany({
      where: { workspace_id: { in: [ws1Id, ws2Id].filter(Boolean) } }
    });
    await prisma.workspace.deleteMany({
      where: { id: { in: [ws1Id, ws2Id] } }
    });
    
    await app.close();
  });

  it('Scenario 1: audit_log:read is required to fetch logs', async () => {
    const res = await request(app.getHttpServer())
      .get(`/workspaces/${ws1Id}/audit-logs`)
      .set('Authorization', `Bearer ${user1Token}`);
    
    // User1 is OWNER, should have access implicitly
    expect(res.status).toBe(200);
    expect(res.body.items).toBeInstanceOf(Array);
  });

  it('Scenario 2: Cross-workspace access is blocked', async () => {
    const res = await request(app.getHttpServer())
      .get(`/workspaces/${ws1Id}/audit-logs`)
      .set('Authorization', `Bearer ${user2Token}`);
    
    // User2 is not in ws1
    expect(res.status).toBe(403);
  });

  it('Scenario 3: Member without audit_log:read is denied', async () => {
    const u3Id = 'user-audit-3';
    await prisma.profile.upsert({ where: { id: u3Id }, update: {}, create: { id: u3Id, display_name: 'u3' } });
    const u3Token = u3Id;
    
    await prisma.workspaceMember.create({
      data: { workspace_id: ws1Id, user_id: u3Id, role: 'MEMBER' }
    });

    const res = await request(app.getHttpServer())
      .get(`/workspaces/${ws1Id}/audit-logs`)
      .set('Authorization', `Bearer ${u3Token}`);
    
    // Denied because no audit_log:read
    expect(res.status).toBe(403);
  });

  it('Scenario 4: INVITATION_CREATED log is generated', async () => {
    const res = await request(app.getHttpServer())
      .post(`/workspaces/${ws1Id}/invitations`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ email: 'new@example.com', role: 'MEMBER' });
    
    expect(res.status).toBe(201);
    const inviteId = res.body.id;

    const logsRes = await request(app.getHttpServer())
      .get(`/workspaces/${ws1Id}/audit-logs?action=INVITATION_CREATED`)
      .set('Authorization', `Bearer ${user1Token}`);
    
    expect(logsRes.status).toBe(200);
    const log = logsRes.body.items.find(l => l.target_id === inviteId);
    expect(log).toBeDefined();
    expect(log.action).toBe('INVITATION_CREATED');
    expect(log.actor_user_id).toBe(user1Id);
  });

  it('Scenario 5: Failed mutations do not generate logs', async () => {
    const beforeLogsRes = await request(app.getHttpServer())
      .get(`/workspaces/${ws1Id}/audit-logs`)
      .set('Authorization', `Bearer ${user1Token}`);
    const beforeCount = beforeLogsRes.body.items.length;

    // Fail an invitation
    await request(app.getHttpServer())
      .post(`/workspaces/${ws1Id}/invitations`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ email: 'new@example.com', role: 'INVALID_ROLE' }); // Invalid

    const afterLogsRes = await request(app.getHttpServer())
      .get(`/workspaces/${ws1Id}/audit-logs`)
      .set('Authorization', `Bearer ${user1Token}`);
    const afterCount = afterLogsRes.body.items.length; 

    expect(afterCount).toBe(beforeCount);
  });

  it('Scenario 6: Log endpoints do not support PUT/PATCH/DELETE (Immutability)', async () => {
    const postRes = await request(app.getHttpServer())
      .post(`/workspaces/${ws1Id}/audit-logs`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ action: 'FAKE' });
    expect(postRes.status).toBe(404); // Route not found

    const delRes = await request(app.getHttpServer())
      .delete(`/workspaces/${ws1Id}/audit-logs/fake-id`)
      .set('Authorization', `Bearer ${user1Token}`);
    expect(delRes.status).toBe(404);
  });

  it('Scenario 7: PERMISSION_ASSIGNED log is generated', async () => {
    const u3Id = 'user-audit-3';
    const member = await prisma.workspaceMember.findUnique({
      where: { workspace_id_user_id: { workspace_id: ws1Id, user_id: u3Id } }
    });

    const res = await request(app.getHttpServer())
      .put(`/workspaces/${ws1Id}/permissions/members/${member.id}/call:read`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ scopeType: 'ALL' });
    
    expect(res.status).toBe(200);

    const logsRes = await request(app.getHttpServer())
      .get(`/workspaces/${ws1Id}/audit-logs?action=PERMISSION_ASSIGNED`)
      .set('Authorization', `Bearer ${user1Token}`);
    
    const log = logsRes.body.items.find(l => l.target_id === member.id && l.metadata.permissionKey === 'call:read');
    expect(log).toBeDefined();
    expect(log.actor_user_id).toBe(user1Id);
  });

  it('Scenario 8: MEMBER_REMOVED log is generated', async () => {
    const u4Id = 'user-audit-4';
    await prisma.profile.upsert({ where: { id: u4Id }, update: {}, create: { id: u4Id, display_name: 'u4' } });
    
    const member = await prisma.workspaceMember.create({
      data: { workspace_id: ws1Id, user_id: u4Id, role: 'MEMBER' }
    });

    const res = await request(app.getHttpServer())
      .delete(`/workspaces/${ws1Id}/members/${u4Id}`)
      .set('Authorization', `Bearer ${user1Token}`);
    
    expect(res.status).toBe(200);

    const logsRes = await request(app.getHttpServer())
      .get(`/workspaces/${ws1Id}/audit-logs?action=MEMBER_REMOVED`)
      .set('Authorization', `Bearer ${user1Token}`);
    
    const log = logsRes.body.items.find(l => l.target_id === member.id);
    expect(log).toBeDefined();
    expect(log.action).toBe('MEMBER_REMOVED');
  });

  it('Scenario 9: Date filtering works correctly', async () => {
    const logsRes = await request(app.getHttpServer())
      .get(`/workspaces/${ws1Id}/audit-logs?startDate=2020-01-01T00:00:00Z&endDate=2030-01-01T00:00:00Z`)
      .set('Authorization', `Bearer ${user1Token}`);
    
    expect(logsRes.status).toBe(200);
    expect(logsRes.body.items.length).toBeGreaterThan(0);
  });
});
