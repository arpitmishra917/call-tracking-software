import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QaSipUriAdapterService } from './qa-sip-uri-adapter.service.js';
import { QaTelephonyGuardService } from './qa-telephony-guard.service.js';
import { TelephonyProviderError, TelephonyErrorType } from '../telephony.errors.js';
import { CallController } from '../call-controller.js';
import { CallAttemptState } from '@prisma/client';

describe('QaSipUriAdapterService', () => {
  let adapter: QaSipUriAdapterService;
  let guardService: QaTelephonyGuardService;
  const originalEnv = { ...process.env };

  // Phase 6D: Disjoint Telephony Identities
  const QA_TRACKING_DID = '+14845560110';
  const QA_CALLER_CLI = '+17207159445';
  const QA_ALLOWED_BUYER = '+12025550199'; // NANPA Reserved Test Number
  const VALID_TELNYX_SIP_URI = 'sip:arpitmishra9178@sip.telnyx.com';
  const UNAUTHORIZED_BUYER = '+15559990000';

  beforeEach(() => {
    guardService = new QaTelephonyGuardService();
    adapter = new QaSipUriAdapterService(guardService);

    delete process.env.TELEPHONY_QA_ENABLED;
    delete process.env.TELEPHONY_QA_ALLOWED_DESTINATIONS;
    delete process.env.TELEPHONY_QA_BUYER_SIP_URI;
    delete process.env.TELNYX_QA_TRACKING_DID;
    delete process.env.TELNYX_QA_CALLER_ID;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    guardService.clearActiveTestRuns();
    process.env = { ...originalEnv };
  });

  describe('Configuration & Local Validation', () => {
    it('detects QA enabled state correctly', () => {
      expect(adapter.isQaEnabled()).toBe(false);
      process.env.TELEPHONY_QA_ENABLED = 'true';
      expect(adapter.isQaEnabled()).toBe(true);
    });

    it('reads configured buyer SIP URI', () => {
      process.env.TELEPHONY_QA_BUYER_SIP_URI = `  ${VALID_TELNYX_SIP_URI}  `;
      expect(adapter.getConfiguredBuyerSipUri()).toBe(VALID_TELNYX_SIP_URI);
    });
  });

  describe('SIP URI Domain & Format Validation', () => {
    it('validates standard Telnyx SIP URI', () => {
      const res = adapter.validateSipUri(VALID_TELNYX_SIP_URI);
      expect(res.valid).toBe(true);
      expect(res.uri).toBe(VALID_TELNYX_SIP_URI);
    });

    it('validates sips: scheme on Telnyx domain', () => {
      const res = adapter.validateSipUri('sips:arpitmishra9178@sip.telnyx.com');
      expect(res.valid).toBe(true);
      expect(res.uri).toBe('sips:arpitmishra9178@sip.telnyx.com');
    });

    it('validates SIP URI with explicit port', () => {
      const res = adapter.validateSipUri('sip:arpitmishra9178@sip.telnyx.com:5060');
      expect(res.valid).toBe(true);
      expect(res.uri).toBe('sip:arpitmishra9178@sip.telnyx.com:5060');
    });

    it('rejects malformed SIP URI strings', () => {
      expect(adapter.validateSipUri('').valid).toBe(false);
      expect(adapter.validateSipUri('invalid_uri_string').valid).toBe(false);
      expect(adapter.validateSipUri('http://sip.telnyx.com').valid).toBe(false);
      expect(adapter.validateSipUri('tel:+12025550199').valid).toBe(false);
      expect(adapter.validateSipUri('sip:useronly').valid).toBe(false);
    });

    it('rejects unauthorized external SIP domains', () => {
      const res1 = adapter.validateSipUri('sip:arpitmishra9178@sip.malicious.com');
      expect(res1.valid).toBe(false);
      expect(res1.error).toContain('Unauthorized SIP domain');

      const res2 = adapter.validateSipUri('sip:buyer@sip.pstn.twilio.com');
      expect(res2.valid).toBe(false);

      const res3 = adapter.validateSipUri('sip:test@127.0.0.1');
      expect(res3.valid).toBe(false);
    });
  });

  describe('resolveBuyerDestination() Behavior', () => {
    beforeEach(() => {
      process.env.TELEPHONY_QA_ENABLED = 'true';
      process.env.TELEPHONY_QA_ALLOWED_DESTINATIONS = QA_ALLOWED_BUYER;
      process.env.TELEPHONY_QA_BUYER_SIP_URI = VALID_TELNYX_SIP_URI;
      process.env.TELNYX_QA_TRACKING_DID = QA_TRACKING_DID;
      process.env.TELNYX_QA_CALLER_ID = QA_CALLER_CLI;

      guardService.registerActiveTestRun('test_run_1');
      guardService.bindCallToTestRun('call_qa_bound_1', 'test_run_1');
    });

    const boundQaCall = { id: 'call_qa_bound_1' };

    it('bypasses resolution and returns original E.164 for production destinations when QA mode is disabled', () => {
      process.env.TELEPHONY_QA_ENABLED = 'false';
      const prodDestination = '+15554443333';
      const resolved = adapter.resolveBuyerDestination(prodDestination, boundQaCall);
      expect(resolved).toBe(prodDestination);
    });

    it('bypasses resolution and returns original E.164 for production call when QA mode is enabled', () => {
      const prodCall = { id: 'call_prod_unbound_999' };
      const prodBuyerNumber = '+15554443333';

      const resolved = adapter.resolveBuyerDestination(prodBuyerNumber, prodCall);
      expect(resolved).toBe(prodBuyerNumber);
    });

    it('resolves authorized QA buyer to configured Telnyx SIP URI for securely bound QA call', () => {
      const resolved = adapter.resolveBuyerDestination(QA_ALLOWED_BUYER, boundQaCall);
      expect(resolved).toBe(VALID_TELNYX_SIP_URI);
    });

    it('resolves authorized QA buyer with formatted E.164 inputs', () => {
      const resolved = adapter.resolveBuyerDestination('(202) 555-0199', boundQaCall);
      expect(resolved).toBe(VALID_TELNYX_SIP_URI);
    });

    it('resolves authorized QA buyer using single-use token binding', () => {
      const token = 'token_for_sip_test_999';
      guardService.registerActiveTestRun('token_run_2', { secretToken: token });
      const bound = guardService.bindCallViaToken('call_token_bound_2', token);
      expect(bound).toBe(true);

      const resolved = adapter.resolveBuyerDestination(QA_ALLOWED_BUYER, { id: 'call_token_bound_2' });
      expect(resolved).toBe(VALID_TELNYX_SIP_URI);
    });
  });

  describe('Fail-Closed Invariants & Anti-Leak Protection', () => {
    beforeEach(() => {
      process.env.TELEPHONY_QA_ENABLED = 'true';
      process.env.TELEPHONY_QA_ALLOWED_DESTINATIONS = QA_ALLOWED_BUYER;

      guardService.registerActiveTestRun('test_run_fail_closed');
      guardService.bindCallToTestRun('call_qa_fc_1', 'test_run_fail_closed');
    });

    const boundQaCall = { id: 'call_qa_fc_1' };

    it('fails closed when destination is not in allowlist', () => {
      process.env.TELEPHONY_QA_BUYER_SIP_URI = VALID_TELNYX_SIP_URI;

      expect(() => {
        adapter.resolveBuyerDestination(UNAUTHORIZED_BUYER, boundQaCall);
      }).toThrowError(TelephonyProviderError);

      try {
        adapter.resolveBuyerDestination(UNAUTHORIZED_BUYER, boundQaCall);
      } catch (err: any) {
        expect(err.type).toBe(TelephonyErrorType.ROUTING_FAILED);
        expect(err.message).toContain('not authorized for QA');
      }
    });

    it('fails closed when TELEPHONY_QA_BUYER_SIP_URI is unset or empty', () => {
      delete process.env.TELEPHONY_QA_BUYER_SIP_URI;

      expect(() => {
        adapter.resolveBuyerDestination(QA_ALLOWED_BUYER, boundQaCall);
      }).toThrowError(TelephonyProviderError);

      try {
        adapter.resolveBuyerDestination(QA_ALLOWED_BUYER, boundQaCall);
      } catch (err: any) {
        expect(err.type).toBe(TelephonyErrorType.ROUTING_FAILED);
        expect(err.message).toContain('not configured');
      }
    });

    it('fails closed when TELEPHONY_QA_BUYER_SIP_URI is for an unauthorized domain', () => {
      process.env.TELEPHONY_QA_BUYER_SIP_URI = 'sip:buyer@sip.malicious.com';

      expect(() => {
        adapter.resolveBuyerDestination(QA_ALLOWED_BUYER, boundQaCall);
      }).toThrowError(TelephonyProviderError);

      try {
        adapter.resolveBuyerDestination(QA_ALLOWED_BUYER, boundQaCall);
      } catch (err: any) {
        expect(err.type).toBe(TelephonyErrorType.ROUTING_FAILED);
        expect(err.message).toContain('Unauthorized SIP domain');
      }
    });

    it('fails closed when TELEPHONY_QA_BUYER_SIP_URI is malformed', () => {
      process.env.TELEPHONY_QA_BUYER_SIP_URI = 'invalid_uri_string';

      expect(() => {
        adapter.resolveBuyerDestination(QA_ALLOWED_BUYER, boundQaCall);
      }).toThrowError(TelephonyProviderError);
    });
  });

  describe('CallController integration with QaSipUriAdapterService', () => {
    let controller: CallController;
    let mockProvider: any;
    let mockPrisma: any;
    let mockCallsService: any;

    beforeEach(() => {
      process.env.TELEPHONY_QA_ENABLED = 'true';
      process.env.TELEPHONY_QA_ALLOWED_DESTINATIONS = QA_ALLOWED_BUYER;
      process.env.TELEPHONY_QA_BUYER_SIP_URI = VALID_TELNYX_SIP_URI;
      process.env.TELNYX_QA_TRACKING_DID = QA_TRACKING_DID;
      process.env.TELNYX_QA_CALLER_ID = QA_CALLER_CLI;

      guardService.registerActiveTestRun('test_run_ctrl');
      guardService.bindCallToTestRun('call_qa_ctrl_1', 'test_run_ctrl');

      mockProvider = {
        dialBuyer: vi.fn().mockResolvedValue('v3:buyer_leg_qa_123'),
        hangupCall: vi.fn().mockResolvedValue(undefined),
        startRingback: vi.fn().mockResolvedValue(undefined),
        stopRingback: vi.fn().mockResolvedValue(undefined),
      };

      mockPrisma = {
        call: { findUnique: vi.fn() },
        callAttempt: {
          findUnique: vi.fn().mockResolvedValue({ id: 'att_qa_1', state: CallAttemptState.INITIATED }),
        },
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
        guardService,
        adapter,
      );
    });

    it('dials resolved SIP URI when call is QA and destination is allowed', async () => {
      mockCallsService.prepareNextBuyer.mockResolvedValueOnce({
        action: 'DIAL',
        call: {
          id: 'call_qa_ctrl_1',
          provider_call_id: 'v3:caller_leg_qa_123',
          workspace_id: 'ws_1',
          to_number: QA_TRACKING_DID,
          from_number: QA_CALLER_CLI,
        },
        attempt: { id: 'att_qa_1' },
        buyer: { id: 'buyer_qa', destination_number: QA_ALLOWED_BUYER },
      });

      await controller.dialNextBuyer(
        {
          id: 'call_qa_ctrl_1',
          provider_call_id: 'v3:caller_leg_qa_123',
          workspace_id: 'ws_1',
          to_number: QA_TRACKING_DID,
          from_number: QA_CALLER_CLI,
        } as any,
        'conn_qa',
      );

      // Verify provider was invoked with resolved SIP URI rather than E.164
      expect(mockProvider.dialBuyer).toHaveBeenCalledTimes(1);
      expect(mockProvider.dialBuyer).toHaveBeenCalledWith(
        VALID_TELNYX_SIP_URI,
        QA_TRACKING_DID,
        'conn_qa',
        30,
        expect.any(String),
        expect.arrayContaining([
          expect.objectContaining({ name: 'X-QA-Run-Id', value: 'test_run_ctrl' }),
        ]),
      );
    });

    it('dials original E.164 destination when call is a normal production call', async () => {
      const prodDestination = '+15554443333';
      mockCallsService.prepareNextBuyer.mockResolvedValueOnce({
        action: 'DIAL',
        call: {
          id: 'call_prod_1',
          workspace_id: 'ws_1',
          to_number: '+15551110000',
          from_number: '+15552220000',
        },
        attempt: { id: 'att_prod_1' },
        buyer: { id: 'buyer_prod', destination_number: prodDestination },
      });

      await controller.dialNextBuyer(
        {
          id: 'call_prod_1',
          workspace_id: 'ws_1',
          to_number: '+15551110000',
          from_number: '+15552220000',
        } as any,
        'conn_prod',
      );

      // In production, provider.dialBuyer must receive the original E.164 destination
      expect(mockProvider.dialBuyer).toHaveBeenCalledTimes(1);
      expect(mockProvider.dialBuyer).toHaveBeenCalledWith(
        prodDestination,
        '+15551110000',
        'conn_prod',
        30,
        expect.any(String),
        undefined,
      );
    });

    it('blocks call and never dials provider if buyer destination is not in QA allowlist', async () => {
      mockCallsService.prepareNextBuyer.mockResolvedValueOnce({
        action: 'DIAL',
        call: {
          id: 'call_qa_ctrl_1',
          provider_call_id: 'v3:caller_leg_qa_123',
          workspace_id: 'ws_1',
          to_number: QA_TRACKING_DID,
          from_number: QA_CALLER_CLI,
        },
        attempt: { id: 'att_blocked' },
        buyer: { id: 'buyer_bad', destination_number: UNAUTHORIZED_BUYER },
      });

      await controller.dialNextBuyer(
        {
          id: 'call_qa_ctrl_1',
          provider_call_id: 'v3:caller_leg_qa_123',
          workspace_id: 'ws_1',
          to_number: QA_TRACKING_DID,
          from_number: QA_CALLER_CLI,
        } as any,
        'conn_qa',
      );

      // Provider dialBuyer MUST NOT have been called
      expect(mockProvider.dialBuyer).not.toHaveBeenCalled();
      expect(mockCallsService.transitionAttempt).toHaveBeenCalledWith(
        'att_blocked',
        CallAttemptState.FAILED,
      );
      // Circuit-breaker terminated caller leg immediately
      expect(mockProvider.hangupCall).toHaveBeenCalledWith('v3:caller_leg_qa_123');
      // Circuit-breaker must NOT call prepareNextBuyer a second time
      expect(mockCallsService.prepareNextBuyer).toHaveBeenCalledTimes(1);
    });
  });

  describe('Phase 7B-1: Logical QA Buyer Destination Isolation (+12025550199)', () => {
    it('isLogicalQaBuyer identifies +12025550199 correctly', () => {
      expect(adapter.isLogicalQaBuyer('+12025550199')).toBe(true);
      expect(adapter.isLogicalQaBuyer('12025550199')).toBe(true);
      expect(adapter.isLogicalQaBuyer('+1 (202) 555-0199')).toBe(true);

      expect(adapter.isLogicalQaBuyer('+14845560110')).toBe(false);
      expect(adapter.isLogicalQaBuyer('+15551234567')).toBe(false);
      expect(adapter.isLogicalQaBuyer(null)).toBe(false);
    });

    it('blocks logical QA buyer +12025550199 from being dialed when QA is disabled', () => {
      process.env.TELEPHONY_QA_ENABLED = 'false';

      expect(() => {
        adapter.resolveBuyerDestination(QA_ALLOWED_BUYER, { _trustedServerQaFlag: true });
      }).toThrowError(TelephonyProviderError);

      try {
        adapter.resolveBuyerDestination(QA_ALLOWED_BUYER);
      } catch (err: any) {
        expect(err.type).toBe(TelephonyErrorType.ROUTING_FAILED);
        expect(err.message).toContain('Logical QA buyer destination');
      }
    });

    it('blocks logical QA buyer +12025550199 from being dialed in production/non-QA context', () => {
      process.env.TELEPHONY_QA_ENABLED = 'true';
      process.env.TELEPHONY_QA_BUYER_SIP_URI = VALID_TELNYX_SIP_URI;
      process.env.TELEPHONY_QA_ALLOWED_DESTINATIONS = QA_ALLOWED_BUYER;

      // An unverified call context
      const unverifiedCall = { id: 'call_unverified_prod_123' };

      expect(() => {
        adapter.resolveBuyerDestination(QA_ALLOWED_BUYER, unverifiedCall);
      }).toThrowError(TelephonyProviderError);
    });

    it('resolves logical QA buyer +12025550199 to SIP URI only in trusted QA context', () => {
      process.env.TELEPHONY_QA_ENABLED = 'true';
      process.env.TELEPHONY_QA_BUYER_SIP_URI = VALID_TELNYX_SIP_URI;
      process.env.TELEPHONY_QA_ALLOWED_DESTINATIONS = QA_ALLOWED_BUYER;

      guardService.registerActiveTestRun('run_logical_test');
      guardService.bindCallToTestRun('call_logical_1', 'run_logical_test');

      const trustedCall = { id: 'call_logical_1' };
      const resolved = adapter.resolveBuyerDestination(QA_ALLOWED_BUYER, trustedCall);
      expect(resolved).toBe(VALID_TELNYX_SIP_URI);
    });

    it('fails closed with TelephonyProviderError if SIP URI is missing (no PSTN fallback)', () => {
      process.env.TELEPHONY_QA_ENABLED = 'true';
      delete process.env.TELEPHONY_QA_BUYER_SIP_URI;
      delete process.env.TELEPHONY_QA_BUYER_A_SIP_URI;
      process.env.TELEPHONY_QA_ALLOWED_DESTINATIONS = QA_ALLOWED_BUYER;

      guardService.registerActiveTestRun('run_logical_no_sip');
      guardService.bindCallToTestRun('call_logical_no_sip_1', 'run_logical_no_sip');

      const trustedCall = { id: 'call_logical_no_sip_1' };
      expect(() => {
        adapter.resolveBuyerDestination(QA_ALLOWED_BUYER, trustedCall);
      }).toThrowError(TelephonyProviderError);
    });
  });

  describe('Phase QA-2F Remediation A: Deterministic Dual-Buyer QA SIP Routing', () => {
    const BUYER_A_CLI = '+12025550199';
    const BUYER_B_CLI = '+12025550198';
    const UNKNOWN_ALLOWED_CLI = '+12025550197';
    const UNAPPROVED_CLI = '+15559990000';

    const BUYER_A_URI = 'sip:qa-buyer-a@sip.telnyx.com';
    const BUYER_B_URI = 'sip:qa-buyer-b@sip.telnyx.com';

    const BUYER_A_UUID = '7deb4e0a-8674-4b4b-a170-0aff3991f69c';
    const BUYER_B_UUID = 'b0000000-0000-0000-0000-000000000002';

    beforeEach(() => {
      process.env.TELEPHONY_QA_ENABLED = 'true';
      process.env.TELEPHONY_QA_ALLOWED_DESTINATIONS = `${BUYER_A_CLI},${BUYER_B_CLI},${UNKNOWN_ALLOWED_CLI}`;
      process.env.TELEPHONY_QA_BUYER_A_SIP_URI = BUYER_A_URI;
      process.env.TELEPHONY_QA_BUYER_B_SIP_URI = BUYER_B_URI;

      guardService.registerActiveTestRun('run_qa2f_dual_buyer');
      guardService.bindCallToTestRun('call_qa2f_1', 'run_qa2f_dual_buyer');
    });

    const trustedCall = { id: 'call_qa2f_1' };

    it('1. Buyer A resolves only to Buyer A URI', () => {
      const resolved = adapter.resolveBuyerDestination(BUYER_A_CLI, trustedCall);
      expect(resolved).toBe(BUYER_A_URI);
      expect(resolved).not.toBe(BUYER_B_URI);

      // Verify with formatted phone number
      const resolvedFormatted = adapter.resolveBuyerDestination('(202) 555-0199', trustedCall);
      expect(resolvedFormatted).toBe(BUYER_A_URI);

      // Verify with Buyer A UUID in call context
      const resolvedContext = adapter.resolveBuyerDestination(BUYER_A_CLI, {
        id: 'call_qa2f_1',
        buyer_id: BUYER_A_UUID,
      });
      expect(resolvedContext).toBe(BUYER_A_URI);
    });

    it('2. Buyer B resolves only to Buyer B URI', () => {
      const resolved = adapter.resolveBuyerDestination(BUYER_B_CLI, trustedCall);
      expect(resolved).toBe(BUYER_B_URI);
      expect(resolved).not.toBe(BUYER_A_URI);

      // Verify with formatted phone number
      const resolvedFormatted = adapter.resolveBuyerDestination('(202) 555-0198', trustedCall);
      expect(resolvedFormatted).toBe(BUYER_B_URI);

      // Verify with Buyer B UUID in call context
      const resolvedContext = adapter.resolveBuyerDestination(BUYER_B_CLI, {
        id: 'call_qa2f_1',
        buyer_id: BUYER_B_UUID,
      });
      expect(resolvedContext).toBe(BUYER_B_URI);
    });

    it('3. Unknown buyer is rejected even if in allowlist', () => {
      expect(() => {
        adapter.resolveBuyerDestination(UNKNOWN_ALLOWED_CLI, trustedCall);
      }).toThrowError(TelephonyProviderError);

      try {
        adapter.resolveBuyerDestination(UNKNOWN_ALLOWED_CLI, trustedCall);
      } catch (err: any) {
        expect(err.type).toBe(TelephonyErrorType.ROUTING_FAILED);
        expect(err.message).toContain('rejected unknown buyer destination');
        expect(err.message).toContain('Only authorized QA buyers');
      }
    });

    it('4. Missing Buyer B configuration is rejected', () => {
      delete process.env.TELEPHONY_QA_BUYER_B_SIP_URI;

      expect(() => {
        adapter.resolveBuyerDestination(BUYER_B_CLI, trustedCall);
      }).toThrowError(TelephonyProviderError);

      try {
        adapter.resolveBuyerDestination(BUYER_B_CLI, trustedCall);
      } catch (err: any) {
        expect(err.type).toBe(TelephonyErrorType.ROUTING_FAILED);
        expect(err.message).toContain('TELEPHONY_QA_BUYER_B_SIP_URI is not configured');
      }
    });

    it('5. No accidental fallback from Buyer B to Buyer A', () => {
      // Configure Buyer A and legacy fallback, but leave Buyer B unset
      process.env.TELEPHONY_QA_BUYER_A_SIP_URI = BUYER_A_URI;
      process.env.TELEPHONY_QA_BUYER_SIP_URI = 'sip:legacy@sip.telnyx.com';
      delete process.env.TELEPHONY_QA_BUYER_B_SIP_URI;

      // Buyer A resolves normally
      expect(adapter.resolveBuyerDestination(BUYER_A_CLI, trustedCall)).toBe(BUYER_A_URI);

      // Buyer B MUST NOT fall back to Buyer A URI or legacy URI
      expect(() => {
        adapter.resolveBuyerDestination(BUYER_B_CLI, trustedCall);
      }).toThrowError(TelephonyProviderError);

      try {
        adapter.resolveBuyerDestination(BUYER_B_CLI, trustedCall);
      } catch (err: any) {
        expect(err.message).not.toContain(BUYER_A_URI);
        expect(err.message).toContain('TELEPHONY_QA_BUYER_B_SIP_URI is not configured');
      }
    });

    it('6. Invalid or unapproved destination is rejected', () => {
      // Case A: Unapproved E.164 destination
      expect(() => {
        adapter.resolveBuyerDestination(UNAPPROVED_CLI, trustedCall);
      }).toThrowError(TelephonyProviderError);

      try {
        adapter.resolveBuyerDestination(UNAPPROVED_CLI, trustedCall);
      } catch (err: any) {
        expect(err.type).toBe(TelephonyErrorType.ROUTING_FAILED);
        expect(err.message).toContain('not authorized for QA');
      }

      // Case B: Completely invalid non-phone string
      expect(() => {
        adapter.resolveBuyerDestination('invalid_string_123', trustedCall);
      }).toThrowError(TelephonyProviderError);
    });

    it('7. Malformed Buyer B SIP URI is rejected', () => {
      process.env.TELEPHONY_QA_BUYER_B_SIP_URI = 'sip:buyer-b@unauthorized.com';

      expect(() => {
        adapter.resolveBuyerDestination(BUYER_B_CLI, trustedCall);
      }).toThrowError(TelephonyProviderError);

      try {
        adapter.resolveBuyerDestination(BUYER_B_CLI, trustedCall);
      } catch (err: any) {
        expect(err.type).toBe(TelephonyErrorType.ROUTING_FAILED);
        expect(err.message).toContain('Unauthorized SIP domain');
      }
    });

    it('8. Buyer B number (+12025550198) fails closed when dialed outside QA context or when QA disabled', () => {
      // Subcase A: QA disabled
      process.env.TELEPHONY_QA_ENABLED = 'false';
      expect(() => {
        adapter.resolveBuyerDestination(BUYER_B_CLI, trustedCall);
      }).toThrowError(TelephonyProviderError);

      // Subcase B: QA enabled but call is unverified production context
      process.env.TELEPHONY_QA_ENABLED = 'true';
      const unverifiedCall = { id: 'call_unverified_prod_789' };
      expect(() => {
        adapter.resolveBuyerDestination(BUYER_B_CLI, unverifiedCall);
      }).toThrowError(TelephonyProviderError);
    });
  });
});
