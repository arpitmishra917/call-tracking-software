import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { WalletService } from './wallet.service.js';
import { TelephonyPricingConfig } from './telephony-pricing.config.js';

/**
 * Backward-compatible PRICING accessor dynamically delegating to TelephonyPricingConfig.
 * Eliminates competing hardcoded rates while preserving legacy interface compatibility.
 */
export const PRICING = {
  get LOCAL_INBOUND_MICRO_PER_MIN(): bigint {
    return new TelephonyPricingConfig().localInboundRateMicro;
  },
  get TOLL_FREE_INBOUND_MICRO_PER_MIN(): bigint {
    return new TelephonyPricingConfig().tollFreeRateMicro;
  },
  get RECORDING_MICRO_PER_MIN(): bigint {
    return new TelephonyPricingConfig().recordingStorageRateMicro;
  },
};

@Injectable()
export class UsageBillingService {
  private readonly logger = new Logger(UsageBillingService.name);
  private readonly pricingConfig: TelephonyPricingConfig;

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    @Optional()
    pricingConfig?: TelephonyPricingConfig,
  ) {
    this.pricingConfig = pricingConfig ?? new TelephonyPricingConfig();
  }

  /**
   * Retrieves the current pricing configuration.
   */
  getPricingConfig(): TelephonyPricingConfig {
    return this.pricingConfig;
  }

  /**
   * Evaluates the billable duration using exact ceiling arithmetic.
   */
  calculateBillableMinutes(durationSeconds: number): bigint {
    if (!durationSeconds || durationSeconds <= 0 || isNaN(durationSeconds)) {
      return 0n;
    }
    return BigInt(Math.ceil(durationSeconds / 60));
  }

  /**
   * Calculates initial reservation amount for pre-call authorization.
   * Uses configured rates: (ratePerMin + recordingRate) * 10 minute block.
   */
  calculateInitialReservation(numberType: string | null | undefined): bigint {
    const ratePerMin = this.pricingConfig.getRateForNumberType(numberType);
    const recordingRate = this.pricingConfig.recordingStorageRateMicro;
    return (ratePerMin + recordingRate) * 10n; // 10 minute block
  }

  /**
   * Attempts to bill a connected Call usage.
   */
  async billCallUsage(
    workspaceId: string,
    callId: string,
    numberType: string | null | undefined,
    talkDurationSeconds: number,
  ) {
    // Durable QA isolation: Never settle or debit calls in QA workspace
    const qaWorkspaceId = process.env.QA_WORKSPACE_ID;
    if (qaWorkspaceId && workspaceId.trim().toLowerCase() === qaWorkspaceId.trim().toLowerCase()) {
      try {
        await this.walletService.releaseReservation(workspaceId, callId);
        return { billed: false, reason: 'QA workspace call, reservation released without debit' };
      } catch (e: any) {
        this.logger.warn(`Failed to release reservation for QA call ${callId}: ${e.message}`);
        return { billed: false, reason: e.message };
      }
    }

    if (!talkDurationSeconds || talkDurationSeconds <= 0 || isNaN(talkDurationSeconds)) {
      try {
        await this.walletService.releaseReservation(workspaceId, callId);
        return { billed: false, reason: 'Zero talk duration, reservation released' };
      } catch (e: any) {
        this.logger.error(`Failed to release reservation ${callId}: ${e.message}`);
        return { billed: false, reason: e.message };
      }
    }

    if (numberType !== 'local' && numberType !== 'toll_free') {
      this.logger.warn(`Call ${callId} lacks billable number_type (${numberType})`);
    }

    const ratePerMin = this.pricingConfig.getRateForNumberType(numberType);
    const billableMinutes = this.calculateBillableMinutes(talkDurationSeconds);
    const costMicro = billableMinutes * ratePerMin;

    if (costMicro <= 0n) {
      try {
        await this.walletService.releaseReservation(workspaceId, callId);
        return { billed: false, reason: 'Zero computed cost, reservation released' };
      } catch (e: any) {
        return { billed: false, reason: e.message };
      }
    }

    try {
      await this.walletService.settleReservation(workspaceId, callId, costMicro);
      return { billed: true, costMicro };
    } catch (e: any) {
      this.logger.error(`Failed to settle call ${callId}: ${e.message}`);
      return { billed: false, reason: e.message };
    }
  }

  /**
   * Attempts to bill Recording storage usage.
   */
  async billRecordingUsage(
    workspaceId: string,
    recordingId: string,
    durationSeconds: number,
  ) {
    if (!durationSeconds || durationSeconds <= 0 || isNaN(durationSeconds)) {
      return { billed: false, reason: 'Missing duration' };
    }

    const billableMinutes = this.calculateBillableMinutes(durationSeconds);
    const costMicro = billableMinutes * this.pricingConfig.recordingStorageRateMicro;

    if (costMicro <= 0n) {
      return { billed: false, reason: 'Zero computed cost' };
    }

    const idempotencyKey = `recording:${recordingId}:usage`;

    try {
      await this.walletService.debitWallet({
        workspaceId,
        amountMicro: costMicro,
        referenceType: 'RECORDING_STORAGE',
        referenceId: recordingId,
        idempotencyKey,
        description: `Recording usage: ${billableMinutes} min`,
      });
      return { billed: true, costMicro };
    } catch (e: any) {
      this.logger.error(`Failed to bill recording ${recordingId}: ${e.message}`);
      return { billed: false, reason: e.message };
    }
  }
}
