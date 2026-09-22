# Architecture Decision Record: Authentication Architecture

## Title
ADR-002: Authentication Architecture - Supabase Auth

## Status
Accepted

## Context
The application needs a secure way to manage user identity, registration, sessions, and API tokens without inventing a custom cryptographic solution. Furthermore, the application must isolate data heavily across different workspaces (tenants) using application-level roles (OWNER, ADMIN, MEMBER, VIEWER).

## Decision
* **Authentication Identity**: We will use **Supabase Auth** exclusively for user authentication (signup, sign-in, session handling, JWT issuance, email verification, and password reset).
* **No Second Auth System**: We will NOT build custom password storage. Passwords will never touch or be stored in the application's PostgreSQL database.
* **Application Authorization**: While Supabase handles authentication (Who is this user?), our application database will handle authorization (What workspace do they belong to? What is their role?).
* **Tenant Isolation**: Every resource table in the database will be scoped to a `workspace_id`. Every API request will verify the Supabase JWT and subsequently assert workspace membership and role permissions before querying or mutating data.

## Consequences
* The backend API must validate incoming Supabase JWTs.
* The frontend must utilize official Supabase SSR/client libraries tailored for Next.js.
* User profile rows in our database will map their `id` to the Supabase Auth user ID.

## Alternatives Considered
* **Auth0 / Clerk:** Rejected because Supabase Auth was explicitly mandated by the owner in the Executive Decisions of the spec.
* **Custom JWT + bcrypt in Postgres:** Rejected as a security risk and direct violation of the build specification.

## Relationship to MVP1_BUILD_SPEC_v5.md
Strictly enforces Section 9 (Authentication - Supabase Auth) and Section 10 (Role Model).
