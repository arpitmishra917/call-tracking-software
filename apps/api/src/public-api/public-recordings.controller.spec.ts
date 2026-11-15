import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PublicRecordingsController } from './public-recordings.controller.js';
import { NotFoundException, ForbiddenException } from '@nestjs/common';

describe('PublicRecordingsController (V3 Security: Row-Level Participant Scoping & IDOR Prevention)', () => {
  let controller: PublicRecordingsController;
  let prisma: any;
  let telephonyProvider: any;

  beforeEach(() => {
    prisma = {
      recording: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
      },
      workspaceMember: {
        findUnique: vi.fn(),
      },
    };

    telephonyProvider = {
      getRecordingUrl: vi.fn().mockResolvedValue('https://storage.provider.com/signed-recording-url'),
    };

    controller = new PublicRecordingsController(prisma as any, telephonyProvider as any);
  });

  describe('listRecordings', () => {
    it('should scope recordings to the vendor when caller is a VENDOR member', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        id: 'member-v1',
        workspace_id: 'ws-1',
        user_id: 'user-v1',
        participant_type: 'VENDOR',
        vendor_id: 'vendor-123',
      });

      const mockRecordings = [
        { id: 'rec-1', workspace_id: 'ws-1', provider_id: 'prov-1' },
      ];
      prisma.recording.findMany.mockResolvedValue(mockRecordings);

      const req = { user: { userId: 'user-v1', role: 'API_KEY' } };
      const res = await controller.listRecordings('ws-1', req);

      expect(prisma.recording.findMany).toHaveBeenCalledWith({
        where: {
          workspace_id: 'ws-1',
          call: {
            workspace_id: 'ws-1',
            OR: [
              {
                attribution_source: 'INGRESS_ASSIGNED',
                attributed_vendor_id: 'vendor-123',
              },
              {
                attribution_source: 'LEGACY_COMMERCIAL',
                commercial: {
                  vendor_id: 'vendor-123',
                },
              },
            ],
          },
        },
        orderBy: { created_at: 'desc' },
        take: 50,
      });
      expect(res).toEqual(mockRecordings);
    });

    it('should return empty list if VENDOR member has no assigned vendor_id', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        id: 'member-v-unassigned',
        workspace_id: 'ws-1',
        user_id: 'user-v-unassigned',
        participant_type: 'VENDOR',
        vendor_id: null,
      });

      const req = { user: { userId: 'user-v-unassigned', role: 'API_KEY' } };
      const res = await controller.listRecordings('ws-1', req);

      expect(res).toEqual([]);
      expect(prisma.recording.findMany).not.toHaveBeenCalled();
    });

    it('should scope recordings to the buyer when caller is a BUYER member', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        id: 'member-b1',
        workspace_id: 'ws-1',
        user_id: 'user-b1',
        participant_type: 'BUYER',
        buyer_id: 'buyer-456',
      });

      prisma.recording.findMany.mockResolvedValue([]);

      const req = { user: { userId: 'user-b1', role: 'API_KEY' } };
      await controller.listRecordings('ws-1', req);

      expect(prisma.recording.findMany).toHaveBeenCalledWith({
        where: {
          workspace_id: 'ws-1',
          call: {
            commercial: {
              buyer_id: 'buyer-456',
            },
          },
        },
        orderBy: { created_at: 'desc' },
        take: 50,
      });
    });

    it('should preserve unrestricted workspace queries for internal ADMIN / OWNER API keys', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        id: 'member-admin',
        workspace_id: 'ws-1',
        user_id: 'user-admin',
        participant_type: 'INTERNAL',
        role: 'ADMIN',
      });

      prisma.recording.findMany.mockResolvedValue([]);

      const req = { user: { userId: 'user-admin', role: 'API_KEY' } };
      await controller.listRecordings('ws-1', req);

      expect(prisma.recording.findMany).toHaveBeenCalledWith({
        where: {
          workspace_id: 'ws-1',
        },
        orderBy: { created_at: 'desc' },
        take: 50,
      });
    });
  });

  describe('getRecording (Single recording retrieval & IDOR protection)', () => {
    it('should allow a Vendor API key to retrieve own recording', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        id: 'member-v1',
        workspace_id: 'ws-1',
        user_id: 'user-v1',
        participant_type: 'VENDOR',
        vendor_id: 'vendor-123',
      });

      prisma.recording.findUnique.mockResolvedValue({
        id: 'rec-1',
        workspace_id: 'ws-1',
        provider_id: 'prov-1',
        duration_secs: 45,
        call: {
          id: 'call-1',
          workspace_id: 'ws-1',
          attribution_source: 'LEGACY_COMMERCIAL',
          commercial: {
            vendor_id: 'vendor-123',
          },
        },
      });

      const req = { user: { userId: 'user-v1', role: 'API_KEY' } };
      const res = await controller.getRecording('ws-1', 'rec-1', req);

      expect(res.id).toBe('rec-1');
      expect(res.url).toBe('https://storage.provider.com/signed-recording-url');
      expect(res.duration_secs).toBe(45);
      expect((res as any).call).toBeUndefined(); // nested relational call data is stripped
    });

    it('should reject a Vendor API key attempting to retrieve another Vendor recording with ForbiddenException', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        id: 'member-v1',
        workspace_id: 'ws-1',
        user_id: 'user-v1',
        participant_type: 'VENDOR',
        vendor_id: 'vendor-123',
      });

      prisma.recording.findUnique.mockResolvedValue({
        id: 'rec-competitor',
        workspace_id: 'ws-1',
        provider_id: 'prov-competitor',
        call: {
          id: 'call-competitor',
          commercial: {
            vendor_id: 'vendor-competitor-999',
          },
        },
      });

      const req = { user: { userId: 'user-v1', role: 'API_KEY' } };
      await expect(controller.getRecording('ws-1', 'rec-competitor', req)).rejects.toThrow(ForbiddenException);
    });

    it('should reject a Vendor API key attempting to retrieve a recording without commercial vendor attribution', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        id: 'member-v1',
        workspace_id: 'ws-1',
        user_id: 'user-v1',
        participant_type: 'VENDOR',
        vendor_id: 'vendor-123',
      });

      prisma.recording.findUnique.mockResolvedValue({
        id: 'rec-internal',
        workspace_id: 'ws-1',
        provider_id: 'prov-internal',
        call: {
          id: 'call-internal',
          commercial: null,
        },
      });

      const req = { user: { userId: 'user-v1', role: 'API_KEY' } };
      await expect(controller.getRecording('ws-1', 'rec-internal', req)).rejects.toThrow(ForbiddenException);
    });

    it('should allow an Admin API key to retrieve any workspace recording', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        id: 'member-admin',
        workspace_id: 'ws-1',
        user_id: 'user-admin',
        participant_type: 'INTERNAL',
        role: 'ADMIN',
      });

      prisma.recording.findUnique.mockResolvedValue({
        id: 'rec-any',
        workspace_id: 'ws-1',
        provider_id: 'prov-any',
        call: {
          id: 'call-any',
          commercial: { vendor_id: 'vendor-xyz' },
        },
      });

      const req = { user: { userId: 'user-admin', role: 'API_KEY' } };
      const res = await controller.getRecording('ws-1', 'rec-any', req);

      expect(res.id).toBe('rec-any');
      expect(res.url).toBe('https://storage.provider.com/signed-recording-url');
    });

    it('should throw NotFoundException if recording does not exist or workspace mismatch', async () => {
      prisma.recording.findUnique.mockResolvedValue({
        id: 'rec-other-ws',
        workspace_id: 'ws-DIFFERENT',
        provider_id: 'prov-diff',
      });

      const req = { user: { userId: 'user-v1', role: 'API_KEY' } };
      await expect(controller.getRecording('ws-1', 'rec-other-ws', req)).rejects.toThrow(NotFoundException);
    });
  });
});
