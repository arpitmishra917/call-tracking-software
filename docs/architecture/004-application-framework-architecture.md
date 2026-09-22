# Architecture Decision Record: Application Framework Architecture

## Title
ADR-004: Application Framework Architecture

## Status
Accepted

## Context
The legacy POC is structured as a basic Node.js Express application utilizing CommonJS. As the platform scales into a multi-tenant SaaS application containing complex business domains (billing, telephony, APIs, web dashboard), a robust, type-safe, and modular architecture is required.

## Decision
* We will adopt a **Monorepo** structure (`apps/web`, `apps/api`, `packages/shared`, etc.) to cleanly separate concerns while sharing database schemas and types.
* **Frontend**: We will use **Next.js + React + TypeScript** for the web application dashboard.
* **Backend API**: We will use **NestJS + TypeScript** for the backend business logic, webhook ingress, and external APIs.
* We will discard the raw Express CommonJS structure used in the POC for production logic execution, though the POC remains in the repository as a reference.

## Consequences
* High learning curve initially for NestJS dependency injection and module boundaries.
* Absolute clarity between the client-facing UI code (Next.js) and the server-only telephony/billing logic (NestJS).
* Full end-to-end type safety across the monorepo via shared TypeScript types.

## Alternatives Considered
* **Upgrading the POC's Express app to TypeScript:** Rejected. While faster initially, NestJS provides the necessary architectural rigidity (guards, interceptors, modularity) demanded by a complex enterprise SaaS. The spec explicitly recommends Next.js + NestJS.
* **Next.js API Routes for everything (Monolith):** Rejected. Telephony webhook processing, persistent idempotency, and long-running background tasks are often better suited to a dedicated backend service (NestJS) than serverless Next.js functions.

## Relationship to MVP1_BUILD_SPEC_v5.md
Strictly enforces Section 16 (Development Stack) and Section 17 (Repository Structure).
