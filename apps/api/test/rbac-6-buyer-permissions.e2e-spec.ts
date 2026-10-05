import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PermissionsService } from '../src/permissions/permissions.service.js';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard.js';

describe('RBAC-6 Buyer Permissions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let permissionsService: PermissionsService;

  let ownerToken: string;
  let buyerToken: string;
  let w1Id: string;
  let w1BuyerId: string;
  let w1OtherBuyerId: string;
  let wmBuyerId: string;
  let w1CampaignId: string;
  let w2Id: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          const req = context.switchToHttp().getRequest();
          const token = req.headers.authorization?.split(' ')[1];
          if (token === 'owner') req.user = { userId: 'u_owner' };
          else if (token === 'buyer') req.user = { userId: 'u_buyer' };
          else return false;
          return true;
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
    prisma = app.get(PrismaService);
    permissionsService = app.get(PermissionsService);

    // Setup db
    await prisma.workspaceMemberPermission.deleteMany();
    await prisma.workspaceMember.deleteMany();
    await prisma.campaignBuyer.deleteMany();
    await prisma.buyer.deleteMany();
    await prisma.campaign.deleteMany();
    await prisma.workspace.deleteMany();

    const w1 = await prisma.workspace.create({ data: { name: 'W1', slug: 'w1' } });
    const w2 = await prisma.workspace.create({ data: { name: 'W2', slug: 'w2' } });
    w1Id = w1.id; w2Id = w2.id;

    // Profiles
    await prisma.profile.upsert({ where: { id: 'u_owner' }, update: {}, create: { id: 'u_owner', display_name: 'Owner' } });
    await prisma.profile.upsert({ where: { id: 'u_buyer' }, update: {}, create: { id: 'u_buyer', display_name: 'Buyer' } });

    // Owner
    await prisma.workspaceMember.create({ data: { workspace_id: w1Id, user_id: 'u_owner', role: 'OWNER', participant_type: 'INTERNAL' } });
    
    // Create buyers
    const b1 = await prisma.buyer.create({ data: { workspace_id: w1Id, name: 'B1', status: 'ACTIVE', destination_number: '+1234567890' } });
    w1BuyerId = b1.id;
    const b2 = await prisma.buyer.create({ data: { workspace_id: w1Id, name: 'B2', status: 'ACTIVE', destination_number: '+0987654321' } });
    w1OtherBuyerId = b2.id;

    // Create member as buyer
    wmBuyerId = (await prisma.workspaceMember.create({ data: { workspace_id: w1Id, user_id: 'u_buyer', role: 'MEMBER', participant_type: 'BUYER', buyer_id: w1BuyerId } })).id;
    const p1 = await prisma.permission.findUnique({ where: { key: 'buyer:read' } }); await prisma.workspaceMemberPermission.create({ data: { workspace_id: w1Id, workspace_member_id: wmBuyerId, permission_id: p1.id, scope_type: 'ASSIGNED' } });
    const p2 = await prisma.permission.findUnique({ where: { key: 'campaign:read' } }); await prisma.workspaceMemberPermission.create({ data: { workspace_id: w1Id, workspace_member_id: wmBuyerId, permission_id: p2.id, scope_type: 'ASSIGNED' } });

    // Campaign
    const c1 = await prisma.campaign.create({ data: { workspace_id: w1Id, name: 'C1' } });
    w1CampaignId = c1.id;
    await prisma.campaignBuyer.create({ data: { workspace_id: w1Id, campaign_id: w1CampaignId, buyer_id: w1BuyerId, priority: 1 } });

    ownerToken = 'owner';
    buyerToken = 'buyer';
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('Buyer can list buyers and see only their own', async () => {
    const res = await request(app.getHttpServer())
      .get(`/workspaces/${w1Id}/buyers`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe(w1BuyerId);
  });

  it('Buyer can access explicitly authorized buyer resource', async () => {
    await request(app.getHttpServer())
      .get(`/workspaces/${w1Id}/buyers/${w1BuyerId}`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(200);
  });

  it('Buyer cannot access another buyer', async () => {
    await request(app.getHttpServer())
      .get(`/workspaces/${w1Id}/buyers/${w1OtherBuyerId}`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(403);
  });

  it('Buyer cannot access unauthorized campaign', async () => {
    const c2 = await prisma.campaign.create({ data: { workspace_id: w1Id, name: 'C2' } });
    await request(app.getHttpServer())
      .get(`/workspaces/${w1Id}/campaigns/${c2.id}`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(403);
  });

  it('Buyer cannot assign permissions', async () => {
    await request(app.getHttpServer())
      .put(`/workspaces/${w1Id}/permissions/members/${wmBuyerId}/buyer:read`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ workspace_member_id: wmBuyerId, key: 'buyer:read', scope_type: 'ALL' })
      .expect(403);
  });
  
  it('Buyer cannot access another workspace', async () => {
    await request(app.getHttpServer())
      .get(`/workspaces/${w2Id}/buyers`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(403);
  });

  it('OWNER behavior remains valid', async () => {
    const res = await request(app.getHttpServer())
      .get(`/workspaces/${w1Id}/buyers`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(res.body.items).toHaveLength(2);
  });
});
