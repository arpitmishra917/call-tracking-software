# CALLFLOW — AGENT 1: COMPLETE FRONTEND, UI, UX & CLIENT-SIDE FUNCTIONALITY AUDIT

**Audit Date:** November 2026  
**Agent:** Agent 1 (Frontend & Client-Side Architecture Specialist)  
**Scope:** Complete Client-Side Web Application (`apps/web`)  
**Audit Mode:** Read-Only Forensic Audit  
**Target Repository:** `callflow-agent-a`  

---

## EXECUTIVE SUMMARY

A forensic, end-to-end audit was conducted across the entire frontend architecture of the **CallFlow** platform. The audit evaluated all routes, layouts, UI components, client-side state managers, form validation routines, API contract bindings, responsive breakpoints, access control layers (RBAC), and test suites.

The frontend application is built on **Next.js 16.3.5 (App Router)**, **React 19.2.8**, **Tailwind CSS v4**, and **Supabase Auth / SSR**, with testing powered by **Vitest 4.1.11** and **React Testing Library**.

While extensive operational capabilities, role-based scoping (Owner, Admin, Member, Buyer, Vendor, Viewer), and data visualization structures are implemented, the audit identified critical structural vulnerabilities, Contract-UI mismatches, unhandled polling failures, and untested attack surfaces.

### High-Level Statistics
* **Total Frontend Routes:** 22 distinct application routes (6 public auth/marketing routes, 16 protected module routes).
* **Automated Test Suite Status:** 31 test files; 284 total tests: **279 Passed**, **5 Failed** (in `buyers/page.test.tsx` and `reporting-recording-playback.test.tsx`).
* **Critical Issues Identified:**
  * **P0 (Critical / Security / Data Integrity):** 2 issues (Public Root `/` creates default Next.js template exposure without auth routing; unauthenticated session bypass logic in middleware edge cases).
  * **P1 (Core Functionality Broken):** 4 issues (Global `HeaderMetrics` unisolated `Promise.all` polling crashes `LiveCalls` display for Vendor/Buyer users; Audio playback test timeout / background re-render loop in reporting; `lib/payments.ts` direction typing mismatch `PAYOUT` vs `DISBURSEMENT`; Missing automatic workspace assignment redirect upon onboarding completion).
  * **P2 (Important Functionality Incorrect):** 7 issues (including column visibility state desync with localStorage, missing debounce in several key filter bars, unmasked sensitive metadata in developer displays, missing `x-workspace-id` header in base `apiFetch`).
  * **P3 (Minor Visual / Usability Defect):** 9 issues (including minor table overflow on narrow screens, missing dark-mode transitions in certain modals, and missing focus-trap in specific dialog components).

---

## 1. ARCHITECTURE & ENTRY POINTS

### 1.1 Technology Stack & Dependencies
* **Framework:** Next.js 16.3.5 (App Router, Turbopack compatible)
* **React Core:** React 19.2.8 / React DOM 19.2.8
* **Styling:** Tailwind CSS v4 (`@tailwindcss/postcss`) with CSS variables (`globals.css`)
* **State & Data Fetching:** React Hooks (`useState`, `useEffect`, `useCallback`, `useMemo`), Next.js Navigation (`useRouter`, `useSearchParams`, `usePathname`), Native `fetch` with Bearer auth token injection
* **Icons:** `lucide-react` (1.48.0)
* **Charts & Analytics:** `recharts` (3.10.1)
* **Theming:** `next-themes` (0.4.6)
* **Authentication:** `@supabase/ssr` (0.12.7) and `@supabase/supabase-js` (2.116.0)
* **Test Runner:** Vitest (4.1.11) with `@vitejs/plugin-react` and `jsdom` (29.1.1)

### 1.2 Entry Points & Route Tree Structure
* Root Entry: `apps/web/src/app/layout.tsx` (Providers, ThemeProvider, Geist Fonts).
* Middleware: `apps/web/src/middleware.ts` delegating to `apps/web/src/utils/supabase/middleware.ts`.
* Shell Wrapper: `apps/web/src/app/protected/layout.tsx` wrapping authenticated views in `Shell`, `Header`, `Sidebar`, and `WorkspaceValidator`.

```
apps/web/src/app/
├── page.tsx                           # Root Landing (VULNERABILITY: Default Next.js starter page)
├── layout.tsx                         # Global HTML Root Layout
├── globals.css                        # Tailwind & theme variables
├── middleware.ts                      # Session edge interceptor
├── login/page.tsx                     # Authentication Login
├── signup/page.tsx                    # User Registration
├── forgot-password/page.tsx           # Password Reset Request
├── reset-password/page.tsx            # Token-based Password Reset
├── invitations/page.tsx               # Public invitation verification & redirect
├── onboarding/
│   ├── page.tsx                       # Server check for first workspace
│   └── onboarding-client.tsx          # First workspace creation form
└── protected/
    ├── layout.tsx                     # Protected layout (Workspace verification, Shell)
    ├── page.tsx                       # Legacy Dashboard redirect -> /protected/reporting
    ├── accept-invitation/
    │   ├── page.tsx                   # Invitation acceptance token receiver
    │   └── client.tsx                 # Auto-acceptance client trigger
    ├── account/page.tsx               # User profile, email, password, theme
    ├── api-keys/page.tsx              # Workspace API Key management (Owner/Admin)
    ├── audit-logs/page.tsx            # Security audit log inspection & filtering
    ├── billing/page.tsx               # Wallet balances, subscriptions, transactions
    ├── blocked-callers/page.tsx       # Ingress caller blocking
    ├── buyers/
    │   ├── page.tsx                   # Buyer organization management & invitation
    │   └── [buyerId]/page.tsx         # Buyer details & destination numbers management
    ├── calls/
    │   ├── page.tsx                   # Call logs with filters & inline playback
    │   └── [callId]/page.tsx          # Full call detail, routing attempts, dispute filing
    ├── campaigns/
    │   ├── page.tsx                   # Campaign list, commercial pricing, thresholds
    │   └── [campaignId]/page.tsx      # Campaign waterfall priority & weights
    ├── disputes/page.tsx              # Commercial dispute resolution (Accept/Reject)
    ├── invitations/page.tsx           # Standalone invitation accept UI
    ├── members/
    │   ├── page.tsx                   # Member list, role delegation, pending invites
    │   └── [memberId]/page.tsx        # Fine-grained granular resource permissions
    ├── payments/
    │   ├── page.tsx                   # Settlement payment instructions & execution
    │   └── [instructionId]/page.tsx   # Detailed payment instruction execution logs
    ├── phone-numbers/page.tsx         # Inbound tracking number provisioning & vendor assignment
    ├── reconciliation/
    │   ├── page.tsx                   # Discrepancy analysis & batch reconciliation
    │   └── [runId]/page.tsx           # Reconciliation run discrepancy details
    ├── reporting/
    │   ├── page.tsx                   # Multi-dimensional analytics, saved reports, exports
    │   ├── calls-by-day-chart.tsx     # Dual-axis daily volume & revenue Recharts component
    │   └── outcome-distribution-chart.tsx # Status breakdown pie chart
    ├── settings/page.tsx              # Workspace name rename & metadata
    ├── settlements/page.tsx           # Settlement batches & billing period finalization
    ├── usage/page.tsx                 # Voice minutes, phone numbers, and storage metrics
    ├── vendors/
    │   ├── page.tsx                   # Vendor management & external invitations
    │   └── [vendorId]/page.tsx        # Vendor detail & phone number assignments
    └── webhooks/page.tsx              # Real-time event webhook endpoints
```

---

## 2. SUMMARY OF AUDIT FINDINGS BY PHASE

### Phase 2: Routing and Navigation
* **Root Route Bypass:** `apps/web/src/app/page.tsx` contains the boilerplate "Create Next App" template with links to Vercel documentation. Navigating to `/` does not check user authentication or redirect to `/protected`.
* **Deep Linking & Workspace State:** Navigation maintains the active workspace via `?workspace=<id>` query parameter and caches it in `sessionStorage ('callflow.active_workspace_id')`. However, direct URL navigation without a workspace query param relies on `WorkspaceValidator` to replace the URL, which can cause a flash of empty state or multiple client re-renders.
* **Role Redirection:** Participant types (`VENDOR` and `BUYER`) are properly scoped in `sidebar.tsx`. However, direct URL navigation to forbidden routes relies on in-page `403` catches rather than an automated router guard in `layout.tsx`.

### Phase 3: Interactive Elements & Buttons
* **Duplicate Action Safeguards:** The audit verified that dangerous actions (Confirming Dispute Resolutions, Running Batch Reconciliations, Triggering Mock Top-Ups, Deactivating Buyers/Vendors, and Creating Payment Executions) implement disable-while-loading flags (`isLoading` or disabled attributes).
* **Missing Implementation / Dead UI:**
  * In `apps/web/src/app/protected/webhooks/page.tsx`, the card description explicitly notes that "the current platform provides event streaming but does not support manual editing or viewing delivery history." The webhook list contains delete actions, but no test/ping button or delivery status inspection.
  * In `apps/web/src/app/protected/settings/page.tsx`, there is only workspace renaming; workspace deletion, data export, or ownership transfer buttons do not exist or are unimplemented.

### Phase 4: Form Validation
* **Phone Number E.164 Validation:** Validated across `lib/phone.ts`, `buyers/page.tsx`, `phone-numbers/page.tsx`, and `blocked-callers/page.tsx`. Regex enforces standard E.164 (`/^\+?[1-9]\d{6,14}$/`).
* **Duration Thresholds:** Campaign creation correctly requires integer conversion duration thresholds (`conversion_duration_secs >= 0`) and rejects negative or floating-point numbers.
* **Settlement Period Validation:** In `settlements/page.tsx`, generation requires `period_start < period_end`. The client UI flags an error if start is greater than or equal to end.
* **Dispute Form Validation:** Reason field is required; description is optional.

### Phase 5: API Integration & Contracts
* **Base `apiFetch` Architecture:** `apps/web/src/lib/api.ts` extracts the active Supabase JWT session and passes `Authorization: Bearer <token>`.
  * **Critical Contract Finding:** `apiFetch` does **not** automatically attach the `x-workspace-id` HTTP header. Every single page manually interpolates the workspace ID into the URL path (`/workspaces/${workspaceId}/...`). While backend controllers support path-based workspace parameterization, any public or utility endpoints that look for `x-workspace-id` header will receive `null`.
* **Contract Mismatch in Payments:** `apps/web/src/lib/payments.ts` defines direction as `'COLLECTION' | 'PAYOUT'`, but the UI and backend controllers expect `'COLLECTION' | 'DISBURSEMENT'`.
* **Header Polling Contract Vulnerability:** `apps/web/src/components/header.tsx` executes `Promise.all` with `/billing/balance` every 10 seconds. For participants (`VENDOR` / `BUYER`) or regular members without `billing:read` privileges, this API returns HTTP 403, which causes the entire `Promise.all` to reject, wiping out the live call count (`liveCalls`) and generating console 403 error spam.

### Phase 6: Data Display & Business Logic
* **Duration Formatting:** Call talk duration vs total duration correctly handled across detailed calls table and reporting page. Durations gracefully display `00:00` for zero seconds and `—` for null/unanswered calls without throwing `NaN`.
* **Commercial Metrics Isolation:**
  * Owners/Admins see Revenue, Payout, Cost, and Profit.
  * Buyers see Revenue, Converted, Qualified, Duplicate; Payout and Profit are hidden.
  * Vendors see Payout; Revenue, Cost, and Profit are hidden.
* **Destination Sanitization:** `getFinalDestinationDisplay` safely resolves complex attempt structures, displaying formatted numbers for completed attempts and avoiding displaying numeric internal database IDs.

### Phase 7: Responsive & Visual Design
* **Shell & Sidebar Drawer:** `apps/web/src/components/shell.tsx` implements responsive sidebar toggling with mobile backdrop overlay and accessible close button.
* **Table Horizontal Scroll:** Tables across `calls`, `reporting`, `buyers`, `settlements`, `payments`, and `audit-logs` are wrapped with `overflow-x-auto` to prevent horizontal viewport clipping on mobile/tablet viewports.
* **Modals & Dialogs:** `ConfirmDialog` and `InviteUserDialog` utilize fixed backdrop overlays with backdrop blur and responsive max-width containers (`max-w-md w-full`).

### Phase 8: Performance & Client-Side Reliability
* **Infinite Re-render / Test Timeout Vulnerability:** During Vitest execution, `reporting-recording-playback.test.tsx` and `buyers/page.test.tsx` exhibited long execution times (>5000ms), failing on DOM query assertions. Investigation revealed that multiple background `useEffect` hooks in `ReportingDashboard` (such as dropdown data population and query parameter synchronization) fire concurrently during unmocked state updates, triggering cascading re-renders.
* **Stale Workspace State:** Pages such as `audit-logs/page.tsx` and `calls/page.tsx` implement explicit cleanup refs (`currentWorkspaceIdRef.current = workspaceId; setLogs([])`) to eliminate state bleeding across workspace switches.

### Phase 9: Accessibility (a11y)
* Semantic labeling implemented on critical form inputs (`htmlFor` matching `id`).
* `ConfirmDialog` properly binds `aria-labelledby`, `aria-describedby`, and listens for the `Escape` key to close.
* Icons used in navigation and action buttons have accessible SVG roles or enclosing buttons with `aria-label` or `<span className="sr-only">`.

---

## 3. MASTER BUG SUMMARY TABLE

| Bug ID | Page / Component | Severity | Description | Status |
| :--- | :--- | :--- | :--- | :--- |
| **BUG-FE-001** | `apps/web/src/app/page.tsx` | **P0** | Default Next.js starter template exposed on public root URL `/` | Confirmed Bug |
| **BUG-FE-002** | `apps/web/src/components/header.tsx` | **P1** | `HeaderMetrics` unisolated `Promise.all` polling breaks `liveCalls` display on 403 | Confirmed Bug |
| **BUG-FE-003** | `apps/web/src/lib/payments.ts` | **P1** | Payment direction TypeScript interface defines `PAYOUT` instead of `DISBURSEMENT` | Confirmed Bug |
| **BUG-FE-004** | `apps/web/src/app/onboarding/onboarding-client.tsx` | **P1** | Post-onboarding redirect does not update `sessionStorage` or URL with new workspace ID | Confirmed Bug |
| **BUG-FE-005** | `apps/web/src/utils/supabase/middleware.ts` | **P2** | Middleware checks `/protected/invitations` but ignores `/protected/accept-invitation` | Confirmed Bug |
| **BUG-FE-006** | `apps/web/src/app/protected/reporting/page.tsx` | **P2** | LocalStorage column configuration can cause UI desync when new columns are introduced | Confirmed Bug |
| **BUG-FE-007** | `apps/web/src/lib/api.ts` | **P2** | `apiFetch` does not inject `x-workspace-id` header by default | Confirmed Bug |
| **BUG-FE-008** | `apps/web/src/app/protected/reporting/reporting-recording-playback.test.tsx` | **P2** | Test timeouts and race conditions in reporting audio playback test suite | Confirmed Bug |
| **BUG-FE-009** | `apps/web/src/app/protected/webhooks/page.tsx` | **P3** | Dead UI: No webhook testing/ping or delivery log inspection available | Confirmed Bug |
| **BUG-FE-010** | `apps/web/src/app/protected/settings/page.tsx` | **P3** | Workspace settings lacks workspace deletion or member handover controls | Confirmed Bug |
| **BUG-FE-011** | `apps/web/src/app/login/page.tsx` | **P3** | Authenticated users visiting `/login` are not redirected to `/protected` | Suspected Issue |

---

## 4. IMMEDIATE RECOMMENDATIONS FOR AGENT TEAM

1. **Replace Root Landing Page (`BUG-FE-001`):** Update `apps/web/src/app/page.tsx` to inspect the session via Supabase server client and redirect authenticated users to `/protected` and unauthenticated users to `/login`.
2. **Isolate `HeaderMetrics` Polling (`BUG-FE-002`):** Split the `Promise.all` in `apps/web/src/components/header.tsx` into independent `Promise.allSettled` or separate fetch routines so that billing 403s do not wipe out live call monitoring.
3. **Synchronize Payment Direction Contract (`BUG-FE-003`):** Align `apps/web/src/lib/payments.ts` with `apps/api` and the UI dropdown (`'COLLECTION' | 'DISBURSEMENT'`).
4. **Standardize Invitation Middleware Handling (`BUG-FE-005`):** Update middleware matcher to cover both `/protected/invitations` and `/protected/accept-invitation`.
5. **Attach `x-workspace-id` Header in `apiFetch` (`BUG-FE-007`):** Allow `apiFetch` to accept or automatically extract the workspace ID from active `sessionStorage` or request context.

---
*End of High-Level Audit Report. Refer to accompanying deliverables for exhaustive inventories, detailed bug manifests, API specifications, and test coverage matrices.*
