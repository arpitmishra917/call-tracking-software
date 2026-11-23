# CALLFLOW P2.4 — WORKSTREAM A: RISK-BASED REGRESSION TEST STRATEGY
## Architectural Defense, Quality Gates & Regression Prevention Framework

**Document ID:** `P24_REGRESSION_TEST_STRATEGY`  
**Execution Date:** November 23, 2026  
**Milestone:** CallFlow Phase 2: P2.4 Regression Testing & Protection  
**Workstream Owner:** Workstream A Baseline Specialist (`@baseline`)  
**Collaborating Workstreams:**  
- Workstream B Owner (`@backend_reg`): Layer 1, Layer 2 & Layer 5 Contract Tests  
- Workstream C Owner (`@postgres_reg`): Layer 3 & Layer 6 PostgreSQL Concurrency & Migration Tests  
- Workstream E Owner (`@ci_policy`): CI/CD Pipeline Enforcement & Engineering Policy  
- Independent Verifier (`@verifier`): Controlled Failure Simulations & Gate Certification  

---

## 1. Executive Summary & Strategy Overview

As CallFlow advances into Phase 2.4, maintaining platform stability across multi-tenant boundaries, financial ledger calculations, telephony routing decisions, and carrier webhook ingestion is non-negotiable. 

This document defines the **authoritative, risk-based regression test strategy** for CallFlow. It establishes:
1. A rigorous **P0 / P1 / P2 risk prioritization framework** derived from business impact, financial liability, and tenant security.
2. The **7-Layer Quality & Regression Architecture** guaranteeing automated defense from static code analysis to real PostgreSQL transactions and frontend render-time identity guards.
3. Detailed mapping of the **12 Critical Customer Workflow Areas (A through L)** into targeted regression test suites.
4. Mandatory **CI/CD fail-closed pipeline integration** and mutation failure simulation requirements.

---

## 2. Risk Prioritization Framework (P0, P1, P2)

Every feature, state transition, and API endpoint is classified into three priority tiers based on the severity of regression failure:

```
  ┌──────────────────────────────────────────────────────────────────────────┐
  │ P0: MISSION-CRITICAL / ZERO TOLERANCE                                    │
  │ Impact: Financial double-spending, cross-tenant data leakage, routing    │
  │ bypass, duplicate settlements, data corruption. Halts release immediately.│
  ├──────────────────────────────────────────────────────────────────────────┤
  │ P1: HIGH SEVERITY / OPERATIONAL INTEGRITY                                │
  │ Impact: Duplicate webhook replay, API contract breaking changes, RBAC    │
  │ escalation, state transition failures, production guard bypasses.        │
  ├──────────────────────────────────────────────────────────────────────────┤
  │ P2: MEDIUM SEVERITY / REPORTING & FUNCTIONAL CONSISTENCY                 │
  │ Impact: High-volume pagination limits, reporting discrepancies, audit    │
  │ trail omissions, non-blocking UI rendering bugs.                         │
  └──────────────────────────────────────────────────────────────────────────┘
```

---

### 2.1 P0: Mission-Critical Invariants (Zero Tolerance)

| Risk Area | Architectural Vulnerability | Business & Financial Liability | Mandatory Regression Defense |
| :--- | :--- | :--- | :--- |
| **P0-1: Wallet Double-Spending & Negative Balances** | Concurrent inbound calls placing holds against near-zero workspace balance simultaneously. | Uncollectible telephony carrier charges; financial liability for platform. | Atomic SQL transactions with conditional balance decrement (`balance - reserved >= hold`). Tested in `test/p22-a-wallet-financial-integrity.integration.spec.ts`. |
| **P0-2: Buyer Concurrency & Waterfall Overflow Bypass** | Inbound call burst exceeding buyer center capacity (`active_calls > max_concurrent_calls`). | Call center agent overload, dropped customer calls, breach of buyer SLAs. | PostgreSQL row locks `SELECT ... FOR UPDATE` on both destination and buyer rows. Tested in `test/p22-b-buyer-concurrency-routing.integration.spec.ts`. |
| **P0-3: Multi-Tenant Cross-Workspace BOLA / IDOR** | Querying or mutating records by ID alone without compound `workspace_id` verification. | Catastrophic privacy breach; tenant data disclosure or corruption. | Mandatory compound Prisma queries `{ id, workspace_id }` and verified guards. Tested in `test/p23-a-cross-workspace-bola-idor.integration.spec.ts`. |
| **P0-4: Duplicate Settlement Items & Duplicate Batch Numbers** | Concurrent workers generating settlement batches for the same period. | Double-paying vendors or double-invoicing buyers; massive ledger discrepancies. | PostgreSQL unique constraints `SettlementItem @@unique([call_commercial_id, participant_type])` and `SettlementBatch @@unique([workspace_id, batch_number])`. Tested in `test/p22-e`. |
| **P0-5: Premature 168-Hour Maturity & Disputed Finalization** | Calls finalized before 168 hours elapse, or finalized while an open dispute exists. | Inability to clawback fraudulent calls; unauthorized disbursement of disputed funds. | Deterministic UTC maturity timestamp check (`mature_at <= NOW()`) and dispute block (`dispute_id IS NULL`). Tested in `test/p22-d`. |
| **P0-6: Database Migration History & Schema Drift** | Unordered or corrupt migration deployment on fresh PostgreSQL databases. | Total platform failure upon deployment; application crash on boot. | Clean ordered deployment test of all 37 migrations on fresh PostgreSQL. Tested in `test/p24-layer6-migration-deploy.integration.spec.ts`. |

---

### 2.2 P1: High Severity Invariants (Operational & Contract Integrity)

| Risk Area | Architectural Vulnerability | Operational & Technical Impact | Mandatory Regression Defense |
| :--- | :--- | :--- | :--- |
| **P1-1: Webhook Duplicate Replay & Lease Fencing** | Carrier re-delivers webhook while initial delivery is mid-flight. | Duplicate call records, double billing, or conflicting state transitions. | Lease token fencing and atomic status transitions (`PENDING` $\to$ `PROCESSED`) in `WebhookEvent`. Tested in `test/webhook-concurrency-postgres.integration.spec.ts`. |
| **P1-2: API Request / Response Contract Breaking Changes** | Field removal, property renaming, type change, or unexpected HTTP status codes. | Breaks frontend UI, mobile apps, and customer developer API integrations. | Layer 5 Contract regression suites testing JSON schemas and status codes in `apps/api/test/contract/`. |
| **P1-3: RBAC Privilege Escalation & Self-Promotion** | Non-owner member escalates role to OWNER, or edits their own role/permissions. | Unauthorized administrative access; privilege escalation. | Controller authorization specs and service-level self-modification blocks. Tested in `test/p23-b-auth-rbac-rejection.integration.spec.ts`. |
| **P1-4: Telephony State Machine Transition Corruption** | Out-of-order events (e.g. `COMPLETED` before `ANSWERED`) or backwards transitions. | Zombie calls stuck in active state, corrupt duration calculations. | Immutable terminal states (`COMPLETED`, `FAILED`) and safe out-of-order transition engine. Tested in `calls/inbound-call-state-transitions.regression.spec.ts`. |
| **P1-5: Production Guard Bypass on Mock Payments** | Mock payment execution or wallet top-up triggered in production environment. | Fraudulent closing of real financial settlement batches with fake funds. | Explicit `process.env.NODE_ENV === 'production'` fail-closed checks in `PaymentService` and `MockPaymentProvider`. |

---

### 2.3 P2: Medium Severity Invariants (Reporting & Functional Consistency)

| Risk Area | Architectural Vulnerability | Impact | Mandatory Regression Defense |
| :--- | :--- | :--- | :--- |
| **P2-1: Disputes Workbench Pagination Limitation** | Disputes fetched via `calls?limit=100`, losing disputes older than top 100. | Older customer disputes disappear from workbench view. | Dedicated server-side `GET /workspaces/:id/disputes` query with pagination. |
| **P2-2: Reporting Financial Aggregation Discrepancies** | Time-series bucket mismatch or nullish duration crash (`NaN` or blank screen). | Inaccurate reporting analytics presented to business executives. | Nullish coalescing operators (`stats.failed ?? 0`) and snapshot testing in `reporting/page.test.tsx`. |
| **P2-3: Security Audit Log Capture & Sanitization** | Administrative actions omitted from audit trail, or sensitive tokens leaked in logs. | Compliance failure; sensitive secrets exposed in log storage. | Tenant-scoped logging with automatic redaction of `[REDACTED]` keys. Tested in `audit-logs.controller.ts` & `page.test.tsx`. |
| **P2-4: Outbound Customer Webhook Retries & SSRF** | Worker crash during outbound dispatch; DNS rebinding on URL validation. | Customer fails to receive call events; potential internal network probing. | Atomic worker leasing, exponential backoff retries, and hardened IP validation. Tested in `webhooks.service.spec.ts`. |

---

## 3. The 7-Layer Quality & Regression Architecture

CallFlow implements a defense-in-depth testing hierarchy across 7 distinct operational layers:

```
┌────────────────────────────────────────────────────────────────────────┐
│ Layer 6: Database Migration Deployment & Schema Drift Integrity        │
│          Tool: Prisma CLI & PostgreSQL 16 Service Container            │
├────────────────────────────────────────────────────────────────────────┤
│ Layer 5: Public API & REST Contract Boundary Regression Suites         │
│          Tool: Supertest + In-Memory NestJS Test Harness               │
├────────────────────────────────────────────────────────────────────────┤
│ Layer 4: Frontend Workspace Identity Guards & UI State Persistence     │
│          Tool: Vitest + jsdom + React Testing Library                  │
├────────────────────────────────────────────────────────────────────────┤
│ Layer 3: Real PostgreSQL Concurrency, Row Locks & Financial Ledger     │
│          Tool: Vitest + Real PostgreSQL Service Container (No Mocks)   │
├────────────────────────────────────────────────────────────────────────┤
│ Layer 2: Domain Business Logic & Telephony State Machine Transitions   │
│          Tool: Vitest + Mock-Isolated Services                         │
├────────────────────────────────────────────────────────────────────────┤
│ Layer 1: In-Memory Unit Regression Tests (Controllers, Services, DTOs) │
│          Tool: Vitest Mock-Isolated Suite (79 files, 1,238 tests)      │
├────────────────────────────────────────────────────────────────────────┤
│ Layer 0: Static Analysis, Prisma Validation & Oxlint AST Inspection   │
│          Tool: oxlint + npx prisma validate (299 files, 96 rules)      │
└────────────────────────────────────────────────────────────────────────┘
```

---

### Layer-by-Layer Specifications

#### Layer 0: Static Analysis & Schema Integrity
- **Target:** All TypeScript source files in `apps/api` and `apps/web`; `schema.prisma`.
- **Execution:** `npx prisma validate`, `npm --workspace=api run lint` (`oxlint`).
- **Guarantee:** 0 syntax errors, 0 schema mismatches, 0 unhandled Promise rejections.

#### Layer 1: Mock-Isolated Unit Regression Tests
- **Target:** `apps/api/src/**/*.spec.ts`.
- **Execution:** `npm --workspace=api run test -- src/` with `NODE_ENV=test, VITEST=true`.
- **Guarantee:** 100% in-memory execution; zero external network I/O; verifies isolated method algorithms, DTO validation pipes, and error throwing.

#### Layer 2: Business Logic & State Machine Transition Tests
- **Target:** `apps/api/src/**/*.regression.spec.ts`.
- **Execution:** Runs in CI `backend-tests` job.
- **Guarantee:** Verifies state transition matrix (`INITIATED` $\to$ `COMPLETED`), waterfall candidate selection, 168-hour maturity calculations, and zero-cost call handling.

#### Layer 3: PostgreSQL Concurrency & Financial Integration Tests
- **Target:** `apps/api/test/*.integration.spec.ts`.
- **Execution:** `backend-postgres-integration` CI job against ephemeral `postgres:16-alpine`.
- **Guarantee:** Real PostgreSQL database constraints, advisory locks, `SELECT ... FOR UPDATE` row locks, rollback integrity, and unique constraint conflict codes (`23505`).

#### Layer 4: Frontend Component, Guard & Workspace Switching Tests
- **Target:** `apps/web/**/*.test.tsx`.
- **Execution:** `npm --workspace=web run test` (Vitest + jsdom).
- **Guarantee:** Render-time workspace identity guards prevent cross-workspace data flash; auth recovery handles token refresh without redirect loops; form inputs reject invalid formats.

#### Layer 5: Public API & REST Contract Boundary Regression Tests
- **Target:** `apps/api/test/contract/*.contract.spec.ts`.
- **Execution:** Fast mock-isolated Supertest suite running in `backend-tests` CI job.
- **Guarantee:** Protects API consumers from breaking schema alterations, removed fields, type mutations, and unexpected HTTP error codes.

#### Layer 6: Prisma Migration Deployment & Schema Drift Integrity
- **Target:** `apps/api/test/p24-layer6-migration-deploy.integration.spec.ts`.
- **Execution:** Runs against disposable PostgreSQL in `backend-postgres-integration`.
- **Guarantee:** Validates clean, error-free, sequential execution of all 37 Prisma migrations on a blank PostgreSQL database with zero schema drift.

---

## 4. Workflow Area to Regression Test Suite Mapping

The table below maps each of the 12 Critical Customer Workflow Areas directly to its assigned regression test suites and owners:

| Workflow Area | Risk Tier | Primary Regression Test Suites | Workstream Owner | Execution Gate |
| :--- | :---: | :--- | :---: | :--- |
| **A: Waterfall Routing** | **P0** | `src/routing/waterfall-overflow-routing.regression.spec.ts`<br>`test/p22-b-buyer-concurrency-routing.integration.spec.ts` | `@backend_reg`<br>`@postgres_reg` | Layer 2 (Unit)<br>Layer 3 (Postgres) |
| **B: Buyer Concurrency** | **P0** | `test/p24-layer3-financial-concurrency.integration.spec.ts`<br>`test/p22-b-buyer-concurrency-routing.integration.spec.ts` | `@postgres_reg` | Layer 3 (Postgres) |
| **C: Webhook Idempotency** | **P1** | `src/telephony/webhook-idempotency-deflection.regression.spec.ts`<br>`test/webhook-concurrency-postgres.integration.spec.ts` | `@backend_reg`<br>`@postgres_reg` | Layer 2 (Unit)<br>Layer 3 (Postgres) |
| **D: Call State Machine** | **P1** | `src/calls/inbound-call-state-transitions.regression.spec.ts`<br>`test/multi-workspace-isolation.integration.spec.ts` | `@backend_reg` | Layer 2 (Unit)<br>Layer 3 (Postgres) |
| **E: Wallet Balance & Holds** | **P0** | `test/p24-layer3-financial-concurrency.integration.spec.ts`<br>`test/p22-a-wallet-financial-integrity.integration.spec.ts` | `@postgres_reg` | Layer 3 (Postgres) |
| **F: Commercial Economics** | **P0** | `src/commercial/commercial-168h-maturity-zero-cost.regression.spec.ts`<br>`test/p22-d-commercial-lifecycle-maturity.integration.spec.ts` | `@backend_reg`<br>`@postgres_reg` | Layer 2 (Unit)<br>Layer 3 (Postgres) |
| **G: 168h Financial Maturity** | **P0** | `src/commercial/commercial-168h-maturity-zero-cost.regression.spec.ts`<br>`test/p22-d-commercial-lifecycle-maturity.integration.spec.ts` | `@backend_reg`<br>`@postgres_reg` | Layer 2 (Unit)<br>Layer 3 (Postgres) |
| **H: Settlement Uniqueness** | **P0** | `test/p24-layer3-financial-concurrency.integration.spec.ts`<br>`test/p22-e-settlement-generation-uniqueness.integration.spec.ts` | `@postgres_reg` | Layer 3 (Postgres) |
| **I: Commercial Disputes** | **P1** | `test/p22-f-commercial-disputes-reconciliation.integration.spec.ts`<br>`apps/web/src/app/protected/disputes/page.test.tsx` | `@postgres_reg` | Layer 3 (Postgres)<br>Layer 4 (Web) |
| **J: Zero-Cost Completed Calls**| **P1** | `src/commercial/commercial-168h-maturity-zero-cost.regression.spec.ts`<br>`src/calls/calls.service.spec.ts` | `@backend_reg` | Layer 1 & 2 (Unit) |
| **K: Multi-Tenant RBAC** | **P0** | `test/p23-a-cross-workspace-bola-idor.integration.spec.ts`<br>`test/p23-b-auth-rbac-rejection.integration.spec.ts`<br>`test/p23-c-mass-assignment-safe-query.integration.spec.ts` | `@postgres_reg` | Layer 3 (Postgres) |
| **L: Public API & Webhooks** | **P1** | `test/contract/public-api.contract.spec.ts`<br>`src/common/pipes/safe-validation.pipe.spec.ts` | `@backend_reg` | Layer 5 (Contract)<br>Layer 1 (Unit) |

---

## 5. Controlled Mutation & Failure Simulation Requirements

To prove that regression tests are effective and not superficial "green-washing", the regression framework mandates periodic **mutation failure simulations** certified by the Independent Verifier (`@verifier`):

1. **Mutation Simulation 1 (Buyer Routing Concurrency Bypass):**
   - Mutation: Artificially raise `maxLimit = 999999` in `CallsService.prepareNextBuyer`.
   - Verification: `test/p22-b` MUST fail closed with an exit code of 1, catching simultaneous calls exceeding capacity.
2. **Mutation Simulation 2 (Multi-Tenant BOLA / IDOR Query Leakage):**
   - Mutation: Drop `workspace_id: workspaceId` filter in `getCallDetail`.
   - Verification: `test/p23-a` MUST fail closed with an exit code of 1, catching cross-workspace record disclosure.
3. **Mutation Simulation 3 (Financial Dispute Finalization Bypass):**
   - Mutation: Bypass `PENDING` dispute check in `CommercialFinalizationService.processFinalizationBatch`.
   - Verification: `test/p22-d` MUST fail closed with an exit code of 1, catching premature finalization of a disputed call.

All three simulations were conducted and certified in `P24_REGRESSION_GATE_PROOF.md`.

---

## 6. Continuous Integration & Pipeline Fail-Closed Guarantee

In accordance with `docs/engineering/REGRESSION_PREVENTION_POLICY.md` (authored by `@ci_policy`), the `.github/workflows/ci.yml` pipeline enforces:

1. **Automated Gate Execution on Every Pull Request:**
   - Job 1 (`prisma-and-lint`): Prisma schema validation, client generation, oxlint static checks.
   - Job 2 (`backend-tests`): Mock-isolated unit tests (`src/`) AND Layer 5 Contract regression tests (`test/contract/`).
   - Job 3 (`backend-postgres-integration`): Migration deployment status (`prisma migrate status`), all 10 existing P2.3 suites, Layer 3 financial concurrency suite, and Layer 6 migration deployment suite against PostgreSQL 16.
   - Job 4 (`frontend-tests`): Vitest component and workspace identity guard tests.
   - Job 5 (`build-applications`): Next.js Turbopack build and NestJS production compilation.
2. **Fail-Closed Policy:**
   - Any test failure, contract divergence, unhandled exception, or migration error immediately terminates the pipeline and blocks pull request merge.
   - Direct pushes to `main` are disabled; two authorized engineering sign-offs are required.

---

## 7. Post-Deployment Monitoring & Regression Signals

Post-deployment regression detection is governed by `P24_PRODUCTION_REGRESSION_SIGNALS.md`:

1. **Structured Log Telemetry:**
   Every log entry includes `timestamp`, `level`, `trace_id`, `workspace_id`, `call_id`, and `event`.
2. **Automated Alert Rules (Prometheus / Alertmanager):**
   - `CallCompletionRatioDrop`: Alert when completed calls fall below 85% over 5m.
   - `NegativeWalletBalanceDetected`: Critical Sev-0 alert on any negative balance transaction.
   - `SettlementUniqueConstraintViolation`: Alert on duplicate batch generation attempt (`Postgres 23505`).
   - `CrossWorkspaceUnauthorizedAccessAttempt`: Alert on blocked cross-workspace IDOR attempt.
3. **5-Step Post-Deployment Smoke Verification:**
   - Step 1: Healthcheck probe (`GET /health`)
   - Step 2: Database migration verification (`npx prisma migrate status`)
   - Step 3: Inbound synthetic webhook verification
   - Step 4: Synthetic wallet balance hold & release verification
   - Step 5: 10-minute automated canary monitoring before traffic cutover.
