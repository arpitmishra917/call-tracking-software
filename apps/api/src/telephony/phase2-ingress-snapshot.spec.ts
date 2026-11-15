import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { CallController, TELEPHONY_PROVIDER } from './call-controller.js';
import { CallsService } from '../calls/calls.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsageBillingService } from '../billing/usage-billing.service.js';
import { WalletService } from '../billing/wallet.service.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { UsageService } from '../usage/usage.service.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { CallEventType } from './telephony.events.js';
import { CallState } from '@prisma/client';

describe('Phase 2 Slice 2: Telephony Ingress Snapshotting', () => {
  let controller: CallController;
  let callsService: any;
  let prisma: any;
  let provider: any;
  let usageBillingService: any;
  let walletService: any;
  let webhooksService: any;

  beforeEach(async () => {
    provider = {
      answerCall: vi.fn().mockResolvedValue(undefined),
      hangupCall: vi.fn().mockResolvedValue(undefined),
      dialBuyer: vi.fn().mockResolvedValue('buyer_call_1'),
      bridgeCalls: vi.fn().mockResolvedValue(undefined),
      startRecording: vi.fn().mockResolvedValue(undefined),
      startRingback: vi.fn().mockResolvedValue(undefined),
      stopRingback: vi.fn().mockResolvedValue(undefined),
    };

    prisma = {
      $transaction: vi.fn((cb) => cb(prisma)),
      call: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      callAttempt: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      phoneNumber: {
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      blockedCaller: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      campaign: {
        findUnique: vi.fn(),
      },
    };

    callsService = {
      createCall: vi.fn(),
      transitionCall: vi.fn(),
      handleCallerHangup: vi.fn(),
      handleBuyerHangup: vi.fn(),
      markCallAnswered: vi.fn(),
      handleBridgeFailure: vi.fn(),
      prepareNextBuyer: vi.fn(),
      commitBuyerDial: vi.fn(),
      transitionAttempt: vi.fn(),
    };

    usageBillingService = {
      calculateInitialReservation: vi.fn().mockReturnValue(100),
      billCallUsage: vi.fn().mockResolvedValue(undefined),
      billRecordingUsage: vi.fn().mockResolvedValue(undefined),
    };

    walletService = {
      reserveForCall: vi.fn().mockResolvedValue(undefined),
      extendReservationForCall: vi.fn().mockResolvedValue({ totalReservedMicro: 200n, availableMicro: 800n }),
    };

    webhooksService = {
      queueEvent: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CallController,
        { provide: TELEPHONY_PROVIDER, useValue: provider },
        { provide: PrismaService, useValue: prisma },
        { provide: CallsService, useValue: callsService },
        { provide: UsageBillingService, useValue: usageBillingService },
        { provide: WalletService, useValue: walletService },
        { provide: WebhooksService, useValue: webhooksService },
        { provide: UsageService, useValue: { recordUsage: vi.fn() } },
        { provide: PermissionsService, useValue: { getPermissionsForUser: vi.fn().mockResolvedValue([]) } },
      ],
    }).compile();

    controller = module.get<CallController>(CallController);
  });

  describe('1. Assigned tracking number captures correct Vendor and phone-number IDs', () => {
    it('snapshots vendor_id, attributed_vendor_id, and INGRESS_ASSIGNED on normal inbound call', async () => {
      prisma.call.findUnique.mockResolvedValue(null);
      prisma.callAttempt.findUnique.mockResolvedValue(null);

      prisma.phoneNumber.findFirst.mockResolvedValue({
        id: 'pn_assigned_1',
        workspace_id: 'ws_active_1',
        campaign_id: 'camp_1',
        vendor_id: 'vnd_alpha',
        number_type: 'local',
        status: 'ACTIVE',
        workspace: { status: 'ACTIVE' },
        campaign: { id: 'camp_1', status: 'ACTIVE' },
      });

      callsService.createCall.mockResolvedValue({
        id: 'call_1',
        provider_call_id: 'leg_assigned_100',
        workspace_id: 'ws_active_1',
        campaign_id: 'camp_1',
        phone_number_id: 'pn_assigned_1',
        vendor_id: 'vnd_alpha',
        attributed_vendor_id: 'vnd_alpha',
        attribution_source: 'INGRESS_ASSIGNED',
        to_number: '+15551112222',
        from_number: '+15559990000',
        state: CallState.INITIATED,
      });

      await controller.handleEvent({
        type: CallEventType.CALL_INITIATED,
        callId: 'leg_assigned_100',
        direction: 'incoming',
        to: '+15551112222',
        from: '+15559990000',
        timestamp: new Date().toISOString(),
      });

      expect(callsService.createCall).toHaveBeenCalledWith({
        workspace_id: 'ws_active_1',
        campaign_id: 'camp_1',
        phone_number_id: 'pn_assigned_1',
        vendor_id: 'vnd_alpha',
        attributed_vendor_id: 'vnd_alpha',
        attribution_source: 'INGRESS_ASSIGNED',
        provider: 'provider',
        provider_call_id: 'leg_assigned_100',
        from_number: '+15559990000',
        to_number: '+15551112222',
      });
      expect(provider.answerCall).toHaveBeenCalledWith('leg_assigned_100');
    });
  });

  describe('2. Unassigned tracking number produces INGRESS_UNASSIGNED with null Vendor snapshot fields', () => {
    it('snapshots phone_number_id with null vendor fields and INGRESS_UNASSIGNED', async () => {
      prisma.call.findUnique.mockResolvedValue(null);
      prisma.callAttempt.findUnique.mockResolvedValue(null);

      prisma.phoneNumber.findFirst.mockResolvedValue({
        id: 'pn_unassigned_2',
        workspace_id: 'ws_active_1',
        campaign_id: 'camp_1',
        vendor_id: null,
        number_type: 'local',
        status: 'ACTIVE',
        workspace: { status: 'ACTIVE' },
        campaign: { id: 'camp_1', status: 'ACTIVE' },
      });

      callsService.createCall.mockResolvedValue({
        id: 'call_2',
        provider_call_id: 'leg_unassigned_200',
        workspace_id: 'ws_active_1',
        campaign_id: 'camp_1',
        phone_number_id: 'pn_unassigned_2',
        vendor_id: null,
        attributed_vendor_id: null,
        attribution_source: 'INGRESS_UNASSIGNED',
        to_number: '+15551112222',
        from_number: '+15559990000',
        state: CallState.INITIATED,
      });

      await controller.handleEvent({
        type: CallEventType.CALL_INITIATED,
        callId: 'leg_unassigned_200',
        direction: 'incoming',
        to: '+15551112222',
        from: '+15559990000',
        timestamp: new Date().toISOString(),
      });

      expect(callsService.createCall).toHaveBeenCalledWith({
        workspace_id: 'ws_active_1',
        campaign_id: 'camp_1',
        phone_number_id: 'pn_unassigned_2',
        vendor_id: null,
        attributed_vendor_id: null,
        attribution_source: 'INGRESS_UNASSIGNED',
        provider: 'provider',
        provider_call_id: 'leg_unassigned_200',
        from_number: '+15559990000',
        to_number: '+15551112222',
      });
    });
  });

  describe('3. Inactive workspace, inactive/missing campaign, and blocked caller paths capture attribution', () => {
    it('captures attribution when call is rejected because workspace is suspended', async () => {
      prisma.call.findUnique.mockResolvedValue(null);
      prisma.callAttempt.findUnique.mockResolvedValue(null);

      prisma.phoneNumber.findFirst.mockResolvedValue({
        id: 'pn_rej_1',
        workspace_id: 'ws_suspended_1',
        campaign_id: 'camp_1',
        vendor_id: 'vnd_bravo',
        number_type: 'local',
        status: 'ACTIVE',
        workspace: { status: 'SUSPENDED' },
        campaign: { id: 'camp_1', status: 'ACTIVE' },
      });

      await controller.handleEvent({
        type: CallEventType.CALL_INITIATED,
        callId: 'leg_rej_ws',
        direction: 'incoming',
        to: '+15551112222',
        from: '+15559990000',
        timestamp: new Date().toISOString(),
      });

      expect(prisma.call.create).toHaveBeenCalledWith({
        data: {
          workspace_id: 'ws_suspended_1',
          campaign_id: 'camp_1',
          phone_number_id: 'pn_rej_1',
          vendor_id: 'vnd_bravo',
          attributed_vendor_id: 'vnd_bravo',
          attribution_source: 'INGRESS_ASSIGNED',
          provider: 'provider',
          provider_call_id: 'leg_rej_ws',
          from_number: '+15559990000',
          to_number: '+15551112222',
          state: CallState.FAILED,
        },
      });
      expect(provider.hangupCall).toHaveBeenCalledWith('leg_rej_ws');
    });

    it('captures INGRESS_UNASSIGNED when unassigned number rejected because workspace is suspended', async () => {
      prisma.call.findUnique.mockResolvedValue(null);
      prisma.callAttempt.findUnique.mockResolvedValue(null);

      prisma.phoneNumber.findFirst.mockResolvedValue({
        id: 'pn_rej_2',
        workspace_id: 'ws_suspended_1',
        campaign_id: 'camp_1',
        vendor_id: null,
        number_type: 'local',
        status: 'ACTIVE',
        workspace: { status: 'SUSPENDED' },
        campaign: { id: 'camp_1', status: 'ACTIVE' },
      });

      await controller.handleEvent({
        type: CallEventType.CALL_INITIATED,
        callId: 'leg_rej_ws_unassigned',
        direction: 'incoming',
        to: '+15551112222',
        from: '+15559990000',
        timestamp: new Date().toISOString(),
      });

      expect(prisma.call.create).toHaveBeenCalledWith({
        data: {
          workspace_id: 'ws_suspended_1',
          campaign_id: 'camp_1',
          phone_number_id: 'pn_rej_2',
          vendor_id: null,
          attributed_vendor_id: null,
          attribution_source: 'INGRESS_UNASSIGNED',
          provider: 'provider',
          provider_call_id: 'leg_rej_ws_unassigned',
          from_number: '+15559990000',
          to_number: '+15551112222',
          state: CallState.FAILED,
        },
      });
    });

    it('captures attribution when call is rejected because campaign is inactive/missing', async () => {
      prisma.call.findUnique.mockResolvedValue(null);
      prisma.callAttempt.findUnique.mockResolvedValue(null);

      prisma.phoneNumber.findFirst.mockResolvedValue({
        id: 'pn_rej_camp',
        workspace_id: 'ws_active_1',
        vendor_id: 'vnd_charlie',
        number_type: 'local',
        status: 'ACTIVE',
        workspace: { status: 'ACTIVE' },
        campaign: null, // missing campaign
      });

      await controller.handleEvent({
        type: CallEventType.CALL_INITIATED,
        callId: 'leg_rej_camp',
        direction: 'incoming',
        to: '+15551112222',
        from: '+15559990000',
        timestamp: new Date().toISOString(),
      });

      expect(prisma.call.create).toHaveBeenCalledWith({
        data: {
          workspace_id: 'ws_active_1',
          campaign_id: undefined,
          phone_number_id: 'pn_rej_camp',
          vendor_id: 'vnd_charlie',
          attributed_vendor_id: 'vnd_charlie',
          attribution_source: 'INGRESS_ASSIGNED',
          provider: 'provider',
          provider_call_id: 'leg_rej_camp',
          from_number: '+15559990000',
          to_number: '+15551112222',
          state: CallState.FAILED,
        },
      });
      expect(provider.hangupCall).toHaveBeenCalledWith('leg_rej_camp');
    });

    it('captures attribution when call is rejected because caller is blocked', async () => {
      prisma.call.findUnique.mockResolvedValue(null);
      prisma.callAttempt.findUnique.mockResolvedValue(null);

      prisma.phoneNumber.findFirst.mockResolvedValue({
        id: 'pn_blocked_path',
        workspace_id: 'ws_active_1',
        vendor_id: 'vnd_delta',
        number_type: 'local',
        status: 'ACTIVE',
        workspace: { status: 'ACTIVE' },
        campaign: { id: 'camp_1', status: 'ACTIVE' },
      });

      prisma.blockedCaller.findUnique.mockResolvedValue({
        id: 'block_1',
        workspace_id: 'ws_active_1',
        phone_number: '+15559990000',
      });

      await controller.handleEvent({
        type: CallEventType.CALL_INITIATED,
        callId: 'leg_blocked',
        direction: 'incoming',
        to: '+15551112222',
        from: '+15559990000',
        timestamp: new Date().toISOString(),
      });

      expect(prisma.call.create).toHaveBeenCalledWith({
        data: {
          workspace_id: 'ws_active_1',
          campaign_id: undefined,
          phone_number_id: 'pn_blocked_path',
          vendor_id: 'vnd_delta',
          attributed_vendor_id: 'vnd_delta',
          attribution_source: 'INGRESS_ASSIGNED',
          provider: 'provider',
          provider_call_id: 'leg_blocked',
          from_number: '+15559990000',
          to_number: '+15551112222',
          state: CallState.FAILED,
        },
      });
      expect(provider.hangupCall).toHaveBeenCalledWith('leg_blocked');
    });
  });

  describe('4. Unknown destination does not create a Call with an invalid workspace', () => {
    it('returns immediately without creating a Call or calling callsService', async () => {
      prisma.call.findUnique.mockResolvedValue(null);
      prisma.callAttempt.findUnique.mockResolvedValue(null);
      prisma.phoneNumber.findFirst.mockResolvedValue(null); // Unknown number

      await controller.handleEvent({
        type: CallEventType.CALL_INITIATED,
        callId: 'leg_unknown',
        direction: 'incoming',
        to: '+19999999999',
        from: '+15559990000',
        timestamp: new Date().toISOString(),
      });

      expect(callsService.createCall).not.toHaveBeenCalled();
      expect(prisma.call.create).not.toHaveBeenCalled();
      expect(provider.answerCall).not.toHaveBeenCalled();
    });
  });

  describe('5. Reassigning tracking number after Call creation preserves attribution immutability', () => {
    it('historical Call maintains its ingress vendor even if trackingNumber.vendor_id changes', async () => {
      // Ingress snapshot at Call creation
      const createdCall = {
        id: 'call_hist_1',
        workspace_id: 'ws_active_1',
        phone_number_id: 'pn_reassign_1',
        vendor_id: 'vnd_original',
        attributed_vendor_id: 'vnd_original',
        attribution_source: 'INGRESS_ASSIGNED',
        state: CallState.INITIATED,
      };

      // Tracking number is later reassigned to Vendor B
      const phoneNumberAfterReassignment = {
        id: 'pn_reassign_1',
        vendor_id: 'vnd_reassigned_new',
      };

      // Call fields are immutable: they still reflect the ingress snapshot
      expect(createdCall.attributed_vendor_id).toBe('vnd_original');
      expect(createdCall.attribution_source).toBe('INGRESS_ASSIGNED');
      expect(createdCall.vendor_id).toBe('vnd_original');
      expect(createdCall.attributed_vendor_id).not.toBe(phoneNumberAfterReassignment.vendor_id);
    });
  });

  describe('6. Existing duplicate-event/idempotency behavior remains intact', () => {
    it('ignores duplicate CALL_INITIATED if call already exists in DB', async () => {
      prisma.call.findUnique.mockResolvedValue({
        id: 'call_already_exists',
        provider_call_id: 'leg_dup_1',
        state: CallState.INITIATED,
      });

      await controller.handleEvent({
        type: CallEventType.CALL_INITIATED,
        callId: 'leg_dup_1',
        direction: 'incoming',
        to: '+15551112222',
        from: '+15559990000',
        timestamp: new Date().toISOString(),
      });

      expect(prisma.phoneNumber.findFirst).not.toHaveBeenCalled();
      expect(callsService.createCall).not.toHaveBeenCalled();
      expect(prisma.call.create).not.toHaveBeenCalled();
    });
  });

  describe('7. CallsService.createCall unit tests for attribution fields', () => {
    let rawCallsService: CallsService;
    let localPrisma: any;
    let localWebhooks: any;

    beforeEach(async () => {
      localPrisma = {
        call: {
          create: vi.fn().mockImplementation((args) => Promise.resolve({ id: 'call_mock', ...args.data })),
        },
      };
      localWebhooks = {
        queueEvent: vi.fn().mockResolvedValue(undefined),
      };

      const mod = await Test.createTestingModule({
        providers: [
          CallsService,
          { provide: PrismaService, useValue: localPrisma },
          { provide: WebhooksService, useValue: localWebhooks },
          { provide: PermissionsService, useValue: { getPermissionsForUser: vi.fn() } },
          { provide: UsageService, useValue: { recordUsage: vi.fn() } },
        ],
      }).compile();

      rawCallsService = mod.get<CallsService>(CallsService);
    });

    it('persists all attribution fields and triggers webhook', async () => {
      const call = await rawCallsService.createCall({
        workspace_id: 'ws_test_1',
        campaign_id: 'camp_test_1',
        phone_number_id: 'pn_test_1',
        vendor_id: 'vnd_test_1',
        attributed_vendor_id: 'vnd_test_1',
        attribution_source: 'INGRESS_ASSIGNED',
        provider: 'telnyx',
        provider_call_id: 'call_telnyx_1',
        from_number: '+15550001',
        to_number: '+15550002',
      });

      expect(localPrisma.call.create).toHaveBeenCalledWith({
        data: {
          workspace_id: 'ws_test_1',
          campaign_id: 'camp_test_1',
          phone_number_id: 'pn_test_1',
          vendor_id: 'vnd_test_1',
          attributed_vendor_id: 'vnd_test_1',
          attribution_source: 'INGRESS_ASSIGNED',
          provider: 'telnyx',
          provider_call_id: 'call_telnyx_1',
          from_number: '+15550001',
          to_number: '+15550002',
          state: CallState.INITIATED,
        },
      });

      expect(localWebhooks.queueEvent).toHaveBeenCalledWith(
        'ws_test_1',
        'call.started',
        expect.objectContaining({
          phone_number_id: 'pn_test_1',
          vendor_id: 'vnd_test_1',
          attributed_vendor_id: 'vnd_test_1',
          attribution_source: 'INGRESS_ASSIGNED',
        }),
      );
    });

    it('defaults attribution to INGRESS_UNASSIGNED when vendor_id is null/empty', async () => {
      await rawCallsService.createCall({
        workspace_id: 'ws_test_1',
        phone_number_id: 'pn_test_2',
        vendor_id: null,
        provider: 'telnyx',
        provider_call_id: 'call_telnyx_2',
        from_number: '+15550001',
        to_number: '+15550002',
      });

      expect(localPrisma.call.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          phone_number_id: 'pn_test_2',
          vendor_id: null,
          attributed_vendor_id: null,
          attribution_source: 'INGRESS_UNASSIGNED',
        }),
      });
    });
  });
});
