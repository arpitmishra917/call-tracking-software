# CALLFLOW — PHASE DEPLOY-2 REPORT
## Render Production Backend Deployment Readiness Audit

**Audit Execution Date:** 2026-11-16  
**Repository:** [C:\Projects\callflow-agent-a](file:///C:/Projects/callflow-agent-a)  
**Branch:** `main`  
**Git Commit SHA:** `004d180656b4862f07b7d5022426bc72b6d7f626` (Synchronized with `origin/main`)  
**Deployment Platform:** Render Web Service  
**Runtime:** Node.js 22 LTS  
**Backend Framework:** NestJS 12 (`@nestjs/core: ^12.0.1`)  
**Database Provider:** Supabase Managed PostgreSQL 17.11 (Tokyo `ap-northeast-1`)  
**Mode:** STRICT READ-ONLY FORENSIC AUDIT (Zero code modifications, zero DB mutations, zero live carrier calls)  
**Overall Deployment Readiness Verdict:** **`RENDER DEPLOYMENT BLOCKED`**

---

## 1. Executive Verdict & Summary

```
========================================================================================
FINAL AUDIT VERDICT: RENDER DEPLOYMENT BLOCKED
========================================================================================
```

The CallFlow backend codebase has been audited for production deployment readiness to Render Web Services using Supabase PostgreSQL 17.11 and Telnyx Call Control v2.

### Critical Blocker Discovered
During forensic inspection of the NestJS database bootstrap lifecycle, a **critical regression** was discovered in [apps/api/src/prisma/prisma.service.ts](file:///C:/Projects/callflow-agent-a/apps/api/src/prisma/prisma.service.ts#L13-L18). In commit `84fc61b6`, test-isolation guards (`stripProductionEnvironmentVariables()` and `assertNonProductionDatabase()`) were added **unconditionally** to `PrismaService.onModuleInit()`. 

When the backend connects to the production Supabase database:
1. `stripProductionEnvironmentVariables()` runs, detects production Supabase patterns in `DATABASE_URL` (`aws-0-ap-northeast-1`, `pooler.supabase.com`, `6543`, `uwycbvnqnpnfisvvbabu`), and deletes `process.env.SUPABASE_URL` from the process environment.
2. `assertNonProductionDatabase(process.env.DATABASE_URL)` runs, evaluates `FORBIDDEN_PRODUCTION_PATTERNS` in [apps/api/src/common/database-isolation.util.ts](file:///C:/Projects/callflow-agent-a/apps/api/src/common/database-isolation.util.ts#L5-L11), detects the production host, and throws a `ForbiddenException`.
3. This unhandled exception immediately halts the NestJS application initialization, causing a startup crash-loop on Render.

Because this audit is governed by strict read-only rules, **no source code changes were made**. This blocker must be resolved by wrapping the database isolation assertions inside an explicit QA/test environment check before deploying to Render.

### Audit Summary Matrix

| Audit Dimension | Status | Key Forensic Finding |
| :--- | :---: | :--- |
| **1. Git Release & Integrity** | **PASS** | `main` at `004d1806`, matches `origin/main`, clean working tree, no tracked secrets. |
| **2. Render Build & Startup** | **PASS** | Validated reproducible build (`npm ci`), Prisma generation, NestJS compilation, and entry point `node dist/main.js`. |
| **3. Environment Variables** | **PASS** | Comprehensive 16-variable matrix documented. Public HTTPS validation strictly enforced in production. |
| **4. Telnyx Webhook Route** | **PASS** | **Mandatory Gate Resolved**: Route is unambiguously `/webhooks/telnyx`. `/telephony/telnyx/events` does not exist. |
| **5. Health Checks & Recovery** | **PASS** | Liveness probe `/health/live` returns HTTP 200 immediately. Recovery loop safely cleans stale reservations. |
| **6. Database Safeguards** | **BLOCKED** | **CRITICAL BLOCKER**: `PrismaService.onModuleInit()` throws `ForbiddenException` against production Supabase targets. |
| **7. CORS & Auth Integration** | **PASS** | CORS allows `process.env.FRONTEND_URL`. JWKS/JWT strategies verified. Password reset points to frontend origin. |
| **8. Instance Topology** | **PASS** | Exactly **1 always-on instance** required due to in-memory call timers and recovery maps. |

---

## 2. Git & Release Verification

Forensic inspection of the local and remote repository state confirmed strict adherence to release candidate requirements:

- **Current Branch:** `main`
- **Current HEAD Commit SHA:** `004d180656b4862f07b7d5022426bc72b6d7f626`
- **Remote Tracking Commit (`origin/main`):** `004d180656b4862f07b7d5022426bc72b6d7f626`
- **Synchronization Delta:** Local HEAD is identical to `origin/main` (`git rev-parse HEAD == git rev-parse origin/main`).
- **Working Tree State:** Clean for all tracked repository files (`git status --porcelain` showed zero tracked modifications).
- **Tracked Environment Files:** Audited via `git ls-files "*env*"`. Only safe templates [`.env.example`](file:///C:/Projects/callflow-agent-a/.env.example) and [`apps/web/.env.example`](file:///C:/Projects/callflow-agent-a/apps/web/.env.example) are committed. No secrets, credentials, or actual `.env` files are tracked.
- **Physical Backups Protection:** The pre-deployment database backup created in DB-DEPLOY-1 is confirmed ignored by Git via `.gitignore` (`git check-ignore backups/...` returned code 0).

---

## 3. Render Build & Startup Verification

### Monorepo Structure & Workspace Topology
- **Root Workspace:** Defined in [package.json](file:///C:/Projects/callflow-agent-a/package.json#L6-L8) with `"workspaces": ["apps/*"]`.
- **Backend Application Root:** [apps/api/package.json](file:///C:/Projects/callflow-agent-a/apps/api/package.json).
- **Module Format:** `"type": "module"` (ESM native).
- **TypeScript Target:** ES2023 with `NodeNext` module resolution ([apps/api/tsconfig.json](file:///C:/Projects/callflow-agent-a/apps/api/tsconfig.json#L3-L4)).
- **Output Directory:** `./dist` (compiled JavaScript artifacts).
- **Entry Point:** [dist/main.js](file:///C:/Projects/callflow-agent-a/apps/api/dist/main.js) (generated from [apps/api/src/main.ts](file:///C:/Projects/callflow-agent-a/apps/api/src/main.ts)).

### Lockfile & `npm ci` Reproducibility
- The monorepo has a committed [package-lock.json](file:///C:/Projects/callflow-agent-a/package-lock.json) at the root (lockfileVersion: 3, 666,600 bytes).
- In addition, [apps/api/package-lock.json](file:///C:/Projects/callflow-agent-a/apps/api/package-lock.json) is committed inside the API directory.
- `npm ci` is fully supported in both root and `apps/api` modes.

### Exact Render Build & Start Commands

Depending on whether Render is configured with Root Directory as `apps/api` or monorepo root `.`:

#### Option A: Root Directory set to `apps/api` (Recommended for Render)
- **Root Directory:** `apps/api`
- **Build Command:**
  ```bash
  npm ci && npx prisma generate && npm run build
  ```
- **Start Command:**
  ```bash
  npm run start:prod
  ```
  *(Executes `node dist/main` per `apps/api/package.json:16`)*

#### Option B: Root Directory set to `.` (Monorepo Root)
- **Root Directory:** `.`
- **Build Command:**
  ```bash
  npm ci && npx prisma generate --schema=apps/api/prisma/schema.prisma && npm --workspace=api run build
  ```
- **Start Command:**
  ```bash
  npm --workspace=api run start:prod
  ```

### Port Handling & Interface Binding
- In [apps/api/src/main.ts#L307](file:///C:/Projects/callflow-agent-a/apps/api/src/main.ts#L307):
  ```typescript
  await app.listen(process.env.PORT ?? 3000);
  ```
- Render injects `process.env.PORT` dynamically (typically port 10000). The application reads `process.env.PORT` directly.
- In Node.js on Linux, omitting the host parameter binds the server to `::` (IPv6 all-interfaces dual stack), which automatically accepts incoming IPv4 connections on `0.0.0.0`.
- *Recommendation:* When remediating the blocker, explicitly passing `'0.0.0.0'` (`await app.listen(process.env.PORT ?? 3000, '0.0.0.0')`) eliminates any host resolution ambiguity.

---

## 4. Production Environment Variable Matrix

The following matrix documents all 16 variables audited directly from actual source code consumers:

| Variable Name | Target Scope | Required / Optional | Sensitive | Expected Format | Source Consumer (File & Line) | Default / Fallback Behavior | Startup Failure if Missing? |
| :--- | :--- | :--- | :---: | :--- | :--- | :--- | :---: |
| **`NODE_ENV`** | Render | Required | No | String (`production`) | [main.ts#L218](file:///C:/Projects/callflow-agent-a/apps/api/src/main.ts#L218), [auth.controller.ts#L61](file:///C:/Projects/callflow-agent-a/apps/api/src/auth/auth.controller.ts#L61) | Defaults to `development` if unset. | No (runs in dev mode) |
| **`PORT`** | Render | Required (Injected by Render) | No | Integer (`10000`) | [main.ts#L307](file:///C:/Projects/callflow-agent-a/apps/api/src/main.ts#L307) | Fallback to `3000`. | No (falls back to 3000) |
| **`DATABASE_URL`** | Render | Required | **YES** | URI: `postgresql://postgres.[REF]:[PASS]@[HOST]:6543/postgres?pgbouncer=true` | [schema.prisma#L7](file:///C:/Projects/callflow-agent-a/apps/api/prisma/schema.prisma#L7), [prisma.service.ts#L16](file:///C:/Projects/callflow-agent-a/apps/api/src/prisma/prisma.service.ts#L16) | None. Required for Prisma Client runtime queries. | **YES** (Prisma fails connection) |
| **`DIRECT_URL`** | Render | Optional at runtime (Required for CLI migrations) | **YES** | URI: `postgresql://postgres.[REF]:[PASS]@[HOST]:5432/postgres` | [schema.prisma#L8](file:///C:/Projects/callflow-agent-a/apps/api/prisma/schema.prisma#L8) | Used by Prisma CLI for migrations. Runtime uses `DATABASE_URL`. | No |
| **`SUPABASE_URL`** | Render | Required | No (Public URI) | HTTPS URL: `https://[REF].supabase.co` | [main.ts#L179](file:///C:/Projects/callflow-agent-a/apps/api/src/main.ts#L179), [jwt.strategy.ts#L18](file:///C:/Projects/callflow-agent-a/apps/api/src/auth/jwt.strategy.ts#L18), [auth.service.ts#L95](file:///C:/Projects/callflow-agent-a/apps/api/src/auth/auth.service.ts#L95) | Checks `NEXT_PUBLIC_SUPABASE_URL`. Fails closed if missing. | **YES** (Explicit abort in `validateStartupConfig`) |
| **`TELNYX_API_KEY`** | Render | Required (for Telnyx) | **YES** | String: `KEY...` | [main.ts#L204](file:///C:/Projects/callflow-agent-a/apps/api/src/main.ts#L204), [telnyx.provider.ts#L31](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/telnyx/telnyx.provider.ts#L31) | None. Required for Telnyx Call Control v2 API dispatch. | **YES** (Explicit abort in `validateStartupConfig`) |
| **`TELNYX_PUBLIC_KEY`** | Render | Required (for Telnyx) | **YES** | Base64 Ed25519 public key string | [main.ts#L210](file:///C:/Projects/callflow-agent-a/apps/api/src/main.ts#L210), [telnyx.webhook.controller.ts#L42](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/telnyx/telnyx.webhook.controller.ts#L42) | None. Required for webhook signature verification. | **YES** (Explicit abort in `validateStartupConfig`) |
| **`BASE_URL`** | Render | Required | No (Public URI) | HTTPS URL: `https://[RENDER_SERVICE].onrender.com` | [main.ts#L223](file:///C:/Projects/callflow-agent-a/apps/api/src/main.ts#L223), [telnyx.provider.ts#L197](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/telnyx/telnyx.provider.ts#L197) | Used to construct ringback audio URL (`${BASE_URL}/telephony/ringback.wav`). | **YES** (Fails closed in production via `validatePublicHttpsUrl`) |
| **`RINGBACK_AUDIO_URL`** | Render | Optional | No (Public URI) | HTTPS URL: `https://[RENDER_SERVICE].onrender.com/telephony/ringback.wav` | [main.ts#L225](file:///C:/Projects/callflow-agent-a/apps/api/src/main.ts#L225), [telnyx.provider.ts#L202](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/telnyx/telnyx.provider.ts#L202) | Defaults to `${BASE_URL}/telephony/ringback.wav`. | No (if `BASE_URL` is configured) |
| **`FRONTEND_URL`** | Render | Required | No (Public URI) | HTTPS URL: `https://[APP].vercel.app` | [main.ts#L278](file:///C:/Projects/callflow-agent-a/apps/api/src/main.ts#L278), [auth.service.ts#L273](file:///C:/Projects/callflow-agent-a/apps/api/src/auth/auth.service.ts#L273) | Used for CORS allowed origin and password reset email links. | No (falls back to localhost:3001 or callflow.io) |
| **`RESET_PASSWORD_URL`** | Render | Optional | No (Public URI) | HTTPS URL: `https://[APP].vercel.app/reset-password` | [auth.service.ts#L274](file:///C:/Projects/callflow-agent-a/apps/api/src/auth/auth.service.ts#L274) | Strips `/reset-password` and uses origin if `FRONTEND_URL` unset. | No |
| **`JWT_SECRET`** | Render | Optional (Required if HS256 tokens used) | **YES** | String (Supabase JWT secret) | [jwt.strategy.ts#L71](file:///C:/Projects/callflow-agent-a/apps/api/src/auth/jwt.strategy.ts#L71), [auth.service.ts#L92](file:///C:/Projects/callflow-agent-a/apps/api/src/auth/auth.service.ts#L92) | Used for legacy HS256 tokens and service_role fallback. | No (if JWKS used for ES256/RS256) |
| **`WEBHOOK_ENCRYPTION_KEY`** | Render | Required | **YES** | Exactly 32-character ASCII string | [webhooks.service.ts#L33-L35](file:///C:/Projects/callflow-agent-a/apps/api/src/webhooks/webhooks.service.ts#L33-L35) | Used for AES-256-CBC encryption of outgoing webhook secrets. | No at boot; **YES** on webhook create/dispatch |
| **`TELEPHONY_PROVIDER`** | Render | Required | No | String: `telnyx` | [main.ts#L99](file:///C:/Projects/callflow-agent-a/apps/api/src/main.ts#L99), [telephony.module.ts#L51](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/telephony.module.ts#L51) | Defaults to `telnyx`. Twilio is retired and throws fatal error. | No (defaults to telnyx) |
| **`ACTIVE_TELEPHONY_PROVIDER`**| Render | Optional | No | String: `telnyx` | [main.ts#L100](file:///C:/Projects/callflow-agent-a/apps/api/src/main.ts#L100), [telephony.module.ts#L52](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/telephony.module.ts#L52) | Mirror alias for `TELEPHONY_PROVIDER`. | No |
| **`TELEPHONY_QA_ENABLED`** | Render | Required (`false`) | No | String (`false` or unset) | [call-controller.ts#L251](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/call-controller.ts#L251), [qa-test.controller.ts#L44](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-test.controller.ts#L44) | Set to `false` in production. Rejects Asterisk/QA test endpoints. | No |

### Public URL Safety Enforcement
In [apps/api/src/main.ts#L128-L176](file:///C:/Projects/callflow-agent-a/apps/api/src/main.ts#L128-L176), `validatePublicHttpsUrl` strictly validates `BASE_URL` and `RINGBACK_AUDIO_URL` when `NODE_ENV === 'production'`:
- Rejects non-HTTPS schemes (e.g. `http://`, `ftp://`).
- Rejects embedded user credentials (e.g. `https://user:pass@host`).
- Rejects `localhost` and `*.localhost`.
- Rejects loopback addresses (`127.0.0.1`, `::1`, `127.0.0.0/8`).
- Rejects RFC 1918 private IPv4 subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`).
- Rejects link-local and zero addresses (`169.254.0.0/16`, `0.0.0.0`).
- Rejects IPv6 unique-local and link-local ranges (`fe80:*`, `fc00:*`, `fd00:*`).
- **Ringback Audio URL Integrity:** In [apps/api/src/telephony/telnyx/telnyx.provider.ts#L198](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/telnyx/telnyx.provider.ts#L198), the system appends `/telephony/ringback.wav` to `BASE_URL`. If `RINGBACK_AUDIO_URL` is explicitly set, it retains the complete `/telephony/ringback.wav` route served by [RingbackController](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/ringback.controller.ts#L9).

---

## 5. Telnyx Webhook Route Verification (Mandatory Gate)

### Route Discrepancy Resolution
A critical question investigated during this audit was resolving the discrepancy between two cited webhook paths:
1. `/webhooks/telnyx`
2. `/telephony/telnyx/events`

**Authoritative Finding:**  
Inspection of all controllers and routing configurations proves:
- [apps/api/src/telephony/telnyx/telnyx.webhook.controller.ts#L16](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/telnyx/telnyx.webhook.controller.ts#L16) declares:
  ```typescript
  @Controller('webhooks/telnyx')
  export class TelnyxWebhookController {
    @Post()
    async handleWebhook(...)
  ```
- [apps/api/src/main.ts](file:///C:/Projects/callflow-agent-a/apps/api/src/main.ts) defines **zero global API prefixes** (no `app.setGlobalPrefix`) and **zero API versioning**.
- The path `/telephony/telnyx/events` **does not exist anywhere in the committed codebase** (`git grep "telnyx/events"` returned zero results). Any request dispatched to `/telephony/telnyx/events` returns HTTP `404 Not Found`.

**Single Correct Webhook Path:**  
```
POST https://[RENDER_BACKEND_URL]/webhooks/telnyx
```

### Ingress Security & Idempotency Pipeline
1. **Raw Request Body Availability:** Configured at bootstrap in [main.ts#L271](file:///C:/Projects/callflow-agent-a/apps/api/src/main.ts#L271) via `NestFactory.create(AppModule, { rawBody: true })`. Injected via `@Req() req: RawBodyRequest<Request>` in [telnyx.webhook.controller.ts#L27](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/telnyx/telnyx.webhook.controller.ts#L27).
2. **Ed25519 Cryptographic Verification:** Executed in [telnyx.webhook.controller.ts#L69-L78](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/telnyx/telnyx.webhook.controller.ts#L69-L78) using official Telnyx SDK `client.webhooks.unwrap()` against `telnyx-signature-ed25519`, `telnyx-timestamp`, and `process.env.TELNYX_PUBLIC_KEY`. Invalid signatures are rejected with HTTP 400.
3. **Timestamp Freshness:** Enforced by the Telnyx SDK inside `unwrap()` (default 5-minute tolerance window).
4. **Idempotency & Deduplication:** Managed by [WebhookIdempotencyService](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/webhook-idempotency.service.ts).
   - Uses cryptographic fencing tokens (`lease:${leaseToken}`) and atomic database Compare-And-Swap (`updateMany`).
   - Duplicate deliveries of `PROCESSED` events return HTTP 200 `Duplicate` without duplicate processing.
   - Stale in-flight locks (> 5 minutes) are atomically claimed by the recovery mechanism.
   - Retryable failures (`FAILED`/`IGNORED`) can be retried via atomic CAS lease acquisition.

---

## 6. Health Checks & Operational Recovery

### Health Endpoints
- **Liveness Probe (`GET /health/live`):**
  - Implemented in [health.controller.ts#L28-L31](file:///C:/Projects/callflow-agent-a/apps/api/src/health/health.controller.ts#L28-L31).
  - Returns `{ status: "ok", timestamp: "..." }` with HTTP 200.
  - Zero database or network dependencies.
  - **Recommended Render Health Check Path:** `/health/live`.
- **Readiness Probe (`GET /health/ready` or `GET /health`):**
  - Implemented in [health.controller.ts#L19-L26](file:///C:/Projects/callflow-agent-a/apps/api/src/health/health.controller.ts#L19-L26).
  - Executes `SELECT 1` against PostgreSQL via Prisma.
  - Returns HTTP 200 `{ status: "healthy" }` if database is connected, HTTP 503 `{ status: "unhealthy" }` if unreachable.

### Operational Recovery & Graceful Shutdown
- **Background Reconciliation:** [ReservationRecoveryService](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/reservation-recovery.service.ts) runs on a 5-minute interval (`setInterval`, 300,000 ms). It queries `CallReservation` for `ACTIVE` records where `updated_at` is older than 15 minutes (`RESERVATION_RECOVERY_STALE_SECONDS = 900`).
- **Restart Recovery Guarantee:** If Render restarts the backend during active calls, any orphaned reservations left in `ACTIVE` state are automatically discovered by the background worker on the next run, verified against Telnyx carrier status via `provider.getCallStatus()`, and safely settled or released without monetary leakage.
- **Shutdown Hooks:** [PrismaService](file:///C:/Projects/callflow-agent-a/apps/api/src/prisma/prisma.service.ts#L20-L22) implements `OnModuleDestroy` calling `this.$disconnect()`.

### Instance Topology Requirement: Exactly 1 Always-On Instance
CallFlow maintains in-memory coordination objects:
- `CallController.activeCallTimers` (Map of authorization extension timeouts at 80% mark of 10-minute call blocks).
- `CallController.activeRingbackCalls` (Set of active audio playback sessions).
- `ReservationRecoveryService.activeReconciliations` and `retryStates`.

Because these timers and maps are in-memory and not distributed across a shared Redis layer:
- **Render Instance Count:** Must be set to **exactly 1 instance**.
- **Auto-Scaling / Horizontal Scaling:** Must be **disabled**.
- **Instance Plan:** Must be **Always-On** (Standard / Starter with zero sleep/suspend).

---

## 7. Production Database Safeguards

### Database Architecture Parity
- **Application Runtime (`DATABASE_URL`):** Connects to the Supabase transaction pooler on port 6543 with `?pgbouncer=true`.
- **Schema Migrations (`DIRECT_URL`):** Connects to direct PostgreSQL session on port 5432.
- **Automatic Startup Migrations:** Audited [apps/api/package.json](file:///C:/Projects/callflow-agent-a/apps/api/package.json) and [apps/api/src/main.ts](file:///C:/Projects/callflow-agent-a/apps/api/src/main.ts). The application **does not** execute `prisma migrate deploy` or `prisma db push` on startup.
- **Migration Parity:** Phase DB-DEPLOY-1 verified that all 37 migrations are fully applied and the database schema is 100% up to date.

---

## 8. Critical Blocker & Forensic Root Cause

### Blocker Analysis: Unconditional Database Isolation Guard
- **File:** [apps/api/src/prisma/prisma.service.ts](file:///C:/Projects/callflow-agent-a/apps/api/src/prisma/prisma.service.ts)
- **Lines:** 13–18:
  ```typescript
  async onModuleInit() {
    // Hardened safety: Strip production secrets and assert non-production target unconditionally
    stripProductionEnvironmentVariables();
    assertNonProductionDatabase(process.env.DATABASE_URL, 'PrismaService.onModuleInit');
    await this.$connect();
  }
  ```
- **Referenced File:** [apps/api/src/common/database-isolation.util.ts](file:///C:/Projects/callflow-agent-a/apps/api/src/common/database-isolation.util.ts)
- **Lines:** 5–11, 102–109, 203–214:
  ```typescript
  export const FORBIDDEN_PRODUCTION_PATTERNS = [
    'supabase.co',
    'pooler.supabase.com',
    'aws-0-ap-northeast-1',
    '6543',
    'uwycbvnqnpnfisvvbabu',
  ] as const;
  ```

### Impact When Deployed to Render
When Render boots the application with `DATABASE_URL` set to the production Supabase database:
1. `stripProductionEnvironmentVariables()` executes. It scans `process.env`, finds `pooler.supabase.com` and `aws-0-ap-northeast-1`, and **deletes `process.env.SUPABASE_URL`**, breaking JWKS authentication for Supabase users.
2. `assertNonProductionDatabase()` executes. It scans `DATABASE_URL`, matches `supabase.co` / `pooler.supabase.com`, and throws:
   ```
   ForbiddenException: Database isolation boundary violation [context=PrismaService.onModuleInit]: Production database pattern detected: "supabase.co". Refusing execution.
   ```
3. NestJS startup aborts with an unhandled exception before the HTTP listener binds to `PORT`. Render marks the deployment failed due to crashed health checks.

### Required Remediation (Post-Audit Action)
The check was intended solely for automated QA / test runners to prevent test suites from wiping production databases. In `apps/api/src/prisma/prisma.service.ts`, `stripProductionEnvironmentVariables()` and `assertNonProductionDatabase()` must be conditionalized so they only run when in test or QA mode:
```typescript
async onModuleInit() {
  const isQaOrTest = process.env.APP_ENV === 'qa' || process.env.NODE_ENV === 'test';
  if (isQaOrTest) {
    stripProductionEnvironmentVariables();
    assertNonProductionDatabase(process.env.DATABASE_URL, 'PrismaService.onModuleInit');
  }
  await this.$connect();
}
```

---

## 9. Render Deployment Specification

Upon remediation of the blocker, Render should be configured as follows:

```yaml
services:
  - type: web
    name: callflow-backend
    env: node
    plan: starter # Always-on, minimum 512 MB - 1 GB RAM
    region: oregon # or closest to Supabase ap-northeast-1 (e.g. singapore)
    rootDir: apps/api
    buildCommand: npm ci && npx prisma generate && npm run build
    startCommand: npm run start:prod
    healthCheckPath: /health/live
    numInstances: 1 # STRICT REQUIREMENT: exactly 1 instance
    envVars:
      - key: NODE_ENV
        value: production
      - key: DATABASE_URL
        value: postgresql://postgres.[REF]:[DATABASE_PASSWORD]@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true
      - key: DIRECT_URL
        value: postgresql://postgres.[REF]:[DATABASE_PASSWORD]@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres
      - key: SUPABASE_URL
        value: https://uwycbvnqnpnfisvvbabu.supabase.co
      - key: JWT_SECRET
        value: [SUPABASE_JWT_SECRET]
      - key: TELEPHONY_PROVIDER
        value: telnyx
      - key: TELNYX_API_KEY
        value: [TELNYX_API_KEY]
      - key: TELNYX_PUBLIC_KEY
        value: [TELNYX_PUBLIC_KEY]
      - key: BASE_URL
        value: https://callflow-backend.onrender.com
      - key: RINGBACK_AUDIO_URL
        value: https://callflow-backend.onrender.com/telephony/ringback.wav
      - key: FRONTEND_URL
        value: https://callflow-agent-a.vercel.app
      - key: RESET_PASSWORD_URL
        value: https://callflow-agent-a.vercel.app/reset-password
      - key: WEBHOOK_ENCRYPTION_KEY
        value: [EXACTLY_32_CHARACTERS_SECRET]
      - key: TELEPHONY_QA_ENABLED
        value: "false"
```

---

## 10. Audit Conclusion & Sign-Off

- **Final Verdict:** **`RENDER DEPLOYMENT BLOCKED`**
- **Blocker Count:** 1 critical blocker ([apps/api/src/prisma/prisma.service.ts#L15-L16](file:///C:/Projects/callflow-agent-a/apps/api/src/prisma/prisma.service.ts#L15-L16)).
- **Telnyx Route Gate:** **RESOLVED** (`POST /webhooks/telnyx`).
- **Database Schema Parity:** **CONFIRMED** (DB-DEPLOY-1 migrations intact).
- **Next Action:** Authorize targeted code remediation to conditionalize the database isolation guard for QA/test environments, verify the backend boots with production database configuration, and proceed with Render deployment.
