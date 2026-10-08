import { Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  CallState,
  CallAttemptState,
  CommercialStatus,
  CallCommercial,
  TransactionType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { normalizeE164 } from '../common/phone.utils.js';

@Injectable()
export class CommercialEvaluatorService {
  private readonly logger = new Logger(CommercialEvaluatorService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Post-call commercial evaluation engine.
   * Evaluates a completed Call and creates a historical CallCommercial snapshot
   * when the campaign is commercially configured.
   *
   * Idempotency: Returns existing CallCommercial if already evaluated.
   */
  async evaluateCall(callId: string): Promise<CallCommercial | null> {
    return this.prisma.$transaction(async (tx) => {
      // 1. Idempotency check: return existing commercial record if already evaluated
      const existing = await tx.callCommercial.findUnique({
        where: { call_id: callId },
      });
      if (existing) {
        return existing;
      }

      // 2. Fetch Call with campaign and attempts
      const call = await tx.call.findUnique({
        where: { id: callId },
        include: {
          campaign: true,
          attempts: {
            orderBy: { created_at: 'asc' },
          },
        },
      });

      if (!call) {
        this.logger.warn(`Commercial evaluation skipped: Call ${callId} not found.`);
        return null;
      }

      // 3. Eligible terminal state: ONLY CallState.COMPLETED qualifies
      if (call.state !== CallState.COMPLETED) {
        this.logger.debug(
          `Commercial evaluation skipped: Call ${callId} is in non-eligible state ${call.state}.`,
        );
        return null;
      }

      // 4. Commercial activation rule:
      // A campaign is commercially configured ONLY when BOTH:
      // default_revenue_amount IS NOT NULL AND default_payout_amount IS NOT NULL
      const campaign = call.campaign;
      if (
        !campaign ||
        campaign.default_revenue_amount === null ||
        campaign.default_payout_amount === null
      ) {
        this.logger.debug(
          `Commercial evaluation skipped: Call ${callId} campaign is not commercially configured.`,
        );
        return null;
      }

      // 5. Vendor attribution:
      // Resolved from tracking PhoneNumber (Call.to_number -> PhoneNumber.vendor_id)
      const phoneNumber = await tx.phoneNumber.findFirst({
        where: {
          workspace_id: call.workspace_id,
          phone_number: call.to_number,
        },
        select: { vendor_id: true },
      });
      const vendorId = phoneNumber?.vendor_id ?? null;

      // 6. Winning buyer attribution:
      // Resolved from CallAttempt: attempt that was answered (answered_at != null)
      // and reached COMPLETED (or ANSWERED) state, deterministically ordered.
      const winningAttempt = call.attempts
        .filter(
          (a) =>
            a.answered_at !== null &&
            (a.state === CallAttemptState.COMPLETED || a.state === CallAttemptState.ANSWERED),
        )
        .sort(
          (a, b) =>
            (a.answered_at?.getTime() ?? 0) - (b.answered_at?.getTime() ?? 0) ||
            a.created_at.getTime() - b.created_at.getTime(),
        )[0];
      const buyerId = winningAttempt?.buyer_id ?? null;

      // 7. Conversion rule: duration-only check
      const conversionDurationSecs = campaign.conversion_duration_secs;
      const durationSecs = call.duration_secs;
      const converted =
        conversionDurationSecs !== null &&
        durationSecs !== null &&
        durationSecs >= conversionDurationSecs;

      // 8. Qualification rule: V1 qualified equals converted
      const qualified = converted;

      // 9. Duplicate detection:
      // Scoped to (workspace_id, campaign_id, normalized caller number, duplicate_window_secs)
      const normalizedCaller = normalizeE164(call.from_number);
      const duplicateWindowSecs = campaign.duplicate_window_secs ?? 2592000;
      const windowStart = new Date(call.created_at.getTime() - duplicateWindowSecs * 1000);

      const candidateCalls = await tx.call.findMany({
        where: {
          workspace_id: call.workspace_id,
          campaign_id: call.campaign_id,
          id: { not: call.id },
          created_at: {
            gte: windowStart,
            lt: call.created_at,
          },
          OR: [
            { commercial: { isNot: null } },
            { state: CallState.COMPLETED },
          ],
        },
        orderBy: {
          created_at: 'asc',
        },
      });

      // Deterministically select earliest prior matching call
      const priorCall = candidateCalls.find(
        (c) => normalizeE164(c.from_number) === normalizedCaller,
      );

      const isDuplicate = !!priorCall;
      const duplicateOfCallId = priorCall?.id ?? null;

      // 10. Revenue snapshot: depends on conversion (Decimal 12,4)
      const revenue = converted
        ? new Prisma.Decimal(campaign.default_revenue_amount)
        : new Prisma.Decimal('0.0000');

      // 11. Payout snapshot: depends on conversion (Decimal 12,4)
      const payout = converted
        ? new Prisma.Decimal(campaign.default_payout_amount)
        : new Prisma.Decimal('0.0000');

      // 12. Currency snapshot: CallCommercial.currency = Campaign.currency
      const currency = campaign.currency;

      // 13. Operational cost resolution:
      // Authoritative cost from settlement WalletTransaction.
      // Must NOT assume zero or arbitrary defaults if settlement transaction is missing.
      const settlementTx = await tx.walletTransaction.findFirst({
        where: {
          workspace_id: call.workspace_id,
          reference_type: 'CALL_SETTLEMENT',
          reference_id: call.id,
          type: TransactionType.DEBIT,
        },
        select: { amount_micro: true },
      });

      if (!settlementTx) {
        this.logger.error(
          `Operational cost missing: No CALL_SETTLEMENT WalletTransaction found for call ${call.id} in workspace ${call.workspace_id}. Aborting commercial persistence without estimating cost.`,
        );
        return null;
      }

      const cost = new Prisma.Decimal(settlementTx.amount_micro.toString()).div(1_000_000);

      // 14. Profit calculation: exact Decimal arithmetic: profit = revenue - payout - cost
      const profit = revenue.sub(payout).sub(cost);

      // 15. Persist CallCommercial
      try {
        return await tx.callCommercial.create({
          data: {
            workspace_id: call.workspace_id,
            call_id: call.id,
            campaign_id: campaign.id,
            vendor_id: vendorId,
            buyer_id: buyerId,
            qualified,
            converted,
            duplicate: isDuplicate,
            duplicate_of_call_id: duplicateOfCallId,
            currency,
            revenue,
            payout,
            cost,
            profit,
            status: CommercialStatus.PENDING,
            finalizes_at: null,
          },
        });
      } catch (err: any) {
        // Concurrency protection against race condition
        if (err?.code === 'P2002') {
          const raceExisting = await tx.callCommercial.findUnique({
            where: { call_id: call.id },
          });
          if (raceExisting) return raceExisting;
        }
        throw err;
      }
    });
  }
}
