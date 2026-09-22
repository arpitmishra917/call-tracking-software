# Environment Variable Checklist

This document details all required and optional environment variables across the Call Tracking Software monorepo.

> **WARNING:** NEVER expose real secrets or API keys in this document or any logged output. Use placeholders like `your_secret_here`.

## 1. Root / General Environment (`.env`)

| Variable | Scope | Required | Purpose | Where Consumed | Example Placeholder |
| -------- | ----- | -------- | ------- | -------------- | ------------------- |
| `TELEPHONY_PROVIDER` | Server | Yes | Specifies which telephony adapter to use (telnyx or twilio). | `apps/api/src/telephony/` | `telnyx` |
| `TELNYX_API_KEY` | Server | Yes (if Telnyx) | Authenticates API requests to Telnyx. | Telnyx Provider adapter | `KEY0...` |
| `TELNYX_PUBLIC_KEY` | Server | Yes (if Telnyx) | Verifies incoming Telnyx webhook signatures. | Telnyx Webhook handler | `...` |
| `TWILIO_ACCOUNT_SID`| Server | Yes (if Twilio) | Twilio account identifier. | Twilio Provider adapter | `AC...` |
| `TWILIO_AUTH_TOKEN` | Server | Yes (if Twilio) | Authenticates API requests and validates Twilio webhooks. | Twilio Provider adapter | `...` |
| `BASE_URL` | Server | Yes | Base URL of the API for constructing webhook URLs. | `apps/api/src/` | `https://api.example.com` |
| `PORT` | Server | Optional | Port the API binds to (default: 3000). | `apps/api/src/main.ts` | `3000` |

## 2. API Environment (`apps/api/.env`)

| Variable | Scope | Required | Purpose | Where Consumed | Example Placeholder |
| -------- | ----- | -------- | ------- | -------------- | ------------------- |
| `DATABASE_URL` | Server | Yes | Prisma connection string for PostgreSQL. | `apps/api/prisma/schema.prisma` | `postgresql://user:pass@host:5432/db` |
| `SUPABASE_URL` | Server | Yes | Supabase project URL for authentication. | Supabase strategy / API | `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Server | Yes | Admin key for Supabase API interactions (if needed). | Supabase strategy / API | `eyJ...` |
| `FRONTEND_URL` | Server | Yes | Base URL of the frontend (for CORS). | `apps/api/src/main.ts` (CORS) | `https://app.example.com` |
| `JWT_SECRET` | Server | Yes | Secret used for local JWT verification if bypassing external JWKS. | JWT Auth Guard | `super_secret_jwt_string` |

## 3. Web Environment (`apps/web/.env`)

| Variable | Scope | Required | Purpose | Where Consumed | Example Placeholder |
| -------- | ----- | -------- | ------- | -------------- | ------------------- |
| `NEXT_PUBLIC_API_URL` | Browser | Yes | URL for the Next.js frontend to call the API. | Next.js Data Fetching / Axios | `https://api.example.com` |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser | Yes | Supabase project URL for client-side auth. | Supabase JS client | `https://xxxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser | Yes | Anonymous key for Supabase client-side auth. | Supabase JS client | `eyJ...` |

## Environment Security Policy
- **No Secrets in Source Control:** Ensure `.env` is listed in all `.gitignore` files.
- **Log Masking:** Application logs should never print variables categorized as Server Secrets.
- **Browser Scope:** Only variables prefixed with `NEXT_PUBLIC_` are exposed to the browser. Never prefix a secret key with `NEXT_PUBLIC_`.
