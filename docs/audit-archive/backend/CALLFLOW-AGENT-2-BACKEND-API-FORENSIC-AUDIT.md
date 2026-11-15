# CallFlow Agent 2 — Backend/API Forensic Audit

## 1. Audit Metadata

- **Auditor**: CallFlow Forensic Reconnaissance Agent 2 (Backend & API Forensic Investigator)
- **Investigation Date**: 2026-10-08
- **Current Branch**: `agent/reporting-backend-fix`
- **Current HEAD Commit**: `f901302b156c2779a169b2ceeb27ba7fe0c09be3` (`fix(reporting): fix owner reporting authorization`)
- **Working Tree Status**: Clean (`nothing to commit, working tree clean`)
- **Known Frozen Baseline**: `59da9de33703ee55f94b8eec1ea21a603c46e3be` (matching prefix `59da9de`, specifically commit `59da9deba18254da918e60623f440581deb97a53` on branch `agent/commercial-comm14-settlement-generation`)
- **Baseline Divergence Analysis**:
  - The repository's commit tree establishes that current HEAD `f901302` is the common merge-base ancestor of branch `agent/commercial-comm14-settlement-generation`.
  - The known frozen baseline `59da9de` is **21 commits ahead** of current HEAD `f901302`.
  - Those 21 commits introduced commercial pay-per-call modeling, post-call evaluation, buyer disputes, financial adjustments, commercial reporting integration, and settlement batch generation.
  - In the **current checked-out codebase** (`agent/reporting-backend-fix` at `f901302`), commercial and settlement code is **not yet merged / unapplied** (37 files changed, +120 / -12,108 lines compared to `59da9de`).
  - To provide complete ground truth, this audit forensically inspects the **current working codebase** while rigorously evaluating every contract against the **frozen baseline `59da9de`**.

---

## 2. Executive Summary

A forensic inspection of the CallFlow backend reveals a dual reality between the current checked-out branch and the frozen commercial baseline:

1. **Current Codebase Capabilities (`agent/reporting-backend-fix`)**:
   - CallFlow has a functioning core telephony routing engine supporting inbound Telnyx and Twilio call initiation, sequential buyer waterfall routing based on integer priority, live call bridging, call recording capture, call hangup handling, and outbound webhooks.
   - It features an operational micro-dollar wallet reservation system (`WorkspaceBalance`, `WalletTransaction`, `CallReservation`, `CallReservationExtension`) that checks available balance before answering calls, extends reservations during active calls, and bills call duration upon completion.
   - It implements multi-tenant workspace isolation with a granular RBAC subsystem (`Profile`, `WorkspaceMember`, `Permission`, `WorkspaceMemberPermission`, `SecurityAuditLog`), supporting `ALL`, `ASSIGNED`, `CAMPAIGN`, `PHONE_NUMBER`, `BUYER`, and `VENDOR` resource scoping.
   - Reporting backend exists across two controllers: `CallsController` provides aggregate call KPIs (`total`, `answered`, `missed`, `failed`, `blocked`, `avgDuration`, `tclSecs`, `aclSecs`), time-series bucket charts, live calls count, and paginated call logs with duration filtering; `ReportsController` provides saved report CRUD and streaming binary export (`CSV` and `XLSX`).
   - However, **commercial economics, revenue, payout, profit, qualification, duplicate detection, disputes, and settlement generation are completely absent from the current checked-out codebase**.

2. **Frozen Baseline Divergence (`59da9de`)**:
   - In `59da9de`, `CallCommercial`, `CallDispute`, `CallFinancialAdjustment`, `SettlementBatch`, `SettlementItem`, `PaymentInstruction`, `PaymentExecution`, `ReconciliationRun`, and `ReconciliationIssue` are modeled in Prisma.
   - `CommercialEvaluatorService` evaluates completed calls and creates `CallCommercial` snapshots with `revenue`, `payout`, `cost` (sourced from the debit settlement transaction), and `profit`.
   - `CommercialDisputesController` and `CommercialDisputesService` expose dispute creation and manager resolution (`ACCEPTED` -> revenue=0, payout=0, cost preserved, profit=-cost, status=`ADJUSTED`).
   - `SettlementBatchService` implements COMM-14/14B settlement batch generation with strict `[period_start, period_end)` contract and maturity checks (`finalizes_at <= now()`), partitioned by `(buyer_id, currency)` and `(vendor_id, currency)`.
   - **Critical Baseline Finding**: `CommercialEvaluatorService` initializes `CallCommercial` with `status: PENDING` and `finalizes_at: null`. **No automated job or transition engine exists to mature calls to `FINAL` or populate `finalizes_at = created_at + 168 hours`**. Consequently, `SettlementBatchService` can never naturally select organic calls produced by the evaluator without external manual database updates.
   - `PaymentInstruction` and `PaymentExecution` are **schema-only** (no execution engine or provider).
   - `ReconciliationRun` and `ReconciliationIssue` are **schema-only** (no reconciliation engine).

---

## 3. Backend Module Inventory

| Module Name | Directory | Controllers | Services | Guards / Interceptors | Data Layer / Models Touched | Event / Webhook Handlers | Scheduled Jobs | Tests Present | Responsibility & Actual Functionality |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **AppModule** | `apps/api/src` | `AppController` | `AppService` | `JwtAuthGuard` | None | None | None | `app.controller.spec.ts`, `app.e2e-spec.ts` | Root module wiring all modules, exposes health/root route and protected test route. |
| **AuthModule** | `apps/api/src/auth` | None | None | `JwtStrategy` | `Profile` | None | None | `auth.e2e-spec.ts` | Supabase JWT token verification via JWKS (`ES256`/`RS256`), extracts user claims into `req.user`. |
| **AuthorizationModule**| `apps/api/src/authorization` | None | `AuthorizationService` | `WorkspaceRolesGuard`, `PermissionsGuard` | `WorkspaceMember`, `Workspace` | None | None | `authorization.e2e-spec.ts`, `rbac-enforcement.e2e-spec.ts` | Enforces workspace membership, role requirements, operational workspace status lock, and resource scoping. |
| **PermissionsModule** | `apps/api/src/permissions` | `PermissionsController` | `PermissionsService` | `JwtAuthGuard` | `Permission`, `WorkspaceMemberPermission`, `WorkspaceMember` | None | None | `rbac-1.e2e-spec.ts` to `rbac-7.e2e-spec.ts` | Manages granular permission definitions, seeds permissions on init, evaluates member permissions and resource scopes. |
| **AccountModule** | `apps/api/src/account` | `AccountController` | `AccountService` | `JwtAuthGuard` | `Profile` | None | None | `account.e2e-spec.ts` | Retrieves user profile, updates display name. |
| **WorkspacesModule** | `apps/api/src/workspaces` | `WorkspacesController`, `InvitationsController`, `VendorsController` | `WorkspacesService`, `VendorsService` | `JwtAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` | `Workspace`, `WorkspaceMember`, `WorkspaceInvitation`, `Vendor`, `Buyer` | None | None | `workspaces.service.spec.ts`, `workspaces.e2e-spec.ts` | Workspace CRUD, member role management, participant-aware invitations (Vendor/Buyer/Internal), token verification, vendor directory. |
| **TelephonyModule** | `apps/api/src/telephony` | `TelnyxWebhookController`, `TwilioWebhookController`, `RecordingsController` | `CallController`, `WebhookIdempotencyService`, `ReservationRecoveryService` | Provider signature validation, Idempotency DB lock | `Call`, `CallAttempt`, `PhoneNumber`, `BlockedCaller`, `Recording`, `WebhookEvent` | Telnyx/Twilio webhooks (`call.initiated`, `call.answered`, `call.hangup`, `call.recording.saved`) | Reservation recovery reconciliation | `telephony.spec.ts`, `telnyx.spec.ts`, `twilio.spec.ts`, `concurrency.spec.ts`, `recordings.e2e-spec.ts` | Central telephony core. Ingests carrier webhooks, normalizes events, drives call routing state machine, bridges calls, manages in-memory extension timers. |
| **CallsModule** | `apps/api/src/calls` | `CallsController` | `CallsService` | `JwtAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` | `Call`, `CallAttempt`, `Recording`, `PhoneNumber`, `CampaignBuyer` | Webhook dispatch (`call.started`, `call.answered`, `call.ended`, `call.blocked`) | None | `calls.spec.ts`, `calls.controller.spec.ts`, `call-routing-billing.spec.ts` | Call persistence, state transitions with row-locking (`FOR UPDATE`), buyer dialing preparation, caller hangup cleanup, call reporting queries and metrics aggregations. |
| **RoutingModule** | `apps/api/src/routing` | `CampaignsController`, `BuyersController`, `BlockedCallersController` | `CampaignsService`, `BuyersService`, `BlockedCallersService` | `JwtAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` | `Campaign`, `Buyer`, `CampaignBuyer`, `BlockedCaller` | None | None | `routing.spec.ts`, `campaigns.service.spec.ts`, `blocked-callers.service.spec.ts`, `routing-engine.e2e-spec.ts` | Campaigns CRUD, buyer CRUD, campaign-buyer priority assignment and transaction reordering, E.164 phone number blocking. |
| **PhoneNumbersModule** | `apps/api/src/phone-numbers` | `PhoneNumbersController` | `PhoneNumbersService`, `TelnyxProvisioningService` | `JwtAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` | `PhoneNumber`, `Campaign` | None | None | `phone-numbers.spec.ts`, `telnyx-provisioning.service.spec.ts` | Inbound tracking numbers listing, provisioning via Telnyx API, campaign assignment, number updating and release. |
| **BillingModule** | `apps/api/src/billing` | `BillingController` | `BillingService`, `WalletService`, `UsageBillingService`, `MockPaymentProvider` | `JwtAuthGuard`, `WorkspaceRolesGuard`, Stripe webhook signature | `WorkspaceBalance`, `WalletTransaction`, `CallReservation`, `CallReservationExtension`, `BillingCustomer`, `Subscription`, `Invoice` | Stripe webhook (`invoice.payment_succeeded`, etc.) | None | `billing.service.spec.ts`, `wallet.service.spec.ts`, `billing.controller.spec.ts`, `billing.e2e-spec.ts`, `mock-topup.spec.ts` | Micro-dollar workspace wallet balance, transaction ledger, call reservation and extension holds, usage billing deduction, Stripe subscription integration. |
| **UsageModule** | `apps/api/src/usage` | None | `UsageService` | None | `UsageRecord` | None | None | `usage.service.spec.ts` | Records operational usage units (`CALL_MINUTE`, `PHONE_NUMBER`, `RECORDING_STORAGE`) with unique idempotency keys. |
| **ReportsModule** | `apps/api/src/reports` | `ReportsController` | `ReportsService` | `JwtAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` | `SavedReport`, `Call` | None | None | `reports.e2e-spec.ts`, `reports-export.e2e-spec.ts`, `reporting.e2e-spec.ts` | Saved reports CRUD (personal vs shared visibility) and streaming Excel (`xlsx`) / CSV (`csv`) export generation with anti-CSV injection escaping. |
| **ApiKeysModule** | `apps/api/src/api-keys` | `ApiKeysController` | `ApiKeysService` | `JwtAuthGuard`, `WorkspaceRolesGuard` | `ApiKey` | None | None | `public-api.e2e-spec.ts` | High-entropy SHA-256 hashed API key creation (`pk_...`), validation, listing, and revocation. |
| **PublicApiModule** | `apps/api/src/public-api` | 9 Controllers (see Section 4) | Injects internal domain services | `ApiKeyAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` | Workspace resources | None | None | `public-api.e2e-spec.ts` | External REST API v1 (`/api/v1/workspaces/...`) authenticated via Bearer API keys. |
| **WebhooksModule** | `apps/api/src/webhooks` | `WebhooksController` | `WebhooksService` | `JwtAuthGuard`, `WorkspaceRolesGuard` | `OutboundWebhook`, `WebhookDelivery` | Outbound HTTP POST dispatcher | Outbound retry dispatcher | `webhooks.controller.spec.ts`, `webhooks.service.spec.ts`, `webhooks.e2e-spec.ts` | User-configured outbound webhook subscriptions, payload signing with HMAC secret, asynchronous delivery tracking with retry backoff. |
| **AuditLogsModule** | `apps/api/src/audit-logs` | `AuditLogsController` | `AuditLogsService` | `JwtAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` | `SecurityAuditLog` | None | None | `rbac-10-audit-logs.e2e-spec.ts` | Security audit logging for sensitive actions (invitations, role updates, permission changes), audit trail query API. |
| **PrismaModule** | `apps/api/src/prisma` | None | `PrismaService` | None | All DB models | None | None | `prisma.spec.ts` | Global database connection lifecycle management via Prisma Client. |

---

## 4. Complete API Inventory

All 67 endpoints existing in the current codebase are documented below with complete forensic metadata.

### 4.1 Root & Account Endpoints

#### 1. `GET /`
- **Ownership**: `AppModule` -> `AppController.getHello` -> `AppService.getHello`
- **Security**: Public. No authentication or workspace required.
- **Input**: None.
- **Processing**: Returns static string `'Hello World!'`. Touches no database models.
- **Output**: Plain string (`Hello World!`).
- **Tests**: `src/app.controller.spec.ts`, `test/app.e2e-spec.ts`.
- **Frontend Usage**: None.

#### 2. `GET /protected`
- **Ownership**: `AppModule` -> `AppController.getProtected`
- **Security**: `JwtAuthGuard` (Authenticated user). No workspace required.
- **Input**: None.
- **Processing**: Echoes authenticated user payload from JWT.
- **Output**: `{ message: 'This is a protected route', user: { userId, email, role } }`.
- **Tests**: `test/auth.e2e-spec.ts`.
- **Frontend Usage**: None.

#### 3. `GET /account`
- **Ownership**: `AccountModule` -> `AccountController.getAccount` -> `AccountService.getAccount`
- **Security**: `JwtAuthGuard`.
- **Input**: None.
- **Processing**: Queries `prisma.profile.findUnique({ where: { id: req.user.userId } })`.
- **Output**: `{ id, display_name, created_at, updated_at }`.
- **Tests**: `test/account.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/account/page.tsx`.

#### 4. `PUT /account/profile`
- **Ownership**: `AccountModule` -> `AccountController.updateProfile` -> `AccountService.updateProfile`
- **Security**: `JwtAuthGuard`.
- **Input**: Body `{ fullName: string }`.
- **Processing**: Upserts profile with `display_name = fullName`.
- **Output**: Updated `Profile`.
- **Tests**: `test/account.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/account/page.tsx`.

---

### 4.2 Workspace Management Endpoints

#### 5. `POST /workspaces`
- **Ownership**: `WorkspacesModule` -> `WorkspacesController.createWorkspace` -> `WorkspacesService.createWorkspace`
- **Security**: `JwtAuthGuard`.
- **Input**: Body `{ name: string }`.
- **Processing**: Creates `Workspace` (slugified), creates `WorkspaceMember` with role `OWNER`, initializes default permissions.
- **Output**: Created `Workspace` with members.
- **Tests**: `test/workspaces.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/onboarding/onboarding-client.tsx`, `apps/web/src/app/protected/settings/page.tsx`.

#### 6. `GET /workspaces`
- **Ownership**: `WorkspacesModule` -> `WorkspacesController.getUserWorkspaces` -> `WorkspacesService.getUserWorkspaces`
- **Security**: `JwtAuthGuard`.
- **Input**: None.
- **Processing**: Finds all workspaces where `user_id = req.user.userId`.
- **Output**: Array of `Workspace` objects with user membership role.
- **Tests**: `test/workspaces.e2e-spec.ts`.
- **Frontend Usage**: Header workspace selector, Settings, Members page.

#### 7. `GET /workspaces/:workspaceId`
- **Ownership**: `WorkspacesModule` -> `WorkspacesController.getWorkspace` -> `WorkspacesService.getWorkspaceInfo`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard` (`OWNER`, `ADMIN`, `MEMBER`, `VIEWER`).
- **Input**: Path `workspaceId: string`.
- **Processing**: Queries `prisma.workspace.findUnique`.
- **Output**: Workspace metadata.
- **Tests**: `test/workspaces.e2e-spec.ts`.
- **Frontend Usage**: Protected layout wrapper.

#### 8. `PUT /workspaces/:workspaceId/settings`
- **Ownership**: `WorkspacesModule` -> `WorkspacesController.updateSettings` -> `WorkspacesService.updateWorkspaceSettings`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard` (`OWNER`, `ADMIN`).
- **Input**: Path `workspaceId`, Body `{ name: string }`.
- **Processing**: Updates workspace name.
- **Output**: Updated `Workspace`.
- **Tests**: `test/workspaces.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/settings/page.tsx`.

#### 9. `PUT /workspaces/:workspaceId/status`
- **Ownership**: `WorkspacesModule` -> `WorkspacesController.updateStatus` -> `WorkspacesService.updateWorkspaceStatus`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard` (`OWNER` only).
- **Input**: Path `workspaceId`, Body `{ status: 'ACTIVE' | 'SUSPENDED' | 'TERMINATED' }`.
- **Processing**: Updates workspace status. Special-cased in `AuthorizationService` to allow restoring suspended workspaces.
- **Output**: Updated `Workspace`.
- **Tests**: `test/workspaces.e2e-spec.ts`.
- **Frontend Usage**: None directly.

#### 10. `GET /workspaces/:workspaceId/members`
- **Ownership**: `WorkspacesModule` -> `WorkspacesController.getMembers` -> `WorkspacesService.getWorkspaceMembers`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard` (`OWNER`, `ADMIN`, `MEMBER`, `VIEWER`).
- **Input**: Path `workspaceId`.
- **Processing**: Lists members joined with profile and participant data (Vendor/Buyer).
- **Output**: Array of members.
- **Tests**: `test/workspaces.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/members/page.tsx`.

#### 11. `PUT /workspaces/:workspaceId/members/:userId/role`
- **Ownership**: `WorkspacesModule` -> `WorkspacesController.updateMemberRole` -> `WorkspacesService.updateMemberRole`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard` (`OWNER`, `ADMIN`).
- **Input**: Path `workspaceId`, `userId`, Body `{ role: WorkspaceRole }`.
- **Processing**: Updates member role, audits action in `SecurityAuditLog`.
- **Output**: Updated member.
- **Tests**: `test/rbac-10-audit-logs.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/members/page.tsx`.

#### 12. `DELETE /workspaces/:workspaceId/members/:userId`
- **Ownership**: `WorkspacesModule` -> `WorkspacesController.removeMember` -> `WorkspacesService.removeMember`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard` (`OWNER`, `ADMIN`).
- **Input**: Path `workspaceId`, `userId`.
- **Processing**: Deletes membership record, prevents removing last owner.
- **Output**: `{ success: true }`.
- **Tests**: `test/workspaces.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/members/page.tsx`.

#### 13. `GET /workspaces/:workspaceId/invitations`
- **Ownership**: `WorkspacesModule` -> `WorkspacesController.getInvitations` -> `WorkspacesService.getWorkspaceInvitations`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard` (`OWNER`, `ADMIN`).
- **Input**: Path `workspaceId`.
- **Processing**: Finds all pending/active invitations for workspace.
- **Output**: Array of `WorkspaceInvitation`.
- **Tests**: `test/workspaces.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/members/page.tsx`.

#### 14. `POST /workspaces/:workspaceId/invitations`
- **Ownership**: `WorkspacesModule` -> `WorkspacesController.createInvitation` -> `WorkspacesService.createInvitation`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard` (`OWNER`, `ADMIN`).
- **Input**: Path `workspaceId`, Body `{ email, role, participant_type?, vendor_id?, buyer_id? }`.
- **Processing**: Generates crypto token hash, creates `WorkspaceInvitation`, sends email/returns token.
- **Output**: `WorkspaceInvitation`.
- **Tests**: `test/rbac-3.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/members/page.tsx`.

#### 15. `DELETE /workspaces/:workspaceId/invitations/:inviteId`
- **Ownership**: `WorkspacesModule` -> `WorkspacesController.revokeInvitation` -> `WorkspacesService.revokeInvitation`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard` (`OWNER`, `ADMIN`).
- **Input**: Path `workspaceId`, `inviteId`.
- **Processing**: Updates invitation status to `REVOKED`.
- **Output**: `{ success: true }`.
- **Tests**: `test/workspaces.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/members/page.tsx`.

#### 16. `GET /invitations/verify/:token`
- **Ownership**: `WorkspacesModule` -> `InvitationsController.verifyInvitation` -> `WorkspacesService.verifyInvitationToken`
- **Security**: Public.
- **Input**: Path `token: string`.
- **Processing**: Hashes token with SHA-256, validates expiry and `PENDING` status.
- **Output**: `{ valid: true, invitation: { id, email, role, workspaceName } }`.
- **Tests**: `test/workspaces.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/invitations/page.tsx`.

#### 17. `POST /workspaces/accept-invitation`
- **Ownership**: `WorkspacesModule` -> `WorkspacesController.acceptInvitation` -> `WorkspacesService.acceptInvitation`
- **Security**: `JwtAuthGuard`.
- **Input**: Body `{ token: string }`.
- **Processing**: Creates `WorkspaceMember` matching invitation role and participant mapping, marks invitation `ACCEPTED`.
- **Output**: `{ success: true, workspaceId }`.
- **Tests**: `test/workspaces.e2e-spec.ts`, `test/rbac-3.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/accept-invitation/client.tsx`.

---

### 4.3 Vendors & Buyers

#### 18. `GET /workspaces/:workspaceId/vendors`
- **Ownership**: `WorkspacesModule` -> `VendorsController.list` -> `VendorsService.listVendors`
- **Security**: `JwtAuthGuard`, `PermissionsGuard` (`vendor:read`).
- **Input**: Path `workspaceId`.
- **Processing**: Lists vendors in workspace; enforces vendor ASSIGNED scope if member is vendor-linked.
- **Output**: Array of `Vendor`.
- **Tests**: `test/rbac-7-vendor-permissions.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/members/page.tsx`.

#### 19. `GET /workspaces/:workspaceId/vendors/:id`
- **Ownership**: `WorkspacesModule` -> `VendorsController.get` -> `VendorsService.getVendor`
- **Security**: `JwtAuthGuard`, `PermissionsGuard` (`vendor:read`), `RequireResourceScope` ('vendor', 'id').
- **Input**: Path `workspaceId`, `id`.
- **Processing**: Returns single vendor details.
- **Output**: `Vendor`.
- **Tests**: `test/rbac-7-vendor-permissions.e2e-spec.ts`.
- **Frontend Usage**: None directly.

#### 20. `POST /workspaces/:workspaceId/vendors`
- **Ownership**: `WorkspacesModule` -> `VendorsController.create` -> `VendorsService.createVendor`
- **Security**: `JwtAuthGuard`, `PermissionsGuard` (`vendor:write`).
- **Input**: Path `workspaceId`, Body `{ name: string }`.
- **Processing**: Creates new `Vendor`.
- **Output**: Created `Vendor`.
- **Tests**: `test/rbac-7-vendor-permissions.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/members/page.tsx`.

#### 21. `GET /workspaces/:workspaceId/buyers`
- **Ownership**: `RoutingModule` -> `BuyersController.list` -> `BuyersService.listBuyers`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` (`buyer:read`).
- **Input**: Path `workspaceId`, Query `search?`, `status?`, `limit?`, `offset?`.
- **Processing**: Lists workspace buyers; enforces buyer ASSIGNED scope filtering.
- **Output**: `{ items: Buyer[], total: number }`.
- **Tests**: `test/routing-engine.e2e-spec.ts`, `test/rbac-6-buyer-permissions.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/buyers/page.tsx`.

#### 22. `GET /workspaces/:workspaceId/buyers/:id`
- **Ownership**: `RoutingModule` -> `BuyersController.get` -> `BuyersService.getBuyer`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` (`buyer:read`), `RequireResourceScope` ('buyer', 'id').
- **Input**: Path `workspaceId`, `id`.
- **Processing**: Returns single buyer details.
- **Output**: `Buyer`.
- **Tests**: `test/rbac-6-buyer-permissions.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/buyers/[buyerId]/page.tsx`.

#### 23. `POST /workspaces/:workspaceId/buyers`
- **Ownership**: `RoutingModule` -> `BuyersController.create` -> `BuyersService.createBuyer`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` (`buyer:create`).
- **Input**: Path `workspaceId`, Body `{ name, destinationNumber, timeout? }`.
- **Processing**: Normalizes destination number to E.164, creates `Buyer`.
- **Output**: Created `Buyer`.
- **Tests**: `src/routing/routing.spec.ts`, `test/routing-engine.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/buyers/page.tsx`.

#### 24. `PUT /workspaces/:workspaceId/buyers/:id`
- **Ownership**: `RoutingModule` -> `BuyersController.update` -> `BuyersService.updateBuyer`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` (`buyer:update`), `RequireResourceScope` ('buyer', 'id').
- **Input**: Path `workspaceId`, `id`, Body `{ name?, destinationNumber?, timeout?, status? }`.
- **Processing**: Updates buyer parameters.
- **Output**: Updated `Buyer`.
- **Tests**: `test/routing-engine.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/buyers/page.tsx`.

#### 25. `POST /workspaces/:workspaceId/buyers/:id/archive`
- **Ownership**: `RoutingModule` -> `BuyersController.archive` -> `BuyersService.updateBuyer`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` (`buyer:update`), `RequireResourceScope` ('buyer', 'id').
- **Input**: Path `workspaceId`, `id`.
- **Processing**: Sets buyer status to `INACTIVE`.
- **Output**: Updated `Buyer`.
- **Tests**: `test/routing-engine.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/buyers/page.tsx`.

#### 26. `POST /workspaces/:workspaceId/buyers/:id/activate`
- **Ownership**: `RoutingModule` -> `BuyersController.activate` -> `BuyersService.updateBuyer`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` (`buyer:update`), `RequireResourceScope` ('buyer', 'id').
- **Input**: Path `workspaceId`, `id`.
- **Processing**: Sets buyer status to `ACTIVE`.
- **Output**: Updated `Buyer`.
- **Tests**: `test/routing-engine.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/buyers/page.tsx`.

---

### 4.4 Campaigns & Routing

#### 27. `GET /workspaces/:workspaceId/campaigns`
- **Ownership**: `RoutingModule` -> `CampaignsController.list` -> `CampaignsService.listCampaigns`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` (`campaign:read`).
- **Input**: Path `workspaceId`, Query `search?`, `status?`, `limit?`, `offset?`.
- **Processing**: Lists campaigns; applies campaign resource scope filtering for non-owners.
- **Output**: `{ items: Campaign[], total: number }`.
- **Tests**: `test/routing-engine.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/campaigns/page.tsx`.

#### 28. `GET /workspaces/:workspaceId/campaigns/:id`
- **Ownership**: `RoutingModule` -> `CampaignsController.get` -> `CampaignsService.getCampaign`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` (`campaign:read`), `RequireResourceScope` ('campaign', 'id').
- **Input**: Path `workspaceId`, `id`.
- **Processing**: Fetches campaign with assigned phone numbers and ordered buyers (`priority asc`).
- **Output**: `Campaign` with relations.
- **Tests**: `test/routing-engine.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/campaigns/[campaignId]/page.tsx`.

#### 29. `POST /workspaces/:workspaceId/campaigns`
- **Ownership**: `RoutingModule` -> `CampaignsController.create` -> `CampaignsService.createCampaign`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` (`campaign:create`).
- **Input**: Path `workspaceId`, Body `{ name: string }`.
- **Processing**: Creates new `Campaign`.
- **Output**: Created `Campaign`.
- **Tests**: `test/routing-engine.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/campaigns/page.tsx`.

#### 30. `PUT /workspaces/:workspaceId/campaigns/:id`
- **Ownership**: `RoutingModule` -> `CampaignsController.update` -> `CampaignsService.updateCampaign`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` (`campaign:update`), `RequireResourceScope` ('campaign', 'id').
- **Input**: Path `workspaceId`, `id`, Body `{ name?, status? }`.
- **Processing**: Updates campaign attributes.
- **Output**: Updated `Campaign`.
- **Tests**: `test/routing-engine.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/campaigns/page.tsx`.

#### 31. `POST /workspaces/:workspaceId/campaigns/:id/archive`
- **Ownership**: `RoutingModule` -> `CampaignsController.archive` -> `CampaignsService.updateCampaign`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` (`campaign:update`), `RequireResourceScope` ('campaign', 'id').
- **Input**: Path `workspaceId`, `id`.
- **Processing**: Updates campaign status to `INACTIVE`.
- **Output**: Updated `Campaign`.
- **Tests**: `test/routing-engine.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/campaigns/page.tsx`.

#### 32. `POST /workspaces/:workspaceId/campaigns/:id/activate`
- **Ownership**: `RoutingModule` -> `CampaignsController.activate` -> `CampaignsService.updateCampaign`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` (`campaign:update`), `RequireResourceScope` ('campaign', 'id').
- **Input**: Path `workspaceId`, `id`.
- **Processing**: Updates campaign status to `ACTIVE`.
- **Output**: Updated `Campaign`.
- **Tests**: `test/routing-engine.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/campaigns/page.tsx`.

#### 33. `POST /workspaces/:workspaceId/campaigns/:id/phone-numbers`
- **Ownership**: `RoutingModule` -> `CampaignsController.assignPhoneNumber` -> `CampaignsService.assignPhoneNumber`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` (`campaign:update`), `RequireResourceScope` ('campaign', 'id').
- **Input**: Path `workspaceId`, `id`, Body `{ phoneNumberId: string }`.
- **Processing**: Links phone number to campaign (`phoneNumber.campaign_id = id`).
- **Output**: Updated `PhoneNumber`.
- **Tests**: `test/routing-engine.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/campaigns/page.tsx`.

#### 34. `DELETE /workspaces/:workspaceId/campaigns/:id/phone-numbers/:phoneNumberId`
- **Ownership**: `RoutingModule` -> `CampaignsController.removePhoneNumber` -> `CampaignsService.removePhoneNumber`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` (`campaign:update`), `RequireResourceScope` ('campaign', 'id').
- **Input**: Path `workspaceId`, `id`, `phoneNumberId`.
- **Processing**: Unlinks phone number from campaign (`campaign_id = null`).
- **Output**: Updated `PhoneNumber`.
- **Tests**: `test/routing-engine.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/campaigns/page.tsx`.

#### 35. `POST /workspaces/:workspaceId/campaigns/:id/buyers`
- **Ownership**: `RoutingModule` -> `CampaignsController.addBuyer` -> `CampaignsService.addBuyerToCampaign`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` (`campaign:update`), `RequireResourceScope` ('campaign', 'id').
- **Input**: Path `workspaceId`, `id`, Body `{ buyerId: string, priority: number }`.
- **Processing**: Creates `CampaignBuyer` linking buyer to campaign with priority.
- **Output**: Created `CampaignBuyer`.
- **Tests**: `test/routing-engine.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/campaigns/page.tsx`.

#### 36. `DELETE /workspaces/:workspaceId/campaigns/:id/buyers/:buyerId`
- **Ownership**: `RoutingModule` -> `CampaignsController.removeBuyer` -> `CampaignsService.removeBuyerFromCampaign`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` (`campaign:update`), `RequireResourceScope` ('campaign', 'id').
- **Input**: Path `workspaceId`, `id`, `buyerId`.
- **Processing**: Removes `CampaignBuyer` association.
- **Output**: `{ success: true }`.
- **Tests**: `test/routing-engine.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/campaigns/page.tsx`.

#### 37. `PUT /workspaces/:workspaceId/campaigns/:id/buyers/reorder`
- **Ownership**: `RoutingModule` -> `CampaignsController.reorderBuyers` -> `CampaignsService.reorderBuyersInCampaign`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` (`campaign:update`), `RequireResourceScope` ('campaign', 'id').
- **Input**: Path `workspaceId`, `id`, Body `{ buyerIds: string[] }`.
- **Processing**: Atomically updates priority of all campaign buyers in a database transaction using temporary priority offset to prevent unique constraint collisions.
- **Output**: Array of reordered `CampaignBuyer`.
- **Tests**: `src/routing/campaigns.service.spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/campaigns/page.tsx`.

---

### 4.5 Blocked Callers

#### 38. `GET /workspaces/:workspaceId/blocked-callers`
- **Ownership**: `RoutingModule` -> `BlockedCallersController.list` -> `BlockedCallersService.listBlockedCallers`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard` (`OWNER`, `ADMIN`).
- **Input**: Path `workspaceId`, Query `search?`, `limit?`, `offset?`.
- **Processing**: Queries `prisma.blockedCaller.findMany({ where: { workspace_id } })`.
- **Output**: `{ items: BlockedCaller[], total: number }`.
- **Tests**: `src/routing/blocked-callers.service.spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/blocked-callers/page.tsx`.

#### 39. `POST /workspaces/:workspaceId/blocked-callers`
- **Ownership**: `RoutingModule` -> `BlockedCallersController.block` -> `BlockedCallersService.blockCaller`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard` (`OWNER`, `ADMIN`).
- **Input**: Path `workspaceId`, Body `{ phoneNumber: string, reason?: string }`.
- **Processing**: Normalizes phone number to E.164, upserts `BlockedCaller`.
- **Output**: Created `BlockedCaller`.
- **Tests**: `src/routing/blocked-callers.service.spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/blocked-callers/page.tsx`.

#### 40. `DELETE /workspaces/:workspaceId/blocked-callers/:id`
- **Ownership**: `RoutingModule` -> `BlockedCallersController.unblock` -> `BlockedCallersService.unblockCaller`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard` (`OWNER`, `ADMIN`).
- **Input**: Path `workspaceId`, `id`.
- **Processing**: Deletes `BlockedCaller` by id scoped to workspace.
- **Output**: `{ success: true }`.
- **Tests**: `src/routing/blocked-callers.service.spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/blocked-callers/page.tsx`.

---

### 4.6 Phone Numbers

#### 41. `GET /workspaces/:workspaceId/phone-numbers`
- **Ownership**: `PhoneNumbersModule` -> `PhoneNumbersController.listNumbers` -> `PhoneNumbersService.listWorkspaceNumbers`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard` (all roles), `PermissionsGuard` (`phone_number:read`).
- **Input**: Path `workspaceId`, Query `search?`, `limit?`, `offset?`.
- **Processing**: Lists workspace phone numbers with associated campaign; applies PHONE_NUMBER resource scope for scoped members.
- **Output**: `{ items: PhoneNumber[], total: number }`.
- **Tests**: `src/phone-numbers/phone-numbers.spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/phone-numbers/page.tsx`.

#### 42. `GET /workspaces/:workspaceId/phone-numbers/search`
- **Ownership**: `PhoneNumbersModule` -> `PhoneNumbersController.searchNumbers` -> `PhoneNumbersService.searchAvailableNumbers`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard` (`OWNER`, `ADMIN`).
- **Input**: Path `workspaceId`, Query `countryCode?`, `limit?`, `numberType?`, `prefix?`.
- **Processing**: Calls Telnyx API `/v2/available_phone_numbers` (or mock fallback if no API key configured).
- **Output**: Array of available phone numbers from carrier.
- **Tests**: `src/phone-numbers/phone-numbers.spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/phone-numbers/page.tsx`.

#### 43. `POST /workspaces/:workspaceId/phone-numbers`
- **Ownership**: `PhoneNumbersModule` -> `PhoneNumbersController.provisionNumber` -> `PhoneNumbersService.provisionNumber`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard` (`OWNER`, `ADMIN`), `PermissionsGuard` (`phone_number:create`).
- **Input**: Path `workspaceId`, Body `{ phoneNumber: string, name?: string }`.
- **Processing**: Provisions number via Telnyx Call Control App, stores in `PhoneNumber` with status `ACTIVE`.
- **Output**: Created `PhoneNumber`.
- **Tests**: `src/phone-numbers/phone-numbers.spec.ts`, `src/phone-numbers/telnyx-provisioning.service.spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/phone-numbers/page.tsx`.

#### 44. `PUT /workspaces/:workspaceId/phone-numbers/:id`
- **Ownership**: `PhoneNumbersModule` -> `PhoneNumbersController.updateNumber` -> `PhoneNumbersService.updateNumber`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard` (`OWNER`, `ADMIN`), `PermissionsGuard` (`phone_number:manage`), `RequireResourceScope` ('phone_number', 'id').
- **Input**: Path `workspaceId`, `id`, Body `{ name: string }`.
- **Processing**: Updates phone number label.
- **Output**: Updated `PhoneNumber`.
- **Tests**: `src/phone-numbers/phone-numbers.spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/phone-numbers/page.tsx`.

#### 45. `DELETE /workspaces/:workspaceId/phone-numbers/:id`
- **Ownership**: `PhoneNumbersModule` -> `PhoneNumbersController.releaseNumber` -> `PhoneNumbersService.releaseNumber`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard` (`OWNER`, `ADMIN`), `PermissionsGuard` (`phone_number:manage`), `RequireResourceScope` ('phone_number', 'id').
- **Input**: Path `workspaceId`, `id`.
- **Processing**: Releases number from Telnyx carrier account, marks status `RELEASED` in database.
- **Output**: Updated `PhoneNumber`.
- **Tests**: `src/phone-numbers/phone-numbers.spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/phone-numbers/page.tsx`.

---

### 4.7 Calls & Reporting Endpoints

#### 46. `GET /workspaces/:workspaceId/calls`
- **Ownership**: `CallsModule` -> `CallsController.getCalls` -> `CallsService.getCalls`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` (`call:read`).
- **Input**:
  - Path: `workspaceId`
  - Query: `campaignId?`, `buyerId?`, `status?`, `callerNumber?`, `trackingNumber?`, `durationType?` (`talk` | `total`), `minDurationSecs?`, `maxDurationSecs?`, `startDate?`, `endDate?`, `limit?`, `offset?`.
- **Processing**:
  - Enforces granular resource scope (CAMPAIGN, PHONE_NUMBER, BUYER, ASSIGNED) for caller.
  - Validates duration parameters (`durationType` required if min/max duration given; min <= max).
  - Queries `calls` table with Prisma / raw SQL duration filtering. Computes `talkDurationSecs` (`ended_at - answered_at`) and `totalDurationSecs` (`ended_at - started_at`).
  - Fetches campaign, buyer attempts, and recordings metadata.
- **Output**: `{ items: CallItem[], total: number }`.
- **Tests**: `src/calls/calls.controller.spec.ts`, `test/reporting.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/calls/page.tsx`, `apps/web/src/app/protected/reporting/page.tsx`.

#### 47. `GET /workspaces/:workspaceId/calls/metrics`
- **Ownership**: `CallsModule` -> `CallsController.getMetrics` -> `CallsService.getMetrics`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` (`call:read`).
- **Input**:
  - Path: `workspaceId`
  - Query: `startDate?`, `endDate?`, `campaignId?`, `buyerId?`, `trackingNumber?`, `callerNumber?`, `status?`, `minDuration?`, `maxDuration?`, `bucket?` (`hour` | `day` | `week`).
- **Processing**:
  - Enforces resource scoping in SQL query.
  - Aggregates metrics: `total`, `answered`, `missed`, `failed`, `blocked`, `avgDuration`, `tclSecs`, `aclSecs`.
  - Aggregates sub-breakdowns: `campaigns` dictionary, `buyers` dictionary, `trackingNumbers` dictionary.
  - Aggregates time-series buckets via `date_trunc` for charts.
- **Output**: Metric aggregates object (see Section 15).
- **Tests**: `test/reporting.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/reporting/page.tsx`.

#### 48. `GET /workspaces/:workspaceId/calls/live-calls`
- **Ownership**: `CallsModule` -> `CallsController.getLiveCalls` -> `CallsService.getLiveCalls`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` (`call:read`).
- **Input**: Path `workspaceId`.
- **Processing**: Counts calls with `state IN ('INITIATED', 'ROUTING')`.
- **Output**: `{ liveCalls: number }`.
- **Tests**: `src/calls/calls.controller.spec.ts`.
- **Frontend Usage**: `apps/web/src/components/header.tsx` (polls every 10s).

#### 49. `GET /workspaces/:workspaceId/calls/:callId`
- **Ownership**: `CallsModule` -> `CallsController.getCallDetail` -> `CallsService.getCallDetail`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` (`call:read`), `RequireResourceScope` ('call', 'callId').
- **Input**: Path `workspaceId`, `callId`.
- **Processing**: Fetches complete call record with attempts, buyer names, recordings.
- **Output**: `Call` with relations.
- **Tests**: `src/calls/calls.controller.spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/calls/[callId]/page.tsx`.

#### 50. `POST /workspaces/:workspaceId/reports/export`
- **Ownership**: `ReportsModule` -> `ReportsController.exportReport` -> `ReportsService.generateExport`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` (`report:export`).
- **Input**: Path `workspaceId`, Body `{ format: 'csv' | 'xlsx', filters: object, columns: ColumnConfig[] }`.
- **Processing**: Fetches up to 10,000 calls matching filters, formats durations, neutralizes formula injection (`=`, `+`, `-`, `@`), builds Excel/CSV buffer via `ExcelJS`.
- **Output**: Binary file attachment (`Content-Disposition: attachment; filename="callflow-report-YYYY-MM-DD.ext"`).
- **Tests**: `test/reports-export.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/reporting/page.tsx`.

#### 51. `POST /workspaces/:workspaceId/reports`
- **Ownership**: `ReportsModule` -> `ReportsController.createReport` -> `ReportsService.createSavedReport`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` (`report:read`).
- **Input**: Path `workspaceId`, Body `{ name: string, visibility: 'PERSONAL' | 'SHARED', configuration: object }`.
- **Processing**: Normalizes configuration filters/groupings/columns, creates `SavedReport`.
- **Output**: Created `SavedReport`.
- **Tests**: `test/reports.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/reporting/page.tsx`.

#### 52. `GET /workspaces/:workspaceId/reports`
- **Ownership**: `ReportsModule` -> `ReportsController.getReports` -> `ReportsService.getReports`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` (`report:read`).
- **Input**: Path `workspaceId`.
- **Processing**: Lists saved reports where `visibility = SHARED OR created_by_user_id = userId`.
- **Output**: Array of `SavedReport`.
- **Tests**: `test/reports.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/reporting/page.tsx`.

#### 53. `GET /workspaces/:workspaceId/reports/:reportId`
- **Ownership**: `ReportsModule` -> `ReportsController.getReport` -> `ReportsService.getReport`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` (`report:read`).
- **Input**: Path `workspaceId`, `reportId`.
- **Processing**: Fetches saved report; blocks non-creator from viewing personal reports.
- **Output**: `SavedReport`.
- **Tests**: `test/reports.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/reporting/page.tsx`.

#### 54. `PATCH /workspaces/:workspaceId/reports/:reportId`
- **Ownership**: `ReportsModule` -> `ReportsController.updateReport` -> `ReportsService.updateReport`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` (`report:read`).
- **Input**: Path `workspaceId`, `reportId`, Body `{ name?, visibility?, configuration? }`.
- **Processing**: Validates creator or Admin/Owner authorization; updates saved report.
- **Output**: Updated `SavedReport`.
- **Tests**: `test/reports.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/reporting/page.tsx`.

#### 55. `DELETE /workspaces/:workspaceId/reports/:reportId`
- **Ownership**: `ReportsModule` -> `ReportsController.deleteReport` -> `ReportsService.deleteReport`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` (`report:read`).
- **Input**: Path `workspaceId`, `reportId`.
- **Processing**: Validates creator or Admin/Owner authorization; deletes `SavedReport`.
- **Output**: `{ success: true }`.
- **Tests**: `test/reports.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/reporting/page.tsx`.

---

### 4.8 Telephony & Webhook Ingestion

#### 56. `POST /webhooks/telnyx`
- **Ownership**: `TelephonyModule` -> `TelnyxWebhookController.handleWebhook` -> `CallController.handleEvent`
- **Security**: Ed25519 cryptographic signature verification (`telnyx-signature-ed25519`, `telnyx-timestamp`) using `TELNYX_PUBLIC_KEY`. Falls back to mock if public key not set in dev.
- **Input**: Telnyx webhook JSON payload.
- **Processing**: Acquires DB idempotency lock in `webhook_events`. Normalizes event (`call.initiated`, `call.answered`, `call.hangup`, `call.recording.saved`). Routes to `CallController`. Marks event `PROCESSED` or `FAILED`.
- **Output**: Status 200 (`'OK'`, `'Duplicate'`, `'Ignored'`).
- **Tests**: `src/telephony/telnyx/telnyx.spec.ts`.
- **Frontend Usage**: Carrier webhook entry point.

#### 57. `POST /webhooks/twilio`
- **Ownership**: `TelephonyModule` -> `TwilioWebhookController.handleWebhook` -> `CallController.handleEvent`
- **Security**: Twilio HMAC-SHA1 signature verification (`x-twilio-signature`) using `TWILIO_AUTH_TOKEN`.
- **Input**: Twilio voice webhook form body.
- **Processing**: Acquires DB idempotency lock. Normalizes CallStatus. Dispatches to `CallController`.
- **Output**: TwiML XML (`<Response>...</Response>`).
- **Tests**: `src/telephony/twilio/twilio.spec.ts`.
- **Frontend Usage**: Carrier webhook entry point.

#### 58. `GET /workspaces/:workspaceId/recordings/:recordingId/download`
- **Ownership**: `TelephonyModule` -> `RecordingsController.getRecordingUrl` -> `TelephonyProvider.getRecordingUrl`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` (`call:recording_read`), `RequireResourceScope` ('recording', 'recordingId').
- **Input**: Path `workspaceId`, `recordingId`.
- **Processing**: Verifies recording ownership, requests fresh download URL from telephony provider.
- **Output**: `{ url: string }`.
- **Tests**: `src/telephony/recordings.controller.spec.ts`, `test/recordings.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/calls/page.tsx`, `apps/web/src/app/protected/calls/[callId]/page.tsx`.

---

### 4.9 Billing & Wallet

#### 59. `GET /workspaces/:workspaceId/billing`
- **Ownership**: `BillingModule` -> `BillingController.getBillingState` -> `BillingService.getBillingState`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard` (all roles).
- **Input**: Path `workspaceId`.
- **Processing**: Returns workspace balance, subscription, invoices, and aggregated usage.
- **Output**: Comprehensive billing state object.
- **Tests**: `src/billing/billing.controller.spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/billing/page.tsx`.

#### 60. `GET /workspaces/:workspaceId/billing/balance`
- **Ownership**: `BillingModule` -> `BillingController.getBalance` -> `BillingService.getBalance`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard`.
- **Input**: Path `workspaceId`.
- **Processing**: Returns `{ balanceMinor, balanceMicro, reservedMicro, availableMicro, currency }`.
- **Output**: Balance breakdown.
- **Tests**: `src/billing/billing.controller.spec.ts`.
- **Frontend Usage**: `apps/web/src/components/header.tsx` (top bar wallet balance).

#### 61. `GET /workspaces/:workspaceId/billing/wallet/transactions`
- **Ownership**: `BillingModule` -> `BillingController.getWalletTransactions` -> `WalletService.getTransactions`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard` (all roles).
- **Input**: Path `workspaceId`.
- **Processing**: Queries `prisma.walletTransaction.findMany({ where: { workspace_id }, orderBy: { created_at: 'desc' } })`.
- **Output**: Array of `WalletTransaction`.
- **Tests**: `src/billing/wallet.service.spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/billing/page.tsx`.

#### 62. `POST /workspaces/:workspaceId/billing/wallet/mock-topup`
- **Ownership**: `BillingModule` -> `BillingController.mockTopUp` -> `MockPaymentProvider.createWalletTopUp`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard` (`OWNER`, `ADMIN`). Blocked in production environment (`NODE_ENV === 'production'`).
- **Input**: Path `workspaceId`, Body `{ amountMinor: number, returnUrl?: string }`.
- **Processing**: Credits wallet balance with `CREDIT` transaction for local development and testing.
- **Output**: `{ success: true, transactionId, newBalanceMinor }`.
- **Tests**: `test/mock-topup.spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/billing/page.tsx` (dev mode top-up button).

#### 63. `POST /workspaces/:workspaceId/billing/checkout`
- **Ownership**: `BillingModule` -> `BillingController.createCheckout` -> `BillingService.createCheckoutSession`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard` (`OWNER`, `ADMIN`).
- **Input**: Path `workspaceId`, Body `{ planId: string, returnUrl: string }`.
- **Processing**: Creates Stripe checkout session.
- **Output**: `{ url: string, sessionId: string }`.
- **Tests**: `test/billing.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/billing/page.tsx`.

#### 64. `POST /workspaces/:workspaceId/billing/portal`
- **Ownership**: `BillingModule` -> `BillingController.createPortal` -> `BillingService.createPortalSession`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard` (`OWNER`, `ADMIN`).
- **Input**: Path `workspaceId`, Body `{ returnUrl: string }`.
- **Processing**: Creates Stripe customer billing portal session.
- **Output**: `{ url: string }`.
- **Tests**: `test/billing.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/billing/page.tsx`.

#### 65. `POST /webhooks/stripe`
- **Ownership**: `BillingModule` -> `BillingController.handleWebhook` -> `BillingService.handleWebhook`
- **Security**: Stripe cryptographic signature verification via header `stripe-signature`.
- **Input**: Stripe webhook raw body.
- **Processing**: Handles `invoice.payment_succeeded`, `customer.subscription.updated`, etc. Updates subscription and invoice records.
- **Output**: `{ received: boolean }`.
- **Tests**: `src/billing/billing.service.spec.ts`.
- **Frontend Usage**: Stripe webhook gateway.

---

### 4.10 Permissions & Audit Logs

#### 66. `GET /workspaces/:workspaceId/permissions`
- **Ownership**: `PermissionsModule` -> `PermissionsController.getAllPermissions` -> `PermissionsService.getAllPermissions`
- **Security**: `JwtAuthGuard`.
- **Input**: Path `workspaceId`.
- **Processing**: Returns all available system permission definitions.
- **Output**: Array of `Permission`.
- **Tests**: `test/rbac-4.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/members/[memberId]/page.tsx`.

#### 67. `GET /workspaces/:workspaceId/permissions/members/:memberId`
- **Ownership**: `PermissionsModule` -> `PermissionsController.getMemberPermissions` -> `PermissionsService.getMemberPermissions`
- **Security**: `JwtAuthGuard`.
- **Input**: Path `workspaceId`, `memberId`.
- **Processing**: Returns effective permissions and resource scopes for specified workspace member.
- **Output**: Array of member permissions with scope types.
- **Tests**: `test/rbac-4.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/members/[memberId]/page.tsx`.

#### 68. `PUT /workspaces/:workspaceId/permissions/members/:memberId/:permissionKey`
- **Ownership**: `PermissionsModule` -> `PermissionsController.assignPermission` -> `PermissionsService.assignPermission`
- **Security**: `JwtAuthGuard`. Service validates caller is OWNER or ADMIN and blocks self-modification.
- **Input**: Path `workspaceId`, `memberId`, `permissionKey`, Body `{ scopeType?: string, resourceId?: string }`.
- **Processing**: Validates cross-tenant resource safety, creates `WorkspaceMemberPermission`, writes `SecurityAuditLog`.
- **Output**: Created `WorkspaceMemberPermission`.
- **Tests**: `test/rbac-5.e2e-spec.ts`, `test/rbac-10-audit-logs.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/members/[memberId]/page.tsx`.

#### 69. `DELETE /workspaces/:workspaceId/permissions/members/:memberId/:permissionKey`
- **Ownership**: `PermissionsModule` -> `PermissionsController.removePermission` -> `PermissionsService.removePermission`
- **Security**: `JwtAuthGuard`. Service validates caller is OWNER or ADMIN and blocks self-modification.
- **Input**: Path `workspaceId`, `memberId`, `permissionKey`, Query `scopeType?`, `resourceId?`.
- **Processing**: Deletes matching `WorkspaceMemberPermission`, writes `SecurityAuditLog`.
- **Output**: `{ success: true }`.
- **Tests**: `test/rbac-5.e2e-spec.ts`, `test/rbac-10-audit-logs.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/members/[memberId]/page.tsx`.

#### 70. `GET /workspaces/:workspaceId/audit-logs`
- **Ownership**: `AuditLogsModule` -> `AuditLogsController.getAuditLogs` -> `AuditLogsService.getAuditLogs`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` (`audit_log:read`).
- **Input**: Path `workspaceId`, Query `limit?`, `offset?`.
- **Processing**: Returns chronological security audit log records with actor member details.
- **Output**: `{ items: SecurityAuditLog[], total: number }`.
- **Tests**: `test/rbac-10-audit-logs.e2e-spec.ts`.
- **Frontend Usage**: None directly yet.

---

### 4.11 API Keys & Outbound Webhooks

#### 71. `GET /workspaces/:workspaceId/api-keys`
- **Ownership**: `ApiKeysModule` -> `ApiKeysController.listKeys` -> `ApiKeysService.listApiKeys`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard` (`OWNER`, `ADMIN`).
- **Input**: Path `workspaceId`.
- **Processing**: Lists API keys with prefix, created date, and last used date (hashed secret never returned).
- **Output**: Array of `ApiKey` metadata.
- **Tests**: `test/public-api.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/api-keys/page.tsx`.

#### 72. `POST /workspaces/:workspaceId/api-keys`
- **Ownership**: `ApiKeysModule` -> `ApiKeysController.createKey` -> `ApiKeysService.createApiKey`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard` (`OWNER`, `ADMIN`).
- **Input**: Path `workspaceId`, Body `{ name: string }`.
- **Processing**: Generates high-entropy secret (`pk_...`), hashes with SHA-256, stores in `ApiKey`. Returns plaintext key once.
- **Output**: `{ id, name, keyPrefix, key: 'pk_...', createdAt }`.
- **Tests**: `test/public-api.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/api-keys/page.tsx`.

#### 73. `DELETE /workspaces/:workspaceId/api-keys/:id`
- **Ownership**: `ApiKeysModule` -> `ApiKeysController.revokeKey` -> `ApiKeysService.revokeApiKey`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard` (`OWNER`, `ADMIN`).
- **Input**: Path `workspaceId`, `id`.
- **Processing**: Sets `revoked_at = now()`.
- **Output**: `{ success: true }`.
- **Tests**: `test/public-api.e2e-spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/api-keys/page.tsx`.

#### 74. `GET /workspaces/:workspaceId/webhooks`
- **Ownership**: `WebhooksModule` -> `WebhooksController.listWebhooks` -> `WebhooksService.getWebhooks`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard` (`OWNER`, `ADMIN`).
- **Input**: Path `workspaceId`.
- **Processing**: Lists registered outbound webhook subscriptions.
- **Output**: Array of `OutboundWebhook`.
- **Tests**: `src/webhooks/webhooks.controller.spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/webhooks/page.tsx`.

#### 75. `POST /workspaces/:workspaceId/webhooks`
- **Ownership**: `WebhooksModule` -> `WebhooksController.createWebhook` -> `WebhooksService.createWebhook`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard` (`OWNER`, `ADMIN`).
- **Input**: Path `workspaceId`, Body `{ url: string }`.
- **Processing**: Generates AES-encrypted secret, creates `OutboundWebhook`.
- **Output**: Created `OutboundWebhook`.
- **Tests**: `src/webhooks/webhooks.service.spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/webhooks/page.tsx`.

#### 76. `DELETE /workspaces/:workspaceId/webhooks/:id`
- **Ownership**: `WebhooksModule` -> `WebhooksController.deleteWebhook` -> `WebhooksService.deleteWebhook`
- **Security**: `JwtAuthGuard`, `WorkspaceRolesGuard` (`OWNER`, `ADMIN`).
- **Input**: Path `workspaceId`, `id`.
- **Processing**: Deletes `OutboundWebhook` record.
- **Output**: `{ success: true }`.
- **Tests**: `src/webhooks/webhooks.service.spec.ts`.
- **Frontend Usage**: `apps/web/src/app/protected/webhooks/page.tsx`.

---

### 4.12 Public Developer API v1 (`/api/v1/workspaces/...`)

All public API endpoints require `ApiKeyAuthGuard` (Header `Authorization: Bearer pk_...`) and validate that the API key belongs to the targeted `:workspaceId`.

| Method | Endpoint | Handler | Security & Roles | Processing & Service |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/workspaces/:workspaceId` | `PublicWorkspacesController.getWorkspace` | `ApiKeyAuthGuard`, `WorkspaceRolesGuard` (All roles) | `WorkspacesService.getWorkspaceInfo` |
| `GET` | `/api/v1/workspaces/:workspaceId/billing` | `PublicBillingController.getBillingStatus` | `ApiKeyAuthGuard`, `WorkspaceRolesGuard` (`OWNER`, `ADMIN`) | `BillingService.getBillingState` |
| `GET` | `/api/v1/workspaces/:workspaceId/usage` | `PublicUsageController.getUsage` | `ApiKeyAuthGuard`, `WorkspaceRolesGuard` (`OWNER`, `ADMIN`) | `BillingService.getBillingState(ws).usage` |
| `GET` | `/api/v1/workspaces/:workspaceId/blocked-numbers` | `PublicBlockedNumbersController.listBlockedNumbers` | `ApiKeyAuthGuard`, `WorkspaceRolesGuard` (All roles) | `BlockedCallersService.listBlockedCallers` |
| `POST` | `/api/v1/workspaces/:workspaceId/blocked-numbers` | `PublicBlockedNumbersController.blockNumber` | `ApiKeyAuthGuard`, `WorkspaceRolesGuard` (`OWNER`, `ADMIN`) | `BlockedCallersService.blockCaller` |
| `DELETE` | `/api/v1/workspaces/:workspaceId/blocked-numbers/:id`| `PublicBlockedNumbersController.unblockNumber` | `ApiKeyAuthGuard`, `WorkspaceRolesGuard` (`OWNER`, `ADMIN`) | `BlockedCallersService.unblockCaller` |
| `GET` | `/api/v1/workspaces/:workspaceId/buyers` | `PublicBuyersController.listBuyers` | `ApiKeyAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` (`buyer:read`) | `BuyersService.listBuyers` |
| `GET` | `/api/v1/workspaces/:workspaceId/buyers/:id` | `PublicBuyersController.getBuyer` | `ApiKeyAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard`, Scoped | `BuyersService.getBuyer` |
| `POST` | `/api/v1/workspaces/:workspaceId/buyers` | `PublicBuyersController.createBuyer` | `ApiKeyAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` (`buyer:create`)| `BuyersService.createBuyer` |
| `GET` | `/api/v1/workspaces/:workspaceId/campaigns` | `PublicCampaignsController.listCampaigns` | `ApiKeyAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` (`campaign:read`) | `CampaignsService.listCampaigns` |
| `GET` | `/api/v1/workspaces/:workspaceId/campaigns/:id` | `PublicCampaignsController.getCampaign` | `ApiKeyAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard`, Scoped | `CampaignsService.getCampaign` |
| `POST` | `/api/v1/workspaces/:workspaceId/campaigns` | `PublicCampaignsController.createCampaign` | `ApiKeyAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` (`campaign:create`)| `CampaignsService.createCampaign` |
| `GET` | `/api/v1/workspaces/:workspaceId/calls` | `PublicCallsController.listCalls` | `ApiKeyAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` (`call:read`) | `CallsService.getCalls` (limit pagination) |
| `GET` | `/api/v1/workspaces/:workspaceId/calls/:id` | `PublicCallsController.getCall` | `ApiKeyAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard`, Scoped | `CallsService.getCallDetail` |
| `GET` | `/api/v1/workspaces/:workspaceId/phone-numbers` | `PublicPhoneNumbersController.listNumbers` | `ApiKeyAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` (`phone_number:read`)| `PhoneNumbersService.listWorkspaceNumbers` |
| `GET` | `/api/v1/workspaces/:workspaceId/phone-numbers/search`| `PublicPhoneNumbersController.searchNumbers`| `ApiKeyAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` | `PhoneNumbersService.searchAvailableNumbers` |
| `POST` | `/api/v1/workspaces/:workspaceId/phone-numbers` | `PublicPhoneNumbersController.provisionNumber`| `ApiKeyAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` (`phone_number:create`)| `PhoneNumbersService.provisionNumber` |
| `PUT` | `/api/v1/workspaces/:workspaceId/phone-numbers/:id` | `PublicPhoneNumbersController.updateNumber` | `ApiKeyAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` | `PhoneNumbersService.updateNumber` |
| `DELETE` | `/api/v1/workspaces/:workspaceId/phone-numbers/:id`| `PublicPhoneNumbersController.releaseNumber` | `ApiKeyAuthGuard`, `WorkspaceRolesGuard`, `PermissionsGuard` | `PhoneNumbersService.releaseNumber` |
| `GET` | `/api/v1/workspaces/:workspaceId/recordings` | `PublicRecordingsController.listRecordings` | `ApiKeyAuthGuard`, `WorkspaceRolesGuard` (All roles) | `prisma.recording.findMany` (take: 50) |
| `GET` | `/api/v1/workspaces/:workspaceId/recordings/:id` | `PublicRecordingsController.getRecording` | `ApiKeyAuthGuard`, `WorkspaceRolesGuard` (All roles) | Fetches recording and requests provider URL |

---

## 5. API Authentication / Authorization

### 5.1 Authentication Schemes
1. **JWT Bearer Authentication**:
   - Guard: `JwtAuthGuard` backed by `JwtStrategy`.
   - Token issuer: Supabase JWKS (`${process.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`).
   - Validates algorithms: `ES256`, `RS256`.
   - Populates `req.user = { userId, email, role, fullName }`.
2. **API Key Authentication**:
   - Guard: `ApiKeyAuthGuard`.
   - Header format: `Authorization: Bearer pk_<hex_token>`.
   - Validation: Looks up matching record by SHA-256 hash in `api_keys`.
   - Enforces workspace isolation: Rejects if token `workspace_id` does not match URL `:workspaceId`.
   - Populates `req.user = { userId: apiKeyRecord.user_id, role: 'API_KEY' }`.

### 5.2 Workspace Membership & Roles
- Guard: `WorkspaceRolesGuard`.
- Roles: `OWNER`, `ADMIN`, `MEMBER`, `VIEWER`.
- Decorator: `@RequireWorkspaceRoles(...)`.
- Operational Workspace Lock: If `workspace.status !== 'ACTIVE'`, the guard actively rejects all mutation HTTP requests (`POST`, `PUT`, `DELETE`, `PATCH`) with a 403 Forbidden, except the single endpoint `/workspaces/:id/status` (to allow restoration).

### 5.3 Granular RBAC & Resource Scopes
- Guard: `PermissionsGuard`.
- Decorators: `@RequirePermission('permission:key')`, `@RequireResourceScope('resource_type', 'param_name')`.
- Permissions: 21 seeded permission keys (`call:read`, `call:recording_read`, `campaign:read`, `campaign:create`, `campaign:update`, `buyer:read`, `buyer:create`, `buyer:update`, `vendor:read`, `vendor:write`, `phone_number:read`, `phone_number:create`, `phone_number:manage`, `report:read`, `report:export`, `audit_log:read`, etc.).
- Scopes:
  - `ALL`: Unrestricted access across workspace.
  - `ASSIGNED`: Participant-linked scoping. A Buyer participant only sees their assigned buyer and calls routed to that buyer. A Vendor participant only sees their vendor and associated phone numbers.
  - `CAMPAIGN`: Restricts access to specific campaign ID.
  - `PHONE_NUMBER`: Restricts access to specific phone number ID.
  - `BUYER`: Restricts access to specific buyer ID.
  - `VENDOR`: Restricts access to specific vendor ID.

---

## 6. Call Lifecycle Backend

The backend traces an inbound call through 14 distinct states and operations:

```
[Carrier Webhook: call.initiated]
               │
               ▼
   [WebhookIdempotencyService: acquireLock]
               │
               ▼
       [CallController.handleEvent]
               │
        ┌──────┴────────────────────────────────────────┐
        ▼                                               ▼
[Number Inactive / Blocked /                [Active Number Validated]
 Insufficient Balance]                                  │
        │                                               ▼
        ▼                                   [CallsService.createCall (INITIATED)]
 [Call Created (FAILED)                                 │
  & Provider Hangup]                                    ▼
                                            [WalletService.reserveForCall]
                                                        │
                                                        ▼
                                            [Provider: answerCall]
                                                        │
                                                        ▼
                                            [Carrier Webhook: call.answered]
                                                        │
                                                        ▼
                                            [CallsService.transitionCall (ROUTING)]
                                                        │
                                                        ▼
                                            [Provider: startRecording]
                                                        │
                                                        ▼
                                            [CallsService.prepareNextBuyer]
                                                        │
                                                        ▼
                                            [Provider: dialBuyer -> CallAttempt (RINGING)]
                                                        │
                                ┌───────────────────────┴──────────────────────┐
                                ▼                                              ▼
                    [Attempt Failed / No Answer]                   [Buyer Answers]
                                │                                              │
                                ▼                                              ▼
                    [CallsService.handleBuyerHangup]               [CallsService.markCallAnswered]
                                │                                              │
                                ▼                                              ▼
                    [Dial Next Buyer in Priority]                  [Provider: bridgeCalls]
                                                                               │
                                                                               ▼
                                                                [Wallet Extension Timer Started]
                                                                               │
                                                                               ▼
                                                                  [Carrier Webhook: call.hangup]
                                                                               │
                                                                               ▼
                                                                [CallsService.handleCallerHangup]
                                                                - Call state -> COMPLETED
                                                                - Cancel active attempts
                                                                - Stop extension timer
                                                                               │
                                                                               ▼
                                                                [UsageBillingService.billCallUsage]
                                                                - Debit micro-dollar cost
                                                                - Settle wallet reservation
                                                                               │
                                                                               ▼
                                                                [Carrier Webhook: call.recording.saved]
                                                                - Save Recording metadata
                                                                - Bill recording storage usage
```

1. **Inbound Webhook**: Carrier posts `call.initiated` (Telnyx) or `ringing`/`queued` (Twilio) to webhook controller.
2. **Idempotency**: Webhook acquires a database lock via unique `(provider, providerEventId)` in `webhook_events`. Duplicates return HTTP 200 immediately.
3. **Tracking Number Lookup**: Finds `PhoneNumber` where `phone_number = to` and `status = ACTIVE`.
4. **Pre-Call Validation**: Verifies workspace is `ACTIVE`, campaign is `ACTIVE`, and caller `from` is not in `blocked_callers`. If invalid, creates `Call` in `FAILED` state and immediately hangs up.
5. **Call Creation**: `CallsService.createCall` creates `Call` record with `state: INITIATED`. Fires outbound webhook `call.started`.
6. **Pre-Routing Wallet Hold**: `UsageBillingService.calculateInitialReservation(numberType)` calculates required funds (e.g. 10 minutes at $0.009/min = $0.09 = 90,000 micro-dollars). `WalletService.reserveForCall` locks funds in `CallReservation`. If available wallet balance is insufficient, call state is updated to `FAILED` and carrier hangs up.
7. **Answer Inbound**: Calls `provider.answerCall(providerCallId)`.
8. **Transition to ROUTING**: Upon carrier `call.answered`, calls `CallsService.transitionCall(call.id, CallState.ROUTING)` with row-level database lock (`SELECT FOR UPDATE`). Initiates call recording via `provider.startRecording(call.provider_call_id)`.
9. **Buyer Selection (Waterfall Routing)**: `CallsService.prepareNextBuyer` fetches campaign buyers ordered by `priority ASC`. Filters out buyers with prior attempts. If no buyers remain, call transitions to `NO_ANSWER`.
10. **Dial Attempt**: Creates `CallAttempt` in state `INITIATED`. Calls `provider.dialBuyer(destinationNumber, toNumber, connectionId, timeout)`. Transitions attempt to `RINGING`.
11. **Bridging & Live Timer**: When buyer answers, `CallsService.markCallAnswered` updates call and attempt `answered_at` timestamps. Calls `provider.bridgeCalls(callerLeg, buyerLeg)`. Starts a recurring 10-minute in-memory extension timer (`scheduleAuthorizationExtension`) at 80% mark (8 minutes) to reserve additional funds from the wallet. If funds deplete, provider is commanded to hang up.
12. **Hangup Handling**: Carrier sends `call.hangup`.
    - If caller hangs up: Clears extension timer. Calls `CallsService.handleCallerHangup`. Call transitions to `COMPLETED` (or `CANCELED` if not answered). Active attempt legs are canceled. Computes talk duration (`ended_at - answered_at`).
    - If buyer hangs up before answer: `handleBuyerHangup` marks attempt `NO_ANSWER`/`FAILED`, returns `DIAL_NEXT`, and waterfall dials next priority buyer.
13. **Usage Billing & Wallet Settlement**: `UsageBillingService.billCallUsage` calculates exact cost:
    - Base call rate ($0.009/min local, $0.025/min toll-free) rounded up to full minutes.
    - Slices funds from `CallReservation`, records debit `WalletTransaction` (`reference_type: 'CALL_SETTLEMENT'`), and releases remaining reserved funds.
14. **Recording Saved**: Carrier posts `call.recording.saved`. Stores metadata in `recordings` table. Calls `usageBillingService.billRecordingUsage` ($0.001/min) and fires outbound webhook `recording.available`.

---

## 7. Telnyx Integration

- **SDK Version**: `telnyx@^7.21.0` (as declared in `apps/api/package.json` and root `package.json`).
- **Provider Abstraction**: Implements `TelephonyProvider` interface (`apps/api/src/telephony/telephony.provider.ts`).
- **Telnyx Provider Class**: `TelnyxProvider` (`apps/api/src/telephony/telnyx/telnyx.provider.ts`).
- **Signature Verification**:
  - Controller: `TelnyxWebhookController`.
  - Headers: `telnyx-signature-ed25519` and `telnyx-timestamp`.
  - Mechanism: Uses `client.webhooks.unwrap(payloadStr, { headers }, publicKey)`.
  - Fallback: If `TELNYX_PUBLIC_KEY` is undefined, logs a warning and skips verification for dev/test environments.
- **Webhook Idempotency**:
  - Service: `WebhookIdempotencyService`.
  - Table: `webhook_events` with unique constraint `@@unique([provider, providerEventId])`.
  - Tracks states: `PENDING` -> `PROCESSED` / `FAILED` / `IGNORED`.
- **Handled Telnyx Event Types**:
  1. `call.initiated` -> Mapped to `CallEventType.CALL_INITIATED`
  2. `call.answered` -> Mapped to `CallEventType.CALL_ANSWERED`
  3. `call.hangup` -> Mapped to `CallEventType.CALL_HANGUP`
  4. `call.recording.saved` -> Mapped to `CallEventType.CALL_RECORDING_SAVED`
  - Any other event type returns `{ type: 'UNKNOWN' }` and is marked `IGNORED` in `webhook_events`.
- **Telnyx Call Operations**:
  - `answerCall`: `POST /v2/calls/{call_control_id}/actions/answer`
  - `hangupCall`: `POST /v2/calls/{call_control_id}/actions/hangup`
  - `bridgeCalls`: `POST /v2/calls/{call_control_id}/actions/bridge` with `{ call_control_id_b }`
  - `dialBuyer`: `POST /v2/calls` with `to`, `from`, `connection_id`, `timeout_secs`
  - `startRecording`: `POST /v2/calls/{call_control_id}/actions/record_start` with `{ format: 'mp3', channels: 'dual' }`
  - `getRecordingUrl`: Returns signed recording URL from Telnyx API
  - `provisionNumber`: `POST /v2/number_orders` and assigns Call Control App ID via Telnyx Phone Numbers API.

---

## 8. Routing Engine

### 8.1 Actual Implementation
- **Campaign**: `Campaign` model with `status: ACTIVE | INACTIVE`.
- **Buyer**: `Buyer` model with `destination_number` (E.164 normalized), `timeout` (seconds, default 30), `status: ACTIVE | INACTIVE`.
- **Priority & Waterfall**: Buyers are linked to campaigns via `CampaignBuyer` with unique `(campaign_id, priority)`.
- **Execution Flow**: When a call enters `ROUTING`, `CallsService.prepareNextBuyer` selects the lowest integer priority active buyer not yet attempted.
- **Failover / Fallback**: If Buyer A fails to answer within timeout or carrier returns busy/rejected, `handleBuyerHangup` marks attempt `NO_ANSWER` or `FAILED`, returns action `DIAL_NEXT`, and dials Buyer B.
- **Hangup Wins Race**: If the inbound caller hangs up while dialing a buyer, database row-locking (`SELECT FOR UPDATE`) prevents answering the buyer attempt, cancels all attempts, and hangs up the outbound carrier leg.

### 8.2 Excluded / Absent Routing Capabilities
- **IVR (Interactive Voice Response)**: **ABSENT**. No IVR menus, DTMF gathering, or prompts exist.
- **Geographic Routing**: **ABSENT**. No area code or geo-IP routing exists.
- **Time-of-Day / Schedule Routing**: **ABSENT**. No business hours or scheduling rules exist.
- **Round-Robin Routing**: **ABSENT**. Routing is strictly waterfall priority-ordered.
- **Bidding / Dynamic Auction**: **ABSENT**. No bid pricing or real-time auction engine exists.
- **Call Flow Builder / Visual Graph**: **ABSENT**. No visual flow engine or JSON node execution exists.

---

## 9. Commercial Backend

### 9.1 Forensic Status Comparison

| Capability | Current HEAD (`f901302`) | Frozen Baseline (`59da9de`) |
| :--- | :--- | :--- |
| **CallCommercial Model** | **MISSING** (Not in `schema.prisma`) | **IMPLEMENTED** (Prisma model) |
| **CommercialEvaluatorService** | **MISSING** (File does not exist) | **IMPLEMENTED** (`commercial-evaluator.service.ts`) |
| **CommercialDisputesController**| **MISSING** (File does not exist) | **IMPLEMENTED** (`commercial-disputes.controller.ts`) |
| **CommercialDisputesService** | **MISSING** (File does not exist) | **IMPLEMENTED** (`commercial-disputes.service.ts`) |
| **Call Lifecycle Hook** | **MISSING** (`CallController` does not call evaluator) | **MISSING** (`CallController` never calls evaluator!) |
| **Status Transition to FINAL** | **MISSING** | **MISSING** (No code matures `PENDING` -> `FINAL`) |
| **Finalizes_at Calculation** | **MISSING** | **PARTIAL/BROKEN** (Evaluator sets `finalizes_at: null`) |

### 9.2 Commercial Evaluator Rules (Baseline `59da9de`)
- **Activation Rule**: Evaluated only if call state is `COMPLETED` and campaign has both `default_revenue_amount !== null` and `default_payout_amount !== null`.
- **Converted**: `duration_secs >= campaign.conversion_duration_secs`.
- **Qualified**: `qualified = converted` (V1 equality rule).
- **Duplicate**: Evaluates prior calls within `duplicate_window_secs` (default 30 days) with same caller number. **Duplicate is purely a classification flag and does NOT force revenue/payout to 0**.
- **Revenue Snapshot**: If `converted`, sets `campaign.default_revenue_amount`; else `0.0000` (Decimal 12,4).
- **Payout Snapshot**: If `converted`, sets `campaign.default_payout_amount`; else `0.0000` (Decimal 12,4).
- **Cost Snapshot**: Resolves exact cost from debit `WalletTransaction` with `reference_type: 'CALL_SETTLEMENT'`. Divides `amount_micro` by 1,000,000 to obtain dollar Decimal. If transaction is missing, evaluation fails fast and aborts persistence rather than assuming zero.
- **Profit Calculation**: Exact Decimal arithmetic: `profit = revenue - payout - cost`.
- **Currency Snapshot**: `CallCommercial.currency = Campaign.currency`.
- **Vendor Attribution**: Resolved from tracking phone number `PhoneNumber.vendor_id`.
- **Buyer Attribution**: Resolved from winning answered attempt `CallAttempt.buyer_id`.
- **Idempotency**: Scoped by unique constraint `CallCommercial.call_id`. Existing record returned if already evaluated.

---

## 10. Dispute Backend

### 10.1 Forensic Status Comparison
- **Current HEAD (`f901302`)**: **MISSING**.
- **Frozen Baseline (`59da9de`)**: **IMPLEMENTED** in `CommercialDisputesController` and `CommercialDisputesService`.

### 10.2 Dispute Rules & Lifecycle (Baseline `59da9de`)
- **Data Model**: `CallDispute` linked 1:1 with `CallCommercial` (`UNIQUE(call_commercial_id)`).
- **One-Dispute-Per-Call**: Strictly enforced by database unique constraint and service pre-check.
- **Creation Authorization**: Only buyer participants or workspace members with `call:dispute_create` can create a dispute. Caller buyer must match `CallCommercial.buyer_id`.
- **Resolution Authorization**: Only `OWNER` or `ADMIN` roles can resolve disputes (`POST /workspaces/:workspaceId/disputes/:disputeId/resolve`).
- **Accepted Dispute Economics**:
  - `adjusted_revenue = 0.0000`
  - `adjusted_payout = 0.0000`
  - `cost = unchanged` (operational carrier cost is immutable)
  - `profit = adjusted_revenue - adjusted_payout - cost = -cost`
  - `CallCommercial.status = CommercialStatus.ADJUSTED`
  - Creates immutable audit record in `CallFinancialAdjustment`.
  - Updates `CallDispute.status = DisputeStatus.ACCEPTED`.
  - Records event in `SecurityAuditLog`.
- **Rejected Dispute Economics**:
  - Updates `CallDispute.status = DisputeStatus.REJECTED`.
  - Leaves `CallCommercial` revenue, payout, and profit untouched.
- **Sanitization / Visibility**:
  - When viewed by a Buyer, vendor payout, internal carrier cost, and profit are stripped from the response.

---

## 11. Settlement Backend

### 11.1 Forensic Status Comparison
- **Current HEAD (`f901302`)**: **MISSING**.
- **Frozen Baseline (`59da9de`)**:
  - **Prisma Schema**: `SettlementBatch`, `SettlementItem`, `SettlementAdjustment` are **IMPLEMENTED**.
  - **Service**: `SettlementBatchService` is **IMPLEMENTED**.
  - **Controller / HTTP API**: **MISSING** (No controller exposed in `settlement.module.ts`).
  - **Frontend Consumer**: **MISSING**.
  - **Tests**: **IMPLEMENTED** in `test/settlement-generation.e2e-spec.ts` and `test/settlement-schema.e2e-spec.ts`.

### 11.2 COMM-13B Uniqueness Contract
- In `59da9de`, `SettlementItem` defines:
  `@@unique([call_commercial_id, participant_type])`
- This allows exactly **one BUYER settlement item** and **one VENDOR settlement item** for the same `CallCommercial`.

---

## 12. COMM-14 Settlement Generation

In baseline `59da9de`, `SettlementBatchService` implements batch generation:
1. **Methods**: `generateBuyerSettlement(options)` and `generateVendorSettlement(options)`.
2. **Eligibility Criteria**:
   - `CallCommercial.status === 'FINAL'`
   - `finalizes_at >= period_start AND finalizes_at < period_end`
   - `finalizes_at <= NOW()` (maturity constraint)
   - `revenue > 0` (for Buyer batch) or `payout > 0` (for Vendor batch)
   - No active `PENDING` dispute on `CallCommercial`. If a pending dispute exists, the call is skipped.
3. **Currency Partitioning**: Separate batches generated for each distinct currency (e.g. `USD`, `CAD`).
4. **Participant Partitioning**: Separate batches generated for each distinct Buyer / Vendor.
5. **Batch Number Generation**: Deterministic human-readable format:
   `SB-<BUYER|VENDOR>-<PARTICIPANT_ID_PREFIX>-<CURRENCY>-<YYYYMMDD_START>-<YYYYMMDD_END>`
6. **Concurrency & Retry**: Wrapped in `withRetry` helper (5 retries with exponential backoff) handling Prisma write conflicts (`P2034`), unique constraint collisions (`P2002`), and Postgres serialization failures (`40001`).

---

## 13. COMM-14B Period Contract

In baseline `59da9de`, the period input contract conforms strictly to design specifications:
- `period_start`: Explicit required `Date` input (inclusive `gte`).
- `period_end`: Explicit required `Date` input (exclusive `lt`).
- Validation: If `period_start >= period_end`, immediately throws `BadRequestException`.
- Semantics: Pure `[start, end)` half-open interval.
- No auto-cadence: Does NOT default to daily, weekly, or monthly boundaries.
- No shifting: Exact ISO timestamps are preserved without timezone rounding or shifting.

---

## 14. Payment Backend

- **Current HEAD (`f901302`)**: **MISSING**.
- **Frozen Baseline (`59da9de`)**: **SCHEMA ONLY**.
- **Detailed Findings**:
  - `PaymentInstruction` and `PaymentExecution` exist as Prisma models in `59da9de:apps/api/prisma/schema.prisma`.
  - There is **no service** (`PaymentService` does not exist).
  - There is **no controller** or HTTP API.
  - There is **no gateway provider abstraction** (Stripe/Wise payout integration does not exist for settlement).
  - Status models: Distinguishes `PaymentStatus` (batch level), `InstructionStatus` (`CREATED`, `PENDING`, `SUBMITTED`, `COMPLETED`, `FAILED`, `CANCELED`), and `ExecutionStatus` (`INITIATED`, `PROCESSING`, `SUCCESS`, `FAILURE`).
  - Unit/E2E test assertion `test/settlement-generation.e2e-spec.ts:896` explicitly confirms:
    `it('42, 43, 44, 45. no PaymentInstruction, PaymentExecution, ReconciliationRun, or ReconciliationIssue created')`.

---

## 15. Reconciliation Backend

- **Current HEAD (`f901302`)**: **MISSING**.
- **Frozen Baseline (`59da9de`)**: **SCHEMA ONLY**.
- **Detailed Findings**:
  - `ReconciliationRun` and `ReconciliationIssue` exist as Prisma models in `59da9de:apps/api/prisma/schema.prisma`.
  - There is **no reconciliation engine, background job, service, or API**.
  - No automated variance detection or ledger auditing logic exists in executable code.

---

## 16. Billing / Usage / Cost

### 16.1 Operational Wallet Engine (Fully Implemented in Current HEAD)
- **Data Models**:
  - `WorkspaceBalance`: Tracks `balance_minor`, `balance_micro` (BigInt), `reserved_micro` (BigInt), and `currency`.
  - `WalletTransaction`: Immutable financial ledger tracking `amount_micro`, `balance_after_micro`, `reference_type`, `reference_id`, and unique `idempotency_key`.
  - `CallReservation`: Locks funds for mid-flight calls.
  - `CallReservationExtension`: Incremental reservation blocks added during long calls.
- **Reservation Lifecycle**:
  1. Call arrives: `reserveForCall` checks available funds (`balance_micro - reserved_micro >= initialAmountMicro`). Increases `reserved_micro`.
  2. Call active: Every 10 minutes at 80% mark (8 min), `extendReservationForCall` reserves an additional block.
  3. Call ends: `settleReservationForCall` calculates exact talk duration cost, creates a `DEBIT` transaction (`reference_type: 'CALL_SETTLEMENT'`), decreases `balance_micro`, and releases all remaining reserved funds.
  4. Non-answer / Blocked: Reservation is released completely with zero debit.

### 16.2 Usage Records
- Table: `usage_records` tracks units for billing audit: `CALL_MINUTE`, `PHONE_NUMBER`, `RECORDING_STORAGE`.

### 16.3 Operational Usage vs. Historical Commercial Cost
- **Operational Cost**: Micro-dollar debit in `wallet_transactions` representing CallFlow's direct platform fee to the workspace owner.
- **Commercial Cost Snapshot**: In `59da9de`, `CallCommercial.cost` captures the operational debit snapshot as a Decimal dollar amount (`div(1_000_000)`) to compute net publisher/buyer profit.

---

## 17. Reporting Backend

### 17.1 Reporting Architecture
Reporting is split across two specialized modules:
1. `CallsController` (`apps/api/src/calls/calls.controller.ts`) / `CallsService`:
   - Handles real-time KPI aggregation, time-series charts, and paginated call logs.
2. `ReportsController` (`apps/api/src/reports/reports.controller.ts`) / `ReportsService`:
   - Handles saved report configurations and streaming binary file exports.

### 17.2 Metric Database Sources

| Reporting Metric | Database Source | Calculation / Logic in CallsService |
| :--- | :--- | :--- |
| **Total Calls** | `calls.id` | `COUNT(*)::int as total` |
| **Answered** | `calls.state` | `SUM(CASE WHEN c.state = 'COMPLETED' THEN 1 ELSE 0 END)::int` |
| **Missed** | `calls.state` | `SUM(CASE WHEN c.state IN ('NO_ANSWER', 'CANCELED') THEN 1 ELSE 0 END)::int` |
| **Failed** | `calls.state` | `SUM(CASE WHEN c.state = 'FAILED' THEN 1 ELSE 0 END)::int` |
| **Blocked** | `calls.state` | `SUM(CASE WHEN c.state = 'FAILED' THEN 1 ELSE 0 END)::int` |
| **Answer Rate** | Computed on Frontend | `answered / total` |
| **Average Talk Time** | `calls.duration_secs` | `answered > 0 ? Math.round(answered_duration / answered) : 0` |
| **Average Total Time** | `calls.started_at`, `ended_at` | `eligible_calls > 0 ? Math.round(tcl_secs / eligible_calls) : null` (`aclSecs`) |
| **Live Calls** | `calls.state` | `COUNT(*)` where `state IN ('INITIATED', 'ROUTING')` (`GET /live-calls`) |
| **Revenue** | `CallCommercial.revenue` | **ABSENT in current HEAD**; in `59da9de` aggregated from `CallCommercial` |
| **Payout** | `CallCommercial.payout` | **ABSENT in current HEAD**; in `59da9de` aggregated from `CallCommercial` |
| **Profit** | `CallCommercial.profit` | **ABSENT in current HEAD**; in `59da9de` aggregated from `CallCommercial` |
| **Cost** | `CallCommercial.cost` | **ABSENT in current HEAD**; in `59da9de` aggregated from `CallCommercial` |
| **Converted** | `CallCommercial.converted` | **ABSENT in current HEAD**; in `59da9de` aggregated from `CallCommercial` |
| **Qualified** | `CallCommercial.qualified` | **ABSENT in current HEAD**; in `59da9de` aggregated from `CallCommercial` |
| **Duplicate** | `CallCommercial.duplicate` | **ABSENT in current HEAD**; in `59da9de` aggregated from `CallCommercial` |

---

## 18. Reporting Filter Coverage

Forensic audit of Dialics-style reporting concepts against backend implementation:

| Concept | Backend Field / Query Support | Endpoint Support | Actual Filtering Logic | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Campaign** | `c.campaign_id = filters.campaignId` | `GET /calls`, `GET /calls/metrics`, `POST /reports/export` | Exact match filter + GroupBy support | **IMPLEMENTED** |
| **Vendor** | None on `Call` model | None in `CallsController` | No filter support on calls | **MISSING** |
| **Destination Name** | `attempts.buyer.name` | Display only in `GET /calls` | Included in relations, no query filter | **PARTIAL** |
| **Destination Number** | `attempts.buyer.destination_number` | None | No query parameter in `getCalls` | **MISSING** |
| **Buyer** | `EXISTS (SELECT 1 FROM call_attempts WHERE buyer_id = ?)` | `GET /calls`, `GET /calls/metrics`, `POST /reports/export` | Subquery match on attempt buyer | **IMPLEMENTED** |
| **Tracking Number** | `c.to_number = filters.trackingNumber` | `GET /calls`, `GET /calls/metrics`, `POST /reports/export` | Exact match on dialed number | **IMPLEMENTED** |
| **Caller ID** | `c.from_number LIKE %callerNumber%` | `GET /calls`, `GET /calls/metrics`, `POST /reports/export` | SQL contains match | **IMPLEMENTED** |
| **Traffic Sources** | None | None | No traffic source model or field | **MISSING** |
| **Number Pool** | None | None | No number pool model or field | **MISSING** |
| **Parameters** | None | None | No parameters model or field | **MISSING** |
| **Custom Parameters** | None | None | No custom parameters model or field | **MISSING** |
| **Duration** | `minDurationSecs`, `maxDurationSecs`, `durationType` | `GET /calls`, `GET /calls/metrics`, `POST /reports/export` | Raw SQL epoch diff on `started_at` or `answered_at` | **IMPLEMENTED** |
| **Caller Profile / CRM**| None | None | No caller CRM model | **MISSING** |
| **Caller Identity** | `c.from_number` | Display only | Phone string only | **PARTIAL** |
| **Tags** | None | None | No call tags model | **MISSING** |
| **UUID** | `c.id` | `GET /calls/:callId` | Exact match by UUID | **IMPLEMENTED** |
| **Session Data** | None | None | No web session model | **MISSING** |
| **SIP Headers** | None | None | No SIP headers stored | **MISSING** |
| **Qualification** | None in current HEAD | None | Absent in current HEAD; in `59da9de` via `CallCommercial` | **MISSING** (Current HEAD) |
| **Status** | `c.state = filters.status` | `GET /calls`, `GET /calls/metrics`, `POST /reports/export` | Enum match (`COMPLETED`, etc.) | **IMPLEMENTED** |
| **Fail Reason** | None | None | No fail reason field stored | **MISSING** |

---

## 19. Data Ownership

- **Authoritative Database Source**:
  - Total Calls, Answered, Missed, Failed, Blocked: `calls` table (`state`).
  - Talk Duration: `calls.ended_at - calls.answered_at`.
  - Total Call Duration: `calls.ended_at - calls.started_at`.
  - Live Calls: `calls` table where `state IN ('INITIATED', 'ROUTING')`.
  - Wallet Balance: `workspace_balances.balance_micro`.
  - Operational Cost: `wallet_transactions.amount_micro` (`reference_type: 'CALL_SETTLEMENT'`).
  - Commercial Revenue, Payout, Profit: Sourced exclusively from `CallCommercial` (in `59da9de`).
- **Discrepancy Documented**:
  - `Answer Rate`: Frontend computes `(answered / total) * 100`. Backend does not provide a pre-aggregated rate field.
  - `Blocked Calls`: Backend query currently computes `blocked` identical to `failed` (`SUM(CASE WHEN c.state = 'FAILED' THEN 1 ELSE 0 END)`). In current schema, blocked calls are stored with `state: FAILED`.

---

## 20. Idempotency / Concurrency

1. **Carrier Webhooks**:
   - Protected by `WebhookIdempotencyService` with database unique constraint `@@unique([provider, providerEventId])`.
   - Concurrent duplicates receive `'Duplicate'` and abort processing immediately.
2. **Call State Transitions**:
   - `CallsService.transitionCall`, `handleCallerHangup`, and `commitBuyerDial` wrap updates in database transactions with row-level locks: `tx.$queryRaw` SELECT id FROM "calls" WHERE id = ${callId} FOR UPDATE``.
3. **Wallet Deductions**:
   - `WalletTransaction` enforces a unique constraint on `idempotency_key`. Duplicate requests fail fast.
4. **Campaign Buyer Reordering**:
   - `CampaignsService.reorderBuyersInCampaign` uses a two-phase transaction with a negative priority offset (`priority = -1000 - index`) to avoid unique constraint collisions on `(campaign_id, priority)`.
5. **Settlement Batch Generation (Baseline `59da9de`)**:
   - `withRetry` helper catches Postgres serialization failures (`40001`), deadlocks (`40P01`), and unique collisions (`P2002`), retrying up to 5 times.
   - `SettlementItem` uniqueness `UNIQUE(call_commercial_id, participant_type)` prevents duplicate items per participant.

---

## 21. Error Handling

- **Validation Errors**: Global `BadRequestException` for invalid dates, negative durations, or invalid status enums.
- **Tenant Isolation Errors**: `ForbiddenException('You do not have access to this workspace')`.
- **Resource Scope Errors**: `ForbiddenException('Insufficient resource scope')`.
- **Workspace Status Lock**: Rejects mutations with `ForbiddenException('Operational actions are blocked because workspace is SUSPENDED')`.
- **Carrier Signature Verification**: Returns HTTP 400 with `Webhook Error: <message>` upon invalid Ed25519 or HMAC-SHA1 signature.
- **Export Limit Exceeded**: Returns HTTP 400 when report export query exceeds 10,000 rows.

---

## 22. Test Coverage

- **Test Framework**: Vitest (`vitest run`).
- **Test Inventory**:
  - Total Test Files: 51 (21 unit/integration specs in `src`, 30 E2E specs in `test`).
  - Total Unit/E2E Test Execution: Verified via `npm --prefix apps/api run test`.
  - Test Suite Result: 28 test files passed, 259 individual test assertions passed. (1 test file failed due to preexisting database unique constraint collision on workspace slug `ws-a`).

| Test Domain | Specs Present | Scope Covered | Critical Missing Tests |
| :--- | :--- | :--- | :--- |
| **Calls & Lifecycle** | `calls.spec.ts`, `calls.controller.spec.ts`, `concurrency.spec.ts`, `call-routing-billing.spec.ts` | State transitions, hangup races, concurrent routing, timer monitoring | None for implemented states |
| **Telephony & Telnyx**| `telephony.spec.ts`, `telnyx.spec.ts`, `twilio.spec.ts`, `recordings.controller.spec.ts` | Webhook signature validation, event normalization, bridge calls | Live carrier network failover |
| **Routing** | `routing.spec.ts`, `campaigns.service.spec.ts`, `blocked-callers.service.spec.ts`, `routing-engine.e2e-spec.ts` | E.164 normalization, buyer waterfall, priority reorder transaction | Complex routing trees (none exist) |
| **Billing & Wallet** | `billing.service.spec.ts`, `wallet.service.spec.ts`, `billing.controller.spec.ts`, `mock-topup.spec.ts`, `reservation.spec.ts`, `extension.spec.ts`, `extension2.spec.ts`, `timer.spec.ts` | Micro-dollar arithmetic, concurrency, insufficient balance rejection, extension hold | Multi-currency exchange rates |
| **RBAC & Security** | `rbac-1.e2e-spec.ts` through `rbac-10-audit-logs.e2e-spec.ts`, `rbac-enforcement.e2e-spec.ts`, `authorization.e2e-spec.ts` | Roles, participant scoping (Buyer/Vendor), resource scoping, audit logs | None |
| **Reporting** | `reporting.e2e-spec.ts`, `reports.e2e-spec.ts`, `reports-export.e2e-spec.ts` | Metrics calculation, bucket queries, saved report CRUD, CSV/XLSX export | Cross-year performance queries |
| **Commercial (Current)**| None in current HEAD | None in current HEAD | Commercial evaluator, disputes, settlement (unapplied) |
| **Commercial (`59da9de`)**| `commercial-evaluator.spec.ts`, `commercial-disputes.spec.ts`, `commercial-audit.e2e-spec.ts`, `commercial-reporting.e2e-spec.ts`, `settlement-generation.e2e-spec.ts`, `settlement-schema.e2e-spec.ts` | Snapshot calculation, dispute reversal, settlement eligibility & batching | Payment execution, Reconciliation engine |

---

## 23. Dead / Unused Backend Code

1. **`TwilioProvider` & `TwilioWebhookController`**: Fully implemented with signature verification and TwiML responses, but primary system architecture is Telnyx-centric.
2. **`PublicBillingController`, `PublicUsageController`, `PublicRecordingsController`**: Public API endpoints exist but are not consumed by the CallFlow web UI (the frontend uses internal routes).
3. **`PermissionsController` Guard Redundancy**: `PermissionsController` lacks class-level `@UseGuards(WorkspaceRolesGuard)`, relying entirely on manual caller role checks in `PermissionsService`.
4. **`CallController.getCallState`**: Stub method returning `null` (`apps/api/src/telephony/call-controller.ts:468`).

---

## 24. Security / Data Access Risks

1. **Tenant Isolation Risk in Custom Raw SQL Queries**:
   - In `CallsService.getCalls` (line 494), raw SQL uses `Prisma.sql` where `workspace_id = ${workspaceId}`. The query is correctly parameterized, preventing SQL injection, but complex dynamic string joining requires ongoing linting.
2. **Dev Fallback in Telnyx Webhook Verification**:
   - In `TelnyxWebhookController.ts:44`, if `TELNYX_PUBLIC_KEY` is not set, signature verification is bypassed with a warning. If deployed to production without configuring `TELNYX_PUBLIC_KEY`, unauthenticated attackers could forge call events.
3. **Export Row Count DOS Protection**:
   - `ReportsService.generateExport` limits export to 10,000 rows. Exceeding 10,000 throws `BadRequestException`. This prevents worker out-of-memory crashes.
4. **Formula Injection Neutralization**:
   - `ReportsService.generateExport` prefixes values starting with `=`, `+`, `-`, `@` with a tab (`\t`), effectively mitigating CSV formula execution in Excel.

---

## 25. Missing / Partial Backend Capabilities

1. **Commercial Finalization Lifecycle**: **MISSING / BROKEN IN BASELINE**. In `59da9de`, `CommercialEvaluatorService` sets `finalizes_at: null` and `status: PENDING`. No automated transitioner matures calls to `FINAL`.
2. **Payment Execution Engine**: **SCHEMA ONLY IN BASELINE**. `PaymentInstruction` and `PaymentExecution` have no backend execution service.
3. **Reconciliation Engine**: **SCHEMA ONLY IN BASELINE**. `ReconciliationRun` and `ReconciliationIssue` have no backend processing service.
4. **Settlement HTTP API**: **SERVICE ONLY IN BASELINE**. `SettlementBatchService` exists without a controller or API route.
5. **IVR / Smart Routing**: **ABSENT**. No IVR, geo-routing, schedule-based routing, or round-robin logic exists.
6. **Caller Identity / CRM**: **ABSENT**. No customer profile storage or caller history enrichment exists.

---

## 26. Complete API Master Table

| Method | Endpoint | Module | Auth | Workspace | Permission / Role | Service Method | DB Models | Frontend Consumer | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/` | AppModule | None | None | Public | `AppService.getHello` | None | None | IMPLEMENTED |
| `GET` | `/protected` | AppModule | JWT | None | Authenticated | Inline handler | None | None | IMPLEMENTED |
| `GET` | `/account` | AccountModule | JWT | None | Authenticated | `AccountService.getAccount` | `Profile` | `account/page.tsx` | IMPLEMENTED |
| `PUT` | `/account/profile` | AccountModule | JWT | None | Authenticated | `AccountService.updateProfile` | `Profile` | `account/page.tsx` | IMPLEMENTED |
| `POST`| `/workspaces` | WorkspacesModule | JWT | None | Authenticated | `WorkspacesService.createWorkspace` | `Workspace`, `WorkspaceMember` | `onboarding`, `settings` | IMPLEMENTED |
| `GET` | `/workspaces` | WorkspacesModule | JWT | None | Authenticated | `WorkspacesService.getUserWorkspaces` | `Workspace`, `WorkspaceMember` | Header, Settings | IMPLEMENTED |
| `GET` | `/workspaces/:workspaceId` | WorkspacesModule | JWT | Required | All Roles | `WorkspacesService.getWorkspaceInfo` | `Workspace` | Layout | IMPLEMENTED |
| `PUT` | `/workspaces/:workspaceId/settings` | WorkspacesModule | JWT | Required | `OWNER`, `ADMIN` | `WorkspacesService.updateWorkspaceSettings` | `Workspace` | `settings/page.tsx` | IMPLEMENTED |
| `PUT` | `/workspaces/:workspaceId/status` | WorkspacesModule | JWT | Required | `OWNER` | `WorkspacesService.updateWorkspaceStatus` | `Workspace` | None | IMPLEMENTED |
| `GET` | `/workspaces/:workspaceId/members` | WorkspacesModule | JWT | Required | All Roles | `WorkspacesService.getWorkspaceMembers` | `WorkspaceMember`, `Profile` | `members/page.tsx` | IMPLEMENTED |
| `PUT` | `/workspaces/:workspaceId/members/:userId/role` | WorkspacesModule | JWT | Required | `OWNER`, `ADMIN` | `WorkspacesService.updateMemberRole` | `WorkspaceMember`, `SecurityAuditLog` | `members/page.tsx` | IMPLEMENTED |
| `DELETE`| `/workspaces/:workspaceId/members/:userId` | WorkspacesModule | JWT | Required | `OWNER`, `ADMIN` | `WorkspacesService.removeMember` | `WorkspaceMember` | `members/page.tsx` | IMPLEMENTED |
| `GET` | `/workspaces/:workspaceId/invitations` | WorkspacesModule | JWT | Required | `OWNER`, `ADMIN` | `WorkspacesService.getWorkspaceInvitations` | `WorkspaceInvitation` | `members/page.tsx` | IMPLEMENTED |
| `POST`| `/workspaces/:workspaceId/invitations` | WorkspacesModule | JWT | Required | `OWNER`, `ADMIN` | `WorkspacesService.createInvitation` | `WorkspaceInvitation` | `members/page.tsx` | IMPLEMENTED |
| `DELETE`| `/workspaces/:workspaceId/invitations/:inviteId` | WorkspacesModule | JWT | Required | `OWNER`, `ADMIN` | `WorkspacesService.revokeInvitation` | `WorkspaceInvitation` | `members/page.tsx` | IMPLEMENTED |
| `GET` | `/invitations/verify/:token` | WorkspacesModule | None | None | Public | `WorkspacesService.verifyInvitationToken` | `WorkspaceInvitation` | `invitations/page.tsx` | IMPLEMENTED |
| `POST`| `/workspaces/accept-invitation` | WorkspacesModule | JWT | None | Authenticated | `WorkspacesService.acceptInvitation` | `WorkspaceMember`, `WorkspaceInvitation` | `accept-invitation` | IMPLEMENTED |
| `GET` | `/workspaces/:workspaceId/vendors` | WorkspacesModule | JWT | Required | `vendor:read` | `VendorsService.listVendors` | `Vendor` | `members/page.tsx` | IMPLEMENTED |
| `GET` | `/workspaces/:workspaceId/vendors/:id` | WorkspacesModule | JWT | Required | `vendor:read` (Scoped) | `VendorsService.getVendor` | `Vendor` | None | IMPLEMENTED |
| `POST`| `/workspaces/:workspaceId/vendors` | WorkspacesModule | JWT | Required | `vendor:write` | `VendorsService.createVendor` | `Vendor` | `members/page.tsx` | IMPLEMENTED |
| `GET` | `/workspaces/:workspaceId/buyers` | RoutingModule | JWT | Required | `buyer:read` | `BuyersService.listBuyers` | `Buyer` | `buyers/page.tsx` | IMPLEMENTED |
| `GET` | `/workspaces/:workspaceId/buyers/:id` | RoutingModule | JWT | Required | `buyer:read` (Scoped) | `BuyersService.getBuyer` | `Buyer` | `buyers/[id]/page.tsx` | IMPLEMENTED |
| `POST`| `/workspaces/:workspaceId/buyers` | RoutingModule | JWT | Required | `buyer:create` | `BuyersService.createBuyer` | `Buyer` | `buyers/page.tsx` | IMPLEMENTED |
| `PUT` | `/workspaces/:workspaceId/buyers/:id` | RoutingModule | JWT | Required | `buyer:update` (Scoped) | `BuyersService.updateBuyer` | `Buyer` | `buyers/page.tsx` | IMPLEMENTED |
| `POST`| `/workspaces/:workspaceId/buyers/:id/archive` | RoutingModule | JWT | Required | `buyer:update` (Scoped) | `BuyersService.updateBuyer` | `Buyer` | `buyers/page.tsx` | IMPLEMENTED |
| `POST`| `/workspaces/:workspaceId/buyers/:id/activate` | RoutingModule | JWT | Required | `buyer:update` (Scoped) | `BuyersService.updateBuyer` | `Buyer` | `buyers/page.tsx` | IMPLEMENTED |
| `GET` | `/workspaces/:workspaceId/campaigns` | RoutingModule | JWT | Required | `campaign:read` | `CampaignsService.listCampaigns` | `Campaign` | `campaigns/page.tsx` | IMPLEMENTED |
| `GET` | `/workspaces/:workspaceId/campaigns/:id` | RoutingModule | JWT | Required | `campaign:read` (Scoped) | `CampaignsService.getCampaign` | `Campaign`, `Buyer`, `PhoneNumber` | `campaigns/[id]/page.tsx`| IMPLEMENTED |
| `POST`| `/workspaces/:workspaceId/campaigns` | RoutingModule | JWT | Required | `campaign:create` | `CampaignsService.createCampaign` | `Campaign` | `campaigns/page.tsx` | IMPLEMENTED |
| `PUT` | `/workspaces/:workspaceId/campaigns/:id` | RoutingModule | JWT | Required | `campaign:update` (Scoped) | `CampaignsService.updateCampaign` | `Campaign` | `campaigns/page.tsx` | IMPLEMENTED |
| `POST`| `/workspaces/:workspaceId/campaigns/:id/archive` | RoutingModule | JWT | Required | `campaign:update` (Scoped) | `CampaignsService.updateCampaign` | `Campaign` | `campaigns/page.tsx` | IMPLEMENTED |
| `POST`| `/workspaces/:workspaceId/campaigns/:id/activate` | RoutingModule | JWT | Required | `campaign:update` (Scoped) | `CampaignsService.updateCampaign` | `Campaign` | `campaigns/page.tsx` | IMPLEMENTED |
| `POST`| `/workspaces/:workspaceId/campaigns/:id/phone-numbers` | RoutingModule | JWT | Required | `campaign:update` (Scoped) | `CampaignsService.assignPhoneNumber` | `PhoneNumber` | `campaigns/page.tsx` | IMPLEMENTED |
| `DELETE`| `/workspaces/:workspaceId/campaigns/:id/phone-numbers/:phoneNumberId` | RoutingModule | JWT | Required | `campaign:update` (Scoped) | `CampaignsService.removePhoneNumber` | `PhoneNumber` | `campaigns/page.tsx` | IMPLEMENTED |
| `POST`| `/workspaces/:workspaceId/campaigns/:id/buyers` | RoutingModule | JWT | Required | `campaign:update` (Scoped) | `CampaignsService.addBuyerToCampaign` | `CampaignBuyer` | `campaigns/page.tsx` | IMPLEMENTED |
| `DELETE`| `/workspaces/:workspaceId/campaigns/:id/buyers/:buyerId` | RoutingModule | JWT | Required | `campaign:update` (Scoped) | `CampaignsService.removeBuyerFromCampaign` | `CampaignBuyer` | `campaigns/page.tsx` | IMPLEMENTED |
| `PUT` | `/workspaces/:workspaceId/campaigns/:id/buyers/reorder` | RoutingModule | JWT | Required | `campaign:update` (Scoped) | `CampaignsService.reorderBuyersInCampaign` | `CampaignBuyer` | `campaigns/page.tsx` | IMPLEMENTED |
| `GET` | `/workspaces/:workspaceId/blocked-callers` | RoutingModule | JWT | Required | `OWNER`, `ADMIN` | `BlockedCallersService.listBlockedCallers` | `BlockedCaller` | `blocked-callers` | IMPLEMENTED |
| `POST`| `/workspaces/:workspaceId/blocked-callers` | RoutingModule | JWT | Required | `OWNER`, `ADMIN` | `BlockedCallersService.blockCaller` | `BlockedCaller` | `blocked-callers` | IMPLEMENTED |
| `DELETE`| `/workspaces/:workspaceId/blocked-callers/:id` | RoutingModule | JWT | Required | `OWNER`, `ADMIN` | `BlockedCallersService.unblockCaller` | `BlockedCaller` | `blocked-callers` | IMPLEMENTED |
| `GET` | `/workspaces/:workspaceId/phone-numbers` | PhoneNumbersModule | JWT | Required | `phone_number:read` | `PhoneNumbersService.listWorkspaceNumbers` | `PhoneNumber`, `Campaign` | `phone-numbers` | IMPLEMENTED |
| `GET` | `/workspaces/:workspaceId/phone-numbers/search` | PhoneNumbersModule | JWT | Required | `OWNER`, `ADMIN` | `PhoneNumbersService.searchAvailableNumbers` | None (Telnyx API) | `phone-numbers` | IMPLEMENTED |
| `POST`| `/workspaces/:workspaceId/phone-numbers` | PhoneNumbersModule | JWT | Required | `phone_number:create` | `PhoneNumbersService.provisionNumber` | `PhoneNumber` | `phone-numbers` | IMPLEMENTED |
| `PUT` | `/workspaces/:workspaceId/phone-numbers/:id` | PhoneNumbersModule | JWT | Required | `phone_number:manage` (Scoped) | `PhoneNumbersService.updateNumber` | `PhoneNumber` | `phone-numbers` | IMPLEMENTED |
| `DELETE`| `/workspaces/:workspaceId/phone-numbers/:id` | PhoneNumbersModule | JWT | Required | `phone_number:manage` (Scoped) | `PhoneNumbersService.releaseNumber` | `PhoneNumber` | `phone-numbers` | IMPLEMENTED |
| `GET` | `/workspaces/:workspaceId/calls` | CallsModule | JWT | Required | `call:read` | `CallsService.getCalls` | `Call`, `CallAttempt`, `Recording` | `calls/page.tsx`, `reporting` | IMPLEMENTED |
| `GET` | `/workspaces/:workspaceId/calls/metrics` | CallsModule | JWT | Required | `call:read` | `CallsService.getMetrics` | `Call`, `CallAttempt` | `reporting/page.tsx` | IMPLEMENTED |
| `GET` | `/workspaces/:workspaceId/calls/live-calls` | CallsModule | JWT | Required | `call:read` | `CallsService.getLiveCalls` | `Call` | `header.tsx` | IMPLEMENTED |
| `GET` | `/workspaces/:workspaceId/calls/:callId` | CallsModule | JWT | Required | `call:read` (Scoped) | `CallsService.getCallDetail` | `Call`, `CallAttempt`, `Recording` | `calls/[id]/page.tsx` | IMPLEMENTED |
| `POST`| `/workspaces/:workspaceId/reports/export` | ReportsModule | JWT | Required | `report:export` | `ReportsService.generateExport` | `Call` | `reporting/page.tsx` | IMPLEMENTED |
| `POST`| `/workspaces/:workspaceId/reports` | ReportsModule | JWT | Required | `report:read` | `ReportsService.createSavedReport` | `SavedReport` | `reporting/page.tsx` | IMPLEMENTED |
| `GET` | `/workspaces/:workspaceId/reports` | ReportsModule | JWT | Required | `report:read` | `ReportsService.getReports` | `SavedReport` | `reporting/page.tsx` | IMPLEMENTED |
| `GET` | `/workspaces/:workspaceId/reports/:reportId` | ReportsModule | JWT | Required | `report:read` | `ReportsService.getReport` | `SavedReport` | `reporting/page.tsx` | IMPLEMENTED |
| `PATCH`| `/workspaces/:workspaceId/reports/:reportId` | ReportsModule | JWT | Required | `report:read` | `ReportsService.updateReport` | `SavedReport` | `reporting/page.tsx` | IMPLEMENTED |
| `DELETE`| `/workspaces/:workspaceId/reports/:reportId` | ReportsModule | JWT | Required | `report:read` | `ReportsService.deleteReport` | `SavedReport` | `reporting/page.tsx` | IMPLEMENTED |
| `POST`| `/webhooks/telnyx` | TelephonyModule | Telnyx Ed25519 | None | Carrier Webhook | `CallController.handleEvent` | `WebhookEvent`, `Call`, `Recording` | None | IMPLEMENTED |
| `POST`| `/webhooks/twilio` | TelephonyModule | Twilio HMAC | None | Carrier Webhook | `CallController.handleEvent` | `WebhookEvent`, `Call` | None | IMPLEMENTED |
| `GET` | `/workspaces/:workspaceId/recordings/:recordingId/download` | TelephonyModule | JWT | Required | `call:recording_read` (Scoped) | `TelephonyProvider.getRecordingUrl` | `Recording` | `calls/page.tsx` | IMPLEMENTED |
| `GET` | `/workspaces/:workspaceId/billing` | BillingModule | JWT | Required | All Roles | `BillingService.getBillingState` | `WorkspaceBalance`, `Subscription` | `billing/page.tsx` | IMPLEMENTED |
| `GET` | `/workspaces/:workspaceId/billing/balance` | BillingModule | JWT | Required | All Roles | `BillingService.getBalance` | `WorkspaceBalance` | `header.tsx` | IMPLEMENTED |
| `GET` | `/workspaces/:workspaceId/billing/wallet/transactions` | BillingModule | JWT | Required | All Roles | `WalletService.getTransactions` | `WalletTransaction` | `billing/page.tsx` | IMPLEMENTED |
| `POST`| `/workspaces/:workspaceId/billing/wallet/mock-topup` | BillingModule | JWT | Required | `OWNER`, `ADMIN` (Dev only) | `MockPaymentProvider.createWalletTopUp` | `WorkspaceBalance`, `WalletTransaction` | `billing/page.tsx` | IMPLEMENTED |
| `POST`| `/workspaces/:workspaceId/billing/checkout` | BillingModule | JWT | Required | `OWNER`, `ADMIN` | `BillingService.createCheckoutSession` | `BillingCustomer` | `billing/page.tsx` | IMPLEMENTED |
| `POST`| `/workspaces/:workspaceId/billing/portal` | BillingModule | JWT | Required | `OWNER`, `ADMIN` | `BillingService.createPortalSession` | `BillingCustomer` | `billing/page.tsx` | IMPLEMENTED |
| `POST`| `/webhooks/stripe` | BillingModule | Stripe Signature | None | Gateway Webhook | `BillingService.handleWebhook` | `Subscription`, `Invoice` | None | IMPLEMENTED |
| `GET` | `/workspaces/:workspaceId/permissions` | PermissionsModule | JWT | Required | Authenticated | `PermissionsService.getAllPermissions` | `Permission` | `members/[id]/page.tsx`| IMPLEMENTED |
| `GET` | `/workspaces/:workspaceId/permissions/members/:memberId` | PermissionsModule | JWT | Required | Authenticated | `PermissionsService.getMemberPermissions` | `WorkspaceMemberPermission` | `members/[id]/page.tsx`| IMPLEMENTED |
| `PUT` | `/workspaces/:workspaceId/permissions/members/:memberId/:permissionKey` | PermissionsModule | JWT | Required | `OWNER`, `ADMIN` (Service) | `PermissionsService.assignPermission` | `WorkspaceMemberPermission`, Audit | `members/[id]/page.tsx`| IMPLEMENTED |
| `DELETE`| `/workspaces/:workspaceId/permissions/members/:memberId/:permissionKey`| PermissionsModule | JWT | Required | `OWNER`, `ADMIN` (Service) | `PermissionsService.removePermission` | `WorkspaceMemberPermission`, Audit | `members/[id]/page.tsx`| IMPLEMENTED |
| `GET` | `/workspaces/:workspaceId/audit-logs` | AuditLogsModule | JWT | Required | `audit_log:read` | `AuditLogsService.getAuditLogs` | `SecurityAuditLog` | None | IMPLEMENTED |
| `GET` | `/workspaces/:workspaceId/api-keys` | ApiKeysModule | JWT | Required | `OWNER`, `ADMIN` | `ApiKeysService.listApiKeys` | `ApiKey` | `api-keys/page.tsx` | IMPLEMENTED |
| `POST`| `/workspaces/:workspaceId/api-keys` | ApiKeysModule | JWT | Required | `OWNER`, `ADMIN` | `ApiKeysService.createApiKey` | `ApiKey` | `api-keys/page.tsx` | IMPLEMENTED |
| `DELETE`| `/workspaces/:workspaceId/api-keys/:id` | ApiKeysModule | JWT | Required | `OWNER`, `ADMIN` | `ApiKeysService.revokeApiKey` | `ApiKey` | `api-keys/page.tsx` | IMPLEMENTED |
| `GET` | `/workspaces/:workspaceId/webhooks` | WebhooksModule | JWT | Required | `OWNER`, `ADMIN` | `WebhooksService.getWebhooks` | `OutboundWebhook` | `webhooks/page.tsx` | IMPLEMENTED |
| `POST`| `/workspaces/:workspaceId/webhooks` | WebhooksModule | JWT | Required | `OWNER`, `ADMIN` | `WebhooksService.createWebhook` | `OutboundWebhook` | `webhooks/page.tsx` | IMPLEMENTED |
| `DELETE`| `/workspaces/:workspaceId/webhooks/:id` | WebhooksModule | JWT | Required | `OWNER`, `ADMIN` | `WebhooksService.deleteWebhook` | `OutboundWebhook` | `webhooks/page.tsx` | IMPLEMENTED |
| `GET` | `/api/v1/workspaces/:workspaceId` | PublicApiModule | API Key | Required | All Roles | `WorkspacesService.getWorkspaceInfo` | `Workspace` | None | IMPLEMENTED |
| `GET` | `/api/v1/workspaces/:workspaceId/billing` | PublicApiModule | API Key | Required | `OWNER`, `ADMIN` | `BillingService.getBillingState` | `WorkspaceBalance` | None | IMPLEMENTED |
| `GET` | `/api/v1/workspaces/:workspaceId/usage` | PublicApiModule | API Key | Required | `OWNER`, `ADMIN` | `BillingService.getBillingState` | `UsageRecord` | None | IMPLEMENTED |
| `GET` | `/api/v1/workspaces/:workspaceId/blocked-numbers` | PublicApiModule | API Key | Required | All Roles | `BlockedCallersService.listBlockedCallers` | `BlockedCaller` | None | IMPLEMENTED |
| `POST`| `/api/v1/workspaces/:workspaceId/blocked-numbers` | PublicApiModule | API Key | Required | `OWNER`, `ADMIN` | `BlockedCallersService.blockCaller` | `BlockedCaller` | None | IMPLEMENTED |
| `DELETE`| `/api/v1/workspaces/:workspaceId/blocked-numbers/:id`| PublicApiModule | API Key | Required | `OWNER`, `ADMIN` | `BlockedCallersService.unblockCaller` | `BlockedCaller` | None | IMPLEMENTED |
| `GET` | `/api/v1/workspaces/:workspaceId/buyers` | PublicApiModule | API Key | Required | `buyer:read` | `BuyersService.listBuyers` | `Buyer` | None | IMPLEMENTED |
| `GET` | `/api/v1/workspaces/:workspaceId/buyers/:id` | PublicApiModule | API Key | Required | `buyer:read` (Scoped) | `BuyersService.getBuyer` | `Buyer` | None | IMPLEMENTED |
| `POST`| `/api/v1/workspaces/:workspaceId/buyers` | PublicApiModule | API Key | Required | `buyer:create` | `BuyersService.createBuyer` | `Buyer` | None | IMPLEMENTED |
| `GET` | `/api/v1/workspaces/:workspaceId/campaigns` | PublicApiModule | API Key | Required | `campaign:read` | `CampaignsService.listCampaigns` | `Campaign` | None | IMPLEMENTED |
| `GET` | `/api/v1/workspaces/:workspaceId/campaigns/:id` | PublicApiModule | API Key | Required | `campaign:read` (Scoped) | `CampaignsService.getCampaign` | `Campaign` | None | IMPLEMENTED |
| `POST`| `/api/v1/workspaces/:workspaceId/campaigns` | PublicApiModule | API Key | Required | `campaign:create` | `CampaignsService.createCampaign` | `Campaign` | None | IMPLEMENTED |
| `GET` | `/api/v1/workspaces/:workspaceId/calls` | PublicApiModule | API Key | Required | `call:read` | `CallsService.getCalls` | `Call` | None | IMPLEMENTED |
| `GET` | `/api/v1/workspaces/:workspaceId/calls/:id` | PublicApiModule | API Key | Required | `call:read` (Scoped) | `CallsService.getCallDetail` | `Call` | None | IMPLEMENTED |
| `GET` | `/api/v1/workspaces/:workspaceId/phone-numbers` | PublicApiModule | API Key | Required | `phone_number:read` | `PhoneNumbersService.listWorkspaceNumbers` | `PhoneNumber` | None | IMPLEMENTED |
| `GET` | `/api/v1/workspaces/:workspaceId/phone-numbers/search`| PublicApiModule | API Key | Required | All Roles | `PhoneNumbersService.searchAvailableNumbers`| None (Telnyx) | None | IMPLEMENTED |
| `POST`| `/api/v1/workspaces/:workspaceId/phone-numbers` | PublicApiModule | API Key | Required | `phone_number:create` | `PhoneNumbersService.provisionNumber` | `PhoneNumber` | None | IMPLEMENTED |
| `PUT` | `/api/v1/workspaces/:workspaceId/phone-numbers/:id` | PublicApiModule | API Key | Required | All Roles | `PhoneNumbersService.updateNumber` | `PhoneNumber` | None | IMPLEMENTED |
| `DELETE`| `/api/v1/workspaces/:workspaceId/phone-numbers/:id`| PublicApiModule | API Key | Required | All Roles | `PhoneNumbersService.releaseNumber` | `PhoneNumber` | None | IMPLEMENTED |
| `GET` | `/api/v1/workspaces/:workspaceId/recordings` | PublicApiModule | API Key | Required | All Roles | `prisma.recording.findMany` | `Recording` | None | IMPLEMENTED |
| `GET` | `/api/v1/workspaces/:workspaceId/recordings/:id` | PublicApiModule | API Key | Required | All Roles | Provider download URL | `Recording` | None | IMPLEMENTED |
| `POST`| `/workspaces/:workspaceId/call-commercials/:callCommercialId/dispute` | CommercialModule (`59da9de`) | JWT | Required | Authenticated Buyer | `CommercialDisputesService.createDispute` | `CallDispute` | None | IMPLEMENTED in baseline `59da9de` / MISSING in current HEAD |
| `POST`| `/workspaces/:workspaceId/disputes/:disputeId/resolve` | CommercialModule (`59da9de`) | JWT | Required | `OWNER`, `ADMIN` | `CommercialDisputesService.resolveDispute` | `CallDispute`, `CallFinancialAdjustment` | None | IMPLEMENTED in baseline `59da9de` / MISSING in current HEAD |
| `POST`| `/workspaces/:workspaceId/disputes/:disputeId/accept` | CommercialModule (`59da9de`) | JWT | Required | `OWNER`, `ADMIN` | `CommercialDisputesService.resolveDispute` | `CallDispute`, `CallFinancialAdjustment` | None | IMPLEMENTED in baseline `59da9de` / MISSING in current HEAD |
| `POST`| `/workspaces/:workspaceId/disputes/:disputeId/reject` | CommercialModule (`59da9de`) | JWT | Required | `OWNER`, `ADMIN` | `CommercialDisputesService.resolveDispute` | `CallDispute` | None | IMPLEMENTED in baseline `59da9de` / MISSING in current HEAD |
| `GET` | `/workspaces/:workspaceId/disputes/:disputeId` | CommercialModule (`59da9de`) | JWT | Required | Authenticated | `CommercialDisputesService.getDispute` | `CallDispute` | None | IMPLEMENTED in baseline `59da9de` / MISSING in current HEAD |
| `GET` | `/workspaces/:workspaceId/call-commercials/:callCommercialId/dispute` | CommercialModule (`59da9de`) | JWT | Required | Authenticated | `CommercialDisputesService.getDisputeByCallCommercial` | `CallDispute` | None | IMPLEMENTED in baseline `59da9de` / MISSING in current HEAD |

---

## 27. Complete Feature Matrix

| Feature | DB | Service | API | Tests | Frontend Consumer | Status in Current HEAD | Status in Frozen Baseline (`59da9de`) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Calls** | YES | YES | YES | YES | YES | IMPLEMENTED | IMPLEMENTED |
| **Call Attempts** | YES | YES | Included in Call Detail | YES | YES | IMPLEMENTED | IMPLEMENTED |
| **Routing** | YES | YES | YES | YES | YES | IMPLEMENTED | IMPLEMENTED |
| **Campaigns** | YES | YES | YES | YES | YES | IMPLEMENTED | IMPLEMENTED |
| **Buyers** | YES | YES | YES | YES | YES | IMPLEMENTED | IMPLEMENTED |
| **Vendors** | YES | YES | YES | YES | YES | IMPLEMENTED | IMPLEMENTED |
| **Tracking Numbers** | YES | YES | YES | YES | YES | IMPLEMENTED | IMPLEMENTED |
| **Number Pools** | NO | NO | NO | NO | NO | MISSING | MISSING |
| **Destinations** | Stored on Buyer | Stored on Buyer | Stored on Buyer | YES | YES | IMPLEMENTED (as Buyer) | IMPLEMENTED (as Buyer) |
| **Blocked Callers** | YES | YES | YES | YES | YES | IMPLEMENTED | IMPLEMENTED |
| **Recordings** | YES | YES | YES | YES | YES | IMPLEMENTED | IMPLEMENTED |
| **Reporting (KPIs & Logs)**| YES | YES | YES | YES | YES | IMPLEMENTED | IMPLEMENTED |
| **Reporting (Saved Reports)**| YES | YES | YES | YES | YES | IMPLEMENTED | IMPLEMENTED |
| **Reporting (Binary Export)**| YES | YES | YES | YES | YES | IMPLEMENTED | IMPLEMENTED |
| **Revenue** | NO | NO | NO | NO | NO | MISSING | IMPLEMENTED (in `CallCommercial`) |
| **Payout** | NO | NO | NO | NO | NO | MISSING | IMPLEMENTED (in `CallCommercial`) |
| **Profit** | NO | NO | NO | NO | NO | MISSING | IMPLEMENTED (in `CallCommercial`) |
| **Cost (Commercial Snapshot)**| NO | NO | NO | NO | NO | MISSING | IMPLEMENTED (in `CallCommercial`) |
| **Converted** | NO | NO | NO | NO | NO | MISSING | IMPLEMENTED (in `CallCommercial`) |
| **Qualified** | NO | NO | NO | NO | NO | MISSING | IMPLEMENTED (in `CallCommercial`) |
| **Duplicate** | NO | NO | NO | NO | NO | MISSING | IMPLEMENTED (in `CallCommercial`) |
| **Disputes** | NO | NO | NO | NO | NO | MISSING | IMPLEMENTED (`CommercialDisputesController`) |
| **Settlement Generation** | NO | NO | NO | NO | NO | MISSING | SERVICE_ONLY (`SettlementBatchService`) |
| **Settlement Items** | NO | NO | NO | NO | NO | MISSING | SERVICE_ONLY (`SettlementItem`) |
| **Payment Instructions** | NO | NO | NO | NO | NO | MISSING | DATABASE_ONLY (`PaymentInstruction`) |
| **Payment Execution** | NO | NO | NO | NO | NO | MISSING | DATABASE_ONLY (`PaymentExecution`) |
| **Reconciliation Engine** | NO | NO | NO | NO | NO | MISSING | DATABASE_ONLY (`ReconciliationRun`) |
| **Billing (Stripe Subscriptions)**| YES | YES | YES | YES | YES | IMPLEMENTED | IMPLEMENTED |
| **Usage Records** | YES | YES | YES (via Billing) | YES | YES | IMPLEMENTED | IMPLEMENTED |
| **Micro-Dollar Wallet** | YES | YES | YES | YES | YES | IMPLEMENTED | IMPLEMENTED |
| **API Keys** | YES | YES | YES | YES | YES | IMPLEMENTED | IMPLEMENTED |
| **Outbound Webhooks** | YES | YES | YES | YES | YES | IMPLEMENTED | IMPLEMENTED |
| **Telnyx Integration** | YES | YES | YES | YES | Carrier Ingestion | IMPLEMENTED | IMPLEMENTED |
| **Twilio Integration** | YES | YES | YES | YES | Carrier Ingestion | IMPLEMENTED | IMPLEMENTED |
| **IVR** | NO | NO | NO | NO | NO | MISSING | MISSING |
| **Geographic Routing** | NO | NO | NO | NO | NO | MISSING | MISSING |
| **Time Routing** | NO | NO | NO | NO | NO | MISSING | MISSING |
| **Round Robin Routing** | NO | NO | NO | NO | NO | MISSING | MISSING |
| **Bidding / Auction** | NO | NO | NO | NO | NO | MISSING | MISSING |
| **Call Flow Builder** | NO | NO | NO | NO | NO | MISSING | MISSING |

---

## 28. Known Unknowns

1. **Carrier Porting & Regulatory Verification**: The backend initiates Telnyx number provisioning via Call Control Application orders, but porting workflows and regulatory identity documents are unverified.
2. **Production Telnyx Key Handling**: Code contains an explicit fallback accepting unverified webhook payloads when `TELNYX_PUBLIC_KEY` is omitted. Behavior in staging/production depends on environment injection.
3. **Database Performance Under High Call Concurrency**: `SELECT FOR UPDATE` row-level locks on `calls` prevent state corruptions, but throughput under thousands of simultaneous webhook callbacks per second has not been load-tested.

---

## 29. Final Backend Status

- **Telephony & Routing**: **OPERATIONAL & VERIFIED**. Stable Telnyx carrier integration, sequential priority waterfall dialing, live call bridging, call recording, and real-time wallet holds.
- **Reporting Foundation**: **OPERATIONAL & VERIFIED**. Full KPI aggregation, time-series breakdown, live call counter, multi-criteria call log filtering, saved reports, and binary export generation.
- **Commercial & Settlement (Current HEAD)**: **NOT MERGED / ABSENT**. All commercial and settlement files reside on ancestor branch commits (`agent/commercial-comm14-settlement-generation` at `59da9de`) and are not present in current branch `agent/reporting-backend-fix`.
- **Commercial & Settlement (Frozen Baseline `59da9de`)**:
  - Commercial Evaluator: **IMPLEMENTED** (duration conversion, duplicate flag, cost resolution from wallet debit, profit arithmetic).
  - Disputes: **IMPLEMENTED** (reversal to 0, cost preserved, profit=-cost, status ADJUSTED).
  - Settlement Generation: **SERVICE ONLY** (eligible queries, 168h maturity check, [period_start, period_end) interval, concurrency retries).
  - Commercial Finalization: **PARTIAL / BROKEN** (`CommercialEvaluatorService` sets `finalizes_at: null, status: PENDING`; no transition engine exists to mature calls to `FINAL`).
  - Payments & Reconciliation: **SCHEMA ONLY** (modeled in Prisma, zero execution logic).
