import { Test, TestingModule } from '@nestjs/testing';
import { VendorsService } from './vendors.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('VendorsService', () => {
  let service: VendorsService;
  let prisma: PrismaService;
  let permissionsService: PermissionsService;

  const mockWorkspaceId = 'ws-test-123';
  const mockUserId = 'user-test-456';
  const mockVendorId = 'vendor-test-789';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VendorsService,
        {
          provide: PrismaService,
          useValue: {
            vendor: {
              findMany: vi.fn(),
              findFirst: vi.fn(),
              findUnique: vi.fn(),
              create: vi.fn(),
              update: vi.fn(),
              count: vi.fn(),
            },
            workspaceMember: {
              findUnique: vi.fn(),
            },
          },
        },
        {
          provide: PermissionsService,
          useValue: {
            getPermissionsForUser: vi.fn(),
            hasPermission: vi.fn(),
            hasResourceScope: vi.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<VendorsService>(VendorsService);
    prisma = module.get<PrismaService>(PrismaService);
    permissionsService = module.get<PermissionsService>(PermissionsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createVendor', () => {
    it('creates a vendor successfully with default ACTIVE status', async () => {
      const mockCreated = {
        id: mockVendorId,
        workspace_id: mockWorkspaceId,
        name: 'Lead Gen Partner LLC',
        status: 'ACTIVE',
        created_at: new Date(),
        updated_at: new Date(),
      };
      vi.mocked(prisma.vendor.create).mockResolvedValue(mockCreated as any);

      const result = await service.createVendor(mockWorkspaceId, '  Lead Gen Partner LLC  ');

      expect(prisma.vendor.create).toHaveBeenCalledWith({
        data: {
          workspace_id: mockWorkspaceId,
          name: 'Lead Gen Partner LLC',
          status: 'ACTIVE',
        },
      });
      expect(result).toEqual(mockCreated);
    });

    it('throws BadRequestException if name is empty or only whitespace', async () => {
      await expect(service.createVendor(mockWorkspaceId, '')).rejects.toThrow(BadRequestException);
      await expect(service.createVendor(mockWorkspaceId, '   ')).rejects.toThrow(BadRequestException);
    });
  });

  describe('listVendors', () => {
    it('throws ForbiddenException if user lacks vendor:read permission', async () => {
      vi.mocked(permissionsService.getPermissionsForUser).mockResolvedValue([]);

      await expect(service.listVendors(mockWorkspaceId, mockUserId)).rejects.toThrow(ForbiddenException);
    });

    it('returns all vendors when user has ALL scope', async () => {
      vi.mocked(permissionsService.getPermissionsForUser).mockResolvedValue([
        { key: 'vendor:read', scope_type: 'ALL', resource_id: null } as any,
      ]);
      const mockItems = [
        { id: 'v-1', workspace_id: mockWorkspaceId, name: 'Vendor A', status: 'ACTIVE' },
        { id: 'v-2', workspace_id: mockWorkspaceId, name: 'Vendor B', status: 'INACTIVE' },
      ];
      vi.mocked(prisma.vendor.findMany).mockResolvedValue(mockItems as any);
      vi.mocked(prisma.vendor.count).mockResolvedValue(2);

      const result = await service.listVendors(mockWorkspaceId, mockUserId);

      expect(prisma.vendor.findMany).toHaveBeenCalledWith({
        where: { workspace_id: mockWorkspaceId },
        orderBy: { created_at: 'desc' },
        skip: 0,
        take: 50,
      });
      expect(result).toEqual({ items: mockItems, total: 2 });
    });

    it('filters vendors by search and status, applying pagination', async () => {
      vi.mocked(permissionsService.getPermissionsForUser).mockResolvedValue([
        { key: 'vendor:read', scope_type: 'ALL', resource_id: null } as any,
      ]);
      vi.mocked(prisma.vendor.findMany).mockResolvedValue([]);
      vi.mocked(prisma.vendor.count).mockResolvedValue(0);

      await service.listVendors(mockWorkspaceId, mockUserId, {
        search: 'Traffic',
        status: 'ACTIVE',
        limit: 10,
        offset: 20,
      });

      expect(prisma.vendor.findMany).toHaveBeenCalledWith({
        where: {
          workspace_id: mockWorkspaceId,
          name: { contains: 'Traffic', mode: 'insensitive' },
          status: 'ACTIVE',
        },
        orderBy: { created_at: 'desc' },
        skip: 20,
        take: 10,
      });
    });

    it('scopes list to assigned vendor when user has ASSIGNED scope', async () => {
      vi.mocked(permissionsService.getPermissionsForUser).mockResolvedValue([
        { key: 'vendor:read', scope_type: 'ASSIGNED', resource_id: null } as any,
      ]);
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({
        id: 'member-1',
        workspace_id: mockWorkspaceId,
        user_id: mockUserId,
        vendor_id: 'v-assigned',
      } as any);

      vi.mocked(prisma.vendor.findMany).mockResolvedValue([
        { id: 'v-assigned', workspace_id: mockWorkspaceId, name: 'Assigned Vendor', status: 'ACTIVE' } as any,
      ]);
      vi.mocked(prisma.vendor.count).mockResolvedValue(1);

      const result = await service.listVendors(mockWorkspaceId, mockUserId);

      expect(prisma.vendor.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            workspace_id: mockWorkspaceId,
            AND: [{ OR: [{ id: 'v-assigned' }] }],
          }),
        })
      );
      expect(result.items).toHaveLength(1);
    });

    it('returns empty list if ASSIGNED user has no linked vendor', async () => {
      vi.mocked(permissionsService.getPermissionsForUser).mockResolvedValue([
        { key: 'vendor:read', scope_type: 'ASSIGNED', resource_id: null } as any,
      ]);
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({
        id: 'member-1',
        workspace_id: mockWorkspaceId,
        user_id: mockUserId,
        vendor_id: null,
      } as any);

      const result = await service.listVendors(mockWorkspaceId, mockUserId);
      expect(result).toEqual({ items: [], total: 0 });
      expect(prisma.vendor.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getVendor', () => {
    it('returns vendor with associated phone numbers if exists in workspace', async () => {
      const mockVendor = {
        id: mockVendorId,
        workspace_id: mockWorkspaceId,
        name: 'Vendor Partner',
        status: 'ACTIVE',
        phone_numbers: [
          { id: 'pn-1', phone_number: '+15551234567', campaign: { id: 'c-1', name: 'Main Campaign' } },
        ],
      };
      vi.mocked(prisma.vendor.findFirst).mockResolvedValue(mockVendor as any);

      const result = await service.getVendor(mockWorkspaceId, mockVendorId);

      expect(prisma.vendor.findFirst).toHaveBeenCalledWith({
        where: { id: mockVendorId, workspace_id: mockWorkspaceId },
        include: {
          phone_numbers: {
            include: {
              campaign: true,
            },
          },
        },
      });
      expect(result).toEqual(mockVendor);
    });

    it('enforces tenant isolation and throws NotFoundException for cross-workspace or non-existent vendor', async () => {
      vi.mocked(prisma.vendor.findFirst).mockResolvedValue(null);

      await expect(service.getVendor('other-workspace', mockVendorId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateVendor', () => {
    it('updates vendor name and status', async () => {
      const existingVendor = {
        id: mockVendorId,
        workspace_id: mockWorkspaceId,
        name: 'Old Vendor Name',
        status: 'ACTIVE',
      };
      vi.mocked(prisma.vendor.findFirst).mockResolvedValue(existingVendor as any);
      vi.mocked(prisma.vendor.update).mockResolvedValue({
        ...existingVendor,
        name: 'New Vendor Name',
        status: 'INACTIVE',
      } as any);

      const result = await service.updateVendor(mockWorkspaceId, mockVendorId, {
        name: 'New Vendor Name',
        status: 'INACTIVE',
      });

      expect(prisma.vendor.update).toHaveBeenCalledWith({
        where: { id: mockVendorId },
        data: {
          name: 'New Vendor Name',
          status: 'INACTIVE',
        },
      });
      expect(result.name).toBe('New Vendor Name');
      expect(result.status).toBe('INACTIVE');
    });

    it('throws BadRequestException if update name is empty', async () => {
      vi.mocked(prisma.vendor.findFirst).mockResolvedValue({
        id: mockVendorId,
        workspace_id: mockWorkspaceId,
        name: 'Existing',
        status: 'ACTIVE',
      } as any);

      await expect(
        service.updateVendor(mockWorkspaceId, mockVendorId, { name: '   ' })
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException if status is invalid', async () => {
      vi.mocked(prisma.vendor.findFirst).mockResolvedValue({
        id: mockVendorId,
        workspace_id: mockWorkspaceId,
        name: 'Existing',
        status: 'ACTIVE',
      } as any);

      await expect(
        service.updateVendor(mockWorkspaceId, mockVendorId, { status: 'DELETED' })
      ).rejects.toThrow(BadRequestException);
    });

    it('enforces tenant isolation during update', async () => {
      vi.mocked(prisma.vendor.findFirst).mockResolvedValue(null);

      await expect(
        service.updateVendor('cross-workspace-id', mockVendorId, { name: 'Attempt' })
      ).rejects.toThrow(NotFoundException);
    });
  });
});
