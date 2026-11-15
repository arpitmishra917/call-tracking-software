import { Injectable, Logger, Optional } from '@nestjs/common';
import { QaTelephonyGuardService } from './qa-telephony-guard.service.js';
import { TelephonyProviderError, TelephonyErrorType } from '../telephony.errors.js';

export interface SipUriValidationResult {
  valid: boolean;
  uri?: string;
  error?: string;
}

export type LogicalQaBuyerRole = 'A' | 'B';

@Injectable()
export class QaSipUriAdapterService {
  private readonly logger = new Logger(QaSipUriAdapterService.name);
  private static readonly ALLOWED_SIP_DOMAINS = new Set(['sip.telnyx.com']);

  // Dedicated Logical QA Buyer Phone Numbers (NANPA reserved test numbers)
  public static readonly LOGICAL_QA_BUYER_A_CLI = '+12025550199';
  public static readonly LOGICAL_QA_BUYER_B_CLI = '+12025550198';
  public static readonly LOGICAL_QA_BUYER_CLI = '+12025550199'; // Backward-compatible alias for Buyer A

  // Seeded / Dedicated QA Buyer Fixture UUIDs
  public static readonly LOGICAL_QA_BUYER_A_ID = '7deb4e0a-8674-4b4b-a170-0aff3991f69c';
  public static readonly LOGICAL_QA_BUYER_B_ID = 'b0000000-0000-0000-0000-000000000002';

  constructor(
    @Optional()
    private readonly qaGuardService?: QaTelephonyGuardService,
  ) {}

  /**
   * Checks whether a destination matches the dedicated logical QA Buyer A (+12025550199 or Buyer A UUID).
   */
  public isLogicalQaBuyerA(destination?: string | null): boolean {
    if (!destination || typeof destination !== 'string') return false;
    const trimmed = destination.trim();
    if (trimmed.toLowerCase() === QaSipUriAdapterService.LOGICAL_QA_BUYER_A_ID.toLowerCase()) return true;
    const norm = trimmed.replace(/\D/g, '');
    const logicalNorm = QaSipUriAdapterService.LOGICAL_QA_BUYER_A_CLI.replace(/\D/g, '');
    return norm === logicalNorm || (norm.length === 10 && `1${norm}` === logicalNorm);
  }

  /**
   * Checks whether a destination matches the dedicated logical QA Buyer B (+12025550198 or Buyer B UUID).
   */
  public isLogicalQaBuyerB(destination?: string | null): boolean {
    if (!destination || typeof destination !== 'string') return false;
    const trimmed = destination.trim();
    if (trimmed.toLowerCase() === QaSipUriAdapterService.LOGICAL_QA_BUYER_B_ID.toLowerCase()) return true;
    const norm = trimmed.replace(/\D/g, '');
    const logicalNorm = QaSipUriAdapterService.LOGICAL_QA_BUYER_B_CLI.replace(/\D/g, '');
    return norm === logicalNorm || (norm.length === 10 && `1${norm}` === logicalNorm);
  }

  /**
   * Checks whether a destination matches any dedicated logical QA buyer (Buyer A or Buyer B).
   */
  public isLogicalQaBuyer(destination?: string | null): boolean {
    return this.isLogicalQaBuyerA(destination) || this.isLogicalQaBuyerB(destination);
  }

  /**
   * QA mode is enabled only when TELEPHONY_QA_ENABLED === "true".
   */
  public isQaEnabled(): boolean {
    return process.env.TELEPHONY_QA_ENABLED === 'true';
  }

  /**
   * Resolves the configured QA Buyer A SIP URI from environment.
   * Checks TELEPHONY_QA_BUYER_A_SIP_URI, falling back to TELEPHONY_QA_BUYER_SIP_URI.
   */
  public getConfiguredBuyerASipUri(): string | null {
    const raw = process.env.TELEPHONY_QA_BUYER_A_SIP_URI || process.env.TELEPHONY_QA_BUYER_SIP_URI;
    if (!raw || !raw.trim()) {
      return null;
    }
    return raw.trim();
  }

  /**
   * Resolves the configured QA Buyer B SIP URI from environment.
   * Strictly reads TELEPHONY_QA_BUYER_B_SIP_URI. Never falls back to Buyer A or generic URI.
   */
  public getConfiguredBuyerBSipUri(): string | null {
    const raw = process.env.TELEPHONY_QA_BUYER_B_SIP_URI;
    if (!raw || !raw.trim()) {
      return null;
    }
    return raw.trim();
  }

  /**
   * Backward-compatible alias resolving Buyer A SIP URI.
   */
  public getConfiguredBuyerSipUri(): string | null {
    return this.getConfiguredBuyerASipUri();
  }

  /**
   * Identifies the logical buyer role ('A' or 'B') from destination number or call context.
   */
  public getLogicalBuyerRole(destination?: string | null, callContext?: any): LogicalQaBuyerRole | null {
    if (this.isLogicalQaBuyerA(destination)) return 'A';
    if (this.isLogicalQaBuyerB(destination)) return 'B';

    if (callContext) {
      const buyerId = callContext.buyer_id || callContext.buyerId || callContext.buyer?.id;
      if (typeof buyerId === 'string') {
        const trimmedId = buyerId.trim().toLowerCase();
        if (trimmedId === QaSipUriAdapterService.LOGICAL_QA_BUYER_A_ID.toLowerCase()) return 'A';
        if (trimmedId === QaSipUriAdapterService.LOGICAL_QA_BUYER_B_ID.toLowerCase()) return 'B';
      }

      const buyerDest = callContext.buyer?.destination_number;
      if (this.isLogicalQaBuyerA(buyerDest)) return 'A';
      if (this.isLogicalQaBuyerB(buyerDest)) return 'B';

      const explicitRole = callContext.buyerRole || callContext.buyerLogicalKey;
      if (explicitRole === 'A' || explicitRole === 'BUYER_A') return 'A';
      if (explicitRole === 'B' || explicitRole === 'BUYER_B') return 'B';
    }

    return null;
  }

  /**
   * Validates a SIP URI format, scheme, and domain.
   * Only authorized Telnyx SIP domains (sip.telnyx.com) are permitted.
   * External SIP domains, arbitrary hosts, and malformed URIs are rejected.
   */
  public validateSipUri(uri: string): SipUriValidationResult {
    if (!uri || typeof uri !== 'string') {
      return { valid: false, error: 'SIP URI is empty or not a string' };
    }

    const trimmed = uri.trim();
    const sipRegex = /^(sips?):([a-zA-Z0-9_.+-]+)@([a-zA-Z0-9.-]+)(:\d+)?$/i;
    const match = trimmed.match(sipRegex);

    if (!match) {
      return { valid: false, error: `Malformed SIP URI format: "${trimmed}"` };
    }

    const [, scheme, user, host] = match;
    const normalizedHost = host.toLowerCase();

    if (!QaSipUriAdapterService.ALLOWED_SIP_DOMAINS.has(normalizedHost)) {
      return {
        valid: false,
        error: `Unauthorized SIP domain "${normalizedHost}". Only authorized domains [${Array.from(QaSipUriAdapterService.ALLOWED_SIP_DOMAINS).join(', ')}] are permitted.`,
      };
    }

    if (!user || user.length < 2) {
      return { valid: false, error: `Invalid SIP user in URI: "${user}"` };
    }

    const port = match[4] || '';
    const normalizedUri = `${scheme.toLowerCase()}:${user}@${normalizedHost}${port}`;
    return { valid: true, uri: normalizedUri };
  }

  /**
   * Resolves the buyer destination for dialing.
   *
   * Rules:
   * 1. If destination matches any logical QA buyer (+12025550199 or +12025550198) and context is NOT verified QA:
   *    FAILS CLOSED immediately with TelephonyProviderError. Never dials PSTN.
   * 2. If QA mode is disabled -> returns originalDestination (production E.164).
   * 3. If call is not in trusted QA context -> returns originalDestination (production E.164).
   * 4. If in trusted QA context:
   *    a. Validates originalDestination against QA allowlist first.
   *    b. Identifies logical buyer (Buyer A vs Buyer B). Rejects unknown buyers fail-closed.
   *    c. Resolves Buyer A to TELEPHONY_QA_BUYER_A_SIP_URI (or TELEPHONY_QA_BUYER_SIP_URI).
   *    d. Resolves Buyer B strictly to TELEPHONY_QA_BUYER_B_SIP_URI. Never falls back to Buyer A.
   *    e. If SIP URI is missing, malformed, or has unauthorized domain -> FAILS CLOSED with TelephonyProviderError.
   *       NEVER falls back silently to dialing live buyer PSTN.
   */
  public resolveBuyerDestination(originalDestination: string, callContext?: any): string {
    const isLogicalBuyer = this.isLogicalQaBuyer(originalDestination);

    // 1. Bypass if QA mode is disabled (Rule 2)
    if (!this.isQaEnabled()) {
      if (isLogicalBuyer) {
        this.logger.error(`Blocked attempt to dial logical QA buyer ${originalDestination} while QA is disabled`);
        throw new TelephonyProviderError(
          TelephonyErrorType.ROUTING_FAILED,
          `Logical QA buyer destination ${originalDestination} cannot be dialed outside verified QA test context`,
        );
      }
      return originalDestination;
    }

    // 2. Bypass if call does not originate from an explicit, trusted QA context (Rule 1 & 2)
    const isQa = this.qaGuardService ? this.qaGuardService.isQaCall(callContext) : false;
    if (!isQa) {
      if (isLogicalBuyer) {
        this.logger.error(`Blocked attempt to dial logical QA buyer ${originalDestination} in non-QA context`);
        throw new TelephonyProviderError(
          TelephonyErrorType.ROUTING_FAILED,
          `Logical QA buyer destination ${originalDestination} cannot be dialed outside verified QA test context`,
        );
      }
      return originalDestination;
    }

    // 3. In trusted QA context:
    // First, validate that the original buyer destination was authorized by QA allowlist (Rule 7)
    if (this.qaGuardService) {
      this.qaGuardService.validateDestinationOrThrow(originalDestination, callContext);
    }

    // Second, identify the logical buyer role (Buyer A vs Buyer B). Rejects unknown buyers fail-closed.
    const buyerRole = this.getLogicalBuyerRole(originalDestination, callContext);
    if (!buyerRole) {
      this.logger.error(`QA SIP URI adapter rejected unknown buyer destination: "${originalDestination}"`);
      throw new TelephonyProviderError(
        TelephonyErrorType.ROUTING_FAILED,
        `QA SIP URI adapter rejected unknown buyer destination "${originalDestination}". Only authorized QA buyers (Buyer A: ${QaSipUriAdapterService.LOGICAL_QA_BUYER_A_CLI}, Buyer B: ${QaSipUriAdapterService.LOGICAL_QA_BUYER_B_CLI}) are mapped for SIP routing`,
      );
    }

    // Third, resolve configured QA buyer SIP URI based on identified buyer
    let configuredUri: string | null = null;
    if (buyerRole === 'A') {
      configuredUri = this.getConfiguredBuyerASipUri();
      if (!configuredUri) {
        this.logger.error('QA SIP URI adapter failed: TELEPHONY_QA_BUYER_A_SIP_URI (or TELEPHONY_QA_BUYER_SIP_URI) is not configured');
        throw new TelephonyProviderError(
          TelephonyErrorType.ROUTING_FAILED,
          'QA SIP URI adapter failed closed: TELEPHONY_QA_BUYER_A_SIP_URI (or TELEPHONY_QA_BUYER_SIP_URI) is not configured',
        );
      }
    } else if (buyerRole === 'B') {
      configuredUri = this.getConfiguredBuyerBSipUri();
      if (!configuredUri) {
        this.logger.error('QA SIP URI adapter failed: TELEPHONY_QA_BUYER_B_SIP_URI is not configured');
        throw new TelephonyProviderError(
          TelephonyErrorType.ROUTING_FAILED,
          'QA SIP URI adapter failed closed: TELEPHONY_QA_BUYER_B_SIP_URI is not configured',
        );
      }
    }

    // Fourth, validate SIP URI format and domain restrictions (Rule 8 & 9)
    const validation = this.validateSipUri(configuredUri!);
    if (!validation.valid || !validation.uri) {
      this.logger.error(`QA SIP URI adapter rejected configured URI for Buyer ${buyerRole}: ${validation.error}`);
      throw new TelephonyProviderError(
        TelephonyErrorType.ROUTING_FAILED,
        `QA SIP URI adapter rejected: ${validation.error}`,
      );
    }

    this.logger.log(
      `QA SIP URI adapter resolved Buyer ${buyerRole} destination: ${originalDestination} -> ${validation.uri}`,
    );

    return validation.uri;
  }
}
