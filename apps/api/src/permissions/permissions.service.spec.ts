import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PermissionsService } from './permissions.service.js';
import {
  PERMISSIONS_LIST,
  ADMIN_BASELINE_PERMISSIONS,
  VENDOR_BASELINE_PERMISSIONS,
  BUYER_BASELINE_PERMISSIONS,
} from './permissions.constants.js';

describe('PermissionsService - Participant Baseline & Scoping (P0 Vendor Fix)', () => {
  let service: PermissionsService;
  let prisma: any;
  let auditLogsService: any;

  beforeEach(() => {
    prisma = {
      workspaceMember: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
      },
      workspaceMemberPermission: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([]),
      },
      permission: {
        upsert: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      call: {
        findUnique: vi.fn(),
      },
      recording: {
        findUnique: vi.fn(),
      },
      campaignBuyer: {
        findUnique: vi.fn(),
      },
      phoneNumber: {
        findUnique: vi.fn(),
      },
    };

    auditLogsService = {
      logAction: vi.fn(),
    };

    service = new PermissionsService(prisma, auditLogsService);
  });

  describe('1. Constants Invariants', () => {
    it('should include settlement:read, report:read, and call:read in VENDOR_BASELINE_PERMISSIONS', () => {
      expect(VENDOR_BASELINE_PERMISSIONS).toContain('settlement:read');
      expect(VENDOR_BASELINE_PERMISSIONS).toContain('report:read');
      expect(VENDOR_BASELINE_PERMISSIONS).toContain('report:export');
      expect(VENDOR_BASELINE_PERMISSIONS).toContain('call:read');
      expect(VENDOR_BASELINE_PERMISSIONS).toContain('call:recording_read');
      expect(VENDOR_BASELINE_PERMISSIONS).toContain('workspace:read');
      expect(VENDOR_BASELINE_PERMISSIONS).toContain('vendor:read');
    });

    it('should strictly exclude Owner-only financial permissions from VENDOR_BASELINE_PERMISSIONS', () => {
      expect(VENDOR_BASELINE_PERMISSIONS).not.toContain('settlement:generate');
      expect(VENDOR_BASELINE_PERMISSIONS).not.toContain('payment:manage');
      expect(VENDOR_BASELINE_PERMISSIONS).not.toContain('reconciliation:run');
    });

    it('should strictly exclude administrative and buyer permissions from VENDOR_BASELINE_PERMISSIONS', () => {
      expect(VENDOR_BASELINE_PERMISSIONS).not.toContain('vendor:create');
      expect(VENDOR_BASELINE_PERMISSIONS).not.toContain('buyer:read');
      expect(VENDOR_BASELINE_PERMISSIONS).not.toContain('buyer:create');
      expect(VENDOR_BASELINE_PERMISSIONS).not.toContain('campaign:create');
      expect(VENDOR_BASELINE_PERMISSIONS).not.toContain('dispute:create');
      expect(VENDOR_BASELINE_PERMISSIONS).not.toContain('dispute:manage');
      expect(VENDOR_BASELINE_PERMISSIONS).not.toContain('member:invite');
    });
  });

  describe('2. hasPermission for Vendor Member', () => {
    const vendorMember = {
      id: 'member-vendor-1',
      workspace_id: 'ws-1',
      user_id: 'user-vendor-1',
      role: 'MEMBER',
      participant_type: 'VENDOR',
      vendor_id: 'vendor-123',
      buyer_id: null,
    };

    beforeEach(() => {
      prisma.workspaceMember.findUnique.mockResolvedValue(vendorMember);
    });

    it('should grant settlement:read to invited Vendor member without custom DB permission rows', async () => {
      const hasPerm = await service.hasPermission('ws-1', 'user-vendor-1', 'settlement:read');
      expect(hasPerm).toBe(true);
      expect(prisma.workspaceMemberPermission.count).not.toHaveBeenCalled();
    });

    it('should grant report:read and report:export to invited Vendor member', async () => {
      expect(await service.hasPermission('ws-1', 'user-vendor-1', 'report:read')).toBe(true);
      expect(await service.hasPermission('ws-1', 'user-vendor-1', 'report:export')).toBe(true);
    });

    it('should grant call:read and call:recording_read to invited Vendor member', async () => {
      expect(await service.hasPermission('ws-1', 'user-vendor-1', 'call:read')).toBe(true);
      expect(await service.hasPermission('ws-1', 'user-vendor-1', 'call:recording_read')).toBe(true);
    });

    it('should deny settlement:generate to invited Vendor member', async () => {
      const hasPerm = await service.hasPermission('ws-1', 'user-vendor-1', 'settlement:generate');
      expect(hasPerm).toBe(false);
    });

    it('should deny payment:manage and reconciliation:run to invited Vendor member', async () => {
      expect(await service.hasPermission('ws-1', 'user-vendor-1', 'payment:manage')).toBe(false);
      expect(await service.hasPermission('ws-1', 'user-vendor-1', 'reconciliation:run')).toBe(false);
    });

    it('should deny vendor:create and buyer:* to invited Vendor member', async () => {
      expect(await service.hasPermission('ws-1', 'user-vendor-1', 'vendor:create')).toBe(false);
      expect(await service.hasPermission('ws-1', 'user-vendor-1', 'buyer:read')).toBe(false);
      expect(await service.hasPermission('ws-1', 'user-vendor-1', 'buyer:create')).toBe(false);
    });

    it('should deny dispute creation and management to invited Vendor member', async () => {
      expect(await service.hasPermission('ws-1', 'user-vendor-1', 'dispute:create')).toBe(false);
      expect(await service.hasPermission('ws-1', 'user-vendor-1', 'dispute:manage')).toBe(false);
    });
  });

  describe('3. hasAnyPermission for Vendor Member', () => {
    const vendorMember = {
      id: 'member-vendor-1',
      workspace_id: 'ws-1',
      user_id: 'user-vendor-1',
      role: 'MEMBER',
      participant_type: 'VENDOR',
      vendor_id: 'vendor-123',
    };

    beforeEach(() => {
      prisma.workspaceMember.findUnique.mockResolvedValue(vendorMember);
    });

    it('should return true if any permission in array is in VENDOR_BASELINE_PERMISSIONS', async () => {
      const result = await service.hasAnyPermission('ws-1', 'user-vendor-1', [
        'settlement:generate',
        'settlement:read',
      ]);
      expect(result).toBe(true);
    });

    it('should return false if none of the permissions are in VENDOR_BASELINE_PERMISSIONS', async () => {
      const result = await service.hasAnyPermission('ws-1', 'user-vendor-1', [
        'settlement:generate',
        'payment:manage',
        'reconciliation:run',
      ]);
      expect(result).toBe(false);
    });
  });

  describe('4. getMemberPermissions for Vendor Member', () => {
    it('should return baseline vendor permissions when member has participant_type VENDOR', async () => {
      const vendorMember = {
        id: 'member-vendor-1',
        workspace_id: 'ws-1',
        user_id: 'user-vendor-1',
        role: 'MEMBER',
        participant_type: 'VENDOR',
        vendor_id: 'vendor-123',
        workspaceMemberPermissions: [],
      };

      prisma.workspaceMember.findUnique.mockResolvedValue(vendorMember);

      const perms = await service.getMemberPermissions('ws-1', 'member-vendor-1');
      const keys = perms.map((p: any) => p.key);

      expect(keys).toContain('settlement:read');
      expect(keys).toContain('report:read');
      expect(keys).toContain('call:read');
      expect(keys).not.toContain('settlement:generate');
      expect(keys).not.toContain('payment:manage');

      const vendorReadPerm = perms.find((p: any) => p.key === 'vendor:read');
      expect(vendorReadPerm).toBeDefined();
      expect(vendorReadPerm.scope_type).toBe('ASSIGNED');
      expect(vendorReadPerm.resource_id).toBe('vendor-123');
    });
  });

  describe('5. hasResourceScope for Vendor Member', () => {
    const vendorMember = {
      id: 'member-vendor-1',
      workspace_id: 'ws-1',
      user_id: 'user-vendor-1',
      role: 'MEMBER',
      participant_type: 'VENDOR',
      vendor_id: 'vendor-123',
    };

    beforeEach(() => {
      prisma.workspaceMember.findUnique.mockResolvedValue(vendorMember);
    });

    it('should allow vendor:read if resourceId matches member vendor_id', async () => {
      const hasScope = await service.hasResourceScope('ws-1', 'user-vendor-1', 'vendor:read', 'vendor-123');
      expect(hasScope).toBe(true);
    });

    it('should deny vendor:read if resourceId belongs to another vendor', async () => {
      const hasScope = await service.hasResourceScope('ws-1', 'user-vendor-1', 'vendor:read', 'vendor-999');
      expect(hasScope).toBe(false);
    });

    it('should allow call:read if the call commercial vendor_id matches member vendor_id', async () => {
      prisma.call.findUnique.mockResolvedValue({
        id: 'call-1',
        workspace_id: 'ws-1',
        attribution_source: 'LEGACY_COMMERCIAL',
        commercial: { vendor_id: 'vendor-123' },
      });

      const hasScope = await service.hasResourceScope('ws-1', 'user-vendor-1', 'call:read', 'call-1');
      expect(hasScope).toBe(true);
    });

    it('should deny call:read if call commercial vendor_id does NOT match member vendor_id', async () => {
      prisma.call.findUnique.mockResolvedValue({
        id: 'call-2',
        workspace_id: 'ws-1',
        attribution_source: 'LEGACY_COMMERCIAL',
        commercial: { vendor_id: 'vendor-other' },
      });

      const hasScope = await service.hasResourceScope('ws-1', 'user-vendor-1', 'call:read', 'call-2');
      expect(hasScope).toBe(false);
    });

    it('should deny call:read if call belongs to a different workspace (cross-tenant)', async () => {
      prisma.call.findUnique.mockResolvedValue({
        id: 'call-foreign',
        workspace_id: 'ws-other',
        commercial: { vendor_id: 'vendor-123' },
      });

      const hasScope = await service.hasResourceScope('ws-1', 'user-vendor-1', 'call:read', 'call-foreign');
      expect(hasScope).toBe(false);
    });

    it('should allow phone_number:read for Vendor when phone number is assigned to member vendor_id', async () => {
      prisma.phoneNumber.findUnique.mockResolvedValue({
        id: 'pn-1',
        workspace_id: 'ws-1',
        vendor_id: 'vendor-123',
      });

      const hasScope = await service.hasResourceScope('ws-1', 'user-vendor-1', 'phone_number:read', 'pn-1');
      expect(hasScope).toBe(true);
    });

    it('should deny phone_number:read for Vendor when phone number is assigned to a different vendor', async () => {
      prisma.phoneNumber.findUnique.mockResolvedValue({
        id: 'pn-2',
        workspace_id: 'ws-1',
        vendor_id: 'vendor-other',
      });

      const hasScope = await service.hasResourceScope('ws-1', 'user-vendor-1', 'phone_number:read', 'pn-2');
      expect(hasScope).toBe(false);
    });

    it('should deny phone_number:read for Vendor when phone number belongs to a different workspace', async () => {
      prisma.phoneNumber.findUnique.mockResolvedValue({
        id: 'pn-foreign',
        workspace_id: 'ws-other',
        vendor_id: 'vendor-123',
      });

      const hasScope = await service.hasResourceScope('ws-1', 'user-vendor-1', 'phone_number:read', 'pn-foreign');
      expect(hasScope).toBe(false);
    });
  });

  describe('6. Buyer Member Baseline Permissions', () => {
    const buyerMember = {
      id: 'member-buyer-1',
      workspace_id: 'ws-1',
      user_id: 'user-buyer-1',
      role: 'MEMBER',
      participant_type: 'BUYER',
      buyer_id: 'buyer-456',
    };

    beforeEach(() => {
      prisma.workspaceMember.findUnique.mockResolvedValue(buyerMember);
    });

    it('should grant settlement:read and report:read to Buyer member', async () => {
      expect(await service.hasPermission('ws-1', 'user-buyer-1', 'settlement:read')).toBe(true);
      expect(await service.hasPermission('ws-1', 'user-buyer-1', 'report:read')).toBe(true);
    });

    it('should grant dispute:create to Buyer member', async () => {
      expect(await service.hasPermission('ws-1', 'user-buyer-1', 'dispute:create')).toBe(true);
    });

    it('should deny settlement:generate and payment:manage to Buyer member', async () => {
      expect(await service.hasPermission('ws-1', 'user-buyer-1', 'settlement:generate')).toBe(false);
      expect(await service.hasPermission('ws-1', 'user-buyer-1', 'payment:manage')).toBe(false);
    });
  });

  describe('7. Buyer Member Scoping and Isolation (P0 Finding A & P1 Finding D)', () => {
    const buyerMemberA = {
      id: 'member-buyer-1',
      workspace_id: 'ws-1',
      user_id: 'user-buyer-1',
      role: 'MEMBER',
      participant_type: 'BUYER',
      buyer_id: 'buyer-456',
      workspaceMemberPermissions: [],
    };

    beforeEach(() => {
      prisma.workspaceMember.findUnique.mockResolvedValue(buyerMemberA);
    });

    it('should assign scope_type ASSIGNED to campaign:read, phone_number:read, call:read, call:recording_read in getMemberPermissions', async () => {
      const perms = await service.getMemberPermissions('ws-1', 'member-buyer-1');
      const campaignPerm = perms.find((p: any) => p.key === 'campaign:read');
      const phonePerm = perms.find((p: any) => p.key === 'phone_number:read');
      const callPerm = perms.find((p: any) => p.key === 'call:read');
      const recPerm = perms.find((p: any) => p.key === 'call:recording_read');
      const buyerPerm = perms.find((p: any) => p.key === 'buyer:read');

      expect(campaignPerm?.scope_type).toBe('ASSIGNED');
      expect(phonePerm?.scope_type).toBe('ASSIGNED');
      expect(callPerm?.scope_type).toBe('ASSIGNED');
      expect(recPerm?.scope_type).toBe('ASSIGNED');
      expect(buyerPerm?.scope_type).toBe('ASSIGNED');
      expect(buyerPerm?.resource_id).toBe('buyer-456');
    });

    it('Finding A: should allow call:recording_read if commercial buyer_id matches member buyer_id', async () => {
      prisma.recording.findUnique.mockResolvedValue({
        id: 'rec-1',
        call: {
          id: 'call-1',
          workspace_id: 'ws-1',
          commercial: { buyer_id: 'buyer-456' },
        },
      });

      const allowed = await service.hasResourceScope('ws-1', 'user-buyer-1', 'call:recording_read', 'rec-1');
      expect(allowed).toBe(true);
    });

    it('Finding A: should deny call:recording_read if recording belongs to another buyer (even in same campaign)', async () => {
      prisma.recording.findUnique.mockResolvedValue({
        id: 'rec-2',
        call: {
          id: 'call-2',
          workspace_id: 'ws-1',
          commercial: { buyer_id: 'buyer-competitor' },
        },
      });

      const allowed = await service.hasResourceScope('ws-1', 'user-buyer-1', 'call:recording_read', 'rec-2');
      expect(allowed).toBe(false);
    });

    it('Finding A: should fail closed (deny) call:recording_read if commercial record is missing or has null buyer_id', async () => {
      prisma.recording.findUnique.mockResolvedValue({
        id: 'rec-no-comm',
        call: {
          id: 'call-3',
          workspace_id: 'ws-1',
          commercial: null,
        },
      });

      const allowed = await service.hasResourceScope('ws-1', 'user-buyer-1', 'call:recording_read', 'rec-no-comm');
      expect(allowed).toBe(false);
    });

    it('Finding A: should deny call:recording_read if recording belongs to another workspace (cross-tenant)', async () => {
      prisma.recording.findUnique.mockResolvedValue({
        id: 'rec-other-ws',
        call: {
          id: 'call-4',
          workspace_id: 'ws-other',
          commercial: { buyer_id: 'buyer-456' },
        },
      });

      const allowed = await service.hasResourceScope('ws-1', 'user-buyer-1', 'call:recording_read', 'rec-other-ws');
      expect(allowed).toBe(false);
    });

    it('Finding A: should allow call:read if commercial buyer_id matches', async () => {
      prisma.call.findUnique.mockResolvedValue({
        id: 'call-1',
        workspace_id: 'ws-1',
        commercial: { buyer_id: 'buyer-456' },
      });

      const allowed = await service.hasResourceScope('ws-1', 'user-buyer-1', 'call:read', 'call-1');
      expect(allowed).toBe(true);
    });

    it('Finding A: should deny call:read if commercial buyer_id is different and buyer has no attempt', async () => {
      prisma.call.findUnique.mockResolvedValue({
        id: 'call-2',
        workspace_id: 'ws-1',
        commercial: { buyer_id: 'buyer-competitor' },
        attempts: [],
      });

      const allowed = await service.hasResourceScope('ws-1', 'user-buyer-1', 'call:read', 'call-2');
      expect(allowed).toBe(false);
    });

    it('Phase 2 B-06 (Policy A): should allow call:read if commercial is for another buyer but member buyer_id participated in a rollover attempt', async () => {
      prisma.call.findUnique.mockResolvedValue({
        id: 'call-rollover-b06',
        workspace_id: 'ws-1',
        commercial: { buyer_id: 'buyer-competitor' },
        attempts: [
          { buyer_id: 'buyer-456', state: 'NO_ANSWER' },
          { buyer_id: 'buyer-competitor', state: 'COMPLETED' },
        ],
      });

      const allowed = await service.hasResourceScope('ws-1', 'user-buyer-1', 'call:read', 'call-rollover-b06');
      expect(allowed).toBe(true);
    });

    it('Phase 2 B-06: should deny call:read if call belongs to another workspace even if member buyer_id has attempt', async () => {
      prisma.call.findUnique.mockResolvedValue({
        id: 'call-cross-ws',
        workspace_id: 'ws-2',
        commercial: { buyer_id: 'buyer-competitor' },
        attempts: [
          { buyer_id: 'buyer-456', state: 'NO_ANSWER' },
        ],
      });

      const allowed = await service.hasResourceScope('ws-1', 'user-buyer-1', 'call:read', 'call-cross-ws');
      expect(allowed).toBe(false);
    });

    it('Phase 2: should allow call:read if commercial is null but call has attempt for member buyer_id', async () => {
      prisma.call.findUnique.mockResolvedValue({
        id: 'call-op-1',
        workspace_id: 'ws-1',
        commercial: null,
        attempts: [{ buyer_id: 'buyer-456', state: 'NO_ANSWER' }],
      });

      const allowed = await service.hasResourceScope('ws-1', 'user-buyer-1', 'call:read', 'call-op-1');
      expect(allowed).toBe(true);
    });

    it('Phase 2: should deny call:read if commercial is null and call has no attempt for member buyer_id', async () => {
      prisma.call.findUnique.mockResolvedValue({
        id: 'call-op-2',
        workspace_id: 'ws-1',
        commercial: null,
        attempts: [{ buyer_id: 'buyer-competitor', state: 'NO_ANSWER' }],
      });

      const allowed = await service.hasResourceScope('ws-1', 'user-buyer-1', 'call:read', 'call-op-2');
      expect(allowed).toBe(false);
    });

    it('Phase 2: should fail closed for call:recording_read if commercial is null even with attempt', async () => {
      prisma.recording.findUnique.mockResolvedValue({
        id: 'rec-op',
        call: {
          id: 'call-op-1',
          workspace_id: 'ws-1',
          commercial: null,
          attempts: [{ buyer_id: 'buyer-456' }],
        },
      });

      const allowed = await service.hasResourceScope('ws-1', 'user-buyer-1', 'call:recording_read', 'rec-op');
      expect(allowed).toBe(false);
    });

    it('Finding A: should preserve Owner full access to recording regardless of buyer attribution', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        id: 'member-owner',
        workspace_id: 'ws-1',
        user_id: 'user-owner',
        role: 'OWNER',
        participant_type: null,
      });

      const allowed = await service.hasResourceScope('ws-1', 'user-owner', 'call:recording_read', 'rec-any');
      expect(allowed).toBe(true);
    });
  });

  describe('V2 Security: Vendor Role Escalation & Precedence Over Admin/Owner', () => {
    const escalatedVendorMember = {
      id: 'member-vendor-esc',
      workspace_id: 'ws-1',
      user_id: 'user-vendor-esc',
      role: 'ADMIN', // Elevated role maliciously stored or bypassed
      participant_type: 'VENDOR',
      vendor_id: 'vendor-123',
      buyer_id: null,
      workspaceMemberPermissions: [],
    };

    beforeEach(() => {
      prisma.workspaceMember.findUnique.mockResolvedValue(escalatedVendorMember);
      prisma.workspaceMember.findFirst.mockResolvedValue(escalatedVendorMember);
    });

    it('hasPermission: should NOT grant ADMIN permissions (e.g. member:read, buyer:create) to a VENDOR even if role is ADMIN', async () => {
      // member:read is in ADMIN_BASELINE_PERMISSIONS but NOT in VENDOR_BASELINE_PERMISSIONS
      const canReadMembers = await service.hasPermission('ws-1', 'user-vendor-esc', 'member:read');
      expect(canReadMembers).toBe(false);

      const canCreateBuyer = await service.hasPermission('ws-1', 'user-vendor-esc', 'buyer:create');
      expect(canCreateBuyer).toBe(false);

      // Still allows vendor baseline permissions
      const canReadVendor = await service.hasPermission('ws-1', 'user-vendor-esc', 'vendor:read');
      expect(canReadVendor).toBe(true);
    });

    it('hasAnyPermission: should NOT grant permission if all keys are outside VENDOR baseline', async () => {
      const allowed = await service.hasAnyPermission('ws-1', 'user-vendor-esc', ['member:read', 'buyer:read', 'campaign:create']);
      expect(allowed).toBe(false);

      const allowedWithVendor = await service.hasAnyPermission('ws-1', 'user-vendor-esc', ['member:read', 'report:read']);
      expect(allowedWithVendor).toBe(true);
    });

    it('getMemberPermissions: should return only VENDOR_BASELINE_PERMISSIONS, NOT all ADMIN permissions', async () => {
      const perms = await service.getMemberPermissions('ws-1', 'member-vendor-esc');
      const permKeys = perms.map((p: any) => p.key);

      expect(permKeys).toContain('settlement:read');
      expect(permKeys).toContain('report:read');
      expect(permKeys).not.toContain('member:read');
      expect(permKeys).not.toContain('member:invite');
      expect(permKeys).not.toContain('buyer:create');
    });

    it('hasResourceScope: should enforce vendor isolation even if role is ADMIN', async () => {
      // Trying to access another vendor
      const canReadOtherVendor = await service.hasResourceScope('ws-1', 'user-vendor-esc', 'vendor:read', 'vendor-competitor');
      expect(canReadOtherVendor).toBe(false);

      // Trying to access own vendor
      const canReadOwnVendor = await service.hasResourceScope('ws-1', 'user-vendor-esc', 'vendor:read', 'vendor-123');
      expect(canReadOwnVendor).toBe(true);
    });
  });

  describe('6. seedPermissions Idempotency & Error Handling', () => {
    it('creates all permissions when database table is empty', async () => {
      prisma.permission.findMany.mockResolvedValueOnce([]);
      await service.seedPermissions();
      expect(prisma.permission.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.permission.create).toHaveBeenCalledTimes(PERMISSIONS_LIST.length);
      expect(prisma.permission.update).not.toHaveBeenCalled();
    });

    it('executes zero writes when all baseline permissions already exist identically', async () => {
      const existing = PERMISSIONS_LIST.map((p) => ({
        key: p.key,
        group: p.group,
        description: p.description,
      }));
      prisma.permission.findMany.mockResolvedValueOnce(existing);
      await service.seedPermissions();
      expect(prisma.permission.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.permission.create).not.toHaveBeenCalled();
      expect(prisma.permission.update).not.toHaveBeenCalled();
    });

    it('updates description when existing permission description drifts', async () => {
      const existing = PERMISSIONS_LIST.map((p, idx) => ({
        key: p.key,
        group: p.group,
        description: idx === 0 ? 'Old description' : p.description,
      }));
      prisma.permission.findMany.mockResolvedValueOnce(existing);
      await service.seedPermissions();
      expect(prisma.permission.update).toHaveBeenCalledTimes(1);
      expect(prisma.permission.create).not.toHaveBeenCalled();
    });

    it('throws actionable error detailing database pooler guidance on failure', async () => {
      prisma.permission.findMany.mockRejectedValueOnce(new Error('prepared statement "s0" already exists'));
      await expect(service.seedPermissions()).rejects.toThrow(
        /\[CRITICAL DATABASE STARTUP ERROR\] Permission seeding failed: prepared statement "s0" already exists\. If using Supabase transaction pooler \(port 6543\), ensure \?pgbouncer=true is appended to DATABASE_URL\./,
      );
    });
  });

  describe('7. Privilege Escalation & Permission Tampering Prevention', () => {
    const ownerMember = {
      id: 'm-owner',
      workspace_id: 'ws-1',
      user_id: 'user-owner',
      role: 'OWNER',
      participant_type: null,
    };

    const adminMember = {
      id: 'm-admin',
      workspace_id: 'ws-1',
      user_id: 'user-admin',
      role: 'ADMIN',
      participant_type: null,
    };

    const targetMember = {
      id: 'm-target',
      workspace_id: 'ws-1',
      user_id: 'user-target',
      role: 'MEMBER',
      participant_type: null,
    };

    const vendorTargetMember = {
      id: 'm-vendor-target',
      workspace_id: 'ws-1',
      user_id: 'user-vendor-target',
      role: 'MEMBER',
      participant_type: 'VENDOR',
      vendor_id: 'vendor-123',
    };

    beforeEach(() => {
      prisma.workspaceMemberPermission = {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'wmp-1' }),
        delete: vi.fn().mockResolvedValue({}),
      };

      prisma.workspaceMember.findUnique.mockImplementation(async ({ where }: any) => {
        if (where.workspace_id_user_id) {
          const { user_id } = where.workspace_id_user_id;
          if (user_id === 'user-owner') return ownerMember;
          if (user_id === 'user-admin') return adminMember;
        }
        if (where.id) {
          if (where.id === 'm-owner') return ownerMember;
          if (where.id === 'm-admin') return adminMember;
          if (where.id === 'm-target') return targetMember;
          if (where.id === 'm-vendor-target') return vendorTargetMember;
        }
        return null;
      });

      prisma.permission.findUnique.mockResolvedValue({
        id: 'p-1',
        key: 'call:read',
        group: 'CALLS',
      });
      prisma.workspaceMemberPermission.findFirst.mockResolvedValue(null);
      prisma.workspaceMemberPermission.create.mockResolvedValue({ id: 'wmp-1' });
      prisma.workspaceMemberPermission.delete.mockResolvedValue({});
    });

    it('rejects self-permission assignment attempts', async () => {
      await expect(
        service.assignPermission('ws-1', 'user-owner', 'm-owner', 'call:read'),
      ).rejects.toThrow('You cannot modify your own permissions');
    });

    it('rejects self-permission revocation attempts', async () => {
      await expect(
        service.removePermission('ws-1', 'user-owner', 'm-owner', 'call:read'),
      ).rejects.toThrow('You cannot modify your own permissions');
    });

    it('rejects non-owner modifying permissions of an OWNER (assign)', async () => {
      await expect(
        service.assignPermission('ws-1', 'user-admin', 'm-owner', 'call:read'),
      ).rejects.toThrow('Only workspace owners can modify permissions of an owner');
    });

    it('rejects non-owner modifying permissions of an OWNER (remove)', async () => {
      await expect(
        service.removePermission('ws-1', 'user-admin', 'm-owner', 'call:read'),
      ).rejects.toThrow('Only workspace owners can modify permissions of an owner');
    });

    it('rejects non-owner assigning owner-only financial permissions (settlement:generate)', async () => {
      prisma.permission.findUnique.mockResolvedValue({
        id: 'p-gen',
        key: 'settlement:generate',
      });

      await expect(
        service.assignPermission('ws-1', 'user-admin', 'm-target', 'settlement:generate'),
      ).rejects.toThrow('Only workspace owners can manage owner-only financial permissions');
    });

    it('rejects non-owner assigning owner-only financial permissions (payment:manage)', async () => {
      prisma.permission.findUnique.mockResolvedValue({
        id: 'p-pay',
        key: 'payment:manage',
      });

      await expect(
        service.assignPermission('ws-1', 'user-admin', 'm-target', 'payment:manage'),
      ).rejects.toThrow('Only workspace owners can manage owner-only financial permissions');
    });

    it('rejects non-owner assigning owner-only financial permissions (reconciliation:run)', async () => {
      prisma.permission.findUnique.mockResolvedValue({
        id: 'p-rec',
        key: 'reconciliation:run',
      });

      await expect(
        service.assignPermission('ws-1', 'user-admin', 'm-target', 'reconciliation:run'),
      ).rejects.toThrow('Only workspace owners can manage owner-only financial permissions');
    });

    it('rejects assigning administrative/financial permissions to a participant (VENDOR)', async () => {
      const forbiddenKeys = [
        'billing:manage',
        'settlement:generate',
        'payment:manage',
        'reconciliation:run',
        'member:invite',
        'member:update',
        'member:remove',
        'api_key:manage',
        'workspace:update',
      ];

      for (const key of forbiddenKeys) {
        prisma.permission.findUnique.mockResolvedValue({ id: `p-${key}`, key });
        await expect(
          service.assignPermission('ws-1', 'user-owner', 'm-vendor-target', key),
        ).rejects.toThrow('Participants cannot be granted administrative or financial management permissions');
      }
    });

    it('allows workspace owner to assign valid permission to target member', async () => {
      const result = await service.assignPermission('ws-1', 'user-owner', 'm-target', 'call:read');
      expect(result).toBeDefined();
      expect(prisma.workspaceMemberPermission.create).toHaveBeenCalled();
      expect(auditLogsService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'PERMISSION_ASSIGNED',
          workspaceId: 'ws-1',
          actorUserId: 'user-owner',
        }),
      );
    });
  });
});
