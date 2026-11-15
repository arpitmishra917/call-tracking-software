# CALLFLOW — AGENT 1: API INTEGRATION & CONTRACT FINDINGS

**Author:** Agent 1 (Frontend & Client-Side Architecture Specialist)  
**Target:** CallFlow Web Client (`apps/web/src/lib/api.ts` & Page-Level API Calls)  
**Audit Scope:** End-to-End API Integration, Contract Fidelity, Request/Response Mappings, and Error Handling  

---

## 1. CORE CLIENT API ARCHITECTURE

Frontend communication with the backend API (`apps/api`) is orchestrated through `apps/web/src/lib/api.ts`.

### 1.1 `apiFetch(path, options)`
* **Authentication Header:** Injects `Authorization: Bearer <session.access_token>` from Supabase Auth (`supabase.auth.getSession()`). If no active session exists, throws an immediate `Error('Not authenticated')`.
* **Content Negotiation:** Defaults `Content-Type: application/json`.
* **Workspace Context Delivery:**
  * **Critical Observation:** `apiFetch` does **not** automatically extract or attach an `x-workspace-id` HTTP header.
  * Pages are required to construct URLs with path-based workspace parameterization: `/workspaces/${workspaceId}/...`.
  * If an endpoint relies on `req.headers['x-workspace-id']` rather than route parameters, multi-tenant scoping will fail.
* **Error Body Handling:**
  * If `!res.ok`, the function awaits `res.text()` and throws `new Error(\`API error (${res.status}): ${text}\`)`.
  * **Defect:** Unparsed JSON error payloads (e.g. `{ statusCode: 400, message: ["name is required"] }`) are thrown as raw strings, causing raw JSON strings to render in user-facing alert boxes.

### 1.2 `apiDownload(path, options)`
* Designed for streaming binary exports (CSV, XLSX).
* Unlike `apiFetch`, `apiDownload` includes dedicated error parsing (lines 58–66) that parses JSON error bodies and extracts user-friendly message strings.
* Extracts the downloaded filename from the `Content-Disposition` HTTP header (`filename="..."`).

---

## 2. API ENDPOINTS & CONTRACT MATRIX

The following table documents every API endpoint consumed by the frontend, inspecting method, payload structure, workspace context, and contract integrity.

| Frontend Page / Component | Target API Endpoint | Method | Request Payload / Query Params | Workspace Context | Contract Integrity & Response Mapping |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Global Layout** (`layout.tsx`) | `/workspaces` | `GET` | None | Bearer Token | **PASS.** Returns `{ id, name, role, participant_type, vendor_id, buyer_id }[]`. Scopes entire Shell navigation. |
| **Header Metrics** (`header.tsx`) | `/workspaces/:id/calls/live-calls` | `GET` | None | URL Path | **PASS.** Returns `{ liveCalls: number }`. |
| **Header Metrics** (`header.tsx`) | `/workspaces/:id/billing/balance` | `GET` | None | URL Path | **MISMATCH / DEFECT.** Throws 403 Forbidden for VENDOR and BUYER participant roles, crashing live calls polling. |
| **Onboarding** (`onboarding-client.tsx`) | `/workspaces` | `POST` | `{ name: string }` | None (Creates root workspace) | **PASS.** Creates workspace and returns workspace object. |
| **Public Invitation** (`invitations/page.tsx`) | `/invitations/verify/:token` | `GET` | None (Public token lookup) | None | **PASS.** Returns `{ status: 'PENDING' \| ..., workspace_name, email }`. |
| **Accept Invitation** (`accept-invitation/client.tsx`) | `/workspaces/accept-invitation` | `POST` | `{ token: string }` | Bearer Token | **PASS.** Returns `{ workspaceId: string }`. Triggers redirect. |
| **Reporting Dashboard** (`reporting/page.tsx`) | `/workspaces/:id/calls/metrics` | `GET` | `startDate`, `endDate`, `campaignId`, `buyerId`, `vendorId`, `bucket`, `status` | URL Path | **PASS.** Returns aggregated counts, durations (`avgDuration`, `tclSecs`, `aclSecs`), and commercial metrics. |
| **Reporting Dashboard** (`reporting/page.tsx`) | `/workspaces/:id/calls` | `GET` | `page`, `limit=20`, `offset`, duration filters, status, etc. | URL Path | **PASS.** Returns `{ items: Call[], total: number }`. |
| **Reporting Dashboard** (`reporting/page.tsx`) | `/workspaces/:id/reports` | `GET`, `POST` | Post payload: `{ name, visibility, configuration }` | URL Path | **PASS.** Saves filter presets and column layouts. |
| **Reporting Dashboard** (`reporting/page.tsx`) | `/workspaces/:id/reports/export` | `POST` | `{ format: 'csv' \| 'xlsx', filters, columns }` | URL Path | **PASS.** Consumed via `apiDownload`, returning file blob and filename. |
| **Recording Player** (`recording-player.tsx`) | `/workspaces/:id/recordings/:recId/download` | `GET` | None | URL Path | **PASS.** Returns `{ url: string }` with presigned S3/GCS media link. |
| **Call Logs** (`calls/page.tsx`) | `/workspaces/:id/calls` | `GET` | `page`, `limit`, `offset`, filters | URL Path | **PASS.** Server-side pagination mapping `total` to pagination controls. |
| **Call Inspection** (`calls/[callId]/page.tsx`) | `/workspaces/:id/calls/:callId` | `GET` | None | URL Path | **PASS.** Returns full call tree with attempts, dialed snapshots, and commercial records. |
| **File Dispute** (`calls/[callId]/page.tsx`) | `/workspaces/:id/call-commercials/:id/dispute` | `POST` | `{ reason: string, description?: string }` | URL Path | **PASS.** Transitions commercial record to disputed state. |
| **Resolve Dispute** (`disputes/page.tsx`) | `/workspaces/:id/disputes/:id/resolve` | `POST` | `{ status: 'ACCEPTED' \| 'REJECTED', resolution_notes?: string }` | URL Path | **PASS.** Commercial evaluator updates revenue/payout adjustments. |
| **Campaigns List** (`campaigns/page.tsx`) | `/workspaces/:id/campaigns` | `GET`, `POST`, `PUT` | Post/Put: `{ name, default_revenue_amount, default_payout_amount, currency, conversion_duration_secs }` | URL Path | **PASS.** Strict validation on non-negative numeric rates. |
| **Campaign Waterfall** (`campaigns/[campaignId]/page.tsx`) | `/workspaces/:id/campaigns/:id/destination-numbers` | `POST`, `PUT`, `DELETE` | Post: `{ destinationNumberId, priority, weight }` | URL Path | **PASS.** Correctly updates priority order in destination waterfall. |
| **Buyers List** (`buyers/page.tsx`) | `/workspaces/:id/buyers` | `GET`, `POST` | Post: `{ name, email, timeout, max_concurrent_calls, destinationNumber? }` | URL Path | **PASS.** Validates E.164 phone numbers and positive timeouts. |
| **Buyer Destinations** (`buyers/[buyerId]/page.tsx`) | `/workspaces/:id/buyers/:id/destination-numbers` | `POST`, `DELETE` | Post: `{ destination_number, name, timeout, max_concurrent_calls }` | URL Path | **PASS.** Creates and binds destination number to buyer organization. |
| **Vendors List** (`vendors/page.tsx`) | `/workspaces/:id/vendors` | `GET`, `POST`, `PUT` | Post/Put: `{ name: string }` | URL Path | **PASS.** Server-side status filtering and search. |
| **Vendor Numbers** (`vendors/[vendorId]/page.tsx`) | `/workspaces/:id/phone-numbers/:numId` | `PUT` | `{ vendorId: string \| null }` | URL Path | **PASS.** Reassigns or unassigns tracking numbers from vendors. |
| **Phone Numbers** (`phone-numbers/page.tsx`) | `/workspaces/:id/phone-numbers` | `GET`, `POST`, `PUT` | Put: `{ campaignId?, vendorId? }` | URL Path | **PASS.** Ingress telephony routing management. |
| **Phone Provisioning** (`phone-numbers/page.tsx`) | `/workspaces/:id/phone-numbers/available` | `GET` | `countryCode`, `prefix`, `type` | URL Path | **PASS.** Telnyx available inventory search. |
| **Phone Provisioning** (`phone-numbers/page.tsx`) | `/workspaces/:id/phone-numbers/provision` | `POST` | `{ phoneNumber: string }` | URL Path | **PASS.** Provisions number and deducts wallet balance. |
| **Settlements** (`settlements/page.tsx`) | `/workspaces/:id/settlements/batches` | `GET` | `participant_type`, `settlement_status`, `payment_status`, `limit`, `offset` | URL Path | **PASS.** Full audit and financial summary tracking. |
| **Generate Settlements** (`settlements/page.tsx`) | `/workspaces/:id/settlements/batches/generate` | `POST` | `{ participant_type, period_start, period_end, participant_id? }` | URL Path | **PASS.** Verifies period dates. |
| **Payment Instructions** (`payments/page.tsx`) | `/workspaces/:id/payments/instructions` | `GET` | `status`, `participant_type`, `direction`, `limit`, `offset` | URL Path | **CONTRACT ISSUE.** Frontend `direction` typing has `PAYOUT` instead of `DISBURSEMENT`. |
| **Execute Payment** (`payments/page.tsx`) | `/workspaces/:id/payments/instructions/:id/executions` | `POST` | `{ provider: 'manual' \| 'wire' \| 'mock' }` | URL Path | **PASS.** Dispatches payment to gateway. |
| **Retry Payment** (`payments/page.tsx`) | `/workspaces/:id/payments/instructions/:id/retry` | `POST` | `{ provider: 'manual' \| 'wire' \| 'mock' }` | URL Path | **PASS.** Retries failed instruction. |
| **Reconciliation** (`reconciliation/page.tsx`) | `/workspaces/:id/reconciliation/runs` | `GET` | `run_type`, `status`, `limit`, `offset` | URL Path | **PASS.** Discrepancy analysis dashboard. |
| **Run Batch Recon** (`reconciliation/page.tsx`) | `/workspaces/:id/reconciliation/batches/:batchId/run` | `POST` | None | URL Path | **PASS.** Audits settlement line items against ledger. |
| **Audit Logs** (`audit-logs/page.tsx`) | `/workspaces/:id/audit-logs` | `GET` | `action`, `targetType`, `targetId`, `startDate`, `endDate`, `limit`, `offset` | URL Path | **PASS.** Security audit inspection. |
| **Members List** (`members/page.tsx`) | `/workspaces/:id/members` | `GET`, `PUT`, `DELETE` | Put: `{ role: string }` | URL Path | **PASS.** Manages workspace team membership. |
| **Invitations List** (`members/page.tsx`) | `/workspaces/:id/invitations` | `GET`, `POST`, `DELETE` | Post: `{ email, role, participant_type, vendor_id?, buyer_id? }` | URL Path | **PASS.** Creates multi-role invitation records. |
| **Granular Permissions** (`members/[memberId]/page.tsx`) | `/workspaces/:id/permissions/members/:memberId` | `GET`, `POST`, `DELETE` | Post: `{ permissionKey, scopeType, resourceId? }` | URL Path | **PASS.** Enforces fine-grained ACL scoping. |
| **Billing Balance & Wallet** (`billing/page.tsx`) | `/workspaces/:id/billing/balance` | `GET` | None | URL Path | **PASS.** Displays wallet minor balance and currency. |
| **Mock Top-Up** (`billing/page.tsx`) | `/workspaces/:id/billing/wallet/mock-topup` | `POST` | `{ amountMinor: number }` | URL Path | **PASS.** Dispatches event `wallet-topup` to notify header. |
| **Blocked Callers** (`blocked-callers/page.tsx`) | `/workspaces/:id/blocked-callers` | `GET`, `POST`, `DELETE` | Post: `{ phoneNumber, reason }` | URL Path | **PASS.** Updates ingress firewall list. |
| **API Keys** (`api-keys/page.tsx`) | `/workspaces/:id/api-keys` | `GET`, `POST`, `DELETE` | Post: `{ name }` | URL Path | **PASS.** Emits raw secret string once upon creation. |
| **Webhooks** (`webhooks/page.tsx`) | `/workspaces/:id/webhooks` | `GET`, `POST`, `DELETE` | Post: `{ url }` | URL Path | **PASS.** Registers HTTPS endpoint for outbound dispatch. |
| **User Profile** (`account/page.tsx`) | `/account/profile` | `GET`, `PUT` | Put: `{ fullName: string }` | Bearer Token | **PASS.** Updates user profile metadata. |

---

## 3. IDENTIFIED CONTRACT MISMATCHES & DATA INTEGRITY RISKS

### 3.1 Payment Direction Contract Mismatch
* **Frontend Typing:** `apps/web/src/lib/payments.ts`, line 22:
  ```ts
  export interface PaymentInstruction {
    direction: 'COLLECTION' | 'PAYOUT';
  }
  ```
* **Backend API & UI Control:**
  `apps/web/src/app/protected/payments/page.tsx` line 375 & backend schema:
  `direction: 'COLLECTION' | 'DISBURSEMENT'`
* **Impact:** Any client routine filtering or testing for `'PAYOUT'` will fail to match backend records.
* **Remediation:** Align `lib/payments.ts` to `direction: 'COLLECTION' | 'DISBURSEMENT';`.

### 3.2 Header Polling 403 Forbidden Flood
* **Frontend Location:** `apps/web/src/components/header.tsx`, line 28
* **Endpoint:** `GET /workspaces/:workspaceId/billing/balance`
* **Defect:** Polled unconditionally every 10 seconds for all users regardless of role.
* **Impact:** When a Vendor or Buyer participant is viewing their dashboard, the backend logs recurring 403 Forbidden exceptions every 10 seconds, and the client live calls counter fails to render.
* **Remediation:** Check active workspace role or wrap fetch in `Promise.allSettled`.

### 3.3 Destination Number DTO vs Schema Discrepancy
* **Creation API:** When creating a buyer on `/protected/buyers`, the client sends `{ destinationNumber: "+1555..." }`.
* **Sub-resource API:** When creating a destination number under `/protected/buyers/:id/destination-numbers`, the client sends `{ destination_number: "+1555..." }`.
* **Impact:** Inconsistent casing (camelCase vs snake_case) across sibling endpoints increases cognitive load and causes serialization bugs if payloads are refactored without testing.
* **Remediation:** Adopt consistent snake_case across all telephony endpoints.

---

## 4. STALE DATA & CLIENT-SIDE CACHING AUDIT

* **`cache: 'no-store'` Enforcement:** Server-side fetches in `apps/web/src/app/login/page.tsx`, `signup/page.tsx`, `invitations/page.tsx`, and `protected/layout.tsx` explicitly set `cache: 'no-store'`, preventing stale workspace session data on the server layer.
* **Session Isolation:** Workspace context is maintained in `sessionStorage ('callflow.active_workspace_id')`. When switching tabs in different workspaces, sessions remain isolated to their respective windows without state bleed.
* **Workspace Switching State Purge:** `audit-logs/page.tsx` and `calls/page.tsx` immediately zero out their records when `workspaceId` changes, successfully preventing records from Workspace A being briefly visible in Workspace B while the new query is inflight.
