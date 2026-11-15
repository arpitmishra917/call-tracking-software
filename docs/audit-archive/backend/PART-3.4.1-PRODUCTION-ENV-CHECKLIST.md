# CallFlow — Part 3.4.1: Production Environment Variable Checklist & Provisioning Guide

**Project:** CallFlow  
**Component:** Backend API (`apps/api`), Frontend UI (`apps/web`)  
**Git Branch:** `agent/reporting-backend-fix`  
**Security Mandate:** Strict placeholder representations only. No active or live secrets are printed.

---

## 1. Overview & Verification Summary

Every environment variable utilized across the CallFlow codebase has been forensically extracted from source files ([apps/api/src/main.ts](file:///C:/Projects/callflow-agent-a/apps/api/src/main.ts), [apps/api/src/auth/jwt.strategy.ts](file:///C:/Projects/callflow-agent-a/apps/api/src/auth/jwt.strategy.ts), [apps/api/src/billing/billing.service.ts](file:///C:/Projects/callflow-agent-a/apps/api/src/billing/billing.service.ts), [apps/api/src/telephony/telnyx/telnyx.provider.ts](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/telnyx/telnyx.provider.ts), [apps/web/src/utils/supabase/server.ts](file:///C:/Projects/callflow-agent-a/apps/web/src/utils/supabase/server.ts), etc.).

This document classifies every variable, identifies missing production values, and provides safe placeholder templates for deployment.

---

## 2. Categorized Environment Variable Inventory

### Category 1: Database Connectivity (`apps/api`)
| Variable | Required? | Secret? | Source Code Consumer | Description & Production Constraint | Status |
| :--- | :---: | :---: | :--- | :--- | :---: |
| `DATABASE_URL` | **Yes** | **Yes** | `schema.prisma`, `PrismaService` | Connection string for Supabase PgBouncer on port `6543`. **Must include `?pgbouncer=true`**. | Staged (Supabase) |
| `DIRECT_URL` | **Yes** | **Yes** | `schema.prisma` (directUrl) | Direct connection string for Supabase PostgreSQL on port `5432`. Used exclusively for Prisma migrations. | Staged (Supabase) |

### Category 2: Authentication & JWT (`apps/api` & `apps/web`)
| Variable | Required? | Secret? | Source Code Consumer | Description & Production Constraint | Status |
| :--- | :---: | :---: | :--- | :--- | :---: |
| `JWT_SECRET` | **Yes** | **Yes** | `JwtStrategy` | Secret key used to sign and verify Supabase HS256 JWT access tokens. Must match Supabase project settings. | Staged (Supabase) |
| `SUPABASE_URL` | **Yes** | No | `JwtStrategy`, `AuthModule` | Public HTTPS endpoint of the Supabase project (`https://<project-ref>.supabase.co`). | Staged (Supabase) |
| `NEXT_PUBLIC_SUPABASE_URL` | **Yes** | No | `apps/web/src/utils/supabase` | Public Supabase project URL exposed to browser for Supabase Auth SSR client. | Staged (Supabase) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Yes** | No | `apps/web/src/utils/supabase` | Public anonymous client API key for browser Supabase Auth client. | Staged (Supabase) |

### Category 3: Application Networking & URLs (`apps/api` & `apps/web`)
| Variable | Required? | Secret? | Source Code Consumer | Description & Production Constraint | Status |
| :--- | :---: | :---: | :--- | :--- | :---: |
| `PORT` | Optional | No | `apps/api/src/main.ts` | TCP port for NestJS HTTP server. Defaults to `3000` if omitted. Set by PaaS dynamically. | Ready (Default: 3000) |
| `BASE_URL` | **Yes** | No | `TelnyxProvider`, `TwilioProvider` | Public HTTPS domain of CallFlow API (e.g. `https://api.callflow.io`). Needed for webhook callbacks. | **MISSING (Requires Domain)** |
| `FRONTEND_URL` | **Yes** | No | `apps/api/src/main.ts` (CORS) | Public HTTPS domain of CallFlow Web (e.g. `https://app.callflow.io`). Used for CORS origin validation. | **MISSING (Requires Domain)** |
| `NEXT_PUBLIC_API_URL` | **Yes** | No | `apps/web/src/utils/api` | Public HTTPS domain of backend API called by Next.js browser requests. | **MISSING (Requires Domain)** |
| `NEXT_PUBLIC_SITE_URL` | **Yes** | No | `apps/web/src/middleware.ts` | Canonical frontend domain for OAuth redirects and auth session cookies. | **MISSING (Requires Domain)** |

### Category 4: Telephony Provider (`apps/api`)
| Variable | Required? | Secret? | Source Code Consumer | Description & Production Constraint | Status |
| :--- | :---: | :---: | :--- | :--- | :---: |
| `TELEPHONY_PROVIDER` | **Yes** | No | `TelephonyModule` | Active telephony driver (`telnyx` or `twilio`). | Ready (`telnyx`) |
| `ACTIVE_TELEPHONY_PROVIDER` | Optional | No | `TelephonyModule` | Secondary provider fallback flag. | Ready (`telnyx`) |
| `TELNYX_API_KEY` | **Yes** (if Telnyx) | **Yes** | `TelnyxProvider` | Production API Bearer token for Telnyx v2 Call Control & Number Purchasing. | **MISSING (Production Key)** |
| `TELNYX_PUBLIC_KEY` | **Yes** (if Telnyx) | **Yes** | `TelnyxWebhookController` | Ed25519 Public Key used to verify authenticity of incoming Telnyx webhook signatures. | **MISSING (Production Key)** |
| `TELNYX_CALL_CONTROL_APP_ID` | **Yes** (if Telnyx) | No | `TelnyxProvider` | Telnyx Portal Call Control Application ID linked to production SIP / webhook endpoints. | **MISSING (Production ID)** |
| `TWILIO_ACCOUNT_SID` | Optional | No | `TwilioProvider` | Production Twilio Account SID (if Twilio driver is enabled). | Staged / Optional |
| `TWILIO_AUTH_TOKEN` | Optional | **Yes** | `TwilioProvider` | Production Twilio Auth Token (if Twilio driver is enabled). | Staged / Optional |
| `TELEPHONY_LOCAL_INBOUND_RATE` | Optional | No | `TelephonyPricingConfig` | USD per minute for local inbound telephony usage (defaults to `0.045`). | Ready (Default: 0.045) |
| `TELEPHONY_TOLL_FREE_RATE` | Optional | No | `TelephonyPricingConfig` | USD per minute for toll-free telephony usage (defaults to `0.055`). | Ready (Default: 0.055) |
| `TELEPHONY_RECORDING_STORAGE_RATE` | Optional | No | `TelephonyPricingConfig` | USD per minute for call recording storage (defaults to `0.0025`). | Ready (Default: 0.0025) |

### Category 5: Billing & Payments (`apps/api`)
| Variable | Required? | Secret? | Source Code Consumer | Description & Production Constraint | Status |
| :--- | :---: | :---: | :--- | :--- | :---: |
| `STRIPE_SECRET_KEY` | Optional | **Yes** | `BillingService` | Live Stripe Secret Key (`sk_live_...`). Required for credit card processing and top-ups. | **MISSING (Live Key)** |
| `STRIPE_WEBHOOK_SECRET` | Optional | **Yes** | `BillingService` | Live Stripe Webhook Signing Secret (`whsec_...`). Used for signature verification. | **MISSING (Live Key)** |

### Category 6: Email & Password Recovery (`apps/api`)
| Variable | Required? | Secret? | Source Code Consumer | Description & Production Constraint | Status |
| :--- | :---: | :---: | :--- | :--- | :---: |
| `EMAIL_PROVIDER` | Optional | No | `EmailModule` | Mailer provider (`smtp` or `mock`). | Ready (`smtp`) |
| `SMTP_HOST` | **Yes** (for email) | No | `EmailService` | Production SMTP relay host (e.g., `smtp.sendgrid.net`, `smtp.postmarkapp.com`). | **MISSING (Production SMTP)** |
| `SMTP_PORT` | **Yes** (for email) | No | `EmailService` | SMTP port (`587` for STARTTLS, `465` for TLS). | **MISSING (Production SMTP)** |
| `SMTP_USER` | **Yes** (for email) | **Yes** | `EmailService` | SMTP authenticated username. | **MISSING (Production SMTP)** |
| `SMTP_PASS` | **Yes** (for email) | **Yes** | `EmailService` | SMTP authenticated password / API key. | **MISSING (Production SMTP)** |
| `EMAIL_FROM` | **Yes** (for email) | No | `EmailService` | Verified sender address (e.g. `notifications@callflow.io`). | **MISSING (Production Sender)** |
| `RESET_PASSWORD_URL` | **Yes** (for email) | No | `AuthService` | Base URL for reset password token link (`https://<domain>/reset-password`). | **MISSING (Requires Domain)** |
| `RESET_TOKEN_EXPIRY_MINUTES` | Optional | No | `AuthService` | Password reset token validity window in minutes (default: `60`). | Ready (Default: 60) |

### Category 7: Security & Encryption (`apps/api`)
| Variable | Required? | Secret? | Source Code Consumer | Description & Production Constraint | Status |
| :--- | :---: | :---: | :--- | :--- | :---: |
| `WEBHOOK_ENCRYPTION_KEY` | **Yes** | **Yes** | `WebhooksModule` | Exactly 32-character encryption key for encrypting outbound webhook secrets at rest. | Staged / Configured |

---

## 3. Production Environment Variable Checklists

### 3.1 Backend API Production Template (`apps/api/.env.production.template`)
```bash
# ==============================================================================
# CALLFLOW BACKEND API — PRODUCTION ENVIRONMENT CONFIGURATION TEMPLATE
# ==============================================================================
NODE_ENV=production
PORT=3000

# Networking & CORS
BASE_URL=https://api.callflow.io
FRONTEND_URL=https://app.callflow.io

# Database Connectivity (Supabase AWS AP-Northeast-1)
DATABASE_URL="postgresql://postgres.uwycbvnqnpnfisvvbabu:<DATABASE_PASSWORD>@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.uwycbvnqnpnfisvvbabu:<DATABASE_PASSWORD>@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres"

# Authentication (Supabase Auth)
SUPABASE_URL=https://uwycbvnqnpnfisvvbabu.supabase.co
JWT_SECRET=<SUPABASE_JWT_SECRET_HS256>

# Security
WEBHOOK_ENCRYPTION_KEY=<32_CHARACTER_CRYPTOGRAPHIC_KEY>

# Telephony Provider (Telnyx Live Credentials)
TELEPHONY_PROVIDER=telnyx
ACTIVE_TELEPHONY_PROVIDER=telnyx
TELNYX_API_KEY=KEY<LIVE_TELNYX_API_KEY>
TELNYX_PUBLIC_KEY=<LIVE_TELNYX_ED25519_PUBLIC_KEY>
TELNYX_CALL_CONTROL_APP_ID=<LIVE_TELNYX_APPLICATION_UUID>

# Telephony Usage Rates (USD per minute)
TELEPHONY_LOCAL_INBOUND_RATE=0.045
TELEPHONY_TOLL_FREE_RATE=0.055
TELEPHONY_RECORDING_STORAGE_RATE=0.0025

# Optional Secondary Telephony (Twilio Live Credentials)
# TWILIO_ACCOUNT_SID=AC<TWILIO_ACCOUNT_SID>
# TWILIO_AUTH_TOKEN=<TWILIO_AUTH_TOKEN>

# Stripe Payment Processing (Live Credentials)
STRIPE_SECRET_KEY=sk_live_<LIVE_STRIPE_SECRET_KEY>
STRIPE_WEBHOOK_SECRET=whsec_<LIVE_STRIPE_WEBHOOK_SECRET>

# Production SMTP Email Delivery
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=<SENDGRID_OR_POSTMARK_API_KEY>
EMAIL_FROM="CallFlow Notifications <no-reply@callflow.io>"
RESET_PASSWORD_URL=https://app.callflow.io/reset-password
RESET_TOKEN_EXPIRY_MINUTES=60
```

---

### 3.2 Frontend Web Production Template (`apps/web/.env.production.template`)
```bash
# ==============================================================================
# CALLFLOW FRONTEND WEB — PRODUCTION ENVIRONMENT CONFIGURATION TEMPLATE
# ==============================================================================
NODE_ENV=production

# Supabase Auth SSR Client
NEXT_PUBLIC_SUPABASE_URL=https://uwycbvnqnpnfisvvbabu.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<SUPABASE_PUBLIC_ANON_KEY>

# Canonical Application URLs
NEXT_PUBLIC_SITE_URL=https://app.callflow.io
NEXT_PUBLIC_API_URL=https://api.callflow.io
```

---

## 4. Remaining Missing Credentials Summary
The following required variables must be generated or provisioned before production deployment can proceed:

1. **`BASE_URL` & `FRONTEND_URL`:** Dependent on production custom domain provisioning (`api.callflow.io` and `app.callflow.io`).
2. **`TELNYX_API_KEY` & `TELNYX_PUBLIC_KEY`:** Live production Telnyx account credentials and Call Control App ID.
3. **`STRIPE_SECRET_KEY` & `STRIPE_WEBHOOK_SECRET`:** Live Stripe payment gateway keys (if card top-ups are enabled).
4. **`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`:** Production transactional email relay credentials (SendGrid, Postmark, AWS SES, or Resend).
