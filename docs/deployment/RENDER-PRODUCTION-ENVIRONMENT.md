# CallFlow — Render Production Environment Variable Specification & Deployment Guide

This document defines the 16 environment variables required or supported by the CallFlow backend (`apps/api`) when deployed to Render Web Service, separating backend service variables from frontend (Vercel) variables.

> [!SECURITY]
> **Zero Credential Exposure Guarantee**
> All values provided in this document are **safe synthetic placeholders**. Never paste live credentials, active API tokens, private signing keys, or database passwords into version-controlled files or public logs.

---

## 1. Complete Environment Variable Matrix

| Variable Name | Required / Optional | Target Platform | Sensitive? | Expected Format / Example Placeholder | Consuming Service & Startup Validation |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `NODE_ENV` | **Required** | Render | No | `production` | Node runtime & NestJS. Disables test isolation, activates production JWKS & SSL rules. |
| `PORT` | **Optional** (Render auto-sets) | Render | No | `3000` or `10000` | NestJS HTTP listener (`main.ts`). Defaults to `3000`, binds explicitly to `0.0.0.0`. |
| `DATABASE_URL` | **Required** | Render | **Yes** | `postgresql://postgres.[project-ref]:[password]@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres` | Prisma Client (`PrismaService`). Must use Supabase **Transaction Pooler (port 6543)** for production connection scaling. |
| `DIRECT_URL` | **Required** (for migrations) | Render | **Yes** | `postgresql://postgres:[password]@db.[project-ref].supabase.co:5432/postgres` | Prisma CLI migration engine (`prisma/schema.prisma`). Direct connection to PostgreSQL on port 5432. |
| `SUPABASE_URL` | **Required** | Render & Vercel | No | `https://[project-ref].supabase.co` | `JwtStrategy` (constructs `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` for ES256/RS256 JWT validation) and `WorkspacesService`. Startup validation fails fast if missing or invalid protocol. |
| `TELNYX_API_KEY` | **Required** | Render | **Yes** | `KEY018...` | `TelnyxProvider`. Used to authorize outbound voice calls, bridges, and recordings via Telnyx Call Control v2 API. Fails fast if missing in Telnyx mode. |
| `TELNYX_PUBLIC_KEY` | **Required** | Render | **Yes** | `MCowBQYDK2VwAyEA...` (Base64-encoded Ed25519 public key) | `TelnyxWebhookController`. Verifies cryptographic Ed25519 signatures on `POST /webhooks/telnyx`. Fails closed on missing key. |
| `BASE_URL` | **Required** | Render | No | `https://[your-service-name].onrender.com` | `TelnyxProvider`. Public ingress origin for carrier webhooks and ringback media. Validated at startup: must be public HTTPS; loopback/private IPs fail fast. |
| `RINGBACK_AUDIO_URL` | **Required** | Render | No | `https://[your-service-name].onrender.com/telephony/ringback.wav` | `TelnyxProvider` & `CallController`. Remote URL from which Telnyx fetches ringback audio. Validated at startup: must be public HTTPS. |
| `FRONTEND_URL` | **Required** | Render | No | `https://[your-app-name].vercel.app` | NestJS CORS middleware (`main.ts`). Authorizes frontend browser requests with credentials. |
| `RESET_PASSWORD_URL` | **Optional** | Render | No | `https://[your-app-name].vercel.app/reset-password` | Auth and Email service for password reset callbacks. Defaults to `${FRONTEND_URL}/reset-password`. |
| `JWT_SECRET` | **Recommended** | Render | **Yes** | `[32-or-64-character-random-hex-string]` | `JwtStrategy`. Provides backwards compatibility for HS256 tokens (internal testing, legacy tokens). Supabase user auth uses JWKS. |
| `WEBHOOK_ENCRYPTION_KEY` | **Required** | Render | **Yes** | `[exact-32-character-ascii-string]` (e.g. `c0a80101callflow32charsecretkey!`) | `WebhooksService`. AES-256-CBC key for customer webhook signing secret encryption at rest. Fails fast if not exactly 32 characters. |
| `TELEPHONY_PROVIDER` | **Required** | Render | No | `telnyx` | `TelnyxProvider` selection. Must be set to `telnyx` for production carrier routing. |
| `ACTIVE_TELEPHONY_PROVIDER` | **Optional** | Render | No | `telnyx` | Alias for `TELEPHONY_PROVIDER`. Defaults to `telnyx`. |
| `TELEPHONY_QA_ENABLED` | **Required** | Render | No | `false` | `QaTelephonyGuardService`. Must be `false` in production. Completely disables QA bypasses, SIP URI routing, and synthetic audio endpoints. |

---

## 2. Separation: Render (Backend) vs. Vercel (Frontend)

To prevent security vulnerabilities and configuration leakage, maintain strict separation between Render and Vercel:

### Render Web Service (Backend API)
Configure all 16 variables listed in the matrix above in the Render Dashboard under **Environment**:
```env
NODE_ENV=production
DATABASE_URL=postgresql://postgres.[project-ref]:[DB_PASSWORD]@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres
DIRECT_URL=postgresql://postgres:[DB_PASSWORD]@db.[project-ref].supabase.co:5432/postgres
SUPABASE_URL=https://[project-ref].supabase.co
TELNYX_API_KEY=KEY[your_telnyx_api_key]
TELNYX_PUBLIC_KEY=MCowBQYDK2VwAyEA[your_telnyx_public_key]
BASE_URL=https://[your-backend-subdomain].onrender.com
RINGBACK_AUDIO_URL=https://[your-backend-subdomain].onrender.com/telephony/ringback.wav
FRONTEND_URL=https://[your-frontend-subdomain].vercel.app
RESET_PASSWORD_URL=https://[your-frontend-subdomain].vercel.app/reset-password
JWT_SECRET=[secure_random_jwt_secret_32_chars]
WEBHOOK_ENCRYPTION_KEY=[exact_32_char_encryption_secret]
TELEPHONY_PROVIDER=telnyx
ACTIVE_TELEPHONY_PROVIDER=telnyx
TELEPHONY_QA_ENABLED=false
```

### Vercel (Frontend Application)
Only frontend client variables should be configured on Vercel:
```env
NEXT_PUBLIC_SUPABASE_URL=https://[project-ref].supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJh...[your_supabase_anon_key]
NEXT_PUBLIC_API_URL=https://[your-backend-subdomain].onrender.com
```

> [!CAUTION]
> **Never Put Database Credentials on Vercel**
> `DATABASE_URL`, `DIRECT_URL`, `TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY`, and `WEBHOOK_ENCRYPTION_KEY` must **never** be placed in Vercel environment variables or exposed with `NEXT_PUBLIC_` prefixes.

---

## 3. Render Web Service Specification (`render.yaml`)

When creating the Render Web Service (via Blueprint or Render Dashboard UI):

```yaml
services:
  - type: web
    name: callflow-backend
    runtime: node
    plan: free # or starter ($7/mo recommended for production SLA)
    rootDir: apps/api
    buildCommand: npm ci && npx prisma generate && npm run build
    startCommand: npm run start:prod
    healthCheckPath: /health/live
    numInstances: 1
    envVars:
      - key: NODE_ENV
        value: production
      - key: TELEPHONY_PROVIDER
        value: telnyx
      - key: ACTIVE_TELEPHONY_PROVIDER
        value: telnyx
      - key: TELEPHONY_QA_ENABLED
        value: "false"
```

### Critical Blueprint Rules
1. **`numInstances: 1`**: CallFlow uses in-memory concurrency reservation tracking and active call timers. It **must not** be horizontally autoscaled to multiple replicas without an external coordination broker.
2. **`healthCheckPath: /health/live`**: Uses the process liveness route (HTTP 200 without DB dependency).
3. **No Migrations in Start Command**: The start command must be strictly `npm run start:prod`. Database migrations are executed separately via controlled release processes (as demonstrated in DB-DEPLOY-1).
