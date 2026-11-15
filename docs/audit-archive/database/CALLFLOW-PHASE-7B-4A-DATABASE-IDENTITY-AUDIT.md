# CallFlow — Phase 7B-4A: Database Environment Identity & Provisioning Target Audit

**Document ID:** CALLFLOW-PHASE-7B-4A-DATABASE-IDENTITY-AUDIT  
**Execution Boundary:** STRICT READ-ONLY FORENSIC AUDIT  
**Evaluation Date:** November 10, 2026  
**Final Verdict:** **PRODUCTION DATABASE DETECTED — PROVISIONING BLOCKED**  
*(The database targeted by the provisioning script is unequivocally the live production Supabase instance containing production workspace xyz, production DID +14845560110, and production campaign qqq. Direct provisioning into this database is strictly prohibited).*

---

## Executive Summary

Phase 7B-4A conducts a forensic audit to establish the definitive environment identity of the database targeted by [`qa/provision-qa.js`](file:///C:/Projects/callflow-agent-a/qa/provision-qa.js).

Through non-invasive configuration analysis, deployment documentation cross-referencing, and read-only database queries, this audit determined:
1. **Target Identity:** The database connection configured in [`apps/api/.env`](file:///C:/Projects/callflow-agent-a/apps/api/.env) and resolved by [`qa/provision-qa.js`](file:///C:/Projects/callflow-agent-a/qa/provision-qa.js) targets Supabase cloud project `uwycbvnqnpnfisvvbabu` in AWS Tokyo (`ap-northeast-1`).
2. **Production Resource Presence Confirmed:** Direct read-only database queries proved that this database actively hosts production workspace `xyz` (`5c3d8331-04a6-4264-888f-d0ebf57e3c7d`), production phone number `+14845560110`, and production campaign `qqq` (`31b74c8b-bb36-4e36-86fd-ef21479c163b`).
3. **Repository Documentation Confirmation:** [`PART-3.4.1-DEPLOYMENT-RUNBOOK.md`](file:///C:/Projects/callflow-agent-a/PART-3.4.1-DEPLOYMENT-RUNBOOK.md) explicitly designates Supabase project `uwycbvnqnpnfisvvbabu` as the canonical production database holding live customer data, reservations, and financial audit trails.
4. **Conclusion:** Executing `qa/provision-qa.js` against the current configuration creates test workspaces, synthetic buyer records, and unbacked $50 wallet credits **directly inside the live production database**.

---

## 1. Database Connection Resolution

A comprehensive inspection of environment variables and Prisma configuration was conducted:

### 1.1 Environment Variable Precedence & Resolution
- **Root [`.env`](file:///C:/Projects/callflow-agent-a/.env):**
  - Contains **zero** database connection variables (`DATABASE_URL` is absent).
- **Backend API Environment ([`apps/api/.env`](file:///C:/Projects/callflow-agent-a/apps/api/.env)):**
  - Defines `DATABASE_URL` pointing to `aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true`.
  - Defines `DIRECT_URL` pointing to `aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres`.
  - Defines `SUPABASE_URL` pointing to `https://uwycbvnqnpnfisvvbabu.supabase.co`.
- **Frontend Environment ([`apps/web/.env`](file:///C:/Projects/callflow-agent-a/apps/web/.env)):**
  - Defines `NEXT_PUBLIC_SUPABASE_URL` pointing to `https://uwycbvnqnpnfisvvbabu.supabase.co`.
- **Prisma Datasource Configuration ([`apps/api/prisma/schema.prisma`](file:///C:/Projects/callflow-agent-a/apps/api/prisma/schema.prisma)#L5-L9):**
  ```prisma
  datasource db {
    provider  = "postgresql"
    url       = env("DATABASE_URL")
    directUrl = env("DIRECT_URL")
  }
  ```
- **Provisioning Script Resolution ([`qa/provision-qa.js`](file:///C:/Projects/callflow-agent-a/qa/provision-qa.js)#L18-L22):**
  ```javascript
  dotenv.config({ path: path.resolve(process.cwd(), 'apps/api/.env') });
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });

  const defaultPrisma = new PrismaClient();
  ```
  - The script explicitly injects `apps/api/.env` into `process.env`.
  - When `new PrismaClient()` instantiates, Prisma automatically binds to `process.env.DATABASE_URL` (resolving to Supabase PgBouncer pooler on port 6543).
  - `DIRECT_URL` (port 5432) is bypassed at runtime and used only for Prisma schema migrations.

---

## 2. Environment Identity Audit

Cross-referencing repository deployment runbooks and architectural assessments confirms the environment classification:

### 2.1 Repository Evidence Matrix

| Source Document | Line / Section | Explicit Environment Classification |
| :--- | :--- | :--- |
| [`PART-3.4.1-DEPLOYMENT-RUNBOOK.md`](file:///C:/Projects/callflow-agent-a/PART-3.4.1-DEPLOYMENT-RUNBOOK.md) | Line 21, Section 1.2 | *"Target Supabase database (`uwycbvnqnpnfisvvbabu`) confirmed at 43 tables, 8,311 baseline rows, 0 orphaned foreign keys."* |
| [`PART-3.4.1-DEPLOYMENT-RUNBOOK.md`](file:///C:/Projects/callflow-agent-a/PART-3.4.1-DEPLOYMENT-RUNBOOK.md) | Line 61, Step 2.1 | *"Navigate to the Supabase Project Dashboard (`uwycbvnqnpnfisvvbabu`) ➔ Database ➔ Backups."* |
| [`PART-3.4.1-DEPLOYMENT-RUNBOOK.md`](file:///C:/Projects/callflow-agent-a/PART-3.4.1-DEPLOYMENT-RUNBOOK.md) | Lines 181–183 | *"DO NOT BLINDLY REVERT DATABASE TO OLD BACKUP OR LOCAL HOST. During the cutover window, real customer calls, reservations, billing events, and audit logs may have been written to Supabase."* |
| [`PART-3.4.1-PRODUCTION-INFRASTRUCTURE-ASSESSMENT.md`](file:///C:/Projects/callflow-agent-a/PART-3.4.1-PRODUCTION-INFRASTRUCTURE-ASSESSMENT.md) | Lines 15, 170 | *"A Supabase PostgreSQL 17.6 cloud database in AWS `ap-northeast-1` (Tokyo), accessed via PgBouncer transaction pooling (port 6543)..."* |
| [`apps/api/.env.rollback`](file:///C:/Projects/callflow-agent-a/apps/api/.env.rollback) | Lines 10, 15 | Contains emergency rollback pointers that identify local/staging as `calltracking_mvp` and Supabase (`uwycbvnqnpnfisvvbabu`) as production. |

### 2.2 Finding
The database host `aws-0-ap-northeast-1.pooler.supabase.com` (project `uwycbvnqnpnfisvvbabu`) is **NOT** a staging, development, or QA database. It is the **canonical cloud production database** of the CallFlow platform.

---

## 3. Production Resource Presence Verification

Using a read-only script executing via `PrismaClient` with `SELECT` projections only, the presence of core production entities in project `uwycbvnqnpnfisvvbabu` was verified:

### 3.1 Read-Only Query Results

```json
{
  "workspaceExists": true,
  "workspaceId": "5c3d8331-04a6-4264-888f-d0ebf57e3c7d",
  "workspaceSlug": "xyz-1448",
  "workspaceStatus": "ACTIVE",
  "phoneExists": true,
  "phoneWorkspaceId": "5c3d8331-04a6-4264-888f-d0ebf57e3c7d",
  "phoneStatus": "ACTIVE",
  "campaignExists": true,
  "campaignId": "31b74c8b-bb36-4e36-86fd-ef21479c163b",
  "campaignName": "qqq",
  "campaignWorkspaceId": "5c3d8331-04a6-4264-888f-d0ebf57e3c7d",
  "campaignStatus": "ACTIVE"
}
```

### 3.2 Analysis
1. **Production Workspace "xyz":** Exists as an active production entity with UUID `5c3d8331-04a6-4264-888f-d0ebf57e3c7d` and slug `xyz-1448`.
2. **Production DID "+14845560110":** Actively assigned to workspace `xyz` under status `ACTIVE`.
3. **Production Campaign "qqq":** Actively assigned to workspace `xyz` with UUID `31b74c8b-bb36-4e36-86fd-ef21479c163b`.

This provides undeniable proof that project `uwycbvnqnpnfisvvbabu` is the active production tenant repository.

---

## 4. Provisioning Script Target Safety

An audit of [`qa/provision-qa.js`](file:///C:/Projects/callflow-agent-a/qa/provision-qa.js) and [`qa/provision-qa.ts`](file:///C:/Projects/callflow-agent-a/qa/provision-qa.ts) reveals the following execution risks:

1. **Direct Connection Resolution:**
   - Because `dotenv.config({ path: 'apps/api/.env' })` is hardcoded, any execution of `node qa/provision-qa.js` automatically binds to `DATABASE_URL` in `apps/api/.env`.
   - Without an explicit database redirection, running the script writes rows directly to the production PostgreSQL cluster.
2. **Tenant Co-Location Fallacy:**
   - While `provision-qa.js` protects workspace `xyz` from being mutated, it provisions a new workspace (`callflow-qa-autonomous`), a new campaign, a test buyer, and a phone record **in the exact same database tables used by real customers**.
   - True environmental isolation requires a physically separate QA database or a dedicated testing schema/cluster, not merely a separate workspace row inside the production database.

---

## 5. Wallet Funding Classification & Financial Contamination

Inspection of the financial accounting implications:

### 5.1 Nature of the $50 QA Credit
- The script initializes `WorkspaceBalance` with `balance_minor: 5000` and `balance_micro: 50000000n` ($50.00 USD).
- It generates a `WalletTransaction` with:
  - `type`: `TransactionType.CREDIT`
  - `reference_type`: `'INITIAL_QA_PROVISIONING'`
  - `description`: `'Initial funding for Autonomous QA telephony testing'`

### 5.2 Financial Contamination Risks in Production Database
1. **Unbacked Financial Balances:** This $50 credit is synthetic and represents unbacked platform funds (no corresponding Stripe payment intent or real bank credit).
2. **Global Platform Aggregations:** Any platform-wide SQL queries computing total system liabilities, total customer balances across all workspaces, or platform wallet reserves would aggregate this $50 test balance as real money.
3. **Stripe & Reconciliation Audit Discrepancies:** While batch settlement reconciliation in `ReconciliationService` is workspace-filtered, platform-level financial audits comparing Stripe payout totals against database credits would flag a $50 un-reconciled discrepancy.

---

## 6. Final Verdict & Remediation Roadmap

### **PRODUCTION DATABASE DETECTED — PROVISIONING BLOCKED**

#### Mandatory Remediation Before Provisioning Can Occur:
To safely test CallFlow telephony without endangering production data, the operator must select one of the following architectural paths:

### Option 1: Dedicated Local/Staging QA Database (Recommended)
1. Run a dedicated QA PostgreSQL instance (e.g. via Docker or local PostgreSQL).
2. Set `DATABASE_URL` in a dedicated test environment file (e.g. `apps/api/.env.qa` or `apps/api/.env.test`).
3. Run Prisma schema push to generate tables on the isolated database.
4. Point `qa/provision-qa.js` to this isolated database URL:
   ```bash
   DATABASE_URL="postgresql://user:pass@localhost:5432/callflow_qa" node qa/provision-qa.js
   ```

### Option 2: Dedicated Supabase Staging/QA Cloud Project
1. Provision a distinct Supabase project (e.g. `callflow-qa-staging`) separate from project `uwycbvnqnpnfisvvbabu`.
2. Apply Prisma schema migrations to the staging project.
3. Execute provisioning strictly against the staging project credentials.

*Under zero circumstances may `qa/provision-qa.js` be executed against Supabase project `uwycbvnqnpnfisvvbabu`.*
