# CALLFLOW — COMM-INTEGRATION-DECISION-FREEZE
## FORMAL RESOLUTION & ARCHITECTURAL FREEZE OF OAD-01 THROUGH OAD-06
### ARCHITECTURE DECISION FREEZE RECORD

---

## 1. Purpose

This document formally and permanently resolves the six Open Architecture Decisions (**OAD-01 through OAD-06**) identified in [`docs/COMM-INTEGRATION-ARCHITECTURE-CONTRACT-DRAFT.md`](file:///C:/Projects/callflow-agent-a/docs/COMM-INTEGRATION-ARCHITECTURE-CONTRACT-DRAFT.md). 

By freezing these architectural decisions, the integration boundary between the frozen commercial subsystem (`COMM-1` through `COMM-14B`) and the active operational CallFlow trunk is completely defined. Subsequent implementation agents are bound by the explicit determinations recorded herein.

This is a **GOVERNANCE & ARCHITECTURE DECISION** document. Zero source code changes, database mutations, or branch operations are executed during this stage.

---

## 2. Baselines

All decisions in this record are established relative to the verified repository states:

- **Active Operational Branch:** [`agent/reporting-backend-fix`](file:///C:/Projects/callflow-agent-a)
- **Active Operational HEAD SHA:** `f901302b156c2779a169b2ceeb27ba7fe0c09be3`
- **Frozen Commercial Branch:** `agent/commercial-comm14-settlement-generation`
- **Frozen Commercial Baseline SHA:** `59da9deba18254da918e60623f440581deb97a53` (short ref `59da9de`)
- **Remote Tracking Reference:** `origin/main` (`a30e81fd78dfe0ce828a4f93f70627fd343003cd`)
- **Governing Architecture Contract:** [`docs/COMM-INTEGRATION-ARCHITECTURE-CONTRACT-DRAFT.md`](file:///C:/Projects/callflow-agent-a/docs/COMM-INTEGRATION-ARCHITECTURE-CONTRACT-DRAFT.md)

---

## 3. Decision Authority

1. **Hierarchy of Truth:**
   - **Level 1 (Highest):** Frozen COMM Business Rules (FR-01 through FR-12). Immutable.
   - **Level 2:** Required Integration Behaviors established in the Integration Contract.
   - **Level 3:** Formal Architectural Decisions frozen in this document (AD-01 through AD-06).
   - **Level 4:** Implementation Details and Code Mechanics (to be executed in the implementation stage).
2. **Mandate:** Implementation agents must adhere strictly to these decisions. No open decision resolved here may be reopened or bypassed without an explicit architectural escalation.

---

## 4. OAD-01 Final Decision — `finalizes_at` Population

### A. Forensic Facts
- In [`CommercialEvaluatorService.evaluateCall`](file:///C:/Projects/callflow-agent-a/apps/api/src/commercial/commercial-evaluator.service.ts#L206), `CallCommercial` is inserted with `finalizes_at: null` and `status: CommercialStatus.PENDING`.
- `created_at` is generated automatically upon database insertion.
- The 168-hour rule (`finalizes_at = created_at + 168 hours`) is a deterministic, static offset from the moment of call commercial creation.
- Deferring `finalizes_at` computation to an asynchronous worker introduces unnecessary race windows, nullable database fields, and processing delays for no functional benefit.

### B. Final Frozen Decision (**AD-01**)
`CallCommercial.finalizes_at` **MUST be populated synchronously at creation time** inside `CommercialEvaluatorService.evaluateCall`.

When persisting a new `CallCommercial` record:
```typescript
const now = new Date();
const finalizesAt = new Date(now.getTime() + 168 * 60 * 60 * 1000); // exactly 168 hours (7 days)

await tx.callCommercial.create({
  data: {
    // ...
    status: CommercialStatus.PENDING,
    finalizes_at: finalizesAt,
    // ...
  },
});
```

### C. Rationale
- **Immediate Determinism:** The finalization maturity deadline is immediately known and immutable from the instant a call completes.
- **Indexable Querying:** Persisting `finalizes_at` immediately allows settlement queries and finalization processors to utilize database indices (`finalizes_at ASC`) without scanning null records.
- **Elimination of Worker Lag:** Eliminates the risk that a background timestamp-populator worker fails or falls behind, leaving records unmaturable.

### D. Alternatives Considered & Rejected
1. *Deferred Population via Background Worker:* Rejected because it introduces dual-state complexity (`null` vs populated `finalizes_at`), requires additional database updates on every record, and creates a failure mode where records never mature if the worker fails.
2. *On-the-Fly Calculation in Settlement Generation:* Rejected because the database schema and query engine require an indexed timestamp column for high-performance period partitioning.

### E. Implementation Constraints
- The 168-hour (604,800-second) offset must not be altered or parameterized per campaign in V1.
- `created_at` and `finalizes_at` must use consistent UTC timestamps.
- **Classification:** **ARCHITECTURE DECISION**.

---

## 5. OAD-02 Final Decision — `PENDING -> FINAL` Transition Engine

### A. Forensic Facts
- CallFlow already contains an established, robust background processing pattern: [`ReservationRecoveryService`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/reservation-recovery.service.ts) and [`WebhooksService`](file:///C:/Projects/callflow-agent-a/apps/api/src/webhooks/webhooks.service.ts) utilize in-process `setInterval` timers with `isProcessing` concurrency guards and batch chunking.
- Settlement generation ([`SettlementBatchService.generateBuyerSettlement`](file:///C:/Projects/callflow-agent-a/apps/api/src/settlement/settlement-batch.service.ts#L184)) queries strictly:
  ```typescript
  where: {
    status: CommercialStatus.FINAL,
    finalizes_at: { not: null, gte: period_start, lt: period_end, lte: now }
  }
  ```
- If records rely solely on manual API calls or settlement generation to finalize, the commercial ledger will display outdated `PENDING` states during operational reporting.

### B. Final Frozen Decision (**AD-02**)
The transition from `PENDING` to `FINAL` **MUST be executed by a dedicated, in-process maturity processor service** (`CommercialFinalizationService`) running a periodic polling batch, **supplemented by a just-in-time (JIT) finalization sweep during settlement batch generation**.

1. **Primary Engine — In-Process Periodic Finalizer (`CommercialFinalizationService`):**
   - Implemented within `CommercialModule`.
   - Runs on an interval (recommended: every 10 minutes) using standard NestJS `OnModuleInit`/`OnModuleDestroy` and `setInterval`.
   - Queries:
     ```typescript
     where: {
       status: CommercialStatus.PENDING,
       finalizes_at: { lte: now },
       dispute: null // or dispute status REJECTED
     }
     ```
   - Updates matching records to `status: CommercialStatus.FINAL` in chunked batches.
2. **Secondary Guard — Settlement Generation Sweep:**
   - Immediately prior to querying `status: CommercialStatus.FINAL` in `SettlementBatchService.generateBuyerSettlement` and `generateVendorSettlement`, execute an inline transactional sweep:
     ```typescript
     await tx.callCommercial.updateMany({
       where: {
         workspace_id,
         status: CommercialStatus.PENDING,
         finalizes_at: { lte: now },
         dispute: null,
       },
       data: { status: CommercialStatus.FINAL },
     });
     ```

### C. Rationale
- **Zero Architectural Divergence:** Perfectly mirrors CallFlow's native `ReservationRecoveryService` pattern without requiring external infrastructure (Redis, BullMQ, system crons).
- **Two-Layer Resilience:** The periodic processor ensures that reporting and call detail UIs reflect true `FINAL` state continuously. The inline settlement sweep guarantees zero race conditions where a freshly matured call is missed because the background timer had not yet ticked.
- **Fault-Tolerant:** If the server restarts, pending matured calls are instantly finalized on the next tick or upon settlement request.

### D. Alternatives Considered & Rejected
1. *Solely Manual Admin Finalization API:* Rejected because requiring manual administrative intervention for every 7-day maturity transition contradicts automated platform operations.
2. *Solely JIT Transition inside Settlement Generation:* Rejected because reporting dashboards and call logs would permanently display `PENDING` for all calls outside settlement generation windows.

### E. Implementation Constraints
- Dispute condition is strict: Calls with an open `CallDispute` (`status == PENDING`) **must never** transition to `FINAL`.
- Transition must update only `status = FINAL` and `updated_at`. Financial fields are strictly immutable.
- Batch operations must be multi-tenant safe and use transactional isolation.
- **Classification:** **ARCHITECTURE DECISION**.

---

## 6. OAD-03 Final Decision — Zero-Cost Call Verification

### A. Forensic Facts
- In [`WalletService.settleReservation`](file:///C:/Projects/callflow-agent-a/apps/api/src/billing/wallet.service.ts#L518), when `actualCostMicro === 0n`:
  - `callReservation.status` is updated to `ReservationStatus.SETTLED`.
  - `workspaceBalance.reserved_micro` is released.
  - **No `WalletTransaction` is created**.
- In [`CommercialEvaluatorService.evaluateCall`](file:///C:/Projects/callflow-agent-a/apps/api/src/commercial/commercial-evaluator.service.ts#L183), the evaluator currently checks:
  ```typescript
  const settlementTx = await tx.walletTransaction.findFirst({
    where: { reference_type: 'CALL_SETTLEMENT', reference_id: call.id, type: TransactionType.DEBIT },
    select: { amount_micro: true },
  });
  if (!settlementTx) { ... return null; }
  ```
- Telephony cost and commercial economics are distinct concerns. A call may legitimately incur `$0.00` carrier usage (e.g., zero carrier rate, minimum billing threshold unreached, test provider) while still generating substantial customer revenue (e.g., `$50.00`) and vendor payout (e.g., `$35.00`).

### B. Final Frozen Decision (**AD-03**)
`CommercialEvaluatorService` **MUST inspect the reservation state (`CallReservation.status === 'SETTLED'`) as the definitive signal of operational settlement completion**.

Cost resolution logic inside `CommercialEvaluatorService.evaluateCall` is frozen as follows:

```typescript
// 1. Verify operational wallet settlement has completed
const reservation = await tx.callReservation.findUnique({
  where: { call_id: call.id },
  select: { status: true },
});

if (!reservation || reservation.status !== ReservationStatus.SETTLED) {
  this.logger.debug(
    `Commercial evaluation deferred: Call ${call.id} reservation is not yet SETTLED.`,
  );
  return null;
}

// 2. Authoritative operational cost resolution
const settlementTx = await tx.walletTransaction.findFirst({
  where: {
    workspace_id: call.workspace_id,
    reference_type: 'CALL_SETTLEMENT',
    reference_id: call.id,
    type: TransactionType.DEBIT,
  },
  select: { amount_micro: true },
});

// If a debit transaction exists, derive exact cost. If settled with no debit, cost is strictly 0.0000.
const cost = settlementTx
  ? new Prisma.Decimal(settlementTx.amount_micro.toString()).div(1_000_000)
  : new Prisma.Decimal('0.0000');

// 3. Profit calculation remains immutable: profit = revenue - payout - cost
const profit = revenue.sub(payout).sub(cost);
```

### C. Rationale
- **Preserves Wallet Integrity:** No synthetic or fake `$0.00` ledger transactions are inserted into `wallet_transactions`. Operational debits reflect actual money movement only.
- **Accurate Platform Economics:** Legitimate zero-cost calls are properly captured in `CallCommercial` with `cost = Decimal('0.0000')` and accurate `profit`.
- **Prevents Premature Evaluation:** Verifying `reservation.status === 'SETTLED'` ensures commercial evaluation cannot run while a call's wallet settlement is still pending in-flight.

### D. Alternatives Considered & Rejected
1. *Manufacturing a Fake $0.00 `WalletTransaction`:* Strongly rejected. Violates double-entry accounting integrity and creates database clutter.
2. *Passing Cost Explicitly via Controller Argument:* Rejected because `CommercialEvaluatorService` must remain idempotent and capable of evaluating calls independently from database truth without relying on transient in-memory parameters.

### E. Implementation Constraints
- `actualCostMicro > 0` must always be backed by the authoritative `wallet_transactions` record.
- If reservation is `ACTIVE`, `RELEASED`, or `EXPIRED`, commercial evaluation must not persist a record.
- **Classification:** **ARCHITECTURE DECISION**.

---

## 7. OAD-04 Final Decision — RBAC Permission Model

### A. Forensic Facts
- The operational permission registry is defined in [`PERMISSIONS_LIST`](file:///C:/Projects/callflow-agent-a/apps/api/src/permissions/permissions.constants.ts).
- All permissions follow the canonical format: `resource:action` (e.g., `call:read`, `report:export`, `billing:manage`).
- Operational permission seeding uses `prisma.permission.upsert` during module initialization.
- [`WorkspaceMember`](file:///C:/Projects/callflow-agent-a/apps/api/prisma/schema.prisma) supports `role` (`OWNER`, `ADMIN`, `MEMBER`), `participant_type` (`WORKSPACE`, `BUYER`, `VENDOR`), `buyer_id`, and `vendor_id`.

### B. Final Frozen Decision (**AD-04**)
Commercial and settlement permissions **MUST be registered in CallFlow's native permission registry** under the canonical `resource:action` structure.

#### 1. Exact New Permissions to Register
The following six permissions are formally frozen for addition to `PERMISSIONS_LIST`:

| Permission Key | Group | Description | Included in `ADMIN_BASELINE_PERMISSIONS`? |
| :--- | :--- | :--- | :--- |
| **`commercial:read`** | `COMMERCIAL` | View commercial economics, margins, and call revenue. | **YES** |
| **`commercial:export`** | `COMMERCIAL` | Export commercial financial reports. | **YES** |
| **`dispute:create`** | `COMMERCIAL` | File a commercial dispute on an eligible call. | **YES** |
| **`dispute:manage`** | `COMMERCIAL` | Accept, reject, or resolve buyer commercial disputes. | **YES** |
| **`settlement:read`** | `SETTLEMENT` | View settlement batches and line items. | **YES** |
| **`settlement:generate`** | `SETTLEMENT` | Execute settlement batch generation for a period. | **NO (OWNER ONLY)** |

#### 2. Role Baselines & Owner-Only Restrictions
- **`OWNER`:** Possesses all permissions with `scope_type: ALL`. Exclusive authority to invoke `settlement:generate`.
- **`ADMIN`:** Receives all baseline permissions including `commercial:read`, `commercial:export`, `dispute:create`, `dispute:manage`, and `settlement:read`. Restricted from generating settlement batches unless explicitly granted.
- **`MEMBER`:** Access governed strictly by assigned permissions and participant scoping.

#### 3. Participant Scoping Rules
- **Buyer Scoping (`participant_type === 'BUYER'`):**
  - Restricted to data matching their `member.buyer_id`.
  - Permitted to file disputes on their calls via `dispute:create`.
  - Financial sanitization: Must **never** see `payout`, carrier `cost`, platform `profit`, or `vendor_id`.
- **Vendor Scoping (`participant_type === 'VENDOR'`):**
  - Restricted to data matching their `member.vendor_id`.
  - Permitted to view their payout data via `commercial:read` and `settlement:read`.
  - Financial sanitization: Must **never** see `revenue`, carrier `cost`, platform `profit`, or `buyer_id`.
  - Dispute restriction: Strictly **forbidden** from viewing or creating disputes.

### C. Rationale
- Completely adheres to CallFlow’s existing RBAC architecture.
- Protects financial liabilities by restricting `settlement:generate` to the workspace Owner.
- Guarantees strict participant isolation.

### D. Implementation Constraints
- Updates [`permissions.constants.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/permissions/permissions.constants.ts) cleanly without breaking existing baseline lists.
- Commercial controllers must use [`PermissionsGuard`](file:///C:/Projects/callflow-agent-a/apps/api/src/authorization/permissions.guard.ts) and `@RequirePermission(...)`.
- **Classification:** **ARCHITECTURE DECISION**.

---

## 8. OAD-05 Final Decision — Settlement API Surface

### A. Forensic Facts
- [`SettlementModule`](file:///C:/Projects/callflow-agent-a/apps/api/src/settlement/settlement.module.ts) on branch `59da9de` provides [`SettlementBatchService`](file:///C:/Projects/callflow-agent-a/apps/api/src/settlement/settlement-batch.service.ts), but **contains zero controllers or endpoints**.
- `SettlementBatchService` methods:
  - `generateBuyerSettlement(options: GenerateSettlementOptions): Promise<SettlementGenerationSummary>`
  - `generateVendorSettlement(options: GenerateSettlementOptions): Promise<SettlementGenerationSummary>`
- Period input is frozen as `[period_start, period_end)` with caller-provided boundaries and no automatic cadence.

### B. Final Frozen Decision (**AD-05**)
A dedicated **`SettlementController`** must be introduced in `apps/api/src/settlement/settlement.controller.ts` exposing generation, listing, and inspection endpoints.

#### 1. Route Specifications
- **Base Route:** `/workspaces/:workspaceId/settlements`
- **Controller Guards:** `@UseGuards(JwtAuthGuard, PermissionsGuard)`

| Method | Endpoint | Required Permission | Required Role | Summary |
| :--- | :--- | :--- | :--- | :--- |
| **`POST`** | `/batches/generate` | `settlement:generate` | `OWNER` | Generate settlement batches for period. |
| **`GET`** | `/batches` | `settlement:read` | `OWNER`, `ADMIN`, `MEMBER` | List settlement batches with pagination. |
| **`GET`** | `/batches/:batchId` | `settlement:read` | `OWNER`, `ADMIN`, `MEMBER` | Get settlement batch summary by ID. |
| **`GET`** | `/batches/:batchId/items` | `settlement:read` | `OWNER`, `ADMIN`, `MEMBER` | List line items within a settlement batch. |

#### 2. DTO Specifications
```typescript
export class GenerateSettlementBatchDto {
  @IsEnum(SettlementParticipantType)
  participant_type: SettlementParticipantType; // 'BUYER' | 'VENDOR'

  @IsDateString()
  period_start: string; // ISO-8601 (inclusive)

  @IsDateString()
  period_end: string; // ISO-8601 (exclusive)

  @IsOptional()
  @IsString()
  buyer_id?: string;

  @IsOptional()
  @IsString()
  vendor_id?: string;
}
```

#### 3. Controller Architecture
- Buyer and Vendor batch generation **share the single unified controller** route (`/batches/generate`), branching internally to `generateBuyerSettlement` or `generateVendorSettlement` based on `participant_type`.
- List and detail endpoints enforce participant scoping: Buyer members can only query batches where `buyer_id == member.buyer_id`; Vendor members can only query batches where `vendor_id == member.vendor_id`.

### C. Rationale
- Provides a clean, RESTful API contract for settlement generation.
- Unifies Buyer and Vendor generation under a single cohesive controller while preserving participant-specific isolation.
- Avoids code duplication across controllers.

### D. Implementation Constraints
- Payment execution endpoints (`/execute-payment`) are **STRICTLY PROHIBITED**.
- Period parameters must be strictly validated (`period_start < period_end`).
- **Classification:** **ARCHITECTURE DECISION**.

---

## 9. OAD-06 Final Decision — Frontend Sequencing & Phasing

### A. Forensic Facts
- The backend settlement and commercial systems must be fully operational and tested before user-facing interfaces can be built.
- Dispute management UI is a prerequisite for operational settlement workflows (disputes block finalization and settlement).
- Settlement UI requires the backend API surface established in OAD-05.

### B. Final Frozen Decision (**AD-06**)
Frontend implementation must follow a strict, sequential dependency-ordered roadmap:

```
[PHASE 1: Core Lifecycle Integration]
- Merge/integrate commercial baseline into operational branch.
- Resolve OAD-01 (finalizes_at) and OAD-03 (zero-cost calls).
- Implement OAD-02 (CommercialFinalizationService).
                       ↓
[PHASE 2: Authorization & Reporting Alignment]
- Implement OAD-04 (Commercial RBAC permissions).
- Integrate commercial reporting backend and KPI dashboard frontend.
                       ↓
[PHASE 3: Settlement API Surface]
- Implement OAD-05 (SettlementController & DTOs).
- Verify end-to-end batch generation via API integration tests.
                       ↓
[PHASE 4: Dispute Management UI]
- Build Buyer Dispute submission modal on Call Details page.
- Build Admin/Owner Dispute resolution workflow in dashboard.
                       ↓
[PHASE 5: Settlement Management UI]
- Build Settlement Batch generation form (period picker, participant selector).
- Build Settlement Batch review, line item breakdown, and export UI.
                       ↓
[PHASE 6: Vendor Management UI & Portal]
- Build Vendor Management admin dashboard.
- Build scoped Vendor Portal view.
                       ↓
[DEFERRED / FUTURE STAGE]
- Payment execution UI (Stripe/ACH) and banking reconciliation screens.
```

### C. Rationale
- **Prevents Dead Ends:** Dispute UI is constructed *before* Settlement UI so administrators can resolve disputes prior to running financial batches.
- **Backend-First Stability:** No UI phase begins until its backing API contracts and permission gates are verified with e2e tests.
- **Classification:** **ARCHITECTURE DECISION**.

---

## 10. Dependency Graph

```
+-------------------------------------------------------------+
| OAD-01: Synchronous finalizes_at at Call Creation           |
| (Determines exact maturity timestamp: created_at + 168h)    |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| OAD-02: CommercialFinalizationService + JIT Settlement Sweep|
| (Monitors finalizes_at <= NOW(), transitions PENDING->FINAL)|
+-------------------------------------------------------------+
                              ^
                              |
+-------------------------------------------------------------+
| OAD-03: Zero-Cost Call Verification via Reservation SETTLED |
| (Ensures zero-cost calls enter CallCommercial ledger safely)|
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| OAD-04: Commercial & Settlement RBAC Alignment              |
| (Defines permission keys, guards, and participant scoping)  |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| OAD-05: SettlementController API Surface                    |
| (Exposes generate, list, and item endpoints with RBAC)      |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| OAD-06: Sequential Frontend Phasing (Phases 1 through 6)    |
+-------------------------------------------------------------+
```

---

## 11. Frozen Integration Constraints

Any implementation agent must respect the following unchangeable constraints:

1. **FR-01 (Valuation):** `profit = revenue - payout - cost` (Prisma Decimal 12,4).
2. **FR-02 & FR-03 (Qualification/Conversion):** V1 `qualified = converted`; `converted = durationSecs >= campaign.conversion_duration_secs`.
3. **FR-04 (Duplicates):** Deterministic matching within `duplicate_window_secs`. Earliest prior call wins.
4. **FR-06 & FR-07 (Maturity & Settlement Eligibility):** Grace period is exactly 168 hours. Eligibility requires `status == FINAL`, `finalizes_at <= NOW()`, and no pending dispute.
5. **FR-08 (Period Boundaries):** Settlement interval is strictly half-open: `[period_start, period_end)`.
6. **FR-09 (Settlement Item Uniqueness):** Composite uniqueness `(call_commercial_id, participant_type)` is invariant.
7. **No Fake Ledger Entries:** Never create fake `$0.00` wallet transactions.
8. **No FX:** Single currency per batch. Mixed currencies throw error.
9. **No Historical Backfill:** Existing historical calls remain non-commercial.
10. **Additive Migrations:** The 5 migrations (`20261007000000` to `20261008000001`) must append cleanly without alterations.

---

## 12. Deferred / Out-of-Scope Items

The following domains are explicitly deferred and **MUST NOT** be implemented during this phase:

1. **Payment Execution Engine:** Models `PaymentInstruction` and `PaymentExecution` remain schema-only stubs. No Stripe Connect, banking API, or automated payout workers.
2. **Reconciliation Engine:** Models `ReconciliationRun` and `ReconciliationIssue` remain schema-only stubs. No bank statement parsing or automated discrepancy resolution.
3. **Vendor Minimum Payout Thresholds / Escrow / Holdbacks:** Not supported in V1 settlement generation.
4. **Multi-Currency FX Conversion:** Multi-currency settlements remain unsupported.
5. **Historical Call Backfill:** Backfilling historical completed calls is strictly out of scope.

---

## 13. Hard-Stop Conditions

An implementation agent **MUST CEASE EXECUTION IMMEDIATELY** and notify governance if:

1. Any frozen COMM rule (FR-01 through FR-12) cannot be satisfied without code alterations.
2. A database migration requires modifying an existing operational table column destructively.
3. A proposal arises to inject synthetic `$0.00` entries into `wallet_transactions`.
4. The 168-hour grace period duration is altered.
5. A secondary, parallel RBAC framework is proposed instead of extending `PermissionsGuard`.
6. Settlement batch generation is altered to calculate payouts dynamically instead of using `CallCommercial`.
7. An unapproved payment gateway or banking client is introduced.

---

## 14. Implementation Sequencing Recommendation

To execute this architecture cleanly, the implementation phase should proceed in three distinct engineering pull requests / stages:

- **Stage 1 (Backend Core & Lifecycle Fixes):**
  - Integrate Git commits from `59da9de`.
  - Apply Prisma migrations `20261007000000` through `20261008000001`.
  - Apply AD-01 (synchronous `finalizes_at` in `CommercialEvaluatorService`).
  - Apply AD-03 (zero-cost call handling via reservation `SETTLED`).
  - Implement AD-02 (`CommercialFinalizationService` polling loop + JIT settlement sweep).
  - Verify with unit tests.
- **Stage 2 (RBAC & Settlement API):**
  - Register AD-04 permissions in `permissions.constants.ts`.
  - Refactor `CommercialDisputesController` to use `PermissionsGuard`.
  - Implement AD-05 (`SettlementController` with generate, list, detail, and items routes).
  - Verify with e2e API tests.
- **Stage 3 (Frontend Integration):**
  - Execute Phase 2 (Commercial KPIs in Reporting).
  - Execute Phase 4 (Dispute Management UI).
  - Execute Phase 5 (Settlement Batch Generation UI).
  - Execute Phase 6 (Vendor UI).

---
*Decision Freeze formally recorded and certified by Architecture Decision Freeze Agent — CallFlow Governance.*
