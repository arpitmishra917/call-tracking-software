# CallFlow Engineering Policy: Regression Prevention & Quality Standards

**Document ID:** `POLICY-ENG-2026-P24`  
**Version:** `1.0.0 (CallFlow Phase 2.4)`  
**Status:** `ACTIVE / MANDATORY`  
**Effective Date:** `November 23, 2026`  
**Target Systems:** `apps/api` (NestJS / Prisma / PostgreSQL), `apps/web` (Next.js / React), Telephony Infrastructure, CI/CD Pipelines

---

## 1. Executive Summary & Core Principles

The CallFlow Telephony & Commercial Routing Platform processes critical, real-time telephony events, multi-party commercial attribution, atomic financial transactions, and multi-tenant billing. A single defect in routing, concurrency tracking, wallet debiting, or authorization boundaries can result in severe financial loss, cross-tenant data leakage, or catastrophic carrier service interruption.

To safeguard future feature velocity while guaranteeing complete operational stability, CallFlow enforces an uncompromising **Zero-Regression Architecture** governed by the following core principles:

1. **Fail-Closed by Design:** Any detected regression, schema drift, unhandled contract deviation, or test failure must immediately block branch merging and production deployment. Pipelines never pass with warnings or skipped suites on core paths.
2. **Deterministic Layered Verification:** Every change must prove its correctness across multiple deterministic testing layers—from zero-database unit mocks to ephemeral real-PostgreSQL concurrency simulations and contract verification.
3. **Immutability of Financial & Telephony Guarantees:** Financial transactions (wallets, settlements, dispute adjudications) and telephony state machines (inbound routing, waterfall degradation, carrier event deduplication) are protected by strict regression gates that cannot be bypassed or overridden.
4. **Tenant Isolation First:** Every query, mutation, and background batch process must strictly partition by tenant identity (`workspace_id`). Broken tenancy checks are classified as Sev-0 security incidents.
5. **Expand-Contract Schema Evolution:** Database changes must maintain backwards and forwards compatibility throughout rollout cycles. Destructive migrations are prohibited in single-phase PRs.

---

## 2. Mandatory Pull Request (PR) Requirements

Every Pull Request submitted to CallFlow (`main`, `master`, or release branches) must strictly satisfy the following engineering prerequisites prior to review and merge:

### 2.1 Clean Tree and Ancestry
- The PR branch must be rebased cleanly onto the target branch head.
- Merge commits in PR branches are rejected; branches must maintain linear history.
- The working tree must be clean with zero uncommitted artifacts, untracked temporary files, or extraneous debug code.

### 2.2 The 7-Layer Quality Gate Checklist
Every PR must execute and pass all quality layers without exception:

| Layer | Gate Description | Command / Runner | Threshold |
|---|---|---|---|
| **Layer 0** | **Prisma Schema Validation & Client Generation** | `npx prisma validate --schema=prisma/schema.prisma` && `npx prisma generate` | Exit Code 0 (No schema syntax or relational inconsistencies) |
| **Layer 0** | **Static Analysis & Linting** | `npm --workspace=api run lint` (Oxlint) | 0 Errors, 0 Warnings on modified files |
| **Layer 1** | **Backend Unit Regression Tests** | `npm --workspace=api run test -- src/` | 100% Pass; 0 DB connections; Mock-isolated |
| **Layer 2** | **Backend API Integration Regression Tests** | `npm --workspace=api run test -- src/` & `test/` | 100% Pass; Deterministic state transition coverage |
| **Layer 3** | **Real PostgreSQL Integration & Concurrency Tests** | `npm --workspace=api run test -- test/*.integration.spec.ts` | 100% Pass against ephemeral PostgreSQL 16 |
| **Layer 4** | **Frontend Automated Tests & Compilation** | `npm --workspace=web run test` && `npm --workspace=web run build` | 100% Pass; Zero build errors |
| **Layer 5** | **API Contract Regression Tests** | `npm --workspace=api run test -- test/contract/` | 100% Pass; Zero breaking contract mutations |
| **Layer 6** | **Database Migration Deployment & Idempotency** | `npx prisma migrate deploy --schema=prisma/schema.prisma` | All 37+ migrations apply cleanly in sequence on blank DB |

### 2.3 Strict Typing and No-Skip Rules
- `vitest` tests marked with `.skip`, `it.todo`, or `fit` (focused tests) are rejected by CI pre-commit and pipeline scanners.
- Use of `any` types in TypeScript payloads, DTOs, or database mappers is prohibited. All incoming payloads must be strictly typed using `class-validator` / `class-transformer` DTOs or Zod schemas.

### 2.4 Code Review and Independent Verification
- Every PR requires a minimum of **two approvals**:
  1. Primary domain peer reviewer (functional correctness & domain logic).
  2. Independent security/infrastructure verifier (regression proof, BOLA audit, and CI execution validation).
- Automated regression test coverage must accompany any bugfix: no bug is closed without a reproduction test proving both the defect and its resolution.

---

## 3. Regression Test Checklists by Domain

Engineers modifying specific subsystem domains must complete and attach the corresponding domain checklist to their PR description:

### 3.1 Multi-Tenant Isolation & BOLA/IDOR Checklist
*Applies to: `apps/api/src/modules/`, `apps/api/src/calls/`, `apps/api/src/billing/`, `apps/api/src/campaigns/`, etc.*

- [ ] **Strict Workspace Scoping:** Every Prisma read (`findUnique`, `findFirst`, `findMany`) and write (`update`, `delete`, `upsert`) includes `workspace_id` in its `where` clause.
- [ ] **No Naked Primary Key Lookups:** Direct lookup by entity `id` without verifying tenant ownership (`where: { id, workspace_id }`) is prohibited.
- [ ] **Parent-Child Cross-Tenant Injection Guard:** Foreign keys in requests (e.g., assigning a `buyer_id` to a `campaign_id` or `call_id`) are verified to belong to the identical `workspace_id`.
- [ ] **Safe DTO Stripping:** All endpoints consume DTOs processed by `SafeValidationPipe` with `whitelist: true`, `forbidNonWhitelisted: true`, preventing mass-assignment of `workspace_id`, `role`, or `balance`.
- [ ] **RBAC Privilege Escalation Guard:** Workspace members cannot promote their own roles or grant permissions exceeding their current role hierarchy (`OWNER` > `ADMIN` > `MEMBER` > `BILLING`).

### 3.2 Telephony & Call Flow Routing Checklist
*Applies to: `apps/api/src/calls/`, `apps/api/src/routing/`, `apps/api/src/webhooks/`*

- [ ] **State Machine Determinism:** Inbound call state transitions strictly follow valid directed acyclic paths:
  $$\text{INITIATED} \longrightarrow \text{RINGING} \longrightarrow \text{BRIDGED / ANSWERED} \longrightarrow \text{COMPLETED}$$
  Terminal states (`COMPLETED`, `FAILED`, `BUSY`, `NO_ANSWER`) are immutable.
- [ ] **Waterfall Routing Overflow Integrity:** When the primary buyer is unavailable, at capacity, or unresponsive, the router deterministically falls through to secondary/tertiary buyers according to priority and weight.
- [ ] **Buyer Concurrency Enforcement:** Active buyer call reservations atomically increment and decrement against `concurrency_limit`. Race conditions under concurrent load must reject calls exceeding capacity rather than oversubscribing buyers.
- [ ] **Webhook Idempotency:** Telnyx and Twilio webhook event deliveries must be deduplicated using carrier event IDs (`event_id` / `call_control_id`). Duplicate payloads must return HTTP 200/204 without re-triggering billing, state transitions, or routing updates.

### 3.3 Financial & Billing Integrity Checklist
*Applies to: `apps/api/src/billing/`, `apps/api/src/settlement/`, `apps/api/src/commercial/`*

- [ ] **Atomic Balance Operations:** Wallet balances are debited, credited, or held using atomic database operations or row-level locking (`SELECT ... FOR UPDATE`). In-memory balance arithmetic followed by raw updates is strictly forbidden.
- [ ] **Wallet Hold & Release Lifecycle:** Live calls hold estimated funds at initiation. On call completion, the hold is finalized to actual cost or atomically refunded if the call drops or fails.
- [ ] **168-Hour Maturity Period:** Commercial call records must remain in `PENDING` maturity for exactly 168 hours (7 days) before becoming eligible for final settlement generation, providing a deterministic dispute window.
- [ ] **Zero-Cost Call Safety:** Calls with zero duration or zero cost (e.g. carrier signaling failures) must settle cleanly without division-by-zero, negative balance anomalies, or corrupted billing items.
- [ ] **Settlement Uniqueness Constraints:**
  - `SettlementItem` must enforce `@@unique([call_commercial_id, participant_type])` to prevent double-charging or double-payout.
  - `SettlementBatch` must enforce `@@unique([workspace_id, batch_number])` to guarantee sequential, un-duplicated settlement exports.

### 3.4 Database Schema & Migration Checklist
*Applies to: `prisma/schema.prisma`, `prisma/migrations/`*

- [ ] **Expand-Contract Compliance:** Schema changes must follow two-phase expand-contract patterns:
  - Phase 1 (Expand): Add new nullable column or column with default value; deploy code writing to both.
  - Phase 2 (Contract): Migrate historical data; switch code reading to new column; remove old column in a future release.
- [ ] **Non-Blocking Alterations:** Adding indexes on high-traffic tables (`calls`, `call_events`, `commercial_records`) must not lock tables in production.
- [ ] **Ordered Sequential Migration Naming:** Migrations must adhere to timestamped sequential directories (`YYYYMMDDHHMMSS_name`).
- [ ] **Clean Ephemeral Deployment:** All migrations from `0_init` through latest must deploy cleanly on a completely fresh PostgreSQL instance without requiring manual intervention, seeds, or external scripts.

---

## 4. CI/CD Fail-Closed Enforcement Strategy

The continuous integration pipeline in `.github/workflows/ci.yml` is the ultimate gatekeeper of platform integrity. It is configured to **fail closed** under all anomalous circumstances.

```mermaid
flowchart TD
    PR[Pull Request Submitted] --> Gate0[Gate 0: Prisma Schema & Lint]
    Gate0 -->|Pass| ParallelGate[Parallel Fast-Fail Gates]
    Gate0 -->|Fail| BlockMerge[FAIL-CLOSED: Merge Blocked]
    
    ParallelGate --> Gate1[Gate 1: Unit & Contract Tests\n(Mock-Isolated, 0 DB)]
    ParallelGate --> Gate2[Gate 2: Frontend Tests & Next.js Build]
    ParallelGate --> Gate3[Gate 3: PostgreSQL Integration &\nMigration Deploy]
    
    Gate1 -->|Pass| Gate4[Gate 4: API & App Builds]
    Gate2 -->|Pass| Gate4
    Gate3 -->|Pass| Gate4
    
    Gate1 -->|Fail| BlockMerge
    Gate2 -->|Fail| BlockMerge
    Gate3 -->|Fail| BlockMerge
    
    Gate4 -->|Pass| VerifyGate[Gate 5: Verifier Sign-off]
    Gate4 -->|Fail| BlockMerge
    
    VerifyGate -->|Approved| Promote[Safe Promotion to Main]
```

### 4.1 Strict Branch Protection Rules
1. **Required Status Checks:**
   - `Prisma & Static Quality Checks`
   - `Backend Automated Tests`
   - `Backend PostgreSQL Integration Tests`
   - `Frontend Automated Tests`
   - `Build & Compilation Gates`
2. **Strict PR Merge Blocking:**
   - Branches must be up to date before merging.
   - Force pushes to `main`, `master`, and `develop` are permanently disabled.
   - Administrator overrides of CI checks are explicitly forbidden by policy.

### 4.2 Concurrency & Ephemeral Isolation
- CI pipelines execute against fully isolated, disposable PostgreSQL containers (`postgres:16-alpine`).
- Test containers initialize with ephemeral credentials that are destroyed upon job completion.
- Parallel test runners operate with independent transaction isolation or isolated test databases to guarantee zero cross-suite test pollution.

---

## 5. Production Rollback & Incident Response Strategy

Despite rigorous pre-merge testing, unforeseen production regressions may occur due to external carrier anomalies, edge-case race conditions, or third-party service degradation. This section defines the emergency response protocol.

### 5.1 Rollback vs. Forward-Fix Decision Matrix

| Severity | Criteria | Immediate Action | SLA |
|---|---|---|---|
| **Sev-0 (Critical)** | Multi-tenant data leak (BOLA), financial calculation error (incorrect balance debit/credit), carrier webhook delivery failure > 1%, or complete API outage. | **IMMEDIATE ROLLBACK** to last known stable commit. No forward-fixing allowed. | PagerDuty trigger; Rollback initiated within 5 minutes. |
| **Sev-1 (High)** | Waterfall routing overflow malfunction affecting subset of buyers; reporting dashboard delay; non-critical webhook retry backlog. | Assess rollback vs expedited patch. If fix cannot be verified and deployed within 15 minutes, **ROLLBACK**. | Incident triage within 10 minutes; resolution within 30 minutes. |
| **Sev-2 (Medium)** | Non-blocking UI defect, non-critical telemetry log format mismatch, minor export CSV formatting glitch. | **FORWARD-FIX**. Author patch with dedicated regression test suite via expedited PR. | Resolution within 1 business day. |

### 5.2 Application Rollback Runbook
1. **Trigger Automated Revert:**
   ```bash
   git revert -m 1 <merge_commit_sha> -n
   git commit -m "revert(prod): emergency rollback of <merge_commit_sha> due to Sev-0 incident"
   git push origin main
   ```
2. **Container / Platform Deployment Reversion:**
   - For Render/Kubernetes deployments: Trigger immediate instant-rollback to previous release digest via deployment dashboard or CLI.
   - Confirm active running version matches the pre-incident SHA.

### 5.3 Database Migration Reversibility Guidelines
- **Rule of Non-Destructive Migrations:** Because rolling back application code does not automatically roll back database schemas, **no migration may drop columns, drop tables, or mutate existing column data types destructively**.
- If a migration added a column or index: The previous application code version will ignore the extra column, allowing instant application rollback without database downtime.
- If a migration contained a defect: An additive corrective migration must be applied (`npx prisma migrate deploy`). Never execute raw `DROP TABLE` or `DELETE` statements on production databases without explicit change-board approval and full WAL backup snapshotting.

### 5.4 Post-Incident Protocol
- Every incident triggering a rollback or Sev-0/Sev-1 classification requires a **Blameless Post-Mortem** within 48 hours.
- A mandatory output of every post-mortem is the addition of an automated **Regression Test** to the CI suite that reproduces the failure scenario, ensuring the defect can never recur.
