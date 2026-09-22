import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';
import { JwtAuthGuard } from './../src/auth/jwt-auth.guard.js';

describe('AppController Authenticated (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const mockAuthGuard = {
      canActivate: (context: any) => {
        const req = context.switchToHttp().getRequest();
        // Mocking the behavior of JwtStrategy validate method injecting user
        req.user = {
          userId: 'fake-uuid',
          email: 'test@example.com',
          role: 'authenticated',
        };
        return true; // allow request
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
  });

  it('/protected (GET) - Authenticated API request is accepted and identity exposed', () => {
    return request(app.getHttpServer())
      .get('/protected')
      .expect(200)
      .expect((res) => {
        expect(res.body.message).toBe('This is a protected route');
        expect(res.body.user).toBeDefined();
        expect(res.body.user.userId).toBe('fake-uuid');
        expect(res.body.user.email).toBe('test@example.com');
      });
  });

  afterEach(async () => {
    await app.close();
  });
});
