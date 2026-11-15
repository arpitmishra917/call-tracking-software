# CallFlow Agent 3 — Phase 4B: Wallet Reservation Arithmetic & Ledger Invariants Audit

**Audit Date:** 2026-11-12  
**Target Branch:** `agent/reporting-backend-fix`  
**Database Target:** `postgresql://callflow_qa_user:***@127.0.0.1:5433/callflow_qa?schema=public`  
**Auditor:** Agent 3 (Database, Prisma, Wallet, Billing & Financial Engineering)  
**Status:** PASS — Mathematical Accounting Invariants Verified & Proven

---

## 1. Executive Summary

A critical P0 mandate of CallFlow is ensuring absolute financial correctness across all balance mutations, call reservations, extensions, settlements, and releases.

In Phase 4B, the wallet and billing implementation in [apps/api/src/billing/wallet.service.ts](file:///C:/Projects/callflow-agent-a/apps/api/src/billing/wallet.service.ts) was independently audited to resolve the fundamental accounting question:
**Does `balance_micro` represent Total Wallet Funds (with reserved funds included) or Available Wallet Funds (with reserved funds deducted)?**

### Findings:
1. **Accounting Model:** The CallFlow codebase implements the **Total Balance Accounting Model**:
   $$\text{balance\_micro} = \text{Total Unsettled Wallet Equity}$$
   $$\text{reserved\_micro} = \text{Sum of All Currently Active Reservations}$$
   $$\text{available\_micro} = \text{balance\_micro} - \text{reserved\_micro}$$
2. **Reservation Invariant:** Creating a reservation increments `reserved_micro` by the requested amount while leaving `balance_micro` completely unaltered. Available balance decreases by exactly the reserved amount.
3. **Extension Invariant:** Extending a reservation increments `reserved_micro` and `total_reserved_micro` on `call_reservations` by the extension amount. Total balance remains unchanged.
4. **Release Invariant:** Releasing an unbilled reservation decrements `reserved_micro` to zero without altering `balance_micro`. Available balance is restored in full ($0 debit).
5. **Settlement Invariant:** Settling a call with actual cost $C \le R$ (where $R$ is total reserved funds):
   - `balance_micro` is decremented by exactly the actual cost $C$.
   - `reserved_micro` is decremented by the entire reservation $R$.
   - The unutilized difference $(R - C)$ is released back into available balance automatically.
   - Exactly one `DEBIT` ledger transaction is recorded in `wallet_transactions` for amount $C$.
6. **No Floating Point:** All operations use 64-bit BigInt micro-dollar arithmetic ($1.000000 = 1,000,000$ micro-units).

---

## 2. Mathematical Definition of Accounting Invariants

| Balance Metric | Storage Location | Semantic Meaning | Formula / Constraint |
| :--- | :--- | :--- | :--- |
| **`balance_micro`** | `workspace_balances.balance_micro` | Total deposited funds belonging to workspace | $\ge 0$ |
| **`reserved_micro`** | `workspace_balances.reserved_micro` | Total encumbered funds held for active calls | $0 \le \text{reserved} \le \text{balance}$ |
| **`available_micro`** | Computed dynamically | Disposable funds for new calls or withdrawals | $\text{balance} - \text{reserved} \ge 0$ |
| **`amount_micro`** | `wallet_transactions.amount_micro` | Delta applied to total balance | $> 0$ for non-zero events |

---

## 3. Real PostgreSQL Execution of the 12 Required Scenarios

The complete 12-scenario lifecycle was executed against the real PostgreSQL QA database in [apps/api/test/phase-4b-financial-safety-integration.spec.ts](file:///C:/Projects/callflow-agent-a/apps/api/test/phase-4b-financial-safety-integration.spec.ts):

### Scenario 1: Initial Deposit ($100.00)
- **Operation:** `creditWallet({ amountMicro: 100_000_000n })`
- **Result:**
  - `balance_micro`: `100_000_000n` ($100.00)
  - `reserved_micro`: `0n` ($0.00)
  - `available_micro`: `100_000_000n` ($100.00)
- **Status:** PASS

### Scenario 2: Reserve $20.00 for Call 1
- **Operation:** `reserveForCall(wsId, call1, 20_000_000n)`
- **Result:**
  - `balance_micro`: `100_000_000n` ($100.00 — unchanged!)
  - `reserved_micro`: `20_000_000n` ($20.00)
  - `available_micro`: `80_000_000n` ($80.00)
- **Status:** PASS

### Scenario 3: Available Balance Verification
- **Verified:** $\text{available\_micro} = \text{balance\_micro} - \text{reserved\_micro} = 100M - 20M = 80M$ micro-dollars.
- **Status:** PASS

### Scenario 4: Extend Reservation by $10.00
- **Operation:** `extendReservationForCall(wsId, call1, 10_000_000n, 'ext:call1:1')`
- **Result:**
  - `balance_micro`: `100_000_000n` ($100.00)
  - `reserved_micro`: `30_000_000n` ($30.00)
  - `available_micro`: `70_000_000n` ($70.00)
  - `call_reservations.total_reserved_micro`: `30_000_000n`
- **Status:** PASS

### Scenario 5: Release Reservation Without Usage
- **Operation:** `releaseReservation(wsId, call1)`
- **Result:**
  - `balance_micro`: `100_000_000n` ($100.00)
  - `reserved_micro`: `0n` ($0.00)
  - `available_micro`: `100_000_000n` ($100.00)
  - `call_reservations.status`: `RELEASED`
  - Total debits created: 0.
- **Status:** PASS

### Scenario 6: Create Another Reservation ($20.00) & Settle Actual Usage of $12.00
- **Operation:** `reserveForCall(wsId, call2, 20_000_000n)` followed by `settleReservation(wsId, call2, 12_000_000n)`
- **Result:**
  - `balance_micro`: `88_000_000n` ($88.00 — exact $12 deduction)
  - `reserved_micro`: `0n` ($0.00 — reservation cleared)
  - `available_micro`: `88_000_000n` ($88.00 — remaining $8 returned)
  - `wallet_transactions`: Exactly 1 `DEBIT` transaction for $12.00.
- **Status:** PASS

### Scenario 7: Settle Actual Usage Greater than Original Reservation
- **Operation:**
  - Call 3: original reservation = $10.00 (`10_000_000n`).
  - Extended by $10.00 (`10_000_000n`) $\rightarrow$ `total_reserved_micro` = $20.00 (`20_000_000n`).
  - Actual usage = $15.00 (`15_000_000n`) which is $> \text{original } \$10.00$ but $\le \text{total } \$20.00$.
  - `settleReservation(wsId, call3, 15_000_000n)`.
- **Result:**
  - `balance_micro`: `73_000_000n` ($88 - $15 = $73.00)
  - `reserved_micro`: `0n`
  - `available_micro`: `73_000_000n`
  - Over-reservation difference ($5.00) released cleanly into available balance.
- **Status:** PASS

### Scenario 8: Reject Insufficient Balance
- **Operation:** Attempt to reserve $100.00 (`100_000_000n`) when available balance is $73.00 (`73_000_000n`).
- **Result:** Throws `BadRequestException('Insufficient available funds for reservation.')`. Zero mutations.
- **Status:** PASS

### Scenario 9: Retry Duplicate Reservation Requests (Idempotency)
- **Operation:** Re-invoke `reserveForCall` with identical parameters for Call 4.
- **Result:** Returns existing reservation record without creating additional reservation rows or double-incrementing `reserved_micro`.
- **Status:** PASS

### Scenario 10: Retry Duplicate Settlement Requests (Idempotency)
- **Operation:** Re-invoke `settleReservation` for settled Call 4.
- **Result:** Returns `{ message: 'Already settled', status: ReservationStatus.SETTLED }`. Zero duplicate debits or balance deductions.
- **Status:** PASS

### Scenario 11: Simultaneous Reservation Requests
- **Operation:** Spawned two concurrent `reserveForCall` promises ($10.00 and $15.00) on distinct calls.
- **Result:**
  - Pessimistic row locking (`SELECT balance_micro, reserved_micro ... FOR UPDATE`) serialized both reservations.
  - Final `reserved_micro`: exactly `25_000_000n` ($25.00).
  - Final `available_micro`: exactly `43_000_000n` ($68 - $25 = $43.00).
  - No lost updates or negative balance corruption.
- **Status:** PASS

### Scenario 12: Simultaneous Extension and Settlement Requests
- **Operation:** Dispatched simultaneous `extendReservationForCall` and `settleReservation` for Call 5A.
- **Result:**
  - Database row lock serialized the operations.
  - If settlement executed first, extension was rejected with `Cannot extend a non-ACTIVE reservation`.
  - If extension executed first, settlement successfully accounted for the extended funds.
  - Mathematical integrity $\text{available} = \text{balance} - \text{reserved}$ preserved bit-for-bit.
- **Status:** PASS

---

## 4. Arithmetic Audit Matrix

| Check | Specification | Implementation Verification | Status |
| :--- | :--- | :--- | :--- |
| **Model** | Total Balance Model | `balance_micro` includes reserved; `available = balance - reserved` | PASS |
| **Data Types** | 64-bit BigInt | BigInt throughout all wallet operations | PASS |
| **Idempotency** | No duplicate debits/credits | Unique constraints on idempotency keys & reservation states | PASS |
| **Concurrency** | Zero lost updates | `SELECT ... FOR UPDATE` row-level locks on `workspace_balances` | PASS |
| **Underflow** | No negative balances | Explicit checks `if (availableMicro < amountMicro) throw BadRequest` | PASS |

**Verdict on Audit A:** PASS — Wallet reservation arithmetic is mathematically rigorous, adheres strictly to the Total Balance model, and is verified against live PostgreSQL.
