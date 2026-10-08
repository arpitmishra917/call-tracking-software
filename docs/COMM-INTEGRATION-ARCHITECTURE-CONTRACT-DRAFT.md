# CALLFLOW — INTEGRATION ARCHITECTURE CONTRACT
## COMM-1 THROUGH COMM-14B TO OPERATIONAL BASELINE INTEGRATION
### DRAFT ARCHITECTURE & GOVERNANCE CONTRACT

---

## 1. Purpose

This document defines the formal, binding **Integration Architecture Contract** for integrating the frozen commercial and settlement subsystem (`COMM-1` through `COMM-14B`) into the active operational trunk of CallFlow. 

This contract serves as the governance boundary for subsequent development phases. It establishes:
- Invariant business rules that must never be modified.
- Required integration behaviors across the operational, commercial, and settlement layers.
- Formal resolution boundaries for the **168-Hour Finalization Deadlock** and the **Zero-Cost Call Lockout**.
- Precise alignment with CallFlow’s native Role-Based Access Control (RBAC) foundation.
- Strict operational safety and database reconciliation standards.

This document is governed by a strict **READ-ONLY** mandate: it defines required behavior, integration boundaries, constraints, and open decisions without implementing code or prematurely locking technical execution mechanisms.

---

## 2. Repository Baselines

The architecture contract establishes exact, immutable Git references for integration reconciliation:

- **Current Operational Branch:** [`agent/reporting-backend-fix`](file:///C:/Projects/callflow-agent-a)
- **Current Operational HEAD SHA:** `f901302b156c2779a169b2ceeb27ba7fe0c09be3`
  - *Status:* Mature operational call routing, carrier telephony, wallet reservation, usage billing, and initial reporting trunk.
- **Frozen Commercial Branch:** `agent/commercial-comm14-settlement-generation`
- **Frozen Commercial Baseline SHA:** `59da9deba18254da918e60623f440581deb97a53` (short ref `59da9de`)
  - *Status:* Implements COMM-1 through COMM-14B; frozen settlement and commercial calculation baseline.
- **Remote Tracking Reference:** `origin/main` (`a30e81fd78dfe0ce828a4f93f70627fd343003cd`)
- **Topological Relationship:**
  - `f901302` is a **direct linear ancestor** of `59da9de`.
  - Commits only on operational branch: `0`.
  - Commits only on commercial branch: `21` (4 intermediate reporting fixes followed by 17 commercial/settlement commits).
  - Merge Base: `f901302b156c2779a169b2ceeb27ba7fe0c09be3`.

---

## 3. Current-State Summary

Forensic audits conducted by Agents 1 through 5 establish the following baseline facts:

1. **Operational Maturity:** The operational core (telephony state machine, Telnyx/Twilio webhooks, campaign routing, buyer hunting, in-flight wallet reservations, micro-dollar balances, and baseline reporting) is stable and covered by 259 passing tests.
2. **Commercial Subsystem Isolation:** The commercial capabilities implemented in COMM-1 through COMM-14B exist exclusively on the commercial branch and are not reachable from the operational HEAD.
3. **Database Topology:** Commercial schema changes add 10 models and 13 enums across 5 strictly additive migrations (`20261007000000` through `20261008000001`). No migration timestamps collide and no existing operational columns are destructively mutated.
4. **Architectural Defects in Commercial Baseline:**
   - **The Finalization Deadlock:** `CommercialEvaluatorService` creates `CallCommercial` with `status: PENDING` and `finalizes_at: null`. No mechanism exists in application code to set `finalizes_at` or transition to `FINAL`. Organic calls never enter settlement.
   - **The Zero-Cost Lockout:** `WalletService.settleReservation` prunes zero-dollar carrier transactions (cost = 0). `CommercialEvaluatorService` strictly mandates a `CALL_SETTLEMENT` ledger record, aborting evaluation if missing. Zero-cost calls never generate commercial records.
5. **Authorization Asymmetry:** The dispute controller uses coarse workspace role checks (`OWNER`/`ADMIN`), bypassing CallFlow's native granular `Permission` architecture. Settlement generation has no controller surface or access control guards.
6. **Downstream Stubs:** `PaymentInstruction`, `PaymentExecution`, `ReconciliationRun`, and `ReconciliationIssue` are schema definitions with zero backend service logic.

---

## 4. Frozen COMM Rules

The following business rules were formalized and frozen across COMM-1 through COMM-14B. Any future integration agent is strictly prohibited from altering these rules.

| Rule ID | Domain | Invariant Definition | Classification |
| :--- | :--- | :--- | :--- |
| **FR-01** | Valuation | `profit = revenue - payout - cost` (exact Decimal 12,4 arithmetic). | **FROZEN RULE** |
| **FR-02** | Qualification | V1 qualified status is equivalent to converted status (`qualified = converted`). | **FROZEN RULE** |
| **FR-03** | Conversion | Duration-only rule: `durationSecs >= campaign.conversion_duration_secs`. | **FROZEN RULE** |
| **FR-04** | Duplicate | Scoped to `(workspace_id, campaign_id, normalized_caller, duplicate_window_secs)`. Earliest prior call wins. | **FROZEN RULE** |
| **FR-05** | Commercial State | `CommercialStatus` lifecycle values: `PENDING`, `FINAL`, `ADJUSTED`. | **FROZEN RULE** |
| **FR-06** | Grace Period | 168 hours (7 days) starting from `CallCommercial.created_at`. | **FROZEN RULE** |
| **FR-07** | Settlement Eligibility | Call is eligible for settlement if and only if: `status == FINAL` AND `finalizes_at <= NOW()` AND no pending dispute exists. | **FROZEN RULE** |
| **FR-08** | Settlement Boundaries | Accounting period is strictly half-open: `[period_start, period_end)` where `period_start` is inclusive and `period_end` is exclusive. | **FROZEN RULE** |
| **FR-09** | Settlement Uniqueness | `SettlementItem` uniqueness is scoped to `(call_commercial_id, participant_type)` (COMM-13B invariant). A call can have at most one Buyer item and one Vendor item. | **FROZEN RULE** |
| **FR-10** | Cadence Autonomy | V1 settlement generation has **no automatic cadence**; periods and generation are explicitly caller-driven. | **FROZEN RULE** |
| **FR-11** | Foreign Exchange | Multi-currency within a single settlement batch or aggregation is prohibited. Mixed currencies throw `BadRequestException`. FX conversion is strictly out of scope for V1. | **FROZEN RULE** |
| **FR-12** | Dispute Reversal | Accepted dispute performs full financial reversal: `revenue = 0.0000`, `payout = 0.0000`, `profit = -cost`, `status = ADJUSTED`. Creates immutable `CallFinancialAdjustment`. | **FROZEN RULE** |

---

## 5. Decision A — Commercial Finalization

### A. Current Forensic Evidence
- **Fact:** `CommercialEvaluatorService.evaluateCall` ([`commercial-evaluator.service.ts#L206`](file:///C:/Projects/callflow-agent-a/apps/api/src/commercial/commercial-evaluator.service.ts#L206)) persists:
  ```typescript
  status: CommercialStatus.PENDING,
  finalizes_at: null,
  ```
- **Fact:** `created_at` is generated automatically by PostgreSQL / Prisma at record creation.
- **Fact:** Nowhere in the entire repository is `finalizes_at` updated or populated by application code.
- **Fact:** Nowhere in the entire repository is `status` transitioned from `PENDING` to `FINAL` by application code.
- **Fact:** `SettlementBatchService` queries `where: { status: CommercialStatus.FINAL, finalizes_at: { not: null, gte: period_start, lt: period_end, lte: now } }`.
- **Existing Background Pattern Fact:** CallFlow currently utilizes in-process polling timers via `setInterval` ([`reservation-recovery.service.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/reservation-recovery.service.ts) and [`webhooks.service.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/webhooks/webhooks.service.ts)), not BullMQ or external workers.

### B. Required Behavior (Contract Specification)
1. **Deterministic Timestamp Persistence:** `finalizes_at` must be established deterministically as `created_at + 168 hours` and persisted in the database.
2. **Deterministic State Transition:** Any record where `status == PENDING` and `NOW() >= finalizes_at` that has no active dispute (`dispute == null` or dispute resolved) must transition to `status = FINAL`.
3. **No Early Finalization:** No call may reach `FINAL` status prior to `created_at + 168 hours`.
4. **Dispute Blocking:** A call with a pending dispute (`dispute.status == PENDING`) must remain blocked from transitioning to `FINAL`.
5. **Idempotency & Concurrency:** The transition mechanism must be idempotent, concurrency-safe, multi-tenant isolated, and resilient to process crashes/restarts.
6. **No Economic Mutation:** Finalization must mutate *only* lifecycle status and timestamp metadata; financial snapshots (`revenue`, `payout`, `cost`, `profit`) must remain immutable.

### C. Architectural Boundaries & Open Decisions
- **Classification:** **REQUIRED BEHAVIOR** (as specified above).
- **Open Architecture Decision A.1:** When is `finalizes_at` populated?
  - *Option 1:* Computed immediately inside `CommercialEvaluatorService.evaluateCall` at call completion (`finalizes_at = new Date(created_at.getTime() + 168 * 3600 * 1000)`).
  - *Option 2:* Populated by a background finalization worker.
- **Open Architecture Decision A.2:** What triggers the transition from `PENDING` to `FINAL`?
  - *Option 1:* Asynchronous periodic polling worker (following the `ReservationRecoveryService` pattern).
  - *Option 2:* Just-in-time transition during settlement generation batch evaluation.
  - *Option 3:* Explicit administrative/manager finalization API endpoint.
- **Constraint:** The implementation agent must not alter the 168-hour rule.

---

## 6. Decision B — Zero-Cost Calls

### B. Current Forensic Evidence
- **Fact:** [`WalletService.settleReservation`](file:///C:/Projects/callflow-agent-a/apps/api/src/billing/wallet.service.ts#L518) executes:
  ```typescript
  if (actualCostMicro > 0n) {
    await tx.walletTransaction.create({
      data: {
        workspace_id: workspaceId,
        reference_type: 'CALL_SETTLEMENT',
        reference_id: callId,
        type: TransactionType.DEBIT,
        ...
      },
    });
  }
  ```
- **Fact:** For zero-cost calls (`actualCostMicro === 0n`), `callReservation` transitions to `SETTLED`, but **no `CALL_SETTLEMENT` record is written to `wallet_transactions`**.
- **Fact:** [`CommercialEvaluatorService.evaluateCall`](file:///C:/Projects/callflow-agent-a/apps/api/src/commercial/commercial-evaluator.service.ts#L183) queries:
  ```typescript
  const settlementTx = await tx.walletTransaction.findFirst({
    where: { reference_type: 'CALL_SETTLEMENT', reference_id: call.id, type: TransactionType.DEBIT },
  });
  if (!settlementTx) {
    this.logger.error(`Operational cost missing: No CALL_SETTLEMENT... Aborting`);
    return null;
  }
  ```
- **Fact:** A legitimate zero-cost completed call (e.g., toll-free inbound, bundled carrier minutes, or zero carrier charge) fails commercial evaluation and creates no `CallCommercial` record.
- **Existing Fact:** Zero values in monetary fields are natively supported across Prisma schemas as `Decimal('0.0000')` and in wallets as `0n` micro-dollars.

### B. Architectural Direction & Contract Requirement
1. **Commercial Representation of Zero Cost:** A legitimate completed call with operational cost = $0 **MUST** be capable of generating a valid `CallCommercial` record.
2. **Economic Integrity:** For a zero-cost call, `CallCommercial.cost` must be recorded as `Decimal('0.0000')`, and `profit` calculated accurately as `revenue - payout - 0.0000`.
3. **Operational Ledger Invariant:** **Do NOT manufacture fake operational wallet transactions.** An operational debit of `$0.00` must not be inserted into `wallet_transactions` solely to appease the commercial evaluator.
4. **Separation of Concerns:**
   - Operational layer owns wallet ledger integrity: `WalletService` records debits only when currency moves.
   - Commercial layer owns platform economics: `CommercialEvaluatorService` must distinguish between an *unsettled call* (reservation still pending) and a *settled call with zero operational cost*.

### C. Architectural Boundaries & Open Decisions
- **Classification:** **REQUIRED BEHAVIOR** (as specified above).
- **Open Architecture Decision B.1:** How does `CommercialEvaluatorService` verify settlement completion when cost is zero?
  - *Option 1:* Check `callReservation.status === 'SETTLED'`. If settled and `walletTransaction` is absent, cost is deterministically `0.0000`.
  - *Option 2:* Inspect `UsageRecord` or `call.duration_secs` alongside reservation state.
  - *Option 3:* Pass resolved operational cost explicitly from `CallController` into `CommercialEvaluatorService.evaluateCall(callId, actualCostMicro)`.
- **Constraint:** The implementation agent must not insert zero-dollar ledger spam into `wallet_transactions`.

---

## 7. Decision C — Authorization / RBAC

### A. Current Forensic Evidence
- **Operational RBAC Foundation:**
  - Located in `apps/api/src/authorization/` and `apps/api/src/permissions/`.
  - Permission registry: [`PERMISSIONS_LIST`](file:///C:/Projects/callflow-agent-a/apps/api/src/permissions/permissions.constants.ts) using `resource:action` convention (`call:read`, `report:read`, `billing:manage`).
  - Scoping model: `WorkspaceMemberPermission` supports `scope_type` (`ALL` vs `ASSIGNED`) and `resource_id`.
  - Participant binding: `WorkspaceMember` has `participant_type` (`WORKSPACE`, `BUYER`, `VENDOR`), `buyer_id`, and `vendor_id`.
  - Guard architecture: [`PermissionsGuard`](file:///C:/Projects/callflow-agent-a/apps/api/src/authorization/permissions.guard.ts) with `@RequirePermission(...)`.
- **Commercial Dispute Implementation Divergence:**
  - [`CommercialDisputesController`](file:///C:/Projects/callflow-agent-a/apps/api/src/commercial/commercial-disputes.controller.ts) uses `@UseGuards(WorkspaceRolesGuard)` with `@RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)`.
  - Granular permissions (`PermissionsGuard`) are completely bypassed.
  - Participant visibility is hardcoded inside [`CommercialDisputesService`](file:///C:/Projects/callflow-agent-a/apps/api/src/commercial/commercial-disputes.service.ts) using manual `if (member.participant_type === 'VENDOR')` checks.
- **Settlement Authorization Gap:**
  - [`SettlementModule`](file:///C:/Projects/callflow-agent-a/apps/api/src/settlement/settlement.module.ts) has **zero HTTP controllers, zero endpoints, and zero guards**.

### B. Architectural Direction & Contract Requirement
1. **Single Foundation Mandate:** Commercial and settlement features must integrate into CallFlow’s **existing RBAC and permissions foundation**. Parallel authorization frameworks are prohibited.
2. **Naming Convention Standardization:** Commercial permissions must adhere to the existing `resource:action` convention (e.g., `commercial:read`, `dispute:create`, `dispute:manage`, `settlement:read`, `settlement:generate`).
3. **Tenant & Participant Isolation:**
   - Buyers may view only commercial data and disputes associated with their own `buyer_id`.
   - Vendors may view only commercial payout data associated with their own `vendor_id`.
   - Vendors must never access buyer disputes or platform profit margins.
   - Cross-workspace access must be rejected with `ForbiddenException` / `NotFoundException`.
4. **Controller Standardization:** All commercial and settlement controllers must employ standard CallFlow guards (`JwtAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard`).

### C. Open Architecture Decisions
- **Open Architecture Decision C.1:** Exact permission keys to add to `PERMISSIONS_LIST`:
  - Candidate keys: `commercial:read`, `commercial:export`, `dispute:read`, `dispute:create`, `dispute:resolve`, `settlement:read`, `settlement:generate`.
- **Open Architecture Decision C.2:** Baseline permission assignment:
  - Which permissions belong in `ADMIN_BASELINE_PERMISSIONS` vs restricted strictly to `OWNER`.
- **Open Architecture Decision C.3:** Settlement invocation role restriction:
  - Can an `ADMIN` with `settlement:generate` create batches, or is batch generation restricted exclusively to workspace `OWNER`?

---

## 8. Decision D — Integration Boundary

### Architectural Boundary Map

```
========================================================================================
[1. OPERATIONAL LAYER]
- Telephony Inbound (Telnyx/Twilio)
- Routing Engine & Campaign Distribution
- Buyer Hunting & Attempt Dialing
- In-Flight Wallet Authorization & Reservations
- Operational Call Completion (CallState.COMPLETED)
- Wallet Usage Settlement (WalletService.settleReservation)
========================================================================================
                                      ↓
========================================================================================
[2. INTEGRATION BOUNDARY / HOOK]
- Terminal Call Hangup Hook in CallController
- Pre-condition: CallState === COMPLETED AND Wallet Reservation Settled
- Fault Boundary: Commercial failure MUST NOT revert operational call completion
========================================================================================
                                      ↓
========================================================================================
[3. COMMERCIAL EVALUATION LAYER]
- CommercialEvaluatorService.evaluateCall(callId)
- Campaign Rates & Currency Snapshot
- Classification: Converted / Qualified / Duplicate
- Financial Snapshot: Revenue, Payout, Cost, Profit
- CallCommercial Persisted (status: PENDING, finalizes_at populated)
========================================================================================
                                      ↓
========================================================================================
[4. DISPUTE & FINALIZATION MATURITY]
- Buyer Dispute Filing (CallDispute) -> CommercialFinancialAdjustment
- 168-Hour Maturity Period (NOW >= finalizes_at AND no open dispute)
- Lifecycle Transition: PENDING → FINAL (or ADJUSTED)
========================================================================================
                                      ↓
========================================================================================
[5. SETTLEMENT ENGINE LAYER]
- SettlementBatchService (generateBuyerSettlementBatches / generateVendorSettlementBatches)
- Query Condition: status === FINAL AND finalizes_at in [period_start, period_end)
- Invariant: (call_commercial_id, participant_type) uniqueness
- Immutable Ledger: SettlementBatch, SettlementItem, SettlementAdjustment
========================================================================================
                                      ↓
========================================================================================
[6. PAYMENT & RECONCILIATION LAYER (DOWNSTREAM / OUT OF SCOPE)]
- PaymentInstruction & PaymentExecution (Schema Only in V1)
- ReconciliationRun & ReconciliationIssue (Schema Only in V1)
========================================================================================
```

### Module Authority & Data Ownership
| Data Domain | Authoritative Module | Authoritative Model | Consumer Modules |
| :--- | :--- | :--- | :--- |
| **Call Lifecycle & State** | `TelephonyModule` / `CallsModule` | `Call`, `CallAttempt` | Commercial, Billing, Reports |
| **Operational Wallet Ledger**| `BillingModule` | `WalletTransaction`, `CallReservation` | Commercial, Telephony |
| **Commercial Economics** | `CommercialModule` | `CallCommercial`, `CallFinancialAdjustment` | Reports, Settlement, Calls UI |
| **Disputes** | `CommercialModule` | `CallDispute` | Settlement, Calls UI |
| **Settlement Batches** | `SettlementModule` | `SettlementBatch`, `SettlementItem` | Financial Export, Payouts |

---

## 9. Call Lifecycle Contract

1. **Pre-Commercial State Machine:** The operational call lifecycle (`INITIATED -> ROUTING -> BRIDGED -> COMPLETED / FAILED`) remains the sole authority for call progression.
2. **Terminal Event Trigger:** Commercial evaluation must trigger **only** after:
   - `call.state == CallState.COMPLETED`.
   - `walletService.settleReservation` has finished execution.
3. **Non-Eligible Calls:** Calls terminating in `NO_ANSWER`, `BUSY`, `FAILED`, or `CANCELED` must not undergo commercial evaluation.
4. **Fault Boundary:** Commercial evaluation must execute within a protected error boundary (`.catch()` or isolated worker). An evaluation failure must be logged as a critical error, but must **never roll back call completion or disrupt carrier webhooks**.
5. **Campaign Configuration Guard:** If a campaign lacks explicit commercial configuration (`default_revenue_amount == null` or `default_payout_amount == null`), the evaluator must gracefully exit without creating a `CallCommercial` record.

---

## 10. Commercial Lifecycle Contract

1. **Record Immutability:** Once created, financial snapshots in `CallCommercial` (`revenue`, `payout`, `cost`, `profit`, `currency`) are immutable, except via explicit dispute adjustment.
2. **Idempotency Guarantee:** Exactly one `CallCommercial` record may exist per `call_id` (`@unique (call_id)`). Duplicate attempts must return the existing record.
3. **Dispute Lifecycle:**
   - Filing a dispute transitions `CallDispute` to `PENDING`.
   - Dispute rejection leaves `CallCommercial` intact and sets dispute to `REJECTED`.
   - Dispute acceptance sets dispute to `ACCEPTED`, creates an immutable `CallFinancialAdjustment`, sets `revenue = 0.0000`, `payout = 0.0000`, `profit = -cost`, and updates status to `ADJUSTED`.
4. **Finalization Immutability:** A record in `FINAL` or `ADJUSTED` status must never be re-evaluated by `CommercialEvaluatorService`.

---

## 11. Reporting Source-of-Truth Contract

1. **Authoritative Economic Source:** [`CallCommercial`](file:///C:/Projects/callflow-agent-a/apps/api/prisma/schema.prisma) is the **sole authoritative source of truth** for historical commercial metrics.
2. **Prohibition on Operational Recalculation:** Reporting queries must **never** recalculate revenue, payout, cost, or profit on-the-fly from mutable operational `Call` or `Campaign` rates when aggregating commercial statistics.
3. **Operational vs Commercial Separation:**
   - Operational Metrics (`total`, `answered`, `missed`, `failed`, `blocked`, `duration`, `tclSecs`, `aclSecs`) originate from table `calls`.
   - Commercial Metrics (`revenue`, `payout`, `cost`, `profit`, `converted`, `qualified`, `duplicate`, `conversionRate`) originate from table `call_commercials`.
4. **Null Handling for Non-Commercial Calls:** Calls without a `CallCommercial` record (historical calls or unconfigured campaigns) must contribute to operational counts while safely resolving commercial metrics to zero (`0.0000` / `0`) via `LEFT JOIN` and `COALESCE`.
5. **Participant Sanitization:**
   - Buyer reporting views must strictly omit vendor names, carrier costs, and platform profits.
   - Vendor reporting views must strictly omit buyer names, revenues, carrier costs, and platform profits.

---

## 12. Settlement Contract

1. **Strict Downstream Dependency:** Settlement generation must consume only finalized commercial records (`status: FINAL` and `finalizes_at <= NOW()`).
2. **Input Period Semantics:** Must enforce the half-open interval `[period_start, period_end)`:
   - `period_start`: Inclusive (`finalizes_at >= period_start`).
   - `period_end`: Exclusive (`finalizes_at < period_end`).
3. **Explicit Boundary Input:** The settlement generator must require caller-specified `period_start` and `period_end`. No implicit date defaulting is permitted.
4. **Zero-Amount Exclusion:**
   - Buyer settlement batches include only records where `revenue > 0`.
   - Vendor settlement batches include only records where `payout > 0`.
5. **Dispute Safety:** Calls with pending disputes are excluded from settlement batches.
6. **COMM-13B Composite Uniqueness:** Settlement items must enforce uniqueness on `(call_commercial_id, participant_type)`. Batch generation must be idempotent; re-running batch generation over the same period must not duplicate items.
7. **Monetary Decimal Precision:** All batch totals (`gross_amount`, `adjustments_amount`, `net_amount`) must maintain `Decimal(12, 4)` precision.

---

## 13. Payment / Reconciliation Boundary

1. **Downstream Isolation:** Models `PaymentInstruction`, `PaymentExecution`, `ReconciliationRun`, and `ReconciliationIssue` are strictly **schema-level foundations**.
2. **Exclusion from Current Integration:** No payment execution logic, Stripe/banking provider integrations, automated payouts, or ledger reconciliation jobs may be implemented during the commercial integration phase.
3. **Classification:** **OUT OF SCOPE.**

---

## 14. Database / Migration Contract

1. **Sequential Migration Append:** The 5 commercial migrations from `59da9de` must cleanly append to the operational migration chain without renumbering or timestamp collisions:
   - `20261007000000_comm_3_pay_per_call_schema`
   - `20261007000001_harden_call_commercial_restrict_fk`
   - `20261007000002_add_currency_to_call_commercials`
   - `20261008000000_comm13_settlement_schema`
   - `20261008000001_comm13b_settlement_item_side`
2. **Foreign Key Integrity:**
   - `call_commercials.call_id -> calls.id` must use `ON DELETE RESTRICT` (protecting commercial history from call deletion).
   - `call_commercials.duplicate_of_call_id -> calls.id` uses `ON DELETE SET NULL`.
   - All tenant foreign keys (`workspace_id`) must use `ON DELETE CASCADE`.
3. **No Destructive Operations:** The migrations add tables, enums, and nullable columns with defaults. No operational data is destroyed or altered.

---

## 15. Historical Data Contract

1. **No Automatic Backfill:** Historical calls completed prior to commercial activation **will not be backfilled** into `call_commercials`.
2. **Safe Coexistence:** Historical calls safely coexist with commercial calls. Reporting queries must use `LEFT JOIN` to gracefully handle calls lacking commercial records.
3. **Backfill Governance:** Any historical backfill requires an explicit, separate architecture specification and approval process.
4. **Classification:** **OUT OF SCOPE.**

---

## 16. Production Safety Contract

The eventual integration and deployment must satisfy the following safety guarantees:
1. **Zero Data Loss:** Existing tables (`calls`, `buyers`, `vendors`, `campaigns`, `workspaces`, `wallet_transactions`) must remain intact.
2. **Ledger Truth Preservation:** Historical `wallet_transactions` must never be altered or retroactively generated.
3. **Tenant & Participant Boundary Integrity:** No API or reporting query may leak economics across workspaces or between participants (Buyer/Vendor).
4. **Zero Downtime Migration:** Schema additions are purely additive and backward-compatible with the operational backend.

---

## 17. Hard-Stop Rules

Any future implementation agent **MUST IMMEDIATELY HALT** and seek architectural guidance if:

1. A frozen COMM business rule (FR-01 through FR-12) requires alteration.
2. The valuation formula (`profit = revenue - payout - cost`) is proposed to change.
3. The qualification, conversion, or duplicate detection criteria are modified.
4. The 168-hour finalization grace period is proposed to change.
5. Settlement period semantics are modified from `[period_start, period_end)`.
6. The `(call_commercial_id, participant_type)` settlement item uniqueness constraint is compromised.
7. Foreign exchange (FX) conversion is introduced into commercial or settlement calculations.
8. Unapproved historical data backfill is initiated.
9. A parallel authorization framework is introduced instead of extending existing RBAC.
10. Fake `$0.00` ledger transactions are inserted into `wallet_transactions`.
11. Payment provider integrations or reconciliation execution engines are introduced prematurely.
12. A destructive schema migration is proposed.
13. Operational call routing or carrier webhook handling is fundamentally restructured.

---

## 18. Open Architecture Decisions

The following architectural decisions are explicitly open and require formal approval prior to implementation:

| Decision ID | Summary | Options Under Consideration | Recommended Governance |
| :--- | :--- | :--- | :--- |
| **OAD-01** | `finalizes_at` population mechanism | (A) At call evaluation (`created_at + 168h`)<br>(B) Background worker | Formalize in Decision A implementation plan. |
| **OAD-02** | `PENDING -> FINAL` transition engine | (A) In-process periodic polling timer<br>(B) Just-in-time during settlement query<br>(C) Explicit API | Align with existing CallFlow polling patterns (`ReservationRecoveryService`). |
| **OAD-03** | Zero-cost evaluation trigger | (A) Evaluate when `callReservation.status == SETTLED`<br>(B) Pass actualCost explicitly from controller | Require cost verification without fake wallet debits. |
| **OAD-04** | Commercial & Settlement RBAC keys | Formalize permissions in `permissions.constants.ts` (`commercial:read`, `dispute:manage`, `settlement:generate`) | Integrate into native `PermissionsGuard` architecture. |
| **OAD-05** | Settlement API Surface | Introduce `SettlementController` with Owner/Admin guarded endpoints | Required to expose settlement generation to users/admins. |
| **OAD-06** | Frontend Dispute Filing & Settlement UI | Scope and design UI components for settlement generation and dispute submission | Future frontend phase. |

---

## 19. Implementation Constraints

1. **No Package Duplication:** No new external queue libraries (e.g., BullMQ, Redis) may be added without explicit approval; native NestJS / PostgreSQL patterns must be prioritized.
2. **Decimal Precision:** All financial calculations must strictly use `Prisma.Decimal` or database-native `numeric(12, 4)`. Floating-point arithmetic is prohibited.
3. **Strict TypeScript Typing:** All DTOs, parameters, and query returns must maintain complete type safety.
4. **Test Coverage Requirement:** Every new service, controller, and query addition must be accompanied by unit specs and e2e integration tests.

---

## 20. Acceptance Criteria

The integration implementation phase will be considered successful only when:

- [ ] All 21 commercial commits from `59da9de` are integrated cleanly into the operational branch.
- [ ] Migrations `20261007000000` through `20261008000001` apply cleanly against a fresh and existing database.
- [ ] `CommercialEvaluatorService` executes post-hangup and successfully evaluates both positive-cost and zero-cost completed calls.
- [ ] `CallCommercial.finalizes_at` is populated deterministically for all evaluated calls.
- [ ] Organic production calls transition to `status: FINAL` once `NOW() >= finalizes_at` without active disputes.
- [ ] `SettlementBatchService` successfully processes organic calls that have matured to `FINAL`.
- [ ] Settlement items strictly maintain composite uniqueness `(call_commercial_id, participant_type)`.
- [ ] Commercial dispute and settlement operations are fully protected by native CallFlow RBAC permissions.
- [ ] Existing operational unit and e2e tests continue to pass without regression.
- [ ] No fake wallet transactions exist in `wallet_transactions`.

---

## 21. Forensic Evidence / Source References

| Domain / Finding | Relevant File Path | Relevant Symbol / Function | Commit SHA |
| :--- | :--- | :--- | :--- |
| **Operational HEAD** | Git Repository Trunk | Branch `agent/reporting-backend-fix` | `f901302b156c` |
| **Commercial Baseline** | Git Repository Trunk | Branch `agent/commercial-comm14-settlement-generation` | `59da9deba182` |
| **Call Lifecycle Hook** | [`apps/api/src/telephony/call-controller.ts#L390`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/call-controller.ts#L390) | `CallController.handleCallEnded` | `b776b875845b` |
| **Commercial Evaluator** | [`apps/api/src/commercial/commercial-evaluator.service.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/commercial/commercial-evaluator.service.ts) | `CommercialEvaluatorService.evaluateCall` | `8a11579ace8f` |
| **Wallet Settle Cost Check**| [`apps/api/src/billing/wallet.service.ts#L518`](file:///C:/Projects/callflow-agent-a/apps/api/src/billing/wallet.service.ts#L518) | `WalletService.settleReservation` | `f901302b156c` |
| **Settlement Generation** | [`apps/api/src/settlement/settlement-batch.service.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/settlement/settlement-batch.service.ts) | `SettlementBatchService.generateBuyerSettlementBatches` | `6c1a6cd50d67` |
| **Settlement Item Uniqueness**| `apps/api/prisma/migrations/20261008000001_comm13b_settlement_item_side/migration.sql` | `settlement_items_call_commercial_id_participant_type_key` | `559d1e812917` |
| **RBAC Registry** | [`apps/api/src/permissions/permissions.constants.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/permissions/permissions.constants.ts) | `PERMISSIONS_LIST` | `f901302b156c` |
| **Disputes Controller** | [`apps/api/src/commercial/commercial-disputes.controller.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/commercial/commercial-disputes.controller.ts) | `CommercialDisputesController` | `04e5a680312d` |
| **Existing Polling Pattern**| [`apps/api/src/telephony/reservation-recovery.service.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/reservation-recovery.service.ts) | `ReservationRecoveryService` | `f901302b156c` |
| **Reporting Commercial Metrics**| [`apps/api/src/calls/calls.service.ts#L811`](file:///C:/Projects/callflow-agent-a/apps/api/src/calls/calls.service.ts#L811) | `CallsService.getMetrics` | `38a46c8e157e` |

---
*Contract formalized and certified by Architecture Contract Agent — CallFlow Governance.*
