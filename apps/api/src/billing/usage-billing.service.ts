import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { WalletService } from './wallet.service.js';
import { UsageType } from '@prisma/client';

export const PRICING = {
  LOCAL_INBOUND_MICRO_PER_MIN: 45000n, // $0.045
  TOLL_FREE_INBOUND_MICRO_PER_MIN: 55000n, // $0.055
  RECORDING_MICRO_PER_MIN: 2500n, // $0.0025
};

@Injectable()
export class UsageBillingService {
  private readonly logger = new Logger(UsageBillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
  ) {}

  /**
   * Evaluates the billable duration using exact ceiling arithmetic.
   */
  calculateBillableMinutes(durationSeconds: number): bigint {
    if (durationSeconds <= 0) return 0n;
    return BigInt(Math.ceil(durationSeconds / 60));
  }

  /**
   * Attempts to bill a connected Call.
   */
  calculateInitialReservation(numberType: string | null | undefined): bigint {
    let ratePerMin: bigint;
    if (numberType === 'local') {
      ratePerMin = PRICING.LOCAL_INBOUND_MICRO_PER_MIN;
    } else if (numberType === 'toll_free') {
      ratePerMin = PRICING.TOLL_FREE_INBOUND_MICRO_PER_MIN;
    } else {
      ratePerMin = PRICING.LOCAL_INBOUND_MICRO_PER_MIN;
    }
    const recordingRate = PRICING.RECORDING_MICRO_PER_MIN;
    return (ratePerMin + recordingRate) * 10n; // 10 minute block
  }

  async billCallUsage(
    workspaceId: string, 
    callId: string, 
    numberType: string | null | undefined, 
    talkDurationSeconds: number
  ) {
    if (talkDurationSeconds <= 0) {
      try {
        await this.walletService.releaseReservation(workspaceId, callId);
        return { billed: false, reason: 'Zero talk duration, reservation released' };
      } catch (e: any) {
         this.logger.error(`Failed to release reservation ${callId}: ${e.message}`);
         return { billed: false, reason: e.message };
      }
    }

    let ratePerMin: bigint;
    if (numberType === 'local') {
      ratePerMin = PRICING.LOCAL_INBOUND_MICRO_PER_MIN;
    } else if (numberType === 'toll_free') {
      ratePerMin = PRICING.TOLL_FREE_INBOUND_MICRO_PER_MIN;
    } else {
      this.logger.warn(`Call ${callId} lacks billable number_type (${numberType})`);
      ratePerMin = PRICING.LOCAL_INBOUND_MICRO_PER_MIN;
    }

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
   * Attempts to bill Recording storage.
   */
  async billRecordingUsage(
    workspaceId: string,
    recordingId: string,
    durationSeconds: number
  ) {
    if (durationSeconds <= 0) {
      return { billed: false, reason: 'Missing duration' };
    }

    const billableMinutes = this.calculateBillableMinutes(durationSeconds);
    const costMicro = billableMinutes * PRICING.RECORDING_MICRO_PER_MIN;

    if (costMicro <= 0n) {
      return { billed: false, reason: 'Zero computed cost' };
    }

    const idempotencyKey = `recording:\${recordingId}:usage`;

    try {
      await this.walletService.debitWallet({
        workspaceId,
        amountMicro: costMicro,
        referenceType: 'RECORDING_STORAGE',
        referenceId: recordingId,
        idempotencyKey,
        description: `Recording usage: \${billableMinutes} min`
      });
      return { billed: true, costMicro };
    } catch (e: any) {
      this.logger.error(`Failed to bill recording \${recordingId}: \${e.message}`);
      return { billed: false, reason: e.message };
    }
  }
}
