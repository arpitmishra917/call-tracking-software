import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { isCallAuthorizedForVendor, buildVendorCallWhere } from './call-authorization.util.js';
import { CallsService } from './calls.service.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { AuditLogsService } from '../audit-logs/audit-logs.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsageService } from '../usage/usage.service.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { maskCallerPhoneNumber } from '../reports/reports.service.js';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CallState, CallAttemptState } from '@prisma/client';

describe('Phase 2 Slice 3: Vendor Call Authorization, Privacy & Scoping', () => {
  const WORKSPACE_A = 'ws_aaa_111';
  const WORKSPACE_B = 'ws_bbb_222';
  const VENDOR_1 = 'vnd_primary_111';
  const VENDOR_2 = 'vnd_secondary_222';
  const BUYER_1 = 'byr_alpha_111';

  describe('Core Attribution Authorization Predicate (isCallAuthorizedForVendor & buildVendorCallWhere)', () => {
    it('1. Matching INGRESS_ASSIGNED Vendor can access the call', () => {
      const call = {
        workspace_id: WORKSPACE_A,
        attributed_vendor_id: VENDOR_1,
        attribution_source: 'INGRESS_ASSIGNED',
        commercial: null,
      };
      expect(isCallAuthorizedForVendor(call, WORKSPACE_A, VENDOR_1)).toBe(true);
    });

    it('2. Different Vendor cannot access the call', () => {
      const call = {
        workspace_id: WORKSPACE_A,
        attributed_vendor_id: VENDOR_1,
        attribution_source: 'INGRESS_ASSIGNED',
        commercial: null,
      };
      expect(isCallAuthorizedForVendor(call, WORKSPACE_A, VENDOR_2)).toBe(false);
    });

    it('3. A conflicting Call.vendor_id cannot override attributed_vendor_id', () => {
      // attributed_vendor_id is VENDOR_1, but relational vendor_id is VENDOR_2
      const call = {
        workspace_id: WORKSPACE_A,
        vendor_id: VENDOR_2,
        attributed_vendor_id: VENDOR_1,
        attribution_source: 'INGRESS_ASSIGNED',
        commercial: null,
      };
      // VENDOR_1 is authorized because attributed_vendor_id is authoritative
      expect(isCallAuthorizedForVendor(call, WORKSPACE_A, VENDOR_1)).toBe(true);
      // VENDOR_2 is denied despite relational vendor_id matching
      expect(isCallAuthorizedForVendor(call, WORKSPACE_A, VENDOR_2)).toBe(false);
    });

    it('4. Null immutable attribution snapshot does not grant access through the relational Vendor ID', () => {
      const call = {
        workspace_id: WORKSPACE_A,
        vendor_id: VENDOR_1,
        attributed_vendor_id: null,
        attribution_source: 'INGRESS_ASSIGNED',
        commercial: null,
      };
      expect(isCallAuthorizedForVendor(call, WORKSPACE_A, VENDOR_1)).toBe(false);
    });

    it('5. INGRESS_UNASSIGNED denies access even if a commercial row or current number assignment appears to match', () => {
      const call = {
        workspace_id: WORKSPACE_A,
        attributed_vendor_id: null,
        attribution_source: 'INGRESS_UNASSIGNED',
        commercial: { vendor_id: VENDOR_1 }, // unrelated commercial record
      };
      expect(isCallAuthorizedForVendor(call, WORKSPACE_A, VENDOR_1)).toBe(false);
    });

    it('6. LEGACY_COMMERCIAL allows only the matching historical commercial Vendor', () => {
      const call = {
        workspace_id: WORKSPACE_A,
        attributed_vendor_id: null,
        attribution_source: 'LEGACY_COMMERCIAL',
        commercial: { vendor_id: VENDOR_1 },
      };
      expect(isCallAuthorizedForVendor(call, WORKSPACE_A, VENDOR_1)).toBe(true);
      expect(isCallAuthorizedForVendor(call, WORKSPACE_A, VENDOR_2)).toBe(false);
    });

    it('7. LEGACY_UNATTRIBUTED, UNRESOLVED, null, and unexpected attribution sources fail closed', () => {
      const testCases = [
        { attribution_source: 'LEGACY_UNATTRIBUTED', commercial: { vendor_id: VENDOR_1 } },
        { attribution_source: 'UNRESOLVED', commercial: { vendor_id: VENDOR_1 } },
        { attribution_source: null, commercial: { vendor_id: VENDOR_1 } },
        { attribution_source: undefined, commercial: { vendor_id: VENDOR_1 } },
        { attribution_source: 'RANDOM_UNEXPECTED', commercial: { vendor_id: VENDOR_1 } },
      ];

      for (const tc of testCases) {
        const call = {
          workspace_id: WORKSPACE_A,
          attributed_vendor_id: VENDOR_1,
          attribution_source: tc.attribution_source,
          commercial: tc.commercial,
        };
        expect(isCallAuthorizedForVendor(call, WORKSPACE_A, VENDOR_1)).toBe(false);
      }
    });

    it('8. Cross-workspace calls are denied immediately', () => {
      const call = {
        workspace_id: WORKSPACE_B,
        attributed_vendor_id: VENDOR_1,
        attribution_source: 'INGRESS_ASSIGNED',
      };
      expect(isCallAuthorizedForVendor(call, WORKSPACE_A, VENDOR_1)).toBe(false);
    });

    it('buildVendorCallWhere generates exact fail-closed SQL/Prisma predicate', () => {
      const where = buildVendorCallWhere(WORKSPACE_A, VENDOR_1);
      expect(where.workspace_id).toBe(WORKSPACE_A);
      expect(where.OR).toEqual([
        {
          attribution_source: 'INGRESS_ASSIGNED',
          attributed_vendor_id: VENDOR_1,
        },
        {
          attribution_source: 'LEGACY_COMMERCIAL',
          commercial: { vendor_id: VENDOR_1 },
        },
      ]);
    });
  });

  describe('CallsService Vendor Integration & API Privacy', () => {
    let service: CallsService;
    let prisma: any;
    let permissionsService: any;

    beforeEach(async () => {
      prisma = {
        $transaction: vi.fn((cb) => cb(prisma)),
        $queryRaw: vi.fn(),
        workspaceMember: {
          findUnique: vi.fn(),
        },
        call: {
          findUnique: vi.fn(),
          findMany: vi.fn(),
          count: vi.fn(),
          create: vi.fn(),
          update: vi.fn(),
        },
      };

      permissionsService = {
        getPermissionsForUser: vi.fn().mockResolvedValue([
          { key: 'call:read', scope_type: 'ALL' },
        ]),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          CallsService,
          { provide: PrismaService, useValue: prisma },
          { provide: PermissionsService, useValue: permissionsService },
          { provide: UsageService, useValue: { recordUsage: vi.fn() } },
          { provide: WebhooksService, useValue: { queueEvent: vi.fn() } },
        ],
      }).compile();

      service = module.get<CallsService>(CallsService);
    });

    it('9. List and detail endpoints use consistent authorization', async () => {
      // Mock authenticated user as VENDOR_1 member
      prisma.workspaceMember.findUnique.mockResolvedValue({
        id: 'mem_1',
        workspace_id: WORKSPACE_A,
        user_id: 'usr_v1',
        role: 'MEMBER',
        participant_type: 'VENDOR',
        vendor_id: VENDOR_1,
      });

      // GET LIST: verify Prisma query filters by buildVendorCallWhere
      prisma.call.findMany.mockResolvedValue([]);
      prisma.call.count.mockResolvedValue(0);

      await service.getCalls(WORKSPACE_A, 'usr_v1', {});

      expect(prisma.call.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            workspace_id: WORKSPACE_A,
            OR: [
              {
                attribution_source: 'INGRESS_ASSIGNED',
                attributed_vendor_id: VENDOR_1,
              },
              {
                attribution_source: 'LEGACY_COMMERCIAL',
                commercial: { vendor_id: VENDOR_1 },
              },
            ],
          }),
        }),
      );

      // GET DETAIL: Authorized call
      prisma.call.findUnique.mockResolvedValue({
        id: 'call_1',
        workspace_id: WORKSPACE_A,
        attributed_vendor_id: VENDOR_1,
        attribution_source: 'INGRESS_ASSIGNED',
        from_number: '+15551234567',
        to_number: '+15559990000',
        commercial: null,
        attempts: [],
        recordings: [],
      });

      const detail = await service.getCallDetail(WORKSPACE_A, 'call_1', 'usr_v1');
      expect(detail.id).toBe('call_1');

      // GET DETAIL: Unauthorized call (attributed to VENDOR_2)
      prisma.call.findUnique.mockResolvedValue({
        id: 'call_2',
        workspace_id: WORKSPACE_A,
        attributed_vendor_id: VENDOR_2,
        attribution_source: 'INGRESS_ASSIGNED',
        commercial: null,
      });

      await expect(
        service.getCallDetail(WORKSPACE_A, 'call_2', 'usr_v1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('12. Vendor response payloads mask ANI and exclude Buyer identity and financial margins', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        id: 'mem_1',
        workspace_id: WORKSPACE_A,
        user_id: 'usr_v1',
        role: 'MEMBER',
        participant_type: 'VENDOR',
        vendor_id: VENDOR_1,
      });

      const rawCall = {
        id: 'call_priv_1',
        workspace_id: WORKSPACE_A,
        attributed_vendor_id: VENDOR_1,
        attribution_source: 'INGRESS_ASSIGNED',
        from_number: '+15551234567',
        to_number: '+15559876543',
        state: CallState.COMPLETED,
        attempts: [
          {
            id: 'att_1',
            buyer_id: BUYER_1,
            buyer: { id: BUYER_1, name: 'Secret Buyer Inc' },
            state: CallAttemptState.COMPLETED,
          },
        ],
        commercial: {
          id: 'comm_1',
          revenue: 15.0,
          payout: 7.5,
          cost: 1.2,
          profit: 6.3,
          currency: 'USD',
          buyer: { id: BUYER_1, name: 'Secret Buyer Inc' },
          vendor: { id: VENDOR_1, name: 'Vendor 1' },
          status: 'EVALUATED',
          qualified: true,
          converted: true,
          duplicate: false,
        },
      };

      prisma.call.findUnique.mockResolvedValue(rawCall);

      const detail = await service.getCallDetail(WORKSPACE_A, 'call_priv_1', 'usr_v1');

      // 1. Caller ANI is masked
      expect(detail.from_number).toBe('+1555***4567');

      // 2. Buyer identity is stripped from attempts
      expect(detail.attempts[0]).not.toHaveProperty('buyer');
      expect(detail.attempts[0]).not.toHaveProperty('buyer_id');

      // 3. Buyer financial margins are stripped from commercial
      expect(detail.commercial).not.toHaveProperty('revenue');
      expect(detail.commercial).not.toHaveProperty('profit');
      expect(detail.commercial).not.toHaveProperty('cost');
      expect(detail.commercial).not.toHaveProperty('buyer');

      // 4. Allowed Vendor fields are preserved
      expect(detail.commercial.payout).toBe(7.5);
      expect(detail.commercial.currency).toBe('USD');
      expect(detail.commercial.vendor.id).toBe(VENDOR_1);
    });

    it('14. Admin and Buyer access behavior remains intact', async () => {
      // Admin caller
      prisma.workspaceMember.findUnique.mockResolvedValue({
        id: 'mem_admin',
        workspace_id: WORKSPACE_A,
        user_id: 'usr_admin',
        role: 'ADMIN',
        participant_type: null,
      });

      const rawCall = {
        id: 'call_admin_1',
        workspace_id: WORKSPACE_A,
        attributed_vendor_id: VENDOR_1,
        attribution_source: 'INGRESS_ASSIGNED',
        from_number: '+15551234567',
        to_number: '+15559876543',
        commercial: {
          id: 'comm_1',
          revenue: 20.0,
          payout: 10.0,
          profit: 10.0,
        },
        attempts: [],
      };

      prisma.call.findUnique.mockResolvedValue(rawCall);

      const adminDetail = await service.getCallDetail(WORKSPACE_A, 'call_admin_1', 'usr_admin');
      // Admin sees unmasked ANI and full commercial object
      expect(adminDetail.from_number).toBe('+15551234567');
      expect(adminDetail.commercial.revenue).toBe(20.0);
    });

    it('15. Vendor getCalls fails closed if filtering by another vendorId', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        id: 'mem_1',
        workspace_id: WORKSPACE_A,
        user_id: 'usr_v1',
        role: 'MEMBER',
        participant_type: 'VENDOR',
        vendor_id: VENDOR_1,
      });

      const result = await service.getCalls(WORKSPACE_A, 'usr_v1', { vendorId: VENDOR_2 });
      expect(result).toEqual({ items: [], total: 0 });
      expect(prisma.call.findMany).not.toHaveBeenCalled();
    });

    it('16. Vendor getMetrics fails closed if filtering by another vendorId', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        id: 'mem_1',
        workspace_id: WORKSPACE_A,
        user_id: 'usr_v1',
        role: 'MEMBER',
        participant_type: 'VENDOR',
        vendor_id: VENDOR_1,
      });

      const metrics = await service.getMetrics(WORKSPACE_A, 'usr_v1', { vendorId: VENDOR_2 });
      expect(metrics.total).toBe(0);
      expect(metrics.answered).toBe(0);
      expect(metrics.payout).toBe(0);
      expect(metrics.revenue).toBeUndefined();
    });
  });

  describe('PermissionsService Integration (hasResourceScope)', () => {
    let permissionsService: PermissionsService;
    let prisma: any;

    beforeEach(async () => {
      prisma = {
        workspaceMember: {
          findUnique: vi.fn(),
        },
        call: {
          findUnique: vi.fn(),
        },
        recording: {
          findUnique: vi.fn(),
        },
        permission: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PermissionsService,
          { provide: PrismaService, useValue: prisma },
          { provide: AuditLogsService, useValue: { log: vi.fn() } },
        ],
      }).compile();

      permissionsService = module.get<PermissionsService>(PermissionsService);
    });

    it('13. Recording and call access applies unified Vendor attribution and denies unauthorized access', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        id: 'mem_v1',
        workspace_id: WORKSPACE_A,
        user_id: 'usr_v1',
        role: 'MEMBER',
        participant_type: 'VENDOR',
        vendor_id: VENDOR_1,
      });

      // Call permission: matching attribution
      prisma.call.findUnique.mockResolvedValue({
        id: 'call_1',
        workspace_id: WORKSPACE_A,
        attributed_vendor_id: VENDOR_1,
        attribution_source: 'INGRESS_ASSIGNED',
      });
      const hasCallRead = await permissionsService.hasResourceScope(
        WORKSPACE_A,
        'usr_v1',
        'call:read',
        'call_1',
      );
      expect(hasCallRead).toBe(true);

      // Call permission: mismatched attribution
      prisma.call.findUnique.mockResolvedValue({
        id: 'call_2',
        workspace_id: WORKSPACE_A,
        attributed_vendor_id: VENDOR_2,
        attribution_source: 'INGRESS_ASSIGNED',
      });
      const hasCallReadMismatch = await permissionsService.hasResourceScope(
        WORKSPACE_A,
        'usr_v1',
        'call:read',
        'call_2',
      );
      expect(hasCallReadMismatch).toBe(false);

      // Recording permission: matching call attribution
      prisma.recording.findUnique.mockResolvedValue({
        id: 'rec_1',
        workspace_id: WORKSPACE_A,
        call: {
          id: 'call_1',
          workspace_id: WORKSPACE_A,
          attributed_vendor_id: VENDOR_1,
          attribution_source: 'INGRESS_ASSIGNED',
        },
      });
      const hasRecRead = await permissionsService.hasResourceScope(
        WORKSPACE_A,
        'usr_v1',
        'call:recording_read',
        'rec_1',
      );
      expect(hasRecRead).toBe(true);

      // Recording permission: cross-workspace call
      prisma.recording.findUnique.mockResolvedValue({
        id: 'rec_2',
        workspace_id: WORKSPACE_B,
        call: {
          id: 'call_cross',
          workspace_id: WORKSPACE_B,
          attributed_vendor_id: VENDOR_1,
          attribution_source: 'INGRESS_ASSIGNED',
        },
      });
      const hasRecReadCross = await permissionsService.hasResourceScope(
        WORKSPACE_A,
        'usr_v1',
        'call:recording_read',
        'rec_2',
      );
      expect(hasRecReadCross).toBe(false);
    });
  });

  describe('Recordings Controllers Vendor Attribution Enforcement', () => {
    it('RecordingsController.getRecordingUrl allows matching INGRESS_ASSIGNED vendor and denies mismatched vendor', async () => {
      const mockPrisma: any = {
        recording: {
          findUnique: vi.fn(),
        },
        workspaceMember: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'mem_v1',
            workspace_id: WORKSPACE_A,
            user_id: 'usr_v1',
            role: 'MEMBER',
            participant_type: 'VENDOR',
            vendor_id: VENDOR_1,
          }),
        },
      };

      const mockProvider: any = {
        getRecordingUrl: vi.fn().mockResolvedValue('https://storage.provider.com/audio/rec_1.mp3'),
      };

      const { RecordingsController } = await import('../telephony/recordings.controller.js');
      const controller = new RecordingsController(mockPrisma, mockProvider);

      // Authorized call
      mockPrisma.recording.findUnique.mockResolvedValue({
        id: 'rec_1',
        workspace_id: WORKSPACE_A,
        provider_id: 'provider_rec_1',
        call: {
          id: 'call_1',
          workspace_id: WORKSPACE_A,
          attributed_vendor_id: VENDOR_1,
          attribution_source: 'INGRESS_ASSIGNED',
          commercial: null,
        },
      });

      const res = await controller.getRecordingUrl(WORKSPACE_A, 'rec_1', { user: { userId: 'usr_v1' } });
      expect(res.url).toBe('https://storage.provider.com/audio/rec_1.mp3');

      // Mismatched vendor call
      mockPrisma.recording.findUnique.mockResolvedValue({
        id: 'rec_2',
        workspace_id: WORKSPACE_A,
        provider_id: 'provider_rec_2',
        call: {
          id: 'call_2',
          workspace_id: WORKSPACE_A,
          attributed_vendor_id: VENDOR_2,
          attribution_source: 'INGRESS_ASSIGNED',
          commercial: null,
        },
      });

      await expect(
        controller.getRecordingUrl(WORKSPACE_A, 'rec_2', { user: { userId: 'usr_v1' } }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('PublicRecordingsController.getRecording allows matching INGRESS_ASSIGNED vendor and denies unassigned/mismatched', async () => {
      const mockPrisma: any = {
        recording: {
          findUnique: vi.fn(),
        },
        workspaceMember: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'mem_v1',
            workspace_id: WORKSPACE_A,
            user_id: 'usr_v1',
            role: 'MEMBER',
            participant_type: 'VENDOR',
            vendor_id: VENDOR_1,
          }),
        },
      };

      const mockProvider: any = {
        getRecordingUrl: vi.fn(),
      };

      const { PublicRecordingsController } = await import('../public-api/public-recordings.controller.js');
      const pubController = new PublicRecordingsController(mockPrisma, mockProvider);

      // Matching call
      mockPrisma.recording.findUnique.mockResolvedValue({
        id: 'rec_pub_1',
        workspace_id: WORKSPACE_A,
        call: {
          id: 'call_1',
          workspace_id: WORKSPACE_A,
          attributed_vendor_id: VENDOR_1,
          attribution_source: 'INGRESS_ASSIGNED',
        },
      });

      const rec = await pubController.getRecording(WORKSPACE_A, 'rec_pub_1', { user: { userId: 'usr_v1' } });
      expect(rec.id).toBe('rec_pub_1');

      // Unassigned call
      mockPrisma.recording.findUnique.mockResolvedValue({
        id: 'rec_pub_unassigned',
        workspace_id: WORKSPACE_A,
        call: {
          id: 'call_unassigned',
          workspace_id: WORKSPACE_A,
          attributed_vendor_id: null,
          attribution_source: 'INGRESS_UNASSIGNED',
        },
      });

      await expect(
        pubController.getRecording(WORKSPACE_A, 'rec_pub_unassigned', { user: { userId: 'usr_v1' } }),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
