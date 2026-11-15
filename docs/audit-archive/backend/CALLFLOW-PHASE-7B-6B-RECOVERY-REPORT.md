# CallFlow — Phase 7B-6B: Production Connection Isolation & QA Backend Recovery Report

**Execution Status**: COMPLETED  
**Final Verdict**: **PHASE 7B-6B — PASS**  
**Timestamp**: 2026-11-10T22:27:30+05:30  
**Target QA Database**: `callflow_qa` (`127.0.0.1:5433`, PostgreSQL 17.11)  
**Execution Scope**: Containment, Root Cause Analysis, Safe QA Launcher Implementation & Local Backend Recovery  

---

## 1. Immediate Containment & Process Termination Evidence

Prior to remediation, the active listeners on ports 3000 and 4040 were audited:
- **Old Backend PID (4588)**: Terminated. Confirmed via `Get-Process` that PID 4588 no longer exists.
- **Old ngrok PID (6468)**: Terminated. Confirmed via `Get-Process` that PID 6468 no longer exists.
- **Port 3000 Listener Check**: Verified offline via HTTP probe (`ECONNREFUSED`).
- **ngrok Tunnel Check**: Verified offline via HTTP probe to `https://coherent-undrilled-disarm.ngrok-free.dev/health` (`HTTP 404`, `ERR_NGROK_3200`). Port 4040 is closed.

---

## 2. Root Cause Analysis of Environment Misconfiguration

Inspection of [`apps/api/src/main.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/main.ts#L6-L10) and [`apps/api/package.json`](file:///C:/Projects/callflow-agent-a/apps/api/package.json) revealed:
1. **Unconditional `.env` Loading**: `main.ts` executed sequential calls to `dotenv.config()` targeting standard `.env` files:
   ```ts
   dotenv.config({ path: path.resolve(__dirname, '../.env') });
   dotenv.config({ path: path.resolve(process.cwd(), '.env') });
   ```
2. **Missing QA Branching**: There was no branch or condition checking `NODE_ENV === 'qa'`, `APP_ENV === 'qa'`, or looking for `.env.qa`.
3. **Default to Production**: `apps/api/.env` is the project's standard configuration file, which points to the live Supabase connection pooler (`aws-0-ap-northeast-1.pooler.supabase.com:6543`).
4. **Shell Invocations**: Executing `node dist/main` without explicit environment variable overrides caused `PrismaService` to inherit `DATABASE_URL` from `apps/api/.env`, establishing an outbound socket to Supabase on port 6543.

---

## 3. Safe QA Launcher Implementation & Defense-in-Depth

To guarantee complete isolation, a three-layer fail-closed architecture was implemented:

### Layer 1: Dedicated QA Launcher ([`qa/launch-qa-backend.mjs`](file:///C:/Projects/callflow-agent-a/qa/launch-qa-backend.mjs))
- **File Targeting**: Exclusively reads [`apps/api/.env.qa`](file:///C:/Projects/callflow-agent-a/apps/api/.env.qa).
- **Target URL Verification**: Parses `DATABASE_URL` and validates:
  - Host must be `127.0.0.1` or `localhost`.
  - Port must be `5433`.
  - Database name must be `callflow_qa`.
  - Username must be `callflow_qa_user`.
  - Hard regex rejection for any production strings (`supabase.co`, `uwycbvnqnpnfisvvbabu`, `aws-0-ap-northeast-1`, `6543`, `pooler.supabase.com`).
- **Environment Scrubbing**: Explicitly deletes inherited `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL`, and Supabase secret keys from `process.env`.
- **Pre-Flight Database Ping**: Uses `PrismaClient` to connect to `127.0.0.1:5433/callflow_qa` and assert that Stage A Workspace `5e20bafe-7306-4da7-9944-62c4c5575a5a` and Campaign `6af31407-3f46-4f1d-90d0-bf08af2e9600` exist before starting NestJS.

### Layer 2: Hardened `main.ts` Environment Selector
Updated [`apps/api/src/main.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/main.ts#L5-L23):
```ts
const isQaMode = process.env.APP_ENV === 'qa' || process.env.NODE_ENV === 'qa';

if (isQaMode) {
  dotenv.config({ path: path.resolve(__dirname, '../../.env.qa') });
  dotenv.config({ path: path.resolve(__dirname, '../.env.qa') });
  dotenv.config({ path: path.resolve(process.cwd(), 'apps/api/.env.qa') });
  dotenv.config({ path: path.resolve(process.cwd(), '.env.qa') });

  // STRICT FAIL-CLOSED QA TARGET GUARD
  const dbUrl = process.env.DATABASE_URL || '';
  const forbiddenPatterns = ['supabase.co', 'uwycbvnqnpnfisvvbabu', 'aws-0-ap-northeast-1', '6543'];
  for (const pat of forbiddenPatterns) {
    if (dbUrl.includes(pat)) {
      console.error(`[CRITICAL ABORT] QA mode detected production database pattern: "${pat}"! Halting.`);
      process.exit(1);
    }
  }
  if (!dbUrl.includes('5433/callflow_qa')) {
    console.error('[CRITICAL ABORT] QA mode DATABASE_URL must resolve to port 5433 and database callflow_qa! Halting.');
    process.exit(1);
  }
}
```

### Layer 3: Clean Rebuild
Compiled TypeScript to `apps/api/dist/` via `npm run build` (Exit code: 0).

---

## 4. Recovered QA Backend Verification

| Check Item | Result | Exact Technical Evidence |
| :--- | :---: | :--- |
| **New Backend PID** | **11016** | `node.exe` executing `qa/launch-qa-backend.mjs`. |
| **Exact Environment File Loaded** | **PASS** | `apps/api/.env.qa` (`◇ injected env (3) from apps\api\.env.qa`). |
| **Port 3000 Status** | **PASS** | Active TCP listener on `[::]:3000` owned exclusively by PID 11016. |
| **QA Database Socket** | **PASS** | `Get-NetTCPConnection -OwningProcess 11016` confirms active socket:<br>`127.0.0.1:63774 -> 127.0.0.1:5433 (Established)`. |
| **Production Sockets** | **ZERO** | **0 connections** to port 6543, **0 connections** to `52.68.3.1`, **0 connections** to Supabase. |
| **Local Health Endpoint** | **PASS** | `GET http://127.0.0.1:3000/health` returned `HTTP 200 OK`:<br>`{"status":"healthy","timestamp":"2026-11-10T16:56:19.647Z","services":{"database":{"status":"up"}}}`. |
| **QA Workspace & Campaign Read** | **PASS** | Confirmed present in `callflow_qa` during pre-flight and verified via SQL:<br>• Workspace `5e20bafe-7306-4da7-9944-62c4c5575a5a` (`CallFlow QA Autonomous Workspace`)<br>• Campaign `6af31407-3f46-4f1d-90d0-bf08af2e9600` (`QA Autonomous Telephony Campaign`) |
| **ngrok Exposure State** | **OFFLINE** | ngrok was intentionally **NOT** started in this phase. Public tunnel remains offline until explicit authorization. |
| **QA Calling Guard** | **PASS** | `TELEPHONY_QA_ENABLED=false`, `TELNYX_QA_TRACKING_DID=""`, `TELEPHONY_QA_ALLOWED_DESTINATIONS=""`. |

---

## 5. Final Verdict

**PHASE 7B-6B — PASS**

*(The QA backend is now running safely, strictly bound to the isolated local PostgreSQL database on port 5433 with verified zero production connections. Execution has stopped per protocol).*
