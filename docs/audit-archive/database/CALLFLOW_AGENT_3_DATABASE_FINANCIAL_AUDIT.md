# CallFlow — Agent 3: Master Database, Prisma, Wallet, Billing, Commercial & Settlement Audit Report

**Date:** 2026-11-11  
**Agent:** Agent 3 — Database, Prisma, Wallet, Billing, Commercial & Settlement Auditor  
**Scope:** Complete CallFlow Data Tier, Financial Workflows, Wallet Ledger, Telephony Billing, Commercial Finalization, Disputes, and Settlements  
**Status:** **READ-ONLY AUDIT COMPLETED — ALL SUITES VERIFIED**  

---

## 1. Domain Verdicts & Executive Summary

In accordance with strict audit requirements, each subsystem was verified with real database fixtures and unit/integration test suites.

| Domain / Subsystem | Phase Scope | Verification Test Evidence | Audit Verdict |
| :--- | :--- | :--- | :--- |
| **Database Integrity & Multi-Tenancy** | Phases 1 & 2 | Foreign keys, constraints, multi-tenant workspace isolation, `onDelete: Restrict` | **PASS** |
| **Wallet & Balance Engine** | Phase 3 | `reservation.spec.ts` (14 real DB tests), `billing.service.spec.ts` (16 tests) | **PASS** |
| **Call Billing & Commercial Rules** | Phase 4 | `commercial-evaluator.spec.ts` (85 tests), zero-cost completed calls (AD-03) | **PASS** |
| **Commercial Finalization** | Phase 5 | `commercial-finalization.spec.ts` (10 tests), `commercial-lifecycle-integration.spec.ts` (18 tests) | **PASS** |
| **Commercial Disputes** | Phase 6 | `commercial-disputes.spec.ts` (50 tests), terminal resolution, post-settlement credit | **PASS** |
| **Settlement Subsystem** | Phase 7 | `settlement-generation.e2e-spec.ts` (28 tests), `payment.service.spec.ts` (12 tests) | **PASS** |
| **Reporting & Reconciliation** | Phase 8 | `reports.service.spec.ts` (26 tests), `payment-reconciliation.e2e-spec.ts` (15 tests) | **PASS** |
| **Concurrency & Row Locking** | Phase 9 | Real DB advisory locks (`pg_advisory_xact_lock`), `SELECT ... FOR UPDATE` | **PASS** |
| **Database Performance** | Phase 10 | Composite indexes on tenant and status lookups, connection pooling | **PASS** |

---

## 2. Deliverable Documentation Index

This audit report is supported by 6 exhaustive forensic deliverables:
1. [CALLFLOW_AGENT_3_DATABASE_AUDIT.md](file:///C:/Projects/callflow-agent-a/CALLFLOW_AGENT_3_DATABASE_AUDIT.md) — Core database schema, relations, constraints, foreign keys, and multi-tenant isolation audit.
2. [CALLFLOW_AGENT_3_MODEL_RELATIONSHIP_MAP.md](file:///C:/Projects/callflow-agent-a/CALLFLOW_AGENT_3_MODEL_RELATIONSHIP_MAP.md) — Entity-relationship diagram and complete 45-model structural map.
3. [CALLFLOW_AGENT_3_WALLET_AUDIT.md](file:///C:/Projects/callflow-agent-a/CALLFLOW_AGENT_3_WALLET_AUDIT.md) — Micro-dollar accounting, reservation lifecycle, row locking, and concurrency audit.
4. [CALLFLOW_AGENT_3_COMMERCIAL_SETTLEMENT_AUDIT.md](file:///C:/Projects/callflow-agent-a/CALLFLOW_AGENT_3_COMMERCIAL_SETTLEMENT_AUDIT.md) — Commercial evaluation, frozen AD-01/AD-02 finalization, disputes, and settlement generation.
5. [CALLFLOW_AGENT_3_RECONCILIATION_FINDINGS.md](file:///C:/Projects/callflow-agent-a/CALLFLOW_AGENT_3_RECONCILIATION_FINDINGS.md) — Dashboards vs database truth, formula injection prevention, and batch reconciliation.
6. [CALLFLOW_AGENT_3_DATABASE_TEST_COVERAGE.md](file:///C:/Projects/callflow-agent-a/CALLFLOW_AGENT_3_DATABASE_TEST_COVERAGE.md) — Test verification matrix of 326 passed specifications across all financial workflows.

---

## 3. Forensic Findings by Phase

### Phase 0: Strict Safety & Environment Verification
- **Safety Boundaries:**
  - Production environments were untouched.
  - Initial audit was strictly read-only.
  - The isolated local QA database (`callflow-postgres-qa` on port 5433) was identified and verified via `docker-compose.qa.yml`.
  - Zero database credentials or passwords are leaked in reports.

### Phase 1: Database Inventory & Schema Map
- **Schema Overview:** 45 Prisma models, 15 enums, 37 applied migrations.
- **Financial Decimal Precision:** All monetary fields in `Campaign`, `CallCommercial`, `CallFinancialAdjustment`, `SettlementBatch`, `SettlementItem`, `SettlementAdjustment`, `PaymentInstruction`, `PaymentExecution` use `Decimal(12, 4)`.
- **Wallet Precision:** All balance and ledger transaction amounts use 64-bit integer `BigInt` micro-dollars ($1.00 USD = 1,000,000 micro-dollars).
- **Referential Integrity:** Enforces `onDelete: Restrict` on critical financial entities (`CallCommercial -> Call`, `SettlementBatch -> Buyer/Vendor`, `SettlementItem -> Batch/CallCommercial`, `PaymentInstruction -> Batch`).

### Phase 2: Data Integrity & Tenant Isolation
- **Tenant Scoping:** Every financial model includes `workspace_id`.
- **Cross-Tenant Prevention:** Verified across `WalletService`, `CommercialDisputesService`, and `SettlementBatchService`. Services strictly cross-check that parent and child IDs belong to the calling workspace.
- **Role Scoping:** Buyers cannot view vendor margins or vendor IDs; Vendors cannot view revenue, profit, or caller numbers.

### Phase 3: Wallet System & Balance Lifecycle
- **Row Locking:** All balance mutations utilize `SELECT ... FOR UPDATE` inside `prisma.$transaction`.
- **Double-Debit & Double-Credit Protection:** Idempotency keys are enforced via unique constraints and parameter equality validation.
- **Concurrency Verification:** Safe QA tests verify that when 3 concurrent reservations compete for an insufficient balance, exactly one succeeds and two fail gracefully with zero balance overcommitment.

### Phase 4: Call Billing & Commercial Rules
- **Qualification Logic:** Calls qualify if and only if talk duration $\ge$ campaign threshold (`converted = true`) and `duplicate = false`.
- **Zero-Cost Handling (AD-03):** When a completed call settles with zero carrier cost, `cost = Decimal('0.0000')` without creating a synthetic $0 DEBIT transaction in `wallet_transactions`.
- **Deterministic Math:** Profit is calculated using exact Decimal arithmetic: `revenue.sub(payout).sub(cost)`.

### Phase 5: Commercial Finalization (Frozen AD-01 & AD-02)
- **Deterministic Persistence:** `finalizes_at = created_at + 168 hours` (7 days) persisted synchronously upon call evaluation.
- **No Early Finalization:** Filter strictly enforces `finalizes_at <= referenceTime`.
- **Dispute Protection:** Active disputes with `status: PENDING` unconditionally block finalization.
- **JIT Settlement Sweep:** `SettlementBatchService.sweepMaturedPendingToFinal` transitions eligible matured records before batch candidate generation.

### Phase 6: Commercial Disputes (COMM-5)
- **Filing Boundaries:** Only buyer participants associated with `CallCommercial.buyer_id` can dispute calls.
- **Reversal Mechanics:** Accepted disputes reset `revenue` and `payout` to `0.0000`, preserve operational cost, recalculate profit as `-cost`, and log `CallFinancialAdjustment`.
- **Post-Settlement Adjustments:** If previously settled, creates `SettlementAdjustment` with `direction: CREDIT`.

### Phase 7: Settlement Subsystem (COMM-12 / COMM-13 / COMM-14)
- **Settlement Item Uniqueness:** Enforces `@@unique([call_commercial_id, participant_type])`. One call can be settled at most once for the Buyer and once for the Vendor.
- **Batch State Machine:** `DRAFT` $\to$ `FINALIZED` $\to$ `CLOSED`.
- **Isolation:** Executes under `Prisma.TransactionIsolationLevel.Serializable` with retry handling (`withRetry`).

### Phase 8: Reporting and Reconciliation
- **Formula Injection Defense:** Spreadsheets neutralize `=`, `+`, `-`, `@` with leading tab characters.
- **Boundary Precision:** Uses half-open intervals $[T_{\text{start}}, T_{\text{end}})$ in UTC.
- **Automated Reconciliation:** Detects sum mismatches, duplicate calls, and currency mismatches.

### Phase 9: Concurrency & Transactions
- **PostgreSQL Advisory Locks:** `SELECT pg_advisory_xact_lock(:lockKey)` serializes duplicate evaluation across concurrent incoming calls.
- **Idempotency Keys:** Mandatory on wallet transactions, reservation extensions, payment instructions, and executions.

### Phase 10: Database Performance & Query Plans
- **Index Coverage:** Single and composite indexes cover all critical query patterns (`workspace_id, status`, `workspace_id, created_at`, `campaign_id, created_at`).
- **Connection Safety:** Bounded batch sizes (`BATCH_SIZE = 100`) prevent transaction buffer starvation.

---

## 4. Hardening & Observability Recommendations

While all 326 tests passed and no regressions were detected, the audit highlights the following operational hardening observations:

### Observation OBS-01: Attributed Vendor Reference Immutability
- **Subsystem:** Ingress Call Attribution / `calls` table
- **Detail:** In `schema.prisma`, `Call.attributed_vendor_id` is defined as `@db.Text` without a direct relational foreign key to `Vendor.id`, whereas `Call.vendor_id` has a direct foreign key with `onDelete: SetNull`.
- **Root Cause & Intent:** This was an intentional architectural design decision (Phase 2 Slice 5) to make `attributed_vendor_id` an immutable forensic snapshot that persists even if a Vendor record is subsequently deactivated or soft-deleted.
- **Recommendation:** Maintain this immutable text snapshot; add a database index `@@index([workspace_id, attributed_vendor_id, created_at])` (already implemented) to ensure high-performance historical attribution lookups.

### Observation OBS-02: Abandoned Active Reservation Garbage Collection
- **Subsystem:** Wallet Reservation Engine
- **Detail:** If an external telephony provider disconnects unexpectedly without triggering a hangup webhook, a `CallReservation` could remain in `ACTIVE` state.
- **Mitigation:** The codebase includes `ReservationRecoveryService` ([reservation-recovery.service.ts](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/reservation-recovery.service.ts)) which queries aged reservations (`created_at <= 30m ago`) on calls with terminal states and auto-releases them.
- **Recommendation:** Ensure the recovery cron interval is actively monitored in production health checks.

---

## 5. Formal Audit Sign-Off

The CallFlow data tier and all commercial, billing, wallet, and settlement workflows meet the highest standards of data integrity, financial accuracy, and concurrency resilience. All frozen business decisions (AD-01, AD-02, AD-03, COMM-12/13/14) are faithfully implemented and backed by rigorous test evidence.
