import { PermissionsService } from '../permissions/permissions.service.js';
import { Test, TestingModule } from '@nestjs/testing';
import { RecordingsController } from './recordings.controller.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TELEPHONY_PROVIDER } from './call-controller.js';
import { FakeTelephonyProvider } from './fake.provider.js';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';

describe('RecordingsController', () => {
  let controller: RecordingsController;
  let prisma: PrismaService;
  let provider: FakeTelephonyProvider;

  beforeEach(async () => {
    provider = new FakeTelephonyProvider();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RecordingsController],
      providers: [
        { provide: PermissionsService, useValue: { getPermissionsForUser: vi.fn().mockResolvedValue([{ key: 'call:read', scope_type: 'ALL' }]) } },
        {
          provide: PrismaService,
          useValue: {
            recording: {
              findUnique: vi.fn(),
            },
            workspaceMember: {
              findUnique: vi.fn(),
            },
          },
        },
        {
          provide: TELEPHONY_PROVIDER,
          useValue: provider,
        },
        Reflector,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: vi.fn(() => true) })
      .overrideGuard(WorkspaceRolesGuard)
      .useValue({ canActivate: vi.fn(() => true) })
      .compile();

    controller = module.get<RecordingsController>(RecordingsController);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should return download url for authorized workspace recording', async () => {
    vi.spyOn(prisma.recording, 'findUnique').mockResolvedValue({
      id: 'rec-1',
      workspace_id: 'ws-1',
      call_id: 'call-1',
      provider_id: 'prov-rec-1',
      recording_url: null,
      status: 'COMPLETED',
      call: {
        workspace_id: 'ws-1',
        commercial: { buyer_id: 'buyer-1' },
      },
    } as any);

    const result = await controller.getRecordingUrl('ws-1', 'rec-1');
    expect(result).toEqual({
      url: 'https://fake.recording.url/prov-rec-1.mp3',
    });
    expect(prisma.recording.findUnique).toHaveBeenCalledWith({
      where: { id: 'rec-1' },
      include: { call: { include: { commercial: true } } },
    });
  });

  it('should fall back to recording.recording_url when provider fails', async () => {
    vi.spyOn(provider, 'getRecordingUrl').mockRejectedValueOnce(new Error('Telnyx provider error'));

    vi.spyOn(prisma.recording, 'findUnique').mockResolvedValue({
      id: 'rec-fallback',
      workspace_id: 'ws-1',
      call_id: 'call-1',
      provider_id: 'prov-rec-err',
      recording_url: 'https://storage.fallback.com/rec-fallback.mp3',
      status: 'COMPLETED',
      call: {
        workspace_id: 'ws-1',
        commercial: { buyer_id: 'buyer-1' },
      },
    } as any);

    const result = await controller.getRecordingUrl('ws-1', 'rec-fallback');
    expect(result).toEqual({
      url: 'https://storage.fallback.com/rec-fallback.mp3',
    });
  });

  it('should throw NotFoundException if recording does not belong to workspace', async () => {
    vi.spyOn(prisma.recording, 'findUnique').mockResolvedValue({
      id: 'rec-1',
      workspace_id: 'ws-different',
      call_id: 'call-1',
      provider_id: 'prov-rec-1',
      recording_url: null,
      status: 'COMPLETED',
    } as any);

    await expect(controller.getRecordingUrl('ws-1', 'rec-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('should throw NotFoundException if recording does not exist', async () => {
    vi.spyOn(prisma.recording, 'findUnique').mockResolvedValue(null);

    await expect(
      controller.getRecordingUrl('ws-1', 'rec-not-found'),
    ).rejects.toThrow(NotFoundException);
  });

  describe('Finding A (P0): Buyer Recording Authorization & Isolation', () => {
    const buyerReq = { user: { userId: 'user-buyer-1' } };

    it('should allow Buyer A to download recording attributed to Buyer A', async () => {
      vi.spyOn(prisma.workspaceMember, 'findUnique').mockResolvedValue({
        id: 'member-buyer-1',
        workspace_id: 'ws-1',
        user_id: 'user-buyer-1',
        participant_type: 'BUYER',
        buyer_id: 'buyer-1',
      } as any);

      vi.spyOn(prisma.recording, 'findUnique').mockResolvedValue({
        id: 'rec-buyer-1',
        workspace_id: 'ws-1',
        call_id: 'call-1',
        provider_id: 'prov-rec-1',
        status: 'COMPLETED',
        call: {
          workspace_id: 'ws-1',
          commercial: { buyer_id: 'buyer-1' },
        },
      } as any);

      const result = await controller.getRecordingUrl('ws-1', 'rec-buyer-1', buyerReq);
      expect(result.url).toBe('https://fake.recording.url/prov-rec-1.mp3');
    });

    it('should deny Buyer A from accessing recording attributed to competitor Buyer B', async () => {
      vi.spyOn(prisma.workspaceMember, 'findUnique').mockResolvedValue({
        id: 'member-buyer-1',
        workspace_id: 'ws-1',
        user_id: 'user-buyer-1',
        participant_type: 'BUYER',
        buyer_id: 'buyer-1',
      } as any);

      vi.spyOn(prisma.recording, 'findUnique').mockResolvedValue({
        id: 'rec-buyer-2',
        workspace_id: 'ws-1',
        call_id: 'call-2',
        provider_id: 'prov-rec-2',
        status: 'COMPLETED',
        call: {
          workspace_id: 'ws-1',
          commercial: { buyer_id: 'buyer-2' }, // Competitor buyer
        },
      } as any);

      await expect(
        controller.getRecordingUrl('ws-1', 'rec-buyer-2', buyerReq),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should fail closed when recording call has no commercial record or unassigned buyer_id', async () => {
      vi.spyOn(prisma.workspaceMember, 'findUnique').mockResolvedValue({
        id: 'member-buyer-1',
        workspace_id: 'ws-1',
        user_id: 'user-buyer-1',
        participant_type: 'BUYER',
        buyer_id: 'buyer-1',
      } as any);

      vi.spyOn(prisma.recording, 'findUnique').mockResolvedValue({
        id: 'rec-no-comm',
        workspace_id: 'ws-1',
        call_id: 'call-3',
        provider_id: 'prov-rec-3',
        status: 'COMPLETED',
        call: {
          workspace_id: 'ws-1',
          commercial: null, // Missing attribution
        },
      } as any);

      await expect(
        controller.getRecordingUrl('ws-1', 'rec-no-comm', buyerReq),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should deny cross-workspace recording requests with NotFoundException before checking attribution', async () => {
      vi.spyOn(prisma.recording, 'findUnique').mockResolvedValue({
        id: 'rec-other-ws',
        workspace_id: 'ws-other',
        call_id: 'call-4',
        provider_id: 'prov-rec-4',
        status: 'COMPLETED',
        call: {
          workspace_id: 'ws-other',
          commercial: { buyer_id: 'buyer-1' },
        },
      } as any);

      await expect(
        controller.getRecordingUrl('ws-1', 'rec-other-ws', buyerReq),
      ).rejects.toThrow(NotFoundException);
    });

    it('should allow Owner to download recording regardless of participant attribution', async () => {
      const ownerReq = { user: { userId: 'user-owner' } };

      vi.spyOn(prisma.workspaceMember, 'findUnique').mockResolvedValue({
        id: 'member-owner',
        workspace_id: 'ws-1',
        user_id: 'user-owner',
        role: 'OWNER',
        participant_type: null,
      } as any);

      vi.spyOn(prisma.recording, 'findUnique').mockResolvedValue({
        id: 'rec-any',
        workspace_id: 'ws-1',
        call_id: 'call-1',
        provider_id: 'prov-rec-1',
        status: 'COMPLETED',
        call: {
          workspace_id: 'ws-1',
          commercial: { buyer_id: 'buyer-99' },
        },
      } as any);

      const result = await controller.getRecordingUrl('ws-1', 'rec-any', ownerReq);
      expect(result.url).toBe('https://fake.recording.url/prov-rec-1.mp3');
    });

    it('should preserve Vendor access for recording attributed to Vendor', async () => {
      const vendorReq = { user: { userId: 'user-vendor-1' } };

      vi.spyOn(prisma.workspaceMember, 'findUnique').mockResolvedValue({
        id: 'member-vendor-1',
        workspace_id: 'ws-1',
        user_id: 'user-vendor-1',
        participant_type: 'VENDOR',
        vendor_id: 'vendor-1',
      } as any);

      vi.spyOn(prisma.recording, 'findUnique').mockResolvedValue({
        id: 'rec-vendor-1',
        workspace_id: 'ws-1',
        call_id: 'call-1',
        provider_id: 'prov-rec-1',
        status: 'COMPLETED',
        call: {
          workspace_id: 'ws-1',
          attribution_source: 'LEGACY_COMMERCIAL',
          commercial: { vendor_id: 'vendor-1', buyer_id: 'buyer-1' },
        },
      } as any);

      const result = await controller.getRecordingUrl('ws-1', 'rec-vendor-1', vendorReq);
      expect(result.url).toBe('https://fake.recording.url/prov-rec-1.mp3');
    });

    it('should deny Vendor access for recording attributed to another vendor', async () => {
      const vendorReq = { user: { userId: 'user-vendor-1' } };

      vi.spyOn(prisma.workspaceMember, 'findUnique').mockResolvedValue({
        id: 'member-vendor-1',
        workspace_id: 'ws-1',
        user_id: 'user-vendor-1',
        participant_type: 'VENDOR',
        vendor_id: 'vendor-1',
      } as any);

      vi.spyOn(prisma.recording, 'findUnique').mockResolvedValue({
        id: 'rec-vendor-2',
        workspace_id: 'ws-1',
        call_id: 'call-2',
        provider_id: 'prov-rec-2',
        status: 'COMPLETED',
        call: {
          workspace_id: 'ws-1',
          commercial: { vendor_id: 'vendor-other', buyer_id: 'buyer-1' },
        },
      } as any);

      await expect(
        controller.getRecordingUrl('ws-1', 'rec-vendor-2', vendorReq),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
