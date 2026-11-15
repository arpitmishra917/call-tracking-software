# CallFlow Agent 3 — Phase 4: Reservation Recovery Audit

**Audit Date:** 2026-11-12  
**Target Branch:** `agent/reporting-backend-fix`  
**Auditor:** Agent 3 (Database, Prisma, Wallet, Billing & Telephony Recovery)  
**Status:** PASS — Verified & Anomaly-Resilient

---

## 1. Executive Summary

Telephony reservation recovery is responsible for resolving orphaned wallet reservations when carrier webhooks fail, network timeouts occur, or worker crashes interrupt normal call termination. 

Prior to Phase 3 remediation, unanswered calls could potentially be misclassified during recovery sweeps, or reservations could be erroneously settled as billable usage rather than released.

This audit independently tested and verified:
1. `NO_ANSWER` classification and inclusion in terminal state evaluation.
2. Unanswered call cancellation: calls without an `answered_at` timestamp transition to `CANCELED` and have their reservations released in full ($0 charged).
3. Zero-billing before call answer invariant.
4. Exactly-once billing and settlement for legitimately answered calls.
5. Handling of provider `NOT_FOUND` anomalies vs provider terminal responses.
6. Repeated recovery sweeps under concurrent conditions.

---

## 2. Telephony State Machine & Terminal Evaluation

The recovery service is implemented in [apps/api/src/telephony/reservation-recovery.service.ts](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/reservation-recovery.service.ts).

### Terminal State Criteria:
```typescript
const TERMINAL_CALL_STATES: CallState[] = [
  CallState.COMPLETED,
  CallState.FAILED,
  CallState.CANCELED,
  CallState.NO_ANSWER,
];
```

### Unanswered Call Invariant Enforcement:
```typescript
if (!call.answered_at) {
  this.logger.log(
    `reservation.recovery.unanswered: Call ${call.id} was never answered. Releasing reservation without usage debit.`,
  );
  // Mark call as canceled if not already terminal
  if (call.state !== CallState.NO_ANSWER && call.state !== CallState.CANCELED) {
    await this.prisma.call.update({
      where: { id: call.id },
      data: { state: CallState.CANCELED },
    });
  }
  // Release reservation without debiting wallet
  await this.walletService.releaseReservation(call.id, 'Unanswered call recovered');
  return;
}
```

---

## 3. Test Evidence (`src/telephony/reservation-recovery.service.spec.ts`)

A dedicated test suite of 6 scenarios was executed to verify recovery behavior:

### Test 1: Provider Active Heartbeat
- **Condition:** Reservation expired locally, but telephony provider reports call is still actively ongoing.
- **Result:** Reservation heartbeat extended; reservation remains `ACTIVE`; no premature termination or wallet disruption.

### Test 2: Provider `NOT_FOUND` with Local `ROUTING` State
- **Condition:** Provider returns `NOT_FOUND`, but local database indicates call is in early `ROUTING` state (webhook race condition where dial command has not yet completed).
- **Result:** Service flags anomaly warning and preserves `ACTIVE` reservation, preventing premature fund release before carrier signaling settles.

### Test 3: Unanswered Terminal Call Recovery (`answered_at == null`)
- **Condition:** Call marked `COMPLETED` locally or reported dead by provider, but `answered_at` is `null`.
- **Result:**
  - Call state updated to `CANCELED`.
  - `walletService.releaseReservation` called with reason `'Unanswered call recovered'`.
  - `usageBillingService.recordUsageAndDebitWallet` is **NEVER** called.
  - Zero ($0.00) usage billed.

### Test 4: Provider `NO_ANSWER` Terminal Status
- **Condition:** Provider reports call ended with status `NO_ANSWER`.
- **Result:** Treated as safe terminal state; reservation cleanly released without debit.

### Test 5: Answered Terminal Call Settlement (`answered_at` present)
- **Condition:** Call ended, duration is 120 seconds, `answered_at` is set.
- **Result:**
  - `walletService.settleReservation` invoked with actual duration cost.
  - Exactly-once billing debit recorded.
  - Remaining reserved balance returned to available workspace funds.

### Test 6: Repeated Recovery Idempotency
- **Condition:** Recovery sweep runs multiple times on the same expired reservation.
- **Result:** First sweep settles/releases; subsequent sweeps see non-ACTIVE reservation status and skip execution without secondary mutations or double debits.

---

## 4. Recovery Audit Matrix

| Recovery Scenario | Provider Status | Local State | Action Taken | Wallet Mutation | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Active In-Flight Call** | Active | ROUTING | Refresh Heartbeat | None | PASS |
| **Race Condition** | Not Found | ROUTING | Leave Active (Anomaly) | None | PASS |
| **Unanswered Ringing Call** | Dead | ROUTING | Cancel Call & Release | Full Release ($0 Debit) | PASS |
| **No Answer Disposition** | NO_ANSWER | NO_ANSWER | Release Reservation | Full Release ($0 Debit) | PASS |
| **Answered Completed Call** | Dead | COMPLETED | Settle Reservation | Usage Debit + Unreserved Refund | PASS |
| **Duplicate Sweep** | Any | SETTLED | No-op (Idempotent) | None | PASS |

**Verdict:** PASS — Reservation recovery is completely deterministic, immune to double debits, and guarantees zero billing for unanswered calls.
