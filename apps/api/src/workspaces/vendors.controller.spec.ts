import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { VendorsController } from './vendors.controller.js';
import { VendorsService } from './vendors.service.js';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { REQUIRE_PERMISSION_KEY } from '../authorization/permissions.decorator.js';
import { ADMIN_BASELINE_PERMISSIONS, PERMISSIONS_LIST } from '../permissions/permissions.constants.js';
import { WorkspaceRole } from '@prisma/client';

describe('VendorsController & RBAC Permissions (Task B)', () => {
  let controller: VendorsController;
  let vendorsService: any;
  let permissionsService: any;
  let guard: PermissionsGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();

    vendorsService = {
      listVendors: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      getVendor: vi.fn().mockResolvedValue({ id: 'vendor-1', name: 'Vendor One' }),
      createVendor: vi.fn().mockImplementation((wsId, name) =>
        Promise.resolve({ id: 'vendor-new', workspace_id: wsId, name, status: 'ACTIVE' }),
      ),
      updateVendor: vi.fn(),
    };

    permissionsService = {
      hasPermission: vi.fn(),
      hasResourceScope: vi.fn(),
      getPermissionsForUser: vi.fn(),
    };

    guard = new PermissionsGuard(reflector, permissionsService);
    controller = new VendorsController(vendorsService);
  });

  function createMockContext(options: {
    user?: { userId: string };
    params?: Record<string, string>;
    body?: any;
    method?: string;
    handler?: any;
  }) {
    const req = {
      user: options.user,
      params: options.params || {},
      query: {},
      body: options.body || {},
      method: options.method || 'POST',
    };

    return {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => ({}),
      }),
      getHandler: () => options.handler || controller.create,
      getClass: () => VendorsController,
    } as any;
  }

  describe('Permission Metadata', () => {
    it('should use canonical "vendor:create" permission on create method instead of "vendor:write"', () => {
      const requiredPermission = reflector.get<string>(
        REQUIRE_PERMISSION_KEY,
        VendorsController.prototype.create,
      );

      expect(requiredPermission).toBe('vendor:create');
      expect(requiredPermission).not.toBe('vendor:write');

      // Verify vendor:create is defined in canonical PERMISSIONS_LIST
      const foundInList = PERMISSIONS_LIST.find((p) => p.key === 'vendor:create');
      expect(foundInList).toBeDefined();
      expect(foundInList?.group).toBe('VENDORS');

      // Verify vendor:write is NOT in PERMISSIONS_LIST
      const invalidFound = PERMISSIONS_LIST.find((p) => p.key === 'vendor:write');
      expect(invalidFound).toBeUndefined();
    });

    it('should verify ADMIN_BASELINE_PERMISSIONS includes "vendor:create"', () => {
      expect(ADMIN_BASELINE_PERMISSIONS).toContain('vendor:create');
      expect(ADMIN_BASELINE_PERMISSIONS).not.toContain('vendor:write');
    });

    it('should verify Owner-only financial permissions remain strictly excluded from ADMIN_BASELINE_PERMISSIONS', () => {
      // Invariant: settlement:generate, payment:manage, reconciliation:run must NEVER be in Admin baseline
      expect(ADMIN_BASELINE_PERMISSIONS).not.toContain('settlement:generate');
      expect(ADMIN_BASELINE_PERMISSIONS).not.toContain('payment:manage');
      expect(ADMIN_BASELINE_PERMISSIONS).not.toContain('reconciliation:run');
    });
  });

  describe('PermissionsGuard & Controller Execution', () => {
    it('should allow Admin user with "vendor:create" permission to create vendor', async () => {
      const wsId = 'ws-admin-1';
      const userId = 'user-admin-1';

      permissionsService.hasPermission.mockImplementation(
        async (targetWsId: string, targetUserId: string, perm: string) => {
          if (targetWsId === wsId && targetUserId === userId && perm === 'vendor:create') {
            return true;
          }
          return false;
        },
      );

      const context = createMockContext({
        user: { userId },
        params: { workspaceId: wsId },
        body: { name: 'Acme Calls' },
        handler: controller.create,
      });

      const canActivate = await guard.canActivate(context);
      expect(canActivate).toBe(true);

      const result = await controller.create(wsId, { name: 'Acme Calls' });
      expect(result).toEqual({
        id: 'vendor-new',
        workspace_id: wsId,
        name: 'Acme Calls',
        status: 'ACTIVE',
      });
      expect(vendorsService.createVendor).toHaveBeenCalledWith(wsId, 'Acme Calls');
    });

    it('should deny users lacking "vendor:create" permission with 403 Forbidden', async () => {
      const wsId = 'ws-1';
      const userId = 'user-no-perm';

      permissionsService.hasPermission.mockResolvedValue(false);

      const context = createMockContext({
        user: { userId },
        params: { workspaceId: wsId },
        body: { name: 'Unauthorized Vendor' },
        handler: controller.create,
      });

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      expect(vendorsService.createVendor).not.toHaveBeenCalled();
    });

    it('should deny cross-workspace vendor creation attempts', async () => {
      const authorizedWsId = 'ws-auth';
      const foreignWsId = 'ws-foreign';
      const userId = 'user-1';

      // User has permissions in ws-auth, but NOT in ws-foreign
      permissionsService.hasPermission.mockImplementation(
        async (targetWsId: string) => targetWsId === authorizedWsId,
      );

      const context = createMockContext({
        user: { userId },
        params: { workspaceId: foreignWsId },
        body: { name: 'Hacked Vendor' },
        handler: controller.create,
      });

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      expect(vendorsService.createVendor).not.toHaveBeenCalled();
    });

    it('should deny unauthenticated requests missing user identity', async () => {
      const context = createMockContext({
        user: undefined,
        params: { workspaceId: 'ws-1' },
        body: { name: 'Anon Vendor' },
        handler: controller.create,
      });

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('should deny requests missing workspaceId', async () => {
      const context = createMockContext({
        user: { userId: 'user-1' },
        params: {},
        body: { name: 'No Ws Vendor' },
        handler: controller.create,
      });

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });
  });
});
