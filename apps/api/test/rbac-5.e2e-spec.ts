import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PermissionsService } from '../src/permissions/permissions.service.js';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard.js';

describe('RBAC-5 Resource Scope (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let permissionsService: PermissionsService;

  let ownerUser: any; let ownerToken: string;
  let adminUser: any; let adminToken: string;
  let memberUser: any; let memberToken: string;

  let w1Id: string; let w1OwnerId: string; let w1AdminId: string; let w1MemberId: string;
  let w1Campaign1Id: string; let w1Campaign2Id: string;
  let w1PhoneNumber1Id: string; let w1PhoneNumber2Id: string;
  let w1Buyer1Id: string; let w1Buyer2Id: string;
  let w1Vendor1Id: string; let w1Vendor2Id: string;

  let w2Id: string; let w2CampaignId: string; let w2BuyerId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          const req = context.switchToHttp().getRequest();
          const token = req.headers.authorization;
          if (token) {
            req.user = { userId: token.split(' ')[1] };
            return true;
          }
          return false;
        }
      })
      .compile();
      
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();

    prisma = app.get(PrismaService);
    permissionsService = app.get(PermissionsService);

    const ts = Date.now();
    const mockOwnerId = `owner-r5-${ts}`;
    const mockAdminId = `admin-r5-${ts}`;
    const mockMemberId = `member-r5-${ts}`;

    ownerUser = { id: mockOwnerId };
    adminUser = { id: mockAdminId };
    memberUser = { id: mockMemberId };

    await prisma.profile.create({ data: { id: mockOwnerId, display_name: 'O' } });
    await prisma.profile.create({ data: { id: mockAdminId, display_name: 'A' } });
    await prisma.profile.create({ data: { id: mockMemberId, display_name: 'M' } });

    ownerToken = `Bearer ${mockOwnerId}`;
    adminToken = `Bearer ${mockAdminId}`;
    memberToken = `Bearer ${mockMemberId}`;

    const w1 = await prisma.workspace.create({ data: { name: `W1-${ts}`, slug: `w1-${ts}` } }); w1Id = w1.id;
    w1OwnerId = (await prisma.workspaceMember.create({ data: { workspace_id: w1Id, user_id: ownerUser.id, role: 'OWNER' } })).id;
    w1AdminId = (await prisma.workspaceMember.create({ data: { workspace_id: w1Id, user_id: adminUser.id, role: 'ADMIN' } })).id;
    w1MemberId = (await prisma.workspaceMember.create({ data: { workspace_id: w1Id, user_id: memberUser.id, role: 'MEMBER' } })).id;

    w1Campaign1Id = (await prisma.campaign.create({ data: { workspace_id: w1Id, name: 'C1' } })).id;
    w1Campaign2Id = (await prisma.campaign.create({ data: { workspace_id: w1Id, name: 'C2' } })).id;
    w1Buyer1Id = (await prisma.buyer.create({ data: { workspace_id: w1Id, name: 'B1', destination_number: '+15550000001' } })).id;
    w1Buyer2Id = (await prisma.buyer.create({ data: { workspace_id: w1Id, name: 'B2', destination_number: '+15550000002' } })).id;
    w1Vendor1Id = (await prisma.vendor.create({ data: { workspace_id: w1Id, name: 'V1' } })).id;
    w1Vendor2Id = (await prisma.vendor.create({ data: { workspace_id: w1Id, name: 'V2' } })).id;
    w1PhoneNumber1Id = (await prisma.phoneNumber.create({ data: { workspace_id: w1Id, phone_number: `+1555${ts}1`, provider: 'test', provider_number_id: 'test' } })).id;
    w1PhoneNumber2Id = (await prisma.phoneNumber.create({ data: { workspace_id: w1Id, phone_number: `+1555${ts}2`, provider: 'test', provider_number_id: 'test' } })).id;

    await prisma.campaignBuyer.create({ data: { workspace_id: w1Id, campaign_id: w1Campaign1Id, buyer_id: w1Buyer1Id, priority: 1 } });

    const w2 = await prisma.workspace.create({ data: { name: `W2-${ts}`, slug: `w2-${ts}` } }); w2Id = w2.id;
    w2CampaignId = (await prisma.campaign.create({ data: { workspace_id: w2Id, name: 'C2W' } })).id;
    w2BuyerId = (await prisma.buyer.create({ data: { workspace_id: w2Id, name: 'B2W', destination_number: '+15550000003' } })).id;
  });

  afterAll(async () => { await app.close(); });

  it('1. OWNER access', async () => {
    expect(await permissionsService.hasResourceScope(w1Id, ownerUser.id, 'campaign:update', w1Campaign1Id)).toBe(true);
  });

  it('2. ADMIN baseline access', async () => {
    expect(await permissionsService.hasResourceScope(w1Id, adminUser.id, 'campaign:update', w1Campaign1Id)).toBe(true);
  });

  it('3. MEMBER without permission denied', async () => {
    expect(await permissionsService.hasResourceScope(w1Id, memberUser.id, 'campaign:update', w1Campaign1Id)).toBe(false);
  });

  it('4. MEMBER with ALL scope allowed', async () => {
    await request(app.getHttpServer()).put(`/workspaces/${w1Id}/permissions/members/${w1MemberId}/campaign:update`).set('Authorization', ownerToken).send({ scopeType: 'ALL' }).expect(200);
    expect(await permissionsService.hasResourceScope(w1Id, memberUser.id, 'campaign:update', w1Campaign1Id)).toBe(true);
    expect(await permissionsService.hasResourceScope(w1Id, memberUser.id, 'campaign:update', w1Campaign2Id)).toBe(true);
    await request(app.getHttpServer()).delete(`/workspaces/${w1Id}/permissions/members/${w1MemberId}/campaign:update`).set('Authorization', ownerToken).query({ scopeType: 'ALL' }).expect(200);
  });

  it('5. MEMBER with CAMPAIGN scope allowed for matching campaign', async () => {
    await request(app.getHttpServer()).put(`/workspaces/${w1Id}/permissions/members/${w1MemberId}/campaign:update`).set('Authorization', ownerToken).send({ scopeType: 'CAMPAIGN', resourceId: w1Campaign1Id }).expect(200);
    expect(await permissionsService.hasResourceScope(w1Id, memberUser.id, 'campaign:update', w1Campaign1Id)).toBe(true);
  });

  it('6. MEMBER with CAMPAIGN scope denied for different campaign', async () => {
    expect(await permissionsService.hasResourceScope(w1Id, memberUser.id, 'campaign:update', w1Campaign2Id)).toBe(false);
  });

  it('7. MEMBER with PHONE_NUMBER scope allowed for matching number', async () => {
    await request(app.getHttpServer()).put(`/workspaces/${w1Id}/permissions/members/${w1MemberId}/phone_number:manage`).set('Authorization', ownerToken).send({ scopeType: 'PHONE_NUMBER', resourceId: w1PhoneNumber1Id }).expect(200);
    expect(await permissionsService.hasResourceScope(w1Id, memberUser.id, 'phone_number:manage', w1PhoneNumber1Id)).toBe(true);
  });

  it('8. MEMBER with PHONE_NUMBER scope denied for different number', async () => {
    expect(await permissionsService.hasResourceScope(w1Id, memberUser.id, 'phone_number:manage', w1PhoneNumber2Id)).toBe(false);
  });

  it('9. MEMBER with BUYER scope allowed for matching buyer', async () => {
    await request(app.getHttpServer()).put(`/workspaces/${w1Id}/permissions/members/${w1MemberId}/buyer:update`).set('Authorization', ownerToken).send({ scopeType: 'BUYER', resourceId: w1Buyer1Id }).expect(200);
    expect(await permissionsService.hasResourceScope(w1Id, memberUser.id, 'buyer:update', w1Buyer1Id)).toBe(true);
  });

  it('10. MEMBER with BUYER scope denied for different buyer', async () => {
    expect(await permissionsService.hasResourceScope(w1Id, memberUser.id, 'buyer:update', w1Buyer2Id)).toBe(false);
  });

  it('11. MEMBER with VENDOR scope allowed for matching vendor', async () => {
    await request(app.getHttpServer()).put(`/workspaces/${w1Id}/permissions/members/${w1MemberId}/vendor:update`).set('Authorization', ownerToken).send({ scopeType: 'VENDOR', resourceId: w1Vendor1Id }).expect(200);
    expect(await permissionsService.hasResourceScope(w1Id, memberUser.id, 'vendor:update', w1Vendor1Id)).toBe(true);
  });

  it('12. MEMBER with VENDOR scope denied for different vendor', async () => {
    expect(await permissionsService.hasResourceScope(w1Id, memberUser.id, 'vendor:update', w1Vendor2Id)).toBe(false);
  });

  it('13. ASSIGNED semantics verified against the real existing assignment relationship', async () => {
    await prisma.workspaceMember.update({ where: { id: w1MemberId }, data: { buyer_id: w1Buyer1Id } });
    await request(app.getHttpServer()).put(`/workspaces/${w1Id}/permissions/members/${w1MemberId}/campaign:read`).set('Authorization', ownerToken).send({ scopeType: 'ASSIGNED' }).expect(200);
    
    expect(await permissionsService.hasResourceScope(w1Id, memberUser.id, 'campaign:read', w1Campaign1Id)).toBe(true);
    expect(await permissionsService.hasResourceScope(w1Id, memberUser.id, 'campaign:read', w1Campaign2Id)).toBe(false);

    await prisma.workspaceMember.update({ where: { id: w1MemberId }, data: { buyer_id: null, vendor_id: w1Vendor1Id } });
    await request(app.getHttpServer()).put(`/workspaces/${w1Id}/permissions/members/${w1MemberId}/vendor:read`).set('Authorization', ownerToken).send({ scopeType: 'ASSIGNED' }).expect(200);
    expect(await permissionsService.hasResourceScope(w1Id, memberUser.id, 'vendor:read', w1Vendor1Id)).toBe(true);
    expect(await permissionsService.hasResourceScope(w1Id, memberUser.id, 'vendor:read', w1Vendor2Id)).toBe(false);
  });

  it('14. cross-workspace resource rejected', async () => {
    const res = await request(app.getHttpServer()).put(`/workspaces/${w1Id}/permissions/members/${w1MemberId}/campaign:update`).set('Authorization', ownerToken).send({ scopeType: 'CAMPAIGN', resourceId: w2CampaignId });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Invalid or cross-workspace resource ID');
  });

  it('15. invalid resource ID rejected', async () => {
    const res = await request(app.getHttpServer()).put(`/workspaces/${w1Id}/permissions/members/${w1MemberId}/campaign:update`).set('Authorization', ownerToken).send({ scopeType: 'CAMPAIGN', resourceId: '123e4567-e89b-12d3-a456-426614174000' });
    expect(res.status).toBe(400);
  });

  it('16. invalid scope/resource combination rejected', async () => {
    let res = await request(app.getHttpServer()).put(`/workspaces/${w1Id}/permissions/members/${w1MemberId}/campaign:update`).set('Authorization', ownerToken).send({ scopeType: 'ALL', resourceId: w1Campaign1Id });
    expect(res.status).toBe(400);

    res = await request(app.getHttpServer()).put(`/workspaces/${w1Id}/permissions/members/${w1MemberId}/campaign:update`).set('Authorization', ownerToken).send({ scopeType: 'CAMPAIGN' });
    expect(res.status).toBe(400);
  });

  it('17. duplicate scoped assignment rejected', async () => {
    const res = await request(app.getHttpServer()).put(`/workspaces/${w1Id}/permissions/members/${w1MemberId}/buyer:update`).set('Authorization', ownerToken).send({ scopeType: 'BUYER', resourceId: w1Buyer1Id });
    expect(res.status).toBe(400);
  });

  it('18. participant type does not itself grant permission', async () => {
    expect(await permissionsService.hasResourceScope(w1Id, memberUser.id, 'vendor:archive', w1Vendor1Id)).toBe(false);
  });

  it('19. RBAC-4 permission vocabulary remains authoritative', async () => {
    const res = await request(app.getHttpServer()).put(`/workspaces/${w1Id}/permissions/members/${w1MemberId}/unknown:perm`).set('Authorization', ownerToken).send({ scopeType: 'ALL' });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Unknown permission key');
  });

  it('20. RBAC-4 self-promotion/assignment hardening remains intact', async () => {
    const res = await request(app.getHttpServer()).put(`/workspaces/${w1Id}/permissions/members/${w1MemberId}/workspace:update`).set('Authorization', memberToken).send({ scopeType: 'ALL' });
    expect(res.status).toBe(403);
    
    const res2 = await request(app.getHttpServer()).put(`/workspaces/${w1Id}/permissions/members/${w1OwnerId}/workspace:update`).set('Authorization', ownerToken).send({ scopeType: 'ALL' });
    expect(res2.status).toBe(403);
  });

});
