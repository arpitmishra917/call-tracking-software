import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard.js';
import { randomUUID } from 'crypto';

describe('RBAC-7 Vendor Permissions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let ownerToken = 'owner';
  let vendorToken1 = 'vendor1';
  let vendorToken2 = 'vendor2';
  
  let ws1Id: string;
  let ws2Id: string;
  let vendor1Id: string;
  let vendor2Id: string;
  let buyer1Id: string;
  let campaign1Id: string;
  let phone1Id: string;
  let call1Id: string;

  let vendorMember1Id: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate: (context: any) => {
        const req = context.switchToHttp().getRequest();
        const token = req.headers.authorization?.split(' ')[1];
        if (token === 'owner') req.user = { userId: 'u_owner_7' };
        else if (token === 'vendor1') req.user = { userId: 'u_vendor1_7' };
        else if (token === 'vendor2') req.user = { userId: 'u_vendor2_7' };
        else return false;
        return true;
      },
    })
    .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    prisma = app.get(PrismaService);

    // CLEANUP OLD TEST DATA
    await prisma.workspaceMemberPermission.deleteMany({});
    await prisma.callFinancialAdjustment.deleteMany({});
    await prisma.callDispute.deleteMany({});
    await prisma.callCommercial.deleteMany({});
    await prisma.callAttempt.deleteMany({});
    await prisma.call.deleteMany({});
    await prisma.phoneNumber.deleteMany({});
    await prisma.campaignBuyer.deleteMany({});
    await prisma.campaign.deleteMany({});
    await prisma.buyer.deleteMany({});
    await prisma.workspaceMember.deleteMany({});
    await prisma.vendor.deleteMany({});
    await prisma.workspace.deleteMany({where: {name: {startsWith: 'RBAC7'}}});

    await prisma.profile.upsert({where: {id: 'u_owner_7'}, update: {}, create: { id: 'u_owner_7', display_name: 'Owner' }});
    await prisma.profile.upsert({where: {id: 'u_vendor1_7'}, update: {}, create: { id: 'u_vendor1_7', display_name: 'Vendor1' }});
    await prisma.profile.upsert({where: {id: 'u_vendor2_7'}, update: {}, create: { id: 'u_vendor2_7', display_name: 'Vendor2' }});

    const runId = randomUUID().substring(0, 8);

    const ws1 = await prisma.workspace.create({ data: { name: 'RBAC7 WS1 ' + runId, slug: 'rbac7-ws1-' + runId } });
    const ws2 = await prisma.workspace.create({ data: { name: 'RBAC7 WS2 ' + runId, slug: 'rbac7-ws2-' + runId } });
    ws1Id = ws1.id;
    ws2Id = ws2.id;

    await prisma.workspaceMember.create({
      data: { workspace_id: ws1.id, user_id: 'u_owner_7', role: 'OWNER' }
    });
    await prisma.profile.upsert({where: {id: 'u_owner2_7'}, update: {}, create: { id: 'u_owner2_7', display_name: 'Owner2' }}); await prisma.workspaceMember.create({
      data: { workspace_id: ws2.id, user_id: 'u_owner2_7', role: 'OWNER' }
    });

    const vendor1 = await prisma.vendor.create({
      data: { workspace_id: ws1.id, name: 'Vendor 1' }
    });
    vendor1Id = vendor1.id;

    const vendor2 = await prisma.vendor.create({
      data: { workspace_id: ws2.id, name: 'Vendor 2' }
    });
    vendor2Id = vendor2.id;

    const vm1 = await prisma.workspaceMember.create({
      data: { 
        workspace_id: ws1.id, 
        user_id: 'u_vendor1_7', 
        role: 'MEMBER',
        participant_type: 'VENDOR',
        vendor_id: vendor1.id
      }
    });
    vendorMember1Id = vm1.id;
    
    await prisma.workspaceMember.create({
      data: { 
        workspace_id: ws2.id, 
        user_id: 'u_vendor2_7', 
        role: 'MEMBER',
        participant_type: 'VENDOR',
        vendor_id: vendor2.id
      }
    });

    // Create resources in WS1
    const buyer1 = await prisma.buyer.create({
      data: { workspace_id: ws1.id, name: 'Buyer 1', destination_number: '+10000000000' }
    });
    buyer1Id = buyer1.id;

    const campaign1 = await prisma.campaign.create({
      data: { workspace_id: ws1.id, name: 'Campaign 1' }
    });
    campaign1Id = campaign1.id;
    
    await prisma.campaignBuyer.create({
      data: { workspace_id: ws1.id, campaign_id: campaign1.id, buyer_id: buyer1.id, priority: 1 }
    });

    const phone1 = await prisma.phoneNumber.create({
      data: { workspace_id: ws1.id, phone_number: '+18885550000', campaign_id: campaign1.id, provider: 'TEST' }
    });
    phone1Id = phone1.id;

    const call1 = await prisma.call.create({
      data: { 
        workspace_id: ws1.id, 
        campaign_id: campaign1.id, 
        provider: 'TEST', 
        provider_call_id: 'call7-1-' + runId,
        from_number: '+19999999999',
        to_number: '+18885550000'
      }
    });
    call1Id = call1.id;
    
    await prisma.callAttempt.create({
      data: { call_id: call1.id, buyer_id: buyer1.id, state: 'COMPLETED' }
    });

    await prisma.callCommercial.create({
      data: {
        workspace_id: ws1.id,
        call_id: call1.id,
        campaign_id: campaign1.id,
        vendor_id: vendor1.id,
        revenue: 50,
        payout: 25,
        cost: 1,
        profit: 24,
        converted: true,
        qualified: true,
        duplicate: false,
        status: 'FINAL',
        currency: 'USD',
      }
    });

    // Seed missing permissions for testing
    const ensurePerm = async (key: string, group: string) => {
      let p = await prisma.permission.findUnique({ where: { key } });
      if (!p) {
        await prisma.permission.create({ data: { key, description: key, group } });
      }
    };
    await ensurePerm('vendor:read', 'VENDORS');
    await ensurePerm('vendor:write', 'VENDORS');
    await ensurePerm('buyer:read', 'BUYERS');
    await ensurePerm('campaign:read', 'CAMPAIGNS');
    await ensurePerm('phone_number:read', 'PHONE_NUMBERS');
    await ensurePerm('call:read', 'CALLS');
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  const assignPerm = async (key: string, scopeType: string = 'ALL', resourceId: string | null = null) => {
    const p = await prisma.permission.findUnique({ where: { key } });
    await prisma.workspaceMemberPermission.create({
      data: {
        workspace_id: ws1Id,
        workspace_member_id: vendorMember1Id,
        permission_id: p!.id,
        scope_type: scopeType as any,
        resource_id: resourceId
      }
    });
  };

  const clearPerms = async () => {
    await prisma.workspaceMemberPermission.deleteMany({
      where: { workspace_member_id: vendorMember1Id }
    });
  };

  describe('1. Vendor without permission denied', () => {
    beforeAll(async () => await clearPerms());
    
    it('denies calls', async () => {
      await request(app.getHttpServer()).get(`/workspaces/${ws1Id}/calls`).set('Authorization', `Bearer ${vendorToken1}`).expect(403);
    });
    it('denies campaigns', async () => {
      await request(app.getHttpServer()).get(`/workspaces/${ws1Id}/campaigns`).set('Authorization', `Bearer ${vendorToken1}`).expect(403);
    });
    it('denies vendors', async () => {
      await request(app.getHttpServer()).get(`/workspaces/${ws1Id}/vendors`).set('Authorization', `Bearer ${vendorToken1}`).expect(403);
    });
  });

  describe('2. Vendor with permission + ALL scope', () => {
    beforeAll(async () => {
      await clearPerms();
      await assignPerm('vendor:read', 'ALL');
      await assignPerm('call:read', 'ALL');
    });

    it('sees all vendors', async () => {
      const res = await request(app.getHttpServer()).get(`/workspaces/${ws1Id}/vendors`).set('Authorization', `Bearer ${vendorToken1}`).expect(200);
      expect(res.body.items.length).toBeGreaterThan(0);
    });
    it('sees all calls', async () => {
      const res = await request(app.getHttpServer()).get(`/workspaces/${ws1Id}/calls`).set('Authorization', `Bearer ${vendorToken1}`).expect(200);
      expect(res.body.items.length).toBeGreaterThan(0);
    });
  });

  describe('3. Vendor with VENDOR scope', () => {
    beforeAll(async () => {
      await clearPerms();
      await assignPerm('vendor:read', 'VENDOR', vendor1Id);
    });

    it('sees own vendor via list', async () => {
      const res = await request(app.getHttpServer()).get(`/workspaces/${ws1Id}/vendors`).set('Authorization', `Bearer ${vendorToken1}`).expect(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].id).toBe(vendor1Id);
    });

    it('sees own vendor via detail', async () => {
      await request(app.getHttpServer()).get(`/workspaces/${ws1Id}/vendors/${vendor1Id}`).set('Authorization', `Bearer ${vendorToken1}`).expect(200);
    });

    it('cannot see other vendor in same workspace', async () => {
      const other = await prisma.vendor.create({ data: { workspace_id: ws1Id, name: 'Other' } });
      await request(app.getHttpServer()).get(`/workspaces/${ws1Id}/vendors/${other.id}`).set('Authorization', `Bearer ${vendorToken1}`).expect(403);
    });
  });

  describe('4. Vendor with CAMPAIGN scope', () => {
    beforeAll(async () => {
      await clearPerms();
      await assignPerm('campaign:read', 'CAMPAIGN', campaign1Id);
      await assignPerm('call:read', 'CAMPAIGN', campaign1Id);
    });

    it('authorized Campaign access (list)', async () => {
      const res = await request(app.getHttpServer()).get(`/workspaces/${ws1Id}/campaigns`).set('Authorization', `Bearer ${vendorToken1}`).expect(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].id).toBe(campaign1Id);
    });

    it('authorized Campaign access (detail)', async () => {
      await request(app.getHttpServer()).get(`/workspaces/${ws1Id}/campaigns/${campaign1Id}`).set('Authorization', `Bearer ${vendorToken1}`).expect(200);
    });

    it('unauthorized Campaign denied', async () => {
      const camp2 = await prisma.campaign.create({ data: { workspace_id: ws1Id, name: 'Camp 2' } });
      await request(app.getHttpServer()).get(`/workspaces/${ws1Id}/campaigns/${camp2.id}`).set('Authorization', `Bearer ${vendorToken1}`).expect(403);
    });

    it('authorized Calls access (list)', async () => {
      const res = await request(app.getHttpServer()).get(`/workspaces/${ws1Id}/calls`).set('Authorization', `Bearer ${vendorToken1}`).expect(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].id).toBe(call1Id);
    });

    it('authorized Calls access (detail)', async () => {
      await request(app.getHttpServer()).get(`/workspaces/${ws1Id}/calls/${call1Id}`).set('Authorization', `Bearer ${vendorToken1}`).expect(200);
    });
  });

  describe('5. Vendor with PHONE_NUMBER scope', () => {
    beforeAll(async () => {
      await clearPerms();
      await assignPerm('phone_number:read', 'PHONE_NUMBER', phone1Id);
      await assignPerm('call:read', 'PHONE_NUMBER', phone1Id);
    });

    it('authorized Phone Number access (list)', async () => {
      const res = await request(app.getHttpServer()).get(`/workspaces/${ws1Id}/phone-numbers`).set('Authorization', `Bearer ${vendorToken1}`).expect(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].id).toBe(phone1Id);
    });
    
    it('authorized Calls access (list via phone)', async () => {
      const res = await request(app.getHttpServer()).get(`/workspaces/${ws1Id}/calls`).set('Authorization', `Bearer ${vendorToken1}`).expect(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].id).toBe(call1Id);
    });
    
    it('authorized Calls access (detail via phone)', async () => {
      await request(app.getHttpServer()).get(`/workspaces/${ws1Id}/calls/${call1Id}`).set('Authorization', `Bearer ${vendorToken1}`).expect(200);
    });
  });

  describe('6. Vendor with BUYER scope', () => {
    beforeAll(async () => {
      await clearPerms();
      await assignPerm('buyer:read', 'BUYER', buyer1Id);
      await assignPerm('call:read', 'BUYER', buyer1Id);
    });

    it('authorized Buyer access (list)', async () => {
      const res = await request(app.getHttpServer()).get(`/workspaces/${ws1Id}/buyers`).set('Authorization', `Bearer ${vendorToken1}`).expect(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].id).toBe(buyer1Id);
    });
    
    it('authorized Calls access (list via buyer)', async () => {
      const res = await request(app.getHttpServer()).get(`/workspaces/${ws1Id}/calls`).set('Authorization', `Bearer ${vendorToken1}`).expect(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].id).toBe(call1Id);
    });
  });

  describe('11. Vendor permission assignment denied', () => {
    it('cannot assign permissions', async () => {
      await request(app.getHttpServer()).put(`/workspaces/${ws1Id}/permissions/members/${vendorMember1Id}/call:read`)
        .set('Authorization', `Bearer ${vendorToken1}`)
        .send({ scopeType: 'ALL' })
        .expect(403);
    });
    it('cannot self-promote', async () => {
      await request(app.getHttpServer()).put(`/workspaces/${ws1Id}/members/${vendorMember1Id}/role`)
        .set('Authorization', `Bearer ${vendorToken1}`)
        .send({ role: 'ADMIN' })
        .expect(403);
    });
  });

  describe('12. Cross-workspace isolation', () => {
    it('cannot access Vendor B from Workspace B', async () => {
      // vendorToken1 is not a member of ws2Id
      await request(app.getHttpServer()).get(`/workspaces/${ws2Id}/vendors/${vendor2Id}`)
        .set('Authorization', `Bearer ${vendorToken1}`)
        .expect(403);
    });
    
    it('cannot access Calls in Workspace B', async () => {
      await request(app.getHttpServer()).get(`/workspaces/${ws2Id}/calls`)
        .set('Authorization', `Bearer ${vendorToken1}`)
        .expect(403);
    });
  });
});
