# Architecture Decision Record: Workspace and Multi-Tenancy Architecture

## Title
ADR-005: Workspace and Multi-Tenancy Architecture

## Status
Accepted

## Context
The platform is a multi-tenant SaaS serving different businesses and agencies. Customers must never be able to access or modify data belonging to other organizations.

## Decision
* **Workspace as the Boundary**: The `Workspace` is the highest-level authorization boundary. 
* Every domain entity (campaigns, buyers, phone numbers, calls, API keys, block lists, billing subscriptions) must possess a `workspace_id` foreign key.
* **Membership**: Users do not own data directly. Users own a `workspace_member` relationship that grants them access to a Workspace.
* **Roles**: Access control is defined at the application level via specific roles (`OWNER`, `ADMIN`, `MEMBER`, `VIEWER`).
* **Tenant Isolation Enforcement**: The NestJS backend API must universally apply a `workspace_id` filter to every database query. We will utilize NestJS Guards to verify that the Supabase-authenticated user actively holds an authorized `workspace_member` role for the `workspace_id` being operated on.

## Consequences
* Cross-workspace data leakage (IDOR vulnerabilities) is heavily mitigated by universal API Guards.
* A single user can belong to multiple workspaces cleanly.

## Alternatives Considered
* **Row Level Security (RLS) in PostgreSQL:** Needs Owner Decision / Deferred. We will enforce isolation at the Application API boundary (NestJS) for explicit control. If Supabase Postgres RLS is also requested as a defense-in-depth layer, it can be added, but the backend API will remain the primary enforcer.

## Relationship to MVP1_BUILD_SPEC_v5.md
Strictly enforces Section 7.2 (Tenant Isolation) and Section 10 (Role Model).
