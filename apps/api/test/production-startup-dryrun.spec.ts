import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { validatePublicHttpsUrl, resolveBaseUrl } from '../src/main.js';

describe('Production-Shaped Synthetic Startup Dry Run (Phase DEPLOY-2R)', () => {
  const originalEnv = { ...process.env };
  let app: INestApplication;
  let mockPrisma: any;

  beforeAll(async () => {
    // 1. Configure Synthetic Production Environment
    // NEVER use real credentials or live database URLs in tests
    process.env.NODE_ENV = 'production';
    process.env.APP_ENV = 'production';
    process.env.TELEPHONY_PROVIDER = 'telnyx';
    process.env.TELEPHONY_QA_ENABLED = 'false';
    process.env.BASE_URL = 'https://callflow-backend-synthetic.onrender.com';
    process.env.RINGBACK_AUDIO_URL =
      'https://callflow-backend-synthetic.onrender.com/telephony/ringback.wav';
    process.env.SUPABASE_URL = 'https://synthetic-project.supabase.co';
    process.env.DATABASE_URL =
      'postgresql://postgres.synthetic:mock_pass@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres';
    process.env.DIRECT_URL =
      'postgresql://postgres:mock_pass@db.synthetic.supabase.co:5432/postgres';
    process.env.TELNYX_API_KEY = 'KEY_SYNTHETIC_TELNYX_API_KEY';
    process.env.TELNYX_PUBLIC_KEY =
      'MCowBQYDK2VwAyEASyntheticMockedTelnyxEd25519PublicKey123456789=';
    process.env.WEBHOOK_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';
    process.env.JWT_SECRET = 'synthetic_production_jwt_secret_32chars!';
    process.env.PORT = '3000';

    // 2. Intercept Prisma Database Connection Boundary (Mocked via Proxy)
    // Strictly prevent live database connection attempts during dry run
    const prismaModelOps = {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      upsert: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      count: vi.fn().mockResolvedValue(0),
    };

    mockPrisma = new Proxy(
      {
        $connect: vi.fn().mockResolvedValue(undefined),
        $disconnect: vi.fn().mockResolvedValue(undefined),
        $queryRaw: vi.fn().mockResolvedValue([{ '1': 1 }]),
        onModuleInit: async function () {
          // Verify Prisma reaches connection boundary without throwing
          await this.$connect();
        },
        onModuleDestroy: async function () {
          await this.$disconnect();
        },
      } as any,
      {
        get(target, prop) {
          if (prop in target) return target[prop];
          return prismaModelOps;
        },
      },
    );

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    process.env = { ...originalEnv };
  });

  describe('1. Production Configuration & Validation Verification', () => {
    it('1.1. Production HTTPS URL validator accepts legitimate public Render URLs', () => {
      expect(
        validatePublicHttpsUrl(
          'https://callflow-backend-synthetic.onrender.com',
          'BASE_URL',
        ),
      ).toBe('https://callflow-backend-synthetic.onrender.com');

      expect(
        validatePublicHttpsUrl(
          'https://callflow-backend-synthetic.onrender.com/telephony/ringback.wav',
          'RINGBACK_AUDIO_URL',
        ),
      ).toBe('https://callflow-backend-synthetic.onrender.com');
    });

    it('1.2. Production HTTPS URL validator rejects invalid protocols, loopback and private IPs', () => {
      expect(() => validatePublicHttpsUrl('http://insecure.domain.com', 'BASE_URL')).toThrow(
        'must use HTTPS protocol',
      );
      expect(() => validatePublicHttpsUrl('https://localhost:3000', 'BASE_URL')).toThrow(
        'resolves to a loopback or private network address',
      );
      expect(() => validatePublicHttpsUrl('https://127.0.0.1:3000', 'BASE_URL')).toThrow(
        'resolves to a loopback or private network address',
      );
      expect(() => validatePublicHttpsUrl('https://192.168.1.50', 'BASE_URL')).toThrow(
        'resolves to a loopback or private network address',
      );
    });

    it('1.3. Production SUPABASE_URL remains intact and is never stripped', () => {
      expect(process.env.SUPABASE_URL).toBe('https://synthetic-project.supabase.co');
    });

    it('1.4. Prisma reaches the expected connection boundary without isolation failure', () => {
      expect(mockPrisma.$connect).toHaveBeenCalled();
    });

    it('1.5. Automatic fallback to RENDER_EXTERNAL_URL when BASE_URL is absent in production', () => {
      const prevBase = process.env.BASE_URL;
      try {
        delete process.env.BASE_URL;
        process.env.RENDER_EXTERNAL_URL = 'https://callflow-backend-synthetic.onrender.com';
        expect(resolveBaseUrl({ validate: true })).toBe(
          'https://callflow-backend-synthetic.onrender.com',
        );
      } finally {
        if (prevBase) process.env.BASE_URL = prevBase;
        delete process.env.RENDER_EXTERNAL_URL;
      }
    });
  });

  describe('2. Public Health Ping Endpoint Verification', () => {
    it('2.1. GET /health/ping returns HTTP 200 with status ok and valid ISO-8601 timestamp', async () => {
      const res = await request(app.getHttpServer()).get('/health/ping');

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.headers['content-type']).toMatch(/json/);
      expect(res.body.status).toBe('ok');
      expect(res.body.service).toBe('callflow-api');
      expect(res.body.timestamp).toBeDefined();

      const parsedDate = new Date(res.body.timestamp);
      expect(parsedDate.getTime()).not.toBeNaN();
      expect(parsedDate.toISOString()).toBe(res.body.timestamp);

      // Verify no sensitive fields leak
      const keys = Object.keys(res.body);
      expect(keys.sort()).toEqual(['service', 'status', 'timestamp'].sort());
    });

    it('2.2. HEAD /health/ping returns HTTP 200 without payload body for uptime monitors', async () => {
      const res = await request(app.getHttpServer()).head('/health/ping');

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body).toEqual({});
    });
  });

  describe('3. Process Liveness & Database Readiness Endpoints Verification', () => {
    it('3.1. GET /health/live returns HTTP 200 and does not invoke database query', async () => {
      const initialQueryCount = mockPrisma.$queryRaw.mock.calls.length;

      const res = await request(app.getHttpServer()).get('/health/live');

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.status).toBe('ok');
      expect(res.body.timestamp).toBeDefined();

      // Confirm no database query executed for liveness
      expect(mockPrisma.$queryRaw.mock.calls.length).toBe(initialQueryCount);
    });

    it('3.2. GET /health/ready returns HTTP 200 when database connection is healthy', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ '1': 1 }]);

      const res = await request(app.getHttpServer()).get('/health/ready');

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body.status).toBe('healthy');
      expect(res.body.services.database.status).toBe('up');
    });

    it('3.3. GET /health/ready returns HTTP 503 when database connection is down', async () => {
      mockPrisma.$queryRaw.mockRejectedValueOnce(new Error('PostgreSQL connection dropped'));

      const res = await request(app.getHttpServer()).get('/health/ready');

      expect(res.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      expect(res.body.status).toBe('unhealthy');
      expect(res.body.services.database.status).toBe('down');
    });
  });

  describe('4. QA Telephony Endpoint Isolation in Production', () => {
    it('4.1. QA endpoints are strictly guarded and fail closed when TELEPHONY_QA_ENABLED is false', async () => {
      const res = await request(app.getHttpServer())
        .post('/qa/lease')
        .send({ buyerId: 'b_test' });

      // QAAuthGuard or isQaEnabled check rejects with 401 or 403
      expect([HttpStatus.FORBIDDEN, HttpStatus.UNAUTHORIZED]).toContain(res.status);
    });
  });
});
