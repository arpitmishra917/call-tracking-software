import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { parseAndValidateE164 } from '../../common/phone.utils.js';
import { TelephonyProviderError, TelephonyErrorType } from '../telephony.errors.js';

export interface AllowlistParseResult {
  valid: boolean;
  allowedSet: Set<string>;
  error?: string;
}

export interface QaTestRunRegistration {
  runId: string;
  secretToken?: string;
  registeredAt: number;
  expiresAt: number;
}

export interface QaCallBinding {
  callId: string;
  runId: string;
  boundAt: number;
  expiresAt: number;
  state: 'BOUND' | 'RELEASED';
}

export type CallerIdentityType = 'E164' | 'SIP_URI' | 'INVALID';

export interface ParsedCallerIdentity {
  type: CallerIdentityType;
  raw: string;
  normalized: string;
  user?: string;
  host?: string;
  port?: string;
}

export interface QaInboundLease {
  leaseId: string;
  runId: string;
  secretToken?: string;
  expectedCallerCli?: string;
  expectedCallerSipUri?: string;
  expectedConnectionId?: string;
  createdAt: number;
  expiresAt: number;
  consumed: boolean;
}

export interface QaInboundLeaseOptions {
  runId: string;
  secretToken?: string;
  expectedCallerCli?: string;
  expectedCallerSipUri?: string;
  expectedCallerIdentity?: string;
  expectedConnectionId?: string;
  ttlMs?: number;
}

export interface QaInboundLeaseContext {
  from?: string;
  to?: string;
  token?: string;
  connectionId?: string;
}

/**
 * Server-side QA Telephony Guard and Trusted Call Registry.
 *
 * Note on Multi-Instance Deployments:
 * This registry is in-memory and instance-local. In a multi-instance or clustered backend,
 * state is not distributed; requests reaching an instance lacking the binding fail closed
 * and are processed strictly as production calls (or rejected if entering via dedicated QA ingress).
 */
@Injectable()
export class QaTelephonyGuardService {
  private readonly logger = new Logger(QaTelephonyGuardService.name);
  private readonly activeTestRuns = new Map<string, QaTestRunRegistration>();
  private readonly boundCalls = new Map<string, QaCallBinding>();
  private readonly activeLeases = new Map<string, QaInboundLease>();

  /**
   * Determines whether a dialed "to" destination corresponds to the dedicated QA tracking DID,
   * completely independent of whether TELEPHONY_QA_ENABLED is true or false.
   * This is used by the permanent QA ingress shutdown gate.
   */
  public isQaIngressDid(toNumber?: string | null): boolean {
    if (!toNumber || typeof toNumber !== 'string') return false;

    const qaTrackingDid = process.env.TELNYX_QA_TRACKING_DID;
    if (!qaTrackingDid || !qaTrackingDid.trim()) return false;

    const normCandidate = parseAndValidateE164(toNumber);
    const normQaTracking = parseAndValidateE164(qaTrackingDid);

    if (normCandidate && normQaTracking) {
      return normCandidate === normQaTracking;
    }

    const candidateDigits = toNumber.replace(/\D/g, '');
    const qaDigits = qaTrackingDid.replace(/\D/g, '');
    return candidateDigits.length >= 10 && candidateDigits === qaDigits;
  }

  /**
   * Checks whether a workspace ID corresponds to the dedicated QA workspace.
   */
  public isQaWorkspace(workspaceId?: string | null): boolean {
    if (!workspaceId || typeof workspaceId !== 'string') return false;
    const qaWorkspaceId = process.env.QA_WORKSPACE_ID;
    if (!qaWorkspaceId || !qaWorkspaceId.trim()) return false;
    return workspaceId.trim().toLowerCase() === qaWorkspaceId.trim().toLowerCase();
  }

  /**
   * Performs strict startup and runtime configuration validation.
   * Fails closed if any required parameter is malformed or unauthorized.
   */
  public validateConfiguration(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // If QA is disabled, configuration does not enforce QA environment presence
    if (!this.isQaEnabled()) {
      return { valid: true, errors: [] };
    }

    // 1. Validate TELNYX_QA_TRACKING_DID
    const qaTrackingDid = process.env.TELNYX_QA_TRACKING_DID;
    if (!qaTrackingDid || !qaTrackingDid.trim()) {
      errors.push('TELNYX_QA_TRACKING_DID is unset or empty');
    } else if (!parseAndValidateE164(qaTrackingDid)) {
      errors.push(`TELNYX_QA_TRACKING_DID "${qaTrackingDid}" is not a valid E.164 phone number`);
    }

    // 2. Validate QA_WORKSPACE_ID
    const qaWorkspaceId = process.env.QA_WORKSPACE_ID;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!qaWorkspaceId || !qaWorkspaceId.trim()) {
      errors.push('QA_WORKSPACE_ID is unset or empty');
    } else if (!uuidRegex.test(qaWorkspaceId.trim())) {
      errors.push(`QA_WORKSPACE_ID "${qaWorkspaceId}" is not a valid UUID format`);
    }

    // 3. Validate Buyer SIP URIs (Buyer A and optional Buyer B)
    const buyerASipUri = process.env.TELEPHONY_QA_BUYER_A_SIP_URI || process.env.TELEPHONY_QA_BUYER_SIP_URI;
    const buyerBSipUri = process.env.TELEPHONY_QA_BUYER_B_SIP_URI;
    const sipRegex = /^sips?:[a-zA-Z0-9_.+-]+@sip\.telnyx\.com(:\d+)?$/i;
    if (!buyerASipUri || !buyerASipUri.trim()) {
      errors.push('TELEPHONY_QA_BUYER_SIP_URI (or TELEPHONY_QA_BUYER_A_SIP_URI) is unset or empty');
    } else if (!sipRegex.test(buyerASipUri.trim())) {
      errors.push(`TELEPHONY_QA_BUYER_SIP_URI "${buyerASipUri}" must be a valid SIP URI on sip.telnyx.com`);
    }
    if (buyerBSipUri && !sipRegex.test(buyerBSipUri.trim())) {
      errors.push(`TELEPHONY_QA_BUYER_B_SIP_URI "${buyerBSipUri}" must be a valid SIP URI on sip.telnyx.com`);
    }

    // 4. Validate TELEPHONY_QA_ARI_URL
    const ariUrl = process.env.TELEPHONY_QA_ARI_URL || process.env.TELEPHONY_QA_SERVER_URL;
    if (ariUrl && ariUrl.trim()) {
      try {
        const parsed = new URL(ariUrl.trim());
        const host = parsed.hostname.toLowerCase();
        if (host !== '127.0.0.1' && host !== 'localhost') {
          errors.push(`TELEPHONY_QA_ARI_URL must be a local loopback address (got ${host})`);
        }
      } catch {
        errors.push(`TELEPHONY_QA_ARI_URL "${ariUrl}" is not a valid URL`);
      }
    }

    // 5. Validate ARI credentials if ARI URL is configured
    const ariUser = process.env.TELEPHONY_QA_ARI_USERNAME;
    const ariPass = process.env.TELEPHONY_QA_ARI_PASSWORD;
    if (ariUrl && (!ariUser || !ariUser.trim())) {
      errors.push('TELEPHONY_QA_ARI_USERNAME is unset or empty while ARI URL is configured');
    }
    if (ariUrl && (!ariPass || !ariPass.trim())) {
      errors.push('TELEPHONY_QA_ARI_PASSWORD is unset or empty while ARI URL is configured');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Determines whether a dialed "to" destination corresponds to the dedicated QA tracking DID.
   * Tracking DID alone does NOT authorize QA; it identifies the call as a Dedicated QA Ingress Candidate.
   */
  public isDedicatedQaIngress(toNumber?: string | null): boolean {
    if (!this.isQaEnabled()) return false;
    return this.isQaIngressDid(toNumber);
  }

  /**
   * Strictly parses and validates a caller identity.
   * SIP URIs are NEVER stripped of non-numeric characters or converted into partial E.164 numbers.
   * Canonical outputs:
   * - E164: canonical E.164 string (e.g. "+17252574041")
   * - SIP_URI: canonical lowercase scheme and host (e.g. "sip:arpitmishra917@sip.telnyx.com")
   * - INVALID: non-conforming or malformed identity
   */
  public parseCallerIdentity(raw?: string | null): ParsedCallerIdentity {
    if (!raw || typeof raw !== 'string') {
      return { type: 'INVALID', raw: raw ?? '', normalized: '' };
    }

    let trimmed = raw.trim();
    if (!trimmed) {
      return { type: 'INVALID', raw: trimmed, normalized: '' };
    }

    // Extract content inside angle brackets if present (e.g. "Bob <sip:bob@domain.com>" or "<+17252574041>")
    const angleMatch = trimmed.match(/<([^>]+)>/);
    if (angleMatch) {
      trimmed = angleMatch[1].trim();
    }

    // Check for SIP URI format: contains '@' or starts with sip: / sips:
    const isSipUri = trimmed.includes('@') || /^(sips?):/i.test(trimmed);

    if (isSipUri) {
      // RFC 3261 compliant SIP URI regex
      const sipRegex = /^(?:(sips?):)?([a-zA-Z0-9_.+~-]+)@([a-zA-Z0-9.-]+)(?::(\d+))?$/i;
      const match = trimmed.match(sipRegex);
      if (!match) {
        return { type: 'INVALID', raw: trimmed, normalized: '' };
      }

      const scheme = (match[1] || 'sip').toLowerCase();
      const user = match[2];
      const host = match[3].toLowerCase();
      const port = match[4];

      // Host must have valid structure (no double dots, no leading/trailing dot)
      if (!host || host.includes('..') || host.startsWith('.') || host.endsWith('.')) {
        return { type: 'INVALID', raw: trimmed, normalized: '' };
      }

      // Port if present must be 1-65535
      if (port) {
        const portNum = parseInt(port, 10);
        if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
          return { type: 'INVALID', raw: trimmed, normalized: '' };
        }
      }

      const normalized = `${scheme}:${user}@${host}${port ? `:${port}` : ''}`;
      return {
        type: 'SIP_URI',
        raw: trimmed,
        normalized,
        user,
        host,
        port,
      };
    }

    // Plain phone number path: strictly validate E.164 via parseAndValidateE164
    const e164 = parseAndValidateE164(trimmed);
    if (e164) {
      return {
        type: 'E164',
        raw: trimmed,
        normalized: e164,
      };
    }

    // If it is neither a valid SIP URI nor a valid E.164 number, it is strictly INVALID.
    // NEVER fall back to stripping non-digits with replace(/\D/g, '')!
    return { type: 'INVALID', raw: trimmed, normalized: '' };
  }

  /**
   * Opens an explicit, short-lived server-side lease for an expected inbound QA test call.
   * Single-use only: once consumed by an incoming call, the lease cannot be reused.
   */
  public openInboundTestLease(options: QaInboundLeaseOptions): QaInboundLease {
    if (!options.runId || typeof options.runId !== 'string' || !options.runId.trim()) {
      throw new Error('Invalid runId: must be a non-empty string');
    }
    const trimmedRunId = options.runId.trim();
    if (!this.activeTestRuns.has(trimmedRunId)) {
      throw new Error(`Cannot open inbound lease: test run "${trimmedRunId}" is not registered`);
    }

    const leaseId = crypto.randomUUID();
    const token = options.secretToken?.trim() || crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    const ttlMs = options.ttlMs ?? 30000; // default 30-second inbound lease window

    let expectedCli = options.expectedCallerCli?.trim();
    let expectedSip = options.expectedCallerSipUri?.trim();

    if (options.expectedCallerIdentity && options.expectedCallerIdentity.trim()) {
      const parsedIdent = this.parseCallerIdentity(options.expectedCallerIdentity);
      if (parsedIdent.type === 'E164') {
        expectedCli = parsedIdent.normalized;
      } else if (parsedIdent.type === 'SIP_URI') {
        expectedSip = parsedIdent.normalized;
      }
    }

    const expectedConn =
      options.expectedConnectionId?.trim() ||
      process.env.TELNYX_QA_CALL_CONTROL_APP_ID?.trim() ||
      undefined;

    const lease: QaInboundLease = {
      leaseId,
      runId: trimmedRunId,
      secretToken: token,
      expectedCallerCli: expectedCli,
      expectedCallerSipUri: expectedSip,
      expectedConnectionId: expectedConn,
      createdAt: now,
      expiresAt: now + ttlMs,
      consumed: false,
    };

    this.activeLeases.set(leaseId, lease);
    this.logger.log(
      `QA inbound lease opened: leaseId ${leaseId} for runId ${trimmedRunId} (connection: ${expectedConn || 'any'}, CLI: ${expectedCli || 'any'}, SIP: ${expectedSip || 'any'}, TTL ${ttlMs}ms)`,
    );
    return lease;
  }

  /**
   * Attempts to consume an active, unconsumed inbound test lease upon CALL_INITIATED on the dedicated QA ingress.
   * On match:
   * - Marks lease as consumed (preventing replay).
   * - Binds providerCallId to runId in the trusted call registry.
   * - Returns { runId } or null if no valid lease matches.
   */
  public consumeInboundLease(
    providerCallId: string,
    context?: QaInboundLeaseContext,
  ): { runId: string } | null {
    if (!providerCallId || typeof providerCallId !== 'string' || !providerCallId.trim()) {
      return null;
    }

    if (!this.isQaEnabled()) {
      return null;
    }

    this.expireStaleBindings();
    const now = Date.now();

    for (const [leaseId, lease] of this.activeLeases.entries()) {
      if (lease.consumed || now > lease.expiresAt) {
        continue;
      }

      // Factor 1: Provider-Verified Connection Identity Check
      const expectedConn =
        lease.expectedConnectionId ||
        process.env.TELNYX_QA_CALL_CONTROL_APP_ID?.trim();
      if (expectedConn) {
        if (!context?.connectionId || !context.connectionId.trim()) {
          this.logger.warn(
            `qa.lease.rejected: missing provider connection_id on call ${providerCallId} (expected "${expectedConn}")`,
          );
          continue; // Missing provider identity -> rejected
        }
        if (!this.secureCompare(context.connectionId.trim(), expectedConn)) {
          this.logger.warn(
            `qa.lease.rejected: untrusted connection_id "${context.connectionId}" on call ${providerCallId} (expected "${expectedConn}")`,
          );
          continue; // Untrusted connection -> rejected
        }
      }

      // Factor 2: Dedicated QA DID Check ("to")
      if (context?.to) {
        const normTo = parseAndValidateE164(context.to);
        const expectedDid = parseAndValidateE164(process.env.TELNYX_QA_TRACKING_DID);
        if (!normTo || !expectedDid || !this.secureCompare(normTo, expectedDid)) {
          this.logger.warn(
            `qa.lease.rejected: destination "${context.to}" does not match QA tracking DID "${process.env.TELNYX_QA_TRACKING_DID}"`,
          );
          continue; // Non-QA DID -> rejected
        }
      }

      // Factor 3: Secret Token Check ("token")
      if (context?.token && lease.secretToken) {
        if (!this.secureCompare(context.token.trim(), lease.secretToken)) {
          this.logger.warn(`qa.lease.rejected: secret token mismatch on call ${providerCallId}`);
          continue; // Token mismatch -> rejected
        }
      }

      // Factor 4: Caller Identity Validation ("from")
      if (lease.expectedCallerCli || lease.expectedCallerSipUri) {
        if (!context?.from || !context.from.trim()) {
          this.logger.warn(`qa.lease.rejected: missing caller identity on call ${providerCallId}`);
          continue;
        }

        const parsedCaller = this.parseCallerIdentity(context.from);
        if (parsedCaller.type === 'INVALID') {
          this.logger.warn(
            `qa.lease.rejected: malformed or ambiguous caller identity "${context.from}" on call ${providerCallId}`,
          );
          continue;
        }

        let identityMatched = false;

        // Path A: Caller presented canonical E.164 number
        if (parsedCaller.type === 'E164') {
          if (lease.expectedCallerCli) {
            const expectedE164 = parseAndValidateE164(lease.expectedCallerCli);
            if (expectedE164 && this.secureCompare(parsedCaller.normalized, expectedE164)) {
              identityMatched = true;
            }
          }
        }

        // Path B: Caller presented SIP URI
        if (parsedCaller.type === 'SIP_URI') {
          // Check against expectedCallerSipUri
          if (lease.expectedCallerSipUri) {
            const expectedSip = this.parseCallerIdentity(lease.expectedCallerSipUri);
            if (expectedSip.type === 'SIP_URI') {
              if (this.secureCompare(parsedCaller.normalized, expectedSip.normalized)) {
                identityMatched = true;
              } else if (
                expectedSip.user &&
                this.secureCompare(parsedCaller.user, expectedSip.user) &&
                (!expectedSip.host || this.secureCompare(parsedCaller.host, expectedSip.host))
              ) {
                identityMatched = true;
              } else if (
                expectedSip.user &&
                parsedCaller.user &&
                expectedSip.user.length >= 10 &&
                parsedCaller.user.length >= 10 &&
                (parsedCaller.user.startsWith(expectedSip.user) || expectedSip.user.startsWith(parsedCaller.user)) &&
                (!expectedSip.host || this.secureCompare(parsedCaller.host, expectedSip.host))
              ) {
                identityMatched = true;
              }
            } else if (this.secureCompare(parsedCaller.user, lease.expectedCallerSipUri.trim())) {
              identityMatched = true;
            }
          }

          // Check against expectedCallerCli if expectedCallerCli was specified as a SIP URI or user
          if (!identityMatched && lease.expectedCallerCli) {
            const expectedCliAsSip = this.parseCallerIdentity(lease.expectedCallerCli);
            if (expectedCliAsSip.type === 'SIP_URI') {
              if (this.secureCompare(parsedCaller.normalized, expectedCliAsSip.normalized)) {
                identityMatched = true;
              } else if (
                expectedCliAsSip.user &&
                this.secureCompare(parsedCaller.user, expectedCliAsSip.user)
              ) {
                identityMatched = true;
              }
            } else if (this.secureCompare(parsedCaller.user, lease.expectedCallerCli.trim())) {
              identityMatched = true;
            }
          }
        }

        if (!identityMatched) {
          this.logger.warn(
            `qa.lease.rejected: caller identity "${context.from}" (type: ${parsedCaller.type}, normalized: ${parsedCaller.normalized}) does not match lease expectations [CLI: ${lease.expectedCallerCli || 'none'}, SIP: ${lease.expectedCallerSipUri || 'none'}] on call ${providerCallId}`,
          );
          continue;
        }
      }

      // Valid lease found! Consume it atomically (single-use)
      lease.consumed = true;
      this.activeLeases.delete(leaseId); // Delete to guarantee single-use and replay protection

      // Bind provider call ID to test run in trusted registry
      this.bindCallToTestRun(providerCallId.trim(), lease.runId);
      this.logger.log(
        `QA inbound lease ${leaseId} consumed by call ${providerCallId} -> bound to run ${lease.runId}`,
      );
      return { runId: lease.runId };
    }

    return null; // No valid active lease matched
  }

  /**
   * Timing-safe string comparison to prevent timing attacks on tokens.
   */
  private secureCompare(a?: string, b?: string): boolean {
    if (!a || !b) return false;
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  }

  /**
   * Registers a trusted active QA test run ID in the server-side registry.
   * Rejects empty or whitespace run IDs.
   * Default test run maximum lifetime: 10 minutes (600,000ms).
   */
  public registerActiveTestRun(
    runId: string,
    options?: { secretToken?: string; ttlMs?: number },
  ): void {
    if (!runId || typeof runId !== 'string' || !runId.trim()) {
      throw new Error('Invalid runId: must be a non-empty string');
    }
    const trimmedRunId = runId.trim();
    const now = Date.now();
    const ttlMs = options?.ttlMs ?? 600000; // default 10 minutes
    this.activeTestRuns.set(trimmedRunId, {
      runId: trimmedRunId,
      secretToken: options?.secretToken?.trim(),
      registeredAt: now,
      expiresAt: now + ttlMs,
    });
  }

  /**
   * Unregisters an active QA test run ID when testing concludes.
   */
  public unregisterActiveTestRun(runId: string): void {
    if (runId && typeof runId === 'string') {
      this.activeTestRuns.delete(runId.trim());
    }
  }

  /**
   * Binds an incoming or active Call ID to a registered, active test run.
   * Fails closed if runId is not registered or is expired.
   * Fails closed if callId is empty or invalid.
   */
  public bindCallToTestRun(callId: string, runId: string, ttlMs?: number): void {
    if (!callId || typeof callId !== 'string' || !callId.trim()) {
      throw new Error('Invalid callId: must be a non-empty string');
    }
    if (!runId || typeof runId !== 'string' || !runId.trim()) {
      throw new Error('Invalid runId: must be a non-empty string');
    }
    const trimmedCallId = callId.trim();
    const trimmedRunId = runId.trim();

    this.expireStaleBindings();

    const testRun = this.activeTestRuns.get(trimmedRunId);
    if (!testRun) {
      throw new Error(`Cannot bind call: test run "${trimmedRunId}" is not registered`);
    }
    if (Date.now() > testRun.expiresAt) {
      this.activeTestRuns.delete(trimmedRunId);
      throw new Error(`Cannot bind call: test run "${trimmedRunId}" has expired`);
    }

    const now = Date.now();
    const bindingTtl = ttlMs ?? 600000; // default 10 minutes
    this.boundCalls.set(trimmedCallId, {
      callId: trimmedCallId,
      runId: trimmedRunId,
      boundAt: now,
      expiresAt: now + bindingTtl,
      state: 'BOUND',
    });
    this.logger.log(`QA call bound: callId ${trimmedCallId} -> runId ${trimmedRunId}`);
  }

  /**
   * Binds a call via a single-use secret token passed from the local test harness / SIP header.
   * If a matching unconsumed token is found, binds callId and consumes the token (single-use).
   * Returns true on successful binding, false on invalid/expired token.
   */
  public bindCallViaToken(callId: string, token: string): boolean {
    if (!callId || !token) return false;
    const trimmedCallId = callId.trim();
    const trimmedToken = token.trim();
    if (!trimmedCallId || !trimmedToken) return false;

    this.expireStaleBindings();

    for (const [runId, testRun] of this.activeTestRuns.entries()) {
      if (testRun.secretToken && this.secureCompare(testRun.secretToken, trimmedToken)) {
        // Token matched! Consume token to prevent replay
        testRun.secretToken = undefined;
        this.bindCallToTestRun(trimmedCallId, runId);
        return true;
      }
    }
    return false;
  }

  /**
   * Checks whether a call ID is currently bound as an active QA call.
   */
  public isCallBound(callId?: string | null): boolean {
    if (!callId || typeof callId !== 'string') return false;
    const binding = this.boundCalls.get(callId.trim());
    if (!binding) return false;
    if (binding.state !== 'BOUND' || Date.now() > binding.expiresAt) {
      return false;
    }
    return true;
  }

  /**
   * Retrieves the runId bound to a specific call ID, if active and not expired.
   */
  public getBoundTestRun(callId?: string | null): string | null {
    if (!callId || typeof callId !== 'string') return null;
    const binding = this.boundCalls.get(callId.trim());
    if (!binding || binding.state !== 'BOUND' || Date.now() > binding.expiresAt) {
      return null;
    }
    return binding.runId;
  }

  /**
   * Checks whether a specific call ID is bound to a specific expected runId.
   */
  public isCallBoundToRun(callId?: string | null, runId?: string | null): boolean {
    if (!callId || !runId) return false;
    const bound = this.getBoundTestRun(callId);
    return bound !== null && bound === runId.trim();
  }

  /**
   * Releases a call binding upon call termination.
   */
  public releaseCallBinding(callId: string): void {
    if (!callId || typeof callId !== 'string') return;
    const trimmed = callId.trim();
    const binding = this.boundCalls.get(trimmed);
    if (binding) {
      binding.state = 'RELEASED';
      this.boundCalls.delete(trimmed);
      this.logger.log(`QA call binding released: callId ${trimmed}`);
    }
  }

  /**
   * Removes expired test runs, call bindings, and leases.
   */
  public expireStaleBindings(): void {
    const now = Date.now();
    for (const [runId, run] of this.activeTestRuns.entries()) {
      if (now > run.expiresAt) {
        this.activeTestRuns.delete(runId);
      }
    }
    for (const [callId, binding] of this.boundCalls.entries()) {
      if (now > binding.expiresAt || binding.state === 'RELEASED') {
        this.boundCalls.delete(callId);
      }
    }
    for (const [leaseId, lease] of this.activeLeases.entries()) {
      if (now > lease.expiresAt || lease.consumed) {
        this.activeLeases.delete(leaseId);
      }
    }
  }

  /**
   * Clears all registered active test runs, call bindings, and leases (used between test suites).
   */
  public clearActiveTestRuns(): void {
    this.activeTestRuns.clear();
    this.boundCalls.clear();
    this.activeLeases.clear();
  }

  /**
   * Validates whether a given qa_test_run_id is trusted.
   * Matches either in-memory registered runs or process.env.TELEPHONY_QA_ACTIVE_TEST_RUN_ID.
   */
  public isTrustedQaTestRun(testRunId?: string | null): boolean {
    if (!testRunId || typeof testRunId !== 'string') return false;
    const trimmed = testRunId.trim();
    if (!trimmed) return false;

    this.expireStaleBindings();

    const testRun = this.activeTestRuns.get(trimmed);
    if (testRun && Date.now() <= testRun.expiresAt) {
      return true;
    }

    const envActiveRun = process.env.TELEPHONY_QA_ACTIVE_TEST_RUN_ID;
    if (envActiveRun && envActiveRun.trim() === trimmed) {
      return true;
    }

    return false;
  }

  /**
   * QA mode is enabled only when TELEPHONY_QA_ENABLED === "true".
   */
  public isQaEnabled(): boolean {
    return process.env.TELEPHONY_QA_ENABLED === 'true';
  }

  /**
   * Classifies whether a call originates from a dedicated, trusted QA test-run context.
   * If a call cannot be confirmed as a trusted QA test, it is treated as production by default.
   *
   * Security Boundaries:
   * 1. A raw Prisma Call entity is recognized as QA only when its call ID has a valid server-side binding.
   * 2. Caller CLI and tracking DID alone NEVER classify a call as QA.
   * 3. Caller-supplied "is_qa", "qa_test_run_id", or arbitrary metadata NEVER independently activate QA mode.
   * 4. Unregistered, expired, or released call IDs fail closed as production.
   */
  public isQaCall(callContext?: any): boolean {
    if (!callContext) return false;
    if (!this.isQaEnabled()) return false;

    // 1. Internal server-side explicit test override flag (never settable by webhooks or external metadata)
    if (callContext._trustedServerQaFlag === true) {
      return true;
    }

    // 2. Verified Call ID binding in the server-side registry
    const callId = callContext.id || callContext.callId;
    if (callId && typeof callId === 'string') {
      const trimmed = callId.trim();
      const binding = this.boundCalls.get(trimmed);
      if (binding) {
        if (binding.state !== 'BOUND') return false;
        if (Date.now() > binding.expiresAt) {
          this.boundCalls.delete(trimmed);
          return false;
        }
        // Verify associated test run is still active
        const testRun = this.activeTestRuns.get(binding.runId);
        if (!testRun || Date.now() > testRun.expiresAt) {
          this.boundCalls.delete(trimmed);
          return false;
        }
        return true;
      }
    }

    // Caller-supplied fields (is_qa, metadata.qa_test_run_id, etc.) without server binding are strictly rejected
    return false;
  }

  /**
   * Parses and validates TELEPHONY_QA_ALLOWED_DESTINATIONS.
   * Fails closed if empty, malformed, or if any single entry is invalid E.164.
   * Normalizes duplicates cleanly.
   */
  public parseAllowlist(): AllowlistParseResult {
    const raw = process.env.TELEPHONY_QA_ALLOWED_DESTINATIONS;
    if (!raw || !raw.trim()) {
      return {
        valid: false,
        allowedSet: new Set(),
        error: 'TELEPHONY_QA_ALLOWED_DESTINATIONS is unset or empty',
      };
    }

    const tokens = raw
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    if (tokens.length === 0) {
      return {
        valid: false,
        allowedSet: new Set(),
        error: 'TELEPHONY_QA_ALLOWED_DESTINATIONS contains no valid entries',
      };
    }

    const allowedSet = new Set<string>();
    for (const token of tokens) {
      const normalized = parseAndValidateE164(token);
      if (!normalized) {
        return {
          valid: false,
          allowedSet: new Set(),
          error: `Malformed entry in TELEPHONY_QA_ALLOWED_DESTINATIONS: "${token}" is not valid E.164`,
        };
      }
      allowedSet.add(normalized);
    }

    return { valid: true, allowedSet };
  }

  /**
   * Enforces QA destination allowlist immediately before dialing an outbound buyer leg.
   * Throws TelephonyProviderError(TelephonyErrorType.ROUTING_FAILED) if blocked.
   */
  public validateDestinationOrThrow(destination: string, callContext?: any): void {
    // 1. Bypass if QA mode is disabled
    if (!this.isQaEnabled()) {
      return;
    }

    // 2. Bypass if call is not classified as QA
    if (!this.isQaCall(callContext)) {
      return;
    }

    // 3. Fail closed if allowlist is empty or malformed
    const allowlistResult = this.parseAllowlist();
    if (!allowlistResult.valid) {
      this.logger.error(`QA telephony guard failed closed: ${allowlistResult.error}`);
      throw new TelephonyProviderError(
        TelephonyErrorType.ROUTING_FAILED,
        `QA guard blocked outbound call: ${allowlistResult.error}`,
      );
    }

    // 4. Validate destination candidate format
    const normalizedCandidate = parseAndValidateE164(destination);
    if (!normalizedCandidate) {
      this.logger.warn(`QA telephony guard rejected invalid destination candidate: "${destination}"`);
      throw new TelephonyProviderError(
        TelephonyErrorType.ROUTING_FAILED,
        `QA guard rejected outbound call: destination "${destination}" is not a valid E.164 number`,
      );
    }

    // 5. Validate destination candidate is in allowed set
    if (!allowlistResult.allowedSet.has(normalizedCandidate)) {
      this.logger.warn(
        `QA telephony guard denied destination: ${normalizedCandidate} (not in allowed destinations: [${Array.from(allowlistResult.allowedSet).join(', ')}])`,
      );
      throw new TelephonyProviderError(
        TelephonyErrorType.ROUTING_FAILED,
        `QA guard rejected outbound call: destination ${normalizedCandidate} is not authorized for QA`,
      );
    }

    this.logger.log(
      `QA telephony guard authorized outbound call to destination: ${normalizedCandidate}`,
    );
  }
}
