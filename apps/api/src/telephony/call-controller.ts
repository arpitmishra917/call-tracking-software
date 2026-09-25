import { Injectable, Inject, forwardRef, Logger } from '@nestjs/common';
import type { TelephonyProvider } from './telephony.provider.js';
import { CallEventType, NormalizedCallEvent } from './telephony.events.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CallsService } from '../calls/calls.service.js';
import { UsageService } from '../usage/usage.service.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { CallState, CallAttemptState } from '@prisma/client';

export const TELEPHONY_PROVIDER = 'TELEPHONY_PROVIDER';

@Injectable()
export class CallController {
  private readonly logger = new Logger(CallController.name);

  constructor(
    @Inject(forwardRef(() => TELEPHONY_PROVIDER))
    private readonly provider: TelephonyProvider,
    private readonly prisma: PrismaService,
    private readonly callsService: CallsService,
    private readonly usageService: UsageService,
    private readonly webhooksService: WebhooksService,
  ) {}

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
        where: { phone_number: to! },
      });

      if (!trackingNumber) {
        this.logger.warn(`Unknown tracking number: ${to}`);
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
        // If the call was canceled by a concurrent hangup, transition fails
        return;
      }
      // Start recording the inbound leg
      try {
        await this.provider.startRecording(call.provider_call_id);
      } catch (err) {
        this.logger.error(
          `Failed to start recording for call ${callId}`,
          err,
        );
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

          await this.usageService.recordUsage(
            call.workspace_id,
            'RECORDING_STORAGE' as any,
            1,
            rec.id,
            `REC_${rec.id}`,
          );

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
      if (call.provider_call_id === callId) {
        const updatedCall = await this.callsService.handleCallerHangup(callId);
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
