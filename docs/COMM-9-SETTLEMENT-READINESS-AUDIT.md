# COMM-9 — Commercial Settlement / Reconciliation Readiness Audit

## 1. Executive Summary

This audit assesses the readiness of the CallFlow V1 commercial ledger for future settlement, billing reconciliation, and automated vendor payouts. 

The audit evaluated all relevant components established across stages **COMM-3 through COMM-8**, including data structures, transactional boundaries, calculation engines, dispute workflows, reporting integration, and multi-tenant security guarantees.

### Key Conclusions
1. **Source of Truth Integrity**: Every commercial record is an immutable, historical snapshot rooted in `CallCommercial`. No dynamic recalculation from updated campaign rates, phone numbers, or wallet records occurs during reporting or subsequent lookups.
2. **Reconciliation Feasibility**: Buyer revenue, Vendor payout, and CallFlow operational cost are independently reconstructable from persisted decimal figures. The fundamental economic invariant `profit = revenue - payout - cost` is strictly preserved across all states (converted, non-converted, duplicate, accepted dispute, and rejected dispute).
3. **Dispute & Adjustment Ledger**: The dispute flow guarantees exactly one dispute per commercial record, serialized via row-level locking (`FOR UPDATE`). Reversals create explicit, immutable `CallFinancialAdjustment` audit records without mutating historical operational costs.
4. **Clean Settlement Boundary**: The existing architecture provides all primary identities (`workspace_id`, `call_id`, `campaign_id`, `buyer_id`, `vendor_id`, `currency`) required for a future settlement engine to aggregate and generate settlement batches or invoices purely by reading `CallCommercial` without modifying existing financial records.

**Overall Verdict**: **READY FOR FUTURE SETTLEMENT LAYER**. No code changes or schema migrations were required.

---

## 2. Current Commercial Architecture

### Economic Model & Intermediary Flow
CallFlow operates as a platform intermediary connecting vendors and buyers:
```
Vendor (+ Affiliates)
       │ provides inbound call to tracking number
       ▼
    CallFlow (Telephony Routing + Operational Cost + Settlement Ledger)
       │ routes & bridges call to winning destination
       ▼
 Buyer (+ End Purchasers)
```

### Commercial Economics
- **Revenue**: Amount charged to the Buyer for a qualified/converted call.
- **Payout**: Amount owed to the Vendor for delivering the qualified/converted call.
- **Cost**: Authoritative telephony platform usage cost incurred by CallFlow (captured from `CALL_SETTLEMENT` debit transaction).
- **Profit**: Intermediary margin, calculated as:
  $$\text{Profit} = \text{Revenue} - \text{Payout} - \text{Cost}$$

### Lifecycle Sequence
```
Inbound Call
   │
   ├─► Call Hangup (CallState.COMPLETED)
   │      │
   │      ├─► Telephony Settlement (Debit WalletTransaction: reference_type='CALL_SETTLEMENT')
   │      │
   │      └─► Commercial Evaluation (CommercialEvaluatorService.evaluateCall)
   │             │
   │             ├─► Check Idempotency (tx.callCommercial.findUnique)
   │             ├─► Verify Eligibility (CallState.COMPLETED, Campaign Active)
   │             ├─► Resolve Vendor (tracking PhoneNumber.vendor_id)
   │             ├─► Resolve Buyer (winning answered CallAttempt.buyer_id)
   │             ├─► Evaluate Conversion (duration >= campaign.conversion_duration_secs)
   │             ├─► Evaluate Duplicate (normalized caller in duplicate window)
   │             ├─► Resolve Authoritative Cost (CALL_SETTLEMENT amount_micro / 1,000,000)
   │             ├─► Compute Profit (Decimal: revenue - payout - cost)
   │             └─► Persist CallCommercial (status: PENDING)
   │
   └─► Buyer Dispute (CommercialDisputesService)
          │
          ├─► File Dispute (Buyer only, status: PENDING)
          └─► Resolve Dispute (Owner/Admin only, row-lock serialized)
                 ├─► ACCEPTED:
                 │      ├─► Create CallFinancialAdjustment (audit trail)
                 │      ├─► Set revenue = 0.0000, payout = 0.0000
                 │      ├─► Recalculate profit = -cost (cost unchanged)
                 │      └─► Set status = ADJUSTED
                 └─► REJECTED:
                        └─► Set status = REJECTED (financials untouched)
```

---

## 3. Buyer Revenue Reconciliation

### Source of Truth
Buyer revenue is sourced strictly from `CallCommercial.revenue` (stored as `Decimal(12, 4)`).

### Reconciliation Verification
- **Converted Calls**: Captures `campaign.default_revenue_amount` as a snapshot at evaluation time.
- **Non-Converted Calls**: Explicitly evaluated as `0.0000`.
- **Accepted Disputes**: Reversal zeroes revenue (`0.0000`), preserving the original amount in `CallFinancialAdjustment.original_revenue`.
- **Rejected Disputes**: Revenue remains unchanged at the original snapshot value.
- **Independence from Configuration**: Subsequent alterations to `campaign.default_revenue_amount` or buyer configuration do not alter existing records.
- **Classification Independence**: Duplicate calls that satisfy conversion duration retain their snapshotted revenue in V1.

**Finding**: **PASS**. Buyer revenue is 100% reconstructable from persisted historical commercial records.

---

## 4. Vendor Payout Reconciliation

### Source of Truth
Vendor payout is sourced strictly from `CallCommercial.payout` (stored as `Decimal(12, 4)`).

### Reconciliation Verification
- **Converted Calls**: Captures `campaign.default_payout_amount` as a snapshot at evaluation time.
- **Non-Converted Calls**: Explicitly evaluated as `0.0000`.
- **Accepted Disputes**: Reversal zeroes payout (`0.0000`), preserving the original amount in `CallFinancialAdjustment.original_payout`.
- **Rejected Disputes**: Payout remains unchanged.
- **Independence from Configuration**: Subsequent changes to campaign payout defaults do not mutate historical records.
- **Vendor Attribution Immutability**: Reassigning a tracking phone number to a different vendor does not alter `CallCommercial.vendor_id` on historical calls.

**Finding**: **PASS**. Vendor payout is 100% reconstructable and tied to immutable vendor ownership.

---

## 5. Cost Reconciliation

### Source of Truth
Operational cost is sourced strictly from `CallCommercial.cost` (stored as `Decimal(12, 4)`).

### Reconciliation Verification
- **Authoritative Ingestion**: Derived directly from the `CALL_SETTLEMENT` debit transaction (`amount_micro / 1_000_000`).
- **Fail-Safe Missing Cost**: If no settlement transaction exists for a completed call, `CommercialEvaluatorService` logs an error and aborts commercial persistence (`return null`). It never assumes or defaults missing operational costs to zero.
- **Dispute Invariance**: Disputing a call reverses commercial revenue and payout but leaves CallFlow operational cost intact. The cost incurred for carrier minutes remains tracked and audited.
- **Immutability**: Costs are permanently snapshotted in `call_commercials` and are never dynamically recomputed from raw usage records.

**Finding**: **PASS**. Operational cost is strictly persisted and protected from silent zeroing.

---

## 6. Profit Reconciliation

### Invariant
$$\text{profit} = \text{revenue} - \text{payout} - \text{cost}$$

### Verification by Scenario
1. **Normal Converted Call**:
   - $\text{revenue} = R$
   - $\text{payout} = P$
   - $\text{cost} = C$
   - $\text{profit} = R - P - C$
2. **Normal Non-Converted Call**:
   - $\text{revenue} = 0.0000$
   - $\text{payout} = 0.0000$
   - $\text{cost} = C$
   - $\text{profit} = 0 - 0 - C = -C$
3. **Duplicate Converted Call**:
   - Follows persisted revenue and payout; duplicate flag is purely a classification dimension in V1.
   - $\text{profit} = R - P - C$
4. **Rejected Dispute**:
   - Financials untouched; invariant holds identically to pre-dispute state.
5. **Accepted Dispute**:
   - $\text{revenue} = 0.0000$
   - $\text{payout} = 0.0000$
   - $\text{cost} = C$ (unchanged)
   - $\text{profit} = 0 - 0 - C = -C$
   - `CallCommercial.status = ADJUSTED`

All arithmetic uses `Prisma.Decimal` to prevent IEEE 754 floating-point drift.

**Finding**: **PASS**. The profit invariant holds under all states and operations.

---

## 7. Currency Reconciliation

### Currency Model
- `CallCommercial.currency` is a non-null historical string snapshot copied from `Campaign.currency` at evaluation time.
- Changes to `Campaign.currency` after evaluation have no effect on existing `CallCommercial` rows.
- Dispute resolutions and financial adjustments retain original currency.
- Multi-currency reporting guard ensures that aggregations are not silently mixed across incompatible currencies.
- Future settlement systems can partition records using `GROUP BY currency` with zero ambiguity.

**Finding**: **PASS**. Currency consistency is maintained without dynamic recalculation or unsafe mixing.

---

## 8. Dispute & Adjustment Reconciliation

### Audit Architecture
- **Single Dispute Constraint**: `CallDispute.call_commercial_id` has a `@unique` constraint in the schema.
- **Single Adjustment Constraint**: `CallFinancialAdjustment.dispute_id` has a `@unique` constraint in the schema.
- **Concurrency Safety**: `CommercialDisputesService.resolveDispute` acquires an exclusive row-level lock (`SELECT id FROM call_disputes WHERE id = $1 FOR UPDATE`) within the database transaction, preventing race conditions or double-resolutions.
- **Immutable Audit Trail**: `CallFinancialAdjustment` stores:
  - `workspace_id`
  - `call_commercial_id`
  - `dispute_id`
  - `original_revenue`
  - `original_payout`
  - `adjusted_revenue` (`0.0000`)
  - `adjusted_payout` (`0.0000`)
  - `reason`
  - `created_at`
- **Security Audit Logs**: Emits `commercial.dispute.created`, `commercial.dispute.accepted` / `commercial.dispute.rejected`, and `commercial.financial_adjustment.created` to `SecurityAuditLog`.

**Finding**: **PASS**. Dispute and adjustment reconciliation is mathematically sound, fully audited, and concurrency-hardened.

---

## 9. Idempotency & Concurrency

### Protections
1. **Idempotent Evaluation**:
   - Initial check: `tx.callCommercial.findUnique({ where: { call_id } })`. If present, returns existing snapshot immediately.
   - Concurrency guard: Unique constraint `@unique` on `call_commercials.call_id`. Race conditions catch `P2002` error and fetch the winning record.
2. **Dispute Resolution Idempotency**:
   - Resolution is guarded by status check (`status === DisputeStatus.PENDING`).
   - Row-level lock serializes competing resolutions; non-pending resolutions fail with `409 ConflictException`.
   - Unique constraint on `call_financial_adjustments.dispute_id` prevents duplicate adjustment records.

**Finding**: **PASS**. Evaluator and dispute workflows are fully idempotent and concurrency-safe.

---

## 10. Tenant Isolation

### Boundary Controls
- **Primary Foreign Keys**: Every commercial model (`CallCommercial`, `CallDispute`, `CallFinancialAdjustment`) contains a mandatory, non-null `workspace_id`.
- **Query Scoping**: All queries, mutations, aggregations, and dispute resolutions in `CallsService`, `CommercialEvaluatorService`, and `CommercialDisputesService` strictly filter by `workspace_id`.
- **Cross-Tenant Prevention**: Attempting to dispute, resolve, or read commercial records across different workspaces results in `NotFoundException` or `ForbiddenException`.
- **Duplicate Boundary**: Duplicate detection queries are strictly scoped to `workspace_id` and `campaign_id`.

**Finding**: **PASS**. Multi-tenant isolation is enforced at both schema and application levels.

---

## 11. Reporting Consistency

### Verification
- Reporting metrics (`CallsService.getMetrics`) and call listings (`CallsService.getCalls`) read persisted `CallCommercial` rows.
- Operational metrics (`totalCalls`, `converted`, `qualified`, `duplicate`, `conversionRate`) align with underlying commercial flags.
- Financial metrics (`revenue`, `payout`, `cost`, `profit`) represent direct summations of persisted snapshots.
- Adjusted calls contribute `0.0000` revenue, `0.0000` payout, and negative cost to profit in reporting aggregations without double-counting.
- RBAC participant visibility rules (COMM-7) remain active and enforced across all reporting views.

**Finding**: **PASS**. Reporting is fully consistent with the commercial ledger.

---

## 12. Future Settlement Boundary

### Architectural Boundary
A clean separation exists between the current Commercial Ledger and future Settlement layers:

```
┌────────────────────────────────────────────────────────┐
│ CURRENT SYSTEM (COMM-1 to COMM-8)                      │
│ - Call Lifecycle & Recording                           │
│ - Telephony Settlement Cost Deduction                  │
│ - Post-Call Commercial Evaluation & Snapshots          │
│ - Buyer Disputes & Full Financial Adjustments          │
│ - Reporting Aggregation & Participant Visibility       │
└───────────────────────────┬────────────────────────────┘
                            │ (Read Only)
┌───────────────────────────▼────────────────────────────┐
│ FUTURE SYSTEM (Settlement / Reconciliation Engine)     │
│ - Settlement Periods (e.g., Weekly, Monthly)           │
│ - Settlement Batches (Vendor Payout Batch, Buyer Inv)  │
│ - Payout Execution (ACH / Stripe Connect / Wire)       │
│ - Invoicing & Balance Collection                       │
│ - 3-Way Reconciliation Ledger                          │
└────────────────────────────────────────────────────────┘
```

### Readiness Checklist for Future Settlement
| Required Dimension | Present in Current Model? | Location / Field |
| :--- | :--- | :--- |
| Identify Vendor | **YES** | `CallCommercial.vendor_id` |
| Identify Buyer | **YES** | `CallCommercial.buyer_id` |
| Identify Campaign | **YES** | `CallCommercial.campaign_id` |
| Identify Workspace | **YES** | `CallCommercial.workspace_id` |
| Determine Revenue | **YES** | `CallCommercial.revenue` |
| Determine Payout | **YES** | `CallCommercial.payout` |
| Determine Cost | **YES** | `CallCommercial.cost` |
| Determine Profit | **YES** | `CallCommercial.profit` |
| Determine Currency | **YES** | `CallCommercial.currency` |
| Adjustment Status | **YES** | `CallCommercial.status === 'ADJUSTED'` |
| Adjustment History | **YES** | `CallFinancialAdjustment` relation |
| Dispute Notes/Actor | **YES** | `CallDispute` relation + `SecurityAuditLog` |
| Delete Protection | **YES** | `Call -> CallCommercial` (`onDelete: Restrict`) |

---

## 13. Findings Matrix

| Dimension | Finding | Classification |
| :--- | :--- | :--- |
| A. Commercial Record Identity | Unique `call_id`, non-null `workspace_id`, preserved `campaign_id`, `vendor_id`, `buyer_id`, and `currency`. Foreign key delete protection is `Restrict`. | **PASS** |
| B. Buyer Revenue Reconciliation | Reconstructable from `CallCommercial.revenue`. Independent of subsequent campaign modifications. | **PASS** |
| C. Vendor Payout Reconciliation | Reconstructable from `CallCommercial.payout`. Immutable historical vendor ownership preserved. | **PASS** |
| D. Cost Reconciliation | Reconstructable from `CallCommercial.cost`. Evaluation aborts if `CALL_SETTLEMENT` transaction is missing. Cost is never silently zeroed. | **PASS** |
| E. Profit Reconciliation | $\text{profit} = \text{revenue} - \text{payout} - \text{cost}$ holds across all lifecycle stages. | **PASS** |
| F. Currency Reconciliation | Currency snapshot preserved per record; no cross-currency corruption or implicit conversion. | **PASS** |
| G. Dispute & Adjustment Reconciliation | One dispute per call, one adjustment per dispute, serialized with `FOR UPDATE` lock. Full audit trail intact. | **PASS** |
| H. Reconciliation Query Design | Existing schema fully supports grouping and aggregations by workspace, date range, buyer, vendor, campaign, status, and currency. | **PASS** |
| I. Settlement Boundary | Strict read boundary between current commercial ledger and future settlement batch processing. | **PASS** |
| J. Idempotency & Concurrency | Evaluator and dispute resolution are idempotent and safe under race conditions. | **PASS** |
| K. Tenant Isolation | All entities and queries strictly scoped by `workspace_id`. | **PASS** |
| L. Reporting Consistency | Reporting reads persisted snapshots directly and enforces participant visibility rules. | **PASS** |

---

## 14. Required Fixes
**None**. Concurrency protection and test coverage were previously hardened in COMM-8. No integrity defects were found during this audit.

---

## 15. Future Recommendations (Non-Blocking)
The following recommendations should be considered when implementing the future settlement/payout stage:
1. **Settlement Batch Association**: Introduce a `SettlementBatch` model and a nullable foreign key `CallCommercial.settlement_batch_id` to mark calls that have been included in an exported or executed payout batch.
2. **Finalization Lifecycle**: Utilize the existing `CallCommercial.finalizes_at` timestamp field to implement an automated settlement grace period (e.g., locking commercial records from buyer disputes 7 days after call completion).
3. **Dedicated Settlement Status**: Add a `SETTLED` status to `CommercialStatus` enum when actual bank or wallet funds transfer is completed for a commercial record.

---

## 16. Test Evidence

### Test Suite Execution Summary
- **Commercial Audit E2E Suite** (`test/commercial-audit.e2e-spec.ts`):
  - 18 / 18 tests passing (100%)
  - Covers idempotency, concurrency, profit invariants, dispute flows, immutability, cascade safety, and tenant isolation.
- **Commercial Authorization E2E Suite** (`test/commercial-authorization.e2e-spec.ts`):
  - 24 / 24 tests passing (100%)
  - Covers participant visibility policies (OWNER, ADMIN, BUYER, VENDOR, INTERNAL MEMBER).
- **Commercial Reporting E2E Suite** (`test/commercial-reporting.e2e-spec.ts`):
  - 22 / 22 tests passing (100%)
  - Covers metric calculations, aggregations, dispute reflections, and breakdowns.
- **RBAC Authorization E2E Suite** (`test/authorization.e2e-spec.ts`):
  - 23 / 23 tests passing (100%)
- **Commercial Unit Test Suites**:
  - `src/commercial/commercial-evaluator.spec.ts`: 29 / 29 tests passing (100%)
  - `src/commercial/commercial-disputes.spec.ts`: 34 / 34 tests passing (100%)
- **Build**:
  - `npm run build` in `apps/api`: Succeeded with code 0 (`nest build`).

---

## 17. Final Verdict
**READY FOR FUTURE SETTLEMENT LAYER**. The commercial ledger is robust, idempotent, immutable, and mathematically coherent.
