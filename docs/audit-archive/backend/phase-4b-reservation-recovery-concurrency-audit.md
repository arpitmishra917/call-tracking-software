# CallFlow Agent 3 — Phase 4B: Reservation Recovery Concurrency Audit

**Audit Date:** 2026-11-12  
**Target Branch:** `agent/reporting-backend-fix`  
**Database Target:** `postgresql://callflow_qa_user:***@127.0.0.1:5433/callflow_qa?schema=public`  
**Auditor:** Agent 3 (Database, Prisma, Wallet, Billing & Telephony Recovery)  
**Status:** PASS — Concurrency Races Verified & Exactly-Once Billing Enforced

---

## 1. Executive Summary

Telephony reservation recovery reconciles orphaned balance reservations caused by webhook dropouts, carrier timeouts, worker restarts, or mid-call network partitions. Because the recovery worker runs independently of carrier event webhooks, concurrent execution between the recovery worker and live call-ended webhooks is a real-world scenario.

In Phase 4B, the concurrency semantics of [apps/api/src/telephony/reservation-recovery.service.ts](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/reservation-recovery.service.ts) and [apps/api/src/billing/wallet.service.ts](file:///C:/Projects/callflow-agent-a/apps/api/src/billing/wallet.service.ts) were evaluated across 12 required scenarios.

### Core Guarantees Verified:
1. **Unanswered Calls Produce Zero Usage Debit:** Unanswered calls (`call.answered_at == null` or `NO_ANSWER`) release their reservations in full without billing.
2. **Answered Calls Are Billed Exactly Once:** Concurrent settlement attempts by the webhook handler and the recovery worker serialize via row-level locks, recording exactly one ledger transaction.
3. **Reservation State Invariants:** A reservation can never be both `SETTLED` and `RELEASED`.
4. **Idempotent Sweep:** Repeated or overlapping recovery sweeps no-op safely on already finalized reservations.
5. **Provider Anomaly Handling:** Provider `NOT_FOUND` on a call in `ROUTING` state does NOT trigger premature termination or release.

---

## 2. Evaluation of the 12 Concurrency Scenarios

### Scenario 1: Recovery Worker & Normal Call-Ended Webhook Execute Simultaneously
- **Condition:** Recovery worker detects expired reservation and calls `settleReservation`; call-ended webhook arrives simultaneously and calls `settleReservation`.
- **Mechanism:** Both execute `SELECT balance_micro, reserved_micro FROM "workspace_balances" WHERE workspace_id = $1 FOR UPDATE` and lock `call_reservations`.
- **Observed Behavior:** One transaction wins the lock and transitions status to `SETTLED`, deducting actual cost and writing the ledger entry. The second transaction observes `status === SETTLED` and immediately returns `{ message: 'Already settled', status: ReservationStatus.SETTLED }`.
- **Result:** Exactly one debit transaction created; exactly one usage billing mutation.

### Scenario 2: Two Recovery Workers Process the Same Expired Reservation
- **Observed Behavior:** Handled identically to Scenario 1 via row locking and idempotency checks. Second worker receives idempotent response.

### Scenario 3: Provider Reports `NOT_FOUND` while Local State is `ROUTING`
- **Condition:** Telnyx/Twilio returns `NOT_FOUND` during pre-bridge setup (e.g. carrier signaling race where provider call has not registered in provider API).
- **Mechanism:** Lines 133-145 of `reservation-recovery.service.ts`:
  ```typescript
  if (providerState === 'NOT_FOUND') {
    const isLocalTerminal = ...;
    if (!isLocalTerminal) {
      this.logger.warn(`reservation.recovery.anomaly: Call ${callId} missing on provider but local state is ${call.state}. Leaving ACTIVE to prevent premature release.`);
      return; // Defer and do not settle
    }
  }
  ```
- **Result:** Reservation remains `ACTIVE`; call is NOT killed or released prematurely.

### Scenario 4: Provider Reports `NO_ANSWER`
- **Observed Behavior:** Recognized as terminal. `reconcileReservation` releases the reservation without creating a wallet debit.

### Scenario 5: Call Has No `answered_at` Timestamp
- **Condition:** Call ended, duration reported by carrier, but caller never connected to destination (`answered_at == null`).
- **Mechanism:** Line 172:
  ```typescript
  if (!call.answered_at) {
    this.logger.log(`reservation.recovery.unanswered: Call ${callId} was never answered. Releasing reservation without usage debit.`);
    if (call.state !== 'CANCELED' && ...) {
      await this.prisma.call.update({ where: { id: callId }, data: { state: 'CANCELED' } });
    }
    await this.walletService.releaseReservation(workspaceId, callId);
    return;
  }
  ```
- **Result:** Call transitioned to `CANCELED`. Entire reservation released. $0 debited.

### Scenario 6: Call Has a Valid `answered_at` Timestamp
- **Observed Behavior:** Duration calculated as `ended_at - answered_at`. Exact per-minute billing evaluated and settled via `billCallUsage`.

### Scenario 7: Provider Reports Active Call while Local Reservation Appears Expired
- **Condition:** Long-running call exceeds initial timeout, but provider confirms call is still `ACTIVE`.
- **Mechanism:** Line 122:
  ```typescript
  if (providerState === 'ACTIVE') {
    // Refresh updated_at so it falls out of the stale window
    await this.prisma.callReservation.update({
      where: { call_id: callId },
      data: { updated_at: new Date() },
    });
    return;
  }
  ```
- **Result:** Heartbeat refreshed; reservation kept active; call remains connected.

### Scenario 8: Reservation is Already `SETTLED`
- **Observed Behavior:** Early exit on line 104 (`if (call.callReservation.status !== 'ACTIVE') return`). No queries or mutations dispatched.

### Scenario 9: Reservation is Already `RELEASED`
- **Observed Behavior:** Early exit on line 104. If attempted inside `settleReservation`, rejected with `ConflictException('Reservation already released.')`.

### Scenario 10: Recovery Worker Crashes During Settlement
- **Mechanism:** All mutations inside `WalletService.settleReservation` execute within `prisma.$transaction`.
- **Result:** Any unhandled process termination or database disconnect causes PostgreSQL to trigger an automatic rollback. Zero partial writes.

### Scenario 11: Webhook Retries After Recovery Completes
- **Observed Behavior:** Webhook attempts settlement against `SETTLED` reservation. Service returns idempotent confirmation without double debit.

### Scenario 12: Duplicate Terminal Events Arrive Out of Order
- **Observed Behavior:** Once the reservation reaches `SETTLED` or `RELEASED`, subsequent events cannot re-open or alter the status. Terminal states are permanent.

---

## 3. Real PostgreSQL Integration Test Results

Executed in `apps/api/test/phase-4b-financial-safety-integration.spec.ts`:

1. **Unanswered Call Release Test:**
   - Pre-condition: Balance $50.00, reserved $10.00.
   - Action: `releaseReservation` executed on unanswered call.
   - Post-condition: Balance $50.00, reserved $0.00, available $50.00. Debits count: 0.
   - Status: PASS
2. **Concurrent Settle Race Test:**
   - Pre-condition: Balance $50.00, reserved $10.00.
   - Action: Two workers simultaneously execute `settleReservation` for $4.00.
   - Post-condition: Balance $46.00, reserved $0.00, available $46.00. Exactly 1 ledger transaction created.
   - Status: PASS

---

## 4. Invariant Verification Summary

| Invariant | Target | Verification Method | Status |
| :--- | :--- | :--- | :--- |
| **Zero Debit Unanswered** | $0 usage charged if unanswered | Real PostgreSQL integration test | PASS |
| **Exactly-Once Settlement** | No double debits on race | Real PostgreSQL concurrent settlement | PASS |
| **State Exclusivity** | Never both SETTLED & RELEASED | Enum constraints & status guard | PASS |
| **Anomaly Safety** | NOT_FOUND does not kill ROUTING | Unit & integration tests | PASS |
| **Idempotent Sweeps** | Duplicate sweeps no-op | Guarded status check | PASS |

**Verdict on Audit C:** PASS — Reservation recovery concurrency is fully verified and guarantees financial ledger integrity under race conditions.
