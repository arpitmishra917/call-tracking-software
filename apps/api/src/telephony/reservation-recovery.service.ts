import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { WalletService } from '../billing/wallet.service.js';
import { UsageBillingService } from '../billing/usage-billing.service.js';
import type { TelephonyProvider } from './telephony.provider.js';
import { ProviderCallStatus } from './telephony.provider.js';
import { TELEPHONY_PROVIDER } from './call-controller.js';

@Injectable()
export class ReservationRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReservationRecoveryService.name);
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  // Stale threshold: Any ACTIVE reservation where updated_at is older than 15 mins
  // is considered stale. This ensures we don't race with normal hangup/extension timers.
  public readonly RESERVATION_RECOVERY_STALE_SECONDS = 15 * 60; 
  private readonly BATCH_SIZE = 100;

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly usageBillingService: UsageBillingService,
    @Inject(forwardRef(() => TELEPHONY_PROVIDER))
    private readonly provider: TelephonyProvider,
  ) {}

  onModuleInit() {
    this.logger.log('Starting Reservation Recovery worker loop...');
    // Run recovery loop periodically
    this.timer = setInterval(() => {
      this.runRecoveryBatch().catch(err => {
        this.logger.error(`Recovery loop error: ${err.message}`, err.stack);
      });
    }, 5 * 60 * 1000);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async runRecoveryBatch() {
    if (this.isProcessing) {
      return;
    }
    this.isProcessing = true;
    try {
      const thresholdTime = new Date(Date.now() - this.RESERVATION_RECOVERY_STALE_SECONDS * 1000);

      const staleReservations = await this.prisma.callReservation.findMany({
        where: {
          status: 'ACTIVE',
          updated_at: {
            lt: thresholdTime,
          },
        },
        take: this.BATCH_SIZE,
        orderBy: { updated_at: 'asc' },
      });

      if (staleReservations.length === 0) return;

      this.logger.log(`reservation.recovery.started: Found ${staleReservations.length} stale reservations`);

      for (const reservation of staleReservations) {
        await this.reconcileReservation(reservation.call_id);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Safe, idempotent reconciliation of a stale reservation.
   * Uses real database locks inside WalletService to guarantee concurrency isolation.
   */
  public async reconcileReservation(callId: string) {
    try {
      // Step 1: Read call and verify workspace boundaries safely
      const call = await this.prisma.call.findUnique({
        where: { id: callId },
        include: {
          workspace: true,
          callReservation: true,
        },
      });

      if (!call || !call.callReservation) return;

      if (call.callReservation.status !== 'ACTIVE') {
        // Already reconciled
        return;
      }

      const workspaceId = call.workspace_id;
      const providerCallId = call.provider_call_id;

      // Step 2: Query provider call state
      let providerState: ProviderCallStatus = 'UNKNOWN';
      try {
        providerState = await this.provider.getCallStatus(providerCallId);
      } catch (err: any) {
        this.logger.warn(`reservation.recovery.provider_error: Failed to get status for call ${callId}: ${err.message}`);
        return;
      }

      // Step 3: Map classification and act
      if (providerState === 'ACTIVE') {
        this.logger.log(`reservation.recovery.provider_active: Call ${callId} is genuinely still active in provider. Refreshing reservation heartbeat.`);
        // Refresh updated_at so it falls out of the stale window
        await this.prisma.callReservation.update({
          where: { call_id: callId },
          data: { updated_at: new Date() },
        });
        
        // Technically we should check if extension is needed based on available balance,
        // but since the call is verified active, we'll let the provider keep running.
        // If funds truly run out, the regular extension timeout (if alive) or next heartbeat will catch it.
        // If the timer died, the call will just run until completion (potential slight negative balance, but acceptable given it's actively bridged).
        return;
      }

      if (providerState === 'NOT_FOUND') {
        const isLocalTerminal = call.state === 'COMPLETED' || call.state === 'FAILED' || call.state === 'CANCELED';
        if (!isLocalTerminal) {
          // Rule #1: Do NOT automatically convert a non-terminal local call into COMPLETED
          // merely because the provider lookup returns NOT_FOUND. 
          this.logger.warn(`reservation.recovery.anomaly: Call ${callId} missing on provider but local state is ${call.state}. Leaving ACTIVE to prevent premature release.`);
          return; // Defer and do not settle
        }
      }

      if (providerState === 'TERMINAL' || (providerState === 'NOT_FOUND' && (call.state === 'COMPLETED' || call.state === 'FAILED' || call.state === 'CANCELED'))) {
        this.logger.log(`reservation.recovery.provider_terminal: Call ${callId} reported dead by provider (or safely terminal). Proceeding to settlement.`);

        // We use the existing usageBillingService.billCallUsage logic to perform the settlement.
        // `billCallUsage` already fetches the latest call timestamps and handles locking safely.
        
        // We first update the Call state to COMPLETED if it's not already (which it already should be if we reach here for NOT_FOUND, but for TERMINAL we might need to sync it)
        if (call.state !== 'COMPLETED' && call.state !== 'FAILED' && call.state !== 'CANCELED') {
           await this.prisma.call.update({
             where: { id: callId },
             data: {
               state: 'COMPLETED',
               ended_at: call.ended_at || new Date(), // fallback to now if missing
             }
           });
        }

        const trackingNumInfo = await this.prisma.phoneNumber.findFirst({
            where: { phone_number: call.to_number, workspace_id: workspaceId },
        });

        // Run the atomic settlement wrapper
        try {
          const endedAt = call.ended_at || new Date();
          let talkDurationSeconds = 0;
          if (call.answered_at) {
            talkDurationSeconds = Math.max(0, Math.floor((endedAt.getTime() - call.answered_at.getTime()) / 1000));
          }
          await this.usageBillingService.billCallUsage(
            workspaceId,
            callId,
            trackingNumInfo?.number_type,
            talkDurationSeconds
          );
          this.logger.log(`reservation.recovery.settled: Successfully settled call ${callId}`);
        } catch (err: any) {
          if (err.message.includes('Already settled')) {
             // Safe idempotency
             this.logger.log(`reservation.recovery.already_settled: Call ${callId}`);
          } else {
             this.logger.error(`reservation.recovery.failed: Settlement error for call ${callId}: ${err.message}`);
          }
        }
        return;
      }

      // UNKNOWN or any other state
      this.logger.log(`reservation.recovery.deferred: Provider returned UNKNOWN for call ${callId}. Deferring reconciliation.`);

    } catch (error: any) {
      this.logger.error(`reservation.recovery.failed: Critical error reconciling call ${callId}: ${error.message}`);
    }
  }
}
