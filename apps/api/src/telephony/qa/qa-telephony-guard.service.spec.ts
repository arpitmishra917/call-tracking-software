import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QaTelephonyGuardService } from './qa-telephony-guard.service.js';
import { TelephonyProviderError, TelephonyErrorType } from '../telephony.errors.js';
import { CallController } from '../call-controller.js';
import { CallAttemptState } from '@prisma/client';

describe('QaTelephonyGuardService', () => {
  let service: QaTelephonyGuardService;
  const originalEnv = { ...process.env };

  // Phase 6D: Disjoint Telephony Identities
  const QA_TRACKING_DID = '+14845560110';
  const QA_CALLER_CLI = '+17207159445';
  const QA_ALLOWED_BUYER = '+12025550199'; // NANPA Reserved Test Number
  const UNAUTHORIZED_BUYER = '+15551234567';

  beforeEach(() => {
    service = new QaTelephonyGuardService();
    // Default clean env
    delete process.env.TELEPHONY_QA_ENABLED;
    delete process.env.TELEPHONY_QA_ALLOWED_DESTINATIONS;
    delete process.env.TELNYX_QA_TRACKING_DID;
    delete process.env.TELNYX_QA_CALLER_ID;
    delete process.env.TELEPHONY_QA_ACTIVE_TEST_RUN_ID;
    delete process.env.TELEPHONY_QA_BUYER_SIP_URI;
    delete process.env.TELEPHONY_QA_BUYER_A_SIP_URI;
    delete process.env.TELEPHONY_QA_BUYER_B_SIP_URI;
    delete process.env.QA_WORKSPACE_ID;
    delete process.env.TELEPHONY_QA_ARI_URL;
    delete process.env.TELEPHONY_QA_SERVER_URL;
    delete process.env.TELEPHONY_QA_ARI_USERNAME;
    delete process.env.TELEPHONY_QA_ARI_PASSWORD;
  });

  afterEach(() => {
    service.clearActiveTestRuns();
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  describe('Identity Separation Security Invariant', () => {
    it('proves that QA caller CLI, tracking DID, and logical QA buyer are strictly disjoint', () => {
      expect(QA_CALLER_CLI).not.toBe(QA_TRACKING_DID);
      expect(QA_CALLER_CLI).not.toBe(QA_ALLOWED_BUYER);
      expect(QA_TRACKING_DID).not.toBe(QA_ALLOWED_BUYER);
    });

    it('denies dialing caller CLI or tracking DID if presented as buyer destination', () => {
      process.env.TELEPHONY_QA_ENABLED = 'true';
      process.env.TELEPHONY_QA_ALLOWED_DESTINATIONS = QA_ALLOWED_BUYER;

      service.registerActiveTestRun('test_run_id_sep');
      service.bindCallToTestRun('call_sep_1', 'test_run_id_sep');
      const boundCall = { id: 'call_sep_1' };

      // Caller CLI presented as buyer
      expect(() => {
        service.validateDestinationOrThrow(QA_CALLER_CLI, boundCall);
      }).toThrowError(TelephonyProviderError);

      // Tracking DID presented as buyer
      expect(() => {
        service.validateDestinationOrThrow(QA_TRACKING_DID, boundCall);
      }).toThrowError(TelephonyProviderError);

      // Dedicated QA buyer succeeds
      expect(() => {
        service.validateDestinationOrThrow(QA_ALLOWED_BUYER, boundCall);
      }).not.toThrow();
    });
  });

  describe('Rule 1 & 2: QA Disabled Behavior', () => {
    it('bypasses guard completely when TELEPHONY_QA_ENABLED is unset', () => {
      expect(service.isQaEnabled()).toBe(false);
      expect(() => {
        service.validateDestinationOrThrow(UNAUTHORIZED_BUYER, { _trustedServerQaFlag: true });
      }).not.toThrow();
    });

    it('bypasses guard completely when TELEPHONY_QA_ENABLED is "false"', () => {
      process.env.TELEPHONY_QA_ENABLED = 'false';
      expect(service.isQaEnabled()).toBe(false);
      expect(() => {
        service.validateDestinationOrThrow(UNAUTHORIZED_BUYER, { _trustedServerQaFlag: true });
      }).not.toThrow();
    });

    it('bypasses even with empty or malformed allowlist when QA is disabled', () => {
      process.env.TELEPHONY_QA_ENABLED = 'false';
      process.env.TELEPHONY_QA_ALLOWED_DESTINATIONS = 'malformed_invalid';
      expect(() => {
        service.validateDestinationOrThrow('invalid_phone', { _trustedServerQaFlag: true });
      }).not.toThrow();
    });
  });

  describe('Trusted Server-Side QA Call Registry & Call Classification', () => {
    beforeEach(() => {
      process.env.TELEPHONY_QA_ENABLED = 'true';
      process.env.TELEPHONY_QA_ALLOWED_DESTINATIONS = QA_ALLOWED_BUYER;
      process.env.TELNYX_QA_TRACKING_DID = QA_TRACKING_DID;
      process.env.TELNYX_QA_CALLER_ID = QA_CALLER_CLI;
    });

    it('rejects empty or whitespace runId on test run registration', () => {
      expect(() => service.registerActiveTestRun('')).toThrow('Invalid runId');
      expect(() => service.registerActiveTestRun('   ')).toThrow('Invalid runId');
    });

    it('rejects binding to an unknown or unregistered test run', () => {
      expect(() => service.bindCallToTestRun('call_100', 'unregistered_run')).toThrow(
        'is not registered',
      );
    });

    it('rejects binding with empty or whitespace callId', () => {
      service.registerActiveTestRun('valid_run');
      expect(() => service.bindCallToTestRun('', 'valid_run')).toThrow('Invalid callId');
    });

    it('recognizes a raw Prisma-like Call entity only through valid registry binding', () => {
      service.registerActiveTestRun('run_alpha');
      service.bindCallToTestRun('call_prisma_uuid_1', 'run_alpha');

      // Raw Prisma object containing only standard DB schema fields
      const prismaCall = {
        id: 'call_prisma_uuid_1',
        workspace_id: 'ws_test_123',
        campaign_id: 'camp_456',
        provider_call_id: 'v3:telnyx_control_abc',
        from_number: QA_CALLER_CLI,
        to_number: QA_TRACKING_DID,
        state: 'ROUTING',
      };

      expect(service.isQaCall(prismaCall)).toBe(true);
      expect(service.isCallBound(prismaCall.id)).toBe(true);
    });

    it('fails closed for unregistered call IDs', () => {
      const unregisteredPrismaCall = {
        id: 'call_unregistered_999',
        workspace_id: 'ws_test_123',
        from_number: QA_CALLER_CLI,
        to_number: QA_TRACKING_DID,
      };

      expect(service.isQaCall(unregisteredPrismaCall)).toBe(false);
      expect(service.isCallBound(unregisteredPrismaCall.id)).toBe(false);
    });

    it('NEVER classifies a call as QA based on tracking DID alone', () => {
      expect(service.isQaCall({ to_number: QA_TRACKING_DID })).toBe(false);
    });

    it('NEVER classifies a call as QA based on caller CLI alone', () => {
      expect(service.isQaCall({ from_number: QA_CALLER_CLI })).toBe(false);
    });

    it('NEVER classifies a call as QA based on tracking DID + caller CLI without server binding', () => {
      expect(
        service.isQaCall({
          to_number: QA_TRACKING_DID,
          from_number: QA_CALLER_CLI,
        }),
      ).toBe(false);
    });

    it('rejects caller-supplied is_qa or isQa flags without server-side binding', () => {
      expect(service.isQaCall({ is_qa: true })).toBe(false);
      expect(service.isQaCall({ isQa: true })).toBe(false);
      expect(
        service.isQaCall({
          id: 'unregistered_call',
          is_qa: true,
        }),
      ).toBe(false);
    });

    it('rejects caller-supplied arbitrary qa_test_run_id without server-side binding', () => {
      expect(
        service.isQaCall({
          to_number: QA_TRACKING_DID,
          metadata: { qa_test_run_id: 'arbitrary_untrusted_id' },
        }),
      ).toBe(false);
    });

    it('cleans up and releases call binding via releaseCallBinding()', () => {
      service.registerActiveTestRun('run_lifecycle');
      service.bindCallToTestRun('call_lifecycle_1', 'run_lifecycle');

      expect(service.isCallBound('call_lifecycle_1')).toBe(true);
      expect(service.isQaCall({ id: 'call_lifecycle_1' })).toBe(true);

      service.releaseCallBinding('call_lifecycle_1');

      expect(service.isCallBound('call_lifecycle_1')).toBe(false);
      expect(service.isQaCall({ id: 'call_lifecycle_1' })).toBe(false);
    });

    it('expires stale test runs and stale call bindings', () => {
      // Register with short 10ms TTL
      service.registerActiveTestRun('run_short_lived', { ttlMs: 10 });
      service.bindCallToTestRun('call_expiring', 'run_short_lived', 10);

      expect(service.isQaCall({ id: 'call_expiring' })).toBe(true);

      // Sleep 25ms to exceed TTL
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(service.isQaCall({ id: 'call_expiring' })).toBe(false);
          expect(service.isCallBound('call_expiring')).toBe(false);
          service.expireStaleBindings();
          expect(() => service.bindCallToTestRun('new_call', 'run_short_lived')).toThrow();
          resolve();
        }, 25);
      });
    });

    it('supports single-use cryptographic token binding via bindCallViaToken()', () => {
      const secretToken = 'sec_token_random_xyz_789';
      service.registerActiveTestRun('run_token_test', { secretToken });

      // First bind succeeds
      const bindSuccess = service.bindCallViaToken('call_via_token_1', secretToken);
      expect(bindSuccess).toBe(true);
      expect(service.isQaCall({ id: 'call_via_token_1' })).toBe(true);

      // Second attempt with same token fails because token was consumed (single-use)
      const replaySuccess = service.bindCallViaToken('call_replay_2', secretToken);
      expect(replaySuccess).toBe(false);
      expect(service.isQaCall({ id: 'call_replay_2' })).toBe(false);
    });

    it('bypasses production calls even when QA mode is enabled (Rule 12)', () => {
      const prodCall = {
        id: 'prod_call_uuid_999',
        to_number: '+15559998888',
        from_number: '+15552223333',
      };
      expect(service.isQaCall(prodCall)).toBe(false);

      // Production destination is not in QA allowlist, but production calls must not be blocked
      expect(() => {
        service.validateDestinationOrThrow(UNAUTHORIZED_BUYER, prodCall);
      }).not.toThrow();
    });

    it('treats unclassifiable call as production by default (Rule 13)', () => {
      expect(service.isQaCall(undefined)).toBe(false);
      expect(service.isQaCall({})).toBe(false);

      expect(() => {
        service.validateDestinationOrThrow(UNAUTHORIZED_BUYER, undefined);
      }).not.toThrow();

      expect(() => {
        service.validateDestinationOrThrow(UNAUTHORIZED_BUYER, {});
      }).not.toThrow();
    });
  });

  describe('Rule 3, 7 & 8: Allowed Destination Validation in QA Mode', () => {
    beforeEach(() => {
      process.env.TELEPHONY_QA_ENABLED = 'true';
      process.env.TELEPHONY_QA_ALLOWED_DESTINATIONS = `${QA_ALLOWED_BUYER}, +13125550199`;

      service.registerActiveTestRun('run_dest_val');
      service.bindCallToTestRun('call_val_1', 'run_dest_val');
    });

    const boundQaCall = { id: 'call_val_1' };

    it('allows dialing matching authorized E.164 destination', () => {
      expect(() => {
        service.validateDestinationOrThrow(QA_ALLOWED_BUYER, boundQaCall);
      }).not.toThrow();
    });

    it('normalizes destination before comparison (Rule 7)', () => {
      // Formats of (202) 555-0199, 12025550199 normalize to +12025550199
      expect(() => {
        service.validateDestinationOrThrow('(202) 555-0199', boundQaCall);
      }).not.toThrow();

      expect(() => {
        service.validateDestinationOrThrow('12025550199', boundQaCall);
      }).not.toThrow();

      expect(() => {
        service.validateDestinationOrThrow('  +12025550199  ', boundQaCall);
      }).not.toThrow();
    });

    it('denies unauthorized destination with TelephonyProviderError(ROUTING_FAILED) (Rule 8)', () => {
      let thrownError: any;
      try {
        service.validateDestinationOrThrow(UNAUTHORIZED_BUYER, boundQaCall);
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError).toBeInstanceOf(TelephonyProviderError);
      expect(thrownError.type).toBe(TelephonyErrorType.ROUTING_FAILED);
      expect(thrownError.message).toContain('not authorized for QA');
    });
  });

  describe('Rule 4: Empty or Whitespace Allowlist Fails Closed', () => {
    beforeEach(() => {
      service.registerActiveTestRun('run_empty_test');
      service.bindCallToTestRun('call_empty_1', 'run_empty_test');
    });

    const boundQaCall = { id: 'call_empty_1' };

    it('fails closed when TELEPHONY_QA_ALLOWED_DESTINATIONS is unset', () => {
      process.env.TELEPHONY_QA_ENABLED = 'true';
      delete process.env.TELEPHONY_QA_ALLOWED_DESTINATIONS;

      expect(() => {
        service.validateDestinationOrThrow(QA_ALLOWED_BUYER, boundQaCall);
      }).toThrowError(TelephonyProviderError);

      try {
        service.validateDestinationOrThrow(QA_ALLOWED_BUYER, boundQaCall);
      } catch (err: any) {
        expect(err.type).toBe(TelephonyErrorType.ROUTING_FAILED);
        expect(err.message).toContain('unset or empty');
      }
    });

    it('fails closed when TELEPHONY_QA_ALLOWED_DESTINATIONS is empty or whitespace', () => {
      process.env.TELEPHONY_QA_ENABLED = 'true';
      process.env.TELEPHONY_QA_ALLOWED_DESTINATIONS = '   ';

      expect(() => {
        service.validateDestinationOrThrow(QA_ALLOWED_BUYER, boundQaCall);
      }).toThrowError(TelephonyProviderError);
    });

    it('fails closed when TELEPHONY_QA_ALLOWED_DESTINATIONS contains only commas', () => {
      process.env.TELEPHONY_QA_ENABLED = 'true';
      process.env.TELEPHONY_QA_ALLOWED_DESTINATIONS = ',,,';

      expect(() => {
        service.validateDestinationOrThrow(QA_ALLOWED_BUYER, boundQaCall);
      }).toThrowError(TelephonyProviderError);
    });
  });

  describe('Rule 5: Malformed Allowlist Entries Fail Closed (Entire Configuration Rejected)', () => {
    beforeEach(() => {
      service.registerActiveTestRun('run_malformed_test');
      service.bindCallToTestRun('call_malformed_1', 'run_malformed_test');
    });

    const boundQaCall = { id: 'call_malformed_1' };

    it('rejects entire allowlist if any single entry is invalid E.164 text', () => {
      process.env.TELEPHONY_QA_ENABLED = 'true';
      process.env.TELEPHONY_QA_ALLOWED_DESTINATIONS = `${QA_ALLOWED_BUYER}, invalid_number`;

      expect(() => {
        service.validateDestinationOrThrow(QA_ALLOWED_BUYER, boundQaCall);
      }).toThrowError(TelephonyProviderError);

      try {
        service.validateDestinationOrThrow(QA_ALLOWED_BUYER, boundQaCall);
      } catch (err: any) {
        expect(err.type).toBe(TelephonyErrorType.ROUTING_FAILED);
        expect(err.message).toContain('Malformed entry');
      }
    });

    it('rejects entire allowlist if any single entry is a SIP URI (Rule 9)', () => {
      process.env.TELEPHONY_QA_ENABLED = 'true';
      process.env.TELEPHONY_QA_ALLOWED_DESTINATIONS = `${QA_ALLOWED_BUYER}, sip:arpitmishra9178@sip.telnyx.com`;

      expect(() => {
        service.validateDestinationOrThrow(QA_ALLOWED_BUYER, boundQaCall);
      }).toThrowError(TelephonyProviderError);
    });

    it('rejects entire allowlist if any entry has invalid country code (+0)', () => {
      process.env.TELEPHONY_QA_ENABLED = 'true';
      process.env.TELEPHONY_QA_ALLOWED_DESTINATIONS = `${QA_ALLOWED_BUYER}, +0123456789`;

      expect(() => {
        service.validateDestinationOrThrow(QA_ALLOWED_BUYER, boundQaCall);
      }).toThrowError(TelephonyProviderError);
    });
  });

  describe('Rule 6: Comma-Separated Values, Whitespace, & Duplicate Handling', () => {
    it('normalizes duplicates cleanly into a unique Set', () => {
      process.env.TELEPHONY_QA_ENABLED = 'true';
      process.env.TELEPHONY_QA_ALLOWED_DESTINATIONS =
        ' +12025550199 , 12025550199 , (202) 555-0199 , +13125550199 ';

      const res = service.parseAllowlist();
      expect(res.valid).toBe(true);
      expect(res.allowedSet.size).toBe(2);
      expect(res.allowedSet.has('+12025550199')).toBe(true);
      expect(res.allowedSet.has('+13125550199')).toBe(true);
    });
  });

  describe('Rule 7 & 9: Destination Format Validation', () => {
    beforeEach(() => {
      process.env.TELEPHONY_QA_ENABLED = 'true';
      process.env.TELEPHONY_QA_ALLOWED_DESTINATIONS = QA_ALLOWED_BUYER;

      service.registerActiveTestRun('run_fmt_test');
      service.bindCallToTestRun('call_fmt_1', 'run_fmt_test');
    });

    const boundQaCall = { id: 'call_fmt_1' };

    it('rejects non-phone strings as destination candidates', () => {
      expect(() => {
        service.validateDestinationOrThrow('garbage', boundQaCall);
      }).toThrowError(TelephonyProviderError);
    });

    it('rejects SIP URIs as destination candidates in generic validation (Rule 9)', () => {
      expect(() => {
        service.validateDestinationOrThrow('sip:arpitmishra9178@sip.telnyx.com', boundQaCall);
      }).toThrowError(TelephonyProviderError);
    });

    it('rejects empty or whitespace destination candidates', () => {
      expect(() => {
        service.validateDestinationOrThrow('', boundQaCall);
      }).toThrowError(TelephonyProviderError);

      expect(() => {
        service.validateDestinationOrThrow('   ', boundQaCall);
      }).toThrowError(TelephonyProviderError);
    });
  });

  describe('Rule 10: Strict Buyer Destination Enforcement (No Implicit Authorization)', () => {
    beforeEach(() => {
      process.env.TELEPHONY_QA_ENABLED = 'true';
      process.env.TELEPHONY_QA_ALLOWED_DESTINATIONS = QA_ALLOWED_BUYER;
      process.env.TELNYX_QA_TRACKING_DID = QA_TRACKING_DID;
      process.env.TELNYX_QA_CALLER_ID = QA_CALLER_CLI;

      service.registerActiveTestRun('run_no_implicit');
      service.bindCallToTestRun('call_no_implicit_1', 'run_no_implicit');
    });

    it('does NOT permit dialing tracking DID just because call arrived on tracking DID', () => {
      const boundQaCall = {
        id: 'call_no_implicit_1',
        to_number: QA_TRACKING_DID,
        from_number: QA_CALLER_CLI,
      };

      expect(() => {
        service.validateDestinationOrThrow(QA_TRACKING_DID, boundQaCall);
      }).toThrowError(TelephonyProviderError);
    });
  });

  describe('Rule 11: CallController.dialNextBuyer() Enforcement Point Integration', () => {
    let controller: CallController;
    let mockProvider: any;
    let mockPrisma: any;
    let mockCallsService: any;

    beforeEach(() => {
      process.env.TELEPHONY_QA_ENABLED = 'true';
      process.env.TELEPHONY_QA_ALLOWED_DESTINATIONS = QA_ALLOWED_BUYER;
      process.env.TELNYX_QA_TRACKING_DID = QA_TRACKING_DID;
      process.env.TELNYX_QA_CALLER_ID = QA_CALLER_CLI;

      service.registerActiveTestRun('run_controller_test');
      service.bindCallToTestRun('call_1', 'run_controller_test');

      mockProvider = {
        dialBuyer: vi.fn().mockResolvedValue('v3:buyer_leg_123'),
        hangupCall: vi.fn().mockResolvedValue(undefined),
        startRingback: vi.fn().mockResolvedValue(undefined),
        stopRingback: vi.fn().mockResolvedValue(undefined),
      };

      mockPrisma = {
        call: { findUnique: vi.fn() },
        callAttempt: { findUnique: vi.fn().mockResolvedValue({ id: 'att_1', state: CallAttemptState.INITIATED }) },
      };

      mockCallsService = {
        prepareNextBuyer: vi.fn(),
        commitBuyerDial: vi.fn().mockResolvedValue(false),
        releaseBuyerReservation: vi.fn().mockResolvedValue(undefined),
        transitionAttempt: vi.fn().mockResolvedValue(undefined),
      };

      controller = new CallController(
        mockProvider,
        mockPrisma,
        mockCallsService,
        {} as any,
        { calculateInitialReservation: vi.fn() } as any,
        {} as any,
        {} as any,
        undefined,
        service,
      );
    });

    it('blocks unauthorized buyer, activates circuit-breaker, and terminates caller immediately', async () => {
      mockCallsService.prepareNextBuyer.mockResolvedValueOnce({
        action: 'DIAL',
        call: {
          id: 'call_1',
          provider_call_id: 'v3:caller_leg_123',
          workspace_id: 'ws_1',
          to_number: QA_TRACKING_DID,
          from_number: QA_CALLER_CLI,
        },
        attempt: { id: 'att_1' },
        buyer: { id: 'buyer_unauth', destination_number: UNAUTHORIZED_BUYER },
      });

      await controller.dialNextBuyer(
        {
          id: 'call_1',
          provider_call_id: 'v3:caller_leg_123',
          workspace_id: 'ws_1',
          to_number: QA_TRACKING_DID,
          from_number: QA_CALLER_CLI,
        } as any,
        'conn_1',
      );

      // Provider dialBuyer MUST NOT have been called for unauthorized destination
      expect(mockProvider.dialBuyer).not.toHaveBeenCalled();
      // Reservation released and attempt marked FAILED
      expect(mockCallsService.releaseBuyerReservation).toHaveBeenCalledWith('att_1');
      expect(mockCallsService.transitionAttempt).toHaveBeenCalledWith(
        'att_1',
        CallAttemptState.FAILED,
      );
      // QA Waterfall Circuit-Breaker terminated caller leg immediately
      expect(mockProvider.hangupCall).toHaveBeenCalledWith('v3:caller_leg_123');
      // Circuit-breaker must NOT call prepareNextBuyer a second time
      expect(mockCallsService.prepareNextBuyer).toHaveBeenCalledTimes(1);
    });

    it('allows authorized buyer and calls provider.dialBuyer() with normalized number', async () => {
      mockCallsService.prepareNextBuyer.mockResolvedValueOnce({
        action: 'DIAL',
        call: {
          id: 'call_1',
          provider_call_id: 'v3:caller_leg_123',
          workspace_id: 'ws_1',
          to_number: QA_TRACKING_DID,
          from_number: QA_CALLER_CLI,
        },
        attempt: { id: 'att_1' },
        buyer: { id: 'buyer_auth', destination_number: '(202) 555-0199' },
      });

      await controller.dialNextBuyer(
        {
          id: 'call_1',
          provider_call_id: 'v3:caller_leg_123',
          workspace_id: 'ws_1',
          to_number: QA_TRACKING_DID,
          from_number: QA_CALLER_CLI,
        } as any,
        'conn_1',
      );

      expect(mockProvider.dialBuyer).toHaveBeenCalledTimes(1);
      expect(mockProvider.dialBuyer).toHaveBeenCalledWith(
        '(202) 555-0199',
        QA_TRACKING_DID,
        'conn_1',
        30,
        expect.any(String),
        expect.arrayContaining([
          expect.objectContaining({ name: 'X-QA-Run-Id', value: 'run_controller_test' }),
        ]),
      );
    });
  });
  describe('Phase 6E: Dedicated QA Ingress Candidate & Inbound Lease Verification', () => {
    beforeEach(() => {
      process.env.TELEPHONY_QA_ENABLED = 'true';
      process.env.TELNYX_QA_TRACKING_DID = QA_TRACKING_DID;
      process.env.TELNYX_QA_CALLER_ID = QA_CALLER_CLI;
    });

    it('identifies configured tracking DID as a Dedicated QA Ingress Candidate', () => {
      expect(service.isDedicatedQaIngress(QA_TRACKING_DID)).toBe(true);
      expect(service.isDedicatedQaIngress('14845560110')).toBe(true);
      expect(service.isDedicatedQaIngress('(484) 556-0110')).toBe(true);
    });

    it('rejects ordinary production numbers from QA Ingress Candidate classification', () => {
      expect(service.isDedicatedQaIngress('+18883164519')).toBe(false);
      expect(service.isDedicatedQaIngress('+15551234567')).toBe(false);
      expect(service.isDedicatedQaIngress(undefined)).toBe(false);
      expect(service.isDedicatedQaIngress('')).toBe(false);
    });

    it('returns false for isDedicatedQaIngress when QA mode is disabled', () => {
      process.env.TELEPHONY_QA_ENABLED = 'false';
      expect(service.isDedicatedQaIngress(QA_TRACKING_DID)).toBe(false);
    });

    it('opens and consumes inbound test lease for matching call', () => {
      service.registerActiveTestRun('run_lease_test');
      const lease = service.openInboundTestLease({
        runId: 'run_lease_test',
        expectedCallerCli: QA_CALLER_CLI,
      });

      expect(lease.leaseId).toBeDefined();
      expect(lease.secretToken).toBeDefined();
      expect(lease.consumed).toBe(false);

      // Consume lease upon call arrival
      const match = service.consumeInboundLease('v3:provider_leg_lease_1', {
        from: QA_CALLER_CLI,
        to: QA_TRACKING_DID,
      });

      expect(match).not.toBeNull();
      expect(match?.runId).toBe('run_lease_test');
      expect(service.isCallBound('v3:provider_leg_lease_1')).toBe(true);

      // Replay attempt must fail because lease was consumed (single-use)
      const replayMatch = service.consumeInboundLease('v3:provider_leg_replay_2', {
        from: QA_CALLER_CLI,
        to: QA_TRACKING_DID,
      });
      expect(replayMatch).toBeNull();
    });

    it('rejects lease consumption if caller CLI does not match expected CLI', () => {
      service.registerActiveTestRun('run_cli_mismatch');
      service.openInboundTestLease({
        runId: 'run_cli_mismatch',
        expectedCallerCli: QA_CALLER_CLI,
      });

      const match = service.consumeInboundLease('v3:provider_leg_bad_cli', {
        from: '+15559998888', // Unauthorized caller CLI
        to: QA_TRACKING_DID,
      });

      expect(match).toBeNull();
      expect(service.isCallBound('v3:provider_leg_bad_cli')).toBe(false);
    });

    it('rejects lease consumption if token does not match', () => {
      service.registerActiveTestRun('run_token_mismatch');
      service.openInboundTestLease({
        runId: 'run_token_mismatch',
        secretToken: 'correct_secret_token_123',
      });

      const match = service.consumeInboundLease('v3:provider_leg_bad_token', {
        from: QA_CALLER_CLI,
        to: QA_TRACKING_DID,
        token: 'wrong_secret_token_456',
      });

      expect(match).toBeNull();
      expect(service.isCallBound('v3:provider_leg_bad_token')).toBe(false);
    });

    it('rejects lease consumption if lease has expired', () => {
      service.registerActiveTestRun('run_lease_expire');
      service.openInboundTestLease({
        runId: 'run_lease_expire',
        ttlMs: 10, // 10ms short TTL
      });

      return new Promise((resolve) => {
        setTimeout(() => {
          const match = service.consumeInboundLease('v3:provider_leg_expired', {
            from: QA_CALLER_CLI,
            to: QA_TRACKING_DID,
          });
          expect(match).toBeNull();
          expect(service.isCallBound('v3:provider_leg_expired')).toBe(false);
          resolve();
        }, 25);
      });
    });

    it('returns null when no active lease exists on dedicated QA ingress', () => {
      const match = service.consumeInboundLease('v3:provider_leg_no_lease', {
        from: QA_CALLER_CLI,
        to: QA_TRACKING_DID,
      });
      expect(match).toBeNull();
    });
  });

  describe('Phase 7B-1: Persistent QA DID Identity & Ingress Gate', () => {
    it('isQaIngressDid recognizes configured QA DID regardless of TELEPHONY_QA_ENABLED', () => {
      process.env.TELNYX_QA_TRACKING_DID = '+14845560110';

      // 1. When TELEPHONY_QA_ENABLED is unset / false
      delete process.env.TELEPHONY_QA_ENABLED;
      expect(service.isQaIngressDid('+14845560110')).toBe(true);
      expect(service.isQaIngressDid('14845560110')).toBe(true);
      expect(service.isQaIngressDid('+1 (484) 556-0110')).toBe(true);

      // 2. When TELEPHONY_QA_ENABLED is true
      process.env.TELEPHONY_QA_ENABLED = 'true';
      expect(service.isQaIngressDid('+14845560110')).toBe(true);

      // 3. Different number returns false
      expect(service.isQaIngressDid('+15551234567')).toBe(false);
      expect(service.isQaIngressDid(null)).toBe(false);
      expect(service.isQaIngressDid('')).toBe(false);
    });

    it('isQaWorkspace checks workspace against QA_WORKSPACE_ID', () => {
      process.env.QA_WORKSPACE_ID = '550e8400-e29b-41d4-a716-446655440000';

      expect(service.isQaWorkspace('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(service.isQaWorkspace('  550e8400-e29b-41d4-a716-446655440000  ')).toBe(true);
      expect(service.isQaWorkspace('550E8400-E29B-41D4-A716-446655440000')).toBe(true);

      expect(service.isQaWorkspace('other-workspace-uuid')).toBe(false);
      expect(service.isQaWorkspace(null)).toBe(false);
      expect(service.isQaWorkspace('')).toBe(false);
    });

    it('validateConfiguration passes when QA is disabled', () => {
      process.env.TELEPHONY_QA_ENABLED = 'false';
      const result = service.validateConfiguration();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('validateConfiguration fails closed when QA is enabled but parameters are missing or invalid', () => {
      process.env.TELEPHONY_QA_ENABLED = 'true';
      delete process.env.TELNYX_QA_TRACKING_DID;
      delete process.env.QA_WORKSPACE_ID;
      delete process.env.TELEPHONY_QA_BUYER_SIP_URI;
      delete process.env.TELEPHONY_QA_BUYER_A_SIP_URI;
      delete process.env.TELEPHONY_QA_BUYER_B_SIP_URI;

      const result = service.validateConfiguration();
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
      expect(result.errors.some((e) => e.includes('TELNYX_QA_TRACKING_DID'))).toBe(true);
      expect(result.errors.some((e) => e.includes('QA_WORKSPACE_ID'))).toBe(true);
      expect(result.errors.some((e) => e.includes('TELEPHONY_QA_BUYER_SIP_URI'))).toBe(true);
    });

    it('validateConfiguration validates strict SIP URI and loopback ARI URL', () => {
      process.env.TELEPHONY_QA_ENABLED = 'true';
      process.env.TELNYX_QA_TRACKING_DID = '+14845560110';
      process.env.QA_WORKSPACE_ID = '550e8400-e29b-41d4-a716-446655440000';
      delete process.env.TELEPHONY_QA_BUYER_A_SIP_URI;
      delete process.env.TELEPHONY_QA_BUYER_B_SIP_URI;
      process.env.TELEPHONY_QA_BUYER_SIP_URI = 'sip:qa-buyer@unauthorized.com'; // Unauthorized domain
      process.env.TELEPHONY_QA_ARI_URL = 'http://public-ip.com:8088'; // Non-loopback URL
      process.env.TELEPHONY_QA_ARI_USERNAME = 'user';
      process.env.TELEPHONY_QA_ARI_PASSWORD = 'pass';

      const result = service.validateConfiguration();
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('TELEPHONY_QA_BUYER_SIP_URI'))).toBe(true);
      expect(result.errors.some((e) => e.includes('TELEPHONY_QA_ARI_URL'))).toBe(true);
    });

    it('validateConfiguration succeeds when all settings are strictly valid', () => {
      process.env.TELEPHONY_QA_ENABLED = 'true';
      process.env.TELNYX_QA_TRACKING_DID = '+14845560110';
      process.env.QA_WORKSPACE_ID = '550e8400-e29b-41d4-a716-446655440000';
      process.env.TELEPHONY_QA_BUYER_SIP_URI = 'sip:arpitmishra9178@sip.telnyx.com';
      process.env.TELEPHONY_QA_ARI_URL = 'http://127.0.0.1:8088';
      process.env.TELEPHONY_QA_ARI_USERNAME = 'asterisk';
      process.env.TELEPHONY_QA_ARI_PASSWORD = 'secretpassword';

      const result = service.validateConfiguration();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('validateConfiguration succeeds with TELEPHONY_QA_BUYER_A_SIP_URI and TELEPHONY_QA_BUYER_B_SIP_URI', () => {
      process.env.TELEPHONY_QA_ENABLED = 'true';
      process.env.TELNYX_QA_TRACKING_DID = '+14845560110';
      process.env.QA_WORKSPACE_ID = '550e8400-e29b-41d4-a716-446655440000';
      delete process.env.TELEPHONY_QA_BUYER_SIP_URI;
      process.env.TELEPHONY_QA_BUYER_A_SIP_URI = 'sip:qa-buyer-a@sip.telnyx.com';
      process.env.TELEPHONY_QA_BUYER_B_SIP_URI = 'sip:qa-buyer-b@sip.telnyx.com';

      const result = service.validateConfiguration();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('validateConfiguration rejects unauthorized domain in TELEPHONY_QA_BUYER_B_SIP_URI', () => {
      process.env.TELEPHONY_QA_ENABLED = 'true';
      process.env.TELNYX_QA_TRACKING_DID = '+14845560110';
      process.env.QA_WORKSPACE_ID = '550e8400-e29b-41d4-a716-446655440000';
      process.env.TELEPHONY_QA_BUYER_A_SIP_URI = 'sip:qa-buyer-a@sip.telnyx.com';
      process.env.TELEPHONY_QA_BUYER_B_SIP_URI = 'sip:qa-buyer-b@unauthorized.com';

      const result = service.validateConfiguration();
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('TELEPHONY_QA_BUYER_B_SIP_URI'))).toBe(true);
    });
  });

  describe('Phase 7B-10C: Trusted SIP Identity & Ingress Correlation Fix', () => {
    const TRUSTED_QA_CONN_ID = '3090207513618941231';
    const QA_DID = '+17252574041';
    const PROD_DID = '+14845560110';
    const ASTERISK_SIP_URI = 'sip:arpitmishra917@sip.telnyx.com';

    beforeEach(() => {
      process.env.TELEPHONY_QA_ENABLED = 'true';
      process.env.TELNYX_QA_TRACKING_DID = QA_DID;
      process.env.TELNYX_QA_CALL_CONTROL_APP_ID = TRUSTED_QA_CONN_ID;
      process.env.QA_WORKSPACE_ID = '5e20bafe-7306-4da7-9944-62c4c5575a5a';
      process.env.TELEPHONY_QA_BUYER_SIP_URI = 'sip:arpitmishra9178@sip.telnyx.com';
    });

    it('1. consumes lease with correct trusted QA connection identity, DID, and SIP caller', () => {
      service.registerActiveTestRun('run_trusted_10c');
      service.openInboundTestLease({
        runId: 'run_trusted_10c',
        expectedCallerSipUri: ASTERISK_SIP_URI,
        expectedConnectionId: TRUSTED_QA_CONN_ID,
      });

      const match = service.consumeInboundLease('v3:leg_trusted_ok', {
        from: 'arpitmishra917@sip.telnyx.com',
        to: QA_DID,
        connectionId: TRUSTED_QA_CONN_ID,
      });

      expect(match).not.toBeNull();
      expect(match?.runId).toBe('run_trusted_10c');
      expect(service.isCallBound('v3:leg_trusted_ok')).toBe(true);
    });

    it('2. rejects call to correct QA DID with untrusted connection ID', () => {
      service.registerActiveTestRun('run_untrusted_conn');
      service.openInboundTestLease({
        runId: 'run_untrusted_conn',
        expectedConnectionId: TRUSTED_QA_CONN_ID,
        expectedCallerSipUri: ASTERISK_SIP_URI,
      });

      const match = service.consumeInboundLease('v3:leg_untrusted_conn', {
        from: ASTERISK_SIP_URI,
        to: QA_DID,
        connectionId: 'untrusted_attacker_conn_999',
      });

      expect(match).toBeNull();
      expect(service.isCallBound('v3:leg_untrusted_conn')).toBe(false);
    });

    it('3. rejects call with matching SIP username but wrong connection ID', () => {
      service.registerActiveTestRun('run_matching_sip_wrong_conn');
      service.openInboundTestLease({
        runId: 'run_matching_sip_wrong_conn',
        expectedConnectionId: TRUSTED_QA_CONN_ID,
        expectedCallerSipUri: ASTERISK_SIP_URI,
      });

      const match = service.consumeInboundLease('v3:leg_matching_sip_wrong_conn', {
        from: 'sip:arpitmishra917@sip.telnyx.com',
        to: QA_DID,
        connectionId: 'rogue_app_id_12345',
      });

      expect(match).toBeNull();
      expect(service.isCallBound('v3:leg_matching_sip_wrong_conn')).toBe(false);
    });

    it('4. rejects spoofed From and P-Asserted-Identity when no matching lease is open', () => {
      // No lease opened for this call
      const match = service.consumeInboundLease('v3:leg_spoofed_headers', {
        from: '<sip:arpitmishra917@sip.telnyx.com>',
        to: QA_DID,
        connectionId: TRUSTED_QA_CONN_ID,
      });

      expect(match).toBeNull();
      expect(service.isCallBound('v3:leg_spoofed_headers')).toBe(false);
    });

    it('5. rejects call when provider connection_id is missing or empty', () => {
      service.registerActiveTestRun('run_missing_provider_id');
      service.openInboundTestLease({
        runId: 'run_missing_provider_id',
        expectedConnectionId: TRUSTED_QA_CONN_ID,
      });

      const matchUndefined = service.consumeInboundLease('v3:leg_missing_conn', {
        from: ASTERISK_SIP_URI,
        to: QA_DID,
        connectionId: undefined,
      });
      expect(matchUndefined).toBeNull();

      const matchEmpty = service.consumeInboundLease('v3:leg_empty_conn', {
        from: ASTERISK_SIP_URI,
        to: QA_DID,
        connectionId: '   ',
      });
      expect(matchEmpty).toBeNull();
    });

    it('6. rejects malformed SIP URIs without converting to numeric digits', () => {
      service.registerActiveTestRun('run_malformed_sip');
      service.openInboundTestLease({
        runId: 'run_malformed_sip',
        expectedCallerCli: QA_CALLER_CLI,
      });

      // Malformed SIP URI should be rejected and never stripped to numeric digits
      const match1 = service.consumeInboundLease('v3:leg_malformed_1', {
        from: 'malformed@@sip.telnyx.com',
        to: QA_DID,
        connectionId: TRUSTED_QA_CONN_ID,
      });
      expect(match1).toBeNull();

      const match2 = service.consumeInboundLease('v3:leg_malformed_2', {
        from: 'sip:invalid space@sip.telnyx.com',
        to: QA_DID,
        connectionId: TRUSTED_QA_CONN_ID,
      });
      expect(match2).toBeNull();
    });

    it('7. rejects call with mismatched CLI when lease expects specific E.164 CLI', () => {
      service.registerActiveTestRun('run_mismatched_cli');
      service.openInboundTestLease({
        runId: 'run_mismatched_cli',
        expectedCallerCli: '+17252574041',
        expectedConnectionId: TRUSTED_QA_CONN_ID,
      });

      const match = service.consumeInboundLease('v3:leg_wrong_cli', {
        from: '+15559876543', // Mismatched E.164 number
        to: QA_DID,
        connectionId: TRUSTED_QA_CONN_ID,
      });

      expect(match).toBeNull();
      expect(service.isCallBound('v3:leg_wrong_cli')).toBe(false);
    });

    it('8. rejects call when lease has expired', async () => {
      service.registerActiveTestRun('run_expired_10c');
      service.openInboundTestLease({
        runId: 'run_expired_10c',
        expectedConnectionId: TRUSTED_QA_CONN_ID,
        ttlMs: 15, // 15ms TTL
      });

      await new Promise((r) => setTimeout(r, 30));

      const match = service.consumeInboundLease('v3:leg_expired_call', {
        from: ASTERISK_SIP_URI,
        to: QA_DID,
        connectionId: TRUSTED_QA_CONN_ID,
      });

      expect(match).toBeNull();
      expect(service.isCallBound('v3:leg_expired_call')).toBe(false);
    });

    it('9. prevents replayed webhooks (single-use lease enforcement)', () => {
      service.registerActiveTestRun('run_replay_10c');
      service.openInboundTestLease({
        runId: 'run_replay_10c',
        expectedCallerSipUri: ASTERISK_SIP_URI,
        expectedConnectionId: TRUSTED_QA_CONN_ID,
      });

      // First webhook consumes lease
      const firstMatch = service.consumeInboundLease('v3:leg_orig_1', {
        from: ASTERISK_SIP_URI,
        to: QA_DID,
        connectionId: TRUSTED_QA_CONN_ID,
      });
      expect(firstMatch).not.toBeNull();
      expect(firstMatch?.runId).toBe('run_replay_10c');

      // Second webhook replay attempt must be rejected
      const replayMatch = service.consumeInboundLease('v3:leg_replay_2', {
        from: ASTERISK_SIP_URI,
        to: QA_DID,
        connectionId: TRUSTED_QA_CONN_ID,
      });
      expect(replayMatch).toBeNull();
    });

    it('10. rejects call to production DID and never touches QA lease', () => {
      service.registerActiveTestRun('run_prod_did_isolation');
      service.openInboundTestLease({
        runId: 'run_prod_did_isolation',
        expectedConnectionId: TRUSTED_QA_CONN_ID,
        expectedCallerSipUri: ASTERISK_SIP_URI,
      });

      const match = service.consumeInboundLease('v3:leg_prod_did', {
        from: ASTERISK_SIP_URI,
        to: PROD_DID, // Production tracking DID +14845560110
        connectionId: TRUSTED_QA_CONN_ID,
      });

      expect(match).toBeNull();
      expect(service.isCallBound('v3:leg_prod_did')).toBe(false);
    });

    it('11. handles concurrent lease consumption atomically (exactly one winner)', () => {
      service.registerActiveTestRun('run_concurrent_10c');
      service.openInboundTestLease({
        runId: 'run_concurrent_10c',
        expectedCallerSipUri: ASTERISK_SIP_URI,
        expectedConnectionId: TRUSTED_QA_CONN_ID,
      });

      // Simulate 5 simultaneous webhook calls racing for the same lease
      const results = [1, 2, 3, 4, 5].map((i) =>
        service.consumeInboundLease(`v3:concurrent_leg_${i}`, {
          from: ASTERISK_SIP_URI,
          to: QA_DID,
          connectionId: TRUSTED_QA_CONN_ID,
        }),
      );

      const successful = results.filter((r) => r !== null);
      const rejected = results.filter((r) => r === null);

      expect(successful).toHaveLength(1);
      expect(successful[0]?.runId).toBe('run_concurrent_10c');
      expect(rejected).toHaveLength(4);
    });

    it('12. parseCallerIdentity strictly separates E.164 numbers and SIP URIs without digit stripping', () => {
      // 1. Valid SIP URI - digits are NOT stripped from username
      const sipRes = service.parseCallerIdentity('arpitmishra917@sip.telnyx.com');
      expect(sipRes.type).toBe('SIP_URI');
      expect(sipRes.normalized).toBe('sip:arpitmishra917@sip.telnyx.com');
      expect(sipRes.user).toBe('arpitmishra917');
      expect(sipRes.host).toBe('sip.telnyx.com');

      // 2. SIP URI with scheme and port
      const sipPortRes = service.parseCallerIdentity('sip:arpitmishra9178@sip.telnyx.com:5060');
      expect(sipPortRes.type).toBe('SIP_URI');
      expect(sipPortRes.normalized).toBe('sip:arpitmishra9178@sip.telnyx.com:5060');
      expect(sipPortRes.user).toBe('arpitmishra9178');
      expect(sipPortRes.port).toBe('5060');

      // 3. SIP URI inside angle brackets (display name format)
      const bracketRes = service.parseCallerIdentity('"QA Caller" <sip:arpitmishra917@sip.telnyx.com>');
      expect(bracketRes.type).toBe('SIP_URI');
      expect(bracketRes.normalized).toBe('sip:arpitmishra917@sip.telnyx.com');
      expect(bracketRes.user).toBe('arpitmishra917');

      // 4. Valid E.164 phone numbers
      const e164Res = service.parseCallerIdentity('+17252574041');
      expect(e164Res.type).toBe('E164');
      expect(e164Res.normalized).toBe('+17252574041');

      // 5. Invalid / malformed inputs - never converted to numeric digits
      expect(service.parseCallerIdentity('malformed@@domain.com').type).toBe('INVALID');
      expect(service.parseCallerIdentity('sip:bad user@domain.com').type).toBe('INVALID');
      expect(service.parseCallerIdentity('12345').type).toBe('INVALID');
      expect(service.parseCallerIdentity('').type).toBe('INVALID');
      expect(service.parseCallerIdentity(null).type).toBe('INVALID');
    });
  });

});
