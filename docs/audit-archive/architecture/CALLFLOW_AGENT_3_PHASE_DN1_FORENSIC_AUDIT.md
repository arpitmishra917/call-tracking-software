# CALLFLOW — PHASE DN-1: DATA INTEGRITY, CALL ATTRIBUTION & REPORTING FORENSIC AUDIT

**Owner:** Agent 3 — Database, Calls, Reporting, Commercial, Disputes & Settlement  
**Target Branch:** `agent/reporting-backend-fix`  
**Execution Mode:** STRICT READ-ONLY FORENSIC AUDIT  
**Audit Date:** November 12, 2026  
**Final Audit Status:** **AUDIT COMPLETE**

---

## EXECUTIVE SUMMARY

A comprehensive forensic audit of the CallFlow data architecture, call attribution flow, reporting aggregation engines, commercial rating pipelines, and settlement ledgers was executed under Phase DN-1. The objective was to investigate how Destination Numbers interface with calls, campaigns, Buyers, and financial records, and to evaluate the safety and readiness of making Destination Numbers fully independent entities that can exist unassigned, be assigned or reassigned to Buyers post-creation, and participate in campaign routing.

### Core Audit Verdict:
1. **Financial & Attribution Immutability (VERIFIED SAFE):**  
   Historical financial records (`CallCommercial`, `SettlementBatch`, `SettlementItem`, `CallFinancialAdjustment`, `CallDispute`) and call routing execution snapshots (`CallAttempt.destination_number`, `CallAttempt.buyer_id`, `Call.to_number`, `Call.from_number`) are stored as **immutable snapshot values**. Reassigning a Destination Number from Buyer A to Buyer B, or unassigning a number, **does not** rewrite historical commercial ownership or alter finalized settlement statements.
2. **Current Architectural Blockers for Independent Numbers (VERIFIED DEFECTS TO RESOLVE):**  
   - **Schema Level:** `destination_numbers.buyer_id` is currently `NOT NULL` in `schema.prisma` (`buyer_id String @db.Uuid`). Numbers cannot currently be created without a Buyer.
   - **Attempt Level:** `call_attempts.buyer_id` is currently `NOT NULL` (`buyer_id String @db.Uuid`). If an unassigned Destination Number (`buyer_id = null`) is dialed, creating a `CallAttempt` triggers a PostgreSQL constraint violation (`not_null_violation: 23502`).
   - **Routing Waterfall Filter:** `calls.service.ts` (`prepareNextBuyer`, lines 2072 and 2118) filters candidate numbers with `cdn.destination_number.buyer.status === 'ACTIVE'`. Unassigned numbers will be silently discarded from routing waterfalls unless updated.
   - **Reporting Resolution Fallback:** In `reports.service.ts` (`getFinalDestinationDisplay`, lines 27-31), the legacy fallback checks `successfulAttempt?.buyer?.destination_number` before `successfulAttempt?.destination_number`. This creates a live mutation hazard where changing a Buyer's profile destination number leaks into legacy call display.
   - **Aggregation Blindspot:** `reports.service.ts` supports grouping by `['Campaign', 'Buyer', 'Tracking Number', 'Status']`. It lacks native grouping or filtering by `Destination Number`.

---

## 1. CALL ATTRIBUTION ARCHITECTURE DIAGRAM

The following sequence illustrates the end-to-end attribution lifecycle from ingress telephony event to final financial settlement:

```
[ Inbound Caller ]
       |
       v (Dials Inbound Tracking DID: E.164)
[ PhoneNumbers Service / Webhook Controller ]
       |
       v Resolves Workspace & Active Campaign
[ Call Created: state = 'ROUTING' ]
  - calls.to_number = E.164 (Snapshot)
  - calls.from_number = Ingress CLI (Snapshot)
  - calls.campaign_id = Campaign UUID
  - calls.attributed_vendor_id = Vendor UUID (Snapshot)
       |
       v
[ Waterfall Engine: callsService.prepareNextBuyer ]
  - Queries: campaign_destination_numbers (order_index ASC, priority DESC)
  - Joins: destination_numbers (status = ACTIVE)
  - Joins: buyers (status = ACTIVE)
  - Concurrency Checks: destination_numbers.max_concurrent_calls & buyer.max_concurrent_calls
       |
       v
[ CallAttempt Created: state = 'INITIATED' ]
  - call_attempts.call_id = Call UUID
  - call_attempts.buyer_id = destination_numbers.buyer_id (Snapshot at dial time)
  - call_attempts.destination_number_id = destination_numbers.id (FK, SetNull on delete)
  - call_attempts.destination_number = destination_numbers.destination_number (E.164 Snapshot)
       |
       v (Telephony Bridge: Dial Buyer)
[ Telephony Call Controller: dialBuyer ]
  - Winner Answers: CallAttempt -> 'ANSWERED' -> 'COMPLETED'
  - Losing Attempts: CallAttempt -> 'NO_ANSWER' / 'BUSY' / 'CANCELED'
       |
       v
[ Commercial Evaluator: commercialEvaluatorService.evaluateCall ]
  - Identifies winningAttempt (the answered attempt that reached terminal duration)
  - Evaluates Revenue, Payout, Cost, Profit against Campaign / Buyer Tier criteria
  - CallCommercial Created:
      * call_commercials.call_id = Call UUID
      * call_commercials.buyer_id = winningAttempt.buyer_id (Snapshot)
      * call_commercials.revenue = 12,4 Micro-dollar Decimal (Snapshot)
      * call_commercials.finalizes_at = created_at + 168 hours (Snapshot)
       |
       v (Maturity / Finalization Window)
[ Settlement Engine: settlementBatchService.generateBuyerSettlement ]
  - Queries CallCommercial where buyer_id = target_buyer_id AND status = 'FINALIZED'
  - Groups by Currency into SettlementBatch
  - Inserts SettlementItem:
      * settlement_items.call_commercial_id = CallCommercial UUID (Unique)
      * settlement_items.amount = call_commercials.revenue (Snapshot)
```

---

## 2. SNAPSHOT FIELD INVENTORY

To guarantee absolute financial and audit integrity, all historical tracking and commercial attribution must use immutable snapshot values rather than dynamically traversed relational joins.

| Entity | Field Name | Storage Type | Mutability Classification | Purpose & Safety Evaluation |
| :--- | :--- | :--- | :--- | :--- |
| `Call` | `to_number` | `String` | **IMMUTABLE SNAPSHOT** | Inbound tracking E.164 dialed by caller. Never updated after call creation. |
| `Call` | `from_number` | `String` | **IMMUTABLE SNAPSHOT** | Caller ID of inbound caller. Never updated after call creation. |
| `Call` | `campaign_id` | `UUID (FK)` | Relational (`onDelete: Cascade`) | Bound to campaign. Cannot be reassigned. |
| `Call` | `attributed_vendor_id`| `UUID` | **IMMUTABLE SNAPSHOT** | Vendor attribution frozen at ingress; immune to phone number reassignment. |
| `CallAttempt` | `destination_number` | `String` | **IMMUTABLE SNAPSHOT** | Exact E.164 dialed at attempt time. Preserved even if `DestinationNumber` is edited/deleted. |
| `CallAttempt` | `buyer_id` | `UUID (FK)` | **IMMUTABLE SNAPSHOT** | Buyer owning the destination number at dial time. Frozen at creation. |
| `CallAttempt` | `destination_number_id`| `UUID (FK)` | Relational (`onDelete: SetNull`)| Foreign key to `destination_numbers.id`. Nullified if destination record is deleted. |
| `CallAttempt` | `attempt_number` | `Int` | **IMMUTABLE SNAPSHOT** | Waterfall index position (1-based). |
| `CallCommercial`| `buyer_id` | `UUID (FK)` | **IMMUTABLE SNAPSHOT** | Buyer attributed to the completed call. Frozen during rating. |
| `CallCommercial`| `vendor_id` | `UUID (FK)` | **IMMUTABLE SNAPSHOT** | Vendor attributed to the completed call. Frozen during rating. |
| `CallCommercial`| `revenue` | `Decimal(12,4)` | **IMMUTABLE SNAPSHOT** | Rated buyer charge. Immutable once finalized. |
| `CallCommercial`| `payout` | `Decimal(12,4)` | **IMMUTABLE SNAPSHOT** | Rated vendor compensation. Immutable once finalized. |
| `CallCommercial`| `finalizes_at` | `DateTime` | **IMMUTABLE SNAPSHOT** | Timestamp when dispute window closes (7 days / 168h post-call). |
| `SettlementItem`| `amount` | `Decimal(12,4)` | **IMMUTABLE SNAPSHOT** | Billed item amount frozen from `CallCommercial` during batch generation. |
| `SettlementBatch`| `gross_amount` | `Decimal(12,4)` | **IMMUTABLE AGGREGATE** | Aggregated item sum. Frozen once batch reaches `FINALIZED` or `CLOSED`. |
| `CallDispute` | `buyer_id` | `UUID (FK)` | **IMMUTABLE SNAPSHOT** | Buyer participant initiating the dispute. Verified against `commercial.buyer_id`. |
| `CallFinancialAdjustment`| `original_revenue` | `Decimal(12,4)` | **IMMUTABLE SNAPSHOT** | Pre-dispute revenue snapshot for ledger reversal audit trails. |

---

## 3. BUYER REASSIGNMENT IMPACT ANALYSIS

We audited the four distinct lifecycle operations on Destination Numbers to determine data propagation and mutation risks:

### Event 1: Unassigned Destination Number Assigned to Buyer A
- **Operational Routing Impact:**  
  The number becomes eligible for routing waterfalls in campaigns that target Buyer A or include this destination number directly.
- **Historical Data Impact:**  
  **Zero historical impact.** Calls initiated before this assignment did not dial Buyer A under this number. No past `CallAttempt` or `CallCommercial` rows are modified.
- **Reporting Impact:**  
  Past calls show either unassigned routing or previous direct dialing. New calls correctly attribute to Buyer A.

### Event 2: Destination Number Reassigned from Buyer A to Buyer B
- **Operational Routing Impact:**  
  Future calls routed to this destination number will dial on behalf of Buyer B. Buyer B's concurrency capacity (`buyer.max_concurrent_calls`) will be decremented during active calls.
- **Historical Data Impact:**  
  **Zero mutation risk to past calls.**  
  - All past `CallAttempt` records retain `call_attempts.buyer_id = Buyer_A_ID`.
  - All past `CallAttempt` records retain `call_attempts.destination_number = "+15550001111"`.
  - All past `CallCommercial` records retain `call_commercials.buyer_id = Buyer_A_ID`.
- **Settlement Impact:**  
  Settlement generation queries `CallCommercial.buyer_id`. Past completed calls will be batched into Buyer A's settlement statement, **never** into Buyer B's statement.
- **Dispute Protection:**  
  If Buyer B attempts to dispute a call that occurred prior to reassignment, `commercialDisputesService.createDispute` checks `commercial.buyer_id === member.buyer_id`. The request is rejected with `ForbiddenException: Buyer can only dispute their own commercial calls`.

### Event 3: Destination Number Unassigned (Buyer Detached, `buyer_id = null`)
- **Operational Routing Impact:**  
  Currently causes a fatal error because `destination_numbers.buyer_id` is schema-enforced `NOT NULL`, and `call_attempts.buyer_id` is schema-enforced `NOT NULL`.  
  *Once remediated in Phase DN:* The number can function as a direct endpoint or pool reserve.
- **Historical Data Impact:**  
  Detaching the buyer updates `destination_numbers.buyer_id = null`. Past calls preserve their existing `call_attempts.buyer_id` snapshots. Past statements remain untouched.

### Event 4: Campaign Mapping Alteration (Weights, Priorities, or Linkages Removed)
- **Operational Routing Impact:**  
  Changes affect only the waterfall order of subsequent incoming calls.
- **Historical Data Impact:**  
  Existing `CallAttempt.attempt_number` and routing logs remain completely unchanged.

---

## 4. CAMPAIGN MAPPING IMPACT ANALYSIS

Campaign routing behavior was audited across `apps/api/src/routing/campaigns.service.ts` and `apps/api/src/calls/calls.service.ts`:

1. **Junction Table Integrity (`campaign_destination_numbers`):**  
   - Key: `(campaign_id, destination_number_id)` composite primary key.
   - Properties: `priority` (Int), `weight` (Int), `order_index` (Int), `status` (ACTIVE/INACTIVE).
2. **Shared Numbers Across Multiple Campaigns:**  
   - Multiple campaigns can reference the same `destination_number_id` with different priorities or weightings.
   - Concurrent calls across campaigns targeting the same destination number share the global `destination_numbers.max_concurrent_calls` ceiling. This prevents carrier trunk congestion regardless of campaign source.
3. **Mid-Call Route Adjustments:**  
   - If an admin disables or modifies a campaign destination number mapping while a call is in progress (`state = 'RINGING'` or `'ANSWERED'`), the active call controller maintains the established bridge.
   - In-flight calls are not prematurely terminated by configuration edits.

---

## 5. REPORTING COVERAGE MATRIX & GAP ANALYSIS

A thorough review of `apps/api/src/reports/reports.service.ts` and `apps/api/src/calls/calls.service.ts` was conducted:

| Reporting Feature | Current Implementation | Identified Forensic Risk / Defect | Severity | Remediation Requirement |
| :--- | :--- | :--- | :--- | :--- |
| **Call Detail Records (CDR)** | Reads `CallAttempt.destination_number` snapshot. | Safe for attempt E.164; however, `getFinalDestinationDisplay` contains fallback logic. | **Low** | Ensure snapshot string is checked first before relational fallback. |
| **Final Destination Display** | Lines 27-31: Reads `successfulAttempt?.buyer?.destination_number` before `successfulAttempt?.destination_number`. | **Live Mutation Hazard:** If a Buyer's profile number changes, historical calls display the new number instead of the dialed number. | **High** | Invert precedence: `successfulAttempt?.destination_number ?? successfulAttempt?.buyer?.destination_number`. |
| **Grouping / Aggregation** | `validGroupBys = ['Campaign', 'Buyer', 'Tracking Number', 'Status']`. | **Missing Dimension:** Cannot group call volume, conversion rate, or duration by Destination Number. | **Medium** | Add `'Destination Number'` to `validGroupBys` and SQL aggregation projection. |
| **Export Engine (CSV/Excel)** | `generateExport` streams call attempts and commercial data. | Uses `attempt.destination_number` snapshot string. Safe from reassignment corruption. | **Verified Safe** | None required. |
| **Buyer RBAC Scoping** | Filters `calls.attempts.some(buyer_id = user.buyer_id)`. | Ensures Buyer users only see calls where their account was the attributed buyer at call time. | **Verified Safe** | None required. |

---

## 6. COMMERCIAL AND SETTLEMENT RISK ASSESSMENT

The settlement, dispute, and adjustment pipelines were evaluated for data integrity against destination number modifications:

1. **`CallCommercial` Immutability:**  
   - Located in `apps/api/src/commercial/commercial-evaluator.service.ts`.
   - Rated at call completion. Copies `buyer_id` directly from `winningAttempt.buyer_id`.
   - Does not maintain a foreign key to `destination_numbers`. Even if a destination number is permanently deleted (`CASCADE` or `SetNull`), `CallCommercial` retains complete financial attribution.
2. **`SettlementBatch` Generation:**  
   - Located in `apps/api/src/settlement/settlement-batch.service.ts` (lines 185-320).
   - Generates batches grouped by `(buyer_id, currency, period_start, period_end)`.
   - Queries `call_commercials.buyer_id`. Because `CallCommercial.buyer_id` is an immutable snapshot, reassignment of destination numbers has zero effect on draft, finalized, or closed settlement batches.
3. **Dispute Resolution & Ledger Adjustments:**  
   - Located in `apps/api/src/commercial/commercial-disputes.service.ts`.
   - `CallDispute` links to `call_commercial_id` and checks authorization against `commercial.buyer_id`.
   - Creating a financial adjustment (`CallFinancialAdjustment`) writes pre-adjustment and post-adjustment revenue snapshots. Destination number state is completely decoupled.

---

## 7. HISTORICAL DATA INTEGRITY RISKS

1. **Legacy Null Snapshot Risk:**  
   Calls executed prior to the introduction of `call_attempts.destination_number` snapshot column may have `NULL` in this column.  
   *Audit Evidence:* The migration `20261107120000_buyer_org_and_destination_number_foundation` added the column as nullable text.  
   *Remediation:* Reporting queries must maintain fallback to `call_attempts.buyer.destination_number` *only* when `call_attempts.destination_number` is null.
2. **PostgreSQL Constraint Traps (`NOT NULL`):**  
   - Current schema:
     ```prisma
     model DestinationNumber {
       buyer_id String @db.Uuid // NOT NULL
     }
     model CallAttempt {
       buyer_id String @db.Uuid // NOT NULL
     }
     ```
   - Attempting to support unassigned Destination Numbers without updating both `DestinationNumber.buyer_id` and `CallAttempt.buyer_id` to nullable will result in runtime SQL exceptions during routing or creation.
3. **Orphan Records on Hard Deletion:**  
   - `CallAttempt.destination_number_id` has `onDelete: SetNull`.  
   - If an admin deletes a destination number from the routing pool, the attempt retains `destination_number` (the E.164 string) while `destination_number_id` becomes `NULL`. Historical analytics remain intact.

---

## 8. EXACT SOURCE FILE AND TEST REFERENCES

### Audited Core Subsystems:
- **Schema & Database:**
  - `apps/api/prisma/schema.prisma` (Models: `DestinationNumber`, `CampaignDestinationNumber`, `Call`, `CallAttempt`, `CallCommercial`, `SettlementBatch`, `SettlementItem`, `CallDispute`)
  - `apps/api/prisma/migrations/20261107120000_buyer_org_and_destination_number_foundation/migration.sql`
- **Routing & Telephony:**
  - `apps/api/src/telephony/call-controller.ts` (Lines 990-1060: `prepareNextBuyer`, `dialBuyer`)
  - `apps/api/src/calls/calls.service.ts` (Lines 2029-2230: `prepareNextBuyer`, concurrency reservation, attempt insertion)
  - `apps/api/src/routing/destination-numbers.service.ts` (Lines 1-280: CRUD operations and RBAC scoping)
  - `apps/api/src/routing/campaigns.service.ts` (Lines 33-69, 505-610: Campaign destination mapping)
- **Commercial & Settlement:**
  - `apps/api/src/commercial/commercial-evaluator.service.ts` (Lines 103-403: Rating engine & attribution snapshot)
  - `apps/api/src/settlement/settlement-batch.service.ts` (Lines 185-320: Buyer settlement batch generator)
  - `apps/api/src/commercial/commercial-disputes.service.ts` (Lines 37-110: Dispute authorization & adjustment creation)
- **Reporting & Metrics:**
  - `apps/api/src/reports/reports.service.ts` (Lines 15-74: `getFinalDestinationDisplay`, lines 126-245: `generateExport`)
  - `apps/api/src/calls/calls.service.ts` (Lines 1588-1750: `getMetrics` SQL aggregation)

### Existing Regression & Integration Test Suites:
- `apps/api/test/phase-4b-financial-safety-integration.spec.ts` (12-scenario financial lifecycle test)
- `apps/api/src/commercial/commercial-evaluator.spec.ts` (Rating & snapshot tests)
- `apps/api/src/settlement/settlement-adjustment-integration.spec.ts` (Dispute & ledger adjustment tests)
- `apps/api/src/routing/destination-numbers.service.spec.ts` (Destination number service tests)
- `apps/api/src/reports/reports.service.spec.ts` (Reporting & export tests)

---

## 9. RECOMMENDED IMPLEMENTATION SEQUENCE (PHASE DN-2)

To safely implement independent Destination Numbers without risking data corruption, the following sequence is recommended:

```
Step 1: Database Migration
  - Alter destination_numbers.buyer_id to NULLABLE UUID.
  - Alter call_attempts.buyer_id to NULLABLE UUID.
  - Add index on destination_numbers(workspace_id, status).

Step 2: Routing Waterfall Engine Adaptation
  - Update callsService.prepareNextBuyer to allow routing to unassigned destination numbers.
  - Bypass buyer-level concurrency check when buyer_id is null; enforce destination-level concurrency.
  - Create CallAttempt with buyer_id = null and destination_number = E.164 snapshot.

Step 3: Commercial Evaluator Adaptation
  - In commercialEvaluatorService.evaluateCall, if winningAttempt.buyer_id is null:
      * Record revenue = 0.0000 (or internal rate), buyer_id = null.
      * Continue to evaluate vendor payout as normal.
      * Flag commercial record as internal / unassigned.

Step 4: Reporting & Display Hardening
  - In reports.service.ts (getFinalDestinationDisplay):
      * Invert precedence to prioritize attempt.destination_number snapshot.
  - Add 'Destination Number' to validGroupBys and add destination aggregations.

Step 5: Verification & Safety Test Suite
  - Execute full regression and integration test suites against local QA database (127.0.0.1:5433).
```

---

## 10. FINAL AUDIT STATUS

| Evaluation Area | Compliance Criteria | Audit Result | Status |
| :--- | :--- | :--- | :--- |
| **Call Attribution** | Inbound calls capture immutable E.164 and buyer snapshots at attempt time. | Fully verified in schema and service code. | **PASS** |
| **Reassignment Safety** | Reassigning numbers between Buyers does not rewrite historical commercial ownership. | Fully verified; `CallCommercial.buyer_id` is frozen at call time. | **PASS** |
| **Settlement Immutability**| Finalized and closed settlement batches cannot be altered by number changes. | Fully verified; batches use frozen commercial items and ledger adjustments. | **PASS** |
| **Reporting Integrity** | CDR and export data preserve the dialed number as a snapshot. | Verified, with display fallback priority remediation noted. | **PASS** |
| **Architecture Readiness**| Identified required schema adjustments (`buyer_id` nullability) for independent numbers. | Comprehensive implementation roadmap documented. | **READY** |

**FINAL AUDIT STATUS: AUDIT COMPLETE**
