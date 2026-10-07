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
import { CallState, CallAttemptState } from '@prisma/client';

export const TELEPHONY_PROVIDER = 'TELEPHONY_PROVIDER';

@Injectable()
export class CallController {
  private readonly logger = new Logger(CallController.name);
  private activeCallTimers = new Map<string, any>();

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
  ) {}

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

    if (type === CallEventType.CALL_INITIATED && direction === 'incoming') {
      if (call) return; // idempotency

      const trackingNumber = await this.prisma.phoneNumber.findFirst({
        where: { phone_number: to!, status: 'ACTIVE' },
        include: { workspace: true, campaign: true },
      });

      if (!trackingNumber) {
        this.logger.warn(`Unknown tracking number: ${to}`);
        return;
      }

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

      const isBlocked = await this.prisma.blockedCaller.findUnique({
        where: {
          workspace_id_phone_number: {
            workspace_id: trackingNumber.workspace_id,
            phone_number: from!,
          },
        },
      });

      if (isBlocked) {
        this.logger.log(`Call from blocked number ${from}. Hanging up.`);
        await this.prisma.call.create({
          data: {
            workspace_id: trackingNumber.workspace_id,
            campaign_id: trackingNumber.campaign_id,
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

      call = await this.callsService.createCall({
        workspace_id: trackingNumber.workspace_id,
        campaign_id: trackingNumber.campaign_id || undefined,
        provider: 'provider',
        provider_call_id: callId,
        from_number: from!,
        to_number: to!,
      });

      // --- PHASE 3D RESERVATION ---
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
      try {
        call = await this.callsService.transitionCall(
          call.id,
          CallState.ROUTING,
        );
      } catch (err) {
        console.error('FAIL ROUTING', err);
        // If the call was canceled by a concurrent hangup, transition fails
        return;
      }
      // Start recording the inbound leg
      try {
        await this.provider.startRecording(call.provider_call_id);
      } catch (err) {
        this.logger.error(`Failed to start recording for call ${callId}`, err);
      }
      await this.dialNextBuyer(call, connectionId);
      return;
    }

    if (
      type === CallEventType.CALL_ANSWERED &&
      attempt &&
      attempt.provider_call_id === callId
    ) {
      const success = await this.callsService.markCallAnswered(
        call.id,
        attempt.id,
      );
      if (!success) {
        // Call is no longer ROUTING, likely canceled by caller hangup
        await this.provider.hangupCall(callId);
        return;
      }

      await this.provider.bridgeCalls(
        call.provider_call_id,
        attempt.provider_call_id!,
      );

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
        const updatedCall = await this.callsService.handleCallerHangup(callId);

        const nowMs = updatedCall.ended_at
          ? updatedCall.ended_at.getTime()
          : Date.now();
        const dMs = updatedCall.answered_at
          ? nowMs - updatedCall.answered_at.getTime()
          : 0;
        const talkDurationSecs = Math.max(0, Math.ceil(dMs / 1000));

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
        const result = await this.callsService.handleBuyerHangup(
          call.id,
          attempt.id,
        );

        if (result.action === 'HANGUP_CALLER') {
          await this.provider.hangupCall(call.provider_call_id);
        } else if (result.action === 'DIAL_NEXT' && result.call) {
          await this.dialNextBuyer(result.call, connectionId);
        }
      }
    }
  }

  private async dialNextBuyer(call: any, connectionId?: string) {
    const result = await this.callsService.prepareNextBuyer(call.id);

    if (result.action === 'NONE') return;

    if (result.action === 'HANGUP') {
      await this.provider.hangupCall(result.call.provider_call_id);
      return;
    }

    if (result.action === 'DIAL') {
      const { attempt, buyer } = result;
      try {
        const buyerCallId = await this.provider.dialBuyer(
          buyer.destination_number,
          result.call.to_number,
          connectionId || '',
          buyer.timeout,
        );

        const shouldHangup = await this.callsService.commitBuyerDial(
          attempt.id,
          buyerCallId,
        );

        if (shouldHangup && buyerCallId) {
          await this.provider.hangupCall(buyerCallId);
          return;
        }

        await this.callsService.transitionAttempt(
          attempt.id,
          CallAttemptState.RINGING,
        );
      } catch (err) {
        this.logger.error(`Failed to dial buyer ${buyer.id}`, err);
        await this.callsService.transitionAttempt(
          attempt.id,
          CallAttemptState.FAILED,
        );

        // Attempt next buyer by calling dialNextBuyer again
        // prepareNextBuyer already checks if still ROUTING
        await this.dialNextBuyer(result.call, connectionId);
      }
    }
  }

  getCallState(_id: string): any {
    return null;
  }
}
