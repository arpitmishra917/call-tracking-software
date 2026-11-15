# CALLFLOW — AGENT 1: CANONICAL BUG REGISTER & DISCREPANCY RECONCILIATION

**Author:** Agent 1 (Frontend & Client-Side Architecture Specialist)  
**Status:** Reconciled Canonical Register  
**Application Scope:** `apps/web`  

---

## 1. RECONCILIATION OF PREVIOUS AUDIT DISCREPANCIES

During Phase 0 and Phase 1, multiple reports presented differing counts due to semantic grouping differences:
1. **The "22 Findings" Discrepancy:** The initial executive summary cited "22 findings", which actually represented the **22 total application routes** audited across the Next.js App Router tree. This was conflated in earlier text as 22 bugs.
2. **The "11 vs 13 Entries" Discrepancy:** The initial Master Bug table listed 11 items (`BUG-FE-001` through `BUG-FE-011`), while Section 4 of the detailed report listed two additional items (`BUG-FE-012` and `BUG-FE-013`). Furthermore, `BUG-FE-007` (Workspace Header Claim) was incorrectly classified as a confirmed bug, whereas inspection of backend authorization guards (`WorkspaceRolesGuard`) proves it is an invalid assumption.
3. **Missing Features vs Bugs:** Items regarding missing webhook test delivery logs (`BUG-FE-012`) and missing workspace deletion danger zone (`BUG-FE-013`) are **Feature Requests / Incomplete Scope**, not broken existing features.

This document establishes the **single, immutable, canonical register** for all frontend findings.

---

## 2. CANONICAL CLASSIFICATION TAXONOMY

* **Confirmed Bug (CB):** Proven defect in existing frontend code that violates specification, causes runtime crashes, breaks contracts, or prevents core operations.
* **Suspected Bug (SB):** Potential defect requiring real backend integration or production environment validation.
* **Feature Request (FR):** Missing capability that is not yet implemented in product specifications.
* **Missing Test Coverage (MTC):** Implemented functionality currently lacking automated regression test suites.
* **Design / Usability Recommendation (DUR):** Working feature that has UX, accessibility, or visual ergonomics room for improvement.

---

## 3. CANONICAL REGISTER

### 3.1 Confirmed Bugs (CB)

| Canonical ID | Severity | File & Line | Component / Module | Problem Summary | Remediation Plan |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **CB-FE-001** | **P1** | `apps/web/src/app/page.tsx`<br>L1–69 | Root Landing Page | Default Next.js template renders at `/` with Vercel deploy buttons instead of evaluating authentication and redirecting to `/protected` or `/login`. | Replace with server component that inspects Supabase session and redirects to `/protected` (if authenticated) or `/login` (if unauthenticated). |
| **CB-FE-002** | **P1** | `apps/web/src/utils/supabase/middleware.ts`<br>L62–70 | Edge Session Middleware | Middleware only checks `/protected/invitations` and redirects unauthenticated users to `/signup`, while ignoring `/protected/accept-invitation` (redirects to `/login` without preserving token). | Expand middleware matcher to cover both invitation acceptance paths and safely route unauthenticated invitees to `/invitations?token=...`. |
| **CB-FE-003** | **P1** | `apps/web/src/components/header.tsx`<br>L24–41 | Global Header (`HeaderMetrics`) | `live-calls` and `billing/balance` are fetched in an atomic `Promise.all`. For `VENDOR` and `BUYER` roles, billing returns HTTP 403, which rejects the entire promise and permanently resets `liveCalls` to `—`. | Isolate the two calls with `Promise.allSettled` so that a billing 403 never prevents `liveCalls` from rendering. |
| **CB-FE-004** | **P2** | `apps/web/src/lib/payments.ts`<br>L22 | Payments Client Library | Interface `PaymentInstruction.direction` is typed as `'COLLECTION' \| 'PAYOUT'`, whereas Prisma schema, backend service, and UI enforce `'COLLECTION' \| 'DISBURSEMENT'`. | Correct type definition to `'COLLECTION' \| 'DISBURSEMENT'` and verify consistency across all usages. |
| **CB-FE-005** | **P1** | `apps/web/src/app/onboarding/onboarding-client.tsx`<br>L42–47 | Onboarding Client | Form ignores the JSON response from `POST /workspaces`, does not update `sessionStorage`, and pushes to `/protected` without `?workspace=`, causing a redirect loop/lag in `WorkspaceValidator`. | Parse response body to obtain `{ id }`, write `callflow.active_workspace_id` to `sessionStorage`, and navigate directly to `/protected/reporting?workspace=${id}`. |
| **CB-FE-006** | **P1** | `apps/web/src/app/protected/reporting/page.tsx`<br>L619–668 | Reporting Dashboard | `fetchReporting` depends on unstable `searchParams` object and updates `campaigns` state unconditionally, creating an infinite fetch/re-render loop that breaks recording playback tests. | Stabilize dependencies using `searchParams.toString()`, guard `setCampaigns` against redundant updates, and decouple dropdown updates. |
| **CB-FE-007** | **P2** | `apps/web/src/app/protected/reporting/page.tsx`<br>L392–425 | Reporting Column Customizer | Restoring columns from `localStorage` can fail if new columns were added to `DEFAULT_COLUMNS` or if stored payload has corrupted entries. | Safely merge stored preferences with `DEFAULT_COLUMNS` by checking `Array.isArray` and appending any newly introduced columns with their defaults. |
| **CB-FE-008** | **P2** | `apps/web/src/lib/api.ts`<br>L21–24 | Core API Client (`apiFetch`) | `apiFetch` throws raw `res.text()` on HTTP errors, causing unparsed NestJS JSON error bodies (`{"message":["..."]}`) to be displayed to users. | Add safe JSON error body parsing to extract `message` strings cleanly, matching the implementation in `apiDownload`. |
| **CB-FE-009** | **P2** | `apps/web/src/app/protected/buyers/page.test.tsx`<br>L73–102 | Buyers Page Test Suite | Initial render test exceeds 5s Vitest timeout under thread contention due to redundant initial mounts and unoptimized state updates. | Optimize initial state resolution in `BuyersPage` to ensure clean synchronous rendering in test environments. |

---

### 3.2 Suspected Bugs (SB)

| Canonical ID | Severity | File & Line | Component | Hypothesis / Condition |
| :--- | :--- | :--- | :--- | :--- |
| **SB-FE-001** | **P3** | `apps/web/src/app/login/page.tsx`<br>L9–30 | Login / Signup | Already-authenticated users who navigate to `/login` or `/signup` are presented with the login form rather than being redirected to `/protected`. |

---

### 3.3 Rejected / Invalid Findings (INV)

| Canonical ID | Original Ref | File | Original Claim | Rejection Evidence |
| :--- | :--- | :--- | :--- | :--- |
| **INV-FE-001** | `BUG-FE-007` | `apps/web/src/lib/api.ts` | Claimed that `apiFetch` was broken because it does not inject `x-workspace-id` HTTP header. | **REJECTED.** Backend `WorkspaceRolesGuard` explicitly extracts workspace context from `request.params.workspaceId`, `request.query.workspaceId`, or `request.body.workspaceId`. It does **not** rely on `x-workspace-id`. Injecting client-claimed workspace IDs via headers is unnecessary and violates tenant security principles. |

---

### 3.4 Feature Requests (FR)

| Canonical ID | Page / Component | Requested Capability | Justification |
| :--- | :--- | :--- | :--- |
| **FR-FE-001** | `/protected/webhooks` | Webhook Ping & Delivery Logs | Developer ergonomics improvement; not currently part of the MVP scope. |
| **FR-FE-002** | `/protected/settings` | Workspace Deletion / Ownership Transfer | Administrative danger zone; requires coordination with Agent 2 and Agent 3. |

---

### 3.5 Missing Test Coverage (MTC)

The following 15 areas currently lack automated regression test suites:
* **MTC-FE-001:** Root Redirect (`app/page.tsx`)
* **MTC-FE-002:** Login & Signup Server Actions (`app/login/page.tsx`, `app/signup/page.tsx`)
* **MTC-FE-003:** Public Invitation Verification (`app/invitations/page.tsx`)
* **MTC-FE-004:** Onboarding Flow (`app/onboarding/page.tsx`, `onboarding-client.tsx`)
* **MTC-FE-005:** Workspace Selector Dropdown (`components/workspace-selector.tsx`)
* **MTC-FE-006:** Workspace Validator Component (`components/workspace-validator.tsx`)
* **MTC-FE-007:** Account Profile & Security Settings (`app/protected/account/page.tsx`)
* **MTC-FE-008:** Developer API Keys Portal (`app/protected/api-keys/page.tsx`)
* **MTC-FE-009:** Blocked Callers Management (`app/protected/blocked-callers/page.tsx`)
* **MTC-FE-010:** Granular Member Permissions (`app/protected/members/[memberId]/page.tsx`)
* **MTC-FE-011:** Payment Instruction Detail Inspection (`app/protected/payments/[instructionId]/page.tsx`)
* **MTC-FE-012:** Reconciliation Discrepancy Detail (`app/protected/reconciliation/[runId]/page.tsx`)
* **MTC-FE-013:** Vendor Detail Profile & Numbers (`app/protected/vendors/[vendorId]/page.tsx`)
* **MTC-FE-014:** Developer Webhooks Management (`app/protected/webhooks/page.tsx`)
* **MTC-FE-015:** Responsive Shell & Mobile Menu Drawer (`components/shell.tsx`)

---

## 4. CANONICAL SUMMARY

* **Total Confirmed Bugs to Fix:** 9 (`CB-FE-001` through `CB-FE-009`)
* **Total Suspected Bugs:** 1 (`SB-FE-001`)
* **Total Rejected Claims:** 1 (`INV-FE-001`)
* **Total Feature Requests:** 2 (`FR-FE-001`, `FR-FE-002`)
* **Total Missing Test Coverage Areas:** 15 (`MTC-FE-001` through `MTC-FE-015`)
