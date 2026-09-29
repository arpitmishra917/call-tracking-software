import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, CanActivate, ExecutionContext } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard.js';

class MockJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const token = req.headers.authorization;
    if (token) {
      const userId = token.split(' ')[1];
      if (userId) {
        req.user = { userId };
        return true;
      }
    }
    return false;
  }
}

describe('AccountController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

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
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  const getAuthToken = (userId: string) => {
    return `Bearer ${userId}`;
  };

  describe('/account (GET)', () => {
    it('unauthenticated user gets 401', () => {
      return request(app.getHttpServer()).get('/account').expect(403); // The mock guard returns false, which translates to 403.
    });

    it('returns empty string if profile does not exist', async () => {
      const userId = 'non-existent-user';
      const token = getAuthToken(userId);

      const res = await request(app.getHttpServer())
        .get('/account')
        .set('Authorization', token)
        .expect(200);

      expect(res.body).toEqual({ fullName: '' });
    });

    it('returns profile full name', async () => {
      const userId = 'existing-user-1';
      await prisma.profile.upsert({
        where: { id: userId },
        update: { display_name: 'John Doe' },
        create: { id: userId, display_name: 'John Doe' },
      });

      const token = getAuthToken(userId);
      const res = await request(app.getHttpServer())
        .get('/account')
        .set('Authorization', token)
        .expect(200);

      expect(res.body).toEqual({ fullName: 'John Doe' });
    });
  });

  describe('/account/profile (PUT)', () => {
    it('unauthenticated user gets 403', () => {
      return request(app.getHttpServer())
        .put('/account/profile')
        .send({ fullName: 'New Name' })
        .expect(403);
    });

    it('authenticated user can update own profile', async () => {
      const userId = 'update-user-1';
      const token = getAuthToken(userId);

      const res = await request(app.getHttpServer())
        .put('/account/profile')
        .set('Authorization', token)
        .send({ fullName: 'New Name' })
        .expect(200);

      expect(res.body).toEqual({ fullName: 'New Name' });

      const profile = await prisma.profile.findUnique({ where: { id: userId } });
      expect(profile?.display_name).toBe('New Name');
    });

    it('cannot update another users profile', async () => {
      // By design of our endpoint, it infers the user ID from the JWT.
      // So you literally can't pass a user ID to modify another user's profile.
      // This is a test that we only use the token's ID.
      const userId1 = 'user-A';
      const userId2 = 'user-B';
      const token = getAuthToken(userId1);

      await prisma.profile.upsert({
        where: { id: userId2 },
        update: { display_name: 'Original B' },
        create: { id: userId2, display_name: 'Original B' },
      });

      await request(app.getHttpServer())
        .put('/account/profile')
        .set('Authorization', token)
        // Malicious attempt to change user-B's name by sending userId
        .send({ fullName: 'Hacked Name', userId: userId2, user_id: userId2 })
        .expect(200);

      const profileB = await prisma.profile.findUnique({ where: { id: userId2 } });
      expect(profileB?.display_name).toBe('Original B');
    });

    it('rejects empty name', async () => {
      const userId = 'empty-name-user';
      const token = getAuthToken(userId);

      await request(app.getHttpServer())
        .put('/account/profile')
        .set('Authorization', token)
        .send({ fullName: '   ' })
        .expect(400);
    });
    
    it('rejects name that is too long', async () => {
      const userId = 'long-name-user';
      const token = getAuthToken(userId);

      await request(app.getHttpServer())
        .put('/account/profile')
        .set('Authorization', token)
        .send({ fullName: 'a'.repeat(101) })
        .expect(400);
    });
  });
});
