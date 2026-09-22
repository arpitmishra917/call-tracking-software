# Architecture Decision Record: Configuration and Secrets Architecture

## Title
ADR-008: Configuration and Secrets Architecture

## Status
Accepted

## Context
The application utilizes highly sensitive credentials including Supabase server-role keys, Postgres database passwords, Telnyx API keys, Twilio auth tokens, and future webhook signing keys.

## Decision
* **Environment Variables**: All configuration will be injected via standard environment variables. 
* **Separation of Concerns**: Only safe, explicitly permitted public variables (e.g., `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) will be exposed to the Next.js frontend.
* **Server-Only Secrets**: Sensitive keys (`TELNYX_API_KEY`, `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) will exist solely within the NestJS backend environment context.
* **Source Control Safety**: We will maintain a `.env.example` file containing dummy placeholders. We will NEVER commit `.env` or hardcode actual credentials into the repository.
* **API Key Storage**: When generating customer API keys, we will store a `key_prefix` and a hashed secret using a strong cryptographic hash (e.g., bcrypt/argon2). We will never store raw API secrets.

## Consequences
* The codebase remains safe to distribute or open-source.
* Compromise of the frontend bundle does not leak backend telephony credentials.

## Alternatives Considered
* **HashiCorp Vault / AWS Secrets Manager:** Needs Owner Decision / Deferred. For MVP1, standard `.env` variables mapped by the deployment orchestrator (Docker/Vercel/Render) are sufficient.

## Relationship to MVP1_BUILD_SPEC_v5.md
Strictly enforces Section 7.3 (Secrets) and Section 22 (Environment Configuration).
