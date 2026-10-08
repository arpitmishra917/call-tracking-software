# COMM-11 — Settlement Business Rules Decision & Specification

## 1. Executive Summary

This specification resolves the three remaining open decisions identified in **COMM-10** (`docs/COMM-10-SETTLEMENT-ARCHITECTURE.md` at commit `edf9718`), completing the business-logic foundation required before any settlement implementation begins.

### The 3 Core Decisions (V1 Frozen Rules)
1. **Decision 1 — Settlement Grace Period**: 
   - **Duration**: **7 calendar days (168 hours)**.
   - **Measurement**: Canonical duration measured from call completion (`CallCommercial.created_at`).
   - **Canonical Timestamp**: $\text{finalizes\_at} = \text{CallCommercial.created\_at} + 168\text{ hours}$.
   - **Eligibility Rule**: A `CallCommercial` record becomes eligible for settlement when $\text{NOW()} \ge \text{finalizes\_at}$ AND no active dispute is pending.
2. **Decision 2 — Minimum Vendor Payout Threshold**: 
   - **Rule**: **NO MINIMUM PAYOUT THRESHOLD IN V1 (DEFERRED)**.
   - **Behavior**: All eligible payouts for a vendor within a settlement period are batched and payable regardless of amount ($>\$0.0000$). Arbitrary threshold cutoffs are avoided in V1.
3. **Decision 3 — Vendor Escrow / Holdback (Rolling Reserve)**:
   - **Rule**: **NO VENDOR ESCROW / HOLDBACK IN V1 (DEFERRED)**.
   - **Risk Mitigation**: The **7-day settlement grace period** serves as the primary buffer against buyer dispute reversals prior to vendor disbursement. Rare post-settlement dispute reversals are recovered via forward-offset ledger clawbacks on subsequent batches, preserving V1 atomic settlement.

---

## 2. Baseline and Constraints

### Authoritative Ledger Baseline
- **COMM-1 through COMM-9**: Frozen.
- **COMM-10 Architecture**: Accepted (`docs/COMM-10-SETTLEMENT-ARCHITECTURE.md`).
- **Economic Model**:
  $$\text{Revenue} = \text{Amount charged to Buyer}$$
  $$\text{Payout} = \text{Amount owed to Vendor}$$
  $$\text{Cost} = \text{Operational carrier usage cost (CALL\_SETTLEMENT transaction)}$$
  $$\text{Profit} = \text{Revenue} - \text{Payout} - \text{Cost}$$
- **CallCommercial**: The immutable historical economic source of truth. Settlement rules operate downstream and must never rewrite `CallCommercial.revenue`, `payout`, `cost`, or `profit`.

---

## 3. Decision 1 — Settlement Grace Period

### 1. Decision
Adopt a fixed, uniform **7-day (168-hour) settlement grace period** before commercial calls transition to settlement eligibility.

### 2. Exact V1 Rule
1. **Canonical Measurement**:
   At post-call commercial evaluation (`CommercialEvaluatorService.evaluateCall`), `CallCommercial.finalizes_at` is set to:
   $$\text{finalizes\_at} = \text{created\_at} + 168\text{ hours (7 days)}$$
2. **Eligibility Condition**:
   A `CallCommercial` record is eligible for inclusion in a `SettlementBatch` if and only if:
   - `converted === true`
   - $\text{NOW()} \ge \text{finalizes\_at}$ (or `status === 'FINAL'`)
   - `CallDispute` is NOT in `PENDING` status (no active buyer challenge)
   - The record has not already been included in a settled batch (`settlement_item_id IS NULL`)
3. **Uniformity**:
   The 7-day grace period applies uniformly across all campaigns and workspaces in V1. Custom per-campaign or per-workspace durations are not supported in V1.

### 3. Business Rationale
- **Buyer Audit Cycle**: Pay-per-call buyers reconcile lead quality and call recordings weekly. A 7-day window allows buyers adequate time to audit calls and file legitimate disputes before vendor payouts are committed.
- **Vendor Velocity**: A 7-day window ensures predictable weekly or bi-weekly vendor disbursement schedules (Net-7 payment terms), maintaining vendor retention.
- **Alignment with Platform Solvency**: Resolving disputes before disbursement minimizes the risk of post-settlement vendor clawback deficits.

### 4. Financial & Operational Impact
- **Zero Premature Payouts**: Vendors are not paid for calls that are subsequently disputed within the standard 7-day review window.
- **Deterministic Scheduling**: Automated settlement jobs can safely query `WHERE finalizes_at <= NOW() AND status != 'ADJUSTED'`.

### 5. Interaction with Commercial Statuses & Disputes
- **Already FINAL**: Immediately settlement-eligible (if unbatched).
- **ADJUSTED**:
  - If never batched: `revenue = 0` and `payout = 0`; settled as a zero-value audit item or excluded.
  - If already settled in a prior batch: Triggers a forward `SettlementAdjustment` (credit to Buyer, clawback to Vendor) on the next open batch.
- **Dispute PENDING**: **STRICTLY INELIGIBLE**. The call cannot be added to any settlement batch while under active review.
- **Dispute ACCEPTED**: Call transitions to `ADJUSTED`; revenue and payout are reversed to `0.0000`. No positive payout will be made.
- **Dispute REJECTED**: Dispute is closed; call retains original revenue and payout, transitions to `FINAL`, and becomes settlement-eligible once $\text{NOW()} \ge \text{finalizes\_at}$.

---

## 4. Decision 2 — Vendor Minimum Payout Threshold

### 1. Decision
**NO MINIMUM PAYOUT THRESHOLD IN V1 (DEFERRED)**.

### 2. Exact V1 Rule
- Every eligible vendor payout amount ($> 0.0000$) is included in the vendor's settlement batch for that period, regardless of whether the aggregate batch total is \$1.00, \$25.00, or \$5,000.00.
- If a vendor has eligible calls within a finalized period, a `SettlementBatch` is generated for the exact net amount due.

### 3. Business Rationale
- **Batch Aggregation Inherent Protection**: Payouts are not executed call-by-call; they are batched periodically (weekly/monthly). An active vendor rarely has a single low-dollar call in a full period.
- **Provider Agnostic**: CallFlow V1 does not assume a specific payment gateway (e.g. Stripe Connect vs ACH vs wire transfer). Enforcing an arbitrary global cutoff (such as \$50 or \$100) would prevent testing, pilot deployments, and international accounts in different currencies.
- **Zero Rollover Complexity**: Omitting a threshold avoids tracking expired rollovers, forced threshold overrides, and manual payout requests.

### 4. Financial & Operational Impact
- Ensures complete mathematical reconciliation: $\sum \text{Eligible Payouts} = \sum \text{Batched Payouts}$.
- No stranded vendor funds.

---

## 5. Decision 3 — Vendor Escrow / Holdback

### 1. Decision
**NO VENDOR ESCROW / HOLDBACK IN V1 (DEFERRED)**.

### 2. Exact V1 Rule
- 100% of the net vendor payable amount in a finalized settlement batch is scheduled for disbursement upon settlement execution.
- No rolling reserve, holdback percentage, or escrow deduction is withheld from vendor batches in V1.

### 3. Business Rationale
- **Grace Period Buffer**: The 7-day grace period (Decision 1) resolves the overwhelming majority of buyer disputes **prior to** batch finalization, eliminating the primary driver for a rolling reserve.
- **Partial Settlement Deferred**: COMM-10 established that partial settlement is deferred in V1. Withholding a percentage (e.g. 10%) creates partial payment states and complex escrow ledger tracking.
- **Forward Clawback Mechanism**: For the rare dispute accepted after a call was settled, CallFlow's forward ledger adjustment mechanism deducts the reversed payout from the vendor's subsequent settlement batch.

### 4. Financial & Operational Impact
- Simplifies vendor accounting and trust: vendors receive 100% of their finalized net earnings.
- Zero floating escrow liabilities on platform balance sheets.

---

## 6. Cross-Decision Interaction

The three decisions create a harmonious, self-reinforcing financial lifecycle:

```
Inbound Call Completed (Day 0)
        │
        ▼
   CallCommercial Snapshot Created (status: PENDING)
   finalizes_at = Day 0 + 7 Days (168 Hours)
        │
        ├──────────────────────────────────────────────────────┐
        │ [Day 0 to Day 7: Settlement Grace Period]            │
        │ - Buyer audits call quality & recordings             │
        │ - Buyer may file dispute (locks record from batch)   │
        │ - Record is INELIGIBLE for settlement                │
        └──────────────────────────────────────────────────────┘
        │
        ▼
   Day 7 Reached (NOW >= finalizes_at)
        │
        ├─► If Dispute Open: Remains Ineligible until resolved
        ├─► If Dispute Accepted: status=ADJUSTED (Payout=0; No disbursement)
        └─► If No Dispute: status=FINAL (Settlement Eligible)
                │
                ▼
           Settlement Batch Generation
           - Batch aggregates 100% of eligible payout (No Holdback / Reserve)
           - Batch executes for full amount (No Minimum Payout Threshold)
           - Historical CallCommercial values remain strictly untouched
```

---

## 7. Post-Settlement Disputes

### Architectural Behavior
When an accepted dispute occurs on a call that was **already settled and paid** in a prior settlement batch:
1. **Historical Immutability**: The prior `SettlementBatch` and external payment transaction remain unchanged.
2. **Commercial Update**: `CallCommercial.status` transitions to `ADJUSTED`, and `CallFinancialAdjustment` records the reversal.
3. **Forward Ledger Offsets**:
   - **Buyer Side**: Generates a forward `SettlementAdjustment` credit (reduces the Buyer's next invoice).
   - **Vendor Side**: Generates a forward `SettlementAdjustment` debit / clawback (deducts from the Vendor's next payout).
4. **Net Deficit Guard**: If a vendor's clawback adjustments exceed their gross payout in a period, the net batch amount becomes negative. **Negative disbursements are blocked**; the net deficit rolls forward as a deduction against future batches.

---

## 8. Multi-Currency

- **Strict Single-Currency Batches**: Every settlement batch enforces a single ISO 4217 currency.
- **No Implicit FX**: USD, EUR, and GBP calls for the same participant generate distinct, partitioned batches.
- **Zero Currency Conversion**: Currency exchange rates and conversion fees are not supported in V1.

---

## 9. Partial Settlement

- **Atomic Settlement**: As established in COMM-10, partial settlement is **DEFERRED**.
- A settlement batch settles all included items in full. Individual calls cannot be partially settled.

---

## 10. Financial Invariants

The V1 settlement rules preserve all commercial invariants:
1. **Ledger Equation**:
   $$\text{profit} = \text{revenue} - \text{payout} - \text{cost}$$
2. **Dispute Reversal Invariant**:
   $$\text{revenue} = 0.0000,\quad \text{payout} = 0.0000,\quad \text{cost} = \text{cost},\quad \text{profit} = -\text{cost}$$
3. **Batch Integrity Invariant**:
   $$\text{Batch Net Amount} = \sum \text{Call Items} + \sum \text{Forward Adjustments}$$

---

## 11. Concrete Examples

### Example 1: Grace Period Lifecycle
- **Day 0 (2026-10-01 12:00 UTC)**: Call completes (duration 120s $\ge$ 60s). `CallCommercial` created: `revenue = $100.00`, `payout = $60.00`, `cost = $2.50`, `finalizes_at = 2026-10-08 12:00 UTC`.
- **Day 4 (2026-10-05)**: Weekly settlement batch runs. Call is inspected: `NOW() < finalizes_at`. Result: **SKIPPED / INELIGIBLE**.
- **Day 8 (2026-10-09)**: Next settlement batch runs. `NOW() >= finalizes_at` and no dispute exists. Result: **INCLUDED IN BATCH**.

### Example 2: Dispute Filed During Grace Period
- **Day 0**: Call completes; `finalizes_at = Day 7`.
- **Day 3**: Buyer files dispute (`CallDispute.status = PENDING`).
- **Day 7**: Grace period expires, but dispute is `PENDING`. Result: **INELIGIBLE**.
- **Day 8**: Admin resolves dispute as `ACCEPTED`. `CallCommercial` updated to `revenue = $0`, `payout = $0`, `status = ADJUSTED`.
- **Result**: Zero payout is ever batched or paid to the vendor.

### Example 3: Threshold Evaluation (No Threshold in V1)
- **Vendor Alpha**: Generates 1 call with `payout = $12.00`.
- **Batch Run**: Settlement batch generated for **\$12.00**.
- **Result**: Payout disbursed in full. No rollover, no minimum cutoff friction.

### Example 4: Escrow / Holdback Evaluation (No Holdback in V1)
- **Vendor Beta**: Delivers 10 converted calls totaling `gross_payout = $600.00`.
- **Batch Run**: Settlement batch generated for **\$600.00** net.
- **Result**: Vendor receives \$600.00. No 10% reserve withheld.

### Example 5: Post-Settlement Dispute Clawback
- **Week 1**: Vendor Beta paid \$600.00 (includes Call #101 with \$60.00 payout).
- **Week 2**: Buyer disputes Call #101; Admin accepts dispute. `CallFinancialAdjustment` created.
- **Week 3**: Vendor Beta delivers new calls totaling \$400.00 gross payout.
- **Week 3 Batch**:
  - Gross Payout: \$400.00
  - Clawback Adjustment: -\$60.00 (Call #101)
  - Net Payable: **\$340.00**

---

## 12. V1 Frozen Rules Table

| Rule | V1 Decision | Configurable? | Implementation Impact |
| :--- | :--- | :--- | :--- |
| **Settlement Eligibility** | $\text{NOW()} \ge \text{finalizes\_at}$ AND no active dispute | No (Fixed) | Batch generation filters by `finalizes_at` |
| **Grace Period Duration** | Exactly 7 days (168 hours) from `created_at` | No (Fixed in V1) | Populated upon `CallCommercial` creation |
| **Minimum Payout Threshold** | None (Deferred to future payment gateway stage) | No | All eligible positive payouts are batched |
| **Payout Rollover** | Not applicable (no threshold in V1) | No | N/A |
| **Vendor Escrow / Holdback** | None (Deferred to future risk stage) | No | 100% of net batch amount is disbursed |
| **Post-Settlement Dispute** | Forward-offsetting adjustment on next batch | No (Fixed) | Creates `SettlementAdjustment` linking to dispute |
| **Currency Isolation** | Strict 1 batch = 1 ISO 4217 currency; no FX | No (Fixed) | Partition queries `GROUP BY currency` |
| **Partial Settlement** | Deferred; batch & calls settle atomically | No | Zero partial call splitting |
| **CallCommercial Immutability** | Never mutated by settlement execution | No (Invariant) | Settlement writes to downstream tables only |

---

## 13. Deferred / Future Rules

The following features are explicitly deferred:
1. **Configurable Grace Periods**: Per-buyer, per-vendor, or per-campaign custom dispute windows.
2. **Configurable Payout Thresholds**: Per-vendor minimum thresholds configured on payment accounts.
3. **Rolling Reserves (Holdbacks)**: Dynamic percentage holdback schedules with maturity release timers.
4. **Foreign Exchange (FX) Engine**: Multi-currency conversion rates and cross-currency settlement.
5. **Partial Call Settlement**: Splitting single call revenues or payouts across multiple partial batches.

---

## 14. Implementation Notes for Future Settlement Stage

When implementing the future settlement layer:
1. **Querying Eligible Records**:
   ```sql
   SELECT * FROM call_commercials
   WHERE workspace_id = :workspaceId
     AND buyer_id = :buyerId -- or vendor_id = :vendorId
     AND currency = :currency
     AND converted = true
     AND (status = 'FINAL' OR (status = 'PENDING' AND finalizes_at <= NOW()))
     AND id NOT IN (SELECT call_commercial_id FROM settlement_items)
     AND id NOT IN (SELECT call_commercial_id FROM call_disputes WHERE status = 'PENDING');
   ```
2. **Applying Post-Settlement Adjustments**:
   ```sql
   SELECT * FROM settlement_adjustments
   WHERE workspace_id = :workspaceId
     AND participant_id = :participantId
     AND status = 'PENDING';
   ```
3. **Audit Trail**: Every batch transition (`DRAFT` $\to$ `FINALIZED` $\to$ `SETTLED`) must emit a `SecurityAuditLog`.

---

## 15. Future Implementation Contract

A future settlement implementation agent MUST adhere to this contract:
- **Eligibility Trigger**: A call is eligible only when $\text{NOW()} \ge \text{finalizes\_at}$ (168 hours post-creation) and has no pending dispute.
- **Buyer Settlement Amount**: Sourced 100% from `CallCommercial.revenue`.
- **Vendor Settlement Amount**: Sourced 100% from `CallCommercial.payout`.
- **Holdback**: Held amount is **\$0.00** (no escrow reserve in V1).
- **Threshold**: Minimum payout threshold is **\$0.00** (all positive balances settle in V1).
- **Dispute Treatment**: Active disputes block settlement; accepted post-settlement disputes apply forward ledger offsets on subsequent batches.
- **Currency Partitioning**: Batches are strictly partitioned by currency. No FX.
- **Immutability Contract**: NEVER modify `CallCommercial.revenue`, `payout`, `cost`, or `profit` during settlement.

---

## 16. Final Verdict

**VERDICT: ALL OPEN DECISIONS RESOLVED AND FROZEN**.

The settlement business rules for CallFlow V1 are complete, unambiguous, mathematically closed, and ready for future downstream implementation.
