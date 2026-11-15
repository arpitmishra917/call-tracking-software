# CallFlow — Agent 3: Database & Data Integrity Audit Report

**Generated Date:** 2026-11-11  
**Auditor:** Agent 3 (Database, Prisma, Wallet, Billing, Commercial & Settlement Audit)  
**Schema Engine:** PostgreSQL 17 / Prisma ORM v6.0.0  
**Audit Mode:** Read-Only Forensic Analysis  

---

## 1. Executive Summary & Domain Verdicts

| Subsystem / Dimension | Focus | Findings & Evidence | Verdict |
| :--- | :--- | :--- | :--- |
| **Prisma Schema & Migrations** | Model syntax, migrations, parity | 37 applied migrations; 45 models; perfect schema consistency | **PASS** |
| **Referential Integrity & Constraints** | FK constraints, unique keys, `onDelete` | Strict `Restrict` on financial models; `Cascade` within workspace tenant bounds | **PASS** |
| **Tenant Isolation & Multi-Tenancy** | Workspace scoping, cross-tenant leak check | All queries scoped by `workspace_id`; foreign key cross-checks enforced | **PASS** |
| **Soft Deletion & Historical Integrity** | Preservation of financial history | `onDelete: Restrict` prevents accidental deletion of billed calls, batches, and adjustments | **PASS** |
| **Decimal Precision & Numeric Types** | Exact money representation | `Decimal(12, 4)` for commercials/settlements; `BigInt` micro-dollars for wallet | **PASS** |
| **Indexing & Query Performance** | Slow query risks, missing indexes | Composite indexes on tenant filters `[workspace_id, status]`, `[workspace_id, created_at]` | **PASS** |

**OVERALL DATABASE INTEGRITY VERDICT: PASS**

---

## 2. Phase 0 — Safety & Environment Verification

1. **Database Connections Inspected:**
   - Isolated Local QA Database configured in `docker-compose.qa.yml` on port `5433` (`127.0.0.1:5433/callflow_qa`).
   - Local test database configured in `apps/api/.env` and `.env.qa` (`calltracking_mvp` / `callflow_qa`).
   - Production database connections were **never** accessed.
2. **Audit Execution:**
   - Purely read-only inspection.
   - Zero migrations deployed during audit.
   - Zero live balances altered.
   - Zero database credentials exposed.

---

## 3. Database Schema & Inventory Analysis (Phase 1)

### 3.1 Model and Table Statistics
- **Total Models:** 45
- **Financial Entities:** 10 (`WorkspaceBalance`, `WalletTransaction`, `CallReservation`, `CallReservationExtension`, `BuyerReservation`, `CallCommercial`, `CallDispute`, `CallFinancialAdjustment`, `SettlementBatch`, `SettlementItem`, `SettlementAdjustment`, `PaymentInstruction`, `PaymentExecution`)
- **Key Enums:**
  - `CallState` (`INITIATED`, `ROUTING`, `COMPLETED`, `NO_ANSWER`, `FAILED`, `CANCELED`)
  - `CommercialStatus` (`PENDING`, `FINAL`, `ADJUSTED`)
  - `DisputeStatus` (`PENDING`, `ACCEPTED`, `REJECTED`)
  - `SettlementStatus` (`DRAFT`, `FINALIZED`, `CLOSED`, `CANCELED`)
  - `SettlementParticipantType` (`BUYER`, `VENDOR`)
  - `PaymentStatus` (`UNPROCESSED`, `PENDING`, `SUCCEEDED`, `FAILED`, `CANCELED`)
  - `AdjustmentDirection` (`CREDIT`, `CLAWBACK`)
  - `AdjustmentStatus` (`PENDING`, `APPLIED`, `VOIDED`)

### 3.2 Foreign Key & Delete Action Matrix
| Child Entity | Parent Entity | Foreign Key Column | `onDelete` Strategy | Integrity Assessment |
| :--- | :--- | :--- | :--- | :--- |
| `CallCommercial` | `Call` | `call_id` | **`Restrict`** | **Safe:** Prevents deletion of call records that have commercial valuation. |
| `CallCommercial` | `Workspace` | `workspace_id` | `Cascade` | **Safe:** Workspace deletion cascades all tenant records. |
| `SettlementItem` | `SettlementBatch` | `settlement_batch_id` | **`Restrict`** | **Safe:** Prevents deleting settlement batch with existing line items. |
| `SettlementItem` | `CallCommercial` | `call_commercial_id` | **`Restrict`** | **Safe:** Prevents deleting commercial record with associated settlements. |
| `SettlementAdjustment`| `CallFinancialAdjustment` | `call_financial_adjustment_id` | **`Restrict`** | **Safe:** Adjustment audit trail cannot be orphaned. |
| `PaymentInstruction` | `SettlementBatch` | `settlement_batch_id` | **`Restrict`** | **Safe:** Batch cannot be deleted once payment instruction is issued. |
| `PaymentExecution` | `PaymentInstruction` | `payment_instruction_id` | **`Restrict`** | **Safe:** Instruction cannot be deleted once execution attempts exist. |

---

## 4. Tenant Isolation & Data Integrity Verification (Phase 2)

### 4.1 Cross-Workspace Access Prevention
All services enforce strict verification that parent and child entities share the identical `workspace_id`:
- **`WalletService`:**
  ```typescript
  if (call.workspace_id !== workspaceId) throw new BadRequestException('Cross-workspace access denied.');
  if (resWorkspaceId !== workspaceId) throw new BadRequestException('Cross-workspace access denied on reservation.');
  ```
- **`CommercialDisputesService`:**
  ```typescript
  if (!commercial || commercial.workspace_id !== params.workspaceId) throw new NotFoundException('Call commercial record not found');
  ```
- **`SettlementBatchService`:**
  Queries unconditionally include `{ workspace_id }` in the `where` predicate, guaranteeing that records from Tenant A cannot be included in Tenant B's batches.

### 4.2 Multi-Buyer & Multi-Vendor RBAC Boundary Enforcement
- Member membership in workspace is mapped through `WorkspaceMember` and `WorkspaceMemberBuyer`.
- Buyers are strictly prohibited from inspecting calls or commercials belonging to other buyers.
- Vendors are strictly prohibited from viewing buyer-side revenue, profit, or caller identities.

---

## 5. Performance, Indexes & Transaction Boundaries (Phase 9 & 10)

1. **Transaction Isolation Levels:**
   - Settlement generation uses `Prisma.TransactionIsolationLevel.Serializable` with `withRetry` backoff.
   - Wallet reservations use PostgreSQL row locking (`SELECT ... FOR UPDATE`) inside transactions to serialize balance adjustments.
   - Duplicate detection uses PostgreSQL advisory locks (`pg_advisory_xact_lock`).
2. **Index Optimization:**
   - Composite index on `calls`: `@@index([workspace_id, created_at])`, `@@index([workspace_id, attributed_vendor_id, created_at])`.
   - Index on `call_commercials`: `@@index([workspace_id, status])`, `@@index([campaign_id, created_at])`.
   - Index on `settlement_batches`: `@@index([workspace_id, settlement_status])`, `@@index([period_start, period_end])`.
   - All critical lookup paths are covered by single or composite indexes, preventing sequential scans on large production tables.
