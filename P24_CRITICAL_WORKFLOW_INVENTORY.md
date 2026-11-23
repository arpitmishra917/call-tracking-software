# CALLFLOW P2.4 — WORKSTREAM A: CRITICAL CUSTOMER WORKFLOW INVENTORY
## Comprehensive Forensic Mapping, Operational Status & Vulnerability Assessment

**Document ID:** `P24_CRITICAL_WORKFLOW_INVENTORY`  
**Execution Date:** November 23, 2026  
**Milestone:** CallFlow Phase 2: P2.4 Regression Testing & Protection  
**Workstream Owner:** Workstream A Baseline Specialist (`@baseline`)  
**Scope:** Exhaustive evaluation of all 12 Critical Customer Workflow Areas (A through L)  

---

## 1. Executive Summary & Taxonomy

Every critical customer workflow within CallFlow has been audited from database schema, transactional semantics, backend service and controller logic, frontend UI/UX representation, and automated test coverage. Each workflow area is assigned one of the 5 canonical lifecycle classifications:

```
  WORKING            : Feature is fully implemented, verified in test suites, and operates reliably.
  PARTIALLY WORKING  : Core functionality works, but an integration gap or non-blocking limitation exists.
  NOT IMPLEMENTED    : Architecture or specification exists, but executable code/UI is absent.
  KNOWN DEFECT       : Identified functional defect or architectural vulnerability confirmed in code.
  UNKNOWN            : Cannot be verified without third-party external production dependencies.
```

### Critical Customer Workflow Classification Matrix

| Area | Customer Workflow Domain | Status | Business & Operational Impact | Primary Test Protection |
| :---: | :--- | :---: | :--- | :--- |
| **A** | **Inbound Call Ingestion & Waterfall Priority Routing** | **`WORKING`** | Inbound caller connects to highest priority active buyer; falls back seamlessly on timeout/busy/reject. | `routing.spec.ts`, `campaign-routing.spec.ts`, `p22-b` |
| **B** | **Buyer Concurrency Limits & Multi-Destination Allocation** | **`WORKING`** | Enforces active concurrent call caps per buyer organization and destination using row locks. | `buyer-concurrency.spec.ts`, `p22-b.integration.spec.ts` |
| **C** | **Provider Inbound Webhook Idempotency & Deduplication** | **`WORKING`** | Deflects duplicate Telnyx/Twilio webhook deliveries; leases events with fencing tokens. | `webhook-concurrency-postgres.integration.spec.ts` |
| **D** | **Inbound Call State Machine Lifecycle & Out-of-Order Handling** | **`WORKING`** | Strict state engine (`INITIATED` $\to$ `COMPLETED`); handles out-of-order provider webhooks safely. | `calls.spec.ts`, `telephony.spec.ts` |
| **E** | **Multi-Tenant Wallet Balance, Real-Time Holds & Debit Integrity** | **`PARTIALLY WORKING`** | Micro-dollar holds placed pre-bridge and settled post-call; frontend mock button exposed in prod. | `wallet.service.spec.ts`, `p22-a.integration.spec.ts` |
| **F** | **Commercial Evaluation, Margin Calculation & Rate Attribution** | **`WORKING`** | Applies talk duration thresholds, duplicate window rules, and creates locked commercial ledger. | `commercial-evaluator.spec.ts`, `p22-d.integration.spec.ts` |
| **G** | **168-Hour Commercial Financial Maturity & JIT Finalization** | **`WORKING`** | Commercial items remain `PENDING` for exactly 7 days before finalization or settlement batching. | `p22-d-commercial-lifecycle-maturity.integration.spec.ts` |
| **H** | **Settlement Batch Generation & Unique Constraint Accounting** | **`WORKING`** | Generates idempotent settlement batches and items; database unique constraints prevent duplicates. | `p22-e-settlement-generation-uniqueness.integration.spec.ts` |
| **I** | **Commercial Disputes Filing, Freezing & Resolution** | **`KNOWN DEFECT`** | Dispute freezes payout/settlement; frontend queries calls with limit=100 causing dispute loss. | `commercial-disputes.spec.ts`, `p22-f.integration.spec.ts` |
| **J** | **Zero-Cost Completed Calls & Operational Threshold Rules** | **`WORKING`** | Below-threshold calls complete without charging caller wallet or paying vendor. | `calls.service.spec.ts`, `commercial-evaluator.spec.ts` |
| **K** | **Multi-Tenant Workspace Boundary Isolation & RBAC Security** | **`WORKING`** | Full isolation via JWT, workspace roles, and compound database queries `{ id, workspace_id }`. | `p23-a`, `p23-b`, `p23-c.integration.spec.ts` |
| **L** | **Developer Public API Gateway, DTO Validation & Outbound Webhooks** | **`PARTIALLY WORKING`** | Public REST API v1, API key hashing, and outbound HMAC webhooks; safe-fetch DNS TOCTOU risk. | `public-recordings.spec.ts`, `safe-validation.pipe.spec.ts` |

---

## 2. Detailed Workflow Forensics (Areas A through L)

---

### Workflow Area A: Inbound Call Ingestion & Waterfall Priority Routing
- **Status:** **`WORKING`**
- **Customer Use-Case:** A tenant purchases a tracking phone number, associates it with a campaign, and defines a prioritized waterfall cascade of buyers. When a customer dials the tracking number, CallFlow checks the blocklist, retrieves the campaign, selects the highest-priority available buyer, and dials the buyer. If the buyer is busy, times out, or fails, the call cascades to the next buyer in priority order.
- **Architecture & Data Flow:**
  1. Inbound Telnyx Call Control event (`call.initiated`) arrives at `TelnyxWebhookController.handleWebhook`.
  2. `BlockedCallersService.isBlocked` checks caller CLI against tenant blocklist. If blocked, emits fast hangup.
  3. `PhoneNumber` record resolves to active `Campaign`.
  4. `CampaignsService.getOrderedWaterfall` selects active destination numbers ordered by `priority ASC, weight DESC`.
  5. `CallsService.prepareNextBuyer` initiates sequential buyer attempt (`CallAttempt`), creates a buyer reservation, and dials destination.
  6. First buyer to answer claims the call; remaining waterfall candidates are never attempted.
- **Database Entities:** `PhoneNumber`, `Campaign`, `Buyer`, `DestinationNumber`, `CampaignBuyer`, `BlockedCaller`, `Call`, `CallAttempt`.
- **Backend Endpoints:**
  - `POST /api/webhooks/telnyx`
  - `GET /workspaces/:id/campaigns`, `POST /workspaces/:id/campaigns`, `PUT /workspaces/:id/campaigns/:id`
  - `POST /workspaces/:id/campaigns/:id/buyers`, `PUT /workspaces/:id/campaigns/:id/buyers/reorder`
- **Frontend Pages:**
  - `/protected/campaigns`: Campaign list, status toggles, rate configuration.
  - `/protected/campaigns/[campaignId]`: Waterfall priority table, up/down drag reordering, destination number assignment.
- **Test Evidence:**
  - Unit: `routing/routing.spec.ts`, `routing/campaign-routing.spec.ts`, `routing/blocked-callers.service.spec.ts`.
  - Integration: `test/p22-b-buyer-concurrency-routing.integration.spec.ts`.
- **Known Edge Cases & Risks:**
  - Real carrier PSTN routing requires active carrier DID and Telnyx Call Control Application credentials. Live carrier E2E is verified for provisioning; campaign routing relies on mock provider during CI.

---

### Workflow Area B: Buyer Concurrency Limits & Multi-Destination Allocation
- **Status:** **`WORKING`**
- **Customer Use-Case:** A buyer organization specifies a maximum concurrent call limit (e.g. 5 concurrent calls across their call center, or 1 call per destination agent). CallFlow enforces these limits under high-volume call spikes, preventing call center overload and routing overflow calls to secondary buyers.
- **Architecture & Data Flow:**
  1. During candidate evaluation in `CallsService.prepareNextBuyer`, CallFlow executes atomic PostgreSQL row locking:
     `SELECT * FROM "DestinationNumber" WHERE id = $1 FOR UPDATE`
     `SELECT * FROM "Buyer" WHERE id = $1 FOR UPDATE`
  2. Evaluates `active_calls < max_concurrent_calls` for both the individual destination number and the aggregate buyer organization.
  3. If capacity exists, increments `active_calls` within the transaction, creates `BuyerReservation` (`status = 'ACTIVE'`), and proceeds to dial.
  4. If capacity is saturated, the destination is skipped, and the routing engine evaluates the next candidate in the waterfall cascade.
  5. When the call terminates (`call.hangup`), atomic decrement releases capacity:
     `UPDATE "DestinationNumber" SET active_calls = GREATEST(0, active_calls - 1)`
     `UPDATE "Buyer" SET active_calls = GREATEST(0, active_calls - 1)`
  6. `ReservationRecoveryService` sweeps unfinalized reservations older than 900s to self-heal stale allocations.
- **Database Entities:** `Buyer`, `DestinationNumber`, `BuyerReservation`, `CallAttempt`.
- **Backend Endpoints:** `POST /workspaces/:id/buyers`, `PUT /workspaces/:id/buyers/:id`.
- **Frontend Pages:**
  - `/protected/buyers`: Buyer list with active concurrency counters and status badges.
  - `/protected/buyers/[buyerId]`: Concurrency limit inputs (`max_concurrent_calls`), destination numbers management.
- **Test Evidence:**
  - Unit: `routing/buyer-concurrency.spec.ts`, `telephony/buyer-timeout-race.spec.ts`, `telephony/reservation-recovery.service.spec.ts`.
  - Integration: `test/p22-b-buyer-concurrency-routing.integration.spec.ts` (5/5 tests passing).
- **Known Edge Cases & Risks:**
  - Sudden worker node crash during active call: `ReservationRecoveryService` background cron resolves orphan reservations after 15 minutes.

---

### Workflow Area C: Provider Inbound Webhook Idempotency & Deduplication
- **Status:** **`WORKING`**
- **Customer Use-Case:** Telephony carriers (Telnyx, Twilio, Stripe) frequently retry webhook event deliveries due to transient network latency or timeouts. CallFlow must deflect duplicate webhook deliveries, guarantee exactly-once business processing, and prevent race conditions between parallel webhooks.
- **Architecture & Data Flow:**
  1. Inbound webhook payload arrives with carrier event identifier (e.g., Telnyx `event_id`).
  2. `WebhookIdempotencyService.acquireLease` performs atomic upsert in `WebhookEvent`:
     - Inserts record with `status = 'PENDING'`, timestamp, and unique UUID `leaseToken`.
     - If record already exists with `status = 'PROCESSED'`, the event is immediately deflected (`canProcess: false`).
     - If record exists with `status = 'PENDING'` and `updated_at > NOW() - 300s`, the concurrent attempt is deflected.
     - If record is stuck in `PENDING` for > 300s (stale worker death), optimistic locking acquires a new `leaseToken` and allows reprocessing.
  3. Processing finishes: `releaseLease` transitions status to `PROCESSED` using `leaseToken` fencing. Any late worker with an expired token is blocked from modifying state.
- **Database Entities:** `WebhookEvent`.
- **Backend Endpoints:** `POST /api/webhooks/telnyx`, `POST /api/webhooks/twilio`, `POST /webhooks/stripe`.
- **Frontend Pages:** `N/A` (Inbound provider gateway).
- **Test Evidence:**
  - Unit: `telephony/webhook-idempotency.service.spec.ts`, `webhooks/webhooks.service.spec.ts`.
  - Integration: `test/webhook-concurrency-postgres.integration.spec.ts` (4/4 tests passing in real PostgreSQL).
- **Known Edge Cases & Risks:**
  - Carrier events with missing event IDs fallback to synthetic payload hashing (`sha256(call_id + event_type + timestamp)`).

---

### Workflow Area D: Inbound Call State Machine Lifecycle & Out-of-Order Handling
- **Status:** **`WORKING`**
- **Customer Use-Case:** Inbound telephony events can arrive out of order across distributed networks (e.g. `call.hangup` arriving before `call.answered`). CallFlow maintains a robust state machine that rejects invalid backward transitions and gracefully handles out-of-order terminations without data corruption.
- **Architecture & Data Flow:**
  1. Valid transitions:
     `INITIATED` $\to$ `ROUTING` $\to$ `RINGING` $\to$ `ANSWERED` $\to$ `COMPLETED`
     Any state $\to$ `FAILED` / `CANCELED` / `BUSY` / `NO_ANSWER`.
  2. Terminal states (`COMPLETED`, `FAILED`, `CANCELED`, `BUSY`, `NO_ANSWER`) are immutable. Once reached, late arriving events cannot mutate call state.
  3. If `COMPLETED` or `HANGUP` arrives while call is in `ROUTING` or `RINGING`, CallFlow computes duration from recorded timestamps and transitions directly to terminal state.
- **Database Entities:** `Call`, `CallAttempt`, `Recording`.
- **Backend Endpoints:** `GET /workspaces/:id/calls`, `GET /workspaces/:id/calls/:callId`, `GET /workspaces/:id/calls/live-calls`.
- **Frontend Pages:**
  - `/protected/calls`: Call log table with state badges (`COMPLETED` green, `FAILED` red, `NO_ANSWER` yellow), duration timestamps, caller CLI.
  - `/protected/calls/[callId]`: Deep call inspection, attempts timeline, talk duration vs lifetime duration display.
- **Test Evidence:**
  - Unit: `calls/calls.spec.ts`, `telephony/telephony.spec.ts`, `telephony/telnyx-callflow.spec.ts`.
  - Integration: `test/multi-workspace-isolation.integration.spec.ts`.
- **Known Edge Cases & Risks:**
  - Carrier ringback cadence timing edge cases tested in `telephony/us-ringback-cadence.spec.ts`.

---

### Workflow Area E: Multi-Tenant Wallet Balance, Real-Time Holds & Debit Integrity
- **Status:** **`PARTIALLY WORKING`**
- **Customer Use-Case:** Workspace operates on prepaid or balance-capped terms. Inbound calls verify sufficient balance, place a pre-bridge monetary reservation hold, debit the exact micro-dollar amount upon call completion, or release the hold if the call abandons or fails.
- **Architecture & Data Flow:**
  1. `WalletService.createReservationHold`: Verifies workspace balance $\ge$ required hold ($5.00 default = 5,000,000 micro-dollars).
  2. Atomically increments `reserved_balance_micro` within database transaction:
     `UPDATE "Workspace" SET reserved_balance_micro = reserved_balance_micro + $1 WHERE id = $2 AND balance_micro - reserved_balance_micro >= $1`
  3. If balance is insufficient, call is rejected with `INSUFFICIENT_FUNDS` without bridging to buyer.
  4. On call completion, `WalletService.settleReservation` calculates actual cost (talk duration $\times$ per-minute rate), debits `balance_micro`, releases `reserved_balance_micro`, and creates an immutable `WalletTransaction` audit entry.
  5. If call duration is zero or call fails, `releaseReservationHold` zeroes the hold with no debit.
- **Database Entities:** `Workspace`, `WalletTransaction`, `WalletReservation`.
- **Backend Endpoints:**
  - `GET /workspaces/:id/billing`, `GET /workspaces/:id/billing/balance`, `GET /workspaces/:id/billing/wallet/transactions`
  - `POST /workspaces/:id/billing/wallet/mock-topup`
- **Frontend Pages:**
  - `/protected/billing`: Wallet balance display (micro-dollar precision formatted to USD), ledger transaction history table, Stripe top-up modal.
- **Test Evidence:**
  - Unit: `billing/wallet.service.spec.ts`, `billing/billing.service.spec.ts`.
  - Integration: `test/p22-a-wallet-financial-integrity.integration.spec.ts` (6/6 tests passing in PostgreSQL).
- **Identified Defect & Risk (`PARTIALLY WORKING`):**
  - **`GAP-P1-01`**: `PaymentService.createExecution()` accepts `provider: 'mock'` without checking `process.env.NODE_ENV === 'production'`. In production, simulated payments could mutate financial batches.
  - **`GAP-P1-02`**: In `apps/web/src/app/protected/billing/page.tsx:160-194`, the *"Add Mock Funds"* card is displayed unconditionally without checking environment. In production, clicking it triggers a 403 Forbidden alert from the backend guard.

---

### Workflow Area F: Commercial Evaluation, Margin Calculation & Rate Attribution
- **Status:** **`WORKING`**
- **Customer Use-Case:** CallFlow computes the wholesale financial economics for every completed call: revenue charged to buyer, payout owed to vendor, carrier telephony costs, and gross margin profit.
- **Architecture & Data Flow:**
  1. `CommercialEvaluatorService.evaluateCall`: Triggered immediately upon call completion.
  2. Verifies connected talk duration $\ge$ campaign conversion threshold (e.g. 60 seconds).
  3. Enforces duplicate call detection within campaign buffer window using 64-bit PostgreSQL advisory locking (`getDuplicateScopeAdvisoryLockKey`). Duplicate calls within buffer window are marked non-billable (`is_duplicate = true, billable = false`).
  4. Calculates financial breakdown in micro-dollars:
     - `revenue_micro = buyer_rate`
     - `payout_micro = vendor_rate`
     - `operational_cost_micro = telnyx_rate`
     - `margin_micro = revenue_micro - payout_micro - operational_cost_micro`
  5. Creates immutable `CallCommercial` record with initial status `PENDING`.
- **Database Entities:** `CallCommercial`, `Call`, `Campaign`, `Buyer`, `Vendor`.
- **Backend Endpoints:** Embedded within `GET /workspaces/:id/calls/:callId` and `GET /workspaces/:id/reporting`.
- **Frontend Pages:**
  - `/protected/calls/[callId]`: Commercial financial summary card (Revenue, Payout, Cost, Margin/Profit).
  - `/protected/reporting`: Aggregated financial metrics across workspace, campaigns, and buyers.
- **Test Evidence:**
  - Unit: `commercial/commercial-evaluator.spec.ts` (34 tests passing).
  - Integration: `test/p22-d-commercial-lifecycle-maturity.integration.spec.ts`.
- **Known Edge Cases & Risks:**
  - Zero operational cost calls (AD-03) verified: zero-cost calls under duration threshold defer commercial evaluation cleanly.

---

### Workflow Area G: 168-Hour Commercial Financial Maturity & JIT Finalization
- **Status:** **`WORKING`**
- **Customer Use-Case:** Financial regulations and dispute periods require completed calls to mature for exactly 168 hours (7 days) before funds become final and eligible for vendor settlement disbursements.
- **Architecture & Data Flow:**
  1. `CallCommercial` records are created in `PENDING` state.
  2. Deterministic 168-Hour Maturity Clock:
     `mature_at = call.ended_at + 168 hours (604,800,000 ms)`
  3. Status remains `PENDING` while `NOW() < mature_at`.
  4. Once 168 hours elapse, `CommercialFinalizationService.processFinalizationBatch` transitions eligible records from `PENDING` $\to$ `FINALIZED`.
  5. Any call with an open dispute (`status = 'PENDING'` in `CallDispute`) is strictly blocked from finalization until the dispute is resolved.
  6. Just-In-Time (JIT) Finalization: If a settlement batch is generated, CallFlow executes JIT finalization for any calls whose maturity clock has passed.
- **Database Entities:** `CallCommercial`, `CallDispute`.
- **Backend Endpoints:** Background cron job; JIT triggered via `POST /workspaces/:id/settlements/batches/generate`.
- **Frontend Pages:** `/protected/settlements`: Settlement batch preparation workbench.
- **Test Evidence:**
  - Unit: `commercial/commercial-finalization.spec.ts`.
  - Integration: `test/p22-d-commercial-lifecycle-maturity.integration.spec.ts` (6/6 tests passing in PostgreSQL).
- **Known Edge Cases & Risks:**
  - Clock skew and boundary conditions: System enforces `c.mature_at <= NOW()` using server database timestamps (`NOW() AT TIME ZONE 'UTC'`).

---

### Workflow Area H: Settlement Batch Generation & Unique Constraint Accounting
- **Status:** **`WORKING`**
- **Customer Use-Case:** At the end of a billing cycle (weekly/monthly), workspace owners generate settlement batches grouping all finalized commercial calls for buyers (invoices/receivables) and vendors (payouts/disbursements).
- **Architecture & Data Flow:**
  1. Owner submits `POST /workspaces/:id/settlements/batches/generate` with `period_start`, `period_end`, and `participant_type` (`BUYER` or `VENDOR`).
  2. Validates `period_start < period_end`.
  3. Queries all `FINALIZED` `CallCommercial` records within date boundaries not yet assigned to an existing settlement batch.
  4. Inserts `SettlementBatch` with sequential `batch_number`:
     - Database enforces `SettlementBatch @@unique([workspace_id, batch_number])`.
  5. Inserts `SettlementItem` rows linking each call commercial record to the batch:
     - Database enforces `SettlementItem @@unique([call_commercial_id, participant_type])`, guaranteeing zero double-billing or duplicate payouts.
  6. Computes aggregate `gross_amount_micro`, `deductions_micro`, and `net_amount_micro`.
- **Database Entities:** `SettlementBatch`, `SettlementItem`, `CallCommercial`.
- **Backend Endpoints:**
  - `POST /workspaces/:id/settlements/batches/generate`
  - `GET /workspaces/:id/settlements/batches`
  - `GET /workspaces/:id/settlements/batches/:batchId`
  - `GET /workspaces/:id/settlements/batches/:batchId/items`
- **Frontend Pages:**
  - `/protected/settlements`: Settlement batches table, "Generate Batch" modal with date picker, line-item drawer.
- **Test Evidence:**
  - Unit: `settlement/settlement.controller.spec.ts`, `settlement/payment.service.spec.ts`.
  - Integration: `test/p22-e-settlement-generation-uniqueness.integration.spec.ts` (4/4 tests passing in PostgreSQL).
- **Known Edge Cases & Risks:**
  - Concurrent generation race: Database unique constraint on `[workspace_id, batch_number]` and `[call_commercial_id, participant_type]` causes duplicate worker to fail closed with PostgreSQL unique violation (code `23505`), preserving financial ledger integrity.

---

### Workflow Area I: Commercial Disputes Filing, Freezing & Resolution
- **Status:** **`KNOWN DEFECT`**
- **Customer Use-Case:** A buyer or workspace owner contests a call (e.g. fraudulent caller, dropped media, wrong audio). Filing a dispute freezes the call from finalization and settlement. Resolving the dispute adjusts the commercial amounts and wallet balance.
- **Architecture & Data Flow:**
  1. Authorized user submits `POST /workspaces/:id/call-commercials/:id/dispute` with reason and notes.
  2. Transaction links `CallDispute` to `CallCommercial`, sets `CallDispute.status = 'PENDING'`, and freezes maturity finalization.
  3. Owner/Admin reviews dispute on Disputes workbench and resolves via `POST /workspaces/:id/disputes/:id/resolve`:
     - If `ACCEPTED`: `CallCommercial.status` becomes `ADJUSTED`, revenue and payout are zeroed or credited back via `WalletTransaction`.
     - If `REJECTED`: `CallCommercial.status` reverts to `PENDING` (or `FINALIZED` if 168h elapsed).
- **Database Entities:** `CallDispute`, `CallCommercial`, `WalletTransaction`.
- **Backend Endpoints:**
  - `POST /workspaces/:id/call-commercials/:id/dispute`
  - `POST /workspaces/:id/disputes/:id/resolve`
  - `GET /workspaces/:id/disputes/:id`
- **Frontend Pages:**
  - `/protected/disputes`: Disputes workbench with status tabs (`ALL`, `PENDING`, `ACCEPTED`, `REJECTED`) and Accept/Reject modals.
  - `/protected/calls/[callId]`: Dispute filing modal on individual call record.
- **Identified Defect (`KNOWN DEFECT`):**
  - **`BUG-FE-001` / `GAP-P2-01`**: The backend lacks a dedicated `GET /workspaces/:id/disputes` workspace-level query endpoint.
  - In `apps/web/src/app/protected/disputes/page.tsx:101-115`, the workbench fetches `GET /workspaces/:id/calls?limit=100` and filters client-side where `c.commercial?.dispute`.
  - **Consequence:** In workspaces with >100 historical calls, disputes on call #101 or older silently disappear from the disputes workbench!
- **Test Evidence:**
  - Unit: `commercial/commercial-disputes.spec.ts`.
  - Integration: `test/p22-f-commercial-disputes-reconciliation.integration.spec.ts` (5/5 tests passing in PostgreSQL).

---

### Workflow Area J: Zero-Cost Completed Calls & Operational Threshold Rules
- **Status:** **`WORKING`**
- **Customer Use-Case:** Calls that complete with zero duration (e.g. carrier immediate drop, caller hangup during early media) or below the conversion threshold must not incur buyer billing, vendor payout, or corrupted commercial ledger state.
- **Architecture & Data Flow:**
  1. `CallsService.finalizeCall`: Computes `talk_duration_secs = ended_at - answered_at`.
  2. If `talk_duration_secs <= 0` or call was not answered:
     - `UsageBillingService.billUsage` releases the wallet reservation hold without charging funds.
     - `CommercialEvaluatorService.evaluateCall` recognizes zero talk duration and returns `null` or records zero revenue/payout.
  3. If duration is positive but below campaign conversion threshold (e.g. 15s when threshold is 60s):
     - Carrier minute usage is metered.
     - Buyer charge and vendor payout are evaluated according to campaign commercial rules (no conversion = $0 payout).
  4. Reporting dashboards format zero duration as `00:00` and unattempted durations as `—` (dash) without crashing.
- **Database Entities:** `Call`, `CallCommercial`, `UsageRecord`, `WalletReservation`.
- **Backend Endpoints:** `POST /api/webhooks/telnyx`, `GET /workspaces/:id/calls`.
- **Frontend Pages:** `/protected/calls`, `/protected/reporting`.
- **Test Evidence:**
  - Unit: `calls/calls.spec.ts`, `commercial/commercial-evaluator.spec.ts`, `billing/usage-billing.service.spec.ts`.
  - Integration: `test/p22-a-wallet-financial-integrity.integration.spec.ts`.
- **Known Edge Cases & Risks:**
  - Nullish duration handling in frontend reporting dashboard verified intact with nullish coalescing operators (`stats.failed ?? 0`).

---

### Workflow Area K: Multi-Tenant Workspace Boundary Isolation & RBAC Security
- **Status:** **`WORKING`**
- **Customer Use-Case:** Multi-tenant SaaS security guarantees that Workspace A users can never view, mutate, or access Workspace B data (Broken Object Level Authorization / Insecure Direct Object References). Role-Based Access Control guarantees users operate strictly within assigned role permissions.
- **Architecture & Data Flow:**
  1. Authentication: Supabase Auth JWT tokens verified via HS256 local secret or Supabase JWKS public keys in `JwtStrategy`.
  2. Tenant Derivation: Active workspace is extracted from route parameters (`:workspaceId`) or `x-workspace-id` header, verified against `WorkspaceMember` records.
  3. Guards: All 37 controllers guarded with `JwtAuthGuard`, `WorkspaceRolesGuard`, and `PermissionsGuard`:
     - Role Hierarchy: `OWNER` > `ADMIN` > `MEMBER` > `VIEWER` > `VENDOR` / `BUYER`.
     - Owner Escalation Defense: Users cannot promote themselves or modify owner roles.
     - Participant Scoping: `VENDOR` and `BUYER` roles cannot perform administrative or financial mutations.
  4. Database Query Compound Scoping: Every Prisma query explicitly includes `{ id, workspace_id: workspaceId }` or raw SQL `AND workspace_id = $1`.
- **Database Entities:** `Workspace`, `WorkspaceMember`, `Profile`, `Permission`.
- **Backend Endpoints:** Applied across all 120 endpoints in the API.
- **Frontend Pages:** All 35+ routes in `apps/web` guarded by `WorkspaceValidator` and render-time identity guards.
- **Test Evidence:**
  - Unit: `permissions/permissions.controller.spec.ts`, `permissions/permissions.service.spec.ts`, `auth/controller-authorization.spec.ts`.
  - Integration:
    * `test/p23-a-cross-workspace-bola-idor.integration.spec.ts` (9/9 tests passing).
    * `test/p23-b-auth-rbac-rejection.integration.spec.ts` (9/9 tests passing).
    * `test/p23-c-mass-assignment-safe-query.integration.spec.ts` (26/26 tests passing).
    * `test/multi-workspace-isolation.integration.spec.ts` (8/8 tests passing).
- **Known Edge Cases & Risks:**
  - Zero cross-workspace leakage detected across all audited controllers.

---

### Workflow Area L: Developer Public API Gateway, DTO Validation & Outbound Webhooks
- **Status:** **`PARTIALLY WORKING`**
- **Customer Use-Case:** Tenants integrate programmatic workflows via the Developer Public REST API v1 (`/api/v1/workspaces/...`) using scoped API keys, receive real-time outbound webhooks upon call completion, and submit strictly validated input payloads.
- **Architecture & Data Flow:**
  1. Public API v1:
     - Endpoints under `/api/v1/workspaces/:workspaceId/*` protected by `ApiKeyAuthGuard`.
     - Validates prefix and SHA-256 hash of API key against `ApiKey` table.
     - Strict rate limits and workspace boundaries enforced.
  2. Global Input Validation:
     - `SafeValidationPipe` enforces `whitelist: true`, `forbidNonWhitelisted: true`, and strips protected fields (`workspace_id`, `role`, `permissions`, `balance_micro`).
     - `SafePaginationPipe` enforces limits (1–100) and offset bounds.
  3. Outbound Customer Webhooks:
     - Dispatched upon call completion.
     - Workers acquire atomic lock in `WebhookDelivery`, encrypt payloads, sign payloads with HMAC-SHA256, and retry with exponential backoff.
- **Database Entities:** `ApiKey`, `OutboundWebhook`, `WebhookDelivery`.
- **Backend Endpoints:**
  - `/api/v1/workspaces/:workspaceId/calls`, `/buyers`, `/campaigns`, `/phone-numbers`, `/recordings`, `/usage`, `/billing`
  - `/workspaces/:workspaceId/webhooks`
- **Frontend Pages:**
  - `/protected/api-keys`: API key creation modal, secret reveal card, revocation trigger.
  - `/protected/webhooks`: Outbound webhook subscription manager, test delivery triggers.
- **Identified Defect & Risk (`PARTIALLY WORKING`):**
  - **`BUG-SEC-001`**: SSRF protection in `safe-fetch.ts` resolves IP before fetch, leaving a potential TOCTOU DNS rebinding vulnerability.
  - **`GAP-P2-02`**: Security audit log explorer (`GET /workspaces/:id/audit-logs`) is fully implemented in the backend, but completely absent from the frontend UI.
  - **`GAP-P3-01`**: Workspace suspension (`PUT /workspaces/:id/status`) is supported in backend for owners, but the frontend settings page lacks a Danger Zone toggle.
- **Test Evidence:**
  - Unit: `common/pipes/safe-validation.pipe.spec.ts`, `common/pipes/safe-pagination.pipe.spec.ts`, `common/dto/dto-security.spec.ts`, `webhooks/webhooks.service.spec.ts`.
  - Integration: `test/p23-c-mass-assignment-safe-query.integration.spec.ts`.

---

## 3. Summary of Identified Defects & Remediation Roadmap

| Defect / Gap ID | Workflow Area | Classification | Root Cause | Impact | Recommended Remediation |
| :--- | :---: | :---: | :--- | :--- | :--- |
| `GAP-P1-01` | **E** | **`PARTIALLY WORKING`** | `PaymentService.createExecution` allows `provider: 'mock'` without checking `NODE_ENV === 'production'`. | High (Financial) | Add explicit environment check rejecting mock provider when `NODE_ENV === 'production'`. |
| `GAP-P1-02` | **E** | **`PARTIALLY WORKING`** | `billing/page.tsx` renders "Add Mock Funds" button unconditionally in production builds. | Medium (UX / Security) | Wrap mock top-up card in `process.env.NODE_ENV !== 'production'`. |
| `GAP-P2-01` | **I** | **`KNOWN DEFECT`** | Backend lacks `GET /workspaces/:id/disputes`; frontend queries `calls?limit=100`. | High (Operational) | Implement dedicated backend query on `CallDispute` table with server-side pagination. |
| `GAP-P2-02` | **L** | **`PARTIALLY WORKING`** | `GET /workspaces/:id/audit-logs` endpoint exists in backend but has no frontend UI. | Medium (Compliance) | Create `/protected/audit-logs/page.tsx` explorer page. |
| `BUG-SEC-001` | **L** | **`PARTIALLY WORKING`** | `safe-fetch.ts` validates IP before fetch; vulnerable to DNS rebinding. | Medium (Security) | Pin destination IP address directly in HTTP client connection socket. |
| `GAP-P3-01` | **L** | **`PARTIALLY WORKING`** | `PUT /workspaces/:id/status` has no Danger Zone UI in frontend settings. | Low (Operational) | Add workspace suspension button with confirmation dialog in settings. |
