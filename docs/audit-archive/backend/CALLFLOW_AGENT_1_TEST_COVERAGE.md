# CALLFLOW — AGENT 1: FRONTEND TEST COVERAGE & AUDIT MATRIX

**Author:** Agent 1 (Frontend & Client-Side Architecture Specialist)  
**Test Runner:** Vitest v4.1.11 with `@vitejs/plugin-react` & JSDOM v29.1.1  
**Execution Timestamp:** November 2026  
**Execution Scope:** Full Frontend Suite (`apps/web`)  

---

## 1. AUTOMATED TEST SUITE EXECUTION SUMMARY

The frontend automated test suite was executed in full using Vitest in standard CI mode (`npm --prefix apps/web test`).

```
=============================== TEST SUMMARY ===============================
Test Files:   2 FAILED  |  29 PASSED  |  31 TOTAL
Tests:        5 FAILED  |  279 PASSED |  284 TOTAL
Duration:     290.82 seconds
Environment:  jsdom (pool: threads)
============================================================================
```

---

## 2. DETAILED BREAKDOWN OF TEST FILES & RESULTS

| Test File Path | Tests Count | Status | Execution Time | Core Features Tested |
| :--- | :--- | :--- | :--- | :--- |
| `src/app/auth.spec.ts` | 3 | **PASS** | 25ms | Supabase client auth utilities and session parsing. |
| `src/app/auth-recovery.spec.tsx` | 10 | **PASS** | 4,116ms | Forgot Password link, email input validation, recovery request submission, error handling, dev mailer inspect link. |
| `src/app/protected/audit-logs/page.test.tsx` | 23 | **PASS** | 9,049ms | Security audit logs RBAC, table rendering, action/target filtering, pagination, metadata JSON sanitization. |
| `src/app/protected/billing/page.test.tsx` | 2 | **PASS** | 1,222ms | Wallet balance section, development label, mock top-up trigger and event dispatch. |
| `src/app/protected/buyers/page.test.tsx` | 7 | **1 FAIL / 6 PASS** | 12,906ms | Buyer organization management, member scoping, vendor forbidden state, local search filtering, modal validation, archive confirmation. |
| `src/app/protected/buyers/[buyerId]/page.test.tsx` | 3 | **PASS** | 3,085ms | Buyer organization details, destination numbers list, add destination modal validation, delete confirmation. |
| `src/app/protected/calls/page.test.tsx` | 11 | **PASS** | 3,667ms | Call duration formatting (talk vs total), caller search, status filtering, filter reset. |
| `src/app/protected/calls/[callId]/page.test.tsx` | 2 | **PASS** | 618ms | Dialed destination snapshot, attempt status badges, dispute button visibility. |
| `src/app/protected/campaigns/page.test.tsx` | 7 | **PASS** | 6,213ms | Campaign cards list, commercial rates validation, conversion duration threshold input validation. |
| `src/app/protected/campaigns/[campaignId]/page.test.tsx` | 3 | **PASS** | 5,159ms | Destination waterfall priorities and weights, modal assignment. |
| `src/app/protected/disputes/page.test.tsx` | 7 | **PASS** | 4,896ms | Commercial dispute list, owner/admin dispute acceptance and rejection notes, server-side pagination. |
| `src/app/protected/members/page.test.tsx` | 10 | **PASS** | 9,367ms | Member invitations, role selection, participant entity association, invite revocation. |
| `src/app/protected/payments/page.test.tsx` | 15 | **PASS** | 20,992ms | Payment instructions table, owner execution, retry handling, direction filter (`COLLECTION` vs `DISBURSEMENT`), duplicate click prevention. |
| `src/app/protected/phone-numbers/page.test.tsx` | 14 | **PASS** | 7,317ms | Phone numbers list, vendor scoping ("Tracking Numbers"), campaign assignment, vendor assignment/unassignment. |
| `src/app/protected/reconciliation/page.test.tsx` | 12 | **PASS** | 4,416ms | Reconciliation dashboard, batch and workspace reconciliation triggers, admin execution restriction. |
| `src/app/protected/reporting/calls-by-day-chart.test.tsx` | 13 | **PASS** | 3,419ms | Dual-axis volume/revenue series rendering, empty data handling, error fallback banner. |
| `src/app/protected/reporting/outcome-distribution-chart.test.tsx` | 7 | **PASS** | 428ms | Outcome pie chart status distribution, color mapping, percentage calculation. |
| `src/app/protected/reporting/page.test.tsx` | 43 | **PASS** | 32,598ms | Comprehensive reporting metrics, CSV/XLSX export, Content-Disposition extraction, commercial dimensions scoping, destination formatting. |
| `src/app/protected/reporting/reporting-recording-playback.test.tsx` | 5 | **4 FAIL / 1 PASS** | 19,025ms | Audio playback mounting, download URL retrieval, 403 error badge, expired URL retry, cross-browser session isolation. |
| `src/app/protected/reporting/reporting-workspace-context.test.tsx` | 6 | **PASS** | 6,376ms | Workspace ID persistence in URL query parameters during filter application and reset. |
| `src/app/protected/settlements/page.test.tsx` | 5 | **PASS** | 3,937ms | Settlement batches grid, period start/end validation, batch detail line-item drawer. |
| `src/app/protected/usage/page.test.tsx` | 5 | **PASS** | 516ms | Call minutes, active phone numbers, and recording storage metric cards. |
| `src/app/protected/vendor-portal.test.tsx` | 14 | **PASS** | 5,517ms | Vendor role scoping: sidebar link hiding, commercial metrics omission, pagination, caller masking. |
| `src/app/protected/vendors/page.test.tsx` | 16 | **PASS** | 6,701ms | Vendor management table, create/edit modals, activate/deactivate confirmations, number assignment. |
| `src/components/header.test.tsx` | 3 | **PASS** | 601ms | Live calls indicator, wallet balance display, zero live calls fallback. |
| `src/components/invite-user-dialog.test.tsx` | 5 | **PASS** | 1,988ms | Buyer and vendor invitation dialog, entity binding, invitation link copy action. |
| `src/components/sidebar.spec.tsx` | 9 | **PASS** | 862ms | Role-based sidebar menu visibility across Owner, Admin, Member, Buyer, Vendor, and Viewer. |
| `src/components/ui/confirm-dialog.test.tsx` | 6 | **PASS** | 915ms | Accessible modal attributes (`dialog`, `alertdialog`), escape key listener, plain-text description wrapper. |
| `src/components/ui/recording-player.test.tsx` | 7 | **PASS** | 2,334ms | Unit tests for `InlineRecordingPlayer`: play button, API fetch, 403 denied badge, audio controls mounting. |
| `src/utils/supabase/client.spec.ts` | 1 | **PASS** | 13ms | Browser Supabase client singleton initialization. |
| `src/utils/supabase/middleware.spec.ts` | 5 | **PASS** | 50ms | Edge session token verification and protected route redirection. |

---

## 3. AUDIT OF FAILED TESTS

### Failure 1: `src/app/protected/buyers/page.test.tsx`
* **Test Name:** `renders buyer list, metric cards, and Add Buyer button for OWNER`
* **Failure Mode:** `Error: Test timed out in 5000ms.` (Actual elapsed: 6,906ms).
* **Root Cause:** In JSDOM with heavy component hierarchies and multi-promise resolution (`apiFetch` for buyers and workspaces), initial component rendering exceeded the default 5s timeout during full suite parallel execution.
* **Status:** FAILED / PERFORMANCE SENSITIVE.

### Failures 2–5: `src/app/protected/reporting/reporting-recording-playback.test.tsx`
* **Failing Tests:**
  1. `2. Clicking Play Recording fetches download URL and mounts audio element`
  2. `3. Playback error from 403 Forbidden renders Denied without crashing or redirecting`
  3. `4. Expired audio URL triggers onError handler allowing retry with fresh URL`
  4. `5. Independent browser sessions maintain distinct recording workspace routing without bleed`
* **Failure Mode:**
  * Tests 2, 3, and 4 failed on `screen.findByLabelText('Call recording audio player')` and `screen.findByText('Denied')`.
  * Test 5 timed out in 5,000ms.
* **Evidence:** In the DOM dump during test execution, the component is trapped in an active refresh cycle (`<button disabled><svg class="... animate-spin"> Refresh </button>`). In the test harness, mock resolution of `loadDropdowns` and `fetchReporting` triggered repeated re-renders, causing DOM assertions to fail.
* **Status:** FAILED.

---

## 4. AUDIT OF COMPLETELY UNTESTED FRONTEND FEATURES

The following 21 application pages and components currently have **0 automated test files** and rely strictly on manual verification:

### 4.1 Untested Public & Onboarding Pages
1. `apps/web/src/app/page.tsx` — Root redirect / landing page.
2. `apps/web/src/app/login/page.tsx` — Server Action authentication form, invite token preservation, and error handling.
3. `apps/web/src/app/signup/page.tsx` — Server Action registration form, password confirmation, and token-based auto-redirect.
4. `apps/web/src/app/invitations/page.tsx` — Public invitation token verification and bifurcated routing to signup or login.
5. `apps/web/src/app/onboarding/page.tsx` & `onboarding-client.tsx` — First-time workspace creation and redirect.

### 4.2 Untested Protected Operational Pages
6. `apps/web/src/app/protected/page.tsx` — Root protected route redirect to `/protected/reporting`.
7. `apps/web/src/app/protected/accept-invitation/page.tsx` & `client.tsx` — Client-side token acceptance lifecycle and redirect.
8. `apps/web/src/app/protected/account/page.tsx` — Profile name update, email modification, and password update via Supabase.
9. `apps/web/src/app/protected/api-keys/page.tsx` — API Key generation, raw secret copy box, and revocation dialog.
10. `apps/web/src/app/protected/blocked-callers/page.tsx` — E.164 phone number blocking and unblocking.
11. `apps/web/src/app/protected/invitations/page.tsx` — Standalone invitation accept view.
12. `apps/web/src/app/protected/members/[memberId]/page.tsx` — Fine-grained resource permission granting/revocation and buyer organization linking.
13. `apps/web/src/app/protected/payments/[instructionId]/page.tsx` — Detailed payment instruction execution logs and provider transactions.
14. `apps/web/src/app/protected/reconciliation/[runId]/page.tsx` — Detailed reconciliation run discrepancy inspect table.
15. `apps/web/src/app/protected/settings/page.tsx` — Workspace rename form and owner/admin authorization check.
16. `apps/web/src/app/protected/vendors/[vendorId]/page.tsx` — Vendor detail profile, number assignment drawer, and unassign dialog.
17. `apps/web/src/app/protected/webhooks/page.tsx` — Webhook endpoint registration, signing secret display, and deletion dialog.

### 4.3 Untested Shared Layout Components
18. `apps/web/src/components/workspace-validator.tsx` — Session-isolated active workspace memory, URL sync, and access denied screens.
19. `apps/web/src/components/workspace-selector.tsx` — Header dropdown switching active workspace and updating session storage.
20. `apps/web/src/components/appearance-settings.tsx` — Theme toggle controls (Light / Dark / System).
21. `apps/web/src/components/shell.tsx` — Responsive mobile drawer backdrop toggle and layout structure.

---

## 5. FEATURE STATUS SUMMARY TABLE

| Feature / Domain | Automated Test Coverage | Live Audit Status | Notes & Blockers |
| :--- | :--- | :--- | :--- |
| **Authentication (Login & Signup)** | Partial (`auth.spec.ts`, `auth-recovery.spec.tsx`) | **Partially Tested** | Missing tests for `login/page.tsx` and `signup/page.tsx` Server Actions. |
| **Password Recovery** | 10 Tests (`auth-recovery.spec.tsx`) | **PASS** | Full test coverage for forgot-password and reset-password. |
| **Onboarding Flow** | None | **Untested** | Lacks automated test; redirect defect discovered during audit. |
| **Workspace Routing & Validation** | 6 Tests (`reporting-workspace-context.test.tsx`) | **Tested** | `WorkspaceValidator` component itself lacks dedicated unit test file. |
| **Call Logs & Detail** | 13 Tests (`calls/page.test.tsx`, `calls/[callId]/page.test.tsx`) | **PASS** | Full coverage of durations, dialed destinations, and dispute triggers. |
| **Reporting Analytics & KPI Cards** | 43 Tests (`reporting/page.test.tsx`) | **PASS** | Full coverage of volume, financial dimensions, exports, and status tables. |
| **Reporting Visual Charts** | 20 Tests (`calls-by-day-chart.test.tsx`, `outcome-distribution-chart.test.tsx`) | **PASS** | Recharts rendering verified with left/right axis checks and empty fallbacks. |
| **Audio Playback in Reporting** | 5 Tests (`reporting-recording-playback.test.tsx`) | **FAILED (4 Tests)** | Trapped in re-render loop in integration harness; unit tests in `recording-player.test.tsx` pass. |
| **Campaigns & Waterfall** | 10 Tests (`campaigns/page.test.tsx`, `campaigns/[campaignId]/page.test.tsx`) | **PASS** | Full coverage of commercial rates, duration thresholds, and waterfall ordering. |
| **Buyers & Destinations** | 10 Tests (`buyers/page.test.tsx`, `buyers/[buyerId]/page.test.tsx`) | **FAILED (1 Test Timeout)** | 9 tests passed; initial mount test timed out at 6.9s. |
| **Vendors & Number Assignment** | 30 Tests (`vendors/page.test.tsx`, `vendor-portal.test.tsx`) | **PASS** | Scoping, RBAC, number assignments, and participant masking fully verified. |
| **Telephony Ingress & Provisioning**| 14 Tests (`phone-numbers/page.test.tsx`) | **PASS** | Full coverage of vendor scoping and Telnyx provisioning. |
| **Disputes Resolution** | 7 Tests (`disputes/page.test.tsx`) | **PASS** | Verified acceptance/rejection flow, notes, and commercial adjustments. |
| **Settlement Batches** | 5 Tests (`settlements/page.test.tsx`) | **PASS** | Verified batch generation, period validation, and line-item drawer. |
| **Payment Instructions** | 15 Tests (`payments/page.test.tsx`) | **PASS** | Full coverage of execution, retry, duplicate prevention, and direction filters. |
| **Reconciliation Dashboard** | 12 Tests (`reconciliation/page.test.tsx`) | **PASS** | Full coverage of workspace & batch reconciliation triggers. |
| **Security Audit Logs** | 23 Tests (`audit-logs/page.test.tsx`) | **PASS** | Full coverage of RBAC, metadata sanitization, and filtering. |
| **API Keys & Webhooks** | None | **Untested** | Developer portals lack automated test suites. |
| **User Profile & Account Settings**| None | **Untested** | Account settings lack automated test suites. |
| **Header Metrics Polling** | 3 Tests (`header.test.tsx`) | **Partially Tested** | Verified normal display; untested for 403 Forbidden unhandled rejection defect. |
| **Accessible Dialogs** | 11 Tests (`confirm-dialog.test.tsx`, `invite-user-dialog.test.tsx`) | **PASS** | Full verification of accessible attributes and keyboard navigation. |
