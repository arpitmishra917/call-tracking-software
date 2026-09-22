import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard.js';
import { FakeTelephonyProvider } from '../src/telephony/fake.provider.js';
import { TELEPHONY_PROVIDER } from '../src/telephony/call-controller.js';

describe('Recordings (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let testWorkspaceId: string;
  let testRecordingId: string;
  let ownerId: string;
  let otherId: string;
  let requestUser: any;

  beforeAll(async () => {
    const mockAuthGuard = {
      canActivate: (context: any) => {
        const req = context.switchToHttp().getRequest();
        req.user = requestUser;
        return true;
      },
    };

    const fakeProvider = new FakeTelephonyProvider();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockAuthGuard)
      .overrideProvider(TELEPHONY_PROVIDER)
      .useValue(fakeProvider)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);

    await prisma.recording.deleteMany({});
    await prisma.call.deleteMany({});
    await prisma.workspaceMember.deleteMany({});
    await prisma.workspace.deleteMany({});
    await prisma.profile.deleteMany({});

    const owner = await prisma.profile.create({ data: { id: 'rec_owner_id' } });
    ownerId = owner.id;
    const other = await prisma.profile.create({ data: { id: 'rec_other_id' } });
    otherId = other.id;

    const workspace = await prisma.workspace.create({
      data: { name: 'Test WS', slug: 'test-ws-rec' },
    });
    testWorkspaceId = workspace.id;

    await prisma.workspaceMember.create({
      data: { workspace_id: workspace.id, user_id: owner.id, role: 'OWNER' },
    });

    const call = await prisma.call.create({
      data: {
        workspace_id: workspace.id,
        provider: 'telnyx',
        provider_call_id: 'call-123',
        from_number: '+1222',
        to_number: '+1333',
        state: 'COMPLETED',
      },
    });

    const recording = await prisma.recording.create({
      data: {
        workspace_id: workspace.id,
        call_id: call.id,
        provider_id: 'rec-123',
        recording_url: 'http://fake',
        status: 'COMPLETED',
      },
    });
    testRecordingId = recording.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('/workspaces/:ws/recordings/:id/download (GET) - Success for authorized user', async () => {
    requestUser = { userId: ownerId, email: 'rec_owner@test.com' };
    const res = await request(app.getHttpServer()).get(
      `/workspaces/${testWorkspaceId}/recordings/${testRecordingId}/download`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('url');
    expect(res.body.url).toContain('fake.recording.url');
  });

  it('/workspaces/:ws/recordings/:id/download (GET) - Fails for unauthorized user', async () => {
    requestUser = { userId: otherId, email: 'rec_other@test.com' };
    const res = await request(app.getHttpServer()).get(
      `/workspaces/${testWorkspaceId}/recordings/${testRecordingId}/download`,
    );

    expect(res.status).toBe(403);
  });

  it('/workspaces/:ws/recordings/:id/download (GET) - Not Found for invalid recording', async () => {
    requestUser = { userId: ownerId, email: 'rec_owner@test.com' };
    const res = await request(app.getHttpServer()).get(
      `/workspaces/${testWorkspaceId}/recordings/fake-id/download`,
    );

    expect(res.status).toBe(404);
  });
});
