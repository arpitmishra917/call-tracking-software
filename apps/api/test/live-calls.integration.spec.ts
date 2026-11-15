import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { CallsService } from '../src/calls/calls.service.js';
import { CallsController } from '../src/calls/calls.controller.js';
import { PermissionsService } from '../src/permissions/permissions.service.js';
import { UsageService } from '../src/usage/usage.service.js';
import { UsageBillingService } from '../src/billing/usage-billing.service.js';
import { WalletService } from '../src/billing/wallet.service.js';
import { WebhooksService } from '../src/webhooks/webhooks.service.js';
import { ReservationRecoveryService } from '../src/telephony/reservation-recovery.service.js';
import { TELEPHONY_PROVIDER } from '../src/telephony/call-controller.js';
import { FakeTelephonyProvider } from '../src/telephony/fake.provider.js';
import { CallState, CallAttemptState, ReservationStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

describe('Live Calls Semantics & Isolation Integration Tests', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let callsService: CallsService;
  let callsController: CallsController;
  let recoveryService: ReservationRecoveryService;
  let fakeProvider: FakeTelephonyProvider;

  beforeAll(async () => {
    const dbUrl = process.env.DATABASE_URL || '';
    if (!dbUrl.includes('_test') && !dbUrl.includes('_isolated')) {
      throw new Error(
        'Refusing to run live-calls integration tests against non-isolated development database. An isolated test database (e.g. ending in _test or _isolated) is required.'
      );
    }

    moduleRef = await Test.createTestingModule({
      providers: [
        PrismaService,
        CallsService,
        {
          provide: PermissionsService,
          useValue: {
            getPermissionsForUser: vi.fn().mockResolvedValue([{ key: 'call:read', scope_type: 'ALL' }]),
          },
        },
        UsageService,
        UsageBillingService,
        WalletService,
        WebhooksService,
        ReservationRecoveryService,
        {
          provide: TELEPHONY_PROVIDER,
          useClass: FakeTelephonyProvider,
        },
      ],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    callsService = moduleRef.get(CallsService);
    callsController = new CallsController(callsService);
    recoveryService = moduleRef.get(ReservationRecoveryService);
    fakeProvider = moduleRef.get(TELEPHONY_PROVIDER);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await moduleRef.close();
  });

  beforeEach(async () => {
    fakeProvider.clearActions();
  });

  async function createWorkspace() {
    const ws = await prisma.workspace.create({
      data: {
        id: randomUUID(),
        name: 'Live Calls Test Workspace',
        slug: `test-live-ws-${randomUUID()}`,
        balance: {
          create: { balance_micro: 50000000n, reserved_micro: 0n },
        },
      },
    });
    return ws.id;
  }

  async function createBuyer(workspaceId: string) {
    return prisma.buyer.create({
      data: {
        id: randomUUID(),
        workspace_id: workspaceId,
        name: 'Test Buyer',
        destination_number: '+18005550199',
      },
    });
  }

  async function createActiveCall(workspaceId: string, buyerId: string) {
    const callId = randomUUID();
    const providerCallId = `live-test-call-${callId}`;
    const buyerLegId = `live-test-buyer-leg-${randomUUID()}`;

    const now = new Date();
    const call = await prisma.call.create({
      data: {
        id: callId,
        workspace_id: workspaceId,
        provider: 'telnyx',
        provider_call_id: providerCallId,
        from_number: '+15551234567',
        to_number: '+18005550100',
        state: CallState.COMPLETED,
        answered_at: now,
        ended_at: null,
        callReservation: {
          create: {
            workspace_id: workspaceId,
            status: ReservationStatus.ACTIVE,
            original_reserved_micro: 5000000n,
            total_reserved_micro: 5000000n,
            expires_at: new Date(Date.now() + 10 * 60 * 1000),
          },
        },
        attempts: {
          create: {
            buyer_id: buyerId,
            provider_call_id: buyerLegId,
            state: CallAttemptState.ANSWERED,
            answered_at: now,
            ended_at: null,
          },
        },
      },
    });

    return { callId, providerCallId, buyerLegId, call };
  }

  it('1. No active calls produces 0', async () => {
    const wsId = await createWorkspace();
    const res = await callsService.getLiveCalls(wsId, '');
    expect(res.liveCalls).toBe(0);
  });

  it('2. One genuinely active call produces 1', async () => {
    const wsId = await createWorkspace();
    const buyer = await createBuyer(wsId);
    await createActiveCall(wsId, buyer.id);

    const res = await callsService.getLiveCalls(wsId, '');
    expect(res.liveCalls).toBe(1);
  });

  it('3. Two genuinely active calls produce 2', async () => {
    const wsId = await createWorkspace();
    const buyer = await createBuyer(wsId);
    await createActiveCall(wsId, buyer.id);
    await createActiveCall(wsId, buyer.id);

    const res = await callsService.getLiveCalls(wsId, '');
    expect(res.liveCalls).toBe(2);
  });

  it('4. Terminal calls are excluded', async () => {
    const wsId = await createWorkspace();
    const buyer = await createBuyer(wsId);

    // Call A: COMPLETED and ended
    await prisma.call.create({
      data: {
        id: randomUUID(),
        workspace_id: wsId,
        provider: 'telnyx',
        provider_call_id: `term-comp-${randomUUID()}`,
        from_number: '+15551234567',
        to_number: '+18005550100',
        state: CallState.COMPLETED,
        answered_at: new Date(Date.now() - 60000),
        ended_at: new Date(),
        duration_secs: 60,
        callReservation: {
          create: {
            workspace_id: wsId,
            status: ReservationStatus.SETTLED,
            original_reserved_micro: 5000000n,
            total_reserved_micro: 5000000n,
          },
        },
        attempts: {
          create: {
            buyer_id: buyer.id,
            state: CallAttemptState.COMPLETED,
            answered_at: new Date(Date.now() - 60000),
            ended_at: new Date(),
          },
        },
      },
    });

    // Call B: FAILED
    await prisma.call.create({
      data: {
        id: randomUUID(),
        workspace_id: wsId,
        provider: 'telnyx',
        provider_call_id: `term-failed-${randomUUID()}`,
        from_number: '+15551234567',
        to_number: '+18005550100',
        state: CallState.FAILED,
        ended_at: new Date(),
      },
    });

    // Call C: CANCELED
    await prisma.call.create({
      data: {
        id: randomUUID(),
        workspace_id: wsId,
        provider: 'telnyx',
        provider_call_id: `term-canceled-${randomUUID()}`,
        from_number: '+15551234567',
        to_number: '+18005550100',
        state: CallState.CANCELED,
        ended_at: new Date(),
      },
    });

    // Call D: NO_ANSWER
    await prisma.call.create({
      data: {
        id: randomUUID(),
        workspace_id: wsId,
        provider: 'telnyx',
        provider_call_id: `term-noanswer-${randomUUID()}`,
        from_number: '+15551234567',
        to_number: '+18005550100',
        state: CallState.NO_ANSWER,
        ended_at: new Date(),
      },
    });

    // Call E: COMPLETED with ended_at=null, but attempt COMPLETED and reservation SETTLED
    await prisma.call.create({
      data: {
        id: randomUUID(),
        workspace_id: wsId,
        provider: 'telnyx',
        provider_call_id: `term-settled-res-${randomUUID()}`,
        from_number: '+15551234567',
        to_number: '+18005550100',
        state: CallState.COMPLETED,
        answered_at: new Date(Date.now() - 30000),
        ended_at: null,
        callReservation: {
          create: {
            workspace_id: wsId,
            status: ReservationStatus.SETTLED,
            original_reserved_micro: 5000000n,
            total_reserved_micro: 5000000n,
          },
        },
        attempts: {
          create: {
            buyer_id: buyer.id,
            state: CallAttemptState.COMPLETED,
            ended_at: new Date(),
          },
        },
      },
    });

    const res = await callsService.getLiveCalls(wsId, '');
    expect(res.liveCalls).toBe(0);
  });

  it('5. A failed bridge does not remain live indefinitely after cleanup completes', async () => {
    const wsId = await createWorkspace();
    const buyer = await createBuyer(wsId);

    // Call where bridging failed: local state reverted to ROUTING, attempt FAILED, ended_at set on attempt
    await prisma.call.create({
      data: {
        id: randomUUID(),
        workspace_id: wsId,
        provider: 'telnyx',
        provider_call_id: `bridge-fail-${randomUUID()}`,
        from_number: '+15551234567',
        to_number: '+18005550100',
        state: CallState.ROUTING,
        answered_at: null,
        ended_at: null,
        callReservation: {
          create: {
            workspace_id: wsId,
            status: ReservationStatus.ACTIVE,
            original_reserved_micro: 5000000n,
            total_reserved_micro: 5000000n,
          },
        },
        attempts: {
          create: {
            buyer_id: buyer.id,
            state: CallAttemptState.FAILED,
            ended_at: new Date(),
          },
        },
      },
    });

    const res = await callsService.getLiveCalls(wsId, '');
    expect(res.liveCalls).toBe(0);
  });

  it('6. Calls in unrelated workspaces are excluded', async () => {
    const ws1 = await createWorkspace();
    const ws2 = await createWorkspace();
    const buyer2 = await createBuyer(ws2);

    // Create active call in Workspace 2
    await createActiveCall(ws2, buyer2.id);

    // Workspace 1 must be 0
    const res1 = await callsService.getLiveCalls(ws1, '');
    expect(res1.liveCalls).toBe(0);

    // Workspace 2 must be 1
    const res2 = await callsService.getLiveCalls(ws2, '');
    expect(res2.liveCalls).toBe(1);
  });

  it('7. Header and Reporting KPI use consistent logic', async () => {
    const wsId = await createWorkspace();
    const buyer = await createBuyer(wsId);
    await createActiveCall(wsId, buyer.id);

    // Direct service method (used by backend)
    const serviceRes = await callsService.getLiveCalls(wsId, '');
    // Controller method (invoked by GET /workspaces/:workspaceId/calls/live-calls)
    const controllerRes = await callsController.getLiveCalls(wsId, { user: { userId: '' } });

    expect(serviceRes.liveCalls).toBe(1);
    expect(controllerRes.liveCalls).toBe(1);
    expect(controllerRes.liveCalls).toBe(serviceRes.liveCalls);
  });

  it('8. UNKNOWN provider status does not trigger unsafe termination or silently inflate counts without an explicit policy', async () => {
    const wsId = await createWorkspace();
    const buyer = await createBuyer(wsId);

    const callId = randomUUID();
    const providerCallId = `recovery-unknown-${callId}`;

    // A stale call in ROUTING with ACTIVE reservation
    await prisma.call.create({
      data: {
        id: callId,
        workspace_id: wsId,
        provider: 'telnyx',
        provider_call_id: providerCallId,
        from_number: '+15551234567',
        to_number: '+18005550100',
        state: CallState.ROUTING,
        answered_at: null,
        ended_at: null,
        callReservation: {
          create: {
            workspace_id: wsId,
            status: ReservationStatus.ACTIVE,
            original_reserved_micro: 5000000n,
            total_reserved_micro: 5000000n,
            updated_at: new Date(Date.now() - 20 * 60 * 1000), // stale (>15m)
          },
        },
        attempts: {
          create: {
            buyer_id: buyer.id,
            state: CallAttemptState.RINGING,
            updated_at: new Date(Date.now() - 20 * 60 * 1000),
          },
        },
      },
    });

    // Provider returns UNKNOWN
    fakeProvider.mockCallStatus(providerCallId, 'UNKNOWN');

    // Run recovery
    await recoveryService.reconcileReservation(callId);

    // Verify recovery did NOT unsafely terminate the call or settle the reservation
    const reservationAfter = await prisma.callReservation.findUniqueOrThrow({
      where: { call_id: callId },
    });
    expect(reservationAfter.status).toBe(ReservationStatus.ACTIVE);

    // Verify getLiveCalls does NOT count this call as live (does NOT silently inflate counts)
    const liveRes = await callsService.getLiveCalls(wsId, '');
    expect(liveRes.liveCalls).toBe(0);
  });
});
