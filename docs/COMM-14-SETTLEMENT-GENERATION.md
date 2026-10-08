# COMM-14 — Settlement Eligibility & Batch Generation Architecture & Contract

## 1. Executive Summary

This document specifies the authoritative settlement eligibility and batch generation architecture implemented in COMM-14 and formalizes the **V1 Settlement Period Input Contract & Generation Boundary** resolved in COMM-14B.

---

## 2. Core V1 Settlement Period Principle

> **"Settlement periods are explicit generation inputs in V1. Callers provide `period_start` and `period_end`. V1 does not define an automatic daily, weekly, monthly, rolling, or workspace-configured settlement cadence."**

### Authoritative Architecture Foundations
1. **COMM-10 § 5 & § 26**:
   - A settlement period represents a defined time boundary evaluated in UTC.
   - Mentions of cadences (e.g., Weekly Mon–Sun, Daily, Bi-weekly, Net-30) are illustrative business examples (`e.g.`), not an automated system algorithm.
   - **Asymmetric Cadence**: Buyer billing cadence and Vendor payout cadence are completely independent.
2. **COMM-11 § 3 & § 4**:
   - The 7-day (168-hour) grace period (`finalizes_at = created_at + 168 hours`) is strictly a **commercial finalization maturity rule**, NOT a settlement accounting period rule.
   - Payout threshold rules and rolling reserves/holdbacks are deferred in V1.
3. **COMM-12 § 5**:
   - In V1, recurring automated crons are not implemented. Batches are generated for specific date ranges.
   - Period boundaries are embedded directly into `SettlementBatch` via `period_start` and `period_end` timestamps (UTC canonical).
   - Dedicated `SettlementPeriod` configuration tables or recurring cron jobs are deferred to future schedule stages.

---

## 3. Period Input Contract & Validation Rules

Settlement batch generation requires explicit caller-supplied boundaries:
- `period_start`: Timestamp (UTC Canonical)
- `period_end`: Timestamp (UTC Canonical)

### Validation Rules
1. **Required Parameters**: Both `period_start` and `period_end` must be provided. Missing boundaries throw a `BadRequestException` (`period_start and period_end are required`).
2. **Strict Chronological Ordering**: `period_start < period_end`. If `period_start >= period_end`, the request is rejected with a `BadRequestException` (`period_start must be strictly before period_end`).
3. **No Boundary Defaulting or Mutation**: The service MUST NOT silently replace, shift, round, or default supplied boundaries to today, yesterday, current week, or rolling windows. The exact input timestamps are validated and persisted onto `SettlementBatch.period_start` and `SettlementBatch.period_end`.

---

## 4. Eligibility & Generation Boundary Evaluation

Settlement eligibility for a `CallCommercial` record is evaluated against the explicit period using the following criteria:

```sql
CallCommercial.finalizes_at >= :period_start      -- period_start INCLUSIVE
AND CallCommercial.finalizes_at < :period_end      -- period_end EXCLUSIVE
AND CallCommercial.finalizes_at <= NOW()           -- Finalization maturity constraint
AND CallCommercial.status = 'FINAL'               -- Commercially finalized
AND CallCommercial.converted = true               -- Commercial conversion
AND (
      (participant_type = 'BUYER' AND CallCommercial.revenue > 0)
   OR (participant_type = 'VENDOR' AND CallCommercial.payout > 0)
)
AND CallCommercial.id NOT IN (
    SELECT call_commercial_id FROM call_disputes WHERE status = 'PENDING'
)
AND CallCommercial.id NOT IN (
    SELECT call_commercial_id FROM settlement_items WHERE participant_type = :participantType
)
```

### Boundary Semantics
- **`period_start` (Inclusive)**: A call where `finalizes_at == period_start` is **included**. A call finalized even 1ms before `period_start` is **excluded**.
- **`period_end` (Exclusive)**: A call where `finalizes_at == period_end` is **excluded**. A call finalized 1ms before `period_end` is **included**.
- **Maturity Constraint (`finalizes_at <= NOW()`)**: Even if a call's `finalizes_at` falls within the requested period, it is **excluded** if `finalizes_at > NOW()` (unmatured 7-day grace period).

---

## 5. Buyer & Vendor Period Independence

Per COMM-10 § 5 ("Asymmetric Buyer/Vendor Cadence"):
- Buyer billing (Accounts Receivable) and Vendor disbursement (Accounts Payable) are completely decoupled operations.
- `generateBuyerSettlement` and `generateVendorSettlement` accept separate, independent `period_start` and `period_end` arguments.
- A workspace may generate weekly Buyer batches (e.g. `2026-09-01` to `2026-09-08`) and bi-weekly Vendor batches (e.g. `2026-09-01` to `2026-09-15`) without interference or lockstep coupling.

---

## 6. Batch Identity & Partitioning

Settlement batches are partitioned and identified deterministically:
1. **Partition Tuple**: `(workspace_id, participant_type, participant_id, currency, period_start, period_end)`.
2. **Deterministic Batch Numbering**:
   ```
   SB-<PARTICIPANT_TYPE>-<PARTICIPANT_ID_PREFIX>-<CURRENCY>-<YYYYMMDD_START>-<YYYYMMDD_END>
   ```
3. **Single Currency Isolation**: Each batch enforces strict single-currency aggregation. USD and EUR calls for the same participant and period create two distinct batches. No FX conversion.
4. **Participant Isolation**: Buyer and Vendor records never mix. Buyer batches set `vendor_id = null`; Vendor batches set `buyer_id = null`.
5. **No Empty Batches**: If zero eligible calls exist for a partition in the requested period, no batch is created.

---

## 7. Concurrency & Idempotency

1. **Item Uniqueness**: Guaranteed by `@@unique([call_commercial_id, participant_type])` on `SettlementItem` and `createMany({ skipDuplicates: true })`. A single commercial call can yield at most 1 BUYER item and 1 VENDOR item across the entire platform lifecycle.
2. **Batch Idempotency**: Re-running batch generation for the same parameters retrieves the existing batch, performs zero duplicate insertions, and returns the existing batch with `is_existing = true`.
3. **Concurrency Resilience**: Database operations are wrapped in `Serializable` transactions protected by a retry loop with exponential backoff (`withRetry`) to safely absorb concurrent serialization failures (`P2034`, `40001`, `P2002`).

---

## 8. Out-of-Scope in V1 (Non-Implementation)

The following components are strictly outside the V1 contract and are NOT implemented:
- Automated recurring scheduling / cron jobs.
- Dynamic workspace cadence configuration models.
- Dedicated `SettlementPeriod` database table.
- Payment execution and payment gateways.
- `PaymentInstruction` and `PaymentExecution` processing.
- Reconciliation run engines and issue detectors.
- Settlement user interfaces and public settlement APIs.
- Wallets, rollover balances, minimum payout thresholds, and escrow reserves.
