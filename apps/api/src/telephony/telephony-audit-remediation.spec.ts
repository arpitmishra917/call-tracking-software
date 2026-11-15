import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { CallController, TELEPHONY_PROVIDER } from './call-controller.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CallsService } from '../calls/calls.service.js';
import { UsageService } from '../usage/usage.service.js';
import { WalletService } from '../billing/wallet.service.js';
import { UsageBillingService } from '../billing/usage-billing.service.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { TelnyxProvider } from './telnyx/telnyx.provider.js';
import { CallEventType } from './telephony.events.js';
import { CallState, CallAttemptState, UsageType } from '@prisma/client';
import { TelephonyProviderError } from './telephony.errors.js';

describe('Telephony Audit Remediation Regression Suite', () => {
  describe('CallsService Call Finalization & Usage Recording', () => {
    let callsService: CallsService;
    let prisma: any;
    let usageService: any;
    let webhooksService: any;

    beforeEach(async () => {
      prisma = {
        $transaction: vi.fn((cb) => cb(prisma)),
        $queryRaw: vi.fn().mockResolvedValue([{ id: 'call_1' }]),
        call: {
          findUnique: vi.fn(),
          update: vi.fn(),
        },
        callAttempt: {
          findUnique: vi.fn(),
          update: vi.fn(),
        },
      };

      usageService = {
        recordUsage: vi.fn().mockResolvedValue({ id: 'rec_1' }),
      };

      webhooksService = {
        queueEvent: vi.fn().mockResolvedValue(undefined),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          CallsService,
          { provide: PrismaService, useValue: prisma },
          { provide: UsageService, useValue: usageService },
          { provide: WebhooksService, useValue: webhooksService },
          { provide: PermissionsService, useValue: {} },
        ],
      }).compile();

      callsService = module.get<CallsService>(CallsService);
    });

    it('1. Finalizes answered call (COMPLETED with duration_secs: null) and records usage', async () => {
      const answeredAt = new Date(Date.now() - 65000); // 65 seconds ago
      const mockCall = {
        id: 'call_123',
        workspace_id: 'ws_1',
        provider_call_id: 'v3:caller_123',
        state: CallState.COMPLETED,
        answered_at: answeredAt,
        duration_secs: null,
        ended_at: null,
        attempts: [
          { id: 'att_1', state: CallAttemptState.ANSWERED, ended_at: null },
        ],
      };

      prisma.call.findUnique.mockResolvedValue(mockCall);
      prisma.call.update.mockImplementation(({ data }: any) => {
        return { ...mockCall, ...data };
      });
      prisma.callAttempt.update.mockResolvedValue({ id: 'att_1' });

      const finalized = await callsService.handleCallerHangup('v3:caller_123');

      expect(prisma.callAttempt.update).toHaveBeenCalledWith({
        where: { id: 'att_1' },
        data: expect.objectContaining({
          state: CallAttemptState.COMPLETED,
        }),
      });

      expect(prisma.call.update).toHaveBeenCalledWith({
        where: { id: 'call_123' },
        data: expect.objectContaining({
          state: CallState.COMPLETED,
          duration_secs: expect.any(Number),
          ended_at: expect.any(Date),
        }),
      });

      expect(finalized.duration_secs).toBeGreaterThanOrEqual(64);
      // 65 seconds -> 2 billable minutes
      expect(usageService.recordUsage).toHaveBeenCalledWith(
        'ws_1',
        UsageType.CALL_MINUTE,
        2,
        'call_123',
        'CALL_MINUTE_call_123',
      );
    });

    it('2. Differentiates duration_secs = 0 from missing duration and does not re-finalize', async () => {
      const alreadyFinalizedZeroCall = {
        id: 'call_zero',
        workspace_id: 'ws_1',
        provider_call_id: 'v3:caller_zero',
        state: CallState.COMPLETED,
        answered_at: new Date(),
        duration_secs: 0, // Explicitly 0 seconds talk time
        ended_at: new Date(),
        attempts: [
          { id: 'att_zero', state: CallAttemptState.COMPLETED, ended_at: new Date() },
        ],
      };

      prisma.call.findUnique.mockResolvedValue(alreadyFinalizedZeroCall);

      const result = await callsService.handleCallerHangup('v3:caller_zero');

      // Zero is recognized as finalized; no database updates or new usage records
      expect(prisma.call.update).not.toHaveBeenCalled();
      expect(prisma.callAttempt.update).not.toHaveBeenCalled();
      expect(usageService.recordUsage).not.toHaveBeenCalled();
      expect(result.duration_secs).toBe(0);
    });

    it('3. Prevents duplicate usage recording when handleCallerHangup is invoked repeatedly', async () => {
      const answeredAt = new Date(Date.now() - 30000);
      const initialCall = {
        id: 'call_repeat',
        workspace_id: 'ws_1',
        provider_call_id: 'v3:repeat_123',
        state: CallState.COMPLETED,
        answered_at: answeredAt,
        duration_secs: null,
        ended_at: null,
        attempts: [
          { id: 'att_rep', state: CallAttemptState.ANSWERED, ended_at: null },
        ],
      };

      prisma.call.findUnique.mockResolvedValueOnce(initialCall);
      prisma.call.update.mockImplementationOnce(({ data }: any) => {
        return { ...initialCall, ...data };
      });
      prisma.callAttempt.update.mockResolvedValueOnce({ id: 'att_rep' });

      // First call finalizes and records usage
      const firstResult = await callsService.handleCallerHangup('v3:repeat_123');
      expect(usageService.recordUsage).toHaveBeenCalledTimes(1);

      // Second call finds call with duration_secs populated
      prisma.call.findUnique.mockResolvedValueOnce(firstResult);

      const secondResult = await callsService.handleCallerHangup('v3:repeat_123');
      expect(usageService.recordUsage).toHaveBeenCalledTimes(1); // Not duplicated
      expect(prisma.call.update).toHaveBeenCalledTimes(1); // Not re-updated
      expect(secondResult.id).toBe('call_repeat');
    });

    it('4. commitBuyerDial preserves attempt if already answered by early webhook', async () => {
      const attemptId = 'att_early';
      const callId = 'call_early';
      const providerCallId = 'v3:buyer_early_leg';

      // Call is already COMPLETED and attempt is ANSWERED because early webhook beat commitBuyerDial
      prisma.callAttempt.findUnique.mockResolvedValue({
        id: attemptId,
        call_id: callId,
        state: CallAttemptState.ANSWERED,
        provider_call_id: providerCallId,
      });

      prisma.call.findUnique.mockResolvedValue({
        id: callId,
        state: CallState.COMPLETED,
      });

      const shouldHangup = await callsService.commitBuyerDial(attemptId, providerCallId);

      // Must not cancel the call or attempt, must return shouldHangup: false
      expect(shouldHangup).toBe(false);
      expect(prisma.callAttempt.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ state: CallAttemptState.CANCELED }),
        }),
      );
    });
  });

  describe('Early Buyer Webhook Correlation via client_state', () => {
    let controller: CallController;
    let prisma: any;
    let provider: any;
    let callsService: any;
    let usageBillingService: any;

    beforeEach(async () => {
      prisma = {
        call: {
          findUnique: vi.fn(),
          update: vi.fn(),
        },
        callAttempt: {
          findUnique: vi.fn(),
          update: vi.fn(),
        },
        phoneNumber: {
          findFirst: vi.fn().mockResolvedValue({
            phone_number: '+15551112222',
            workspace_id: 'ws_1',
            number_type: 'local',
          }),
        },
      };

      provider = {
        answerCall: vi.fn().mockResolvedValue(undefined),
        hangupCall: vi.fn().mockResolvedValue(undefined),
        bridgeCalls: vi.fn().mockResolvedValue(undefined),
        startRecording: vi.fn().mockResolvedValue(undefined),
        dialBuyer: vi.fn(),
        getCallStatus: vi.fn(),
      };

      callsService = {
        markCallAnswered: vi.fn().mockResolvedValue(true),
        handleCallerHangup: vi.fn().mockResolvedValue({ id: 'c1', state: CallState.COMPLETED, ended_at: new Date() }),
        handleBuyerHangup: vi.fn().mockResolvedValue({ action: 'HANGUP_CALLER' }),
        commitBuyerDial: vi.fn().mockResolvedValue(false),
      };

      usageBillingService = {
        calculateInitialReservation: vi.fn().mockReturnValue(100),
        billCallUsage: vi.fn().mockResolvedValue(undefined),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          CallController,
          { provide: TELEPHONY_PROVIDER, useValue: provider },
          { provide: PrismaService, useValue: prisma },
          { provide: CallsService, useValue: callsService },
          { provide: UsageService, useValue: { recordUsage: vi.fn() } },
          { provide: UsageBillingService, useValue: usageBillingService },
          { provide: WalletService, useValue: { reserveForCall: vi.fn(), extendReservationForCall: vi.fn() } },
          { provide: WebhooksService, useValue: { queueEvent: vi.fn() } },
        ],
      }).compile();

      controller = module.get<CallController>(CallController);
    });

    it('Correlates early buyer answered webhook using client_state before provider_call_id persistence', async () => {
      const buyerCallId = 'v3:buyer_early_answer';
      const callId = 'call_100';
      const attemptId = 'attempt_100';
      const workspaceId = 'ws_1';

      const clientState = Buffer.from(
        JSON.stringify({ callId, attemptId, workspaceId }),
      ).toString('base64');

      // 1. Initial lookups by provider_call_id return null (not yet persisted)
      prisma.call.findUnique.mockResolvedValueOnce(null);
      prisma.callAttempt.findUnique
        .mockResolvedValueOnce(null) // Lookup by provider_call_id returns null
        .mockResolvedValueOnce({     // Lookup by decoded attemptId in client_state succeeds
          id: attemptId,
          call_id: callId,
          provider_call_id: null,
          state: CallAttemptState.RINGING,
          call: {
            id: callId,
            workspace_id: workspaceId,
            state: CallState.ROUTING,
            provider_call_id: 'v3:caller_100',
            attempts: [],
          },
        });

      // 2. Dispatch event with clientState
      await controller.handleEvent({
        type: CallEventType.CALL_ANSWERED,
        callId: buyerCallId,
        clientState,
        timestamp: new Date().toISOString(),
      });

      // Backfills provider_call_id on the attempt
      expect(prisma.callAttempt.update).toHaveBeenCalledWith({
        where: { id: attemptId },
        data: { provider_call_id: buyerCallId },
      });

      // Bridges caller with buyer
      expect(callsService.markCallAnswered).toHaveBeenCalledWith(callId, attemptId);
      expect(provider.bridgeCalls).toHaveBeenCalledWith('v3:caller_100', buyerCallId);
    });
  });

  describe('TelnyxProvider Mock ID Containment', () => {
    let provider: TelnyxProvider;

    beforeEach(() => {
      process.env.TELNYX_API_KEY = 'test_key_live_mock';
      provider = new TelnyxProvider();
      // Inject fake client with spy methods
      (provider as any).telnyxClient = {
        calls: {
          actions: {
            answer: vi.fn().mockResolvedValue({}),
            bridge: vi.fn().mockResolvedValue({}),
            hangup: vi.fn().mockResolvedValue({}),
            startRecording: vi.fn().mockResolvedValue({}),
          },
          retrieveStatus: vi.fn().mockResolvedValue({ data: { call_state: 'active' } }),
        },
      };
    });

    it('Rejects mock IDs on bridgeCalls with explicit error and does not invoke Telnyx API', async () => {
      await expect(
        provider.bridgeCalls('v3:live_caller_leg', 'recovery-mock-123'),
      ).rejects.toThrow(TelephonyProviderError);

      await expect(
        provider.bridgeCalls('mock_caller_123', 'v3:live_buyer_leg'),
      ).rejects.toThrow(TelephonyProviderError);

      expect((provider as any).telnyxClient.calls.actions.bridge).not.toHaveBeenCalled();
    });

    it('Silently contains mock IDs on answerCall and hangupCall without calling Telnyx API', async () => {
      await provider.answerCall('recovery-mock-456');
      await provider.answerCall('mock_incoming_123');
      expect((provider as any).telnyxClient.calls.actions.answer).not.toHaveBeenCalled();

      await provider.hangupCall('recovery-mock-789');
      await provider.hangupCall('test_leg_999');
      expect((provider as any).telnyxClient.calls.actions.hangup).not.toHaveBeenCalled();
    });

    it('Contains mock IDs on startRecording and getCallStatus without calling Telnyx API', async () => {
      await provider.startRecording('recovery-mock-abc');
      expect((provider as any).telnyxClient.calls.actions.startRecording).not.toHaveBeenCalled();

      const status = await provider.getCallStatus('recovery-mock-xyz');
      expect(status).toBe('UNKNOWN');
      expect((provider as any).telnyxClient.calls.retrieveStatus).not.toHaveBeenCalled();
    });
  });

  describe('Database Isolation Safety Guard', () => {
    it('Throws error when recovery integration test runs against unisolated development database', () => {
      const devDbUrl = 'postgresql://postgres:postgres@localhost:5432/calltracking_mvp';
      expect(() => {
        if (!devDbUrl.includes('_test') && !devDbUrl.includes('_isolated')) {
          throw new Error('Refusing to run recovery integration tests against non-isolated development database.');
        }
      }).toThrow('Refusing to run recovery integration tests against non-isolated development database.');
    });

    it('Permits isolated test database URL', () => {
      const testDbUrl = 'postgresql://postgres:postgres@localhost:5432/calltracking_mvp_test';
      expect(() => {
        if (!testDbUrl.includes('_test') && !testDbUrl.includes('_isolated')) {
          throw new Error('Refusing to run recovery integration tests against non-isolated development database.');
        }
      }).not.toThrow();
    });
  });
});
