import { PermissionsService } from '../permissions/permissions.service.js';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { PhoneNumbersService } from './phone-numbers.service.js';
import { TelnyxProvisioningService } from './telnyx-provisioning.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsageService } from '../usage/usage.service.js';
import { PhoneNumberStatus } from '@prisma/client';

describe('PhoneNumbersService', () => {
  let service: PhoneNumbersService;
  let prismaMock: any;
  let telnyxMock: any;

  let usageMock: any;

  beforeEach(async () => {
    prismaMock = {
      phoneNumber: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        count: vi.fn().mockResolvedValue(1),
      },
      vendor: {
        findFirst: vi.fn(),
      },
      workspaceMember: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };

    telnyxMock = {
      searchNumbers: vi
        .fn()
        .mockResolvedValue([{ phone_number: '+15550001000' }]),
      provisionNumber: vi.fn().mockResolvedValue({
        id: 'mock_telnyx_id',
        phone_number: '+15550001000',
        connection_id: 'mock_conn_id',
      }),
    };

    usageMock = {
      recordUsage: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [{ provide: PermissionsService, useValue: { hasResourceScope: async () => true, hasPermission: async () => true, getPermissionsForUser: async () => [{ key: 'phone_number:read', scope_type: 'ALL' }] } }, 
        PhoneNumbersService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: TelnyxProvisioningService, useValue: telnyxMock },
        { provide: UsageService, useValue: usageMock },
      ],
    }).compile();

    service = module.get<PhoneNumbersService>(PhoneNumbersService);
  });

  it('should list workspace numbers', async () => {
    prismaMock.phoneNumber.findMany.mockResolvedValue([
      { id: 'mock-uuid', phone_number: '+15550001000' },
    ]);
    const result = await service.listWorkspaceNumbers('ws-1', { page: 1, limit: 50 });
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(prismaMock.phoneNumber.findMany).toHaveBeenCalledWith({
      where: { workspace_id: 'ws-1', status: { not: PhoneNumberStatus.RELEASED } },
      include: {
        campaign: {
          select: { id: true, name: true }
        },
        vendor: {
          select: { id: true, name: true }
        }
      },
      orderBy: { created_at: 'desc' },
      skip: 0,
      take: 50,
    });
  });

  it('should return campaign for assigned number', async () => {
    prismaMock.phoneNumber.findMany.mockResolvedValue([
      { id: 'num-1', phone_number: '+1555', campaign: { id: 'camp-1', name: 'Summer Campaign' } },
    ]);
    const result = await service.listWorkspaceNumbers('ws-1');
    expect(result.items[0].campaign?.name).toBe('Summer Campaign');
  });

  it('should redact vendor_id when caller is a BUYER participant (membership present)', async () => {
    prismaMock.workspaceMember.findUnique.mockResolvedValue({
      id: 'mem-1',
      workspace_id: 'ws-1',
      user_id: 'user-buyer-1',
      participant_type: 'BUYER',
      buyer_id: 'buyer-1',
    });
    prismaMock.phoneNumber.findMany.mockResolvedValue([
      { id: 'pn-1', phone_number: '+15551234567', vendor_id: 'vendor-secret-99' },
    ]);

    const result = await service.listWorkspaceNumbers('ws-1', 'user-buyer-1');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].phone_number).toBe('+15551234567');
    expect((result.items[0] as any).vendor_id).toBeUndefined();
  });

  it('should preserve vendor_id when caller is internal member (membership present, not BUYER)', async () => {
    prismaMock.workspaceMember.findUnique.mockResolvedValue({
      id: 'mem-2',
      workspace_id: 'ws-1',
      user_id: 'user-internal-1',
      participant_type: 'INTERNAL',
      role: 'MEMBER',
    });
    prismaMock.phoneNumber.findMany.mockResolvedValue([
      { id: 'pn-1', phone_number: '+15551234567', vendor_id: 'vendor-secret-99' },
    ]);

    const result = await service.listWorkspaceNumbers('ws-1', 'user-internal-1');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].phone_number).toBe('+15551234567');
    expect((result.items[0] as any).vendor_id).toBe('vendor-secret-99');
  });

  it('should preserve vendor_id when caller membership is absent (null member)', async () => {
    prismaMock.workspaceMember.findUnique.mockResolvedValue(null);
    prismaMock.phoneNumber.findMany.mockResolvedValue([
      { id: 'pn-1', phone_number: '+15551234567', vendor_id: 'vendor-secret-99' },
    ]);

    const result = await service.listWorkspaceNumbers('ws-1', 'user-unregistered');
    expect(result.items).toHaveLength(1);
    expect((result.items[0] as any).vendor_id).toBe('vendor-secret-99');
  });

  it('should return null campaign for unassigned number', async () => {
    prismaMock.phoneNumber.findMany.mockResolvedValue([
      { id: 'num-1', phone_number: '+1555', campaign: null },
    ]);
    const result = await service.listWorkspaceNumbers('ws-1');
    expect(result.items[0].campaign).toBeNull();
  });

  it('should search available numbers', async () => {
    const result = await service.searchAvailableNumbers('US', 2);
    expect(result).toHaveLength(1);
    expect(telnyxMock.searchNumbers).toHaveBeenCalledWith('US', 2, undefined, undefined);
  });

  it('should provision a new number', async () => {
    prismaMock.phoneNumber.findUnique.mockResolvedValue(null);
    prismaMock.phoneNumber.create.mockResolvedValue({
      id: 'new-uuid',
      workspace_id: 'ws-1',
      phone_number: '+15550001000',
      status: PhoneNumberStatus.PROVISIONING,
    });
    prismaMock.phoneNumber.update.mockResolvedValue({
      id: 'new-uuid',
      workspace_id: 'ws-1',
      phone_number: '+15550001000',
      status: PhoneNumberStatus.ACTIVE,
    });

    telnyxMock.placeNumberOrder = vi.fn().mockResolvedValue({
      order_id: 'mock_order_id',
      connection_id: 'mock_conn_id',
    });
    telnyxMock.checkOrderStatus = vi.fn().mockResolvedValue({
      status: 'completed',
      id: 'mock_telnyx_id',
      connection_id: 'mock_conn_id',
      phone_number_type: 'toll_free'
    });

    const result = await service.provisionNumber('ws-1', '+15550001000');
    expect(result!.id).toBe('new-uuid');
    expect(result!.status).toBe(PhoneNumberStatus.ACTIVE);
    expect(telnyxMock.placeNumberOrder).toHaveBeenCalledWith('+15550001000');
    expect(prismaMock.phoneNumber.create).toHaveBeenCalled();
    expect(prismaMock.phoneNumber.update).toHaveBeenCalledTimes(2);
    expect(prismaMock.phoneNumber.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          number_type: 'toll_free',
        })
      })
    );
  });

  it('should backfill number types', async () => {
    prismaMock.phoneNumber.findMany.mockResolvedValue([
      { id: '1', phone_number: '+123', provider_number_id: 'pn1' } as any,
    ]);
    telnyxMock.checkOrderStatus = vi.fn().mockResolvedValue({ status: 'completed', phone_number_type: 'local' });
    
    const res = await service.backfillNumberTypes(false);
    expect(res.updated).toBe(1);
    expect(prismaMock.phoneNumber.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: '1' },
        data: { number_type: 'local' }
      })
    );
  });

  it('should release a number (soft delete)', async () => {
    prismaMock.phoneNumber.findUnique.mockResolvedValue({
      id: 'new-uuid',
      workspace_id: 'ws-1',
      status: PhoneNumberStatus.ACTIVE,
    });
    prismaMock.phoneNumber.update.mockResolvedValue({
      id: 'new-uuid',
      workspace_id: 'ws-1',
      status: PhoneNumberStatus.RELEASED,
    });

    const result = await service.releaseNumber('ws-1', 'new-uuid');
    expect(result.status).toBe(PhoneNumberStatus.RELEASED);
    expect(prismaMock.phoneNumber.update).toHaveBeenCalledWith({
      where: { id: 'new-uuid' },
      data: { 
        status: PhoneNumberStatus.RELEASED,
        campaign_id: null
      },
    });
  });
  it('should not update DB and throw if provider release fails', async () => {
    prismaMock.phoneNumber.findUnique.mockResolvedValue({
      id: 'new-uuid',
      workspace_id: 'ws-1',
      status: PhoneNumberStatus.ACTIVE,
      provider_number_id: 'provider_123',
    });
    
    telnyxMock.releaseNumber = vi.fn().mockRejectedValue(new Error('Provider error'));
    prismaMock.phoneNumber.update.mockClear();

    await expect(service.releaseNumber('ws-1', 'new-uuid')).rejects.toThrow('Provider error');
    
    expect(telnyxMock.releaseNumber).toHaveBeenCalledWith('provider_123');
    expect(prismaMock.phoneNumber.update).not.toHaveBeenCalled();
  });

  it('should be idempotent and not call provider if already RELEASED', async () => {
    prismaMock.phoneNumber.findUnique.mockResolvedValue({
      id: 'new-uuid',
      workspace_id: 'ws-1',
      status: PhoneNumberStatus.RELEASED,
      provider_number_id: 'provider_123',
    });

    telnyxMock.releaseNumber = vi.fn();
    prismaMock.phoneNumber.update.mockClear();

    const result = await service.releaseNumber('ws-1', 'new-uuid');
    
    expect(result.status).toBe(PhoneNumberStatus.RELEASED);
    expect(telnyxMock.releaseNumber).not.toHaveBeenCalled();
    expect(prismaMock.phoneNumber.update).not.toHaveBeenCalled();
  });

  describe('listWorkspaceNumbers edge cases and security boundaries', () => {
    let permissionsService: PermissionsService;

    beforeEach(() => {
      permissionsService = (service as any).permissionsService;
      prismaMock.phoneNumber.findMany.mockResolvedValue([]);
    });

    it('should support signature 1: (workspaceId, userId, params)', async () => {
      prismaMock.phoneNumber.findMany.mockImplementation(async (args: any) => {
        if (args.where?.status === PhoneNumberStatus.PROVISIONING) return [];
        return [{ id: 'pn-1', phone_number: '+15551112222', vendor_id: 'v-1' }];
      });
      const result = await service.listWorkspaceNumbers('ws-1', 'usr-1', { limit: 25, offset: 10 });
      expect(result.items).toHaveLength(1);
      expect(prismaMock.phoneNumber.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 25,
        }),
      );
    });

    it('should support signature 2: (workspaceId, userId)', async () => {
      prismaMock.phoneNumber.findMany.mockImplementation(async (args: any) => {
        if (args.where?.status === PhoneNumberStatus.PROVISIONING) return [];
        return [{ id: 'pn-1', phone_number: '+15551112222', vendor_id: 'v-1' }];
      });
      const result = await service.listWorkspaceNumbers('ws-1', 'usr-1');
      expect(result.items).toHaveLength(1);
      expect(prismaMock.phoneNumber.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 50,
        }),
      );
    });

    it('should support signature 3: (workspaceId, params)', async () => {
      prismaMock.phoneNumber.findMany.mockImplementation(async (args: any) => {
        if (args.where?.status === PhoneNumberStatus.PROVISIONING) return [];
        return [{ id: 'pn-1', phone_number: '+15551112222', vendor_id: 'v-1' }];
      });
      const result = await service.listWorkspaceNumbers('ws-1', { limit: 15, offset: 5 });
      expect(result.items).toHaveLength(1);
      expect(prismaMock.phoneNumber.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 5,
          take: 15,
        }),
      );
    });

    it('should throw ForbiddenException for invalid or missing workspaceId (malformed inputs)', async () => {
      await expect(service.listWorkspaceNumbers('', 'usr-1')).rejects.toThrow('Invalid or missing workspace identifier');
      await expect(service.listWorkspaceNumbers(null as any, 'usr-1')).rejects.toThrow('Invalid or missing workspace identifier');
      await expect(service.listWorkspaceNumbers(123 as any, 'usr-1')).rejects.toThrow('Invalid or missing workspace identifier');
      await expect(service.listWorkspaceNumbers({} as any, 'usr-1')).rejects.toThrow('Invalid or missing workspace identifier');
    });

    it('should handle malformed 2nd argument (arrays, numbers, booleans, null) without corrupting query', async () => {
      // Array as 2nd arg
      await service.listWorkspaceNumbers('ws-1', ['malicious-user'] as any, { limit: 20 });
      expect(prismaMock.phoneNumber.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );

      // Primitive number as 2nd arg
      await service.listWorkspaceNumbers('ws-1', 99999 as any);
      expect(prismaMock.phoneNumber.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 50 }),
      );

      // Boolean as 2nd arg
      await service.listWorkspaceNumbers('ws-1', true as any);
      expect(prismaMock.phoneNumber.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 50 }),
      );

      // Null as 2nd arg
      await service.listWorkspaceNumbers('ws-1', null as any);
      expect(prismaMock.phoneNumber.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 50 }),
      );
    });

    it('should handle malformed 3rd argument (array, primitive) safely', async () => {
      await service.listWorkspaceNumbers('ws-1', 'usr-1', ['bad-params'] as any);
      expect(prismaMock.phoneNumber.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 50 }),
      );

      await service.listWorkspaceNumbers('ws-1', 'usr-1', 42 as any);
      expect(prismaMock.phoneNumber.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 50 }),
      );
    });

    it('should sanitize negative, non-numeric, or oversized pagination limits', async () => {
      // Negative values
      await service.listWorkspaceNumbers('ws-1', 'usr-1', { limit: -10, offset: -5 });
      expect(prismaMock.phoneNumber.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 50 }),
      );

      // Non-numeric strings
      await service.listWorkspaceNumbers('ws-1', 'usr-1', { limit: 'invalid', offset: 'bad' });
      expect(prismaMock.phoneNumber.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 50 }),
      );

      // Limit capped at 100
      await service.listWorkspaceNumbers('ws-1', 'usr-1', { limit: 500 });
      expect(prismaMock.phoneNumber.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 100 }),
      );
    });

    it('should fail explicitly with InternalServerErrorException if workspaceMember delegate is missing when userId is provided', async () => {
      const originalDelegate = prismaMock.workspaceMember;
      delete prismaMock.workspaceMember;

      try {
        await expect(service.listWorkspaceNumbers('ws-1', 'user-buyer-1')).rejects.toThrow(
          'WorkspaceMember repository is not available',
        );
      } finally {
        prismaMock.workspaceMember = originalDelegate;
      }
    });

    it('should fail explicitly with InternalServerErrorException if workspaceMember delegate is missing when ASSIGNED scope is evaluated', async () => {
      vi.spyOn(permissionsService, 'getPermissionsForUser').mockResolvedValueOnce([
        { key: 'phone_number:read', scope_type: 'ASSIGNED' },
      ]);
      const originalDelegate = prismaMock.workspaceMember;
      delete prismaMock.workspaceMember;

      try {
        await expect(service.listWorkspaceNumbers('ws-1', 'user-buyer-1')).rejects.toThrow(
          'WorkspaceMember repository is not available',
        );
      } finally {
        prismaMock.workspaceMember = originalDelegate;
      }
    });

    it('should fail closed when caller has ASSIGNED scope but missing userId', async () => {
      vi.spyOn(permissionsService, 'getPermissionsForUser').mockResolvedValueOnce([
        { key: 'phone_number:read', scope_type: 'ASSIGNED' },
      ]);

      const result = await service.listWorkspaceNumbers('ws-1', '');
      expect(result).toEqual({ items: [], total: 0 });
    });

    it('should fail closed when caller has ASSIGNED scope but workspaceMember is not found (null)', async () => {
      vi.spyOn(permissionsService, 'getPermissionsForUser').mockResolvedValueOnce([
        { key: 'phone_number:read', scope_type: 'ASSIGNED' },
      ]);
      prismaMock.workspaceMember.findUnique.mockResolvedValueOnce(null);

      const result = await service.listWorkspaceNumbers('ws-1', 'unknown-user');
      expect(result).toEqual({ items: [], total: 0 });
    });

    it('should fail closed when caller has ASSIGNED scope but buyer_id is null/missing on member', async () => {
      vi.spyOn(permissionsService, 'getPermissionsForUser').mockResolvedValueOnce([
        { key: 'phone_number:read', scope_type: 'ASSIGNED' },
      ]);
      prismaMock.workspaceMember.findUnique.mockResolvedValueOnce({
        id: 'mem-3',
        workspace_id: 'ws-1',
        user_id: 'user-no-buyer',
        participant_type: 'BUYER',
        buyer_id: null,
      });

      const result = await service.listWorkspaceNumbers('ws-1', 'user-no-buyer');
      expect(result).toEqual({ items: [], total: 0 });
    });

    it('should enforce campaign filtering and redact vendor_id for ASSIGNED BUYER participant', async () => {
      vi.spyOn(permissionsService, 'getPermissionsForUser').mockResolvedValueOnce([
        { key: 'phone_number:read', scope_type: 'ASSIGNED' },
      ]);
      prismaMock.workspaceMember.findUnique.mockResolvedValue({
        id: 'mem-4',
        workspace_id: 'ws-1',
        user_id: 'buyer-user-assigned',
        participant_type: 'BUYER',
        buyer_id: 'b-assigned-100',
      });
      prismaMock.phoneNumber.findMany.mockImplementation(async (args: any) => {
        if (args.where?.status === PhoneNumberStatus.PROVISIONING) return [];
        return [{ id: 'pn-assigned-1', phone_number: '+18889990000', vendor_id: 'secret-vendor' }];
      });

      const result = await service.listWorkspaceNumbers('ws-1', 'buyer-user-assigned');
      expect(prismaMock.phoneNumber.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: [{ OR: [{ campaign: { buyers: { some: { buyer_id: 'b-assigned-100' } } } }] }],
          }),
        }),
      );
      expect(result.items).toHaveLength(1);
      expect((result.items[0] as any).vendor_id).toBeUndefined();
    });
  });


  describe('updateNumber and vendor assignment', () => {
    it('should allow authorized user to assign a number to a vendor in the same workspace', async () => {
      prismaMock.phoneNumber.findUnique.mockResolvedValue({
        id: 'pn-1',
        workspace_id: 'ws-1',
        status: PhoneNumberStatus.ACTIVE,
        name: 'Main Number',
        vendor_id: null,
      });
      prismaMock.vendor.findFirst.mockResolvedValue({
        id: 'v-1',
        workspace_id: 'ws-1',
        name: 'Vendor Partner 1',
      });
      prismaMock.phoneNumber.update.mockResolvedValue({
        id: 'pn-1',
        workspace_id: 'ws-1',
        name: 'Main Number',
        vendor_id: 'v-1',
        vendor: { id: 'v-1', name: 'Vendor Partner 1' },
      });

      const result = await service.updateNumber('ws-1', 'pn-1', { vendorId: 'v-1' });
      expect(result.vendor_id).toBe('v-1');
      expect(prismaMock.vendor.findFirst).toHaveBeenCalledWith({
        where: { id: 'v-1', workspace_id: 'ws-1' },
      });
      expect(prismaMock.phoneNumber.update).toHaveBeenCalledWith({
        where: { id: 'pn-1' },
        data: { vendor_id: 'v-1' },
        include: {
          campaign: { select: { id: true, name: true } },
          vendor: { select: { id: true, name: true } },
        },
      });
    });

    it('should allow authorized user to unassign a number with vendorId: null', async () => {
      prismaMock.phoneNumber.findUnique.mockResolvedValue({
        id: 'pn-1',
        workspace_id: 'ws-1',
        status: PhoneNumberStatus.ACTIVE,
        name: 'Main Number',
        vendor_id: 'v-1',
      });
      prismaMock.phoneNumber.update.mockResolvedValue({
        id: 'pn-1',
        workspace_id: 'ws-1',
        vendor_id: null,
      });

      const result = await service.updateNumber('ws-1', 'pn-1', { vendorId: null });
      expect(result.vendor_id).toBeNull();
      expect(prismaMock.phoneNumber.update).toHaveBeenCalledWith({
        where: { id: 'pn-1' },
        data: { vendor_id: null },
        include: {
          campaign: { select: { id: true, name: true } },
          vendor: { select: { id: true, name: true } },
        },
      });
    });

    it('should allow authorized user to reassign a number from vendor A to vendor B in the same workspace', async () => {
      prismaMock.phoneNumber.findUnique.mockResolvedValue({
        id: 'pn-1',
        workspace_id: 'ws-1',
        status: PhoneNumberStatus.ACTIVE,
        vendor_id: 'v-a',
      });
      prismaMock.vendor.findFirst.mockResolvedValue({
        id: 'v-b',
        workspace_id: 'ws-1',
        name: 'Vendor B',
      });
      prismaMock.phoneNumber.update.mockResolvedValue({
        id: 'pn-1',
        workspace_id: 'ws-1',
        vendor_id: 'v-b',
      });

      const result = await service.updateNumber('ws-1', 'pn-1', { vendorId: 'v-b' });
      expect(result.vendor_id).toBe('v-b');
      expect(prismaMock.vendor.findFirst).toHaveBeenCalledWith({
        where: { id: 'v-b', workspace_id: 'ws-1' },
      });
    });

    it('should be idempotent and update correctly when reassigning to the same vendor', async () => {
      prismaMock.phoneNumber.findUnique.mockResolvedValue({
        id: 'pn-1',
        workspace_id: 'ws-1',
        status: PhoneNumberStatus.ACTIVE,
        vendor_id: 'v-1',
      });
      prismaMock.vendor.findFirst.mockResolvedValue({
        id: 'v-1',
        workspace_id: 'ws-1',
        name: 'Vendor 1',
      });
      prismaMock.phoneNumber.update.mockResolvedValue({
        id: 'pn-1',
        workspace_id: 'ws-1',
        vendor_id: 'v-1',
      });

      const result = await service.updateNumber('ws-1', 'pn-1', { vendorId: 'v-1' });
      expect(result.vendor_id).toBe('v-1');
    });

    it('should throw NotFoundException if phone number not found in workspace', async () => {
      prismaMock.phoneNumber.findUnique.mockResolvedValue(null);

      await expect(service.updateNumber('ws-1', 'pn-missing', { vendorId: 'v-1' })).rejects.toThrow(
        'Phone number not found',
      );
    });

    it('should throw NotFoundException if phone number belongs to another workspace', async () => {
      prismaMock.phoneNumber.findUnique.mockResolvedValue({
        id: 'pn-other-ws',
        workspace_id: 'ws-2',
        status: PhoneNumberStatus.ACTIVE,
      });

      await expect(service.updateNumber('ws-1', 'pn-other-ws', { vendorId: 'v-1' })).rejects.toThrow(
        'Phone number not found',
      );
    });

    it('should throw BadRequestException if phone number is RELEASED', async () => {
      prismaMock.phoneNumber.findUnique.mockResolvedValue({
        id: 'pn-released',
        workspace_id: 'ws-1',
        status: PhoneNumberStatus.RELEASED,
      });

      await expect(service.updateNumber('ws-1', 'pn-released', { vendorId: 'v-1' })).rejects.toThrow(
        'Cannot update a released phone number',
      );
    });

    it('should throw NotFoundException if vendor does not exist in the requested workspace (cross-workspace rejected)', async () => {
      prismaMock.phoneNumber.findUnique.mockResolvedValue({
        id: 'pn-1',
        workspace_id: 'ws-1',
        status: PhoneNumberStatus.ACTIVE,
      });
      prismaMock.vendor.findFirst.mockResolvedValue(null); // not found in ws-1

      await expect(service.updateNumber('ws-1', 'pn-1', { vendorId: 'v-alien' })).rejects.toThrow(
        'Vendor not found in workspace',
      );
      expect(prismaMock.phoneNumber.update).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if vendorId is empty string', async () => {
      prismaMock.phoneNumber.findUnique.mockResolvedValue({
        id: 'pn-1',
        workspace_id: 'ws-1',
        status: PhoneNumberStatus.ACTIVE,
      });

      await expect(service.updateNumber('ws-1', 'pn-1', { vendorId: '   ' })).rejects.toThrow(
        'Invalid vendorId: cannot be empty string',
      );
    });

    it('should throw BadRequestException if vendorId is an invalid type', async () => {
      prismaMock.phoneNumber.findUnique.mockResolvedValue({
        id: 'pn-1',
        workspace_id: 'ws-1',
        status: PhoneNumberStatus.ACTIVE,
      });

      await expect(service.updateNumber('ws-1', 'pn-1', { vendorId: 12345 as any })).rejects.toThrow(
        'Invalid vendorId: must be a string or null',
      );
    });

    it('should support legacy updateNumber with name string parameter', async () => {
      prismaMock.phoneNumber.findUnique.mockResolvedValue({
        id: 'pn-1',
        workspace_id: 'ws-1',
        status: PhoneNumberStatus.ACTIVE,
      });
      prismaMock.phoneNumber.update.mockResolvedValue({
        id: 'pn-1',
        name: 'Updated Name',
      });

      const result = await service.updateNumber('ws-1', 'pn-1', 'Updated Name');
      expect(result.name).toBe('Updated Name');
      expect(prismaMock.phoneNumber.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { name: 'Updated Name' },
        }),
      );
    });
  });

  describe('Vendor assigned numbers and getNumber scoping', () => {
    let permissionsService: PermissionsService;

    beforeEach(() => {
      permissionsService = (service as any).permissionsService;
    });

    it('should filter numbers to assigned vendor_id and strip provider credentials for VENDOR participant', async () => {
      vi.spyOn(permissionsService, 'getPermissionsForUser').mockResolvedValueOnce([
        { key: 'phone_number:read', scope_type: 'ASSIGNED' },
      ]);
      prismaMock.workspaceMember.findUnique.mockResolvedValue({
        id: 'mem-vendor-1',
        workspace_id: 'ws-1',
        user_id: 'user-vendor-1',
        participant_type: 'VENDOR',
        vendor_id: 'vendor-123',
      });
      prismaMock.phoneNumber.findMany.mockImplementation(async (args: any) => {
        if (args.where?.status === PhoneNumberStatus.PROVISIONING) return [];
        return [
          {
            id: 'pn-v1',
            phone_number: '+15551112222',
            vendor_id: 'vendor-123',
            provider_number_id: 'secret_prov_id',
            connection_id: 'secret_conn_id',
          },
        ];
      });

      const result = await service.listWorkspaceNumbers('ws-1', 'user-vendor-1');
      expect(prismaMock.phoneNumber.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: [{ OR: [{ vendor_id: 'vendor-123' }] }],
          }),
        }),
      );
      expect(result.items).toHaveLength(1);
      expect((result.items[0] as any).provider_number_id).toBeUndefined();
      expect((result.items[0] as any).connection_id).toBeUndefined();
      expect((result.items[0] as any).vendor_id).toBe('vendor-123');
    });

    it('should fail closed when VENDOR participant has no vendor_id', async () => {
      vi.spyOn(permissionsService, 'getPermissionsForUser').mockResolvedValueOnce([
        { key: 'phone_number:read', scope_type: 'ASSIGNED' },
      ]);
      prismaMock.workspaceMember.findUnique.mockResolvedValue({
        id: 'mem-vendor-orphan',
        workspace_id: 'ws-1',
        user_id: 'user-vendor-orphan',
        participant_type: 'VENDOR',
        vendor_id: null,
      });

      const result = await service.listWorkspaceNumbers('ws-1', 'user-vendor-orphan');
      expect(result).toEqual({ items: [], total: 0 });
    });

    it('should allow vendor to get their assigned number via getNumber', async () => {
      prismaMock.phoneNumber.findUnique.mockResolvedValue({
        id: 'pn-v1',
        workspace_id: 'ws-1',
        phone_number: '+15551112222',
        status: PhoneNumberStatus.ACTIVE,
        vendor_id: 'vendor-123',
        provider_number_id: 'prov-secret',
        connection_id: 'conn-secret',
      });
      prismaMock.workspaceMember.findUnique.mockResolvedValue({
        id: 'mem-v1',
        workspace_id: 'ws-1',
        user_id: 'user-v1',
        participant_type: 'VENDOR',
        vendor_id: 'vendor-123',
      });

      const result = await service.getNumber('ws-1', 'pn-v1', 'user-v1');
      expect(result.id).toBe('pn-v1');
      expect((result as any).provider_number_id).toBeUndefined();
      expect((result as any).connection_id).toBeUndefined();
    });

    it('should throw ForbiddenException when vendor calls getNumber for number assigned to another vendor', async () => {
      prismaMock.phoneNumber.findUnique.mockResolvedValue({
        id: 'pn-v2',
        workspace_id: 'ws-1',
        phone_number: '+15559998888',
        status: PhoneNumberStatus.ACTIVE,
        vendor_id: 'vendor-OTHER',
      });
      prismaMock.workspaceMember.findUnique.mockResolvedValue({
        id: 'mem-v1',
        workspace_id: 'ws-1',
        user_id: 'user-v1',
        participant_type: 'VENDOR',
        vendor_id: 'vendor-123',
      });

      await expect(service.getNumber('ws-1', 'pn-v2', 'user-v1')).rejects.toThrow(
        'You do not have access to this phone number',
      );
    });

    it('should throw NotFoundException when getNumber target does not exist or is RELEASED', async () => {
      prismaMock.phoneNumber.findUnique.mockResolvedValue({
        id: 'pn-released',
        workspace_id: 'ws-1',
        status: PhoneNumberStatus.RELEASED,
      });

      await expect(service.getNumber('ws-1', 'pn-released', 'user-admin')).rejects.toThrow(
        'Phone number not found',
      );
    });
  });
});
