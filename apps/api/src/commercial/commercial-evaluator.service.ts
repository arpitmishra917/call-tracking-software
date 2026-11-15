import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  Prisma,
  CallState,
  CallAttemptState,
  CommercialStatus,
  CallCommercial,
  TransactionType,
  ReservationStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  normalizeE164,
  isIdentifiableCallerNumber,
} from '../common/phone.utils.js';

/**
 * Deterministically constructs a 64-bit signed BigInt advisory lock key
 * from the unique duplicate matching scope.
 */
export function getDuplicateScopeAdvisoryLockKey(
  workspaceId: string,
  campaignId: string,
  normalizedCaller: string,
  normalizedDestination: string,
): bigint {
  const composite = `dup:${workspaceId}:${campaignId}:${normalizedCaller}:${normalizedDestination}`;
  const hash = createHash('sha256').update(composite, 'utf8').digest();
  return hash.readBigInt64BE(0);
}

/**
 * Evaluates connected talk duration strictly between answered_at and ended_at,
 * excluding pre-answer ringing and routing time.
 */
export function calculateConnectedTalkDurationSecs(call: {
  answered_at?: Date | null;
  ended_at?: Date | null;
  duration_secs?: number | null;
  created_at?: Date | null;
  attempts?: Array<{
    answered_at?: Date | null;
    ended_at?: Date | null;
    state?: CallAttemptState;
    created_at: Date;
  }>;
}): number | null {
  const winningAttempt = call.attempts
    ?.filter(
      (a) =>
        a.answered_at !== null &&
        (a.state === CallAttemptState.COMPLETED || a.state === CallAttemptState.ANSWERED),
    )
    .sort(
      (a, b) =>
        (a.answered_at?.getTime() ?? 0) - (b.answered_at?.getTime() ?? 0) ||
        a.created_at.getTime() - b.created_at.getTime(),
    )[0];

  const answeredAt = call.answered_at ?? winningAttempt?.answered_at ?? null;
  const endedAt =
    call.ended_at ??
    winningAttempt?.ended_at ??
    (call.duration_secs !== null && call.duration_secs !== undefined && call.created_at
      ? new Date(call.created_at.getTime() + call.duration_secs * 1000)
      : null);

  if (
    answeredAt &&
    endedAt &&
    !isNaN(answeredAt.getTime()) &&
    !isNaN(endedAt.getTime()) &&
    endedAt.getTime() >= answeredAt.getTime()
  ) {
    return Math.floor((endedAt.getTime() - answeredAt.getTime()) / 1000);
  }

  return null;
}

/**
 * Checks whether a call meets the campaign's conversion duration threshold.
 */
export function isCallConverted(
  call: {
    answered_at?: Date | null;
    ended_at?: Date | null;
    duration_secs?: number | null;
    created_at?: Date | null;
    attempts?: any[];
  },
  conversionDurationSecs: number | null | undefined,
): boolean {
  if (conversionDurationSecs === null || conversionDurationSecs === undefined) {
    return false;
  }
  const talkDuration = calculateConnectedTalkDurationSecs(call);
  return talkDuration !== null && talkDuration >= conversionDurationSecs;
}

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

      // 5. Vendor attribution (Phase 2 Slice 5 Final Hardening):
      // Prefer immutable ingress snapshot: attributed_vendor_id, then vendor_id
      let vendorId: string | null = call.attributed_vendor_id ?? call.vendor_id ?? null;

      // Legacy fallback: ONLY if both attribution fields are null AND attribution_source is null/undefined
      if (!vendorId && (call.attribution_source === null || call.attribution_source === undefined)) {
        const phoneNumber = await tx.phoneNumber.findFirst({
          where: {
            workspace_id: call.workspace_id,
            phone_number: call.to_number,
          },
          select: { vendor_id: true },
        });
        vendorId = phoneNumber?.vendor_id ?? null;
      }

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

      // 7. Connected talk duration & conversion rule:
      const conversionDurationSecs = campaign.conversion_duration_secs;
      const converted = isCallConverted(call, conversionDurationSecs);

      // 8. Approved Duplicate Detection (Option A: Earliest Converted Call)
      // Rule C: A call is eligible as a Duplicate only if the current call is converted.
      // Rule B: Missing, anonymous, or non-identifiable callers cannot establish or trigger duplicates.
      let isDuplicate = false;
      let duplicateOfCallId: string | null = null;

      const isCallerIdentifiable = isIdentifiableCallerNumber(call.from_number);
      const normalizedDestination = normalizeE164(call.to_number);

      if (converted && isCallerIdentifiable && normalizedDestination) {
        const normalizedCaller = normalizeE164(call.from_number);
        const duplicateWindowSecs = campaign.duplicate_window_secs ?? 2592000;
        const windowStart = new Date(call.created_at.getTime() - duplicateWindowSecs * 1000);

        // Mandatory concurrency protection: PostgreSQL transaction-level advisory lock
        const lockKey = getDuplicateScopeAdvisoryLockKey(
          call.workspace_id,
          campaign.id,
          normalizedCaller,
          normalizedDestination,
        );

        if (typeof (tx as any).$executeRaw === 'function') {
          try {
            await (tx as any).$executeRaw(
              Prisma.sql`SELECT pg_advisory_xact_lock(${lockKey})`,
            );
          } catch (lockErr) {
            this.logger.debug(`pg_advisory_xact_lock bypassed or failed: ${lockErr}`);
          }
        } else if (typeof (tx as any).$queryRaw === 'function') {
          try {
            await (tx as any).$queryRaw`SELECT pg_advisory_xact_lock(${lockKey})`;
          } catch (lockErr) {
            this.logger.debug(`pg_advisory_xact_lock bypassed or failed: ${lockErr}`);
          }
        }

        // Query candidate prior calls within the duplicate window
        const candidateCalls = await tx.call.findMany({
          where: {
            workspace_id: call.workspace_id,
            campaign_id: campaign.id,
            id: { not: call.id },
            created_at: {
              gte: windowStart,
              lte: call.created_at,
            },
            OR: [
              { commercial: { isNot: null } },
              { state: CallState.COMPLETED },
            ],
          },
          include: {
            commercial: true,
            attempts: {
              orderBy: { created_at: 'asc' },
            },
          },
          orderBy: [
            { created_at: 'asc' },
            { id: 'asc' },
          ],
        });

        // Filter eligible original converted calls:
        // Rule A: Same workspace, campaign, caller, and destination
        // Rule B: Identifiable caller
        // Rule C: Prior call must be converted (via commercial.converted === true or duration threshold)
        // Rule D: Prior call must be strictly earlier than current call (or tie-break by call.id if created_at is identical)
        const eligibleOriginals = candidateCalls.filter((c) => {
          const isEarlier =
            c.created_at.getTime() < call.created_at.getTime() ||
            (c.created_at.getTime() === call.created_at.getTime() && c.id.localeCompare(call.id) < 0);
          if (!isEarlier) {
            return false;
          }
          if (normalizeE164(c.to_number) !== normalizedDestination) {
            return false;
          }
          if (
            !isIdentifiableCallerNumber(c.from_number) ||
            normalizeE164(c.from_number) !== normalizedCaller
          ) {
            return false;
          }
          if (c.commercial) {
            return c.commercial.converted === true;
          }
          return c.state === CallState.COMPLETED && isCallConverted(c, conversionDurationSecs);
        });

        // Rule E: Earliest converted call wins. Deterministic tie-breaking by created_at asc, id asc
        eligibleOriginals.sort((a, b) => {
          const diff = a.created_at.getTime() - b.created_at.getTime();
          if (diff !== 0) return diff;
          return a.id.localeCompare(b.id);
        });

        const earliestOriginal = eligibleOriginals[0] ?? null;
        if (earliestOriginal) {
          isDuplicate = true;
          // Avoid chaining: if the earliest eligible call references an original within candidates, preserve that root original
          const rootOriginalId =
            earliestOriginal.commercial?.duplicate_of_call_id &&
            candidateCalls.some((c) => c.id === earliestOriginal.commercial?.duplicate_of_call_id)
              ? earliestOriginal.commercial.duplicate_of_call_id
              : earliestOriginal.id;
          duplicateOfCallId = rootOriginalId;
        }
      }

      // 9. Qualification rule: A call qualifies for commercial billing if converted and not duplicate
      const qualified = converted && !isDuplicate;

      // 10. Revenue snapshot: depends on qualification (Decimal 12,4)
      const revenue = qualified
        ? new Prisma.Decimal(campaign.default_revenue_amount)
        : new Prisma.Decimal('0.0000');

      // 11. Payout snapshot: depends on qualification (Decimal 12,4)
      const payout = qualified
        ? new Prisma.Decimal(campaign.default_payout_amount)
        : new Prisma.Decimal('0.0000');

      // 12. Currency snapshot: CallCommercial.currency = Campaign.currency
      const currency = campaign.currency;

      // 13. Operational cost resolution (AD-03):
      // Operational completion must be distinguished from operational cost.
      // CallReservation.status === SETTLED is the definitive signal that wallet settlement completed.
      const reservation = await tx.callReservation.findUnique({
        where: { call_id: call.id },
        select: { status: true },
      });

      // Case C: If reservation is missing or not SETTLED, wallet settlement has not completed.
      if (!reservation || reservation.status !== ReservationStatus.SETTLED) {
        this.logger.debug(
          `Commercial evaluation deferred: Call ${call.id} reservation is not SETTLED (status: ${reservation?.status ?? 'none'}).`,
        );
        return null;
      }

      // Check for authoritative operational cost from settlement WalletTransaction
      const settlementTx = await tx.walletTransaction.findFirst({
        where: {
          workspace_id: call.workspace_id,
          reference_type: 'CALL_SETTLEMENT',
          reference_id: call.id,
          type: TransactionType.DEBIT,
        },
        select: { amount_micro: true },
      });

      // Case A: SETTLED + CALL_SETTLEMENT exists -> use authoritative debit amount
      // Case B: SETTLED + CALL_SETTLEMENT absent -> legitimate zero operational cost (AD-03)
      const cost = settlementTx
        ? new Prisma.Decimal(settlementTx.amount_micro.toString()).div(1_000_000)
        : new Prisma.Decimal('0.0000');

      // 14. Profit calculation: exact Decimal arithmetic: profit = revenue - payout - cost
      const profit = revenue.sub(payout).sub(cost);

      // 15. Persist CallCommercial (AD-01):
      // Synchronous finalizes_at = created_at + 168 hours
      const createdAt = new Date();
      const finalizesAt = new Date(createdAt.getTime() + 168 * 60 * 60 * 1000);

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
            created_at: createdAt,
            finalizes_at: finalizesAt,
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
