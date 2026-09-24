# Architecture Decision Record: Database Architecture

## Title
ADR-001: Database Architecture - PostgreSQL and Prisma

## Status
Accepted

## Context
MVP1 requires a highly reliable, strongly consistent, and relational datastore to manage multi-tenant workspaces, campaigns, buyers, real-time call states, and historical usage. The prior proof-of-concept (POC) utilized in-memory JavaScript structures (Maps and Sets) to track call state and idempotency. This is fundamentally insufficient for a production SaaS application, as it lacks durability, scales poorly, and prevents horizontal scaling.

## Decision
* We will use **PostgreSQL** as the core relational database.
* **PostgreSQL will be the ultimate source of truth** for all business state (including call states, idempotency, routing priorities, and configurations). 
* We will use **Prisma** as the preferred Object-Relational Mapper (ORM) to define our schema, run migrations, and provide a type-safe database client.
* We will strictly abandon the POC's reliance on in-memory business state and idempotency.

## Consequences
* Every call state transition must be backed by a persistent database write.
* Concurrency and race conditions (e.g., simultaneous webhook deliveries for timeouts and answers) must be handled at the database level using transactions, unique constraints, or row-level locking.
* The application can scale horizontally since state is externalized.

## Alternatives Considered
* **MongoDB (NoSQL):** Rejected because the data is highly relational (workspaces -> campaigns -> buyers -> calls -> attempts).
* **Redis as primary state:** Rejected as the primary data store because the MVP spec strictly states Redis is optional and should only be introduced if a concrete Stage 1 architecture requirement mandates it. PostgreSQL row locking is sufficient for MVP concurrency.

## Relationship to MVP1_BUILD_SPEC_v5.md
Strictly enforces Section 7.1 (Database is the source of business truth) and Section 8 (Database Model).
