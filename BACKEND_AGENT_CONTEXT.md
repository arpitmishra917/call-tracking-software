# BACKEND_AGENT_CONTEXT.md

## 1. Purpose of This Document

This file serves as the permanent backend onboarding document for future Backend ChatGPT conversations and Gemini backend coding agents working on the CallFlow project. It is intended to be read by any AI agent assigned to backend tasks to understand the implemented architecture without repeatedly rediscovering it.

This document covers the backend architecture, module responsibilities, database schema, telephony provider abstractions, authentication, tenant isolation, and known project constraints. 

It does **not** replace the master product specification.

**MVP1_BUILD_SPEC_v5.md remains the master product specification.** This file merely describes the current backend implementation context as it actually exists in the source code.

---

## 2. Source-of-Truth Hierarchy

When evaluating requirements, conflicts, or existing behavior, an agent must adhere to the following hierarchy of truth:

1. **`MVP1_BUILD_SPEC_v5.md`**: The master product specification and ultimate authority on what should be built.
2. **Actual Source Code and Database Schema (`apps/api/*`)**: The authoritative record of what is *currently* implemented.
3. **Canonical Documentation (`docs/`)**: Detailed technical decisions and implementation details.
4. **This Context File (`BACKEND_AGENT_CONTEXT.md`)**: A synthesized map for agents.
5. **Archived/Historical Documentation (`docs/13-archive/`)**: Outdated or historical context (do not use for current architecture).

If this document or other historical documents conflict with the actual source code, **the source code and Prisma schema are authoritative regarding implementation**. If the implemented code conflicts with the master specification, the discrepancy must be reported.

---

## 3. Project Identity

- **Product Name**: CallFlow
- **Product Purpose**: A multi-tenant call tracking and sequential buyer-routing SaaS platform.
- **SaaS Model**: Multi-tenant with strict workspace-based isolation.
- **Backend Responsibility**: Core business logic, routing, authentication, tenant isolation, telephony provider communication, API endpoints, webhooks, and billing.
- **Frontend/Backend Separation**: The frontend handles UI state and presentation. The backend is the sole source of truth for routing logic, provider integration, and data persistence.
- **Primary Backend Location**: `apps/api/`
- **Git Branch (Backend)**: `backend-dev`
- **Main Branch**: `main` (Integration branch)
- **Backend Worktree**: `C:\Users\prate\OneDrive\Desktop\callflow-backend`

---

## 4. Technology Stack

The currently used backend technology stack (verified via `apps/api/package.json`):

- **Node.js**: Runtime environment
- **TypeScript**: Language
- **NestJS** (v12): Application framework
- **Prisma** (v6): ORM for database access
- **PostgreSQL**: Relational database
- **Supabase Auth**: External identity provider
- **JWT / JWKS**: Asymmetric JWT verification using `jwks-rsa` and `passport-jwt` (RS256/ES256)
- **Telnyx** (v7): Primary production telephony provider
- **Twilio** (v6): Development and validation telephony provider
- **Stripe** (v22): Billing provider
- **Vitest**: Testing framework (Unit & E2E)
- **Security**: `helmet`, `express-rate-limit`
- **Validation**: `class-validator`, `class-transformer`

*(Note: Redis is not currently implemented in this backend stack based on `package.json`.)*

---

## 5. Repository Structure

The backend repository is structured within `apps/api/`:

```
apps/api/
├── dist/                # Compiled application output
├── prisma/              
│   ├── migrations/      # Database migrations
│   └── schema.prisma    # Prisma schema definition
├── scripts/             # Utility and setup scripts
├── src/                 # Application source code
│   ├── auth/            # JWT strategies and authentication
│   ├── authorization/   # RBAC, tenant guards, decorators
│   ├── billing/         # Stripe integration and subscription logic
│   ├── calls/           # Call and CallAttempt data models
│   ├── common/          # Shared utilities (e.g., safeFetch)
│   ├── phone-numbers/   # Number provisioning and application assignment
│   ├── public-api/      # Customer-facing API endpoints with API key auth
│   ├── routing/         # Routing config (campaigns, buyers, blocklists)
│   ├── telephony/       # Provider abstraction and execution logic (CallController)
│   ├── usage/           # Usage metering (minutes, numbers, recordings)
│   ├── webhooks/        # Outbound customer webhooks and delivery
│   ├── workspaces/      # Tenant isolation and workspace management
│   ├── app.module.ts
│   └── main.ts
└── test/                # Test environment
```

---

## 6. Backend Module Map

- **Auth** (`src/auth/`): Implements `JwtStrategy` mapping Supabase JWKS to the NestJS Passport system.
- **Authorization** (`src/authorization/`): Contains `WorkspaceRolesGuard`, `JwtAuthGuard`, and tenant-scoped repository tools. Enforces Workspace isolation.
- **Workspaces** (`src/workspaces/`): Manages `Workspace` and `WorkspaceMember` entities. Handles tenant creation and user membership.
- **Phone Numbers** (`src/phone-numbers/`): Provisions tracking numbers via `TelnyxProvisioningService` and maps them to workspaces/campaigns.
- **Routing** (`src/routing/`): Manages `Campaign`, `Buyer`, `CampaignBuyer` (priorities), and `BlockedCaller`. Contains core configuration controllers for the routing engine.
- **Telephony** (`src/telephony/`): The core provider abstraction layer. Contains the `CallController` for state execution, the abstract `TelephonyProvider`, and provider adapters (`TelnyxProvider`, `TwilioProvider`, `FakeProvider`). Also handles provider webhook events and webhook idempotency.
- **Calls** (`src/calls/`): Exposes API endpoints for reading `Call`, `CallAttempt`, and `Recording` states.
- **Usage** (`src/usage/`): Tracks billable events (CALL_MINUTE, PHONE_NUMBER, RECORDING_STORAGE) independently of Stripe.
- **Billing** (`src/billing/`): Manages `Plan`, `Subscription`, `Invoice`, and `BillingCustomer` via Stripe.
- **Public API** (`src/public-api/`): Exposes external customer API endpoints authenticated via hashed API Keys instead of JWT.
- **Webhooks** (`src/webhooks/`): Manages customer `OutboundWebhook` configs and `WebhookDelivery` states with cryptographic signatures.

---

## 7. File-Level Backend Map

**`apps/api/src/auth/jwt.strategy.ts`**
- **Purpose**: Authenticates internal UI API requests.
- **Important behavior**: Fetches Supabase JWKS from `.well-known/jwks.json`, validates ES256/RS256 asymmetric signatures, and injects `{ userId, email, role }` into the request payload.

**`apps/api/src/authorization/workspace-roles.guard.ts`**
- **Purpose**: Tenant and role-based authorization guard.
- **Important behavior**: Extracts `workspaceId` from the route params or headers, verifies the authenticated user is a `WorkspaceMember`, and checks if their role meets the `@WorkspaceRoles()` metadata requirement. Strict tenant isolation.

**`apps/api/src/routing/campaigns.service.ts` / `buyers.service.ts`**
- **Purpose**: CRUD for routing logic.
- **Important behavior**: Ensures all operations are scoped to a `workspaceId`. Maintains the `CampaignBuyer` sequence priority constraint.

**`apps/api/src/telephony/call-controller.ts`**
- **Purpose**: The execution entrypoint for call state.
- **Important behavior**: Receives incoming provider webhooks and manages the routing execution. Triggers `dialNextBuyer`, transitions `CallState` and `CallAttemptState`, and communicates with the current provider adapter.

**`apps/api/src/telephony/telnyx/telnyx.provider.ts`**
- **Purpose**: Primary telephony provider implementation.
- **Important behavior**: Implements the `TelephonyProvider` interface to execute Call Control commands (answer, dial, hangup) and parse Telnyx webhooks. 

**`apps/api/src/common/safe-fetch.ts`**
- **Purpose**: Server-Side Request Forgery (SSRF) protection.
- **Important behavior**: Implements `validateSsrfUrl` which resolves DNS and blocks private/loopback/link-local IPv4 and IPv6 ranges. Executes native `fetch` utilizing manual redirect logic (`redirect: 'manual'`). It intercepts HTTP 3xx status codes, extracts the `location` header, resolves relative URLs, and re-validates the new target in a loop (up to maxRedirects=3) before initiating the fetch again.
- **Security Considerations**: Contains a known TOCTOU (Time-of-Check to Time-of-Use) DNS rebinding vulnerability since the OS performs DNS resolution in `dns.lookup` and then again in `fetch`.

**`apps/api/prisma/schema.prisma`**
- **Purpose**: The absolute source of truth for the database schema. Contains all multi-tenant cascading relations and database constraints.

---

## 8. Authentication Architecture

The internal backend API (used by the Next.js frontend UI) is authenticated via **Supabase Auth**.

- **Tokens**: The frontend sends a Bearer Token (JWT).
- **Verification**: The backend uses `@nestjs/passport` and `jwks-rsa`. It retrieves the public keys asymmetrically from the Supabase `/auth/v1/.well-known/jwks.json` endpoint.
- **Algorithms**: Validates `ES256` and `RS256`.
- **Validation**: Strict issuer (`/auth/v1`) and audience (`authenticated`) matching.
- **Result**: The decoded payload provides the user's identity (`userId`), which is then used by the Authorization layer to check workspace membership.

**Important Note**: The system does NOT use HS256 symmetrical verification with a secret. Previous documentation claiming this is outdated.

---

## 9. Authorization and RBAC

Authorization is strictly separated from Authentication. Once a user is authenticated, they must be authorized for the specific `workspaceId` requested.

- **WorkspaceRole**: `OWNER`, `ADMIN`, `MEMBER`, `VIEWER`.
- **WorkspaceRolesGuard**: An intercepting guard that requires a route to declare minimum required roles (via `@WorkspaceRoles()`). It intercepts the request, checks the user's `WorkspaceMember` record for the targeted workspace, and blocks access if insufficient.
- **Resource Ownership**: All data read/write operations must explicitly query with the `workspace_id` to prevent cross-tenant bleeding.

---

## 10. Multi-Tenant / Workspace Isolation

CallFlow enforces strict logical tenant isolation. The primary isolation boundary is the `Workspace`.

- Every billable, configurable, or viewable entity (Campaign, Buyer, PhoneNumber, Call, Webhook, API Key) contains a `workspace_id` foreign key.
- Endpoints receive a `workspaceId` (usually as a URL parameter like `/api/workspaces/:workspaceId/campaigns`).
- The `WorkspaceRolesGuard` validates the authenticated user belongs to that exact `workspaceId`.
- **Agent Rule**: Before writing a query, the agent MUST include `where: { workspace_id: workspaceId }` to guarantee isolation. Never trust a client-provided entity ID without validating it belongs to the authorized workspace.

---

## 11. Database Architecture

- **Database**: PostgreSQL
- **ORM**: Prisma Client
- **Schema Location**: `apps/api/prisma/schema.prisma`
- **Migrations**: `apps/api/prisma/migrations/`
- **Design Pattern**: Heavy reliance on UUID primary keys, explicit `@@index` on `workspace_id` and foreign keys, and `onDelete: Cascade` for tenant cleanup, or `onDelete: SetNull` for historical persistence (e.g., deleted Campaigns leave Calls intact but orphaned).

**Important Constraints**:
- `CampaignBuyer` specifies `@@unique([campaign_id, priority])` to guarantee priority values cannot conflict within a campaign.
- Unique provider IDs: `provider_call_id` on Call, `provider_call_id` on CallAttempt, and `provider_id` on Recording.

---

## 12. Database Model Reference

**Core Models**:
- `Workspace`: The tenant container.
- `Profile`: The application representation of a Supabase user.
- `WorkspaceMember`: Join table linking `Profile` to `Workspace` with a `WorkspaceRole`.

**Routing Models**:
- `PhoneNumber`: A tracking number. Contains `provider_number_id` (the ID of the number resource at the provider), `connection_id` (the provider-level application ID association), and `campaign_id` (the application-level association for CallFlow routing execution).
- `Campaign`: A routing configuration grouping buyers.
- `Buyer`: A destination endpoint (E.164 number).
- `CampaignBuyer`: Join table defining the `priority` (integer) order of a Buyer within a Campaign.
- `BlockedCaller`: A tenant-specific E.164 blocklist.

**Execution Models**:
- `Call`: A single inbound call from a caller to a tracking number.
- `CallAttempt`: A specific routing attempt from the Call to a specific Buyer.
- `Recording`: A recorded artifact of a Call.

**Billing & API Models**:
- `UsageRecord`: Metered billing events tied to an idempotency key.
- `Subscription` / `Invoice`: Stripe billing data.
- `ApiKey`: Hashed access keys for the Public API.
- `OutboundWebhook` / `WebhookDelivery`: Customer endpoint configuration and delivery logs.

---

## 13. Database Relationships

**Tenant Roots:**
`Workspace` → `PhoneNumber`
`Workspace` → `Campaign`
`Workspace` → `Buyer`
`Workspace` → `Call`
`Workspace` → `UsageRecord`

**Routing Engine Configuration:**
`PhoneNumber` (N) → (1) `Campaign` (1) → (N) `CampaignBuyer` (N) ← (1) `Buyer`

**Call Execution State:**
`Call` (1) → (N) `CallAttempt` (N) ← (1) `Buyer`
`Call` (1) → (N) `Recording`

---

## 14. API Architecture

The backend API is built on NestJS controllers.

- **Internal API**: Consumed by the Next.js frontend. Protected by `JwtAuthGuard` and `WorkspaceRolesGuard`. Responses use standard JSON representations. Validation via `class-validator` DTOs.
- **Route Organization**: Grouped by module. Standard pattern is `/api/workspaces/:workspaceId/<resource>`.

**Major Endpoint Categories (Internal)**:
- Workspaces: `/api/workspaces`
- Phone Numbers: `/api/workspaces/:workspaceId/phone-numbers`
- Campaigns: `/api/workspaces/:workspaceId/campaigns`
- Buyers: `/api/workspaces/:workspaceId/buyers`
- Blocked Callers: `/api/workspaces/:workspaceId/blocked-callers`
- Calls & Recordings: `/api/workspaces/:workspaceId/calls`
- Webhooks Config: `/api/workspaces/:workspaceId/webhooks`
- Usage & Billing: `/api/workspaces/:workspaceId/usage`, `/api/workspaces/:workspaceId/billing`

---

## 15. Public API

Located in `src/public-api/`. 

- **Purpose**: Allows external customers to interact with their workspace data programmatically.
- **Base Route**: `/api/v1/*`
- **Authentication**: Uses `ApiKeysGuard` instead of `JwtStrategy`.
- **Tenant Resolution**: The API key itself resolves the `workspaceId`. Customers do not pass `workspaceId` in the URL for public API routes.
- **Endpoints**: Exposes controlled equivalents of Campaign, Buyer, Call, and PhoneNumber reads/writes.

---

## 16. API Key Security

- **Generation**: Secure random string.
- **Storage**: The backend stores ONLY the `hashed_secret` (using a strong cryptographic hash) and the `key_prefix` (for identification).
- **Visibility**: The raw secret is returned to the user exactly once upon creation and is unrecoverable thereafter.
- **Authentication**: Middleware parses the `Bearer <key>`, looks up the `hashed_secret` by prefix, and securely compares hashes to authenticate the request and infer the `workspaceId`.

---

## 17. Telephony Architecture

The backend isolates specific vendor lock-in behind a `TelephonyProvider` abstraction interface.

```
Incoming Webhook → CallController → Provider Adapter → Telephony Events → Application Logic
```
The application logic triggers routing behavior which calls abstract methods like `provider.dial()`, `provider.answer()`, or `provider.hangup()`. The configured provider adapter translates these into vendor-specific HTTP requests or responses.

---

## 18. Telnyx Integration

Telnyx is the **primary production provider**.

**Provisioning Flow:**
1. Number purchase occurs via Telnyx API (`provider_number_id`).
2. `TELNYX_CALL_CONTROL_APP_ID` is used to establish the **Voice Application association** (mapped locally to `connection_id`).
3. This creates a **PROVIDER-LEVEL ASSOCIATION**, determining that Telnyx routes calls for this number to CallFlow's webhook endpoints.
4. Independently, a **APPLICATION-LEVEL CAMPAIGN ASSIGNMENT** sets `campaign_id` on the `PhoneNumber`, determining which CallFlow campaign processes the call.

**Execution:**
- **Mechanism**: Telnyx Voice API / Call Control.
- **NOT TeXML**: This project does NOT use TwiML/TeXML translation. It uses programmatic Call Control commands (JSON over HTTP).
- **Webhooks**: Telnyx sends asynchronous event webhooks to `/api/webhooks/telnyx`.
- **Security**: Verifies the `telnyx-signature-ed25519` header against the raw request body.

---

## 19. Twilio Integration

Twilio is the **development and validation provider**.

- **Purpose**: Used for local development or alternative provider validation to ensure the abstraction layer functions.
- **Mechanism**: Implements the same `TelephonyProvider` abstraction but translates to Twilio APIs.

---

## 20. Phone Number Architecture

1. **Provider Provisioning**: The number is purchased and exists at the provider (`provider_number_id`). It is tied to the CallFlow application via a connection/application ID (`connection_id`).
2. **Application Assignment**: Within CallFlow, the `PhoneNumber` entity can be assigned to a `campaign_id`. When an inbound call arrives to that number, the system looks up the associated `campaign_id` to start routing.

---

## 21. Campaign and Buyer Architecture

- A **Buyer** represents an answering endpoint (E.164 number) with a `timeout`.
- A **Campaign** represents a routing configuration.
- A **CampaignBuyer** links them, defining an explicit integer `priority`.
- **Constraint**: `[campaign_id, priority]` is strictly unique. No two buyers can have the same priority in a campaign.

---

## 22. Routing Engine

The Routing Engine is split between configuration and execution.
- **A. Routing Configuration**: Stored in `apps/api/src/routing/` (Campaigns, Buyers, CampaignBuyers) which define the priority structure.
- **B. Routing Execution**: Handled dynamically in `apps/api/src/telephony/call-controller.ts`. It executes sequentially via the `dialNextBuyer` service method.

Execution Process:
1. Call arrives.
2. Check `BlockedCaller` list (hang up if blocked).
3. Identify `PhoneNumber` → `Campaign`.
4. Load active `CampaignBuyer`s sorted by `priority` ascending.
5. Create a `CallAttempt` to the Buyer with priority 1. Send `dial` command.
6. If the provider reports `NO_ANSWER` or `FAILED`, the `call-controller.ts` catches the event, transitions the `CallAttempt` to failed, and initiates a new attempt to the Buyer with priority 2.
7. Repeats until a buyer answers, or the campaign exhausts all buyers.

**Known Limitation**: Concurrent provider events on the same active call can cause state-machine data collisions (e.g., race conditions between answer and timeout). This is an acknowledged E2E limitation.

---

## 23. Call State Machine

**`CallState` Enum:**
`INITIATED` → `ROUTING` → `COMPLETED` | `NO_ANSWER` | `FAILED` | `CANCELED`

**`CallAttemptState` Enum:**
`INITIATED` → `RINGING` → `ANSWERED` | `COMPLETED` | `NO_ANSWER` | `FAILED` | `CANCELED`

The application logic inside `call-controller.ts` explicitly transitions these states upon receiving asynchronous provider webhooks.

---

## 24. Recordings

- Triggered based on workspace or campaign configuration via provider commands.
- Provider sends a webhook with the recording URL when finished.
- Saved in the `Recording` table.
- **Security**: Recording URLs are considered sensitive. If the provider requires authentication to fetch the recording, the backend must proxy the request or generate pre-signed URLs to protect tenant privacy.

---

## 25. Blocked Callers

- Stored per `workspace_id`.
- Phone numbers must be normalized to E.164 before storage and comparison.
- Evaluated synchronously at the very beginning of the call routing flow. If matched, the call is instantly rejected via a provider hangup command.

---

## 26. Usage Metering

- Captures billable raw events into `UsageRecord`.
- **Types**: `CALL_MINUTE`, `PHONE_NUMBER`, `RECORDING_STORAGE`.
- Employs an `idempotency_key` to prevent double-counting events delivered multiple times via webhooks.
- Disconnected from real-time Stripe billing (asynchronous aggregation).

---

## 27. Billing

- Integrates with Stripe using `Plan`, `Subscription`, `BillingCustomer`, and `Invoice`.
- Manages Stripe checkout sessions and customer portals.
- Listens to Stripe webhooks to update local `Subscription` statuses.
- **Verification Status**: Complete Live Stripe E2E verification has NOT been fully confirmed.

---

## 28. Customer Webhooks

Customer webhooks allow clients to receive POST requests for call events. This logic is handled securely in `apps/api/src/webhooks/webhooks.service.ts`:

- **Event Identity**: Generates a stable logical event ID (`evt_${eventType}_${entityId}`).
- **Durable Idempotency**: Creates `WebhookDelivery` records. A composite unique constraint ensures `[outbound_webhook_id, event_id]` prevents queuing duplicate events.
- **Tenant Isolation**: `queueEvent` processes active webhooks specific to the `workspace_id`. `deleteWebhook` and `getWebhooks` require `workspaceId` matching for OWNER/ADMIN authorization.
- **Atomic Claiming / Locking**: Employs `FOR UPDATE SKIP LOCKED` inside a PostgreSQL query to atomically process up to 20 deliveries without worker collisions.
- **Security / Signatures**: 
  - The signing secret is securely encrypted at rest (`aes-256-cbc`).
  - An HMAC signature is generated over a concatenated payload (`${event_id}.${timestamp}.${payload_json}`) using SHA256 and transmitted in the `Webhook-Signature` header.
  - The included timestamp mitigates tampering and replay attacks.
- **Resilience & Retries**: 
  - HTTP 2xx statuses mark delivery as `SUCCESS`.
  - HTTP 5xx or network errors mark delivery as `PENDING` with an updated `last_error`.
  - Employs exponential backoff for retries (`Math.pow(2, newAttemptCount) * 5` seconds).
  - Maximum of 5 attempts. Reaching 5 attempts permanently marks the delivery as `FAILED`.

---

## 29. Security Architecture

- **Authentication**: Asymmetric JWKS (no shared secrets).
- **Authorization**: RBAC + Strict workspace ID enforcement.
- **Provider Security**: Cryptographic signature validation of incoming webhooks.
- **API Security**: `helmet` headers, API key hashing, `express-rate-limit`.
- **Data Protection**: Prepared statements via Prisma prevent SQL injection.

---

## 30. SSRF Protection

- Located in `safeFetch` (`apps/api/src/common/safe-fetch.ts`).
- Validates URLs prior to fetching (used in Outbound Webhooks).
- Resolves DNS and strictly rejects private, loopback, and link-local IPv4/IPv6 ranges.
- Restricts protocols to HTTP/HTTPS.
- **Known Limitation**: `safeFetch` resolves DNS during validation, then `fetch` resolves DNS again. This TOCTOU (Time-Of-Check to Time-Of-Use) window is vulnerable to advanced DNS rebinding attacks.

---

## 31. Webhook Security

There are two distinct webhook boundaries:
1. **Inbound Provider Webhooks**: Authenticated via provider-specific cryptographic signatures (e.g., Telnyx Ed25519) requiring access to the raw HTTP request body.
2. **Outbound Customer Webhooks**: Secured by CallFlow generating an HMAC signature over the JSON payload, allowing customers to verify the request originated from CallFlow.

---

## 32. Error Handling

- Uses standard NestJS Exception Filters.
- Auth errors yield 401 Unauthorized.
- Authorization/Tenant violations yield 403 Forbidden or 404 Not Found (to prevent resource existence leakage).
- Validation errors (DTO failures) yield 400 Bad Request.

---

## 33. Environment Configuration

Important environment variables (DO NOT hardcode secrets in this codebase):
- `DATABASE_URL`: PostgreSQL connection string.
- `SUPABASE_URL`: Identity provider endpoint (used for JWKS).
- `TELEPHONY_PROVIDER`: e.g., `telnyx` or `twilio`.
- `TELNYX_API_KEY`: Secret API Key.
- `TELNYX_PUBLIC_KEY`: Used for webhook signature verification.
- `TELNYX_CALL_CONTROL_APP_ID`: Target application for number provisioning.
- `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN`: Twilio credentials.
- `WEBHOOK_ENCRYPTION_KEY`: A 32-character symmetric key used to encrypt customer webhook signing secrets.

---

## 34. Testing Architecture

- **Unit Tests**: Co-located `*.spec.ts` files verifying business logic, routing prioritization, and auth. Run via Vitest.
- **E2E Tests**: Found in `/test/` and configurable via `vitest.config.e2e.ts`. E2E tests spin up the NestJS application and verify API boundaries, database operations, and tenant isolation using fake JWTs and the FakeProvider.

---

## 35. Real Provider Verification Status

| Area | Status | Evidence |
|---|---|---|
| Telnyx number provisioning | VERIFIED | E2E proven |
| Telnyx Voice Application | VERIFIED | E2E proven |
| Telnyx webhook delivery | VERIFIED | Base functions verified |
| Telnyx Call Control | VERIFIED | Base functions verified |
| Telnyx recording | VERIFIED | Proven with provisioning |
| Telnyx campaign routing | **NOT VERIFIED** | Lacks real E2E evidence |
| Twilio validation | VERIFIED | Dev-only real E2E functional |
| Stripe live verification | **NOT VERIFIED** | Lacks live evidence |
| Customer webhook external endpoint | **NOT VERIFIED** | Lacks live evidence |

---

## 36. Known Limitations

- **Routing Concurrency**: State-machine data collisions during simultaneous fast provider webhooks on the same call.
- **Campaign Routing**: Real Telnyx campaign routing has not been fully verified in reality.
- **SSRF TOCTOU**: DNS rebinding vulnerability in `safeFetch`.
- **Production Ops**: Fresh infrastructure deployment, backup/restore, and rollback procedures are documented but NOT execution-verified in reality.
- **Billing**: Live Stripe verification is incomplete.

---

## 37. Out of Scope

Do NOT implement the following without explicit authorization:
- Dynamic Number Insertion (DNI)
- Website visitor tracking
- Google Ads attribution
- Facebook attribution
- GCLID/FBCLID
- IVR
- DTMF menus
- Geographic routing
- Business-hours routing
- Round robin
- Skill routing
- Call Flow Builder
- RTB (Real-Time Bidding)
- Ping/Post
- Lead marketplace
- White-label
- Fraud detection
- Dispute management
- AI voice agents
- Transcription unless separately authorized
- SIP softphone
- Chat/SMS
- CRM
- Email marketing
- Marketing automation
- Unrequested integrations

---

## 38. Backend Development Rules

For future AI Agents:
1. **Inspect before modifying**: Always read existing implementations.
2. **Smallest correct change**: Do not refactor unrelated modules.
3. **Preserve tenant isolation**: Never query without `workspace_id`.
4. **Do not invent functionality**: Do not hallucinate APIs or fields.
5. **Report truthfully**: Never claim a test passed if you did not run it. Never claim E2E verification based purely on unit tests.
6. **No frontend modification**: Do not touch `apps/web/` unless specifically directed.

---

## 39. Backend / Frontend Boundary

- **Backend**: Authoritative for authentication, authorization, routing logic, provider integrations, webhooks, billing, usage, and database state.
- **Frontend**: Exclusively for presentation, routing (UI), and state consumption. It must NEVER enforce business rules (like sequence priority ordering calculations) that the backend relies on.

---

## 40. Git and Worktree

- **Main (`main`)**: The stable integration branch. Do not commit here directly.
- **Backend Branch (`backend-dev`)**: The active branch for backend development.
- **Worktree Restriction**: The backend agent operates strictly within the backend worktree (`callflow-backend`). Do not run `git init` or interfere with other repositories.

---

## 41. Change Management

Typical workflow:
1. Task Assignment
2. Backend Agent inspection & planning
3. Implementation (smallest correct change)
4. Tests (Unit/E2E) Execution
5. Final Report detailing true results
6. Human Review
7. Integration

---

## 42. Documentation Conflicts

**Identified Discrepancy**:
- `CALLFLOW_PROJECT_CONTEXT.md` states: "Backend uses passport-jwt verifying HS256 symmetrical tokens via JWT_SECRET."
- **TRUTH**: Source code `apps/api/src/auth/jwt.strategy.ts` explicitly uses `jwks-rsa` to fetch public keys asymmetrically from Supabase and validates `ES256/RS256` signatures. The system does not use HS256 symmetrical verification.

---

## 43. Current Backend Status

- **IMPLEMENTED**: Workspaces, Profiles, Supabase JWKS Auth, RBAC Authorization, Phone Numbers, Campaigns, Buyers, Calls, Webhooks, Billing, Provider Abstraction.
- **UNIT/MOCK VERIFIED**: Routing logic fallback, sequential prioritization, tenant isolation.
- **REAL PROVIDER VERIFIED**: Telnyx Provisioning, Recording, base Call Control. Twilio development flow.
- **NOT VERIFIED**: Real Telnyx multi-buyer campaign routing execution. Live Stripe integration. Live external customer webhook delivery.
- **KNOWN LIMITATIONS**: safeFetch TOCTOU, routing concurrency collision.

---

## 44. Quick Reference

| Area | Location | Status |
|---|---|---|
| Auth / JWT | `src/auth/jwt.strategy.ts` | IMPLEMENTED |
| Authorization | `src/authorization/workspace-roles.guard.ts` | IMPLEMENTED |
| Workspaces | `src/workspaces/` | IMPLEMENTED |
| Phone Numbers | `src/phone-numbers/` | IMPLEMENTED |
| Campaigns | `src/routing/campaigns.*` | IMPLEMENTED |
| Buyers | `src/routing/buyers.*` | IMPLEMENTED |
| Routing Config | `src/routing/` | IMPLEMENTED |
| Calls & Execution | `src/telephony/call-controller.ts` | IMPLEMENTED |
| Telnyx Provider | `src/telephony/telnyx/telnyx.provider.ts` | IMPLEMENTED |
| Twilio Provider | `src/telephony/twilio/twilio.provider.ts` | IMPLEMENTED |
| Webhooks | `src/webhooks/` | IMPLEMENTED |
| Usage & Billing | `src/usage/`, `src/billing/` | IMPLEMENTED |
| Public API | `src/public-api/` | IMPLEMENTED |
| DB Schema | `prisma/schema.prisma` | IMPLEMENTED |
