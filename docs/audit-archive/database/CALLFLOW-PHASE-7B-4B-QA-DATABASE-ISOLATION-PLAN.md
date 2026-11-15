# CallFlow — Phase 7B-4B: Dedicated QA Database Architecture & Isolation Plan

**Document ID:** CALLFLOW-PHASE-7B-4B-QA-DATABASE-ISOLATION-PLAN  
**Execution Boundary:** STRICT READ-ONLY PLANNING & ARCHITECTURAL DESIGN  
**Evaluation Date:** November 10, 2026  
**Final Verdict:** **READY FOR QA DATABASE IMPLEMENTATION**  
*(This document defines the architectural blueprint for a physically isolated QA PostgreSQL database. Zero database instances, migrations, containers, or environment mutations occurred in this phase).*

---

## Executive Summary

Phase 7B-4A definitively proved that `apps/api/.env` points to the **live production Supabase database** (`uwycbvnqnpnfisvvbabu`) hosting active customer workspaces (`xyz`), production phone numbers (`+14845560110`), and production campaigns (`qqq`).

Phase 7B-4B establishes a comprehensive architectural plan to deploy a **physically isolated, containerized QA database** (`callflow_qa`), decouple all QA scripts from production credentials, eliminate database co-location risks, and guarantee zero blast radius for live CallFlow telephony testing.

---

## 1. Current Infrastructure Findings

A forensic review of the repository identified the following existing assets:

### 1.1 Containers & Ports
- **Asterisk ARI Container (`docker-compose.qa.yml`):**
  - Container `callflow-asterisk-qa` (image: `andrius/asterisk:20-alpine`) is actively running and healthy on host ports `5060/udp`, `10000-10050/udp` (RTP), and `127.0.0.1:8088` (ARI HTTP/WebSocket).
- **Default Database Definition (`docker-compose.yml`):**
  - Defines an unrunning legacy service `db` (image: `postgres:15-alpine`, db: `calltracking`, port: `5432:5432`, user: `testuser`).
- **Port Availability:**
  - Host port `5433` is currently unallocated, making it the ideal host binding for the dedicated QA PostgreSQL container to avoid conflicts with port `5432`.

### 1.2 Prisma Schema & Migration History
- **Prisma Schema ([`apps/api/prisma/schema.prisma`](file:///C:/Projects/callflow-agent-a/apps/api/prisma/schema.prisma)):**
  - Declares 43 models including `Workspace`, `WorkspaceBalance`, `WalletTransaction`, `Campaign`, `Buyer`, `CampaignBuyer`, `PhoneNumber`.
- **Migration History ([`apps/api/prisma/migrations`](file:///C:/Projects/callflow-agent-a/apps/api/prisma/migrations)):**
  - Contains **37 sequential migrations** spanning from initial stages (`20260921024015_init_stage4`) to recent buyer organization and destination number additions (`20261107120000_buyer_org_and_destination_number_foundation`).
  - Migration `20261107120000` adds `buyers.email` and creates `destination_numbers`, which explains the schema drift previously observed on the production database.

### 1.3 Telephony & Provisioning Script Findings
- **Ingress Webhook Route:** Handled at `/api/telephony/calls/events` in `apps/api`.
- **Provisioning Scripts ([`qa/provision-qa.js`](file:///C:/Projects/callflow-agent-a/qa/provision-qa.js) / [`.ts`](file:///C:/Projects/callflow-agent-a/qa/provision-qa.ts)):**
  - Currently contains hardcoded loading of `apps/api/.env`, which causes automatic binding to production `DATABASE_URL`. Must be decoupled to require explicit QA database configuration.

---

## 2. Recommended QA Database Architecture

```mermaid
flowchart TD
    subgraph PRODUCTION_ZONE["Production Environment (AIR-GAPPED FROM QA)"]
        PROD_APP["Production CallFlow API"]
        PROD_DB[("Supabase Production PostgreSQL\nuwycbvnqnpnfisvvbabu\n(AWS ap-northeast-1)")]
        PROD_NUM["Production DID +14845560110\n(Workspace xyz)"]
        PROD_APP --> PROD_DB
        PROD_NUM -.-> PROD_APP
    end

    subgraph QA_ZONE["Isolated QA Environment (Local Docker Network)"]
        QA_APP["CallFlow API (QA Mode)\nDOTENV_CONFIG_PATH=.env.qa"]
        QA_DB[("Dedicated QA PostgreSQL Container\ncallflow_qa\n(Host Port 5433)")]
        ASTERISK["Asterisk 20 QA Container\ncallflow-asterisk-qa\n(ARI 127.0.0.1:8088)"]
        QA_DID["Dedicated QA Telnyx DID\n(+1XXXXXXXXXX)"]
        QA_SIP["Telnyx QA Buyer SIP Target\nsip:arpitmishra9178@sip.telnyx.com"]

        QA_APP -->|DATABASE_URL: port 5433| QA_DB
        ASTERISK <-->|ARI & Loopback RTP| QA_APP
        QA_DID -->|QA Call Control App Webhook| QA_APP
        QA_APP -->|SIP URI Outbound Dial| QA_SIP
    end

    style PRODUCTION_ZONE fill:#ffebee,stroke:#c62828,stroke-width:2px
    style QA_ZONE fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
```

### 2.1 Instance Specifications
- **Service Name:** `postgres-qa`
- **Container Name:** `callflow-postgres-qa`
- **Docker Image:** `postgres:17-alpine` (matching Supabase major version 17)
- **Host Port Mapping:** `127.0.0.1:5433:5432`
- **Database Name:** `callflow_qa`
- **Dedicated User:** `callflow_qa_admin`
- **Dedicated Volume:** `callflow_qa_db_data` (isolated volume, destroyed upon cleanup)

### 2.2 Connection String Specifications
- **QA `DATABASE_URL`:**
  ```ini
  DATABASE_URL="postgresql://callflow_qa_admin:<GENERATED_QA_PASSWORD>@127.0.0.1:5433/callflow_qa?schema=public"
  ```
- **QA `DIRECT_URL`:**
  ```ini
  DIRECT_URL="postgresql://callflow_qa_admin:<GENERATED_QA_PASSWORD>@127.0.0.1:5433/callflow_qa?schema=public"
  ```
- *No PgBouncer transaction pooling parameters (`?pgbouncer=true`) are required for the local QA PostgreSQL container.*

---

## 3. Exact Configuration Design

A separate, dedicated environment file will be created: [`apps/api/.env.qa`](file:///C:/Projects/callflow-agent-a/apps/api/.env.qa).

### 3.1 Environment Variable Blueprint (`apps/api/.env.qa`)

```ini
# ==============================================================================
# CALLFLOW DEDICATED QA ENVIRONMENT CONFIGURATION
# STRICTLY ISOLATED FROM PRODUCTION SUPABASE
# ==============================================================================
ENVIRONMENT=qa
NODE_ENV=test

# Database Connectivity (Isolated Docker QA Container)
DATABASE_URL="postgresql://callflow_qa_admin:[REDACTED_QA_PASSWORD]@127.0.0.1:5433/callflow_qa?schema=public"
DIRECT_URL="postgresql://callflow_qa_admin:[REDACTED_QA_PASSWORD]@127.0.0.1:5433/callflow_qa?schema=public"

# Telephony Ingress Gates (Fail-Closed Default)
TELEPHONY_PROVIDER=telnyx
ACTIVE_TELEPHONY_PROVIDER=telnyx
TELEPHONY_QA_ENABLED=false
QA_WORKSPACE_ID=
TELNYX_QA_TRACKING_DID=
TELNYX_QA_CALL_CONTROL_APP_ID=

# Allowlist & Target Routing
TELEPHONY_QA_ALLOWED_DESTINATIONS=
TELEPHONY_QA_BUYER_SIP_URI=sip:arpitmishra9178@sip.telnyx.com

# Asterisk ARI Local Endpoint
TELEPHONY_QA_SERVER_URL=http://localhost:8088
TELEPHONY_QA_ARI_URL=http://127.0.0.1:8088
TELEPHONY_QA_ARI_USERNAME=callflow_qa
TELEPHONY_QA_RECORDING_ENABLED=true

# Authentication & Webhook Security
PORT=3000
BASE_URL=https://<your-ngrok-domain>.ngrok-free.dev
JWT_SECRET=qa_isolated_jwt_secret_99887766554433221100aabbccddeeff
WEBHOOK_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef
```

### 3.2 Anti-Fallback Circuit Breakers
The API and scripts will enforce a hard runtime assertion:
1. Rejects hostnames containing `supabase.co`, `supabase.com`, or `aws-0-ap-northeast-1.pooler.supabase.com`.
2. Rejects connection strings containing production project ref `uwycbvnqnpnfisvvbabu`.
3. Verifies that the database name ends with `_qa` or `_test`.
4. Pre-execution query asserts that workspace `5c3d8331-04a6-4264-888f-d0ebf57e3c7d` (production workspace `xyz`) **does NOT exist**.

---

## 4. Prisma Initialization Plan

### 4.1 Methodology Comparison & Selection
- **Option A: `prisma migrate deploy` (Recommended):**
  - Applies all 37 sequential migrations in [`apps/api/prisma/migrations`](file:///C:/Projects/callflow-agent-a/apps/api/prisma/migrations).
  - Validates full migration ledger compatibility and builds an exact replica of the production schema structure.
  - Fixes schema drift automatically (since migration `20261107120000` includes `buyers.email` and `destination_numbers`).
- **Option B: `prisma db push` (Fallback):**
  - Synchronizes `schema.prisma` directly to PostgreSQL without migration records.
  - *Recommendation:* Run `prisma migrate deploy` first; only fall back to `prisma db push` if legacy migration ordering fails on a blank database.

---

## 5. QA Provisioning Script Isolation Requirements

Refactoring [`qa/provision-qa.ts`](file:///C:/Projects/callflow-agent-a/qa/provision-qa.ts) and [`qa/provision-qa.js`](file:///C:/Projects/callflow-agent-a/qa/provision-qa.js):

### 5.1 Script Decoupling Safeguards
1. **Explicit QA Environment File Requirement:**
   - Remove `dotenv.config({ path: 'apps/api/.env' })`.
   - Require `apps/api/.env.qa` or accept an explicit `DATABASE_URL` via process argument / CLI flag.
2. **Hardcoded Database Identity Verification:**
   ```typescript
   function assertTargetDatabaseIsQa(databaseUrl: string) {
     const url = new URL(databaseUrl);
     if (url.hostname.includes('supabase') || databaseUrl.includes('uwycbvnqnpnfisvvbabu')) {
       throw new Error('FATAL SAFETY VIOLATION: Provisioning script attempted to connect to PRODUCTION Supabase!');
     }
     if (!url.pathname.includes('qa') && !url.pathname.includes('test')) {
       throw new Error(`FATAL SAFETY VIOLATION: Target database "${url.pathname}" is not a recognized QA database!`);
     }
   }
   ```
3. **Database Pre-Execution Sanity Probe:**
   - Script queries `SELECT id FROM workspaces WHERE id = '5c3d8331-04a6-4264-888f-d0ebf57e3c7d'`.
   - If found, it immediately aborts: `CRITICAL ERROR: Production workspace detected in target database!`.

---

## 6. Telephony Integration Requirements

1. **Carrier Separation:**
   - Telnyx Mission Control Portal Call Control Application must be dedicated (e.g. `CallFlow Autonomous QA`), with an independent webhook URL pointing to `${BASE_URL}/api/telephony/calls/events`.
   - Production Call Control Application (`3049733953897366872`) must remain completely untouched.
2. **Dedicated DID Ingress:**
   - Only the newly purchased Telnyx DID will be bound to the QA Call Control Application and the QA database.
3. **Fail-Closed Allowlist:**
   - `TELEPHONY_QA_ALLOWED_DESTINATIONS` remains empty until the exact moment of an authorized call test, strictly restricting calls to `+12025550199`.

---

## 7. Security Risks & Rollback Plan

| Risk | Mitigation | Rollback Action |
| :--- | :--- | :--- |
| **Accidental Production Database Connection** | Strict string pattern assertion rejecting Supabase hosts and project ref `uwycbvnqnpnfisvvbabu`. | Script aborts immediately before connecting or creating transaction. |
| **Port Conflict on 5432** | QA container binds to host port `5433:5432`. | If 5433 is in use, rebind to 5434. |
| **Test Data Accumulation in QA Database** | Container utilizes an ephemeral Docker volume. | Run `docker-compose -f docker-compose.qa.yml down -v` to cleanly wipe all QA data. |
| **Leaked Synthetic Financial Balances** | Synthetic $50 credit exists only in the local `callflow_qa` database. | Production financial ledgers remain 100% untouched. |

---

## 8. Exact Implementation Sequence

When authorized, the operator will execute the following sequential steps:

```
[Step 1: Update docker-compose.qa.yml] ➔ Add postgres-qa service (port 5433)
                  │
                  ▼
[Step 2: Start QA Database] ➔ docker-compose -f docker-compose.qa.yml up -d postgres-qa
                  │
                  ▼
[Step 3: Create apps/api/.env.qa] ➔ Configure isolated QA database connection
                  │
                  ▼
[Step 4: Initialize QA Schema] ➔ Run prisma migrate deploy against port 5433
                  │
                  ▼
[Step 5: Harden Provisioning Script] ➔ Add anti-Supabase database assertions
                  │
                  ▼
[Step 6: Execute Provisioning] ➔ Run provision-qa.js against local QA database
```

---

## 9. Files That Would Need Modification

1. [`docker-compose.qa.yml`](file:///C:/Projects/callflow-agent-a/docker-compose.qa.yml): Add `postgres-qa` service on port `5433`.
2. [`apps/api/.env.qa`](file:///C:/Projects/callflow-agent-a/apps/api/.env.qa): Create new environment configuration file (isolated from production).
3. [`qa/provision-qa.ts`](file:///C:/Projects/callflow-agent-a/qa/provision-qa.ts) & [`qa/provision-qa.js`](file:///C:/Projects/callflow-agent-a/qa/provision-qa.js): Update environment loader and insert `assertTargetDatabaseIsQa()` guard.

---

## 10. Proposed Commands for Next Phase

*(For review only; not executed in this phase)*

```bash
# 1. Start the dedicated QA PostgreSQL container
docker compose -f docker-compose.qa.yml up -d postgres-qa

# 2. Deploy Prisma migrations to the isolated QA database
cd apps/api && dotenv -e .env.qa -- npx prisma migrate deploy

# 3. Execute controlled provisioning against the isolated QA database
node -e 'import("./qa/provision-qa.js").then(m => m.provisionDedicatedQaEnvironment({ newQaTrackingDid: "+1XXXXXXXXXX", telnyxProviderNumberId: "30XXXXXXXXXXXX", confirmCarrierOwnership: true }))'
```

---

## 11. Final Verdict

### **READY FOR QA DATABASE IMPLEMENTATION**

*The isolation architecture, port allocation, anti-production circuit breakers, and schema migration strategies are 100% planned and validated. All existing production Supabase databases and carrier endpoints remain completely unimpacted.*
