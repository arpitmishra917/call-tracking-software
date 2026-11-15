# CallFlow Agent 1 — System Architecture Audit

## 1. Audit Metadata
- **Audit Date**: 2026-10-08T08:24:00+05:30 (Local System Time: 2026-10-08)
- **Current Branch**: `agent/reporting-backend-fix`
- **Current HEAD**: `f901302b156c2779a169b2ceeb27ba7fe0c09be3`
  - Commit message: `fix(reporting): fix owner reporting authorization`
- **Known Baseline**: `59da9de33703ee55f94b8eec1ea21a603c46e3be`
  - Branch containing baseline: `agent/commercial-comm14-settlement-generation`
  - Baseline commit message: `docs(settlement): formalize V1 period input contract and boundary tests`
- **Working Tree Status**: Clean (`nothing to commit, working tree clean`)
- **Git Divergence & Fork Analysis**:
  - The repository HEAD is NOT on the known baseline commit `59da9de`.
  - The baseline commit `59da9de` and current HEAD `f901302` share a common ancestor commit `a30e81fd78dfe0ce828a4f93f70627fd343003cd` (`chore: stop tracking generated build artifacts`), which corresponds to the tip of `origin/main`.
  - From `a30e81f`, **two divergent branches developed**:
    1. **Branch 1 (`agent/reporting-backend-fix` - Current HEAD)**: Contains 62 commits implementing UI redesigns, CRUD 1-13 hardening, phone number provisioning/release, prepaid micro-dollar wallet, call reservation lifecycle extensions, RBAC (stages 1 through 10 with audit logs), and saved reports with CSV/XLSX export.
    2. **Branch 2 (`agent/commercial-comm14-settlement-generation` - Baseline `59da9de`)**: Contains 21 commits implementing COMM-1 through COMM-14 (commercial pay-per-call evaluation, currency snapshots, dispute/financial adjustment flows, settlement data model, eligibility, and settlement batch generation).
  - **Crucial Forensic Finding**: The commercial & settlement system (COMM-1 through COMM-14) **does NOT exist on the current active branch `agent/reporting-backend-fix` (HEAD)**. It exists exclusively on the unmerged branch `agent/commercial-comm14-settlement-generation`.

---

## 2. Executive Summary

A comprehensive, read-only architectural forensic audit was conducted on the CallFlow repository.

1. **Monorepo Architecture**:
   The repository is structured as an npm workspaces monorepo containing two primary applications:
   - `apps/api`: NestJS 12 backend with Prisma ORM 6 and PostgreSQL.
   - `apps/web`: Next.js 16 (App Router) with React 19 and Tailwind CSS 4.
   - A root package orchestrator managing workspace resolution.

2. **Core Operational System (Present & Implemented in HEAD)**:
   - **Telephony & Call Routing**: Fully functional inbound call webhooks (Telnyx and Twilio provider abstraction), call leg creation, sequential buyer hunting/dialing with configurable timeouts, call bridging, audio recording metadata collection, and caller blocking.
   - **Prepaid Micro-Dollar Wallet**: Provider-agnostic prepaid wallet with balance tracking in micro-dollars (`balance_micro`, BigInt), atomic reservation holds (`CallReservation`), mid-call autorization extension timers, and automatic teardown on fund exhaustion.
   - **Multi-Tenancy & RBAC**: Rigorous tenant isolation by `workspace_id`, role enforcement (`OWNER`, `ADMIN`, `MEMBER`, `VIEWER`), participant typing (`INTERNAL`, `VENDOR`, `BUYER`), granular permission keys, and resource scoping (`ResourceScopeType`).
   - **Reporting & Export**: Custom query aggregation, grouping by campaign/buyer/status/date bucket, saved reports, and binary exports to CSV and Excel (`ExcelJS`).

3. **Commercial & Settlement System Status (CRITICAL DIVERGENCE)**:
   - **In Current HEAD (`agent/reporting-backend-fix`)**: Neither `CallCommercial`, `CallDispute`, nor any `Settlement*` models exist in Prisma schema or codebase.
   - **In Baseline Branch (`agent/commercial-comm14-settlement-generation`)**: Fully defined Prisma models (`CallCommercial`, `CallDispute`, `CallFinancialAdjustment`, `SettlementBatch`, `SettlementItem`, `SettlementAdjustment`, `PaymentInstruction`, `PaymentExecution`, `ReconciliationRun`, `ReconciliationIssue`) and backend services (`CommercialEvaluatorService`, `CommercialDisputesService`, `SettlementBatchService`).
   - Any future development must recognize that Commercial and RBAC/Reporting branches are currently unmerged forks sharing ancestor `a30e81f`.

---

## 3. Repository Structure

| Directory / File | Type | Purpose & Ownership |
|---|---|---|
| `apps/api/` | Backend App | NestJS application providing the HTTP API, Webhook ingestion, Telephony control, and Prisma ORM data layer. |
| `apps/api/src/` | Source Code | Backend module implementations (Auth, Telephony, Calls, Routing, Billing, Reports, etc.). |
| `apps/api/prisma/` | Database Layer | Prisma schema (`schema.prisma`) and 26 chronological SQL migrations. |
| `apps/api/test/` | Backend Tests | Vitest end-to-end and integration test suites covering RBAC, Routing, Billing, and APIs. |
| `apps/web/` | Frontend App | Next.js 16 web application with App Router, React 19 client/server components. |
| `apps/web/src/app/` | Routes | Next.js App Router hierarchy: Public (`/login`, `/signup`, `/invitations`) and Protected (`/protected/*`). |
| `apps/web/src/components/` | UI Components | Component library: UI primitives (`ui/*`), Shell, Header, Sidebar, Appearance settings, Workspace selector. |
| `apps/web/src/lib/` | Utilities | API client (`apiFetch`) communicating with backend via Bearer token authentication. |
| `apps/web/src/utils/` | Auth Utilities | Supabase client and Next.js middleware token exchange helpers. |
| `docs/` | Documentation | Architecture specifications (RBAC and commercial documentation present on specific branches). |
| `docker-compose.yml` | Infrastructure | Local PostgreSQL 15 Alpine container definition (`postgres://testuser:testpassword@localhost:5432/calltracking`). |
| `package.json` | Root Manifest | Monorepo configuration with npm workspaces targeting `apps/*`. |
| `*.cjs` | Scratch Scripts | Transient development helper scripts used in earlier manual migration/patch tasks. |

---

## 4. Technology Stack

| Technology | Actual Version | Where Declared | Where Used |
|---|---|---|---|
| **Node.js** | `>=20.0.0` (Engine) | `apps/api/package.json`, `apps/web/package.json` | Global runtime |
| **TypeScript** | `6.0.2` (API) / `^5` (Web) | `apps/api/package.json`, `apps/web/package.json` | Full-stack codebase |
| **NestJS Core/Common** | `^12.0.1` | `apps/api/package.json` | `apps/api/src/**/*.ts` |
| **Next.js** | `16.3.5` | `apps/web/package.json` | `apps/web/src/app/**/*.tsx` |
| **React / React DOM** | `19.2.8` | `apps/web/package.json` | `apps/web/src/**/*.tsx` |
| **Prisma ORM & Client** | `^6.0.0` | `apps/api/package.json` | `apps/api/prisma/*`, `apps/api/src/prisma/*` |
| **PostgreSQL Driver** | `postgresql` (via Prisma) | `apps/api/prisma/schema.prisma` | Database persistence |
| **Vitest** | `^4.1.2` (API) / `^4.1.11` (Web) | `apps/api/package.json`, `apps/web/package.json` | `apps/api/test/*`, unit tests |
| **Telnyx SDK** | `^7.21.0` | Root & `apps/api/package.json` | `apps/api/src/telephony/telnyx/*`, `phone-numbers/*` |
| **Twilio SDK** | `^6.1.1` | Root & `apps/api/package.json` | `apps/api/src/telephony/twilio/*` |
| **Stripe SDK** | `^22.6.2` | `apps/api/package.json` | `apps/api/src/billing/*` |
| **Supabase Client / SSR** | `^2.116.0` / `^0.12.7` | `apps/web/package.json` | `apps/web/src/utils/supabase/*` |
| **Passport & JWT** | `0.7.0` / `4.0.1` | `apps/api/package.json` | `apps/api/src/auth/jwt.strategy.ts` |
| **JWKS-RSA** | `^4.1.0` | `apps/api/package.json` | `apps/api/src/auth/jwt.strategy.ts` (Supabase JWKS) |
| **Class Validator / Transformer** | `^0.15.1` / `^0.5.1` | `apps/api/package.json` | DTO validation across controllers |
| **Tailwind CSS** | `^4` (`@tailwindcss/postcss`) | `apps/web/package.json` | `apps/web/src/app/globals.css` |
| **Lucide React** | `^1.48.0` | `apps/web/package.json` | Icons across `apps/web/src/components/*` |
| **Recharts** | `^3.10.1` | `apps/web/package.json` | `apps/web/src/app/protected/reporting/page.tsx` |
| **ExcelJS** | `^4.4.0` | `apps/api/package.json` | `apps/api/src/reports/reports.service.ts` |
| **Helmet & Express Rate Limit**| `^8.3.0` / `^8.7.0` | `apps/api/package.json` | `apps/api/src/main.ts` |

---

## 5. Application Architecture

```
 Browser / Client
       │ (React 19 / Tailwind CSS 4)
       ▼
 Next.js 16 Web App (apps/web)
       │ HTTP / JSON API requests + Bearer JWT Token
       ▼
 NestJS 12 API Gateway (apps/api)
       │ Global Guards: Helmet, RateLimit, JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard
       ▼
 Service Layer (Calls, Telephony, Routing, Billing, Reports, Permissions)
       │ BigInt micro-dollar arithmetic & atomic operations
       ▼
 Prisma ORM 6 Data Layer
       │ PostgreSQL Schema & Foreign Key Constraints
       ▼
 PostgreSQL 15 Container / Database
```

### Flow Boundaries:
1. **Frontend to Backend**:
   - `apps/web` calls `apps/api` via `apiFetch()` (`apps/web/src/lib/api.ts`).
   - Authentication tokens obtained via Supabase SSR session are attached as `Authorization: Bearer <access_token>`.
   - `workspaceId` is passed either as a path parameter (`/workspaces/:workspaceId/...`) or query string parameter (`?workspace=...`).
2. **Inbound Webhook Flow**:
   - Telnyx or Twilio posts webhook events to `/telephony/telnyx/webhook` or `/telephony/twilio/webhook`.
   - Webhook signatures are validated using public key or provider secret.
   - `WebhookEvent` records are persisted for idempotency (`provider` + `providerEventId` unique constraint).
   - Events are dispatched to `CallController.handleEvent()` (`apps/api/src/telephony/call-controller.ts`).
3. **Background Processing**:
   - Node.js in-memory timers: Active call balance extension loop scheduled in `CallController.scheduleAuthorizationExtension()` (every 8 minutes on 10-minute blocks).
   - Recovery Reconciliation: `ReservationRecoveryService` runs on a 5-minute interval (`setInterval`) to clean up stale call reservations.
   - No external queue worker (BullMQ/RabbitMQ/Redis) is currently introduced; async processing uses in-memory loops and promises.

---

## 6. Backend Module Inventory

| Module Name | Directory | Controllers | Services | Classification | Evidence & Status |
|---|---|---|---|---|---|
| **AppModule** | `apps/api/src/` | `AppController` | `AppService` | **IMPLEMENTED** | Root orchestrator wiring all modules. |
| **TelephonyModule** | `apps/api/src/telephony` | `TelnyxWebhookController`, `TwilioWebhookController`, `RecordingsController` | `CallController`, `TelnyxProvider`, `TwilioProvider`, `WebhookIdempotencyService`, `ReservationRecoveryService` | **IMPLEMENTED** | Full call state machine, provider bridging, recording ingestion, reservation reconciliation. |
| **RoutingModule** | `apps/api/src/routing` | `CampaignsController`, `BuyersController`, `BlockedCallersController` | `CampaignsService`, `BuyersService`, `BlockedCallersService` | **IMPLEMENTED** | Campaign CRUD, Buyer prioritization and timeouts, blocked number checks. |
| **CallsModule** | `apps/api/src/calls` | `CallsController` | `CallsService` | **IMPLEMENTED** | Call history retrieval, call detail lookup, call state transitions (`INITIATED` -> `ROUTING` -> `COMPLETED`/`FAILED`). |
| **BillingModule** | `apps/api/src/billing` | `BillingController` | `BillingService`, `WalletService`, `UsageBillingService`, `MockPaymentProvider` | **IMPLEMENTED** | Prepaid micro-dollar ledger, atomic reservations, top-ups, Stripe webhook stub. |
| **PhoneNumbersModule** | `apps/api/src/phone-numbers` | `PhoneNumbersController` | `PhoneNumbersService`, `TelnyxProvisioningService` | **IMPLEMENTED** | Phone number search, provisioning, release, and campaign assignment. |
| **ReportsModule** | `apps/api/src/reports` | `ReportsController` | `ReportsService` | **IMPLEMENTED** | Call analytics aggregation, saved report configurations, CSV and Excel (`ExcelJS`) exports. |
| **WorkspacesModule** | `apps/api/src/workspaces` | `WorkspacesController`, `InvitationsController`, `VendorsController` | `WorkspacesService`, `VendorsService` | **IMPLEMENTED** | Workspace creation, member management, invitation tokens, vendor entities. |
| **PermissionsModule** | `apps/api/src/permissions` | `PermissionsController` | `PermissionsService` | **IMPLEMENTED** | Granular RBAC keys, workspace member permission assignments, resource scoping. |
| **AuthorizationModule** | `apps/api/src/authorization` | None | `AuthorizationService`, `TenantScopedRepository` | **IMPLEMENTED** | Guards: `WorkspaceRolesGuard`, `PermissionsGuard`, decorators for role and permission checks. |
| **AuthModule** | `apps/api/src/auth` | None | `JwtStrategy` | **IMPLEMENTED** | Passport Supabase JWKS token validation and `ApiKeyGuard`. |
| **AuditLogsModule** | `apps/api/src/audit-logs` | `AuditLogsController` | `AuditLogsService` | **IMPLEMENTED** | Security audit logging for workspace membership and permission changes. |
| **AccountModule** | `apps/api/src/account` | `AccountController` | `AccountService` | **IMPLEMENTED** | User profile retrieval and personal settings update. |
| **PublicApiModule** | `apps/api/src/public-api` | `PublicCallsController`, `PublicCampaignsController`, `PublicBuyersController`, `PublicPhoneNumbersController` | None (delegates to core services) | **IMPLEMENTED** | API key authenticated external endpoints. |
| **ApiKeysModule** | `apps/api/src/api-keys` | `ApiKeysController` | `ApiKeysService` | **IMPLEMENTED** | Hashed API key generation (`cf_live_...`), prefix indexing, revocation. |
| **WebhooksModule** | `apps/api/src/webhooks` | `WebhooksController` | `WebhooksService` | **IMPLEMENTED** | Outbound webhook subscriptions with encrypted secrets and delivery retry scheduling. |
| **UsageModule** | `apps/api/src/usage` | `UsageController` | `UsageService` | **IMPLEMENTED** | Minute and storage usage records creation and query. |
| **CommercialModule** | N/A (Branch-only) | None in HEAD | None in HEAD | **ABSENT IN HEAD** | *Only exists on unmerged branch `agent/commercial-comm14-settlement-generation`.* |
| **SettlementModule** | N/A (Branch-only) | None in HEAD | None in HEAD | **ABSENT IN HEAD** | *Only exists on unmerged branch `agent/commercial-comm14-settlement-generation`.* |

---

## 7. Frontend Architecture

### Application Routes:
- **Public Routes**:
  - `/login` — Email/password login using `@supabase/ssr`.
  - `/signup` — Account registration.
  - `/invitations` — Token validation for new workspace invites.
  - `/auth/callback` — Supabase OAuth/magic link exchange.
- **Protected Routes** (`/protected/*` wrapped in Shell & Workspace Guard):
  - `/protected` — Workspace redirect / dashboard overview.
  - `/protected/calls` — Inbound calls table, status badges, filters, links to detail.
  - `/protected/calls/[callId]` — In-depth call investigation: metadata, buyer hunting timeline, audio player/download.
  - `/protected/reporting` — Dialics-style reporting interface: metrics cards, grouping, filters, saved reports, CSV/XLSX export.
  - `/protected/campaigns` & `/protected/campaigns/[campaignId]` — Campaign routing priorities.
  - `/protected/buyers` & `/protected/buyers/[buyerId]` — Destination buyers and timeout settings.
  - `/protected/phone-numbers` — Inventory, provisioning modal, assignment to campaigns, release.
  - `/protected/blocked-callers` — Blocked phone numbers CRUD.
  - `/protected/billing` — Prepaid balance display, wallet transaction log, mock top-up.
  - `/protected/members` & `/protected/members/[memberId]` — Team members, participant roles, granular permissions editor.
  - `/protected/invitations` — Pending invitation management.
  - `/protected/api-keys` — Developer API key creation and revocation.
  - `/protected/webhooks` — Outbound webhook endpoint management.
  - `/protected/account` — User display name and preferences.
  - `/protected/settings` — Workspace name, slug, deletion.

### State & Client Architecture:
- Next.js App Router with React 19 Client Components (`'use client'`).
- `workspaceId` state stored in URL query params (`?workspace=...`) and validated by `<WorkspaceValidator />`.
- Shell layout `<Shell />` (`apps/web/src/components/shell.tsx`) provides navigation, top header with live wallet balance, and theme toggling (`next-themes`).

---

## 8. Database Architecture

The Prisma schema on the current active branch `agent/reporting-backend-fix` defines **20 models** and **10 enums**:

### 1. Tenancy, Identity & RBAC
- **`Profile`** (`profiles`): Maps to Supabase Auth User ID (`id`). Relations to memberships, API keys, saved reports.
- **`Workspace`** (`workspaces`): Multi-tenant root. Contains unique `slug`, `status`. Cascades deletions to owned entities.
- **`WorkspaceMember`** (`workspace_members`): Composite unique constraint `@@unique([workspace_id, user_id])`. Links `Profile` to `Workspace`. Contains `role` (`OWNER`, `ADMIN`, `MEMBER`, `VIEWER`), `participant_type` (`INTERNAL`, `VENDOR`, `BUYER`), nullable FKs `vendor_id`, `buyer_id`.
- **`WorkspaceInvitation`** (`workspace_invitations`): Holds invitation tokens (`token_hash` unique), status (`PENDING`, `ACCEPTED`, `REVOKED`, `EXPIRED`), role, and participant links.
- **`Permission`** (`permissions`): Master catalog of permission keys (`key` unique), group, description.
- **`WorkspaceMemberPermission`** (`workspace_member_permissions`): Grants a permission to a member with optional resource scoping (`scope_type`: `ALL`, `ASSIGNED`, `CAMPAIGN`, `PHONE_NUMBER`, `BUYER`, `VENDOR`) and `resource_id`.
- **`SecurityAuditLog`** (`security_audit_logs`): Immutable audit trail of workspace administration and permission changes.

### 2. Telephony & Routing
- **`PhoneNumber`** (`phone_numbers`): Inbound tracking numbers. `phone_number` unique. Contains `provider` (`telnyx`/`twilio`), `number_type`, `status` (`ACTIVE`, `RELEASED`, `PROVISIONING`), optional FK `campaign_id`.
- **`Campaign`** (`campaigns`): Routing container for phone numbers and buyers.
- **`Buyer`** (`buyers`): Call termination endpoint. Holds E.164 `destination_number`, `timeout` in seconds, `status`.
- **`CampaignBuyer`** (`campaign_buyers`): Priority routing join table. Unique constraints: `@@unique([campaign_id, priority])` and `@@unique([campaign_id, buyer_id])`.
- **`BlockedCaller`** (`blocked_callers`): Inbound blacklist. Composite unique: `@@unique([workspace_id, phone_number])`.

### 3. Call Lifecycle & Media
- **`Call`** (`calls`): Authoritative inbound call leg. `provider_call_id` unique. Fields: `from_number`, `to_number`, `state` (`INITIATED`, `ROUTING`, `COMPLETED`, `NO_ANSWER`, `FAILED`, `CANCELED`), timestamps (`started_at`, `answered_at`, `ended_at`, `duration_secs`).
- **`CallAttempt`** (`call_attempts`): Outbound buyer dial legs. Fields: `call_id`, `buyer_id`, `provider_call_id` (unique), `state` (`INITIATED`, `RINGING`, `ANSWERED`, `COMPLETED`, `NO_ANSWER`, `FAILED`, `CANCELED`), duration, timestamps.
- **`Recording`** (`recordings`): Call audio recording metadata. `provider_id` unique, `recording_url`, `status` (`PENDING`, `COMPLETED`, `FAILED`).

### 4. Billing & Prepaid Wallet
- **`WorkspaceBalance`** (`workspace_balances`): Single row per workspace (`workspace_id` PK). Contains `balance_micro` (BigInt), `reserved_micro` (BigInt), `currency` (default USD).
- **`WalletTransaction`** (`wallet_transactions`): Append-only financial ledger. `amount_micro` (BigInt), `balance_after_micro` (BigInt), `idempotency_key` (unique), `reference_type`, `reference_id`.
- **`CallReservation`** (`call_reservations`): Mid-call balance hold. Unique `call_id`. Fields: `original_reserved_micro`, `total_reserved_micro`, `status` (`ACTIVE`, `SETTLED`, `RELEASED`, `EXPIRED`).
- **`CallReservationExtension`** (`call_reservation_extensions`): Incremental balance holds during long calls. Unique `idempotency_key`.

### 5. Reporting, Webhooks & APIs
- **`SavedReport`** (`saved_reports`): Custom report definitions. Fields: `name`, `visibility` (`PERSONAL`, `SHARED`), JSON `configuration`.
- **`ApiKey`** (`api_keys`): External developer keys. Stores `key_prefix` and `hashed_secret` (SHA-256).
- **`WebhookEvent`** (`webhook_events`): Inbound provider webhook deduplication. `@@unique([provider, providerEventId])`.
- **`OutboundWebhook`** & **`WebhookDelivery`**: Outbound event delivery with encrypted secret and retry tracking.
- **`UsageRecord`** (`usage_records`): Aggregated usage logs with unique `idempotency_key`.

---

## 9. Database Migration History

The active branch contains **26 migrations** under `apps/api/prisma/migrations/`:

| Timestamp & Migration Name | Scope & Changes |
|---|---|
| `20260921024015_init_stage4` | Baseline schema: Workspaces, Profiles, Members, PhoneNumbers, Calls, Recordings |
| `20260921122310_init_stage10` | Added Usage records table |
| `20260921123938_init_stage11` | Added Billing customers, Subscriptions, Plans |
| `20260921130752_init_stage12` | Added Invoices table |
| `20260921132240_init_stage13` | Added Blocked callers table |
| `20260921150000_init_stage18` | Added Campaign buyers routing priorities |
| `20260921225626_init_stage19` | Added Call attempts table |
| `20260922005800_init_stage20_api_keys` | Added Api keys table |
| `20260922005935_stage20_api_keys_userid` | Added user_id FK to Api keys |
| `20260922014437_add_webhooks` | Added Outbound webhooks and deliveries |
| `20260922082025_add_logical_event_id` | Added logical event ID to webhook delivery |
| `20260928000000_crud12_hardening` | Hardened cascade deletes and unique constraints |
| `20260930000000_unique_owner_per_user` | Added single owner workspace rule |
| `20260930000001_add_number_type` | Added number_type field to PhoneNumbers |
| `20260930000002_add_call_lifecycle_timestamps`| Added started_at, answered_at, ended_at to Calls and Attempts |
| `20260930161333_add_workspace_balance` | Added initial workspace balance table |
| `20261002000000_wallet_core_schema` | Added Wallet transactions table |
| `20261002000001_add_wallet_reservation` | Added Call reservations table |
| `20261002000001_micro_dollar_wallet` | Converted balances and reservations to micro-dollars (BigInt) |
| `20261003000000_rbac_1_participant_type` | Added participant_type to WorkspaceMember |
| `20261003000000_saved_reports_init` | Added SavedReport table for analytics |
| `20261003000001_rbac_2_vendor_buyer` | Added Vendor and Buyer relation to WorkspaceMember |
| `20261003000002_rbac_3_invitations` | Added participant fields to WorkspaceInvitation |
| `20261003000003_rbac_4_permissions` | Added Permissions and WorkspaceMemberPermission tables |
| `20261004000000_rbac_5_resource_scope` | Added ResourceScopeType enum and scoping fields |
| `20261006000000_rbac_10_audit_logs` | Added SecurityAuditLog table |

*Note on COMM Migrations*:
The migrations associated with COMM-13 and COMM-13B (`20261007000000_comm13_settlement_core` and `20261007000001_comm13b_settlement_participant_side`) are **not present** on current HEAD. They exist exclusively on the `agent/commercial-comm14-settlement-generation` branch.

---

## 10. Workspace / Multi-Tenancy

CallFlow enforces multi-tenancy at multiple architectural layers:

1. **Database Model Constraints**:
   - Every resource (`PhoneNumber`, `Campaign`, `Buyer`, `Call`, `Recording`, `SavedReport`, `ApiKey`, `OutboundWebhook`, `WalletTransaction`) contains a non-nullable `workspace_id` foreign key referencing `workspaces.id` with `onDelete: Cascade`.
   - Workspace ownership is mediated via `WorkspaceMember`.
2. **Controller & Route Layer Isolation**:
   - Protected API routes include `:workspaceId` in path or accept `workspaceId` in query.
   - `WorkspaceRolesGuard` (`apps/api/src/authorization/workspace-roles.guard.ts`) intercepts the request, reads `request.user.userId` from JWT, validates that the user possesses a `WorkspaceMember` record for that `workspaceId`, and enforces role hierarchy.
3. **Service Layer Filtering**:
   - Queries unconditionally pass `workspace_id` in Prisma `where` clauses:
     ```ts
     this.prisma.call.findMany({ where: { workspace_id: workspaceId, ...filters } })
     ```
   - Repository-level abstraction: `TenantScopedRepository` (`apps/api/src/authorization/tenant-scoped.repository.ts`) exists as a utility to standardize workspace scoping.
4. **Weakness / Edge Cases Identified**:
   - Inbound webhook controllers (`/telephony/telnyx/webhook`) run without user context; they resolve `workspace_id` by looking up the destination `PhoneNumber` in the database. If a phone number is unassigned or orphaned, incoming events cannot be mapped and are dropped.

---

## 11. Authentication / Authorization

### Authentication:
- **Provider**: Supabase Auth (GoTrue).
- **Mechanism**: JWT tokens signed by Supabase.
- **Backend Verification**: `JwtStrategy` (`apps/api/src/auth/jwt.strategy.ts`) verifies tokens using `jwks-rsa` fetching the public key directly from `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` supporting ES256 and RS256 algorithms.
- **API Key Auth**: `ApiKeyGuard` verifies hashed API keys (`cf_live_...`) against `api_keys.hashed_secret`.

### Authorization:
- **Workspace Roles**:
  - `OWNER`: Full administrative and billing authority.
  - `ADMIN`: Resource configuration, user management, routing management.
  - `MEMBER`: Operational actions.
  - `VIEWER`: Read-only access.
- **Granular RBAC & Permissions**:
  - Defined in `PermissionsGuard` and `PermissionsService`.
  - Permissions include granular keys like `calls:read`, `reports:read`, `reports:export`, `routing:manage`, `buyers:manage`, `billing:manage`.
  - Resource scoping: `ResourceScopeType` (`ALL`, `ASSIGNED`, `CAMPAIGN`, `PHONE_NUMBER`, `BUYER`, `VENDOR`) allows restricting external buyers or vendors to view only calls and reports belonging to their assigned resource.

---

## 12. External Integrations

| Integration | Purpose | SDK / Library | Configuration Env Vars | Endpoints / Controllers | Failure Handling |
|---|---|---|---|---|---|
| **Telnyx** | Inbound call routing, number provisioning, call bridging, recordings | `telnyx` (`^7.21.0`) | `TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY`, `TELNYX_CALL_CONTROL_APP_ID` | `POST /telephony/telnyx/webhook` | Ed25519 webhook signature validation, retry fallback, `WebhookEvent` idempotency |
| **Twilio** | Alternate telephony provider | `twilio` (`^6.1.1`) | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | `POST /telephony/twilio/webhook` | Twilio HMAC signature verification |
| **Supabase** | User authentication & JWKS validation | `@supabase/ssr`, `jwks-rsa` | `SUPABASE_URL` | Handled via Next.js middleware and NestJS `JwtStrategy` | JWKS caching, rate limiting (5 req/min) |
| **Stripe** | Payment gateway for subscription / billing | `stripe` (`^22.6.2`) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | `POST /billing/webhook` | Webhook signature verification |

---

## 13. Call Lifecycle Architecture

| Stage | Lifecycle Event | Status in HEAD | Code Evidence |
|---|---|---|---|
| 1. Inbound Call Event | Webhook received from Telnyx/Twilio | **IMPLEMENTED** | `apps/api/src/telephony/telnyx/telnyx.webhook.controller.ts` |
| 2. Call Creation | Call record inserted in `INITIATED` state | **IMPLEMENTED** | `apps/api/src/telephony/call-controller.ts:210` (`CallsService.createCall`) |
| 3. Fund Authorization | Wallet holds 10-minute block in micro-dollars | **IMPLEMENTED** | `apps/api/src/telephony/call-controller.ts:225` (`WalletService.reserveForCall`) |
| 4. Routing & Blacklist | Blocked caller check & campaign validation | **IMPLEMENTED** | `apps/api/src/telephony/call-controller.ts:184-208` |
| 5. Destination Selection | Next buyer selected by campaign priority | **IMPLEMENTED** | `apps/api/src/telephony/call-controller.ts:420` (`dialNextBuyer`) |
| 6. Call Attempt | Outbound dial leg initiated to buyer | **IMPLEMENTED** | `apps/api/src/calls/calls.service.ts` (`createAttempt`, `commitBuyerDial`) |
| 7. Answer & Bridging | Inbound and buyer legs bridged together | **IMPLEMENTED** | `apps/api/src/telephony/call-controller.ts:291` (`provider.bridgeCalls`) |
| 8. Balance Extensions | Heartbeat extensions every 8 min during call | **IMPLEMENTED** | `apps/api/src/telephony/call-controller.ts:30` (`scheduleAuthorizationExtension`) |
| 9. Recording | Audio recording saved & usage billed | **IMPLEMENTED** | `apps/api/src/telephony/call-controller.ts:314` (`CALL_RECORDING_SAVED`) |
| 10. Hangup & Settlement | Reservation finalized against actual duration | **IMPLEMENTED** | `apps/api/src/telephony/call-controller.ts:351` (`billCallUsage`) |
| 11. Final Call Status | Call set to `COMPLETED`, `NO_ANSWER`, or `FAILED` | **IMPLEMENTED** | `apps/api/src/calls/calls.service.ts` (`handleCallerHangup`) |
| 12. Commercial Evaluation | Pay-per-call qualification, payout, revenue | **MISSING IN HEAD** | *Present only in branch `agent/commercial-comm14-settlement-generation`* |
| 13. Call Dispute Flow | Dispute submission and financial adjustment | **MISSING IN HEAD** | *Present only in branch `agent/commercial-comm14-settlement-generation`* |
| 14. Batch Settlement | Participant batch generation and execution | **MISSING IN HEAD** | *Present only in branch `agent/commercial-comm14-settlement-generation`* |

---

## 14. Commercial Architecture — High Level

### Forensic Finding:
On current HEAD (`agent/reporting-backend-fix`), the commercial subsystem is **NOT present**.

On the parallel baseline branch `agent/commercial-comm14-settlement-generation`, the commercial architecture comprises:
- **Prisma Models**: `CallCommercial`, `CallDispute`, `CallFinancialAdjustment`.
- **Services**: `CommercialEvaluatorService` (`apps/api/src/commercial/commercial-evaluator.service.ts`), `CommercialDisputesService` (`apps/api/src/commercial/commercial-disputes.service.ts`).
- **Core Concepts Handled**:
  - `Qualified`: Whether call answered duration exceeded threshold.
  - `Converted`: Whether buyer converted call.
  - `Duplicate`: Whether caller contacted campaign within duplicate window.
  - `Revenue`, `Payout`, `Cost`, `Profit`: Decimal(12, 4) financial tracking.
  - `finalizes_at`: Lock timestamp after which disputes are restricted.

---

## 15. Settlement Architecture — High Level

| Component / Model | Database | Service | API Controller | Frontend | Tests |
|---|---|---|---|---|---|
| **SettlementBatch** | BRANCH-ONLY | BRANCH-ONLY | BRANCH-ONLY | NO | BRANCH-ONLY |
| **SettlementItem** | BRANCH-ONLY | BRANCH-ONLY | BRANCH-ONLY | NO | BRANCH-ONLY |
| **SettlementAdjustment** | BRANCH-ONLY | BRANCH-ONLY | BRANCH-ONLY | NO | BRANCH-ONLY |
| **PaymentInstruction** | BRANCH-ONLY | NO | NO | NO | BRANCH-ONLY (Schema) |
| **PaymentExecution** | BRANCH-ONLY | NO | NO | NO | BRANCH-ONLY (Schema) |
| **ReconciliationRun** | BRANCH-ONLY | NO | NO | NO | BRANCH-ONLY (Schema) |
| **ReconciliationIssue** | BRANCH-ONLY | NO | NO | NO | BRANCH-ONLY (Schema) |

*Legend*:
- **BRANCH-ONLY**: Implemented and tested in `agent/commercial-comm14-settlement-generation` (`59da9de`), but absent from HEAD (`f901302`).
- **NO**: Not implemented in either branch.

---

## 16. Background / Async Processing

1. **Active Call Reservation Extension Loop**:
   - **Trigger**: In-memory `setTimeout` scheduled when call is bridged.
   - **Processing**: Every 8 minutes, requests a 10-minute block reservation extension from `WalletService`.
   - **Persistence**: Persisted in `CallReservationExtension` with unique idempotency key.
   - **Idempotency**: `extension:${callId}:${extensionIndex}` guarantees exact-once execution.
   - **Failure Behavior**: If wallet lacks balance, triggers provider hangup (`call.authorization.exhausted`).
2. **Reservation Recovery Reconciliation Loop**:
   - **Trigger**: Periodic `setInterval` every 5 minutes in `ReservationRecoveryService` (`apps/api/src/telephony/reservation-recovery.service.ts`).
   - **Processing**: Scans for `CallReservation` rows in `ACTIVE` state whose `updated_at` is older than 15 minutes.
   - **Action**: Queries telephony provider for call state. If provider confirms call has terminated, settles call usage and releases leftover reservation.
3. **Outbound Webhook Delivery**:
   - Outbound events are queued to `webhook_deliveries` with `next_attempt_at` and `attempt_count` for backoff retries.

---

## 17. Test Architecture

The codebase contains a comprehensive automated test suite in `apps/api/test` executed using Vitest:

- **E2E & Integration Suites**:
  - `account.e2e-spec.ts` — User account endpoints.
  - `auth.e2e-spec.ts` & `authorization.e2e-spec.ts` — Authentication & guard enforcement.
  - `billing.e2e-spec.ts` & `call-routing-billing.spec.ts` — Wallet balance, reservation, and usage billing.
  - `rbac-1.e2e-spec.ts` through `rbac-10-audit-logs.e2e-spec.ts` — Exhaustive 10-phase RBAC verification.
  - `recordings.e2e-spec.ts` — Recording metadata and download URL security.
  - `recovery.spec.ts` & `reservation.spec.ts` — Stale reservation recovery and mid-call extensions.
  - `reports.e2e-spec.ts` & `reports-export.e2e-spec.ts` — Aggregated reporting queries and binary exports.
  - `routing-engine.e2e-spec.ts` — Buyer sequential hunting, timeouts, and blacklist filtering.
- **Frontend Tests**:
  - `apps/web/src/app/protected/billing/page.test.tsx`
  - `apps/web/src/app/protected/calls/page.test.tsx`
  - `apps/web/src/app/protected/phone-numbers/page.test.ts`
  - `apps/web/src/app/protected/reporting/page.test.tsx`
  - `apps/web/src/components/sidebar.spec.tsx`

---

## 18. Build / Deployment Architecture

- **Root Scripts**: `test` (`jest --testPathIgnorePatterns=apps`).
- **Backend Scripts** (`apps/api/package.json`):
  - `npm run start:dev` — `nest start --watch`
  - `npm run build` — `nest build`
  - `npm run test` — `vitest run`
  - `npm run test:e2e` — `vitest run --mode e2e --config ./vitest.config.e2e.ts`
  - `npm run lint` — `oxlint src/ test/`
- **Frontend Scripts** (`apps/web/package.json`):
  - `npm run dev` — `next dev -p 3001`
  - `npm run build` — `next build`
  - `npm run test` — `vitest run`
- **Docker Compose**: `docker-compose.yml` runs a standalone PostgreSQL 15 database service on port `5432`.
- **CI/CD**: No external GitHub Actions or CI pipeline manifests are committed in `.github/workflows`.

---

## 19. Configuration Inventory

*All variables declared in `.env.example`; no secrets exposed*:

### Core Server & Network:
- `PORT` (Default: `3000`)
- `BASE_URL` (Public URL / Ngrok tunnel for webhook reception)
- `FRONTEND_URL` (Default: `http://localhost:3001` for CORS)

### Database:
- `DATABASE_URL` (PostgreSQL connection string)

### Authentication:
- `SUPABASE_URL` (Used for JWKS fetching and token issuer verification)

### Telephony:
- `TELEPHONY_PROVIDER` (`telnyx` or `twilio`)
- `TELNYX_API_KEY`
- `TELNYX_PUBLIC_KEY`
- `TELNYX_CALL_CONTROL_APP_ID`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`

### Billing & Stripe:
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

### Security:
- `WEBHOOK_ENCRYPTION_KEY` (32-character AES secret for outbound webhook URLs/secrets)

---

## 20. Dead / Orphaned Code & Branch Drift

1. **Temporary Scratch Files in Repository Root**:
   - Found 46 `.cjs` scripts (e.g. `patch_calls.cjs`, `fix_balance_ts.cjs`, `check_isolated_db.cjs`, `clear_wallet_table.cjs`).
   - These are manual scratch scripts from earlier development iterations and do not form part of production code.
2. **Branch Drift & Orphaned Implementations**:
   - The commercial system (`COMM-1` through `COMM-14`) is entirely isolated on branch `agent/commercial-comm14-settlement-generation`.
   - The RBAC and reporting export enhancements are on `agent/reporting-backend-fix`.
   - Any feature expecting both commercial calculations and RBAC/saved reports cannot function until an architectural reconciliation/merge occurs.
3. **Unused Provider Modules**:
   - `apps/api/src/telephony/twilio/twilio.provider.ts`: Functional provider exists, but default system configuration uses Telnyx.

---

## 21. Architectural Risks

1. **Branch Divergence Risk (HIGH)**:
   - There are 12,000+ lines of divergent code between the Commercial baseline (`59da9de`) and current HEAD (`f901302`).
   - The commercial evaluator hook was removed from `apps/api/src/telephony/call-controller.ts` in current HEAD because the commercial tables do not exist in this branch's Prisma schema.
2. **In-Memory Timers for Mid-Flight Calls (MEDIUM)**:
   - Mid-call reservation extensions rely on Node.js `setTimeout` in `activeCallTimers` (`CallController`).
   - If the API server restarts during a call, the in-memory timer is lost.
   - *Mitigation in place*: `ReservationRecoveryService` polls every 5 minutes to clean up dead reservations, but mid-call extension requires persistent scheduling in production.
3. **Webhook Port Ingress**:
   - Telephony providers require public internet access. Local development depends on `BASE_URL` tunneling. Unreachable webhooks result in unbridged calls.

---

## 22. Known Unknowns

1. **Production Deployment Target**:
   - No Kubernetes manifests, Terraform templates, or AWS/GCP configuration files are present. Target hosting environment is unknown.
2. **Stripe Production Readiness**:
   - The Stripe subscription flow is partially scaffolded via `BillingService` and `MockPaymentProvider`, but live webhook integration for recurring SaaS plans is untested in production.

---

## 23. Architecture Dependency Map

```
  ┌────────────────────────────────────────────────────────┐
  │                   apps/web (Next.js)                   │
  └───────────────────────────┬────────────────────────────┘
                              │ HTTP / Bearer Auth
                              ▼
  ┌────────────────────────────────────────────────────────┐
  │                   apps/api (NestJS)                    │
  │  ┌───────────────┐ ┌──────────────┐ ┌───────────────┐  │
  │  │  Auth Module  │ │ RBAC / Perms │ │   Reporting   │  │
  │  └───────┬───────┘ └──────┬───────┘ └───────┬───────┘  │
  │          │                │                 │          │
  │  ┌───────▼───────┐ ┌──────▼───────┐ ┌───────▼───────┐  │
  │  │   Telephony   │ │ Routing Core │ │ Prepaid Wallet│  │
  │  └───────┬───────┘ └──────┬───────┘ └───────┬───────┘  │
  └──────────┼────────────────┼─────────────────┼──────────┘
             │                │                 │
             ▼                ▼                 ▼
  ┌────────────────────────────────────────────────────────┐
  │                 Prisma ORM 6.0 Client                  │
  └───────────────────────────┬────────────────────────────┘
                              │ SQL
                              ▼
  ┌────────────────────────────────────────────────────────┐
  │              PostgreSQL 15 Database Engine             │
  └────────────────────────────────────────────────────────┘
```

---

## 24. Final System Status Summary

| Area | Status | Evidence |
|---|---|---|
| **Call System** | IMPLEMENTED | `apps/api/src/calls/calls.service.ts`, `apps/api/src/telephony/call-controller.ts` |
| **Routing Engine** | IMPLEMENTED | `apps/api/src/routing/campaigns.service.ts`, `apps/api/src/routing/buyers.service.ts` |
| **Campaigns** | IMPLEMENTED | `apps/api/src/routing/campaigns.controller.ts`, `apps/web/src/app/protected/campaigns` |
| **Buyers** | IMPLEMENTED | `apps/api/src/routing/buyers.controller.ts`, `apps/web/src/app/protected/buyers` |
| **Vendors** | IMPLEMENTED | `apps/api/src/workspaces/vendors.service.ts`, Prisma `Vendor` model |
| **Tracking Numbers** | IMPLEMENTED | `apps/api/src/phone-numbers/phone-numbers.service.ts`, `TelnyxProvisioningService` |
| **Number Pools** | PARTIAL | Phone number provisioning exists, pool rotation logic is minimal |
| **Reporting & Export** | IMPLEMENTED | `apps/api/src/reports/reports.service.ts`, `apps/web/src/app/protected/reporting` |
| **Prepaid Wallet & Billing** | IMPLEMENTED | `apps/api/src/billing/wallet.service.ts`, `usage-billing.service.ts` |
| **Multi-Tenancy** | IMPLEMENTED | `apps/api/src/authorization/workspace-roles.guard.ts`, `tenant-scoped.repository.ts` |
| **Authentication** | IMPLEMENTED | `apps/api/src/auth/jwt.strategy.ts` (Supabase JWKS verification) |
| **Authorization & RBAC** | IMPLEMENTED | `apps/api/src/authorization/permissions.guard.ts`, `apps/api/src/permissions/` |
| **Telnyx Integration** | IMPLEMENTED | `apps/api/src/telephony/telnyx/telnyx.provider.ts`, webhook controllers |
| **Twilio Integration** | PARTIAL | `apps/api/src/telephony/twilio/twilio.provider.ts` |
| **Commercial (Pay-per-call)** | BRANCH-ONLY | Absent in HEAD; fully implemented in `agent/commercial-comm14-settlement-generation` |
| **Disputes** | BRANCH-ONLY | Absent in HEAD; fully implemented in `agent/commercial-comm14-settlement-generation` |
| **Settlement Generation** | BRANCH-ONLY | Absent in HEAD; implemented up to COMM-14 in baseline branch |
| **Payment Execution** | SCHEMA-ONLY | Models exist in COMM-14 branch schema, service logic not implemented |
| **Reconciliation** | SCHEMA-ONLY | Models exist in COMM-14 branch schema, service logic not implemented |

---
*Report generated strictly in read-only reconnaissance mode without modifications to codebase, packages, schema, or configuration.*
