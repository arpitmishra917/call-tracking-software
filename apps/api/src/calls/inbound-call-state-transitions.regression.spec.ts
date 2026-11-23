import { vi, describe, it, expect, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CallsService, VALID_CALL_TRANSITIONS, VALID_ATTEMPT_TRANSITIONS } from './calls.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsageService } from '../usage/usage.service.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { CallState, CallAttemptState, UsageType } from '@prisma/client';

describe('Layer 1 & 2 Regression: Inbound Call State Transitions & Lifecycle Invariants', () => {
  let callsService: CallsService;
  let prismaMock: any;
  let usageServiceMock: any;
  let webhooksServiceMock: any;
  let permissionsServiceMock: any;

  const mockWorkspaceId = 'ws-reg-001';
  const mockCallId = 'call-reg-101';
  const mockAttemptId = 'att-reg-201';
  const mockProviderCallId = 'telnyx-call-301';

  beforeEach(async () => {
    prismaMock = {
      call: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
      },
      callAttempt: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      buyerReservation: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue({ id: 'res-reg-1' }),
        count: vi.fn().mockResolvedValue(0),
      },
      workspaceMember: {
        findUnique: vi.fn(),
      },
      $queryRaw: vi.fn().mockResolvedValue([]),
      $transaction: vi.fn(async (cb) => {
        if (typeof cb === 'function') {
          return cb(prismaMock);
        }
        return cb;
      }),
    };

    usageServiceMock = {
      recordUsage: vi.fn().mockResolvedValue({}),
      trackUsage: vi.fn().mockResolvedValue({}),
    };

    webhooksServiceMock = {
      queueEvent: vi.fn().mockResolvedValue({}),
    };

    permissionsServiceMock = {
      getPermissionsForUser: vi.fn().mockResolvedValue([{ key: 'call:read', scope_type: 'ALL' }]),
      hasPermission: vi.fn().mockResolvedValue(true),
      hasResourceScope: vi.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CallsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: UsageService, useValue: usageServiceMock },
        { provide: WebhooksService, useValue: webhooksServiceMock },
        { provide: PermissionsService, useValue: permissionsServiceMock },
      ],
    }).compile();

    callsService = module.get<CallsService>(CallsService);
  });

  describe('Inbound Call Creation & Attribution Integrity', () => {
    it('creates call in INITIATED state with vendor attribution snapshot and fires call.started webhook', async () => {
      const callData = {
        workspace_id: mockWorkspaceId,
        campaign_id: 'camp-reg-1',
        phone_number_id: 'pn-reg-1',
        vendor_id: 'ven-reg-1',
        attributed_vendor_id: 'ven-reg-1',
        attribution_source: 'INGRESS_ASSIGNED',
        provider: 'telnyx',
        provider_call_id: mockProviderCallId,
        from_number: '+15551234567',
        to_number: '+15559876543',
      };

      const createdCall = {
        id: mockCallId,
        ...callData,
        state: CallState.INITIATED,
        created_at: new Date(),
      };
      prismaMock.call.create.mockResolvedValue(createdCall);

      const result = await callsService.createCall(callData);

      expect(result.state).toBe(CallState.INITIATED);
      expect(prismaMock.call.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          workspace_id: mockWorkspaceId,
          state: CallState.INITIATED,
          vendor_id: 'ven-reg-1',
          attributed_vendor_id: 'ven-reg-1',
          attribution_source: 'INGRESS_ASSIGNED',
        }),
      });
      expect(webhooksServiceMock.queueEvent).toHaveBeenCalledWith(
        mockWorkspaceId,
        'call.started',
        createdCall,
      );
    });
  });

  describe('Call State Transitions & Illegal Jump Deflection', () => {
    it('allows valid transition INITIATED -> ROUTING', async () => {
      prismaMock.call.findUnique.mockResolvedValue({
        id: mockCallId,
        state: CallState.INITIATED,
        workspace_id: mockWorkspaceId,
      });
      prismaMock.call.update.mockResolvedValue({
        id: mockCallId,
        state: CallState.ROUTING,
        workspace_id: mockWorkspaceId,
      });

      const updated = await callsService.transitionCall(mockCallId, CallState.ROUTING);

      expect(updated.state).toBe(CallState.ROUTING);
      expect(prismaMock.call.update).toHaveBeenCalledWith({
        where: { id: mockCallId },
        data: { state: CallState.ROUTING },
      });
    });

    it('allows valid transition ROUTING -> COMPLETED and queues call.answered webhook', async () => {
      prismaMock.call.findUnique.mockResolvedValue({
        id: mockCallId,
        state: CallState.ROUTING,
        workspace_id: mockWorkspaceId,
      });
      const completedCall = {
        id: mockCallId,
        state: CallState.COMPLETED,
        workspace_id: mockWorkspaceId,
        duration_secs: 45,
      };
      prismaMock.call.update.mockResolvedValue(completedCall);

      const updated = await callsService.transitionCall(mockCallId, CallState.COMPLETED, 45);

      expect(updated.state).toBe(CallState.COMPLETED);
      expect(webhooksServiceMock.queueEvent).toHaveBeenCalledWith(
        mockWorkspaceId,
        'call.answered',
        completedCall,
      );
    });

    it('allows valid transition ROUTING -> FAILED and queues call.blocked webhook', async () => {
      prismaMock.call.findUnique.mockResolvedValue({
        id: mockCallId,
        state: CallState.ROUTING,
        workspace_id: mockWorkspaceId,
      });
      const failedCall = {
        id: mockCallId,
        state: CallState.FAILED,
        workspace_id: mockWorkspaceId,
      };
      prismaMock.call.update.mockResolvedValue(failedCall);

      const updated = await callsService.transitionCall(mockCallId, CallState.FAILED);

      expect(updated.state).toBe(CallState.FAILED);
      expect(webhooksServiceMock.queueEvent).toHaveBeenCalledWith(
        mockWorkspaceId,
        'call.blocked',
        failedCall,
      );
    });

    it('rejects illegal jump INITIATED -> COMPLETED (cannot bypass ROUTING)', async () => {
      prismaMock.call.findUnique.mockResolvedValue({
        id: mockCallId,
        state: CallState.INITIATED,
        workspace_id: mockWorkspaceId,
      });

      await expect(
        callsService.transitionCall(mockCallId, CallState.COMPLETED),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects illegal jump COMPLETED -> ROUTING (terminal state immutability)', async () => {
      prismaMock.call.findUnique.mockResolvedValue({
        id: mockCallId,
        state: CallState.COMPLETED,
        workspace_id: mockWorkspaceId,
      });

      await expect(
        callsService.transitionCall(mockCallId, CallState.ROUTING),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects illegal jump FAILED -> COMPLETED (terminal state immutability)', async () => {
      prismaMock.call.findUnique.mockResolvedValue({
        id: mockCallId,
        state: CallState.FAILED,
        workspace_id: mockWorkspaceId,
      });

      await expect(
        callsService.transitionCall(mockCallId, CallState.COMPLETED),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows idempotent self-transition without throwing (COMPLETED -> COMPLETED)', async () => {
      prismaMock.call.findUnique.mockResolvedValue({
        id: mockCallId,
        state: CallState.COMPLETED,
        workspace_id: mockWorkspaceId,
      });
      prismaMock.call.update.mockResolvedValue({
        id: mockCallId,
        state: CallState.COMPLETED,
        workspace_id: mockWorkspaceId,
      });

      const updated = await callsService.transitionCall(mockCallId, CallState.COMPLETED);
      expect(updated.state).toBe(CallState.COMPLETED);
    });

    it('throws NotFoundException when transitionCall references non-existent call', async () => {
      prismaMock.call.findUnique.mockResolvedValue(null);

      await expect(
        callsService.transitionCall('missing-call-id', CallState.ROUTING),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('CallAttempt State Transitions & Reservation Release', () => {
    it('allows valid attempt progression INITIATED -> RINGING -> ANSWERED -> COMPLETED', async () => {
      // 1. INITIATED -> RINGING
      prismaMock.callAttempt.findUnique.mockResolvedValue({
        id: mockAttemptId,
        call_id: mockCallId,
        state: CallAttemptState.INITIATED,
      });
      prismaMock.callAttempt.update.mockResolvedValue({
        id: mockAttemptId,
        call_id: mockCallId,
        state: CallAttemptState.RINGING,
      });

      let attempt = await callsService.transitionAttempt(mockAttemptId, CallAttemptState.RINGING);
      expect(attempt.state).toBe(CallAttemptState.RINGING);

      // 2. RINGING -> ANSWERED
      prismaMock.callAttempt.findUnique.mockResolvedValue({
        id: mockAttemptId,
        call_id: mockCallId,
        state: CallAttemptState.RINGING,
      });
      prismaMock.callAttempt.update.mockResolvedValue({
        id: mockAttemptId,
        call_id: mockCallId,
        state: CallAttemptState.ANSWERED,
      });

      attempt = await callsService.transitionAttempt(mockAttemptId, CallAttemptState.ANSWERED);
      expect(attempt.state).toBe(CallAttemptState.ANSWERED);

      // 3. ANSWERED -> COMPLETED (terminal attempt state releases buyer reservation)
      prismaMock.callAttempt.findUnique.mockResolvedValue({
        id: mockAttemptId,
        call_id: mockCallId,
        state: CallAttemptState.ANSWERED,
      });
      const completedAttempt = {
        id: mockAttemptId,
        call_id: mockCallId,
        state: CallAttemptState.COMPLETED,
        duration_secs: 60,
      };
      prismaMock.callAttempt.update.mockResolvedValue(completedAttempt);
      prismaMock.call.findUnique.mockResolvedValue({
        id: mockCallId,
        workspace_id: mockWorkspaceId,
      });

      attempt = await callsService.transitionAttempt(mockAttemptId, CallAttemptState.COMPLETED, 60);
      expect(attempt.state).toBe(CallAttemptState.COMPLETED);
      // Verify reservation release on terminal attempt
      expect(prismaMock.buyerReservation.updateMany).toHaveBeenCalledWith({
        where: {
          attempt_id: mockAttemptId,
          status: 'ACTIVE',
        },
        data: {
          status: 'RELEASED',
        },
      });
      expect(webhooksServiceMock.queueEvent).toHaveBeenCalledWith(
        mockWorkspaceId,
        'call.attempt.ended',
        completedAttempt,
      );
    });

    it('rejects illegal attempt transition ANSWERED -> RINGING', async () => {
      prismaMock.callAttempt.findUnique.mockResolvedValue({
        id: mockAttemptId,
        call_id: mockCallId,
        state: CallAttemptState.ANSWERED,
      });

      await expect(
        callsService.transitionAttempt(mockAttemptId, CallAttemptState.RINGING),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects illegal attempt transition COMPLETED -> ANSWERED', async () => {
      prismaMock.callAttempt.findUnique.mockResolvedValue({
        id: mockAttemptId,
        call_id: mockCallId,
        state: CallAttemptState.COMPLETED,
      });

      await expect(
        callsService.transitionAttempt(mockAttemptId, CallAttemptState.ANSWERED),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects creating new attempt on a call already in terminal state', async () => {
      prismaMock.call.findUnique.mockResolvedValue({
        id: mockCallId,
        state: CallState.COMPLETED,
        workspace_id: mockWorkspaceId,
      });

      await expect(
        callsService.createCallAttempt({
          call_id: mockCallId,
          buyer_id: 'buyer-reg-1',
        }),
      ).rejects.toThrow(/terminal state/i);
    });
  });

  describe('markCallAnswered & handleBridgeFailure Lifecycles', () => {
    it('markCallAnswered synchronously marks call COMPLETED, attempt ANSWERED, and queues call.answered', async () => {
      prismaMock.call.findUnique.mockResolvedValue({
        id: mockCallId,
        state: CallState.ROUTING,
        workspace_id: mockWorkspaceId,
      });
      prismaMock.callAttempt.findUnique.mockResolvedValue({
        id: mockAttemptId,
        state: CallAttemptState.RINGING,
      });
      const answeredCall = {
        id: mockCallId,
        state: CallState.COMPLETED,
        answered_at: new Date(),
        workspace_id: mockWorkspaceId,
      };
      prismaMock.call.update.mockResolvedValue(answeredCall);

      const answered = await callsService.markCallAnswered(mockCallId, mockAttemptId);

      expect(answered).toBe(true);
      expect(prismaMock.callAttempt.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockAttemptId },
          data: expect.objectContaining({ state: CallAttemptState.ANSWERED }),
        }),
      );
      expect(prismaMock.call.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockCallId },
          data: expect.objectContaining({ state: CallState.COMPLETED }),
        }),
      );
      expect(webhooksServiceMock.queueEvent).toHaveBeenCalledWith(
        mockWorkspaceId,
        'call.answered',
        answeredCall,
      );
    });

    it('markCallAnswered returns false safely if call is no longer in ROUTING', async () => {
      prismaMock.call.findUnique.mockResolvedValue({
        id: mockCallId,
        state: CallState.CANCELED,
        workspace_id: mockWorkspaceId,
      });
      prismaMock.callAttempt.findUnique.mockResolvedValue({
        id: mockAttemptId,
        state: CallAttemptState.RINGING,
      });

      const answered = await callsService.markCallAnswered(mockCallId, mockAttemptId);
      expect(answered).toBe(false);
      expect(prismaMock.call.update).not.toHaveBeenCalled();
    });

    it('handleBridgeFailure resets call state back to ROUTING, fails attempt, and releases reservation', async () => {
      prismaMock.callAttempt.update.mockResolvedValue({
        id: mockAttemptId,
        state: CallAttemptState.FAILED,
      });
      const routingCall = {
        id: mockCallId,
        state: CallState.ROUTING,
        answered_at: null,
        attempts: [],
      };
      prismaMock.call.update.mockResolvedValue(routingCall);

      const result = await callsService.handleBridgeFailure(mockCallId, mockAttemptId);

      expect(result.state).toBe(CallState.ROUTING);
      expect(prismaMock.callAttempt.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockAttemptId },
          data: expect.objectContaining({ state: CallAttemptState.FAILED }),
        }),
      );
      expect(prismaMock.buyerReservation.updateMany).toHaveBeenCalledWith({
        where: { attempt_id: mockAttemptId, status: 'ACTIVE' },
        data: { status: 'RELEASED' },
      });
    });
  });

  describe('handleCallerHangup & handleBuyerHangup Idempotency', () => {
    it('handleCallerHangup idempotently returns without mutation when call is already finalized', async () => {
      const alreadyFinalizedCall = {
        id: mockCallId,
        provider_call_id: mockProviderCallId,
        state: CallState.COMPLETED,
        ended_at: new Date('2026-01-01T12:05:00Z'),
        duration_secs: 120,
        attempts: [],
      };
      prismaMock.call.findUnique.mockResolvedValue(alreadyFinalizedCall);

      const result = await callsService.handleCallerHangup(mockProviderCallId, 120);

      expect(result).toEqual(alreadyFinalizedCall);
      expect(prismaMock.call.update).not.toHaveBeenCalled();
      expect(usageServiceMock.recordUsage).not.toHaveBeenCalled();
    });

    it('handleCallerHangup finalizes INITIATED/ROUTING call to CANCELED, cleans attempts, releases reservations, and records usage', async () => {
      const activeCall = {
        id: mockCallId,
        provider_call_id: mockProviderCallId,
        state: CallState.ROUTING,
        workspace_id: mockWorkspaceId,
        ended_at: null,
        duration_secs: null,
        answered_at: new Date(Date.now() - 30000), // answered 30s ago
        attempts: [
          {
            id: 'attempt-1',
            state: CallAttemptState.RINGING,
            answered_at: null,
            duration_secs: null,
          },
        ],
      };
      prismaMock.call.findUnique.mockResolvedValue(activeCall);
      const canceledCall = {
        ...activeCall,
        state: CallState.CANCELED,
        duration_secs: 30,
        ended_at: new Date(),
      };
      prismaMock.call.update.mockResolvedValue(canceledCall);

      const result = await callsService.handleCallerHangup(mockProviderCallId, 30);

      expect(result.state).toBe(CallState.CANCELED);
      expect(prismaMock.callAttempt.update).toHaveBeenCalledWith({
        where: { id: 'attempt-1' },
        data: { state: CallAttemptState.CANCELED },
      });
      expect(prismaMock.buyerReservation.updateMany).toHaveBeenCalled();
      expect(usageServiceMock.recordUsage).toHaveBeenCalledWith(
        mockWorkspaceId,
        UsageType.CALL_MINUTE,
        1, // ceil(30 / 60)
        mockCallId,
        `CALL_MINUTE_${mockCallId}`,
      );
    });

    it('handleBuyerHangup on ROUTING call transitions attempt and signals DIAL_NEXT', async () => {
      const call = {
        id: mockCallId,
        state: CallState.ROUTING,
        attempts: [
          { id: mockAttemptId, state: CallAttemptState.RINGING },
        ],
      };
      prismaMock.call.findUnique.mockResolvedValue(call);

      const result = await callsService.handleBuyerHangup(mockCallId, mockAttemptId, 'CALL_FAILED');

      expect(result.action).toBe('DIAL_NEXT');
      expect(prismaMock.callAttempt.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockAttemptId },
          data: expect.objectContaining({ state: CallAttemptState.FAILED }),
        }),
      );
      expect(prismaMock.buyerReservation.updateMany).toHaveBeenCalledWith({
        where: { attempt_id: mockAttemptId, status: 'ACTIVE' },
        data: { status: 'RELEASED' },
      });
    });

    it('handleBuyerHangup on COMPLETED call with ANSWERED attempt transitions attempt to COMPLETED and signals HANGUP_CALLER', async () => {
      const call = {
        id: mockCallId,
        state: CallState.COMPLETED,
        attempts: [
          {
            id: mockAttemptId,
            state: CallAttemptState.ANSWERED,
            answered_at: new Date(Date.now() - 45000),
          },
        ],
      };
      prismaMock.call.findUnique.mockResolvedValue(call);

      const result = await callsService.handleBuyerHangup(mockCallId, mockAttemptId);

      expect(result.action).toBe('HANGUP_CALLER');
      expect(prismaMock.callAttempt.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockAttemptId },
          data: expect.objectContaining({ state: CallAttemptState.COMPLETED }),
        }),
      );
      expect(prismaMock.buyerReservation.updateMany).toHaveBeenCalled();
    });
  });
});
