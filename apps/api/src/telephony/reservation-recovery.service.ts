import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { WalletService } from '../billing/wallet.service.js';
import { UsageBillingService } from '../billing/usage-billing.service.js';
import type { TelephonyProvider } from './telephony.provider.js';
import { ProviderCallStatus } from './telephony.provider.js';
import { TELEPHONY_PROVIDER } from './call-controller.js';

export interface RecoveryRetryState {
  callId: string;
  attemptCount: number;
  lastAttemptAt: Date;
  nextRecoveryAt: Date;
  lastResult: ProviderCallStatus | 'ERROR' | 'ANOMALY';
  errorMessage?: string;
}

@Injectable()
export class ReservationRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReservationRecoveryService.name);
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  // Set of in-flight reconciliations to prevent duplicate/concurrent worker collisions
  private activeReconciliations = new Set<string>();

  // In-memory retry scheduling tracker with bounded exponential backoff
  private retryStates = new Map<string, RecoveryRetryState>();

  // Stale threshold: Any ACTIVE reservation where updated_at is older than 15 mins
  // is considered stale. This ensures we don't race with normal hangup/extension timers.
  public readonly RESERVATION_RECOVERY_STALE_SECONDS = 15 * 60; 
  public readonly BATCH_SIZE = 100;

  // Retry configuration: Bounded exponential backoff
  public readonly BASE_BACKOFF_MS = 5 * 60 * 1000; // 5 minutes base backoff
  public readonly MAX_BACKOFF_MS = 60 * 60 * 1000; // 60 minutes maximum bound
  public readonly ALERT_ATTEMPT_THRESHOLD = 5; // Alert threshold for consecutive unresolved attempts
  public readonly ALERT_AGE_HOURS = 24; // Alert threshold for calls older than 24 hours

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

  /**
   * Schedule a later retry for a call that returned UNKNOWN, ERROR, or ANOMALY.
   * Employs bounded exponential backoff: base * 2^(attempts - 1), capped at MAX_BACKOFF_MS.
   */
  public scheduleRetry(
    callId: string,
    result: ProviderCallStatus | 'ERROR' | 'ANOMALY',
    errorMessage?: string,
  ): RecoveryRetryState {
    const existing = this.retryStates.get(callId);
    const attemptCount = (existing?.attemptCount || 0) + 1;
    const lastAttemptAt = new Date();

    // Bounded exponential backoff: 5m, 10m, 20m, 40m, capped at 60m
    const exponentialMultiplier = Math.pow(2, Math.min(attemptCount - 1, 5));
    const calculatedBackoff = Math.min(this.BASE_BACKOFF_MS * exponentialMultiplier, this.MAX_BACKOFF_MS);
    const nextRecoveryAt = new Date(lastAttemptAt.getTime() + calculatedBackoff);

    const state: RecoveryRetryState = {
      callId,
      attemptCount,
      lastAttemptAt,
      nextRecoveryAt,
      lastResult: result,
      errorMessage,
    };

    this.retryStates.set(callId, state);

    if (attemptCount >= this.ALERT_ATTEMPT_THRESHOLD) {
      this.logger.warn(
        `reservation.recovery.stuck_call: Call ${callId} has failed reconciliation ${attemptCount} times. Last result: ${result}. Next retry at ${nextRecoveryAt.toISOString()}.`,
      );
    }

    return state;
  }

  public getRetryState(callId: string): RecoveryRetryState | undefined {
    return this.retryStates.get(callId);
  }

  public isRetryPending(callId: string, now: Date = new Date()): boolean {
    const state = this.retryStates.get(callId);
    if (!state) return false;
    return now.getTime() < state.nextRecoveryAt.getTime();
  }

  public clearRetryState(callId: string): void {
    this.retryStates.delete(callId);
  }

  async runRecoveryBatch() {
    if (this.isProcessing) {
      return;
    }
    this.isProcessing = true;
    try {
      const thresholdTime = new Date(Date.now() - this.RESERVATION_RECOVERY_STALE_SECONDS * 1000);
      const now = new Date();

      const where: any = {
        status: 'ACTIVE',
        updated_at: {
          lt: thresholdTime,
        },
      };

      // Isolate synthetic test records when using a real carrier provider (e.g. Telnyx)
      // This prevents orphaned test fixtures from starving real commercial calls in the recovery queue.
      if (typeof (this.provider as any).isSyntheticCallId === 'function') {
        where.NOT = [
          { call: { provider_call_id: { startsWith: 'recovery-mock-' } } },
          { call: { provider_call_id: { startsWith: 'mock_' } } },
          { call: { provider_call_id: { startsWith: 'fake_' } } },
          { call: { provider_call_id: { startsWith: 'test_' } } },
        ];
      }

      const staleReservations = await this.prisma.callReservation.findMany({
        where,
        take: this.BATCH_SIZE,
        orderBy: { updated_at: 'asc' },
      });

      if (staleReservations.length > 0) {
        this.logger.log(`reservation.recovery.started: Found ${staleReservations.length} stale reservations candidate(s)`);
        for (const reservation of staleReservations) {
          // If a call is currently deferred and waiting for its backoff window, skip it in this batch
          if (this.isRetryPending(reservation.call_id, now)) {
            const retryState = this.getRetryState(reservation.call_id);
            this.logger.debug(
              `reservation.recovery.retry_pending: Call ${reservation.call_id} deferred until ${retryState?.nextRecoveryAt.toISOString()} (attempt #${retryState?.attemptCount}). Skipping in current batch.`,
            );
            continue;
          }
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
    // Concurrency protection: At most one worker can reconcile a given callId concurrently
    if (this.activeReconciliations.has(callId)) {
      this.logger.debug(`reservation.recovery.concurrency_skip: Reconciliation already in progress for call ${callId}`);
      return;
    }
    this.activeReconciliations.add(callId);

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
        this.clearRetryState(callId);
        return;
      }

      const workspaceId = call.workspace_id;
      const providerCallId = call.provider_call_id;

      // Operational observability: Alert on ancient unresolved calls (> 24 hours)
      const createdAt = call.created_at ? new Date(call.created_at) : new Date();
      const callAgeHours = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
      if (callAgeHours >= this.ALERT_AGE_HOURS) {
        this.logger.warn(
          `reservation.recovery.aged_unresolved: Call ${callId} was created ${callAgeHours.toFixed(1)} hours ago and remains unresolved with state ${call.state}. Manual review required.`,
        );
      }

      // Synthetic provider ID guard: If live carrier provider identifies a synthetic ID,
      // it must never be dispatched to real carrier API.
      const isSynthetic =
        typeof (this.provider as any).isSyntheticCallId === 'function' &&
        (this.provider as any).isSyntheticCallId(providerCallId);

      if (isSynthetic) {
        const retryState = this.scheduleRetry(callId, 'UNKNOWN', 'Synthetic test provider call ID in live provider mode');
        this.logger.warn(
          `reservation.recovery.synthetic_deferred: Call ${callId} has synthetic ID ${providerCallId} in live provider mode. Deferring retry #${retryState.attemptCount} to ${retryState.nextRecoveryAt.toISOString()}.`,
        );
        return; // Financially fail-closed: do not bill, do not release
      }

      // Step 2: Query provider call state
      let providerState: ProviderCallStatus = 'UNKNOWN';
      try {
        providerState = await this.provider.getCallStatus(providerCallId);
      } catch (err: any) {
        const retryState = this.scheduleRetry(callId, 'ERROR', err.message);
        this.logger.warn(
          `reservation.recovery.provider_error: Failed to get status for call ${callId}: ${err.message}. Scheduled retry #${retryState.attemptCount} for ${retryState.nextRecoveryAt.toISOString()}.`,
        );
        return;
      }

      // Step 3: Map classification and act
      if (providerState === 'ACTIVE') {
        this.logger.log(`reservation.recovery.provider_active: Call ${callId} is genuinely still active in provider. Refreshing reservation heartbeat.`);
        this.clearRetryState(callId);
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
          const retryState = this.scheduleRetry(callId, 'ANOMALY');
          this.logger.warn(
            `reservation.recovery.anomaly: Call ${callId} missing on provider but local state is ${call.state}. Leaving ACTIVE and deferring retry #${retryState.attemptCount} to ${retryState.nextRecoveryAt.toISOString()}.`,
          );
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
        this.clearRetryState(callId);

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

      // UNKNOWN or any other unrecognized state: schedule retry with bounded backoff
      // Financially fail-closed: never release, never bill on UNKNOWN
      const retryState = this.scheduleRetry(callId, 'UNKNOWN');
      this.logger.log(
        `reservation.recovery.deferred: Provider returned UNKNOWN for call ${callId}. Scheduled retry #${retryState.attemptCount} for ${retryState.nextRecoveryAt.toISOString()}.`,
      );

    } catch (error: any) {
      this.logger.error(`reservation.recovery.failed: Critical error reconciling call ${callId}: ${error.message}`);
    } finally {
      this.activeReconciliations.delete(callId);
    }
  }
}
