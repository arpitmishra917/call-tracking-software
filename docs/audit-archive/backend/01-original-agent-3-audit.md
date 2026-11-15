# CALLFLOW — PHASE QA-2A-AGENT-3: FORENSIC AUDIT REPORT
**Document ID:** `CALLFLOW-PHASE-QA-2A-AGENT-3-AUDIT-REPORT`  
**Owner:** Agent 3 — Frontend, Reporting & Application Integration  
**Phase:** QA-2A (Readiness & Safety Boundary Verification)  
**Mode:** STRICT READ-ONLY FORENSIC AUDIT  
**Evaluation Date:** November 12, 2026  
**Final Status:** **QA-2A AGENT 3 AUDIT COMPLETE**

---

## 1. Executive Summary & Categorical Verdict

This forensic audit investigates whether the CallFlow web frontend (`apps/web`), its API integration layer, and the monorepo automated test infrastructure can safely support the upcoming synthetic concurrency (**Phase QA-2B**) and multi-workspace verification (**Phase QA-2D**).

### Categorical Verdict: **`PASS WITH CONDITIONS`**

```
┌──────────────────────────────────────────────────┬──────────────────────┐
│ EVALUATION DIMENSION                             │ AUDIT VERDICT        │
├──────────────────────────────────────────────────┼──────────────────────┤
│ 1. Frontend Environment & Telephony Safety       │ PASS                 │
│ 2. Backend Telephony Guard & Target API Isolation│ PASS                 │
│ 3. API Integration & Multi-Call Data Contracts   │ PASS WITH CONDITIONS │
│ 4. QA-2B Concurrency Observability (UI/API)      │ PASS WITH CONDITIONS │
│ 5. QA-2D Multi-Workspace Data Isolation          │ PASS WITH CONDITIONS │
│ 6. Browser E2E / Playwright Test Harness         │ BLOCKED              │
└──────────────────────────────────────────────────┴──────────────────────┘
```

#### Core Findings:
1. **Zero Accidental Live Telephony Exposure from Frontend:** The frontend application contains **zero dialpad controls, zero WebRTC endpoints, and zero call origination API triggers**. Calls are purely inbound webhooks or Asterisk-driven.
2. **Safe API Target Configuration:** `apps/web/.env` explicitly targets `NEXT_PUBLIC_API_URL=http://localhost:3000`. The frontend cannot accidentally route API requests to production servers.
3. **Capacity Saturation Observability Nuance:** In the routing engine (`apps/api/src/calls/calls.service.ts` lines 2156–2172), when Buyer A reaches its concurrency limit, the loop executes `continue;` and skips to Buyer B **without inserting a rejected `call_attempts` row for Buyer A**. Consequently, Call 3's routing timeline displays Buyer B as Attempt #1 rather than showing a rejected Attempt #1 on Buyer A.
4. **Browser E2E Infrastructure is Missing:** `@playwright/test` is **not installed**, browser binaries do not exist in `%LOCALAPPDATA%\ms-playwright`, and no automated browser test suite exists. Frontend testing currently relies entirely on **Vitest + React Testing Library (JSDOM)** with mocked API responses.

---

## 2. Environment & API Target Verification

### 2.1 Frontend Configuration Inspection

Forensic inspection of environment files in `apps/web`:
- `apps/web/.env`:
  ```ini
  NEXT_PUBLIC_SUPABASE_URL=https://uwycbvnqnpnfisvvbabu.supabase.co
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=[REDACTED]
  NEXT_PUBLIC_SUPABASE_ANON_KEY=[REDACTED]
  NEXT_PUBLIC_API_URL=http://localhost:3000
  ```
- `apps/web/.env.example`:
  ```ini
  # NEXT_PUBLIC_API_URL controls where the frontend sends authenticated API requests.
  # If omitted, it gracefully defaults to http://localhost:3000.
  NEXT_PUBLIC_API_URL=http://localhost:3000
  ```

### 2.2 Client-Side API Fetch Wrapper
In `apps/web/src/lib/api.ts` lines 11–19:
```typescript
const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
const res = await fetch(`${apiUrl}${path}`, {
  ...options,
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
    ...options.headers,
  },
});
```

### 2.3 Server-Side Layout Fetch Wrapper
In `apps/web/src/app/protected/layout.tsx` lines 54–62:
```typescript
const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
let res = await fetch(`${apiUrl}/workspaces`, {
  headers: { Authorization: `Bearer ${accessToken}` },
  cache: 'no-store',
});
```

### Forensic Finding:
- **API Target Verdict: PASS.** The API base URL is hardcoded to fall back to `http://localhost:3000` both client-side and server-side. It is impossible for the frontend to target a remote staging or production backend unless `NEXT_PUBLIC_API_URL` is intentionally overridden in a build pipeline.
- **Supabase Authentication Dependency:** The frontend relies on cloud Supabase (`https://uwycbvnqnpnfisvvbabu.supabase.co`) for initial session token generation. In headless testing, standard API tokens can be injected into `sessionStorage` or mocked via `apiFetch`.

---

## 3. Telephony Action Entry-Point Inventory

Inspection of all frontend components and routes in `apps/web/src`:

| Route / Component | UI Control / Action | API Endpoint Consumed | Operation Severity | Real Call Trigger? |
|---|---|---|:---:|:---:|
| `/protected/calls` (`CallsPage`) | Filter, Search, Pagination | `GET /workspaces/:id/calls?...` | Read-only | **NO** |
| `/protected/calls/:callId` (`CallDetailPage`) | View Timeline, Listen Recording | `GET /workspaces/:id/calls/:callId`<br>`GET /workspaces/:id/recordings/:recId/stream` | Read-only | **NO** |
| `/protected/calls/:callId` (`CallDetailPage`) | "Submit Dispute" | `POST /workspaces/:id/calls/:callId/disputes` | Database Mutation | **NO** |
| `/protected/calls/:callId` (`CallDetailPage`) | "Accept/Reject Dispute" | `POST /workspaces/:id/calls/:callId/disputes/resolve` | Database Mutation | **NO** |
| `/protected/phone-numbers` (`PhoneNumbersPage`) | "Search Available Numbers" | `GET /workspaces/:id/phone-numbers/search` | Read-only (Telnyx API) | **NO** |
| `/protected/phone-numbers` (`PhoneNumbersPage`) | "Provision Number" | `POST /workspaces/:id/phone-numbers` | Carrier DID Purchase | **CARRIER DID ONLY** (No call) |
| `/protected/phone-numbers` (`PhoneNumbersPage`) | "Assign to Campaign" | `POST /workspaces/:id/campaigns/:id/phone-numbers` | Database Mutation | **NO** |
| `/protected/phone-numbers` (`PhoneNumbersPage`) | "Assign to Vendor" | `PUT /workspaces/:id/phone-numbers/:id` | Database Mutation | **NO** |
| `/protected/campaigns/:id` (`CampaignDetailPage`) | "Assign Destination Number" | `POST /workspaces/:id/campaigns/:id/destinations` | Database Mutation | **NO** |
| `/protected/campaigns/:id` (`CampaignDetailPage`) | "Reorder Priority (Up/Down)"| `PUT /workspaces/:id/campaigns/:id/destinations/reorder` | Database Mutation | **NO** |
| `/protected/buyers/:id` (`BuyerDetailPage`) | "Add Destination Number" | `POST /workspaces/:id/buyers/:id/destination-numbers` | Database Mutation | **NO** |
| `/protected/reporting` (`ReportingDashboard`) | "Export CSV / XLSX" | `POST /workspaces/:id/reports/export` | Read-only file download | **NO** |

### Safety Verdict:
**PASS.** There are **no dial buttons, click-to-call hooks, or SIP softphones** in the UI. Testing the UI cannot initiate outbound phone calls or PSTN traffic.

---

## 4. Automated Test Infrastructure Inventory

### 4.1 Framework Distribution

| Monorepo Package | Test Runner | Version | Primary Testing Scope | Mocking Strategy |
|---|---|---|---|---|
| `apps/web` | **Vitest** + JSDOM | `4.1.11` | React Component / Page rendering, UI state, routing params | `vi.mock('@/lib/api')`, `vi.mock('next/navigation')` |
| `apps/api` (Unit) | **Vitest** | `4.1.2` | Service unit logic, controllers, guards, pricing | NestJS `Test.createTestingModule`, in-memory mocks |
| `apps/api` (E2E) | **Vitest** + Supertest | `4.1.2` | HTTP integration tests (`apps/api/test/*.e2e-spec.ts`) | Isolated test DB (`callflow_test`), Mocked JWT guard |
| `qa/` | Node.js native (`.mjs`) | Node 20+ | Low-level Asterisk ARI, PCAP parsing, audio FFT analysis | Live containers (`callflow-asterisk-qa`, `callflow-postgres-qa`) |

### 4.2 Telephony Mocking & Synthetic Harnesses Available in Codebase

1. **`FakeTelephonyProvider`** (`apps/api/src/telephony/fake.provider.ts`):
   - Implements `TelephonyProvider` interface in TypeScript.
   - Records all actions in an in-memory audit log (`answer`, `dial`, `bridge`, `hangup`, `startRecording`, `startRingback`, `stopRingback`).
   - Supports simulated asynchronous call statuses (`mockCallStatus(callId, 'ACTIVE' | 'TERMINAL')`).
   - Zero carrier or network activity.
2. **`QaTelephonyGuardService`** (`apps/api/src/telephony/qa/qa-telephony-guard.service.ts`):
   - Single-use cryptographic lease system (`openInboundTestLease()`, `consumeInboundLease()`).
   - Strict allowlist enforcer (`parseAllowlist()`, `validateDestinationOrThrow()`).
   - Memory-based trusted call binding preventing unauthenticated call injection.
3. **`QaTestController`** (`apps/api/src/telephony/qa/qa-test.controller.ts`):
   - `GET /qa/status`: Health check for QA configuration.
   - `POST /qa/test-run`: Triggers an end-to-end controlled test run through `QaOrchestratorService`.
4. **Synthetic Webhook Concurrency Harness** (`apps/api/test/webhook-concurrency-postgres.integration.spec.ts`):
   - Emulates concurrent incoming Telnyx webhook requests across multiple workers against PostgreSQL.
   - Tests `call.initiated`, `call.answered`, `call.hangup` lifecycles simultaneously.

---

## 5. Playwright & Browser E2E Readiness

| Readiness Item | Audit Finding | Concrete Forensic Evidence |
|---|:---:|---|
| **`@playwright/test` Package** | **MISSING** | Not listed in root `package.json`, `apps/web/package.json`, or `apps/api/package.json`. |
| **Playwright Config File** | **MISSING** | No `playwright.config.ts` or `playwright.config.js` exists in the repository. |
| **Browser Binaries** | **MISSING** | Directory `C:\Users\prate\AppData\Local\ms-playwright` does not exist (`File Not Found`). |
| **Existing E2E Browser Specs** | **MISSING** | No `.spec.ts` or `.test.ts` files utilize Playwright `page.goto()`, `locator()`, or browser contexts. |
| **Component Test Suite** | **PRESENT** | 28 test suites in `apps/web/src` run via Vitest in JSDOM, mocking backend responses. |

### Browser Readiness Verdict: **`BLOCKED`**
- Headless browser automated tests cannot run in the current environment without package installation and binary downloads.
- **QA Strategy for Phase QA-2:** Verification of frontend observability and multi-workspace visibility must be performed either via:
  1. Automated integration suites using **Vitest + Testing Library** (`render(<CallsPage />)`, `render(<ReportingDashboard />)`), or
  2. Manual interactive verification in a running browser (`npm --workspace=web run dev`).

---

## 6. QA-2B Test Observability Readiness Matrix

Evaluation of whether the CallFlow UI and API can observe the seven mandatory behaviors of a 3-call concurrency test:

| # | Required Concurrency Behavior | API Observability | Frontend UI Observability | Observability Limitations & UI Gaps |
|---|---|:---:|:---:|---|
| **1** | **Three simultaneous calls** | **FULL**<br>`GET /calls/live-calls`<br>`GET /calls?status=ACTIVE` | **PARTIAL**<br>Header shows `3 Live`.<br>Reporting card shows `3 Live`. | `CallsPage` and `ReportingDashboard` table **do not auto-refresh** via WebSocket or polling. User must click "Refresh" or reload page. |
| **2** | **Selected buyer for each call** | **FULL**<br>`GET /calls/:id` returns `attempts[].buyer` & `commercial.buyer`. | **PARTIAL**<br>Visible on `CallDetailPage`.<br>Filtered on `CallsPage`. | `CallsPage` main table **does not have a Buyer column**. Selected buyer is only visible by drilling down into `/protected/calls/:callId`. |
| **3** | **Each call's attempt history** | **FULL**<br>`attempts` array returned on `GET /calls/:id`. | **FULL**<br>`CallDetailPage` renders vertical Routing Timeline. | Complete visibility on `CallDetailPage` (`apps/web/src/app/protected/calls/[callId]/page.tsx` line 830). |
| **4** | **Buyer A capacity saturation** | **INDIRECT**<br>API skips Buyer A when `activeCount >= maxLimit`. | **INDIRECT**<br>Buyer A limit visible on Buyer Detail page. | **CRITICAL OBSERVABILITY GAP:** In `calls.service.ts` line 2171, saturated buyers are skipped with `continue;`. **No rejected attempt record is created for Buyer A.** |
| **5** | **Third-call overflow to Buyer B** | **FULL**<br>Call 3 attempt #1 is assigned to Buyer B. | **INDIRECT**<br>Call 3 timeline shows Buyer B directly. | Call 3 appears as routing cleanly to Buyer B. The UI does not display an explicit "Overflow from Buyer A" badge because Buyer A was skipped before attempt creation. |
| **6** | **Call status transitions** | **FULL**<br>States: `INITIATED`, `ROUTING`, `RINGING`, `ANSWERED`, `COMPLETED`. | **PARTIAL**<br>Badges update on manual refresh. | Transitions are captured accurately in DB timestamps (`started_at`, `answered_at`, `ended_at`), but UI cannot stream live transitions without refresh. |
| **7** | **Failure and retry behavior** | **FULL**<br>If dialed leg fails/timeouts, attempt is saved as `FAILED`/`NO_ANSWER`. | **FULL**<br>`CallDetailPage` renders multiple attempt nodes. | If a call actually rings Buyer A and fails (unlike pre-dial saturation), Attempt 1 (`FAILED`) and Attempt 2 (`ANSWERED`) are both rendered. |

---

## 7. QA-2D Multi-Workspace UI/API Readiness Matrix

Evaluation of whether CallFlow maintains clean workspace isolation and avoids cross-tenant data leaks:

| Resource Domain | API Path Structure | Frontend State Reset on Switch | Cross-Tenant Leakage Risk | Forensic Evidence |
|---|---|:---:|:---:|---|
| **Calls List** | `/workspaces/:id/calls` | **YES** (`setCalls([])`) | **NONE** | `CallsPage` line 77 resets `calls`, `total`, and `page` on `[workspaceId]`. |
| **Call Detail** | `/workspaces/:id/calls/:id` | **YES** (`setCall(null)`) | **LOW** (Competitor endpoint leak) | `CallDetailPage` line 853 leaks competitor endpoint names to Buyer participants via `!isVendor`. |
| **Campaigns** | `/workspaces/:id/campaigns` | **YES** (`setCampaigns([])`) | **MEDIUM** (Sidebar exposure) | `Sidebar` line 94 exposes Campaigns tab to Buyer workspaces due to `!isVendor`. |
| **Buyers** | `/workspaces/:id/buyers` | **YES** (`setBuyers([])`) | **MEDIUM** (Sidebar exposure) | `Sidebar` line 94 exposes Buyers tab to Buyer workspaces; `BuyersPage` line 141 does not block `BUYER`. |
| **Reporting KPI Cards** | `/workspaces/:id/calls/metrics` | **YES** (`setMetrics(null)`) | **NONE** | `ReportingDashboard` line 531 wipes metrics, calls, and totals on workspace switch. |
| **Live Call Header** | `/workspaces/:id/calls/live-calls` | **YES** (`setLiveCalls(null)`) | **NONE** | `HeaderMetrics` line 52 resets balance and live call counter immediately on switch. |
| **Saved Reports** | `/workspaces/:id/reports` | **YES** (Refetched) | **NONE** | Scoped strictly by `:workspaceId` in path; partitioned in DB. |
| **Table Column Config** | Client `localStorage` | **YES** (Partitioned key) | **NONE** | Keyed by `callflow.reporting.columns.${workspaceId}` (`ReportingDashboard` line 395). |

---

## 8. Existing Test Coverage and Missing Coverage

### 8.1 Existing Verified Coverage (Vitest / JSDOM)

1. **Workspace Context Persistence & Switching:**
   - `reporting-workspace-context.test.tsx`: Verifies applying filters, resetting filters, changing groupings, and independent browser sessions maintain `?workspace=<id>` without tenant bleed.
2. **Vendor Portal Scoping:**
   - `vendor-portal.test.tsx`: Verifies that vendor participants see `Payout` but have `Revenue`, `Profit`, `Cost`, `Disputes`, and `Routing` strictly hidden.
3. **Buyer Management & Destination Number UI:**
   - `buyers/page.test.tsx`: Verifies rendering buyer list, metrics, status filters, and Add Buyer modal permissions.
   - `buyers/[buyerId]/page.test.tsx`: Verifies destination numbers list, Add Destination Number modal with E.164 validation, edit destination, and delete destination confirmation.
4. **Call Detail & Timeline:**
   - `calls/[callId]/page.test.tsx`: Verifies call detail loading, attempt history rendering, and dispute submission.
5. **Backend Concurrency & Live Calls:**
   - `live-calls.integration.spec.ts`: Verifies live call counters, status transitions, and cleanup.
   - `webhook-concurrency-postgres.integration.spec.ts`: Verifies atomic concurrency handling and database locking under parallel webhooks.

### 8.2 Missing Coverage for QA-2B & QA-2D

1. **Automated Frontend Concurrency Suite:** No test exists that simulates three calls arriving concurrently and asserts the UI table rendering all three simultaneously.
2. **Buyer Overflow Visual Assertion:** No test verifies how the frontend displays a call that overflowed from Buyer A to Buyer B.
3. **End-to-End Browser Automation:** No Playwright suite exists to drive real browser interactions through the UI against the running NestJS API.
4. **Live Call Polling Assertion:** No test verifies live call status updating on `CallsPage` without manual browser reload.

---

## 9. Critical Blockers and Severity

| Blocker ID | Description | Severity | Impact on Phase QA-2 | Recommended Mitigation |
|---|---|:---:|---|---|
| **BLK-01** | **Playwright Test Runner Not Installed** | **HIGH** | Automated browser E2E execution cannot run. | Run synthetic verification via API integration suites and Vitest component harnesses; introduce Playwright only during dedicated test tooling phase. |
| **BLK-02** | **Cloud Supabase Auth Dependency in Web App** | **MEDIUM** | Headless automated browser login requires external internet access to Supabase. | In QA mode, utilize pre-authenticated JWT session injection or mock auth token in sessionStorage. |
| **BLK-03** | **Buyer Capacity Saturation Skips Attempt Record** | **MEDIUM** | Call 3 does not record a failed attempt on Buyer A; it routes directly to Buyer B. Saturation is invisible in attempt history. | Assert concurrency overflow by verifying Call 1 and Call 2 occupy Buyer A's active slots while Call 3 routes to Buyer B. |
| **BLK-04** | **No Auto-Refresh on Calls List Table** | **LOW** | Calls table requires manual refresh to show newly arrived calls or completed hangup transitions. | In test assertions, trigger manual refetch (`fetchReporting()` or page reload) after webhook delivery. |

---

## 10. Mandatory Prerequisites Before Phase QA-2B Execution

Before launching the 3-call synthetic concurrency test in Phase QA-2B:

1. **Verification Database Prerequisite:**
   - Ensure `callflow-postgres-qa` is running on port `5433` with database `callflow_qa`.
   - Never run concurrency tests against development databases lacking row-lock isolation.
2. **Telephony Mode Prerequisite:**
   - Verify `ACTIVE_TELEPHONY_PROVIDER=fake` or that `QaTelephonyGuardService` has `TELEPHONY_QA_ENABLED=false` for synthetic tests (or controlled Asterisk local channel loopback).
3. **Buyer Concurrency Configuration:**
   - Configure Buyer A with `max_concurrent_calls = 2`.
   - Configure Buyer B with `max_concurrent_calls = 5` (overflow target).
   - Configure Campaign Waterfall: Buyer A (Priority 1), Buyer B (Priority 2).
4. **Observability Verification Method:**
   - Because the frontend lacks auto-polling on `/protected/calls`, the verification harness must poll `GET /workspaces/:id/calls/live-calls` and `GET /workspaces/:id/calls` via API, or trigger explicit page refreshes in UI tests.

---

**QA-2A AGENT 3 AUDIT COMPLETE**
