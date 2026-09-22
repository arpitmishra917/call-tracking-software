import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

import {
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard.js';

class MockJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const token = request.headers.authorization;
    if (token) {
      // Very naive token logic for test: "Bearer user1-uuid"
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

describe('Authorization & Tenant Isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let user1Token: string = 'Bearer user1-uuid'; // Member of workspace A (OWNER)
  let user2Token: string = 'Bearer user2-uuid'; // Member of workspace B (OWNER), not A
  let user3Token: string = 'Bearer user3-uuid'; // Member of workspace A (MEMBER)
  let user4Token: string = 'Bearer user4-uuid'; // Member of workspace A (VIEWER)

  let workspaceAId: string;
  let workspaceBId: string;

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

    // Clear DB
    await prisma.workspaceMember.deleteMany();
    await prisma.workspace.deleteMany();
    await prisma.profile.deleteMany();

    // Create users/profiles
    const user1 = await prisma.profile.create({
      data: { id: 'user1-uuid', display_name: 'User 1' },
    });
    const user2 = await prisma.profile.create({
      data: { id: 'user2-uuid', display_name: 'User 2' },
    });
    const user3 = await prisma.profile.create({
      data: { id: 'user3-uuid', display_name: 'User 3' },
    });
    const user4 = await prisma.profile.create({
      data: { id: 'user4-uuid', display_name: 'User 4' },
    });

    // Create workspaces
    const wsA = await prisma.workspace.create({
      data: { name: 'Workspace A', slug: 'ws-a' },
    });
    const wsB = await prisma.workspace.create({
      data: { name: 'Workspace B', slug: 'ws-b' },
    });
    workspaceAId = wsA.id;
    workspaceBId = wsB.id;

    // Create memberships
    await prisma.workspaceMember.create({
      data: { workspace_id: wsA.id, user_id: user1.id, role: 'OWNER' },
    });
    await prisma.workspaceMember.create({
      data: { workspace_id: wsB.id, user_id: user2.id, role: 'OWNER' },
    });
    await prisma.workspaceMember.create({
      data: { workspace_id: wsA.id, user_id: user3.id, role: 'MEMBER' },
    });
    await prisma.workspaceMember.create({
      data: { workspace_id: wsA.id, user_id: user4.id, role: 'VIEWER' },
    });

    // Mock Tokens for simplicity in tests (normally we would mock JwtAuthGuard or sign actual JWTs)
    // We will inject a mock JwtAuthGuard directly into the test context or generate signed tokens
    // Wait, testing with real JwtAuthGuard requires a signed token using Supabase secret, but SUPABASE_URL is mock.
    // However, the test can just sign a simple JWT since `algorithms: ['RS256']` is used, wait, RS256 requires keypair.
    // Let's mock JwtAuthGuard just for this test, or we can use a mock user in request.
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('13. Missing/invalid authenticated identity is rejected', async () => {
    return request(app.getHttpServer())
      .get(`/workspaces/${workspaceAId}`)
      .expect(401);
  });

  it('1. Workspace A member can access Workspace A (OWNER)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/workspaces/${workspaceAId}`)
      .set('Authorization', user1Token)
      .expect(200);
    expect(res.body.id).toBe(workspaceAId);
  });

  it('2. Workspace A member cannot read Workspace B', async () => {
    return request(app.getHttpServer())
      .get(`/workspaces/${workspaceBId}`)
      .set('Authorization', user1Token)
      .expect(403);
  });

  it('3. Workspace A member cannot mutate Workspace B', async () => {
    return request(app.getHttpServer())
      .put(`/workspaces/${workspaceBId}/settings`)
      .set('Authorization', user1Token)
      .send({ name: 'Hacked' })
      .expect(403);
  });

  it('4. Non-member cannot access workspace', async () => {
    const nonMemberToken = 'Bearer unassigned-uuid';
    return request(app.getHttpServer())
      .get(`/workspaces/${workspaceAId}`)
      .set('Authorization', nonMemberToken)
      .expect(403);
  });

  it('5. OWNER authorization works (can read and update)', async () => {
    await request(app.getHttpServer())
      .get(`/workspaces/${workspaceAId}/members`)
      .set('Authorization', user1Token)
      .expect(200);

    await request(app.getHttpServer())
      .put(`/workspaces/${workspaceAId}/settings`)
      .set('Authorization', user1Token)
      .send({ name: 'Workspace A Updated' })
      .expect(200);
  });

  it('7. MEMBER authorization works (can read)', async () => {
    await request(app.getHttpServer())
      .get(`/workspaces/${workspaceAId}`)
      .set('Authorization', user3Token)
      .expect(200);
  });

  it('8. MEMBER cannot manage members', async () => {
    return request(app.getHttpServer())
      .delete(`/workspaces/${workspaceAId}/members/user4-uuid`)
      .set('Authorization', user3Token)
      .expect(403);
  });

  it('9. VIEWER can perform allowed read operations', async () => {
    await request(app.getHttpServer())
      .get(`/workspaces/${workspaceAId}`)
      .set('Authorization', user4Token)
      .expect(200);
  });

  it('10. VIEWER cannot perform protected mutations', async () => {
    await request(app.getHttpServer())
      .put(`/workspaces/${workspaceAId}/settings`)
      .set('Authorization', user4Token)
      .send({ name: 'Hack settings' })
      .expect(403);
  });

  it('11. Client-supplied workspace ID cannot bypass tenant isolation', async () => {
    // If a route used body instead of URL parameter, they still get checked by guard.
    // E.g., user1 (only in A) tries to update B by passing B's id.
    await request(app.getHttpServer())
      .put(`/workspaces/${workspaceBId}/settings`)
      .set('Authorization', user1Token)
      .send({ workspaceId: workspaceBId, name: 'Hack settings' })
      .expect(403);
  });

  // --- CAMPAIGNS AUTHENTICATION / AUTHORIZATION ---

  it('Campaign endpoint without JWT -> 401', async () => {
    return request(app.getHttpServer())
      .get(`/workspaces/${workspaceAId}/campaigns`)
      .expect(401);
  });

  it('Campaign endpoint with valid JWT + valid workspace -> succeeds', async () => {
    return request(app.getHttpServer())
      .get(`/workspaces/${workspaceAId}/campaigns`)
      .set('Authorization', user1Token)
      .expect(200);
  });

  it('Campaign endpoint with valid JWT + unauthorized workspace -> 403', async () => {
    return request(app.getHttpServer())
      .get(`/workspaces/${workspaceBId}/campaigns`)
      .set('Authorization', user1Token)
      .expect(403);
  });

  // --- BUYERS AUTHENTICATION / AUTHORIZATION ---

  it('Buyer endpoint without JWT -> 401', async () => {
    return request(app.getHttpServer())
      .get(`/workspaces/${workspaceAId}/buyers`)
      .expect(401);
  });

  it('Buyer endpoint with valid JWT + valid workspace -> succeeds', async () => {
    return request(app.getHttpServer())
      .get(`/workspaces/${workspaceAId}/buyers`)
      .set('Authorization', user1Token)
      .expect(200);
  });

  it('Buyer endpoint with unauthorized workspace -> 403', async () => {
    return request(app.getHttpServer())
      .get(`/workspaces/${workspaceBId}/buyers`)
      .set('Authorization', user1Token)
      .expect(403);
  });

  // --- BLOCKED CALLERS ---

  it('Blocked callers endpoint without JWT -> 401', async () => {
    return request(app.getHttpServer())
      .get(`/workspaces/${workspaceAId}/blocked-callers`)
      .expect(401);
  });

  it('Blocked callers endpoint with valid JWT + valid workspace -> succeeds', async () => {
    return request(app.getHttpServer())
      .get(`/workspaces/${workspaceAId}/blocked-callers`)
      .set('Authorization', user1Token)
      .expect(200);
  });

  it('Blocked callers endpoint with unauthorized workspace -> 403', async () => {
    return request(app.getHttpServer())
      .get(`/workspaces/${workspaceBId}/blocked-callers`)
      .set('Authorization', user1Token)
      .expect(403);
  });

  // --- PHONE NUMBERS ---

  it('Phone numbers endpoint without JWT -> 401', async () => {
    return request(app.getHttpServer())
      .get(`/workspaces/${workspaceAId}/phone-numbers`)
      .expect(401);
  });

  it('Phone numbers endpoint with valid JWT + valid workspace -> succeeds', async () => {
    return request(app.getHttpServer())
      .get(`/workspaces/${workspaceAId}/phone-numbers`)
      .set('Authorization', user1Token)
      .expect(200);
  });

  it('Phone numbers endpoint with unauthorized workspace -> 403', async () => {
    return request(app.getHttpServer())
      .get(`/workspaces/${workspaceBId}/phone-numbers`)
      .set('Authorization', user1Token)
      .expect(403);
  });
});
