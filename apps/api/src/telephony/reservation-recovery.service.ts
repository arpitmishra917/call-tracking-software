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

      if (staleReservations.length > 0) {
        this.logger.log(`reservation.recovery.started: Found ${staleReservations.length} stale reservations`);
        for (const reservation of staleReservations) {
          await this.reconcileReservation(reservation.call_id);
        }
      }

      // Also clean up any orphaned buyer reservations for terminal calls
      await this.prisma.buyerReservation.updateMany({
        where: {
          status: 'ACTIVE',
          call: {
            state: { in: ['COMPLETED', 'NO_ANSWER', 'FAILED', 'CANCELED'] },
          },
        },
        data: {
          status: 'RELEASED',
        },
      });
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
        
        return;
      }

      if (providerState === 'NOT_FOUND') {
        const isLocalTerminal =
          call.state === 'COMPLETED' ||
          call.state === 'FAILED' ||
          call.state === 'CANCELED' ||
          call.state === 'NO_ANSWER';
        if (!isLocalTerminal) {
          // Rule #1: Do NOT automatically convert a non-terminal local call into COMPLETED
          // merely because the provider lookup returns NOT_FOUND. 
          this.logger.warn(`reservation.recovery.anomaly: Call ${callId} missing on provider but local state is ${call.state}. Leaving ACTIVE to prevent premature release.`);
          return; // Defer and do not settle
        }
      }

      if (
        providerState === 'TERMINAL' ||
        (providerState === 'NOT_FOUND' &&
          (call.state === 'COMPLETED' ||
            call.state === 'FAILED' ||
            call.state === 'CANCELED' ||
            call.state === 'NO_ANSWER'))
      ) {
        this.logger.log(`reservation.recovery.provider_terminal: Call ${callId} reported dead by provider (or safely terminal). Proceeding to settlement.`);

        // Durable QA isolation: Never settle or debit calls in QA workspace
        const qaWorkspaceId = process.env.QA_WORKSPACE_ID;
        if (qaWorkspaceId && workspaceId.trim().toLowerCase() === qaWorkspaceId.trim().toLowerCase()) {
          this.logger.log(`reservation.recovery.qa_bypass: Call ${callId} is in QA workspace. Releasing reservation without debit.`);
          await this.walletService.releaseReservation(workspaceId, callId).catch((err) => {
            this.logger.warn(`Failed to release QA reservation ${callId}: ${err.message}`);
          });
          await this.prisma.buyerReservation.updateMany({
            where: { call_id: callId, status: 'ACTIVE' },
            data: { status: 'RELEASED' },
          });
          return;
        }

        // Unanswered calls should be canceled/released rather than billed
        if (!call.answered_at) {
          this.logger.log(`reservation.recovery.unanswered: Call ${callId} was never answered. Releasing reservation without usage debit.`);
          if (
            call.state !== 'COMPLETED' &&
            call.state !== 'FAILED' &&
            call.state !== 'CANCELED' &&
            call.state !== 'NO_ANSWER'
          ) {
            await this.prisma.call.update({
              where: { id: callId },
              data: {
                state: 'CANCELED',
                ended_at: call.ended_at || new Date(),
              },
            });
          }

          await this.walletService.releaseReservation(workspaceId, callId).catch((err) => {
            this.logger.warn(`Failed to release reservation for unanswered call ${callId}: ${err.message}`);
          });

          await this.prisma.buyerReservation.updateMany({
            where: { call_id: callId, status: 'ACTIVE' },
            data: { status: 'RELEASED' },
          });
          return;
        }

        // We use the existing usageBillingService.billCallUsage logic to perform the settlement.
        // `billCallUsage` already fetches the latest call timestamps and handles locking safely.
        
        // We first update the Call state to COMPLETED if it's not already (which it already should be if we reach here for NOT_FOUND, but for TERMINAL we might need to sync it)
        if (
          call.state !== 'COMPLETED' &&
          call.state !== 'FAILED' &&
          call.state !== 'CANCELED' &&
          call.state !== 'NO_ANSWER'
        ) {
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

        // Release any buyer reservations for this call
        await this.prisma.buyerReservation.updateMany({
          where: { call_id: callId, status: 'ACTIVE' },
          data: { status: 'RELEASED' },
        });

        return;
      }

      // UNKNOWN or any other state
      this.logger.log(`reservation.recovery.deferred: Provider returned UNKNOWN for call ${callId}. Deferring reconciliation.`);

    } catch (error: any) {
      this.logger.error(`reservation.recovery.failed: Critical error reconciling call ${callId}: ${error.message}`);
    }
  }
}
