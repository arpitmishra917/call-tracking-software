import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { ApiKeysService } from '../src/api-keys/api-keys.service.js';
import * as crypto from 'crypto';

describe('Public API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let apiKeysService: ApiKeysService;

  let ownerUser: any;
  let workspace1: any;
  let workspace2: any;
  let validApiKey1: string;
  let validApiKey2: string;
  let revokedApiKey: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    apiKeysService = app.get<ApiKeysService>(ApiKeysService);

    // Create test user and workspaces
    ownerUser = await prisma.profile.create({
      data: { id: crypto.randomUUID(), display_name: 'Test Owner' },
    });

    workspace1 = await prisma.workspace.create({
      data: {
        name: 'Workspace 1',
        slug: `ws1-${crypto.randomUUID()}`,
        members: {
          create: { user_id: ownerUser.id, role: 'OWNER' },
        },
      },
    });

    workspace2 = await prisma.workspace.create({
      data: {
        name: 'Workspace 2',
        slug: `ws2-${crypto.randomUUID()}`,
        members: {
          create: { user_id: ownerUser.id, role: 'OWNER' },
        },
      },
    });

    // Create API Keys
    const key1 = await apiKeysService.createApiKey(
      workspace1.id,
      ownerUser.id,
      'Key 1',
    );
    validApiKey1 = key1.rawSecret;

    const key2 = await apiKeysService.createApiKey(
      workspace2.id,
      ownerUser.id,
      'Key 2',
    );
    validApiKey2 = key2.rawSecret;

    const key3 = await apiKeysService.createApiKey(
      workspace1.id,
      ownerUser.id,
      'Revoked Key',
    );
    revokedApiKey = key3.rawSecret;
    await apiKeysService.revokeApiKey(workspace1.id, key3.id);
  }, 30000);

  afterAll(async () => {
    if (prisma) {
      await prisma.apiKey.deleteMany({
        where: { workspace_id: { in: [workspace1.id, workspace2.id] } },
      });
      await prisma.workspaceMember.deleteMany({
        where: { user_id: ownerUser.id },
      });
      await prisma.workspace.deleteMany({
        where: { id: { in: [workspace1.id, workspace2.id] } },
      });
      await prisma.profile.delete({ where: { id: ownerUser.id } });
    }
    if (app) {
      await app.close();
    }
  });

  describe('API Key Authentication', () => {
    it('should allow access with a valid API key', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/workspaces/${workspace1.id}`)
        .set('Authorization', `Bearer ${validApiKey1}`);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(workspace1.id);
    });

    it('should reject access with no API key', async () => {
      const response = await request(app.getHttpServer()).get(
        `/api/v1/workspaces/${workspace1.id}`,
      );

      expect(response.status).toBe(401);
    });

    it('should reject access with an invalid API key format', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/workspaces/${workspace1.id}`)
        .set('Authorization', `Bearer invalid-token`);

      expect(response.status).toBe(401);
    });

    it('should reject access with a revoked API key', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/workspaces/${workspace1.id}`)
        .set('Authorization', `Bearer ${revokedApiKey}`);

      expect(response.status).toBe(401);
    });
  });

  describe('Tenant Isolation', () => {
    it('should reject access if using Workspace 1 key for Workspace 2 data', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/workspaces/${workspace2.id}`)
        .set('Authorization', `Bearer ${validApiKey1}`);

      expect(response.status).toBe(403);
    });
  });

  describe('Role Enforcement', () => {
    it('should allow access because API key creator is OWNER', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/workspaces/${workspace1.id}/phone-numbers`)
        .set('Authorization', `Bearer ${validApiKey1}`);

      expect(response.status).toBe(200);
    });
  });
});
