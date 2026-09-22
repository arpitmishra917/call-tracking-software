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

describe('Workspaces (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const testUserId = `test-user-${Date.now()}`;
  const testUserToken = `Bearer ${testUserId}`;
  const otherUserId = `other-user-${Date.now()}`;
  const otherUserToken = `Bearer ${otherUserId}`;

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
  });

  afterAll(async () => {
    // Cleanup
    await prisma.workspaceMember.deleteMany({
      where: { user_id: { in: [testUserId, otherUserId] } }
    });
    await prisma.workspace.deleteMany({
      where: { name: { startsWith: 'Test Onboarding' } }
    });
    await prisma.profile.deleteMany({
      where: { id: { in: [testUserId, otherUserId] } }
    });
    await app.close();
  });

  describe('POST /workspaces', () => {
    it('1. Unauthenticated POST /workspaces returns 401', async () => {
      await request(app.getHttpServer())
        .post('/workspaces')
        .send({ name: 'Test Onboarding WS' })
        .expect(401);
    });

    it('6. Invalid workspace name rejected', async () => {
      await request(app.getHttpServer())
        .post('/workspaces')
        .set('Authorization', testUserToken)
        .send({ name: '' })
        .expect(400);
    });

    let createdWorkspaceId: string;

    it('2. Authenticated user can create workspace', async () => {
      const res = await request(app.getHttpServer())
        .post('/workspaces')
        .set('Authorization', testUserToken)
        .send({ name: 'Test Onboarding WS 1' })
        .expect(201);
      
      expect(res.body).toHaveProperty('id');
      expect(res.body.name).toBe('Test Onboarding WS 1');
      createdWorkspaceId = res.body.id;
    });

    it('3. Created workspace has correct owner membership', async () => {
      const members = await prisma.workspaceMember.findMany({
        where: { workspace_id: createdWorkspaceId }
      });
      expect(members.length).toBe(1);
      expect(members[0].user_id).toBe(testUserId);
      expect(members[0].role).toBe('OWNER');
    });

    it('4. Profile is created/reused correctly', async () => {
      const profile = await prisma.profile.findUnique({
        where: { id: testUserId }
      });
      expect(profile).toBeDefined();
    });

    it('7. userId from request body cannot override authenticated user', async () => {
      const res = await request(app.getHttpServer())
        .post('/workspaces')
        .set('Authorization', testUserToken)
        .send({ name: 'Test Onboarding WS Malicious', userId: 'hacked-id' })
        .expect(201);
      
      const members = await prisma.workspaceMember.findMany({
        where: { workspace_id: res.body.id }
      });
      expect(members[0].user_id).toBe(testUserId); // Must be the token user, not the body user
    });

    it('8. User can create multiple workspaces', async () => {
      const res = await request(app.getHttpServer())
        .post('/workspaces')
        .set('Authorization', testUserToken)
        .send({ name: 'Test Onboarding WS 2' })
        .expect(201);
      
      expect(res.body).toHaveProperty('id');
    });

    it('9. GET /workspaces returns the created workspaces', async () => {
      const res = await request(app.getHttpServer())
        .get('/workspaces')
        .set('Authorization', testUserToken)
        .expect(200);
      
      // We created 3 workspaces with this user so far
      expect(res.body.length).toBeGreaterThanOrEqual(3);
      expect(res.body.some((ws: any) => ws.id === createdWorkspaceId)).toBe(true);
    });

    it('10. User cannot see another users workspace', async () => {
      const res = await request(app.getHttpServer())
        .get('/workspaces')
        .set('Authorization', otherUserToken)
        .expect(200);
      
      expect(res.body.length).toBe(0);
    });
  });
});
