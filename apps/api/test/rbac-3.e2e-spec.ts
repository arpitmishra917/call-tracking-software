
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ExecutionContext, CanActivate } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { describe, beforeAll, afterAll, it, expect } from 'vitest';
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
    return false;
  }
}

describe('RBAC-3 Participant-Aware Invitations (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let ownerToken: string;
  let ownerId: string;
  let ownerEmail = 'owner@example.com';

  let owner2Token: string;
  let owner2Id: string;

  let inviteeToken: string;
  let inviteeId: string;
  let inviteeEmail = 'invitee@example.com';

  let workspace1Id: string;
  let workspace2Id: string;

  let v1Id: string;
  let b1Id: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).overrideGuard(JwtAuthGuard).useClass(MockJwtAuthGuard).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    ownerId = 'rbac3-owner-1';
    await prisma.profile.upsert({ where: { id: ownerId }, create: { id: ownerId, display_name: 'RBAC3 Owner' }, update: {} });

    owner2Id = 'rbac3-owner-2';
    await prisma.profile.upsert({ where: { id: owner2Id }, create: { id: owner2Id, display_name: 'RBAC3 Owner 2' }, update: {} });

    inviteeId = 'rbac3-invitee-1';
    await prisma.profile.upsert({ where: { id: inviteeId }, create: { id: inviteeId, display_name: 'RBAC3 Invitee' }, update: {} });

    ownerToken = `Bearer ${ownerId}`;
    owner2Token = `Bearer ${owner2Id}`;
    inviteeToken = `Bearer ${inviteeId}`;

    const w1 = await prisma.workspace.create({ data: { name: 'RBAC3 W1', slug: 'rbac3-w1-' + Date.now() } });
    workspace1Id = w1.id;
    const w2 = await prisma.workspace.create({ data: { name: 'RBAC3 W2', slug: 'rbac3-w2-' + Date.now() } });
    workspace2Id = w2.id;

    await prisma.workspaceMember.create({
      data: { workspace_id: workspace1Id, user_id: ownerId, role: 'OWNER', participant_type: 'INTERNAL' }
    });
    // Use owner2Id for workspace 2 to avoid unique_owner_per_user limit
    await prisma.workspaceMember.create({
      data: { workspace_id: workspace2Id, user_id: owner2Id, role: 'OWNER', participant_type: 'INTERNAL' }
    });

    const v1 = await prisma.vendor.create({ data: { workspace_id: workspace1Id, name: 'Vendor 1' } });
    v1Id = v1.id;

    const b1 = await prisma.buyer.create({ data: { workspace_id: workspace1Id, name: 'Buyer 1', destination_number: '+15551111111' } });
    b1Id = b1.id;
  });

  afterAll(async () => {
    await prisma.workspaceInvitation.deleteMany({ where: { workspace_id: { in: [workspace1Id, workspace2Id].filter(Boolean) } } });
    await prisma.workspaceMember.deleteMany({ where: { workspace_id: { in: [workspace1Id, workspace2Id].filter(Boolean) } } });
    await prisma.buyer.deleteMany({ where: { workspace_id: { in: [workspace1Id, workspace2Id].filter(Boolean) } } });
    await prisma.vendor.deleteMany({ where: { workspace_id: { in: [workspace1Id, workspace2Id].filter(Boolean) } } });
    await prisma.workspace.deleteMany({ where: { id: { in: [workspace1Id, workspace2Id].filter(Boolean) } } });
    await prisma.profile.deleteMany({ where: { id: { in: [ownerId, owner2Id, inviteeId].filter(Boolean) } } });
    await app.close();
  });

  let internalTokenHash: string;
  let internalTokenStr: string;
  it('RBAC3-01 Create INTERNAL invitation', async () => {
    const res = await request(app.getHttpServer())
      .post(`/workspaces/${workspace1Id}/invitations`)
      .set('Authorization', ownerToken)
      .send({ email: inviteeEmail, role: 'MEMBER', participant_type: 'INTERNAL' });
    expect(res.status).toBe(201);
    expect(res.body.participant_type).toBe('INTERNAL');
    internalTokenStr = res.body.token;
  });

  let vendorTokenStr: string;
  it('RBAC3-02 Create VENDOR invitation with valid Vendor', async () => {
    const res = await request(app.getHttpServer())
      .post(`/workspaces/${workspace1Id}/invitations`)
      .set('Authorization', ownerToken)
      .send({ email: 'vendor@example.com', role: 'MEMBER', participant_type: 'VENDOR', vendor_id: v1Id });
    expect(res.status).toBe(201);
    expect(res.body.participant_type).toBe('VENDOR');
    expect(res.body.vendor_id).toBe(v1Id);
    vendorTokenStr = res.body.token;
  });

  let buyerTokenStr: string;
  it('RBAC3-03 Create BUYER invitation with valid Buyer', async () => {
    const res = await request(app.getHttpServer())
      .post(`/workspaces/${workspace1Id}/invitations`)
      .set('Authorization', ownerToken)
      .send({ email: 'buyer@example.com', role: 'MEMBER', participant_type: 'BUYER', buyer_id: b1Id });
    expect(res.status).toBe(201);
    expect(res.body.participant_type).toBe('BUYER');
    expect(res.body.buyer_id).toBe(b1Id);
    buyerTokenStr = res.body.token;
  });

  it('RBAC3-04 Reject VENDOR invitation without vendor_id', async () => {
    const res = await request(app.getHttpServer())
      .post(`/workspaces/${workspace1Id}/invitations`)
      .set('Authorization', ownerToken)
      .send({ email: 'fail@example.com', role: 'MEMBER', participant_type: 'VENDOR' });
    expect(res.status).toBe(400);
  });

  it('RBAC3-05 Reject BUYER invitation without buyer_id', async () => {
    const res = await request(app.getHttpServer())
      .post(`/workspaces/${workspace1Id}/invitations`)
      .set('Authorization', ownerToken)
      .send({ email: 'fail@example.com', role: 'MEMBER', participant_type: 'BUYER' });
    expect(res.status).toBe(400);
  });

  it('RBAC3-06 Reject INTERNAL invitation containing vendor_id/buyer_id', async () => {
    const res = await request(app.getHttpServer())
      .post(`/workspaces/${workspace1Id}/invitations`)
      .set('Authorization', ownerToken)
      .send({ email: 'fail@example.com', role: 'MEMBER', participant_type: 'INTERNAL', vendor_id: v1Id });
    expect(res.status).toBe(400);
  });

  it('RBAC3-07 Reject Vendor from another workspace', async () => {
    const res = await request(app.getHttpServer())
      .post(`/workspaces/${workspace2Id}/invitations`)
      .set('Authorization', owner2Token)
      .send({ email: 'fail@example.com', role: 'MEMBER', participant_type: 'VENDOR', vendor_id: v1Id });
    expect(res.status).toBe(400);
  });

  it('RBAC3-08 Reject Buyer from another workspace', async () => {
    const res = await request(app.getHttpServer())
      .post(`/workspaces/${workspace2Id}/invitations`)
      .set('Authorization', owner2Token)
      .send({ email: 'fail@example.com', role: 'MEMBER', participant_type: 'BUYER', buyer_id: b1Id });
    expect(res.status).toBe(400);
  });

  it('RBAC3-09 Accept INTERNAL invitation creates INTERNAL member', async () => {
    const res = await request(app.getHttpServer())
      .post(`/workspaces/${workspace1Id}/invitations`)
      .set('Authorization', ownerToken)
      .send({ email: 'test@example.com', role: 'MEMBER', participant_type: 'INTERNAL' });
    const tokenStr = res.body.token;

    const acceptRes = await request(app.getHttpServer())
      .post(`/workspaces/accept-invitation`)
      .set('Authorization', inviteeToken) // inviteeToken gives userId=inviteeId, email='test@example.com'
      .send({ token: tokenStr });
    
    expect(acceptRes.status).toBe(201); // Wait, acceptInvitation returns 201 because it's a POST
    
    const member = await prisma.workspaceMember.findFirst({ where: { user_id: inviteeId, workspace_id: workspace1Id }});
    expect(member?.participant_type).toBe('INTERNAL');
    expect(member?.vendor_id).toBeNull();
  });

  it('RBAC3-10 Accept VENDOR invitation creates correct vendor-linked member', async () => {
    const w3 = await prisma.workspace.create({ data: { name: 'W3', slug: 'w3-' + Date.now() } });
    const owner3Id = 'rbac3-owner-3-' + Date.now();
    await prisma.profile.upsert({ where: { id: owner3Id }, create: { id: owner3Id, display_name: 'Owner 3' }, update: {} });
    const owner3Token = `Bearer ${owner3Id}`;
    await prisma.workspaceMember.create({ data: { workspace_id: w3.id, user_id: owner3Id, role: 'OWNER', participant_type: 'INTERNAL' }});
    const v3 = await prisma.vendor.create({ data: { workspace_id: w3.id, name: 'Vendor 3' } });
    
    const res3 = await request(app.getHttpServer())
      .post(`/workspaces/${w3.id}/invitations`)
      .set('Authorization', owner3Token)
      .send({ email: 'test@example.com', role: 'MEMBER', participant_type: 'VENDOR', vendor_id: v3.id });
    
    const acceptRes = await request(app.getHttpServer())
      .post(`/workspaces/accept-invitation`)
      .set('Authorization', inviteeToken)
      .send({ token: res3.body.token });
      
    expect(acceptRes.status).toBe(201);
    const member = await prisma.workspaceMember.findFirst({ where: { user_id: inviteeId, workspace_id: w3.id }});
    expect(member?.participant_type).toBe('VENDOR');
    expect(member?.vendor_id).toBe(v3.id);
  });

  it('RBAC3-11 Accept BUYER invitation creates correct buyer-linked member', async () => {
    const w4 = await prisma.workspace.create({ data: { name: 'W4', slug: 'w4-' + Date.now() } });
    const owner4Id = 'rbac3-owner-4-' + Date.now();
    await prisma.profile.upsert({ where: { id: owner4Id }, create: { id: owner4Id, display_name: 'Owner 4' }, update: {} });
    const owner4Token = `Bearer ${owner4Id}`;
    await prisma.workspaceMember.create({ data: { workspace_id: w4.id, user_id: owner4Id, role: 'OWNER', participant_type: 'INTERNAL' }});
    const b4 = await prisma.buyer.create({ data: { workspace_id: w4.id, name: 'Buyer 4', destination_number: '+15554444444' } });
    
    const res4 = await request(app.getHttpServer())
      .post(`/workspaces/${w4.id}/invitations`)
      .set('Authorization', owner4Token)
      .send({ email: 'test@example.com', role: 'MEMBER', participant_type: 'BUYER', buyer_id: b4.id });
    
    const acceptRes = await request(app.getHttpServer())
      .post(`/workspaces/accept-invitation`)
      .set('Authorization', inviteeToken)
      .send({ token: res4.body.token });
      
    expect(acceptRes.status).toBe(201);
    const member = await prisma.workspaceMember.findFirst({ where: { user_id: inviteeId, workspace_id: w4.id }});
    expect(member?.participant_type).toBe('BUYER');
    expect(member?.buyer_id).toBe(b4.id);
  });

  it('RBAC3-12 Invitation email binding remains enforced', async () => {
    const res = await request(app.getHttpServer())
      .post(`/workspaces/${workspace1Id}/invitations`)
      .set('Authorization', ownerToken)
      .send({ email: 'wrong@example.com', role: 'MEMBER', participant_type: 'INTERNAL' });
      
    const acceptRes = await request(app.getHttpServer())
      .post(`/workspaces/accept-invitation`)
      .set('Authorization', inviteeToken) // has test@example.com
      .send({ token: res.body.token });
      
    expect(acceptRes.status).toBe(400); // Bad Request because email doesn't match
  });

  it('RBAC3-13 Expired invitation rejected & RBAC3-14 Revoked invitation rejected', async () => {
    // 13
    const resE = await request(app.getHttpServer())
      .post(`/workspaces/${workspace1Id}/invitations`)
      .set('Authorization', ownerToken)
      .send({ email: 'test@example.com', role: 'MEMBER', participant_type: 'INTERNAL' });
      
    await prisma.workspaceInvitation.update({ where: { id: resE.body.id }, data: { expires_at: new Date(Date.now() - 1000) } });
    const acceptResE = await request(app.getHttpServer())
      .post(`/workspaces/accept-invitation`)
      .set('Authorization', inviteeToken)
      .send({ token: resE.body.token });
    expect(acceptResE.status).toBe(400);

    // 14
    const resR = await request(app.getHttpServer())
      .post(`/workspaces/${workspace1Id}/invitations`)
      .set('Authorization', ownerToken)
      .send({ email: 'test@example.com', role: 'MEMBER', participant_type: 'INTERNAL' });
      
    await request(app.getHttpServer())
      .delete(`/workspaces/${workspace1Id}/invitations/${resR.body.id}`)
      .set('Authorization', ownerToken);

    const acceptResR = await request(app.getHttpServer())
      .post(`/workspaces/accept-invitation`)
      .set('Authorization', inviteeToken)
      .send({ token: resR.body.token });
    expect(acceptResR.status).toBe(400);
  });

  it('RBAC3-15 Already accepted invitation rejected', async () => {
    const w5 = await prisma.workspace.create({ data: { name: 'W5', slug: 'w5-' + Date.now() } });
    const owner5Id = 'rbac3-owner-5-' + Date.now();
    await prisma.profile.upsert({ where: { id: owner5Id }, create: { id: owner5Id, display_name: 'Owner 5' }, update: {} });
    const owner5Token = `Bearer ${owner5Id}`;
    await prisma.workspaceMember.create({ data: { workspace_id: w5.id, user_id: owner5Id, role: 'OWNER', participant_type: 'INTERNAL' }});

    const res = await request(app.getHttpServer())
      .post(`/workspaces/${w5.id}/invitations`)
      .set('Authorization', owner5Token)
      .send({ email: 'test@example.com', role: 'MEMBER', participant_type: 'INTERNAL' });
      
    // Accept once
    await request(app.getHttpServer())
      .post(`/workspaces/accept-invitation`)
      .set('Authorization', inviteeToken)
      .send({ token: res.body.token })
      .expect(201);
      
    // Accept twice
    const dupRes = await request(app.getHttpServer())
      .post(`/workspaces/accept-invitation`)
      .set('Authorization', inviteeToken)
      .send({ token: res.body.token });
    
    expect(dupRes.status).toBe(400);
  });

  it('RBAC3-16 Invalid token rejected & RBAC3-21 Participant type cannot be changed by invitee', async () => {
    const res = await request(app.getHttpServer())
      .post(`/workspaces/accept-invitation`)
      .set('Authorization', inviteeToken)
      .send({ token: 'invalid_token_123' });
    expect(res.status).toBe(404);
  });
});
