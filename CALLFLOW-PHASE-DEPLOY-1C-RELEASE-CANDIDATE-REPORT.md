# CALLFLOW — PHASE DEPLOY-1C RELEASE CANDIDATE REPORT
## Release Candidate Verification, Git Publication & Deployment Gate

**Document ID:** `CALLFLOW-PHASE-DEPLOY-1C-RELEASE-CANDIDATE-REPORT`  
**Execution Date:** November 16, 2026  
**Auditor / Release Engineer:** Antigravity Telephony & Infrastructure Agent  
**Execution Mode:** Authorized Repository Work + Strict Production Safety  
**Previous Baselines:** `DEPLOY-1` (November 15, 2026), `DEPLOY-1B` (November 16, 2026)  
**Target Infrastructure:**
- **Frontend:** Vercel (Next.js 16.3.5 App Router, React 19.2.8)
- **Backend:** Render Web Service (NestJS 12, Node.js 22 LTS, Express with `rawBody: true`)
- **Database:** Supabase Managed PostgreSQL (Prisma ORM with PgBouncer Transaction Pooler)
- **Telephony Provider:** Telnyx Programmable Voice API (Call Control v2)
- **Asterisk Status:** Disarmed in production (`TELEPHONY_QA_ENABLED=false`); local QA only

---

## 1. Executive Verdict

### Final Status: **`DEPLOY-1C RELEASE CANDIDATE VERIFIED`**

| Gate / Requirement | Status | Evidence & Verification Metric |
| :--- | :---: | :--- |
| **All Approved Source Changes Committed & Pushed** | **`PASS`** | Commit `004d1806` pushed and accepted by `origin/main` without force-push. |
| **Local & Remote HEAD Synchronization** | **`PASS`** | Local HEAD and `origin/main` match exactly at `004d180656b4862f07b7d5022426bc72b6d7f626`. |
| **Working Tree Cleanliness** | **`PASS`** | `git status --short` is empty; working tree is 100% clean. |
| **Backend Production Build** | **`PASS`** | `npm --workspace=api run build` succeeded with **Exit Code 0** (`apps/api/dist/main.js` generated). |
| **Frontend Clean Production Build** | **`PASS`** | After purging `.next`, `npm --workspace=web run build` compiled 38 routes with **Exit Code 0**; `tsc --noEmit` exited **0**. |
| **Telephony Regression Test Coverage** | **`PASS`** | All 4 test suites passed: **62 of 62 unit and acceptance tests passed (100%)**. |
| **Ringback Production URL Fail-Closed** | **`PASS`** | `validatePublicHttpsUrl` in `main.ts` fails closed on loopbacks, private IPs, non-HTTPS, or credentials in production. |
| **Webhook Security Test Matrix** | **`PASS`** | Positive and negative tests passed (rejection on missing headers, tampered payloads, expired timestamps, and production bypass). |
| **Prisma Schema & Migration Integrity** | **`PASS`** | 37 migrations chronologically ordered; `npx prisma validate` passed with **Exit Code 0**. |
| **Frozen Business Logic Isolation** | **`PASS`** | Zero changes to commercial evaluation, wallet debit arithmetic, dispute lifecycles, or waterfall routing models. |
| **Zero Unauthorized Production Action** | **`PASS`** | No live carrier calls, no production database mutations, no premature cloud deployments. |

---

## 2. Initial Git State & Forensic Resolution

### 2.1 State at DEPLOY-1B Hand-off
At the conclusion of DEPLOY-1B, the repository was in the following state:
- Local branch: `main` tracking `origin/main` at baseline commit `329ba9aa03150ebd19c0a5be7211ad3a51221e70`.
- Working tree contained 10 modified tracked files and untracked QA test files.
- Stale development cache `apps/web/.next` contained a syntax error in `.next/dev/types/validator.ts` generated during an interrupted local `next dev` session.

### 2.2 Resolution of Discrepancies
1. **Committed Initial Enhancements (`4e3a6703`):**  
   At 07:40:24, commit `4e3a67036cd3ee6036e1b947434deedc6d75f491` consolidated telephony ringback endpoints, QA harness boundaries, and test scripts.
2. **Post-Audit Hardening Commit (`004d1806`):**  
   To resolve the outstanding deployment gates identified in DEPLOY-1B, strict production URL validation was added to `main.ts`, silent fallbacks were eliminated in `telnyx.provider.ts`, webhook bypasses were restricted strictly to isolated test suites, and 13 comprehensive security tests were incorporated.

---

## 3. Changed Files Reviewed

| File Path | Purpose / Category | Review Finding & Safety Assessment |
| :--- | :--- | :--- |
| [`.env.example`](file:///C:/Projects/callflow-agent-a/.env.example) | Configuration Template | Added documentation for `JWT_SECRET` (fallback HS256 auth) and `RINGBACK_AUDIO_URL`. Zero secrets present. |
| [`apps/api/src/main.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/main.ts) | Backend Entrypoint | Added `validatePublicHttpsUrl` helper; enforces valid public HTTPS for `BASE_URL` and `RINGBACK_AUDIO_URL` under production Telnyx mode. Fails fast (`process.exit(1)`). |
| [`apps/api/src/telephony/telnyx/telnyx.provider.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/telnyx/telnyx.provider.ts) | Telephony Adapter | Throws fatal exception in production if `BASE_URL` and `RINGBACK_AUDIO_URL` are missing. Eliminates silent `localhost:3000` fallback. |
| [`apps/api/src/telephony/telnyx/telnyx.webhook.controller.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/telnyx/telnyx.webhook.controller.ts) | Webhook Ingress | Scopes `ALLOW_UNVERIFIED_WEBHOOKS` bypass strictly to `NODE_ENV === 'test' && !APP_ENV`. Bypasses cannot activate in production. |
| [`apps/api/src/telephony/telnyx/telnyx-hotfix.spec.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/telnyx/telnyx-hotfix.spec.ts) | Acceptance Tests | Expanded from 12 to 25 tests covering public HTTPS URL validation, private IP rejection, missing headers, tampered payloads, timestamp replay, and production bypass attempts. |
| [`apps/api/src/telephony/ringback.controller.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/ringback.controller.ts) | Web Audio Controller | Exposes `GET /telephony/ringback.wav` serving 16-bit 8kHz PCM WAV with `Cache-Control: public, max-age=86400`. |
| [`apps/api/src/telephony/ringback-tone.util.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/ringback-tone.util.ts) | PSTN Synthesizer | Generates standard US ringback cadence (440Hz+480Hz dual tone, 2s active / 4s silence, 96,044 bytes). |

---

## 4. Files Cleaned or Modified

1. **Purged Build Cache:**  
   `apps/web/.next` was completely removed via `Remove-Item -Recurse -Force apps/web/.next`. The corrupted generated file `apps/web/.next/dev/types/validator.ts` was expunged.
2. **Source Code Modifications:**  
   Only the 5 approved deployment-related files listed in Section 3 were modified. No commercial, billing, or settlement files were touched.

---

## 5. Final Commit SHA & Remote Synchronization

- **Commit SHA:** `004d180656b4862f07b7d5022426bc72b6d7f626`
- **Commit Message:**
  ```
  feat(telephony): harden production ringback URL validation and webhook security
  
  - Add validatePublicHttpsUrl in main.ts enforcing public HTTPS for BASE_URL and RINGBACK_AUDIO_URL
  - Prevent silent localhost fallback in TelnyxProvider under production
  - Restrict ALLOW_UNVERIFIED_WEBHOOKS exclusively to isolated test environments
  - Expand telnyx-hotfix acceptance tests with full webhook security matrix and URL validators
  - Document JWT_SECRET in .env.example
  ```
- **Remote Branch:** `origin/main` (`https://github.com/arpitmishra917/call-tracking-software.git`)
- **Remote Synchronization Status:** **`PASS`** (`git rev-parse HEAD` == `git rev-parse origin/main`).
- **Working Tree Status:** **`CLEAN`** (`git status --short` output is empty).

---

## 6. Frontend Build Result

- **Build Command:** `npm --workspace=web run build` (`next build` with Turbopack)
- **Status:** **`PASS` (Exit Code: 0)**
- **Next.js Version:** `16.3.5` (Turbopack)
- **React Version:** `19.2.8`
- **React DOM Version:** `19.2.8`
- **TypeScript Verification:** `npx --workspace=web tsc --noEmit` exited **0** (0 errors).
- **Route Compilation Summary:** **38 application routes** compiled and prerendered:
  - Static Pages: 10 static paths generated in 1214ms.
  - Dynamic Routes: 28 server/dynamic routes verified.

---

## 7. Backend Build Result

- **Build Command:** `npm --workspace=api run build` (`nest build`)
- **Status:** **`PASS` (Exit Code: 0)**
- **Runtime Target:** Node.js 22 LTS / ES2023
- **Artifact Verification:**
  - `apps/api/dist/main.js` (Compiled entrypoint)
  - `apps/api/dist/telephony/ringback.controller.js` (Present in build output)
  - `apps/api/dist/telephony/ringback-tone.util.js` (Present in build output)

---

## 8. Test Suite Results and Counts

Command executed:
```bash
npx --workspace=api vitest run src/telephony/telnyx/ src/telephony/us-ringback-cadence.spec.ts src/telephony/reservation-recovery.service.spec.ts
```

| Test Suite File | Tests Passed | Tests Failed | Execution Time | Coverage Focus |
| :--- | :---: | :---: | :---: | :--- |
| `src/telephony/telnyx/telnyx-hotfix.spec.ts` | 25 | 0 | 112 ms | Path resolution, fail-closed credentials, URL validators, webhook security matrix |
| `src/telephony/us-ringback-cadence.spec.ts` | 9 | 0 | 3,592 ms | PSTN 440Hz+480Hz spectral Goertzel analysis, 2s/4s cadence, WAV headers, caching |
| `src/telephony/telnyx/telnyx.spec.ts` | 15 | 0 | 944 ms | Call Control v2 REST actions (answer, dial, bridge, hangup), signature unwrap |
| `src/telephony/reservation-recovery.service.spec.ts` | 13 | 0 | 212 ms | Exponential retry backoff, concurrency locking, synthetic call ID deferral |
| **TOTAL** | **62** | **0** | **18.48 s** | **100% Passing** |

---

## 9. Ringback Production URL Validation Result

Function verified: [`validatePublicHttpsUrl`](file:///C:/Projects/callflow-agent-a/apps/api/src/main.ts#L128-L175)

| Validation Scenario | Input Value | Expected Behavior | Actual Result | Status |
| :--- | :--- | :--- | :--- | :---: |
| **Valid Public Production Domain** | `https://callflow-api.onrender.com` | Accepted | Returns `https://callflow-api.onrender.com` | **`PASS`** |
| **Valid Custom CDN URL** | `https://cdn.example.com/audio/ringback.wav` | Accepted | Returns `https://cdn.example.com` | **`PASS`** |
| **Missing URL Parameter** | `undefined` or `""` | Throws error | Throws `[CRITICAL STARTUP ERROR] BASE_URL is missing` | **`PASS`** |
| **Plain HTTP Protocol** | `http://callflow-api.onrender.com` | Throws error | Throws `must use HTTPS protocol` | **`PASS`** |
| **Localhost / Loopback** | `https://localhost:3000` | Throws error | Throws `resolves to a loopback or private network address` | **`PASS`** |
| **IPv4 Loopback** | `https://127.0.0.1:10000` | Throws error | Throws `resolves to a loopback or private network address` | **`PASS`** |
| **IPv6 Loopback** | `https://[::1]:3000` | Throws error | Throws `resolves to a loopback or private network address` | **`PASS`** |
| **Private IP (RFC 1918 10.x)** | `https://10.0.0.1:3000` | Throws error | Throws `resolves to a loopback or private network address` | **`PASS`** |
| **Private IP (RFC 1918 192.168.x)** | `https://192.168.1.1` | Throws error | Throws `resolves to a loopback or private network address` | **`PASS`** |
| **Private IP (RFC 1918 172.16.x)** | `https://172.16.0.1` | Throws error | Throws `resolves to a loopback or private network address` | **`PASS`** |
| **Link-Local IP (169.254.x)** | `https://169.254.169.254` | Throws error | Throws `resolves to a loopback or private network address` | **`PASS`** |
| **Embedded Credentials** | `https://user:pass@api.callflow.com` | Throws error | Throws `must not contain embedded credentials` | **`PASS`** |

---

## 10. WAV Endpoint & Format Validation

Endpoint verified: [`RingbackController`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/ringback.controller.ts) at `GET /telephony/ringback.wav`

- **HTTP Status:** 200 OK
- **Content-Type:** `audio/wav`
- **Payload Length:** Exactly `96,044` bytes (44-byte RIFF header + 96,000 bytes PCM audio)
- **Audio Format:** Linear PCM (Format Tag: `0x0001`)
- **Channels:** `1` (Mono)
- **Sample Rate:** `8,000` Hz (8 kHz PSTN narrowband)
- **Bits Per Sample:** `16` bits
- **Acoustic Cadence (US Standard):**
  - Active Tone Duration: `2.0` seconds (samples 0 to 16,000)
  - Silent Pause Duration: `4.0` seconds (samples 16,000 to 48,000)
  - Total Period: `6.0` seconds (48,000 samples)
- **Spectral Verification (Goertzel Algorithm):**
  - Dual Tone Frequencies: `440` Hz and `480` Hz verified with power $> 0.01$.
  - Unrepresented Frequencies (e.g. 1000 Hz): Power $< 0.0001$ ($>40$ dB suppression).
  - Silence Segment Amplitude: Peak absolute value $= 0$ (exact digital silence).
- **HTTP Caching Behavior:**
  - Header: `Cache-Control: public, max-age=86400`
  - Effect: Remote Telnyx media edge servers cache the ringback audio for 24 hours after the first inbound call, eliminating redundant bandwidth consumption and HTTP round-trips.
- **Environment Qualification:** **`PASS (Local Endpoint Verified)`** / **`NOT VERIFIED (Public Render Endpoint)`** (Public verification pending actual Render deployment).

---

## 11. Telnyx Webhook Security Test Matrix

Controller verified: [`TelnyxWebhookController`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/telnyx/telnyx.webhook.controller.ts)

| Security Test Case | Scenario / Condition | Expected Result | Actual Result | Status |
| :--- | :--- | :--- | :--- | :---: |
| **1. Valid Signature** | Authentic Ed25519 signature + valid timestamp | HTTP 200 OK | Processed and dispatched to CallController | **`PASS`** |
| **2. Invalid Signature** | Tampered or forged Ed25519 signature | HTTP 400 Bad Request | Rejected with `Signature verification failed` | **`PASS`** |
| **3. Missing Signature Header** | `telnyx-signature-ed25519` omitted | HTTP 400 Bad Request | Rejected with `Missing webhook signature headers or body` | **`PASS`** |
| **4. Missing Timestamp Header** | `telnyx-timestamp` omitted | HTTP 400 Bad Request | Rejected with `Missing webhook signature headers or body` | **`PASS`** |
| **5. Tampered Body** | Signature generated for body A, body B sent | HTTP 400 Bad Request | Rejected with `Signature verification failed` | **`PASS`** |
| **6. Expired Timestamp** | Webhook timestamp $> 300$ seconds old | HTTP 400 Bad Request | Rejected with `Webhook timestamp too old or too new` | **`PASS`** |
| **7. Future Timestamp** | Webhook timestamp $> 300$ seconds in future | HTTP 400 Bad Request | Rejected with `Webhook timestamp too old or too new` | **`PASS`** |
| **8. Production Bypass Attempt** | `NODE_ENV=production` + `ALLOW_UNVERIFIED_WEBHOOKS=true` | HTTP 400 Bad Request | Rejected with `TELNYX_PUBLIC_KEY is required` | **`PASS`** |

---

## 12. In-Memory Timer and Recovery Assessment

| State / Schedulers | Lifecycle Management | Concurrency Protection | Restart Recovery Capability |
| :--- | :--- | :--- | :--- |
| **`activeCallTimers`** | Added on answer; cleared via `clearTimeout` on caller/buyer hangup or error. | Keyed by unique `callId`. | Active calls are stored in DB. Stale calls are reconciled by `ReservationRecoveryService` upon boot. |
| **`activePlaybacks`** | Added on `startRingback`; deleted on `stopRingback` or API exception. | Keyed by `callId` (prevents duplicate `startPlayback` REST calls). | Ephemeral per-call state; naturally reset on restart. |
| **`activeReconciliations`** | Added when call reconciliation begins; cleared in `finally` block unconditionally. | Protects single-call reconciliation from overlapping cron runs. | In-flight batch clears on restart; subsequent cron picks up unresolved reservations. |
| **`retryTracker`** | Bounded exponential backoff map (5m initial, 1h max ceiling). Cleared on resolution. | Keyed by `callId`; skips calls until `nextRecoveryAt`. | Reconstructs dynamically on subsequent passes; warns on calls $>24$ hours old. |
| **Single-Instance Restriction** | **MANDATORY**: Backend must run on a **single Render Web Service** instance to keep in-memory timers unified. |

---

## 13. Prisma Schema & Migration Assessment

- **Schema File:** [`apps/api/prisma/schema.prisma`](file:///C:/Projects/callflow-agent-a/apps/api/prisma/schema.prisma)
- **Validation Command:** `npx prisma validate --schema=apps/api/prisma/schema.prisma`
- **Result:** **`PASS` (Exit Code: 0)**
- **Migration Directory:** [`apps/api/prisma/migrations/`](file:///C:/Projects/callflow-agent-a/apps/api/prisma/migrations/)
- **Total Migrations:** **37 chronologically ordered migrations** (from `20260921024015_init_stage4` to `20261107120000_buyer_org_and_destination_number_foundation`).
- **Migration Execution Command:**
  ```bash
  npx prisma migrate deploy --schema=apps/api/prisma/schema.prisma
  ```
- **Connection Configuration:**
  - `DATABASE_URL`: Must connect to Supabase PgBouncer on port `6543` with `?pgbouncer=true`.
  - `DIRECT_URL`: Must connect to Supabase direct PostgreSQL on port `5432` for running migrations.

---

## 14. Final Render Environment Matrix

All variables below must be configured in the Render Dashboard (**Environment Variables** section):

| Variable Name | Required / Optional | Secret | Expected Value / Format | Purpose |
| :--- | :---: | :---: | :--- | :--- |
| `NODE_ENV` | **Required** | No | `production` | Enables production optimizations and security checks. |
| `PORT` | **Required** | No | `10000` | Port provided dynamically by Render runtime. |
| `BASE_URL` | **Required** | No | `https://[YOUR-SERVICE].onrender.com` | **Mandatory.** Public HTTPS origin for carrier ringback WAV fetching. |
| `TELEPHONY_PROVIDER` | **Required** | No | `telnyx` | Activates native Telnyx Call Control v2 engine. |
| `TELNYX_API_KEY` | **Required** | **Yes** | `KEY01...` | Telnyx v2 REST API authorization key (fails closed at boot). |
| `TELNYX_PUBLIC_KEY` | **Required** | No | `[Base64 32-byte Ed25519 key]` | Telnyx webhook signature verification key (fails closed at boot). |
| `DATABASE_URL` | **Required** | **Yes** | `postgresql://postgres:[PWD]@[HOST]:6543/postgres?pgbouncer=true` | Supabase transaction pooler connection. |
| `DIRECT_URL` | **Required** | **Yes** | `postgresql://postgres:[PWD]@[HOST]:5432/postgres` | Direct connection for `prisma migrate deploy`. |
| `SUPABASE_URL` | **Required** | No | `https://[PROJECT-REF].supabase.co` | Supabase JWKS verification for RS256/ES256 auth tokens. |
| `JWT_SECRET` | Optional | **Yes** | `[Supabase Legacy JWT Secret]` | Fallback verification for HS256 JWT tokens. |
| `TELEPHONY_QA_ENABLED` | **Required** | No | `false` | **Mandatory.** Disables all Asterisk/ARI simulation endpoints. |
| `RINGBACK_AUDIO_URL` | Optional | No | `https://...` | Optional override URL if custom external WAV is preferred. |
| `STRIPE_SECRET_KEY` | Optional | **Yes** | `sk_live_...` | Optional: Workspace balance top-up payments. |
| `STRIPE_WEBHOOK_SECRET` | Optional | **Yes** | `whsec_...` | Optional: Stripe webhook validation. |

---

## 15. Final Vercel Configuration

Configure in Vercel Project Settings (**apps/web**):

- **Framework Preset:** Next.js
- **Root Directory:** `apps/web`
- **Build Command:** `next build`
- **Output Directory:** `.next`
- **Environment Variables:**
  - `NEXT_PUBLIC_API_URL=https://[YOUR-SERVICE].onrender.com`
  - `NEXT_PUBLIC_SUPABASE_URL=https://[PROJECT-REF].supabase.co`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY=[SUPABASE-ANON-KEY]`

---

## 16. Outstanding Production-Only Checks

The following operations are **not authorized** during local release candidate engineering and must be executed in production:

1. **`NOT VERIFIED (Production Database Connectivity)`**: Live network connection from Render to Supabase PgBouncer pooler (`6543`).
2. **`NOT VERIFIED (Production Migration Status)`**: Applying unapplied migrations to live Supabase database (`prisma migrate deploy`).
3. **`NOT VERIFIED (Public Render Endpoint Ingress)`**: External HTTPS accessibility of `/health/live` and `/telephony/ringback.wav` from outside Render's private network.
4. **`NOT VERIFIED (Live Carrier Call Control)`**: Real PSTN inbound call routing from a physical handset via Telnyx to a buyer destination.

---

## 17. Known Limitations

1. **Single-Instance Render Deployment Constraint:**  
   Because call timer extensions (`activeCallTimers`) and ringback playback tracking (`activePlaybacks`) are maintained in memory, the backend service must run as a single Render Web Service instance. Horizontal multi-instance scaling requires distributed Redis timer infrastructure.
2. **Local Build Cache Sensitivity:**  
   Because `apps/web/tsconfig.json` includes `.next/dev/types/**/*.ts`, running `next dev` locally can deposit stale typings. If local frontend build failures recur, `apps/web/.next` must be cleared prior to running `next build`. (Clean Git clones on Vercel are immune).

---

## 18. Exact Next Authorized Deployment Steps

```mermaid
flowchart TD
    Step1["Step 1: Run Supabase Database Backup in Supabase Dashboard"] --> Step2
    Step2["Step 2: Run Prisma Migrations (npx prisma migrate deploy)"] --> Step3
    Step3["Step 3: Deploy Render Web Service (Single Instance, Always-On)"] --> Step4
    Step4["Step 4: Verify Render Health Check (/health/live returns 200)"] --> Step5
    Step5["Step 5: Configure Telnyx Portal Call Control App Webhook URL"] --> Step6
    Step6["Step 6: Deploy Vercel Frontend (apps/web)"] --> Step7
    Step7["Step 7: Perform End-to-End Production Smoke Test"]
```

### Step-by-Step Runbook:
1. **Supabase Backup:** In Supabase Dashboard -> **Database -> Backups**, take a point-in-time manual snapshot.
2. **Execute Migrations:**
   ```bash
   npx prisma migrate deploy --schema=apps/api/prisma/schema.prisma
   ```
3. **Deploy Backend to Render:**
   - Connect GitHub repository `arpitmishra917/call-tracking-software`.
   - Branch: `main` (points to `004d1806`).
   - Root Directory: `.` (leave empty / repository root).
   - Build Command: `npm install && npm run build:api`.
   - Start Command: `node apps/api/dist/main.js`.
   - Set Environment Variables as cataloged in Section 14.
4. **Configure Telnyx Call Control Application:**
   - In Telnyx Mission Control Portal -> **Voice -> Call Control Applications**:
     - Webhook URL: `https://[YOUR-RENDER-APP].onrender.com/webhooks/telnyx`
     - Webhook API Version: `API v2`
     - Ensure Public Key matches `TELNYX_PUBLIC_KEY` on Render.
5. **Deploy Frontend to Vercel:**
   - Import repository, set root directory to `apps/web`.
   - Set `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
6. **Execute Smoke Test:**
   - Verify `/health/live` returns HTTP 200 `{ "status": "ok" }`.
   - Verify `GET /telephony/ringback.wav` returns HTTP 200 with `Content-Type: audio/wav`.
   - Test user login and dashboard reporting on Vercel.
