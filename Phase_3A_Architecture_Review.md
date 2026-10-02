# Phase 3A Balance Protection Architecture Review

## 1. Current System
The CallFlow billing system operates on a micro-dollar accounting foundation where $1.00 = 1,000,000 micro-dollars. The `WorkspaceBalance` table acts as the authoritative ledger for a tenant's funds, natively maintaining `balance_micro`. Call costs are calculated post-call in the `UsageBillingService` based on exact connected talk duration and billed via atomic debit operations creating `WalletTransaction` entries.

## 2. Problem Definition
Currently, a call can be initiated even if a workspace has $0.00 or insufficient funds, because the system only evaluates cost when the call ends. In a high-concurrency environment, multiple concurrent calls could bypass a simple pre-call check, finish simultaneously, and drive the workspace balance severely negative. The core objective is to deterministically guarantee a workspace has sufficient funds *before* network resources are consumed, without double-spending in concurrent scenarios.

## 3. Reservation Amount Analysis
Because physical talk duration is unknowable at the time of call initiation, reserving the exact actual cost is impossible.
**Recommendation:** A Hybrid Configurable Cap. 
The system should reserve a baseline equivalent to a 10-minute maximum duration (e.g., $0.45 for local) or whatever the workspace's remaining available balance can support, whichever is smaller. If a workspace possesses less than a 1-minute minimum threshold (e.g. $0.045), the call must be rejected entirely.

## 4. Recording Reservation Analysis
Recording is a direct side-effect of call routing and cannot be safely ignored, as it accrues at 2,500 micro-dollars per minute. 
**Recommendation:** If the parent `PhoneNumber` or `Workspace` is configured to record calls, the reservation calculation MUST bundle the recording cost per minute into the call-minute reservation.
`Call reservation = (Number Rate + Recording Rate) * Reserved Minutes`. 

## 5. Call/Fallback Analysis
CallFlow employs sequential buyer fallback (Buyer A -> Buyer B) mapped to `CallAttempt` children under a single parent `Call`.
**Recommendation:** The reservation must be bound strictly to the parent `Call`, acquired exactly once during `INITIATED`. Fallbacks do not consume extra funds simultaneously; they merely consume the physical time allocated to the parent reservation.

## 6. State Machine Integration
- **INITIATED:** System acquires the reservation. If insufficient, immediately transitions to `FAILED` (or `CANCELED`) with a "Low Balance" reason, halting all routing.
- **ROUTING:** Reservation is actively held.
- **COMPLETED/NO_ANSWER/FAILED/CANCELED:** The reservation is finalized, the precise physical duration is debited, and any unused reserved micro-dollars are released back to the available pool.

## 7. Atomicity Strategy
**Recommendation:** Atomic conditional UPDATE. 
The database engine must enforce the invariant. 
```sql
UPDATE "WorkspaceBalance"
SET reserved_micro = reserved_micro + {amount}
WHERE workspace_id = {id} AND (balance_micro - reserved_micro) >= {amount}
```
This guarantees that 10 concurrent calls competing for the last $1.00 will accurately be serialized by Postgres row-level locking, allowing only safe reservations to succeed without requiring complex `SELECT FOR UPDATE` transaction deadlocks.

## 8. Balance vs Available Balance
**Recommendation:** The system MUST adopt the decoupled architecture of `balance_micro` and `reserved_micro`.
- `balance_micro`: The absolute historical economic truth of the wallet (ignoring active calls).
- `reserved_micro`: The sum of all active, in-flight holds.
- `available_micro`: A dynamically calculated virtual column (`balance_micro - reserved_micro`) representing liquidity.

## 9. Reservation Data Model Options
- **A. Add reserved_micro to WorkspaceBalance:** Minimal friction, atomic, but lacks granular auditability of *which* calls hold the reservation in a crash state.
- **B. CallReservation Table:** Highly auditable, easy to expire, but requires complex multi-table locking to guarantee the `available_micro` constraint.
- **C. Combined Model (Recommended):** Add `reserved_micro` to `WorkspaceBalance` for atomic, lightning-fast concurrency limits, AND create a transient `CallReservation` table strictly mapping the `call_id` to its held amount and expiry TTL for observability and crash recovery.

## 10. Recommended Architecture
**Combined Balance + Reservation Ledger.**
We augment `WorkspaceBalance` with a `reserved_micro` BigInt column to act as the synchronous mathematical gatekeeper via atomic update statements. A new `CallReservation` table tracks the individual held blocks. The final `WalletTransaction` debit remains purely the actual consumed economic cost. 

## 11. Reservation Lifecycle
1. **CALL START:** Webhook hits `CallController`.
2. **RESERVE:** `CallsService` calculates 10-minute hold cost. Attempts atomic update on `WorkspaceBalance`. 
3. **ROUTING:** If update succeeds, `CallReservation` is inserted, routing continues.
4. **FINAL BILL:** Upon terminal hangup webhook, `UsageBillingService` calculates actual cost.
5. **RELEASE:** `UsageBillingService` executes an atomic block: `balance_micro = balance_micro - actual_cost`, `reserved_micro = reserved_micro - reserved_amount`, and inserts the `WalletTransaction`. `CallReservation` is marked `COMPLETED`.

## 12. Final Settlement
The final debit must exclusively reflect physical usage. 
`Initial Wallet - Actual Billable Usage`. 
The `reserved_micro` is fully released back into the void, while the `balance_micro` is reduced by the actual incurred micro-dollar cost. 

## 13. Release Logic
The release is executed symmetrically during the `UsageBillingService.billCallUsage` atomic transaction. If the call was `NO_ANSWER`, the actual cost is 0, meaning `reserved_micro` decreases by the hold amount, `balance_micro` decreases by 0, and no `WalletTransaction` is emitted.

## 14. Crash Recovery
**Recommendation:** Sweeper Cron Worker.
If the API crashes and the webhook never arrives, the reservation becomes an orphan. A scheduled cron worker sweeps `CallReservation` where `status = ACTIVE` and `created_at < NOW() - 2 hours`. It cross-references the Telnyx API to confirm the call is dead, forces the `Call` to `FAILED`, and triggers the standard Release Logic to un-stick the funds.

## 15. Expiry
A hard TTL (e.g., 2 hours) should be applied to `CallReservation` entities. 2 hours safely envelopes the absolute maximum conceivable length of a single routing queue and phone call, accounting for provider webhook delays, ensuring funds do not permanently evaporate due to network partitions.

## 16. Long-Running Calls
If a call naturally exceeds its 10-minute hold:
**Recommendation:** Temporary Negative Exposure (Grace Period).
CallFlow's immediate MVP goal is routing. Terminating an active, live business conversation abruptly because a 10-minute hold expired creates severe customer dissatisfaction. For Phase 3, we allow the call to continue. The final debit will simply drive the `available_micro` (and potentially `balance_micro`) negative. The platform's defense is blocking *new* calls when negative. 

## 17. Provider Failure
If Telnyx initiation fails immediately post-reservation, the `CallController` exception handler catches the provider error, marks the `Call` as `FAILED`, and synchronously triggers the Release Logic to immediately un-block the funds.

## 18. Idempotency
Reservations rely on the `Call.id` as their uniqueness constraint. 
`CallReservation` utilizes `call_id` as a UNIQUE index. 
A duplicate webhook trying to transition a call to `INITIATED` will fail constraint checks, preventing double reservations. Duplicate final hangup webhooks are already mitigated by the strict terminal state machine transitions introduced in Phase 2.

## 19. Concurrency
Postgres row-level locks on `WorkspaceBalance` guarantee serialization. 
If Workspace A has $1.00 (1,000,000 micro) available, and Calls X, Y, and Z hit the API simultaneously asking for $0.60 holds, the first transaction acquires the lock, increments `reserved_micro` by 600,000. The second transaction reads 400,000 available, fails the `WHERE available >= 600000` condition, and rejects Call Y. 

## 20. Workspace Isolation
All `CallReservation` and `WorkspaceBalance` atomic queries explicitly require a `workspace_id` constraint. Tenant data cannot conceptually cross-pollinate. 

## 21. Workspace Lifecycle
- **ACTIVE:** New reservations proceed normally.
- **SUSPENDED:** No new reservations permitted. Active calls run to completion and finalize. 
- **ARCHIVED:** Hard block. Active calls are forcefully terminated via provider API upon archival, triggering final settlement.

## 22. Observability
New telemetry states required: `reservation_acquired`, `reservation_rejected_nsf` (non-sufficient funds), `reservation_released`, `reservation_finalized`. These should output to the standard NestJS logger for Datadog/ELK ingestion.

## 23. Security
Customer-facing APIs should NOT expose manual reservation control. Reservations are strictly internal infrastructure consequences of Telephony events. Customers may only query `GET /billing/balance` to view their decoupled `balance` and `available` liquidity.

## 24. Frontend
The UI `Billing` tab requires a minor structural update to display:
`Balance: $10.00`
`In-Use: $1.00`
`Available: $9.00`
An "Insufficient Funds" warning banner should trigger if `Available <= $0.00`.

## 25. Test Plan
- Concurrency: 10 simultaneous call routing requests against a $1.00 balance must yield exactly N holds and M rejections without deadlocks.
- NSF: Calls requested against a $0.00 available balance immediately bounce to `FAILED`.
- Release: `NO_ANSWER` calls fully release funds without creating ledger debits.
- Settlement: $1.00 hold on a 1-minute call releases $1.00 and debits $0.05 simultaneously.
- Idempotency: Re-submitting the initiation webhook returns safe HTTP 200 without double-reserving.

## 26. Migration Plan
1. `ALTER TABLE "WorkspaceBalance" ADD COLUMN reserved_micro BIGINT NOT NULL DEFAULT 0;`
2. Create `CallReservation` table.
No data backfill is required as historical calls are already terminal.

## 27. Implementation Phases
- **Phase 3B:** Prisma schema expansion (WorkspaceBalance `reserved_micro`, `CallReservation` model).
- **Phase 3C:** Core `ReservationService` (atomic acquire/release mechanics).
- **Phase 3D:** Call State Machine integration (wiring acquire into `INITIATED`, release into terminal transitions).
- **Phase 3E:** Cron recovery worker implementation.
- **Phase 3F:** E2E concurrency test suite and Frontend telemetry.

## 28. Risks
- **Under-reservation:** Allowing calls to run indefinitely past their hold amount creates debt risk. Mitigated by restricting *future* calls once negative.
- **Orphan holds:** A broken release hook permanently locks a user's money. Mitigated by the sweeping recovery cron and 2-hour TTL.

## 29. Final Recommendation
Implement the **Combined Balance + Reservation Ledger**. Augmenting `WorkspaceBalance` with `reserved_micro` ensures unbreakable mathematical constraint logic inside Postgres, while the `CallReservation` table provides the critical observability needed to debug dropped provider webhooks and execute safety TTL sweeps.

## 30. CODE CHANGES

NO CODE CHANGES

## 31. DATABASE CHANGES

NO DATABASE CHANGES

## 32. GIT

branch: main
HEAD: 05d24bab972d6aa845bb08aa82ea34d9f02373a7
working tree: dirty (from Phase 2 verification patches)

NO COMMIT
