import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { PermissionsController } from './permissions.controller.js';
import { PermissionsService } from './permissions.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { WORKSPACE_ROLES_KEY } from '../authorization/workspace-roles.decorator.js';
import { REQUIRE_PERMISSION_KEY } from '../authorization/permissions.decorator.js';
import { WorkspaceRole } from '@prisma/client';

describe('PermissionsController - Authorization & RBAC', () => {
  let controller: PermissionsController;
  let service: PermissionsService;
  const reflector = new Reflector();

  beforeEach(() => {
    service = {
      getAllPermissions: vi.fn().mockResolvedValue([]),
      getMemberPermissions: vi.fn().mockResolvedValue([]),
      assignPermission: vi.fn().mockResolvedValue({ id: 'perm-1' }),
      removePermission: vi.fn().mockResolvedValue({ success: true }),
    } as any;

    controller = new PermissionsController(service);
  });

  describe('1. Controller Guards & Metadata', () => {
    it('should have JwtAuthGuard, WorkspaceRolesGuard, and PermissionsGuard at class level', () => {
      const guards = Reflect.getMetadata('__guards__', PermissionsController);
      expect(guards).toBeDefined();
      expect(guards).toHaveLength(3);
      expect(guards).toContain(JwtAuthGuard);
      expect(guards).toContain(WorkspaceRolesGuard);
      expect(guards).toContain(PermissionsGuard);
    });

    it('getAllPermissions should allow all workspace roles (OWNER, ADMIN, MEMBER, VIEWER)', () => {
      const roles = reflector.get<WorkspaceRole[]>(WORKSPACE_ROLES_KEY, controller.getAllPermissions);
      expect(roles).toEqual([
        WorkspaceRole.OWNER,
        WorkspaceRole.ADMIN,
        WorkspaceRole.MEMBER,
        WorkspaceRole.VIEWER,
      ]);
    });

    it('getMemberPermissions should require member:read permission and workspace roles', () => {
      const permission = reflector.get<string>(REQUIRE_PERMISSION_KEY, controller.getMemberPermissions);
      const roles = reflector.get<WorkspaceRole[]>(WORKSPACE_ROLES_KEY, controller.getMemberPermissions);
      expect(permission).toBe('member:read');
      expect(roles).toEqual([
        WorkspaceRole.OWNER,
        WorkspaceRole.ADMIN,
        WorkspaceRole.MEMBER,
        WorkspaceRole.VIEWER,
      ]);
    });

    it('assignPermission should require member:update permission and OWNER/ADMIN roles', () => {
      const permission = reflector.get<string>(REQUIRE_PERMISSION_KEY, controller.assignPermission);
      const roles = reflector.get<WorkspaceRole[]>(WORKSPACE_ROLES_KEY, controller.assignPermission);
      expect(permission).toBe('member:update');
      expect(roles).toEqual([WorkspaceRole.OWNER, WorkspaceRole.ADMIN]);
    });

    it('removePermission should require member:update permission and OWNER/ADMIN roles', () => {
      const permission = reflector.get<string>(REQUIRE_PERMISSION_KEY, controller.removePermission);
      const roles = reflector.get<WorkspaceRole[]>(WORKSPACE_ROLES_KEY, controller.removePermission);
      expect(permission).toBe('member:update');
      expect(roles).toEqual([WorkspaceRole.OWNER, WorkspaceRole.ADMIN]);
    });
  });

  describe('2. Method Delegations', () => {
    it('getAllPermissions delegates to service', async () => {
      await controller.getAllPermissions();
      expect(service.getAllPermissions).toHaveBeenCalled();
    });

    it('getMemberPermissions delegates to service with workspaceId and memberId', async () => {
      await controller.getMemberPermissions('ws-1', 'm-1');
      expect(service.getMemberPermissions).toHaveBeenCalledWith('ws-1', 'm-1');
    });

    it('assignPermission delegates to service with callerUserId and payload', async () => {
      const req = { user: { userId: 'caller-1' } };
      await controller.assignPermission('ws-1', 'm-1', 'call:read', { scopeType: 'ALL' }, req);
      expect(service.assignPermission).toHaveBeenCalledWith(
        'ws-1',
        'caller-1',
        'm-1',
        'call:read',
        'ALL',
        undefined,
      );
    });

    it('removePermission delegates to service with callerUserId and query params', async () => {
      const req = { user: { userId: 'caller-1' } };
      await controller.removePermission('ws-1', 'm-1', 'call:read', 'ALL', undefined as any, req);
      expect(service.removePermission).toHaveBeenCalledWith(
        'ws-1',
        'caller-1',
        'm-1',
        'call:read',
        'ALL',
        undefined,
      );
    });
  });
});
