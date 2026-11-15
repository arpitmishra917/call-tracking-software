# CallFlow — Agent 3: Financial Reconciliation & Reporting Audit Findings

**Generated Date:** 2026-11-11  
**Auditor:** Agent 3 (Database, Prisma, Wallet, Billing, Commercial & Settlement Audit)  
**Target Services:** `ReportsService` ([reports.service.ts](file:///C:/Projects/callflow-agent-a/apps/api/src/reports/reports.service.ts)), `CallsService` ([calls.service.ts](file:///C:/Projects/callflow-agent-a/apps/api/src/calls/calls.service.ts)), `SettlementBatchService`  
**Test Evidence:** Verified by [reports.service.spec.ts](file:///C:/Projects/callflow-agent-a/apps/api/src/reports/reports.service.spec.ts), [payment-reconciliation.e2e-spec.ts](file:///C:/Projects/callflow-agent-a/apps/api/test/payment-reconciliation.e2e-spec.ts)  

---

## 1. Executive Summary & Verdict

| Functional Area | Audit Verification Focus | Evidence Status | Verdict |
| :--- | :--- | :--- | :--- |
| **Reporting Aggregates** | Total calls, converted, qualified, duplicate counts match DB records | `reports.service.spec.ts` | **PASS** |
| **Financial Aggregates** | Revenue, Payout, Profit sums reflect exact Decimal precision | `reports.service.spec.ts` | **PASS** |
| **Tenant Isolation** | Workspace boundary strictly enforced in all report queries | `reports.service.ts#L134-L135` | **PASS** |
| **Role-Based Column Masking** | Buyers cannot see Payout/Profit; Vendors cannot see Revenue/Profit | `reports.service.ts#L142-L147` | **PASS** |
| **Date Boundaries & Time Zones** | ISO 8601 UTC boundary normalization | `calls.service.ts#L614-L630` | **PASS** |
| **Batch Reconciliation Engine** | Sum verification, duplicate item detection, currency matching | `payment-reconciliation.e2e-spec.ts` | **PASS** |
| **Export Security** | Formula injection neutralization (`=`, `+`, `-`, `@`) | `reports.service.ts#L228-L232` | **PASS** |

**OVERALL RECONCILIATION VERDICT: PASS**

---

## 2. Comparison: Database Truth vs. Reporting Aggregates

### 2.1 Metric Definitions & Alignment
| Metric | Database Source | Calculation Rule | Discrepancy Risk | Audit Assessment |
| :--- | :--- | :--- | :--- | :--- |
| **Call Count** | `Call.count({ where: { workspace_id } })` | Total physical call legs recorded | None | Exact 1:1 match |
| **Connected Calls** | `Call.count({ where: { state: COMPLETED } })` | Calls reaching answered connected state | None | Aligned with state machine |
| **Converted Calls** | `CallCommercial.count({ where: { converted: true } })` | Talk duration $\ge$ campaign threshold | None | Derived deterministically |
| **Qualified Calls** | `CallCommercial.count({ where: { qualified: true } })` | Converted $\land \neg$Duplicate | None | Follows qualification formula |
| **Duplicate Calls** | `CallCommercial.count({ where: { duplicate: true } })` | Within duplicate window & scope | None | Advisory locked during creation |
| **Gross Revenue** | `CallCommercial._sum.revenue` | Sum of qualified calls' revenue | Rounding in UI | Database stores Decimal(12,4) |
| **Gross Payout** | `CallCommercial._sum.payout` | Sum of qualified calls' payout | Rounding in UI | Database stores Decimal(12,4) |
| **Net Profit** | `revenue - payout - cost` | Exact Decimal arithmetic | Discrepancy if cost missing | AD-03 guarantees zero-cost handling |
| **Settlement Batch Gross** | `SettlementBatch.gross_amount` | Aggregate `_sum.amount` of `SettlementItem` | None | Recomputed atomically |
| **Settlement Batch Net** | `SettlementBatch.net_amount` | $\text{Gross} + \text{SettlementAdjustments}$ | None | Verified in batch service |

---

## 3. Discrepancy Analysis: Dashboards, APIs, and Ledgers

### 3.1 Role Scoping & Information Disclosure Prevention
In `ReportsService.generateExport` and `CallsService.getCalls`:
- **For Buyers (`ctx.isBuyer === true`):**
  - Columns `payout` and `profit` are strictly stripped from export headers and data rows.
  - Commercial `vendor_id` is excluded.
- **For Vendors (`ctx.isVendor === true`):**
  - Columns `revenue`, `profit`, and `finalDestination` are strictly stripped.
  - Caller numbers are masked: `+1555***1234`.
- **Verdict:** Prevents leak of platform margins or participant identities.

### 3.2 Time Zone & Period Boundary Handling
- All internal database timestamps (`started_at`, `answered_at`, `ended_at`, `created_at`, `finalizes_at`, `period_start`, `period_end`) are stored in **UTC (Timestamp with Time Zone)**.
- Query bounds in `SettlementBatchService`:
  ```typescript
  period_start <= finalizes_at < period_end
  ```
  Strictly uses **half-open interval** $[T_{\text{start}}, T_{\text{end}})$, preventing double-counting of calls occurring exactly on the midnight boundary between consecutive settlement periods.

### 3.3 CSV/XLSX Export Formula Injection Defense
Audited lines in `ReportsService.generateExport`:
```typescript
// Formula injection neutralization
Object.keys(row).forEach(k => {
  if (typeof row[k] === 'string' && /^[=+\-@]/.test(row[k])) {
    row[k] = "\t" + row[k];
  }
});
```
Any string cell beginning with Excel command characters (`=`, `+`, `-`, `@`) is prepended with a tab character `\t`, neutralizing remote command execution or DDE payload execution in exported spreadsheets.

---

## 4. Batch Level Reconciliation Engine (`ReconciliationRun`)

The settlement subsystem provides automated reconciliation verification:
1. **Sum Mismatch Detection (`SUM_MISMATCH`):**
   - Recalculates $\sum \text{SettlementItem.amount}$ against `SettlementBatch.gross_amount`.
   - Flags an issue if discrepancy $> 0.0001$.
2. **Duplicate Call Detection (`DUPLICATE_CALL`):**
   - Verifies that no `call_commercial_id` appears more than once within the batch.
3. **Currency Mismatch (`CURRENCY_MISMATCH`):**
   - Asserts that all line items have identical currency matching `SettlementBatch.currency`.
4. **Missing Payment Detection (`MISSING_PAYMENT`):**
   - Flags batches marked `CLOSED` whose associated `PaymentInstruction` has no `SUCCEEDED` execution.
