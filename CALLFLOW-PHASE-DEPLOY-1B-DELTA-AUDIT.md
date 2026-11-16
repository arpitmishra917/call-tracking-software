# CALLFLOW — PHASE DEPLOY-1B DELTA AUDIT
## Post-Change Deployment Delta & Regression Audit

**Document ID:** `CALLFLOW-PHASE-DEPLOY-1B-DELTA-AUDIT`  
**Execution Date:** November 16, 2026  
**Auditor:** Antigravity Telephony & Infrastructure Agent  
**Mode:** Strict Read-Only Forensic Audit  
**Previous Baseline:** `CALLFLOW-PHASE-DEPLOY-1` (November 15, 2026)  
**Target Infrastructure:**
- **Frontend:** Vercel (Next.js 16 App Router, React 19)
- **Backend:** Render Web Service (NestJS 12, Node.js 22 LTS, Express with `rawBody: true`)
- **Database:** Supabase Managed PostgreSQL (Prisma ORM with PgBouncer Transaction Pooler)
- **Telephony Provider:** Telnyx Programmable Voice API (Call Control v2)
- **Asterisk Status:** Disarmed in production (`TELEPHONY_QA_ENABLED=false`); local QA only

**Final Verdict:** **`PLAN VALID WITH MODIFICATIONS`**

---

## 1. Previous Baseline Summary (DEPLOY-1)

In Phase DEPLOY-1, CallFlow was assessed as **`READY WITH CONDITIONS`**:
- **Builds:** NestJS API and Next.js Web builds compiled with exit code 0.
- **Telephony:** CallFlow was confirmed to operate 100% on Telnyx Call Control v2 REST API and webhooks with zero production Asterisk/ARI dependencies.
- **Database:** Supabase PostgreSQL compatibility verified across 37 migrations, connection pooling on port 6543 (`?pgbouncer=true`), and direct connection on port 5432 (`DIRECT_URL`). Zero Redis requirement identified.
- **Hosting:** Single-instance Render Web Service required due to in-memory call timers (`activeCallTimers`) and background reconciliation schedulers.
- **Conditions Set:** 5 prerequisites (Telnyx webhook URL, Telnyx public key, Render single instance, Supabase pooler URL, and QA mode disablement).

---

## 2. Git Change Inventory

### 2.1 Commit & Repository Topology
- **Current Local Branch:** `main`
- **Current Published HEAD Commit SHA:** `329ba9aa03150ebd19c0a5be7211ad3a51221e70`
- **Remote Tracking:** `origin/main` (`329ba9aa03150ebd19c0a5be7211ad3a51221e70`) — **0 ahead, 0 behind (In Sync)**
- **Release Tree SHA:** `f60046088f7936d0076c4a584c8f86e7625d56fa` (100% byte-for-byte identical to pre-sanitization tree)
- **Commits Applied Since DEPLOY-1 Audit:**
  1. `0c5d2d69` — `chore(repo): remove obsolete scripts and organize utilities` (expunged 50 root patch scripts and obsolete schema backups).
  2. `945d565d` — `docs(audit): archive historical CallFlow QA evidence` (archived QA reports into `docs/audit-archive/`).
  3. `84fc61b6` — `feat(backend): finalize CallFlow backend and commercial workflows` (finalized commercial evaluator, disputes, settlement batching, and Prisma migrations).
  4. `5b8a3342` — `feat(frontend): finalize CallFlow reporting and commercial UI` (finalized reporting, reconciliation, and payment UI).
  5. `329ba9aa` — `chore(platform): finalize infrastructure and automated tests` (standardized `.env.example`, `.gitignore`, GitHub Actions CI).

### 2.2 Working-Tree Delta Inventory
The working tree contains 10 modified tracked files and 4 new telephony source/spec files:

| Category | File Path | Status | Summary of Change |
| :--- | :--- | :---: | :--- |
| **Config** | `.env.example` | Modified | Added optional `RINGBACK_AUDIO_URL` documentation. |
| **Backend** | `apps/api/src/main.ts` | Modified | Robust `findPackageRoot` upward traversal, deterministic env precedence, fail-closed startup validation for Telnyx credentials, `BASE_URL` logging. |
| **Telephony** | `apps/api/src/telephony/call-controller.ts` | Modified | Hardened `isBridged` evaluation to inspect `call.attempts` states for preventing premature ringback tone cutoff on buyer answers. |
| **Telephony** | `apps/api/src/telephony/telephony.module.ts` | Modified | Registered `RingbackController` in module controllers. |
| **Telephony** | `apps/api/src/telephony/telephony.provider.ts` | Modified | Added `isSyntheticProviderCallId` utility and optional `isSyntheticCallId` interface method. |
| **Telephony** | `apps/api/src/telephony/telnyx/telnyx.provider.ts` | Modified | Fail-closed constructor (throws error if `TELNYX_API_KEY` missing in live mode), self-hosted US PSTN ringback URL (`${BASE_URL}/telephony/ringback.wav`), duplicate playback prevention Set (`activePlaybacks`). |
| **Telephony** | `apps/api/src/telephony/telnyx/telnyx.webhook.controller.ts` | Modified | Strict Ed25519 verification enforcement (rejects unverified webhooks unless explicit unit-test fixture flag is set), updated Telnyx SDK unwrap options. |
| **Telephony** | `apps/api/src/telephony/reservation-recovery.service.ts` | Modified | Added `activeReconciliations` lock, bounded exponential backoff retry tracker (`retryTracker`), synthetic ID deferral, 24h unresolved call observability. |
| **Telephony** | `apps/api/src/telephony/ringback.controller.ts` | **Added (New)** | HTTP controller serving `GET /telephony/ringback.wav` with `audio/wav` headers and 24h public caching. |
| **Telephony** | `apps/api/src/telephony/ringback-tone.util.ts` | **Added (New)** | Generates standard US PSTN ringback WAV (440Hz+480Hz dual tone, 2s on / 4s off, 8kHz 16-bit PCM, 96,044 bytes). |
| **Tests** | `apps/api/src/telephony/telnyx/telnyx-hotfix.spec.ts` | **Added (New)** | 12 acceptance tests for path resolution, env precedence, fail-closed credentials, ringback generation, and signature verification. |
| **Tests** | `apps/api/src/telephony/us-ringback-cadence.spec.ts` | **Added (New)** | 9 unit tests verifying PSTN acoustic cadence, spectral analysis (Goertzel), HTTP endpoint, and playback URL resolution. |
| **Tests** | `apps/api/src/telephony/telnyx/telnyx.spec.ts` | Modified | 15 unit tests updated to test strict signature enforcement and unwrap parameters. |
| **Tests** | `apps/api/src/telephony/reservation-recovery.service.spec.ts` | Modified | 13 unit tests updated with retry state and synthetic ID coverage. |

---

## 3. Backend Regression Audit

### 3.1 Production Compilation (`npm --workspace=api run build`)
- **Command:** `npm --workspace=api run build` (`nest build`)
- **Result:** **PASSED (Exit Code: 0)**
- **Output Artifacts:** Clean ES2023 output in [`apps/api/dist/`](file:///C:/Projects/callflow-agent-a/apps/api/dist/main.js), including newly compiled [`apps/api/dist/telephony/ringback.controller.js`](file:///C:/Projects/callflow-agent-a/apps/api/dist/telephony/ringback.controller.js) and [`apps/api/dist/telephony/ringback-tone.util.js`](file:///C:/Projects/callflow-agent-a/apps/api/dist/telephony/ringback-tone.util.js).

### 3.2 Automated Test Execution
- **Command:** `npx --workspace=api vitest run src/telephony/telnyx/ src/telephony/us-ringback-cadence.spec.ts src/telephony/reservation-recovery.service.spec.ts`
- **Result:** **49 passed across 4 test suites (100% Passing)**
  - `telnyx-hotfix.spec.ts`: 12 passed
  - `us-ringback-cadence.spec.ts`: 9 passed
  - `telnyx.spec.ts`: 15 passed
  - `reservation-recovery.service.spec.ts`: 13 passed

### 3.3 Startup & Fail-Closed Guard Changes
In [`apps/api/src/main.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/main.ts#L143-L177):
- If `TELEPHONY_PROVIDER=telnyx` and `TELNYX_API_KEY` is missing: **Halts startup immediately (`process.exit(1)`)**.
- If `TELEPHONY_PROVIDER=telnyx` and `TELNYX_PUBLIC_KEY` is missing: **Halts startup immediately (`process.exit(1)`)**.
- If `BASE_URL` or `RINGBACK_AUDIO_URL` points to loopback (`localhost`/`127.0.0.1`): Logs a high-visibility configuration warning indicating carrier media servers cannot reach localhost.
- In `TelnyxProvider` constructor: Throws `FATAL: TELNYX_API_KEY is missing but telephony provider is configured as "telnyx"`.

### 3.4 In-Memory State & Timer Lifecycle
- **`activeReconciliations` Set:** Added to `ReservationRecoveryService` to guard against concurrent background reconciliation of the same call ID.
- **`retryTracker` Map:** Bounded exponential backoff map in `ReservationRecoveryService` for transient provider anomalies.
- **`activePlaybacks` Set:** Added to `TelnyxProvider` to prevent duplicate `startPlayback` commands to Telnyx.
- **Single-Instance Deployment Assessment:** These new in-memory state objects reconfirm that the backend **must run on a single Render instance**.

---

## 4. Frontend Regression Audit

### 4.1 Production Compilation (`npm --workspace=web run build`)
- **Command:** `npm --workspace=web run build` (`next build` with Turbopack)
- **Result:** **FAILED (Exit Code: 1)**
- **Failure Symptom:**
  ```
  .next/dev/types/validator.ts(342,1): error TS1128: Declaration or statement expected.
  Failed to type check.
  ```

### 4.2 Forensic Investigation of the Failure
1. **Isolated Source Code Typecheck:**  
   Ran `npx --workspace=web tsc --noEmit`. The only error produced in the entire workspace was inside `.next/dev/types/validator.ts(342,1)`.  
   **Result:** **All source files in `apps/web/src/` (32 pages, layouts, and components) have ZERO TypeScript errors.**
2. **Root Cause Analysis:**  
   In [`apps/web/tsconfig.json`](file:///C:/Projects/callflow-agent-a/apps/web/tsconfig.json#L25-L32), the `include` array includes:
   ```json
   "include": [
     "next-env.d.ts",
     "**/*.ts",
     "**/*.tsx",
     ".next/types/**/*.ts",
     ".next/dev/types/**/*.ts",
     "**/*.mts"
   ]
   ```
   The file [`apps/web/.next/dev/types/validator.ts`](file:///C:/Projects/callflow-agent-a/apps/web/.next/dev/types/validator.ts#L340-L343) contains corrupted text (`sed = __Check` on line 341) left behind by an interrupted local development or shell command.
3. **Vercel Impact:**
   - `.next` is listed in [`.gitignore`](file:///C:/Projects/callflow-agent-a/apps/web/.gitignore#L17) and is **not tracked in Git**.
   - In a fresh Git clone (such as Vercel's clean build environment), `.next/dev/` does not exist, so Vercel builds will not encounter this stale artifact.
   - However, for local deployments or CI workflows caching `.next`, `apps/web/.next` must be cleared (`rm -rf apps/web/.next`) prior to running `next build`.

---

## 5. Database & Prisma Audit

### 5.1 Schema Stability
- Comparison of [`apps/api/prisma/schema.prisma`](file:///C:/Projects/callflow-agent-a/apps/api/prisma/schema.prisma) against commit `84fc61b6`: **0 lines modified (100% Identical)**.
- Prisma schema validation: `npx prisma validate --schema=apps/api/prisma/schema.prisma` returned **Exit Code 0** (`The schema at apps/api/prisma/schema.prisma is valid 🚀`).

### 5.2 Migration Inventory & Ordering
There are **37 sequential migrations** in [`apps/api/prisma/migrations/`](file:///C:/Projects/callflow-agent-a/apps/api/prisma/migrations/):
- All 37 migrations follow strict chronological naming conventions.
- Zero migrations have been added, renamed, or modified since commit `84fc61b6`.
- Obsolete temporary script artifacts (`stage16_and_18.sql` and `temp.sql`) were removed in commit `0c5d2d69`.

### 5.3 Backward Compatibility & Connection Rules
- All table alterations and foreign keys remain non-destructive.
- Render backend must connect to Supabase via port 6543 with `?pgbouncer=true` (`DATABASE_URL`).
- Prisma migrations must execute against direct port 5432 (`DIRECT_URL`).

---

## 6. Telephony Findings

### 6.1 Local US PSTN Ringback Architecture
- **Previous Architecture (DEPLOY-1):** In Phase DEPLOY-1, ringback audio was played from an external third-party CDN URL (`https://assets.mixkit.co/...`).
- **New Architecture (DEPLOY-1B):** CallFlow now synthesizes its own standard North American PSTN ringback tone in-memory:
  - Source: [`ringback-tone.util.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/ringback-tone.util.ts) (Dual 440 Hz + 480 Hz sine wave, 2.0s active / 4.0s pause, 8kHz 16-bit PCM WAV, 96,044 bytes).
  - HTTP Endpoint: [`RingbackController`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/ringback.controller.ts) at `GET /telephony/ringback.wav`.
  - Delivery: Telnyx carrier media servers fetch the ringback WAV directly from `${BASE_URL}/telephony/ringback.wav`.
- **Infrastructure Impact:** `BASE_URL` pointing to the public Render domain (e.g., `https://callflow-api.onrender.com`) is now **mandatory** for live carrier ringback audio.

### 6.2 Ed25519 Webhook Signature Security
- In [`telnyx.webhook.controller.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/telnyx/telnyx.webhook.controller.ts#L44-L64), fallback to unverified webhooks has been removed for development, QA, and production runtimes.
- Unverified ingress is rejected with `BadRequestException` unless explicitly running under `process.env.ALLOW_UNVERIFIED_WEBHOOKS === 'true'` in unit-test mock fixtures.
- Telnyx SDK unwrap invocation was updated to `{ headers: ..., key: publicKey }`, matching the Telnyx Node SDK v2 specification.

### 6.3 Asterisk & Production Isolation
- Zero production code references Asterisk.
- `TELEPHONY_QA_ENABLED=false` ensures all QA controllers and synthetic Asterisk adapters remain disabled.

---

## 7. Security Findings

1. **Fail-Closed Carrier Ingress:** Webhook ingress now enforces Ed25519 signature validation unconditionally. Any forged or unsigned webhook payload is rejected at the HTTP boundary.
2. **Git History Sanitization:** Verified commit `329ba9aa`. 8 historical diagnostic scripts containing legacy test credentials were removed from reachable history via `git-filter-repo`. GitHub Push Protection accepted the push with 0 warnings.
3. **CORS & Authentication:** Maintained from DEPLOY-1 baseline. Supabase JWKS asymmetric RS256/ES256 verification in `jwt.strategy.ts` remains active.

---

## 8. Infrastructure Changes & Matrix Update

The following configuration update must be applied to the Render environment matrix:

| Variable | Target Platform | Type | Change in DEPLOY-1B | Required Value / Format |
| :--- | :---: | :---: | :---: | :--- |
| **`BASE_URL`** | **Render** | Required | **Elevated to Required** | Public HTTPS root of the Render service (e.g. `https://callflow-api.onrender.com`). Used by Telnyx to fetch `/telephony/ringback.wav`. |
| **`RINGBACK_AUDIO_URL`** | **Render** | Optional | Added | Optional override URL if custom external ringback WAV is preferred. |
| **`TELNYX_API_KEY`** | **Render** | Required | **Now Fail-Closed at Boot** | Service exits with code 1 if omitted when `TELEPHONY_PROVIDER=telnyx`. |
| **`TELNYX_PUBLIC_KEY`** | **Render** | Required | **Now Fail-Closed at Boot** | Service exits with code 1 if omitted when `TELEPHONY_PROVIDER=telnyx`. |

---

## 9. Newly Discovered Blockers

1. **Local Build Cache Blocker (Frontend):**  
   Local execution of `npm --workspace=web run build` fails due to corrupted syntax in the untracked file `apps/web/.next/dev/types/validator.ts` generated during prior `next dev` testing.  
   *Remediation Required:* Purge `apps/web/.next` prior to local build verification.
2. **Missing `BASE_URL` Carrier Audio Degradation:**  
   If Render is deployed without `BASE_URL` set to the public service domain, Telnyx will attempt to fetch `http://localhost:3000/telephony/ringback.wav`, causing ringback tone silence for inbound callers during buyer hunting.

---

## 10. Previous Blockers Resolved

1. **Third-Party Ringback Dependency:** CallFlow previously relied on an external CDN (`mixkit.co`) for ringback tone streaming. This dependency has been eliminated in favor of a compliant, self-hosted in-memory PSTN WAV synthesizer.
2. **Unverified Webhook Ingress in Non-Production Modes:** Permissive webhook signature verification has been eliminated. The webhook controller now strictly validates Ed25519 signatures across all non-test runtimes.
3. **Git History Credential Exposure:** Historical commits containing diagnostic scripts have been purged and verified on `origin/main`.

---

## 11. Updated Deployment Checklist

### Phase 1: Database Deployment (Supabase)
1. Ensure Supabase project is active.
2. Run database migrations:
   ```bash
   npx prisma migrate deploy --schema=apps/api/prisma/schema.prisma
   ```

### Phase 2: Backend Web Service Deployment (Render)
1. Create Render Web Service pointing to repository root.
2. **Build Command:** `npm install && npm run build:api`
3. **Start Command:** `node apps/api/dist/main.js`
4. **Health Check Path:** `/health/live`
5. **Instance Count:** Exactly `1` (Single instance, Always-on `Starter` plan or higher).
6. **Configure Environment Variables:**
   - `NODE_ENV=production`
   - `PORT=10000`
   - `DATABASE_URL=postgresql://postgres:[PASSWORD]@[HOST]:6543/postgres?pgbouncer=true`
   - `DIRECT_URL=postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres`
   - `SUPABASE_URL=https://[PROJECT-REF].supabase.co`
   - `JWT_SECRET=[SUPABASE-JWT-SECRET]`
   - `TELEPHONY_PROVIDER=telnyx`
   - `TELNYX_API_KEY=[TELNYX-V2-API-KEY]` *(Mandatory at boot)*
   - `TELNYX_PUBLIC_KEY=[TELNYX-ED25519-PUBLIC-KEY]` *(Mandatory at boot)*
   - `BASE_URL=https://[YOUR-RENDER-SERVICE-NAME].onrender.com` *(Mandatory for ringback audio)*
   - `TELEPHONY_QA_ENABLED=false`

### Phase 3: Telephony Carrier Configuration (Telnyx Portal)
1. In Telnyx Mission Control Portal -> **Voice -> Call Control Applications**:
   - Set **Webhook URL** to `https://[YOUR-RENDER-SERVICE-NAME].onrender.com/webhooks/telnyx`.
   - Set **API Version** to `API v2`.
   - Copy the application **Public Key** into Render's `TELNYX_PUBLIC_KEY` variable.
2. Assign inbound DID numbers to the Call Control Application.

### Phase 4: Frontend Deployment (Vercel)
1. Clear local build cache if building locally:
   ```powershell
   Remove-Item -Recurse -Force apps/web/.next
   ```
2. In Vercel Project Settings:
   - **Root Directory:** `apps/web`
   - **Framework Preset:** Next.js
   - **Build Command:** `next build`
3. **Configure Frontend Environment Variables:**
   - `NEXT_PUBLIC_API_URL=https://[YOUR-RENDER-SERVICE-NAME].onrender.com`
   - `NEXT_PUBLIC_SUPABASE_URL=https://[PROJECT-REF].supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY=[SUPABASE-ANON-KEY]`

---

## 12. Final Verdict

### Verdict: **`PLAN VALID WITH MODIFICATIONS`**

**Justification:**  
The architectural decisions, database models, and telephony foundation established in DEPLOY-1 remain completely sound. The recent code modifications strengthen carrier robustness and webhook security. However, the deployment plan requires the following mandatory modifications:
1. **Add `BASE_URL` to Render:** Required to serve the self-hosted US PSTN ringback tone endpoint to Telnyx media servers.
2. **Enforce Startup Keys on Render:** `TELNYX_API_KEY` and `TELNYX_PUBLIC_KEY` must be populated prior to initial service start to satisfy the new fail-closed startup validation guards.
3. **Frontend Cache Hygiene:** Local build verification requires purging `apps/web/.next` to remove the stale `.next/dev/types/validator.ts` artifact before invoking `next build`.
