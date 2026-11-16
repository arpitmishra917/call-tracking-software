import { Injectable, Inject, forwardRef, Logger, Optional } from '@nestjs/common';
import type { TelephonyProvider } from './telephony.provider.js';
import { CallEventType, NormalizedCallEvent } from './telephony.events.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CallsService } from '../calls/calls.service.js';
import { UsageService } from '../usage/usage.service.js';
import { UsageBillingService } from '../billing/usage-billing.service.js';
import { WalletService } from '../billing/wallet.service.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { CommercialEvaluatorService } from '../commercial/commercial-evaluator.service.js';
import { QaTelephonyGuardService } from './qa/qa-telephony-guard.service.js';
import { QaSipUriAdapterService } from './qa/qa-sip-uri-adapter.service.js';
import { normalizeCallerNumber } from '../common/phone.utils.js';
import { CallState, CallAttemptState } from '@prisma/client';

export const TELEPHONY_PROVIDER = 'TELEPHONY_PROVIDER';

@Injectable()
export class CallController {
  private readonly logger = new Logger(CallController.name);
  private activeCallTimers = new Map<string, any>();
  private activeRingbackCalls = new Set<string>();

  constructor(
    @Inject(forwardRef(() => TELEPHONY_PROVIDER))
    private readonly provider: TelephonyProvider,
    private readonly prisma: PrismaService,
    private readonly callsService: CallsService,
    private readonly usageService: UsageService,
    private readonly usageBillingService: UsageBillingService,
    private readonly webhooksService: WebhooksService,
    private readonly walletService: WalletService,
    @Optional()
    private readonly commercialEvaluatorService?: CommercialEvaluatorService,
    @Optional()
    private readonly qaGuardService?: QaTelephonyGuardService,
    @Optional()
    private readonly qaSipAdapter?: QaSipUriAdapterService,
  ) {}

  private async startRingbackIfInactive(callId: string, providerCallId: string): Promise<void> {
    if (!this.activeRingbackCalls.has(callId)) {
      this.activeRingbackCalls.add(callId);
      try {
        await this.provider.startRingback?.(providerCallId);
      } catch (err: any) {
        this.activeRingbackCalls.delete(callId);
        this.logger.warn(`Failed to start ringback for call ${callId}: ${err.message}`);
      }
    }
  }

  private async stopRingbackIfActive(
    callId: string,
    providerCallId: string,
    isBridgedOrCompleted?: boolean,
  ): Promise<void> {
    const wasActive = this.activeRingbackCalls.has(callId);
    this.activeRingbackCalls.delete(callId);
    if (isBridgedOrCompleted) {
      // Ringback was already stopped prior to bridge
      return;
    }
    if (wasActive || isBridgedOrCompleted === false) {
      try {
        await this.provider.stopRingback?.(providerCallId);
      } catch (err: any) {
        this.logger.debug(`Stop ringback failed on call ${callId}: ${err.message}`);
      }
    }
  }

  private scheduleAuthorizationExtension(
    workspaceId: string,
    callId: string,
    providerCallId: string,
    numberType: string | null | undefined,
  ) {
    const blockMicro =
      this.usageBillingService.calculateInitialReservation(numberType);
    const blockMinutes = 10;
    const triggerPercent = 0.8;
    const triggerMs = blockMinutes * 60 * 1000 * triggerPercent;

    const scheduleNext = (extensionIndex: number) => {
      const timer = setTimeout(async () => {
        try {
          const call = await this.prisma.call.findUnique({
            where: { id: callId },
          });
          if (
            !call ||
            call.state === 'COMPLETED' ||
            call.state === 'CANCELED' ||
            call.state === 'FAILED'
          ) {
            this.activeCallTimers.delete(callId);
            return;
          }

          const idempotencyKey = `extension:${callId}:${extensionIndex}`;

          this.logger.log(
            `reservation.extension.requested: Call ${callId} extending block ${extensionIndex}, workspace: ${workspaceId}, amount: ${blockMicro}`,
          );

          const result = await this.walletService.extendReservationForCall(
            workspaceId,
            callId,
            blockMicro,
            idempotencyKey,
          );

          this.logger.log(
            `reservation.extension.succeeded: Call ${callId}, reserved ${result.totalReservedMicro}, available ${result.availableMicro}`,
          );

          scheduleNext(extensionIndex + 1);
        } catch (e: any) {
          if (e.message.includes('Insufficient available funds')) {
            this.logger.warn(
              `reservation.extension.insufficient_funds: Call ${callId}, hanging up provider call.`,
            );
            this.logger.warn(`call.authorization.exhausted: callId=${callId}`);
            this.logger.warn(
              `call.authorization.hangup_requested: callId=${callId}`,
            );

            await this.provider.hangupCall(providerCallId).catch((err) => {
              this.logger.error(
                `Failed to hangup exhausted call ${callId}: ${err.message}`,
              );
            });
            this.activeCallTimers.delete(callId);
          } else if (
            e.message.includes('already applied') ||
            e.message.includes('already')
          ) {
            this.logger.warn(`reservation.extension.duplicate: ${e.message}`);
            scheduleNext(extensionIndex + 1);
          } else if (e.message.includes('non-ACTIVE')) {
            this.activeCallTimers.delete(callId);
          } else {
            this.logger.error(
              `reservation.extension.failed: Call ${callId}, error: ${e.message}`,
            );
            this.activeCallTimers.delete(callId);
          }
        }
      }, triggerMs);

      this.activeCallTimers.set(callId, timer);
    };

    scheduleNext(1);
  }

  async handleEvent(event: NormalizedCallEvent): Promise<void> {
    const { type, callId, direction, connectionId, from, to } = event;
    if (!callId) return;

    let call: any = await this.prisma.call.findUnique({
      where: { provider_call_id: callId },
      include: {
        attempts: { include: { buyer: true }, orderBy: { created_at: 'asc' } },
      },
    });

    let attempt: any = null;

    if (!call) {
      attempt = await this.prisma.callAttempt.findUnique({
        where: { provider_call_id: callId },
        include: {
          call: {
            include: {
              attempts: {
                include: { buyer: true },
                orderBy: { created_at: 'asc' },
              },
            },
          },
          buyer: true,
        },
      });
      if (attempt) {
        call = attempt.call;
      }
    }

    // Early buyer webhook arrival: correlate using client_state if provider_call_id not yet persisted
    if (!call && event.clientState) {
      try {
        const decoded = JSON.parse(
          Buffer.from(event.clientState, 'base64').toString('utf8'),
        );
        if (decoded.attemptId && decoded.callId) {
          attempt = await this.prisma.callAttempt.findUnique({
            where: { id: decoded.attemptId },
            include: {
              call: {
                include: {
                  attempts: {
                    include: { buyer: true },
                    orderBy: { created_at: 'asc' },
                  },
                },
              },
              buyer: true,
            },
          });
          if (
            attempt &&
            attempt.call_id === decoded.callId &&
            (!decoded.workspaceId || attempt.call.workspace_id === decoded.workspaceId)
          ) {
            call = attempt.call;
            // Backfill or update provider_call_id to the live callId
            if (attempt.provider_call_id !== callId) {
              await this.prisma.callAttempt.update({
                where: { id: attempt.id },
                data: { provider_call_id: callId },
              });
              attempt.provider_call_id = callId;
            }
            this.logger.log(
              `client_state.correlated: Successfully correlated event ${type} to attempt ${attempt.id} (call ${call.id}) with callId ${callId}`,
            );
          } else {
            this.logger.warn(
              `client_state.mismatch: Verification failed for attemptId ${decoded.attemptId}, callId ${decoded.callId}`,
            );
          }
        }
      } catch (err: any) {
        this.logger.warn(`Failed to decode/correlate client_state: ${err.message}`);
      }
    }

    if (type === CallEventType.CALL_INITIATED && direction === 'incoming') {
      if (call) return; // idempotency

      // Phase 7B-1: Permanent QA Ingress Shutdown & Identity Gate
      const isQaIngress = this.qaGuardService ? this.qaGuardService.isQaIngressDid(to) : false;
      let matchedQaRunId: string | undefined;

      if (isQaIngress) {
        // 1. Verify QA is enabled and configuration is strictly valid
        if (!this.qaGuardService?.isQaEnabled()) {
          this.logger.warn(
            `qa.ingress.rejected: Call ${callId} to QA tracking DID ${to} received while TELEPHONY_QA_ENABLED is false. Terminating immediately.`,
          );
          await this.provider.hangupCall(callId);
          return; // Fail closed: Never create DB call, never enter waterfall, never reserve funds!
        }

        const configCheck = this.qaGuardService.validateConfiguration();
        if (!configCheck.valid) {
          this.logger.error(
            `qa.ingress.rejected: QA configuration is invalid: ${configCheck.errors.join(', ')}. Terminating immediately.`,
          );
          await this.provider.hangupCall(callId);
          return;
        }

        // 2. Dedicated QA Ingress must match an active, trusted server-side lease
        const leaseMatch = this.qaGuardService.consumeInboundLease(callId, {
          from: from || undefined,
          to: to || undefined,
          connectionId: event.connectionId || undefined,
          token: event.clientState,
        });

        if (!leaseMatch) {
          this.logger.warn(
            `qa.ingress.rejected: Call ${callId} to dedicated QA tracking DID ${to} from ${from} has no active trusted QA lease. Terminating immediately.`,
          );
          await this.provider.hangupCall(callId);
          return; // Fail closed: Never create DB call, never enter waterfall!
        }

        matchedQaRunId = leaseMatch.runId;
        this.logger.log(
          `qa.ingress.accepted: Call ${callId} to dedicated QA tracking DID ${to} verified and bound to active QA test run ${matchedQaRunId}.`,
        );
      }

      const trackingNumber = await this.prisma.phoneNumber.findFirst({
        where: { phone_number: to! },
        include: { workspace: true, campaign: true },
      });

      const isNumberInactive = trackingNumber?.status && trackingNumber.status !== 'ACTIVE';
      if (!trackingNumber || isNumberInactive) {
        this.logger.warn(`Unknown or inactive tracking number: ${to}. Terminating call.`);
        await this.provider.hangupCall(callId);
        return;
      }

      // Phase 7B-1 & Phase 7B-2A: Defense-in-depth for Dedicated QA Workspace
      // If the tracking number belongs to QA_WORKSPACE_ID, enforce strict QA gates
      const isQaWorkspaceNum =
        this.qaGuardService?.isQaWorkspace(trackingNumber.workspace_id) ||
        (process.env.QA_WORKSPACE_ID &&
          trackingNumber.workspace_id.trim().toLowerCase() ===
            process.env.QA_WORKSPACE_ID.trim().toLowerCase());

      if (isQaWorkspaceNum) {
        if (!this.qaGuardService?.isQaEnabled()) {
          this.logger.warn(
            `qa.workspace_ingress.rejected: Call ${callId} directed to QA workspace ${trackingNumber.workspace_id} while TELEPHONY_QA_ENABLED is false. Terminating immediately.`,
          );
          await this.provider.hangupCall(callId);
          return;
        }

        const configCheck = this.qaGuardService?.validateConfiguration();
        if (configCheck && !configCheck.valid) {
          this.logger.error(
            `qa.workspace_ingress.rejected: QA configuration is invalid: ${configCheck.errors.join(', ')}. Terminating immediately.`,
          );
          await this.provider.hangupCall(callId);
          return;
        }

        if (trackingNumber.workspace.status !== 'ACTIVE') {
          this.logger.warn(
            `qa.workspace_ingress.rejected: QA workspace ${trackingNumber.workspace_id} is ${trackingNumber.workspace.status}. Terminating immediately.`,
          );
          await this.provider.hangupCall(callId);
          return;
        }

        if (!trackingNumber.campaign || trackingNumber.campaign.status !== 'ACTIVE') {
          this.logger.warn(
            `qa.workspace_ingress.rejected: QA campaign is missing or inactive. Terminating immediately.`,
          );
          await this.provider.hangupCall(callId);
          return;
        }

        if (!this.qaGuardService?.isCallBound(callId)) {
          this.logger.warn(
            `qa.workspace_ingress.rejected: Inbound call ${callId} directed to QA workspace ${trackingNumber.workspace_id} without verified QA binding. Terminating immediately.`,
          );
          await this.provider.hangupCall(callId);
          return;
        }
      }

      const vendorId =
        trackingNumber.vendor_id && trackingNumber.vendor_id.trim() !== ''
          ? trackingNumber.vendor_id
          : null;
      const attributionSource = vendorId
        ? 'INGRESS_ASSIGNED'
        : 'INGRESS_UNASSIGNED';

      if (
        trackingNumber.workspace.status !== 'ACTIVE' ||
        !trackingNumber.campaign ||
        trackingNumber.campaign.status !== 'ACTIVE'
      ) {
        this.logger.warn(
          `Call to ${to} rejected because workspace ${trackingNumber.workspace_id} is ${trackingNumber.workspace.status}`,
        );
        await this.prisma.call.create({
          data: {
            workspace_id: trackingNumber.workspace_id,
            campaign_id: trackingNumber.campaign_id,
            phone_number_id: trackingNumber.id,
            vendor_id: vendorId,
            attributed_vendor_id: vendorId,
            attribution_source: attributionSource,
            provider: 'provider',
            provider_call_id: callId,
            from_number: from!,
            to_number: to!,
            state: CallState.FAILED,
          },
        });
        await this.provider.hangupCall(callId);
        return;
      }

      const normalizedFrom = from ? normalizeCallerNumber(from) : '';
      let isBlocked = null;
      if (typeof this.prisma.blockedCaller?.findUnique === 'function') {
        isBlocked = await this.prisma.blockedCaller.findUnique({
          where: {
            workspace_id_phone_number: {
              workspace_id: trackingNumber.workspace_id,
              phone_number: normalizedFrom || from!,
            },
          },
        });
        if (!isBlocked && from && normalizedFrom && normalizedFrom !== from) {
          isBlocked = await this.prisma.blockedCaller.findUnique({
            where: {
              workspace_id_phone_number: {
                workspace_id: trackingNumber.workspace_id,
                phone_number: from,
              },
            },
          });
        }
      } else if (typeof this.prisma.blockedCaller?.findFirst === 'function') {
        isBlocked = await this.prisma.blockedCaller.findFirst({
          where: {
            workspace_id: trackingNumber.workspace_id,
            phone_number: { in: [normalizedFrom, from!].filter(Boolean) as string[] },
          },
        });
      }

      if (isBlocked) {
        this.logger.log(`Call from blocked number ${from} (normalized: ${normalizedFrom}). Hanging up.`);
        await this.prisma.call.create({
          data: {
            workspace_id: trackingNumber.workspace_id,
            campaign_id: trackingNumber.campaign_id,
            phone_number_id: trackingNumber.id,
            vendor_id: vendorId,
            attributed_vendor_id: vendorId,
            attribution_source: attributionSource,
            provider: 'provider',
            provider_call_id: callId,
            from_number: normalizedFrom || from!,
            to_number: to!,
            state: CallState.FAILED,
          },
        });
        await this.provider.hangupCall(callId);
        return;
      }

      call = await this.callsService.createCall({
        workspace_id: trackingNumber.workspace_id,
        campaign_id: trackingNumber.campaign_id || undefined,
        phone_number_id: trackingNumber.id,
        vendor_id: vendorId,
        attributed_vendor_id: vendorId,
        attribution_source: attributionSource,
        provider: 'provider',
        provider_call_id: callId,
        from_number: from!,
        to_number: to!,
      });

      // If this was a verified QA ingress candidate, bind the persistent Prisma call ID as well
      if (matchedQaRunId && this.qaGuardService) {
        this.qaGuardService.bindCallToTestRun(call.id, matchedQaRunId);
      }

      // --- PHASE 3D RESERVATION ---
      const isQaCall = this.isQaCallContext(call) || !!matchedQaRunId;
      if (!isQaCall) {
        const initialAmountMicro =
          this.usageBillingService.calculateInitialReservation(
            trackingNumber.number_type,
          );
        try {
          await this.walletService.reserveForCall(
            call.workspace_id,
            call.id,
            initialAmountMicro,
          );
        } catch (err: any) {
          this.logger.warn(
            `Insufficient balance for call ${call.id}. Rejecting: ${err.message}`,
          );
          await this.prisma.call.update({
            where: { id: call.id },
            data: { state: CallState.FAILED },
          });
          await this.provider.hangupCall(callId);
          return;
        }
      } else {
        this.logger.log(
          `qa.wallet.bypass: Call ${call.id} is a verified QA test call. Bypassing wallet reservation.`,
        );
      }
      // ----------------------------

      await this.provider.answerCall(callId);
      return;
    }

    if (!call) {
      this.logger.warn(`Received event ${type} for unknown call ${callId}`);
      return;
    }

    if (
      type === CallEventType.CALL_ANSWERED &&
      call.provider_call_id === callId
    ) {
      if (
        call.state === CallState.ROUTING ||
        call.state === CallState.COMPLETED
      ) {
        this.logger.debug(
          `duplicate.caller_answer.ignored: Caller leg ${callId} already in ${call.state}.`,
        );
        return;
      }
      try {
        call = await this.callsService.transitionCall(
          call.id,
          CallState.ROUTING,
        );
      } catch (err: any) {
        this.logger.error(
          `call.routing.transition_failed: Call ${call.id} failed transitioning to ROUTING: ${err.message}`,
        );
        // If the call was canceled by a concurrent hangup, transition fails
        return;
      }
      // Start recording the inbound leg
      try {
        await this.provider.startRecording(call.provider_call_id);
      } catch (err: any) {
        this.logger.error(`Failed to start recording for call ${callId}: ${err.message}`, err);
      }
      // Start ringback waiting experience for caller
      await this.startRingbackIfInactive(call.id, call.provider_call_id);
      await this.dialNextBuyer(call, connectionId);
      return;
    }

    if (
      type === CallEventType.CALL_ANSWERED &&
      attempt &&
      attempt.provider_call_id === callId
    ) {
      // Idempotency: if attempt is already answered, ignore duplicate
      if (
        attempt.state === CallAttemptState.ANSWERED ||
        attempt.state === CallAttemptState.COMPLETED
      ) {
        this.logger.debug(
          `duplicate.buyer_answer.ignored: Attempt ${attempt.id} already answered.`,
        );
        return;
      }

      const success = await this.callsService.markCallAnswered(
        call.id,
        attempt.id,
      );
      if (!success) {
        // Call is no longer ROUTING, likely canceled by caller hangup
        this.logger.warn(
          `buyer_answer.rejected: Call ${call.id} is no longer ROUTING. Hanging up buyer leg ${callId}.`,
        );
        await this.provider.hangupCall(callId);
        return;
      }

      // Stop ringback on caller leg before bridging
      await this.stopRingbackIfActive(call.id, call.provider_call_id, false);

      try {
        this.logger.log(
          `bridge.executing: Bridging caller ${call.provider_call_id} <-> buyer ${attempt.provider_call_id}`,
        );
        await this.provider.bridgeCalls(
          call.provider_call_id,
          attempt.provider_call_id!,
        );
        this.logger.log(
          `bridge.succeeded: Successfully bridged caller ${call.provider_call_id} <-> buyer ${attempt.provider_call_id}`,
        );
      } catch (bridgeErr: any) {
        this.logger.error(
          `bridge.failed: Error bridging caller ${call.provider_call_id} and buyer ${attempt.provider_call_id}: ${bridgeErr.message}`,
          bridgeErr.stack,
        );
        await this.provider.hangupCall(attempt.provider_call_id!).catch(() => {});
        await this.callsService.handleBridgeFailure(call.id, attempt.id);
        // Resume ringback for caller while dialing next buyer
        await this.startRingbackIfInactive(call.id, call.provider_call_id);
        await this.dialNextBuyer(call, connectionId);
        return;
      }

      // --- PHASE 3E: Start Extension Timer ---
      const trackingNumInfo = await this.prisma.phoneNumber.findFirst({
        where: {
          phone_number: call.to_number,
          workspace_id: call.workspace_id,
        },
      });
      this.scheduleAuthorizationExtension(
        call.workspace_id,
        call.id,
        call.provider_call_id,
        trackingNumInfo?.number_type,
      );
      // ---------------------------------------

      return;
    }

    if (type === CallEventType.CALL_BRIDGED) {
      this.logger.log(
        `call.bridged.confirmed: Provider confirmed bridge for callId: ${callId}`,
      );
      return;
    }

    if (type === CallEventType.CALL_RECORDING_SAVED) {
      const { recordingId, recordingUrl } = event;
      if (recordingId) {
        try {
          const rec = await this.prisma.recording.create({
            data: {
              workspace_id: call.workspace_id,
              call_id: call.id,
              provider_id: recordingId,
              recording_url: recordingUrl,
              status: 'COMPLETED',
            },
          });
          this.logger.log(`Saved recording metadata for call ${call.id}`);

          const dMs =
            call.ended_at && call.answered_at
              ? call.ended_at.getTime() - call.answered_at.getTime()
              : 0;
          const dSec = Math.max(0, Math.ceil(dMs / 1000));
          if (dSec > 0) {
            await this.usageBillingService
              .billRecordingUsage(call.workspace_id, rec.id, dSec)
              .catch((err) => this.logger.error(`Error: ${err.message}`));
          }

          // Fire webhook
          this.webhooksService
            .queueEvent(call.workspace_id, 'recording.available', rec)
            .catch(console.error);
        } catch (err) {
          this.logger.error(`Failed to save recording metadata: ${err}`);
        }
      }
      return;
    }

    if (type === CallEventType.CALL_HANGUP) {
      // --- PHASE 3E: Clear Timer ---
      const timer = this.activeCallTimers.get(call.id);
      if (timer) {
        clearTimeout(timer);
        this.activeCallTimers.delete(call.id);
      }
      // -----------------------------
      if (call.provider_call_id === callId) {
        // Stop ringback on caller hangup
        const isBridged =
          call.state === CallState.COMPLETED ||
          !!call.answered_at ||
          call.attempts?.some(
            (a: any) =>
              a.state === CallAttemptState.ANSWERED ||
              a.state === CallAttemptState.COMPLETED,
          );
        await this.stopRingbackIfActive(call.id, call.provider_call_id, isBridged);

        if (
          call.ended_at &&
          (call.state === CallState.COMPLETED ||
            call.state === CallState.CANCELED ||
            call.state === CallState.FAILED ||
            call.state === CallState.NO_ANSWER)
        ) {
          this.logger.debug(
            `duplicate.caller_hangup.ignored: Caller leg ${callId} already finalized (${call.state}).`,
          );
          return;
        }

        const updatedCall = await this.callsService.handleCallerHangup(callId);
        if (!updatedCall) return;
        const isQaCall = this.isQaCallContext(updatedCall);
        if (this.qaGuardService && updatedCall.id) {
          this.qaGuardService.releaseCallBinding(updatedCall.id);
        }

        const nowMs = updatedCall.ended_at
          ? updatedCall.ended_at.getTime()
          : Date.now();
        const dMs = updatedCall.answered_at
          ? nowMs - updatedCall.answered_at.getTime()
          : 0;
        const talkDurationSecs =
          updatedCall.duration_secs !== null && updatedCall.duration_secs !== undefined
            ? updatedCall.duration_secs
            : Math.max(0, Math.ceil(dMs / 1000));

        if (isQaCall) {
          this.logger.log(
            `qa.billing.bypass: Call ${updatedCall.id} belongs to QA context. Releasing reservation without debit.`,
          );
          await this.walletService
            .releaseReservation(updatedCall.workspace_id, updatedCall.id)
            .catch((err) => {
              this.logger.warn(
                `Failed to release QA reservation for call ${updatedCall.id}: ${err.message}`,
              );
            });
        } else {
          const trackingNumInfo = await this.prisma.phoneNumber.findFirst({
            where: {
              phone_number: updatedCall.to_number,
              workspace_id: updatedCall.workspace_id,
            },
          });

          const rrr = await this.usageBillingService
            .billCallUsage(
              updatedCall.workspace_id,
              updatedCall.id,
              trackingNumInfo?.number_type,
              talkDurationSecs,
            )
            .catch((err) => {
              this.logger.error(
                `Failed to settle/release reservation for call ${updatedCall.id}: ${err.message}`,
              );
            });
          console.log('BILL_USAGE_RESULT:', rrr, 'DUR:', talkDurationSecs);
          if (
            this.commercialEvaluatorService &&
            updatedCall.state === CallState.COMPLETED
          ) {
            await this.commercialEvaluatorService
              .evaluateCall(updatedCall.id)
              .catch((err) => {
                this.logger.error(
                  `Commercial evaluation failed for call ${updatedCall.id}: ${err.message}`,
                  err.stack,
                );
              });
          }
        }
        // ---------------------------
        const activeAttempts =
          updatedCall.attempts?.filter(
            (a: any) =>
              a.state === CallAttemptState.INITIATED ||
              a.state === CallAttemptState.RINGING ||
              a.state === CallAttemptState.ANSWERED ||
              a.state === CallAttemptState.CANCELED, // because handleCallerHangup just set them to CANCELED!
          ) || [];
        for (const act of activeAttempts) {
          if (act.provider_call_id) {
            await this.provider.hangupCall(act.provider_call_id);
          }
        }
      } else if (attempt && attempt.provider_call_id === callId) {
        if (
          attempt.state === CallAttemptState.COMPLETED ||
          attempt.state === CallAttemptState.NO_ANSWER ||
          attempt.state === CallAttemptState.FAILED ||
          attempt.state === CallAttemptState.CANCELED
        ) {
          this.logger.debug(
            `duplicate.buyer_hangup.ignored: Attempt ${attempt.id} already terminal (${attempt.state}).`,
          );
          return;
        }

        const result = event.hangupCause
          ? await this.callsService.handleBuyerHangup(
              call.id,
              attempt.id,
              event.hangupCause,
            )
          : await this.callsService.handleBuyerHangup(call.id, attempt.id);

        if (result.action === 'HANGUP_CALLER') {
          const isBridged =
            call.state === CallState.COMPLETED ||
            !!call.answered_at ||
            call.attempts?.some(
              (a: any) =>
                a.state === CallAttemptState.ANSWERED ||
                a.state === CallAttemptState.COMPLETED,
            );
          await this.stopRingbackIfActive(call.id, call.provider_call_id, isBridged);
          this.logger.log(
            `buyer_hangup.terminating_caller: Buyer hangup for attempt ${attempt.id}. Hanging up caller ${call.provider_call_id}.`,
          );
          await this.provider.hangupCall(call.provider_call_id).catch((err) => {
            this.logger.warn(`Failed to hangup caller leg for call ${call.id}: ${err.message}`);
          });

          const updatedCall = await this.callsService.handleCallerHangup(call.provider_call_id);

          const isQaCall = this.isQaCallContext(updatedCall);
          if (this.qaGuardService && updatedCall.id) {
            this.qaGuardService.releaseCallBinding(updatedCall.id);
          }

          const nowMs = updatedCall.ended_at
            ? updatedCall.ended_at.getTime()
            : Date.now();
          const dMs = updatedCall.answered_at
            ? nowMs - updatedCall.answered_at.getTime()
            : 0;
          const talkDurationSecs =
            updatedCall.duration_secs !== null && updatedCall.duration_secs !== undefined
              ? updatedCall.duration_secs
              : Math.max(0, Math.ceil(dMs / 1000));

          if (isQaCall) {
            this.logger.log(
              `qa.billing.bypass: Call ${updatedCall.id} belongs to QA context. Releasing reservation without debit.`,
            );
            await this.walletService
              .releaseReservation(updatedCall.workspace_id, updatedCall.id)
              .catch((err) => {
                this.logger.warn(
                  `Failed to release QA reservation for call ${updatedCall.id}: ${err.message}`,
                );
              });
          } else {
            const trackingNumInfo = await this.prisma.phoneNumber.findFirst({
              where: {
                phone_number: updatedCall.to_number,
                workspace_id: updatedCall.workspace_id,
              },
            });

            await this.usageBillingService
              .billCallUsage(
                updatedCall.workspace_id,
                updatedCall.id,
                trackingNumInfo?.number_type,
                talkDurationSecs,
              )
              .catch((err) => {
                this.logger.error(
                  `Failed to settle/release reservation for call ${updatedCall.id}: ${err.message}`,
                );
              });

            if (
              this.commercialEvaluatorService &&
              updatedCall.state === CallState.COMPLETED
            ) {
              await this.commercialEvaluatorService
                .evaluateCall(updatedCall.id)
                .catch((err) => {
                  this.logger.error(
                    `Commercial evaluation failed for call ${updatedCall.id}: ${err.message}`,
                    err.stack,
                  );
                });
            }
          }
        } else if (result.action === 'DIAL_NEXT' && result.call) {
          // Phase 6D: QA Waterfall Circuit-Breaker
          const isQa = this.isQaCallContext(result.call);
          if (isQa) {
            this.logger.warn(
              `qa.circuit_breaker: QA buyer attempt ${attempt.id} ended. Terminating QA caller leg immediately without advancing waterfall.`,
            );
            await this.stopRingbackIfActive(result.call.id, result.call.provider_call_id, false);
            await this.provider.hangupCall(result.call.provider_call_id).catch((hangupErr: any) => {
              this.logger.warn(`Failed to hangup QA caller leg: ${hangupErr.message}`);
            });
            await this.walletService
              .releaseReservation(result.call.workspace_id, result.call.id)
              .catch((err) => {
                this.logger.warn(`Failed to release QA reservation on circuit-breaker: ${err.message}`);
              });
            if (this.qaGuardService) {
              this.qaGuardService.releaseCallBinding(result.call.id);
            }
            return;
          }

          this.logger.log(
            `buyer_hangup.advancing: Buyer attempt ${attempt.id} ended. Dialing next buyer.`,
          );
          await this.dialNextBuyer(result.call, connectionId);
        }
      }
    }
  }

  private async dialNextBuyer(call: any, connectionId?: string) {
    const result = await this.callsService.prepareNextBuyer(call.id);

    if (result.action === 'NONE') return;

    if (result.action === 'BUSY') {
      this.logger.log(
        `routing.busy: All eligible buyers are at maximum concurrent capacity. Hanging up caller ${result.call.provider_call_id} with BUSY.`,
      );
      await this.stopRingbackIfActive(result.call.id, result.call.provider_call_id, false);

      let hangupSucceeded = false;
      try {
        await this.provider.hangupCall(result.call.provider_call_id, 'BUSY');
        hangupSucceeded = true;
      } catch (err: any) {
        this.logger.error(
          `caller_hangup.failed: Provider failed to hang up caller ${result.call.provider_call_id} on busy: ${err.message}`,
        );
        await this.handleExhaustionHangupFailure(result.call);
        return;
      }

      if (hangupSucceeded) {
        if (this.isQaCallContext(result.call)) {
          this.logger.log(
            `qa.billing.bypass: Call ${result.call.id} belongs to QA context. Releasing reservation without debit on BUSY.`,
          );
          await this.walletService
            .releaseReservation(result.call.workspace_id, result.call.id)
            .catch((err) => {
              this.logger.warn(`Failed to release QA reservation on BUSY: ${err.message}`);
            });
        } else {
          const trackingNumInfo = await this.prisma.phoneNumber.findFirst({
            where: {
              phone_number: result.call.to_number,
              workspace_id: result.call.workspace_id,
            },
          });
          await this.usageBillingService
            .billCallUsage(
              result.call.workspace_id,
              result.call.id,
              trackingNumInfo?.number_type,
              0,
            )
            .catch((err) => {
              this.logger.error(`Failed to release reservation on BUSY: ${err.message}`);
            });
        }
      }
      return;
    }

    if (result.action === 'HANGUP') {
      if (result.call.state === CallState.COMPLETED) {
        this.logger.warn(
          `routing.exhausted.ignored: Call ${result.call.id} is already COMPLETED. Not terminating caller.`,
        );
        return;
      }

      this.logger.log(`routing.exhausted: No further buyers available. Hanging up caller ${result.call.provider_call_id}.`);
      await this.stopRingbackIfActive(result.call.id, result.call.provider_call_id, false);

      let hangupSucceeded = false;
      try {
        await this.provider.hangupCall(result.call.provider_call_id);
        hangupSucceeded = true;
      } catch (err: any) {
        this.logger.error(
          `caller_hangup.failed: Provider failed to hang up caller ${result.call.provider_call_id} on routing exhaustion: ${err.message}`,
        );
        await this.handleExhaustionHangupFailure(result.call);
        return;
      }

      if (hangupSucceeded) {
        if (this.isQaCallContext(result.call)) {
          this.logger.log(
            `qa.billing.bypass: Call ${result.call.id} belongs to QA context. Releasing reservation without debit on HANGUP.`,
          );
          await this.walletService
            .releaseReservation(result.call.workspace_id, result.call.id)
            .catch((err) => {
              this.logger.warn(`Failed to release QA reservation on HANGUP: ${err.message}`);
            });
        } else {
          const trackingNumInfo = await this.prisma.phoneNumber.findFirst({
            where: {
              phone_number: result.call.to_number,
              workspace_id: result.call.workspace_id,
            },
          });
          await this.usageBillingService
            .billCallUsage(
              result.call.workspace_id,
              result.call.id,
              trackingNumInfo?.number_type,
              0,
            )
            .catch((err) => {
              this.logger.error(`Failed to release reservation on HANGUP: ${err.message}`);
            });
        }
      }
      return;
    }

    if (result.action === 'DIAL') {
      // Ensure ringback is active for caller leg
      await this.startRingbackIfInactive(result.call.id, result.call.provider_call_id);

      const { attempt, buyer, destinationNumber } = result;
      let buyerCallId: string | undefined;
      try {
        const clientStatePayload = {
          callId: result.call.id,
          attemptId: attempt.id,
          workspaceId: result.call.workspace_id,
        };
        const clientState = Buffer.from(
          JSON.stringify(clientStatePayload),
        ).toString('base64');

        const dialNumber = destinationNumber?.destination_number || buyer.destination_number;
        const dialTimeout = destinationNumber?.timeout ?? buyer.timeout ?? 30;

        if (this.qaGuardService) {
          this.qaGuardService.validateDestinationOrThrow(dialNumber, result.call);
        }

        const dialTarget = this.qaSipAdapter
          ? this.qaSipAdapter.resolveBuyerDestination(dialNumber, result.call)
          : dialNumber;

        const isQa = this.isQaCallContext(result.call);
        const boundRunId = isQa && this.qaGuardService
          ? this.qaGuardService.getBoundTestRun(result.call.id) || this.qaGuardService.getBoundTestRun(result.call.provider_call_id)
          : null;

        const customHeaders = boundRunId
          ? [{ name: 'X-QA-Run-Id', value: boundRunId }]
          : undefined;

        buyerCallId = await this.provider.dialBuyer(
          dialTarget,
          result.call.to_number,
          connectionId || '',
          dialTimeout,
          clientState,
          customHeaders,
        );

        if (boundRunId && buyerCallId && this.qaGuardService) {
          this.qaGuardService.bindCallToTestRun(buyerCallId, boundRunId);
        }

        const shouldHangup = await this.callsService.commitBuyerDial(
          attempt.id,
          buyerCallId,
        );

        if (shouldHangup && buyerCallId) {
          await this.provider.hangupCall(buyerCallId);
          return;
        }

        const currentAttempt = await this.prisma.callAttempt.findUnique({
          where: { id: attempt.id },
        });
        if (currentAttempt && currentAttempt.state === CallAttemptState.INITIATED) {
          await this.callsService.transitionAttempt(
            attempt.id,
            CallAttemptState.RINGING,
          );
        }
      } catch (err: any) {
        this.logger.error(`Failed to dial buyer ${buyer.id}: ${err.message}`, err.stack);
        if (buyerCallId) {
          await this.provider.hangupCall(buyerCallId).catch(() => {});
        }
        await this.callsService.releaseBuyerReservation(attempt.id).catch(() => {});
        await this.callsService.transitionAttempt(
          attempt.id,
          CallAttemptState.FAILED,
        ).catch(() => {});

        // Attempt next buyer by calling dialNextBuyer again
        // Phase 6D: QA Waterfall Circuit-Breaker
        const isQa = this.qaGuardService ? this.qaGuardService.isQaCall(result.call) : false;
        if (isQa) {
          this.logger.warn(
            `qa.circuit_breaker: QA call ${result.call.id} failed buyer dial. Terminating caller leg immediately without advancing waterfall.`,
          );
          await this.stopRingbackIfActive(result.call.id, result.call.provider_call_id, false);
          await this.provider.hangupCall(result.call.provider_call_id).catch((hangupErr: any) => {
            this.logger.warn(`Failed to hangup QA caller leg: ${hangupErr.message}`);
          });
          if (this.qaGuardService) {
            this.qaGuardService.releaseCallBinding(result.call.id);
          }
          return;
        }

        // prepareNextBuyer already checks if still ROUTING
        await this.dialNextBuyer(result.call, connectionId);
      }
    }
  }

  private async handleExhaustionHangupFailure(call: any) {
    this.logger.warn(
      `routing.exhaustion.recovery: Initiating recovery for call ${call.id} (${call.provider_call_id})`,
    );
    const status = await this.provider
      .getCallStatus(call.provider_call_id)
      .catch(() => 'UNKNOWN');

    if (status !== 'TERMINAL' && status !== 'NOT_FOUND') {
      try {
        await this.provider.hangupCall(call.provider_call_id);
      } catch (retryErr: any) {
        this.logger.warn(
          `routing.exhaustion.recovery: Retry hangup failed for call ${call.id}: ${retryErr.message}`,
        );
      }
    }

    const updatedCall = await this.callsService
      .handleCallerHangup(call.provider_call_id)
      .catch((err) => {
        this.logger.error(`Failed to finalize caller on recovery: ${err.message}`);
        return null;
      });

    if (updatedCall) {
      if (this.isQaCallContext(updatedCall)) {
        this.logger.log(
          `qa.billing.bypass: Call ${updatedCall.id} belongs to QA context. Releasing reservation without debit on exhaustion recovery.`,
        );
        await this.walletService
          .releaseReservation(updatedCall.workspace_id, updatedCall.id)
          .catch((err) => {
            this.logger.warn(
              `Failed to release QA reservation on exhaustion recovery: ${err.message}`,
            );
          });
      } else {
        const trackingNumInfo = await this.prisma.phoneNumber.findFirst({
          where: {
            phone_number: updatedCall.to_number,
            workspace_id: updatedCall.workspace_id,
          },
        });
        await this.usageBillingService
          .billCallUsage(
            updatedCall.workspace_id,
            updatedCall.id,
            trackingNumInfo?.number_type,
            0,
          )
          .catch((err) => {
            this.logger.error(
              `Failed to release reservation on exhaustion recovery: ${err.message}`,
            );
          });
      }
    }
  }

  /**
   * Helper method to determine if a call belongs to a QA context (by call ID, provider call ID, or workspace).
   */
  private isQaCallContext(call: any): boolean {
    if (!call) return false;
    if (this.qaGuardService?.isCallBound(call.id) || this.qaGuardService?.isCallBound(call.provider_call_id)) {
      return true;
    }
    if (call.workspace_id && this.qaGuardService?.isQaWorkspace(call.workspace_id)) {
      return true;
    }
    if (process.env.QA_WORKSPACE_ID && call.workspace_id === process.env.QA_WORKSPACE_ID) {
      return true;
    }
    return false;
  }

  async getCallState(id: string): Promise<any> {
    return this.prisma.call.findUnique({
      where: { id },
      include: { attempts: true },
    });
  }
}
