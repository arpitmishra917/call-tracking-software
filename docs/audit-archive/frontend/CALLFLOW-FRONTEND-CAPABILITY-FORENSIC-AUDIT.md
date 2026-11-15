# CallFlow — Comprehensive Frontend Capability & UI Forensic Audit

**Audit Type:** Complete Frontend Inventory, Component Catalog, API Mapping & UI Forensic Audit  
**Repository Path:** `C:\Projects\callflow-agent-a`  
**Git Baseline HEAD:** `b5a23ceb38d2aa08441dcc9fedb6bdefadd09d80`  
**Audit Date:** 2026-10-22  
**Audit Mode:** READ-ONLY FORENSIC AUDIT (Zero application code changes, zero database writes, zero process interruptions)  

> [!NOTE]
> This report provides an authoritative, evidence-backed inventory of the entire CallFlow frontend application (`apps/web`), including all 31 routes/pages, shared components, client-side state, form validations, modal workflows, API integrations, authentication guards, RBAC/participant scoping, test suites, and UI states. It is designed to be directly compared against browser screenshots and the companion backend audit.

## Table of Contents
1. [Section A: Executive Summary](#section-a-executive-summary)
2. [Section B: Complete Route and Page Catalog (31 Pages)](#section-b-complete-route-and-page-catalog)
3. [Section C: Component and User-Action Inventory](#section-c-component-and-user-action-inventory)
4. [Section D: Frontend-to-Backend Endpoint Mapping](#section-d-frontend-to-backend-endpoint-mapping)
5. [Section E: UI-Only, Mock, Placeholder, and Disconnected Features](#section-e-ui-only-mock-placeholder-and-disconnected-features)
6. [Section F: Authentication, RBAC, and Workspace-Context Findings](#section-f-authentication-rbac-and-workspace-context-findings)
7. [Section G: Missing Loading, Error, Validation, and Responsive States](#section-g-missing-loading-error-validation-and-responsive-states)
8. [Section H: Frontend Testing and Verification Matrix](#section-h-frontend-testing-and-verification-matrix)
9. [Section I: Preliminary Backend-versus-Frontend Gap Candidates](#section-i-preliminary-backend-versus-frontend-gap-candidates)
10. [Section J: Browser Screenshot Checklist](#section-j-browser-screenshot-checklist)
11. [Section K: Prioritized Findings (P0, P1, P2, P3)](#section-k-prioritized-findings)
12. [Section L: Evidence Index](#section-l-evidence-index)

---

## Section A: Executive Summary

The CallFlow frontend is a modern web application built on **Next.js 16.3.5 (App Router)** and **React 19.2.8**, styled with **Tailwind CSS v4**, Lucide icons, and Recharts. It is designed around multi-tenant workspace routing, Supabase GoTrue authentication, and synchronous REST communication with a local NestJS API.

### Architecture & Technology Stack
- **Framework & Runtime:** Next.js 16.3.5 (App Router, Server Components + Client Components), React 19.2.8.
- **Styling & UI Components:** Tailwind CSS v4, `clsx`, `tailwind-merge`, `lucide-react` 1.48.0, `next-themes` 0.4.6.
- **Data Visualization:** `recharts` 3.10.1 (ResponsiveContainer, BarChart, LineChart, AreaChart, PieChart).
- **Authentication & Identity:** Supabase SSR (`@supabase/ssr` 0.12.7, `@supabase/supabase-js` 2.116.0) with cookie session storage and Bearer JWT propagation to the API.
- **API Client:** Centralized `apiFetch` and `apiDownload` utilities located at [`apps/web/src/lib/api.ts`](file:///C:/Projects/callflow-agent-a/apps/web/src/lib/api.ts), with domain-specific SDK wrappers for Payments ([`lib/payments.ts`](file:///C:/Projects/callflow-agent-a/apps/web/src/lib/payments.ts)) and Reconciliation ([`lib/reconciliation.ts`](file:///C:/Projects/callflow-agent-a/apps/web/src/lib/reconciliation.ts)).
- **Testing Framework:** Vitest 4.1.11 with `@testing-library/react` 16.3.3 and `jsdom` 29.1.1.

### High-Level Forensic Findings
1. **Route Completeness:** Exactly **31 unique pages** exist across the App Router hierarchy (5 public/auth pages, 1 onboarding page, and 25 protected workspace pages).
2. **Authoritative Context Binding:** Protected pages operate inside [`ProtectedLayout`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/layout.tsx) and [`WorkspaceValidator`](file:///C:/Projects/callflow-agent-a/apps/web/src/components/workspace-validator.tsx), strictly maintaining the authoritative workspace UUID in URL search parameters (`?workspace=${id}`) and preventing cross-tenant bleed or invalid workspace fetches.
3. **Role & Participant Scoping:** The navigation sidebar ([`components/sidebar.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/components/sidebar.tsx)) dynamically gates routes based on workspace role (`OWNER`, `ADMIN`, `MEMBER`, `VIEWER`) and participant type (`INTERNAL`, `BUYER`, `VENDOR`). Vendors are restricted from routing, disputes, and financial creation. Payments and Reconciliation are visible only to Owners/Admins or explicitly permitted Members.
4. **Commercial & Settlement UI Maturity:** The commercial dispute flow, settlement batch generation modal, item inspection drawer, payment instruction executor, and 3-way reconciliation viewer are fully coded and connected to their respective backend services.
5. **Testing Verification:** **14 test files** comprising **107 test cases** cover critical frontend surfaces (reporting metrics, commercial disputes, settlements, payments, reconciliation, vendor scoping, and auth middleware). All 107 tests execute and pass cleanly.

---

## Section B: Complete Route and Page Catalog

The application discovers **31 pages** in `apps/web/src/app`. Every page is forensically categorized below:

| Route Pathname | Component & File | Type | Purpose & Main Sections | API Endpoints Called | Auth & Workspace Context | Tested Status |
| :--- | :--- | :---: | :--- | :--- | :--- | :---: |
| `/invitations` | [`InvitationPage`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/invitations/page.tsx)<br>(`apps/web/src/app/invitations/page.tsx`) | Server Component | **Public invitation landing page for external users with invitation token** | `${apiUrl}/invitations/verify/${token}` | **Auth:** Public / Unauthenticated<br>**Context:** None<br>**Roles:** All Workspace Roles | ⚠️ No direct test |
| `/login` | [`LoginPage`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/login/page.tsx)<br>(`apps/web/src/app/login/page.tsx`) | Server Component | **Supabase email/password login and OAuth redirection** | `${apiUrl}/invitations/verify/${token}` | **Auth:** Public / Unauthenticated<br>**Context:** None<br>**Roles:** All Workspace Roles | ⚠️ No direct test |
| `/onboarding` | [`OnboardingPage`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/onboarding/page.tsx)<br>(`apps/web/src/app/onboarding/page.tsx`) | Server Component | **First-time user onboarding flow to create initial workspace** | `${apiUrl}/workspaces` | **Auth:** Public / Unauthenticated<br>**Context:** None<br>**Roles:** All Workspace Roles | ⚠️ No direct test |
| `/` | [`Home`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/page.tsx)<br>(`apps/web/src/app/page.tsx`) | Server Component | **Public marketing landing page redirecting to login or protected app** | *None (Static/Client)* | **Auth:** Public / Unauthenticated<br>**Context:** None<br>**Roles:** All Workspace Roles | ⚠️ No direct test |
| `/protected/accept-invitation` | [`AcceptInvitationPage`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/accept-invitation/page.tsx)<br>(`apps/web/src/app/protected/accept-invitation/page.tsx`) | Server Component | **Authenticated in-app invitation acceptance view** | *None (Static/Client)* | **Auth:** Authenticated Supabase Session<br>**Context:** Authoritative Workspace Context (?workspace=UUID)<br>**Roles:** Authenticated User | ⚠️ No direct test |
| `/protected/account` | [`AccountPage`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/account/page.tsx)<br>(`apps/web/src/app/protected/account/page.tsx`) | Client (`use client`) | **User profile management, display name update, and password changes** | `/account`<br>`/account/profile` | **Auth:** Authenticated Supabase Session<br>**Context:** Authoritative Workspace Context (?workspace=UUID)<br>**Roles:** Authenticated User | ⚠️ No direct test |
| `/protected/api-keys` | [`ApiKeysPage`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/api-keys/page.tsx)<br>(`apps/web/src/app/protected/api-keys/page.tsx`) | Client (`use client`) | **Developer API key generation (SHA-256 tokens) and revocation** | `/workspaces/${id}/api-keys`<br>`/workspaces/${workspaceId}/api-keys`<br>`/workspaces/${workspaceId}/api-keys/${revokeId}` | **Auth:** Authenticated Supabase Session<br>**Context:** Authoritative Workspace Context (?workspace=UUID)<br>**Roles:** Restricted to OWNER and ADMIN | ⚠️ No direct test |
| `/protected/billing` | [`BillingPage`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/billing/page.tsx)<br>(`apps/web/src/app/protected/billing/page.tsx`) | Client (`use client`) | **Micro-dollar wallet balance display, transaction history ledger, and Stripe top-up/portal** | `/workspaces/${workspaceId}/billing`<br>`/workspaces/${workspaceId}/billing/balance`<br>`/workspaces/${workspaceId}/billing/wallet/transactions`<br>`/workspaces/${workspaceId}/billing/checkout`<br>`/workspaces/${workspaceId}/billing/portal`<br>`/workspaces/${workspaceId}/billing/wallet/mock-topup` | **Auth:** Authenticated Supabase Session<br>**Context:** Authoritative Workspace Context (?workspace=UUID)<br>**Roles:** Restricted to OWNER and ADMIN | ✅ Yes (`page.test.tsx`) |
| `/protected/blocked-callers` | [`BlockedCallersPage`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/blocked-callers/page.tsx)<br>(`apps/web/src/app/protected/blocked-callers/page.tsx`) | Client (`use client`) | **Caller blacklist management (E.164 phone number blocking and unblocking)** | `/workspaces/${id}/blocked-callers`<br>`/workspaces/${workspaceId}/blocked-callers`<br>`/workspaces/${workspaceId}/blocked-callers/${unblockId}` | **Auth:** Authenticated Supabase Session<br>**Context:** Authoritative Workspace Context (?workspace=UUID)<br>**Roles:** Restricted to OWNER and ADMIN | ⚠️ No direct test |
| `/protected/buyers` | [`BuyersPage`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/buyers/page.tsx)<br>(`apps/web/src/app/protected/buyers/page.tsx`) | Client (`use client`) | **Buyer partner directory, destination phone configuration, and timeout limits** | `/workspaces/${workspaceId}/buyers`<br>`/workspaces/${workspaceId}/buyers/${editingBuyer.id}`<br>`/workspaces/${workspaceId}/buyers/${id}/activate`<br>`/workspaces/${workspaceId}/buyers/${deactivatingBuyer.id}/archive` | **Auth:** Authenticated Supabase Session<br>**Context:** Authoritative Workspace Context (?workspace=UUID)<br>**Roles:** Hidden from VENDOR; requires buyer:read/write | ⚠️ No direct test |
| `/protected/buyers/[buyerId]` | [`BuyerDetailPage`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/buyers/[buyerId]/page.tsx)<br>(`apps/web/src/app/protected/buyers/[buyerId]/page.tsx`) | Client (`use client`) | **Buyer partner detail and configuration editor** | `/workspaces/${workspaceId}/buyers/${buyerId}` | **Auth:** Authenticated Supabase Session<br>**Context:** Authoritative Workspace Context (?workspace=UUID)<br>**Roles:** Hidden from VENDOR; requires buyer:read/write | ⚠️ No direct test |
| `/protected/calls` | [`CallsPage`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/calls/page.tsx)<br>(`apps/web/src/app/protected/calls/page.tsx`) | Client (`use client`) | **Live and historical call logs with duration filters, status badges, and pagination** | `/workspaces/${workspaceId}/recordings/${recordingId}/download`<br>`/workspaces`<br>`/workspaces/${workspaceId}/phone-numbers`<br>`/workspaces/${workspaceId}/campaigns`<br>`/workspaces/${workspaceId}/calls?${query.toString()}` | **Auth:** Authenticated Supabase Session<br>**Context:** Authoritative Workspace Context (?workspace=UUID)<br>**Roles:** All Workspace Roles | ✅ Yes (`page.test.tsx`) |
| `/protected/calls/[callId]` | [`CallDetailPage`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/calls/[callId]/page.tsx)<br>(`apps/web/src/app/protected/calls/[callId]/page.tsx`) | Client (`use client`) | **Individual call detail view with call attempts, recording player, and dispute creation modal** | `/workspaces`<br>`/workspaces/${workspaceId}/calls/${callId}`<br>`/workspaces/${workspaceId}/call-commercials/${call.commercial.id}/dispute`<br>`/workspaces/${workspaceId}/disputes/${call.commercial.dispute.id}/resolve`<br>`/workspaces/${workspaceId}/recordings/${call.recordings[0].id}/download` | **Auth:** Authenticated Supabase Session<br>**Context:** Authoritative Workspace Context (?workspace=UUID)<br>**Roles:** All Workspace Roles | ✅ Yes (`page.test.tsx`) |
| `/protected/campaigns` | [`CampaignsPage`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/campaigns/page.tsx)<br>(`apps/web/src/app/protected/campaigns/page.tsx`) | Client (`use client`) | **Inbound routing campaign directory, status toggles (active/paused), and campaign creation** | `/workspaces/${workspaceId}/campaigns?status=${statusTab}&search=${encodeURIComponent(debouncedSearch)}&limit=${limit}&offset=${offset}`<br>`/workspaces/${workspaceId}/buyers`<br>`/workspaces/${workspaceId}/campaigns`<br>`/workspaces/${workspaceId}/campaigns/${selectedCampaignId}/buyers`<br>`/workspaces/${workspaceId}/campaigns/${campaignId}/buyers/${buyerId}`<br>`/workspaces/${workspaceId}/campaigns/${campaignId}/buyers/reorder`<br>`/workspaces/${workspaceId}/phone-numbers`<br>`/workspaces/${workspaceId}/campaigns/${selectedCampaignId}/phone-numbers`<br>`/workspaces/${workspaceId}/campaigns/${campaignId}/phone-numbers/${phoneNumberId}`<br>`/workspaces/${workspaceId}/campaigns/${campaignToEdit.id}`<br>`/workspaces/${workspaceId}/campaigns/${campaignId}/activate`<br>`/workspaces/${workspaceId}/campaigns/${campaignToDeactivate.id}/archive` | **Auth:** Authenticated Supabase Session<br>**Context:** Authoritative Workspace Context (?workspace=UUID)<br>**Roles:** Hidden from VENDOR; requires campaign:read/write | ⚠️ No direct test |
| `/protected/campaigns/[campaignId]` | [`CampaignDetailPage`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/campaigns/[campaignId]/page.tsx)<br>(`apps/web/src/app/protected/campaigns/[campaignId]/page.tsx`) | Client (`use client`) | **Campaign configuration, tracking number association, and sequential buyer cascade priority ordering** | `/workspaces/${workspaceId}/campaigns/${campaignId}` | **Auth:** Authenticated Supabase Session<br>**Context:** Authoritative Workspace Context (?workspace=UUID)<br>**Roles:** Hidden from VENDOR; requires campaign:read/write | ⚠️ No direct test |
| `/protected/disputes` | [`DisputesPage`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/disputes/page.tsx)<br>(`apps/web/src/app/protected/disputes/page.tsx`) | Client (`use client`) | **Commercial disputes workbench with dispute review and manager accept/reject actions** | `/workspaces`<br>`/workspaces/${workspaceId}/calls?limit=100`<br>`/workspaces/${workspaceId}/disputes/${resolvingDispute.id}/resolve` | **Auth:** Authenticated Supabase Session<br>**Context:** Authoritative Workspace Context (?workspace=UUID)<br>**Roles:** Hidden from VIEWER and VENDOR; requires dispute:manage for resolution | ✅ Yes (`page.test.tsx`) |
| `/protected/invitations` | [`AcceptInvitationPage`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/invitations/page.tsx)<br>(`apps/web/src/app/protected/invitations/page.tsx`) | Client (`use client`) | **Pending workspace invitations list and revocation actions** | `/workspaces/accept-invitation` | **Auth:** Authenticated Supabase Session<br>**Context:** Authoritative Workspace Context (?workspace=UUID)<br>**Roles:** Restricted to OWNER and ADMIN | ⚠️ No direct test |
| `/protected/members` | [`MembersPage`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/members/page.tsx)<br>(`apps/web/src/app/protected/members/page.tsx`) | Client (`use client`) | **Workspace team member directory, role assignment, member removal, and invitation issuance** | `/workspaces`<br>`/workspaces/${workspaceId}/members`<br>`/workspaces/${workspaceId}/invitations`<br>`/workspaces/${workspaceId}/vendors`<br>`/workspaces/${workspaceId}/buyers`<br>`/workspaces/${workspaceId}/members/${removeId}`<br>`/workspaces/${workspaceId}/invitations/${inviteId}`<br>`/workspaces/${workspaceId}/members/${userId}/role` | **Auth:** Authenticated Supabase Session<br>**Context:** Authoritative Workspace Context (?workspace=UUID)<br>**Roles:** Restricted to OWNER and ADMIN | ⚠️ No direct test |
| `/protected/members/[memberId]` | [`MemberPermissionsPage`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/members/[memberId]/page.tsx)<br>(`apps/web/src/app/protected/members/[memberId]/page.tsx`) | Client (`use client`) | **Granular member permission editor with resource scoping (ALL, CAMPAIGN, BUYER, VENDOR)** | `/workspaces/${workspaceId}/members`<br>`/workspaces/${workspaceId}/permissions`<br>`/workspaces/${workspaceId}/permissions/members/${trueMemberId}`<br>`/workspaces/${workspaceId}/campaigns`<br>`/workspaces/${workspaceId}/phone-numbers`<br>`/workspaces/${workspaceId}/buyers`<br>`/workspaces/${workspaceId}/vendors`<br>`/workspaces/${workspaceId}/permissions/members/${member.id}/${selectedPermission}` | **Auth:** Authenticated Supabase Session<br>**Context:** Authoritative Workspace Context (?workspace=UUID)<br>**Roles:** Restricted to OWNER and ADMIN | ⚠️ No direct test |
| `/protected` | [`ProtectedPage`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/page.tsx)<br>(`apps/web/src/app/protected/page.tsx`) | Client (`use client`) | **Protected dashboard overview displaying high-level call volume and metrics** | *None (Static/Client)* | **Auth:** Authenticated Supabase Session<br>**Context:** Authoritative Workspace Context (?workspace=UUID)<br>**Roles:** All Workspace Roles | ⚠️ No direct test |
| `/protected/payments` | [`PaymentsPage`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/payments/page.tsx)<br>(`apps/web/src/app/protected/payments/page.tsx`) | Client (`use client`) | **Payment instructions directory, collection/disbursement tracking, and manual execution trigger** | `/workspaces`<br>`lib:listPaymentInstructions`<br>`lib:createPaymentExecution`<br>`lib:retryPaymentExecution` | **Auth:** Authenticated Supabase Session<br>**Context:** Authoritative Workspace Context (?workspace=UUID)<br>**Roles:** Hidden from VENDOR/BUYER/VIEWER; requires OWNER/ADMIN or payment:read | ✅ Yes (`page.test.tsx`) |
| `/protected/payments/[instructionId]` | [`PaymentDetailPage`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/payments/[instructionId]/page.tsx)<br>(`apps/web/src/app/protected/payments/[instructionId]/page.tsx`) | Client (`use client`) | **Payment instruction detail view with execution history and retry action** | `/workspaces`<br>`lib:getPaymentInstruction`<br>`lib:createPaymentExecution`<br>`lib:retryPaymentExecution` | **Auth:** Authenticated Supabase Session<br>**Context:** Authoritative Workspace Context (?workspace=UUID)<br>**Roles:** Hidden from VENDOR/BUYER/VIEWER; requires payment:read | ⚠️ No direct test |
| `/protected/phone-numbers` | [`PhoneNumbersPage`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/phone-numbers/page.tsx)<br>(`apps/web/src/app/protected/phone-numbers/page.tsx`) | Client (`use client`) | **Inbound tracking number inventory, provisioning modal, and campaign assignment** | `/workspaces/${workspaceId}/phone-numbers`<br>`/workspaces/${workspaceId}/campaigns`<br>`/workspaces/${id}/phone-numbers`<br>`/workspaces/${workspaceId}/campaigns/${selectedCampaignId}/phone-numbers`<br>`/workspaces/${workspaceId}/campaigns/${selectedPhone.campaign_id}/phone-numbers/${selectedPhone.id}`<br>`/workspaces/${workspaceId}/phone-numbers/${selectedPhone.id}` | **Auth:** Authenticated Supabase Session<br>**Context:** Authoritative Workspace Context (?workspace=UUID)<br>**Roles:** Hidden from VENDOR; requires phone_number:read/create | ✅ Yes (`page.test.ts`) |
| `/protected/reconciliation` | [`ReconciliationPage`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/reconciliation/page.tsx)<br>(`apps/web/src/app/protected/reconciliation/page.tsx`) | Client (`use client`) | **Financial 3-way reconciliation runs dashboard and manual trigger** | `/workspaces`<br>`lib:runBatchReconciliation`<br>`lib:runWorkspaceReconciliation`<br>`lib:listReconciliationRuns` | **Auth:** Authenticated Supabase Session<br>**Context:** Authoritative Workspace Context (?workspace=UUID)<br>**Roles:** Hidden from VENDOR/BUYER/VIEWER; requires OWNER/ADMIN or reconciliation:read | ✅ Yes (`page.test.tsx`) |
| `/protected/reconciliation/[runId]` | [`ReconciliationDetailPage`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/reconciliation/[runId]/page.tsx)<br>(`apps/web/src/app/protected/reconciliation/[runId]/page.tsx`) | Client (`use client`) | **Reconciliation run inspection view displaying detailed audit discrepancy issues** | `/workspaces`<br>`lib:getReconciliationRun`<br>`lib:listReconciliationIssues` | **Auth:** Authenticated Supabase Session<br>**Context:** Authoritative Workspace Context (?workspace=UUID)<br>**Roles:** Hidden from VENDOR/BUYER/VIEWER; requires reconciliation:read | ⚠️ No direct test |
| `/protected/reporting` | [`ReportingDashboard`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/reporting/page.tsx)<br>(`apps/web/src/app/protected/reporting/page.tsx`) | Client (`use client`) | **Comprehensive KPI analytics dashboard, time-series charts, saved reports, and export triggers** | `/workspaces/${workspaceId}/reports`<br>`/workspaces/${workspaceId}/reports/${id}`<br>`/workspaces/${workspaceId}/reports/export`<br>`/workspaces/${workspaceId}/calls/metrics?${q.toString()}`<br>`/workspaces/${workspaceId}/calls?${callsQ.toString()}`<br>`/workspaces/${workspaceId}/calls/live-calls` | **Auth:** Authenticated Supabase Session<br>**Context:** Authoritative Workspace Context (?workspace=UUID)<br>**Roles:** All Workspace Roles | ✅ Yes (`page.test.tsx`) |
| `/protected/settings` | [`SettingsPage`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/settings/page.tsx)<br>(`apps/web/src/app/protected/settings/page.tsx`) | Client (`use client`) | **Workspace name, timezone, currency, and general settings configuration** | `/workspaces/${workspaceId}`<br>`/workspaces`<br>`/workspaces/${workspaceId}/settings` | **Auth:** Authenticated Supabase Session<br>**Context:** Authoritative Workspace Context (?workspace=UUID)<br>**Roles:** Restricted to OWNER and ADMIN | ⚠️ No direct test |
| `/protected/settlements` | [`SettlementsPage`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/settlements/page.tsx)<br>(`apps/web/src/app/protected/settlements/page.tsx`) | Client (`use client`) | **Commercial settlement batch management, manual batch generator modal, and item auditing** | `/workspaces`<br>`/workspaces/${workspaceId}/settlements/batches?${query.toString()}`<br>`/workspaces/${workspaceId}/settlements/batches/${batch.id}/items?limit=100`<br>`/workspaces/${workspaceId}/settlements/batches/generate` | **Auth:** Authenticated Supabase Session<br>**Context:** Authoritative Workspace Context (?workspace=UUID)<br>**Roles:** Hidden from VIEWER; batch generation restricted to OWNER | ✅ Yes (`page.test.tsx`) |
| `/protected/usage` | [`UsagePage`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/usage/page.tsx)<br>(`apps/web/src/app/protected/usage/page.tsx`) | Client (`use client`) | **Aggregated metered usage records (call minutes, phone numbers, recording storage)** | `/workspaces/${workspaceId}/billing` | **Auth:** Authenticated Supabase Session<br>**Context:** Authoritative Workspace Context (?workspace=UUID)<br>**Roles:** Restricted to OWNER and ADMIN | ⚠️ No direct test |
| `/protected/webhooks` | [`WebhooksPage`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/webhooks/page.tsx)<br>(`apps/web/src/app/protected/webhooks/page.tsx`) | Client (`use client`) | **Outbound webhook subscriptions, payload signing secrets, and delivery history** | `/workspaces/${workspaceId}/webhooks`<br>`/workspaces/${workspaceId}/webhooks/${deleteId}` | **Auth:** Authenticated Supabase Session<br>**Context:** Authoritative Workspace Context (?workspace=UUID)<br>**Roles:** Restricted to OWNER and ADMIN | ⚠️ No direct test |
| `/signup` | [`SignupPage`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/signup/page.tsx)<br>(`apps/web/src/app/signup/page.tsx`) | Server Component | **New user registration with Supabase Auth** | `${apiUrl}/invitations/verify/${token}` | **Auth:** Public / Unauthenticated<br>**Context:** None<br>**Roles:** All Workspace Roles | ⚠️ No direct test |

---

## Section C: Component and User-Action Inventory

This section inspects all interactive UI elements, forms, modals, tables, and click/submit handlers across all protected feature areas.

### Calls Page (`/protected/calls`)
**Source File:** [`apps/web/src/app/protected/calls/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/calls/page.tsx)

| User Action / Control | Element Type | Handler Function | Target API Endpoint / Behavior | Status |
| :--- | :---: | :--- | :--- | :---: |
| Search Caller/Destination ANI | `Input` | `setSearchTerm(e.target.value)` | `GET /workspaces/:id/calls?search=...` | **IMPLEMENTED** |
| Filter by Call State | `Select Dropdown` | `setStatusFilter(e.target.value)` | `GET /workspaces/:id/calls?status=...` | **IMPLEMENTED** |
| Filter by Duration Range | `Inputs (min/max)` | `setMinDuration / setMaxDuration` | `GET /workspaces/:id/calls?minDuration=...&maxDuration=...` | **IMPLEMENTED** |
| Pagination Next/Prev | `Buttons` | `setPage(p => p + 1)` | `GET /workspaces/:id/calls?offset=...&limit=...` | **IMPLEMENTED** |
| Row Click (View Detail) | `Table Row Link` | `Link to /protected/calls/[callId]` | `Client Navigation` | **IMPLEMENTED** |

### Call Detail Page (`/protected/calls/[callId]`)
**Source File:** [`apps/web/src/app/protected/calls/[callId]/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/calls/[callId]/page.tsx)

| User Action / Control | Element Type | Handler Function | Target API Endpoint / Behavior | Status |
| :--- | :---: | :--- | :--- | :---: |
| Play Audio Recording | `Button (Play)` | `handleFetchRecordingUrl("play")` | `GET /workspaces/:id/recordings/:recId/download` | **IMPLEMENTED** |
| Download Audio Recording | `Button (Download)` | `handleFetchRecordingUrl("download")` | `GET /workspaces/:id/recordings/:recId/download` | **IMPLEMENTED** |
| Open Raise Dispute Modal | `Button ("Raise Dispute")` | `setShowDisputeForm(true)` | `UI Modal State` | **IMPLEMENTED** |
| Submit Call Dispute | `Form Submit` | `handleCreateDispute(e)` | `POST /workspaces/:id/call-commercials/:commId/dispute` | **IMPLEMENTED** |
| Accept Commercial Dispute | `Button ("Accept Dispute")` | `handleResolveDispute("ACCEPTED")` | `POST /workspaces/:id/disputes/:id/resolve` | **IMPLEMENTED** |
| Reject Commercial Dispute | `Button ("Reject Dispute")` | `handleResolveDispute("REJECTED")` | `POST /workspaces/:id/disputes/:id/resolve` | **IMPLEMENTED** |

### Reporting & Analytics (`/protected/reporting`)
**Source File:** [`apps/web/src/app/protected/reporting/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/reporting/page.tsx)

| User Action / Control | Element Type | Handler Function | Target API Endpoint / Behavior | Status |
| :--- | :---: | :--- | :--- | :---: |
| Date Range Selector | `Buttons (Today, 7D, 30D, Custom)` | `setDateRangePreset(preset)` | `GET /workspaces/:id/calls/metrics?startDate=...&endDate=...` | **IMPLEMENTED** |
| Toggle Real-Time Polling | `Toggle Switch` | `setAutoRefresh(!autoRefresh)` | `Interval GET /workspaces/:id/calls/live-calls (10s)` | **IMPLEMENTED** |
| Export Report as CSV | `Dropdown Item ("Export CSV")` | `handleExport("csv")` | `POST /workspaces/:id/reports/export (via apiDownload)` | **IMPLEMENTED** |
| Export Report as XLSX | `Dropdown Item ("Export Excel")` | `handleExport("xlsx")` | `POST /workspaces/:id/reports/export (via apiDownload)` | **IMPLEMENTED** |
| Save Custom Report Config | `Button ("Save Report")` | `handleSaveReport()` | `POST /workspaces/:id/reports` | **IMPLEMENTED** |
| Load Saved Report | `Dropdown Select` | `handleSelectSavedReport(id)` | `GET /workspaces/:id/reports/:id` | **IMPLEMENTED** |
| Delete Saved Report | `Button (Trash icon)` | `handleDeleteSavedReport(id)` | `DELETE /workspaces/:id/reports/:id` | **IMPLEMENTED** |

### Commercial Disputes (`/protected/disputes`)
**Source File:** [`apps/web/src/app/protected/disputes/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/disputes/page.tsx)

| User Action / Control | Element Type | Handler Function | Target API Endpoint / Behavior | Status |
| :--- | :---: | :--- | :--- | :---: |
| Filter by Dispute Status | `Tabs (ALL, PENDING, ACCEPTED, REJECTED)` | `setStatusFilter(tab)` | `Client Filtering of Disputed Calls` | **IMPLEMENTED** |
| Open Resolve Modal | `Button ("Resolve")` | `setResolvingDispute(dispute)` | `UI Modal State` | **IMPLEMENTED** |
| Submit Dispute Resolution | `Form Submit` | `handleResolveSubmit(status, notes)` | `POST /workspaces/:id/disputes/:id/resolve` | **IMPLEMENTED** |
| View Associated Call | `Link` | `Link to /protected/calls/[callId]` | `Client Navigation` | **IMPLEMENTED** |

### Settlements Management (`/protected/settlements`)
**Source File:** [`apps/web/src/app/protected/settlements/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/settlements/page.tsx)

| User Action / Control | Element Type | Handler Function | Target API Endpoint / Behavior | Status |
| :--- | :---: | :--- | :--- | :---: |
| Filter by Participant Type | `Tabs (ALL, BUYER, VENDOR)` | `setParticipantType(type)` | `GET /workspaces/:id/settlements/batches?participant_type=...` | **IMPLEMENTED** |
| Open Batch Generator Modal | `Button ("Generate Batch")` | `setIsGenerateModalOpen(true)` | `UI Modal State (OWNER only)` | **IMPLEMENTED** |
| Submit Settlement Batch Generation | `Form Submit` | `handleGenerateBatch(e)` | `POST /workspaces/:id/settlements/batches/generate` | **IMPLEMENTED** |
| View Batch Items Drawer | `Button ("View Items")` | `handleViewItems(batch)` | `GET /workspaces/:id/settlements/batches/:id/items` | **IMPLEMENTED** |
| Create Payment Instruction | `Button ("Create Payment")` | `handleCreatePayment(batchId)` | `POST /workspaces/:id/settlements/batches/:id/payment-instruction` | **IMPLEMENTED** |
| Run Reconciliation Sweep | `Button ("Reconcile")` | `handleRunReconciliation(batchId)` | `POST /workspaces/:id/reconciliation/batches/:id/run` | **IMPLEMENTED** |

### Payment Instructions (`/protected/payments`)
**Source File:** [`apps/web/src/app/protected/payments/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/payments/page.tsx)

| User Action / Control | Element Type | Handler Function | Target API Endpoint / Behavior | Status |
| :--- | :---: | :--- | :--- | :---: |
| Filter by Direction | `Tabs (ALL, COLLECTION, PAYOUT)` | `setDirection(dir)` | `GET /workspaces/:id/payments/instructions?direction=...` | **IMPLEMENTED** |
| Filter by Execution Status | `Select Dropdown` | `setStatusFilter(status)` | `GET /workspaces/:id/payments/instructions?status=...` | **IMPLEMENTED** |
| Execute Payment | `Button ("Execute")` | `handleExecute(instruction, provider)` | `POST /workspaces/:id/payments/instructions/:id/executions` | **IMPLEMENTED** |
| Retry Failed Payment | `Button ("Retry")` | `handleRetry(instruction, provider)` | `POST /workspaces/:id/payments/instructions/:id/retry` | **IMPLEMENTED** |
| View Instruction Detail | `Link` | `Link to /protected/payments/[instructionId]` | `Client Navigation` | **IMPLEMENTED** |

### Reconciliation Dashboard (`/protected/reconciliation`)
**Source File:** [`apps/web/src/app/protected/reconciliation/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/reconciliation/page.tsx)

| User Action / Control | Element Type | Handler Function | Target API Endpoint / Behavior | Status |
| :--- | :---: | :--- | :--- | :---: |
| Trigger Workspace Reconciliation | `Button ("Run Workspace Sweep")` | `handleRunWorkspaceSweep()` | `POST /workspaces/:id/reconciliation/run` | **IMPLEMENTED** |
| Filter Runs by Status | `Select Dropdown` | `setStatusFilter(s)` | `GET /workspaces/:id/reconciliation/runs?status=...` | **IMPLEMENTED** |
| View Run Discrepancy Issues | `Link ("Inspect Issues")` | `Link to /protected/reconciliation/[runId]` | `Client Navigation` | **IMPLEMENTED** |

### Campaigns (`/protected/campaigns`)
**Source File:** [`apps/web/src/app/protected/campaigns/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/campaigns/page.tsx)

| User Action / Control | Element Type | Handler Function | Target API Endpoint / Behavior | Status |
| :--- | :---: | :--- | :--- | :---: |
| Create New Campaign | `Form Submit` | `handleCreateCampaign(e)` | `POST /workspaces/:id/campaigns` | **IMPLEMENTED** |
| Activate / Pause Campaign | `Button (Toggle)` | `handleToggleStatus(campaignId, status)` | `POST /workspaces/:id/campaigns/:id/activate OR archive` | **IMPLEMENTED** |
| Open Campaign Details | `Link` | `Link to /protected/campaigns/[campaignId]` | `Client Navigation` | **IMPLEMENTED** |

### Campaign Details (`/protected/campaigns/[campaignId]`)
**Source File:** [`apps/web/src/app/protected/campaigns/[campaignId]/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/campaigns/[campaignId]/page.tsx)

| User Action / Control | Element Type | Handler Function | Target API Endpoint / Behavior | Status |
| :--- | :---: | :--- | :--- | :---: |
| Assign Phone Number | `Form Submit` | `handleAssignNumber(numberId)` | `POST /workspaces/:id/campaigns/:id/phone-numbers` | **IMPLEMENTED** |
| Remove Phone Number | `Button (Remove)` | `handleRemoveNumber(numberId)` | `DELETE /workspaces/:id/campaigns/:id/phone-numbers/:numId` | **IMPLEMENTED** |
| Add Buyer to Cascade | `Form Submit` | `handleAddBuyer(buyerId, priority)` | `POST /workspaces/:id/campaigns/:id/buyers` | **IMPLEMENTED** |
| Remove Buyer from Cascade | `Button (Remove)` | `handleRemoveBuyer(buyerId)` | `DELETE /workspaces/:id/campaigns/:id/buyers/:buyerId` | **IMPLEMENTED** |
| Reorder Cascade Priorities | `Buttons (Move Up / Down)` | `handleReorderBuyers(orderedIds)` | `PUT /workspaces/:id/campaigns/:id/buyers/reorder` | **IMPLEMENTED** |

### Buyer Management (`/protected/buyers`)
**Source File:** [`apps/web/src/app/protected/buyers/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/buyers/page.tsx)

| User Action / Control | Element Type | Handler Function | Target API Endpoint / Behavior | Status |
| :--- | :---: | :--- | :--- | :---: |
| Create Buyer | `Form Submit` | `handleCreateBuyer(e)` | `POST /workspaces/:id/buyers` | **IMPLEMENTED** |
| Activate / Pause Buyer | `Button (Toggle)` | `handleToggleBuyerStatus(id, status)` | `POST /workspaces/:id/buyers/:id/activate OR archive` | **IMPLEMENTED** |
| Edit Buyer Details | `Link` | `Link to /protected/buyers/[buyerId]` | `Client Navigation` | **IMPLEMENTED** |

### Phone Numbers (`/protected/phone-numbers`)
**Source File:** [`apps/web/src/app/protected/phone-numbers/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/phone-numbers/page.tsx)

| User Action / Control | Element Type | Handler Function | Target API Endpoint / Behavior | Status |
| :--- | :---: | :--- | :--- | :---: |
| Provision New Number | `Form Submit` | `handleProvisionNumber(e)` | `POST /workspaces/:id/phone-numbers` | **IMPLEMENTED** |
| Assign to Campaign | `Select Dropdown` | `handleAssignCampaign(numberId, campaignId)` | `PUT /workspaces/:id/phone-numbers/:id` | **IMPLEMENTED** |
| Release Number | `Button ("Release")` | `handleReleaseNumber(numberId)` | `DELETE /workspaces/:id/phone-numbers/:id` | **IMPLEMENTED** |

### Blocked Callers (`/protected/blocked-callers`)
**Source File:** [`apps/web/src/app/protected/blocked-callers/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/blocked-callers/page.tsx)

| User Action / Control | Element Type | Handler Function | Target API Endpoint / Behavior | Status |
| :--- | :---: | :--- | :--- | :---: |
| Add Phone Number to Blacklist | `Form Submit` | `handleBlockNumber(e)` | `POST /workspaces/:id/blocked-callers` | **IMPLEMENTED** |
| Unblock Number | `Button ("Unblock")` | `handleUnblockNumber(id)` | `DELETE /workspaces/:id/blocked-callers/:id` | **IMPLEMENTED** |

### Billing & Wallet (`/protected/billing`)
**Source File:** [`apps/web/src/app/protected/billing/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/billing/page.tsx)

| User Action / Control | Element Type | Handler Function | Target API Endpoint / Behavior | Status |
| :--- | :---: | :--- | :--- | :---: |
| Open Stripe Portal | `Button ("Manage Subscription")` | `handleOpenPortal()` | `POST /workspaces/:id/billing/portal` | **IMPLEMENTED** |
| Start Stripe Checkout | `Button ("Upgrade / Top-up")` | `handleCheckout(planId)` | `POST /workspaces/:id/billing/checkout` | **IMPLEMENTED** |
| Mock Balance Top-Up | `Button ("Add Mock Funds")` | `handleMockTopUp(amount)` | `POST /workspaces/:id/billing/wallet/mock-topup` | **IMPLEMENTED (Dev Mode)** |

### API Keys (`/protected/api-keys`)
**Source File:** [`apps/web/src/app/protected/api-keys/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/api-keys/page.tsx)

| User Action / Control | Element Type | Handler Function | Target API Endpoint / Behavior | Status |
| :--- | :---: | :--- | :--- | :---: |
| Create API Key | `Form Submit` | `handleCreateKey(e)` | `POST /workspaces/:id/api-keys` | **IMPLEMENTED** |
| Copy Plaintext Secret | `Button ("Copy")` | `navigator.clipboard.writeText(...)` | `Browser Clipboard` | **IMPLEMENTED** |
| Revoke API Key | `Button ("Revoke")` | `handleRevokeKey(keyId)` | `DELETE /workspaces/:id/api-keys/:id` | **IMPLEMENTED** |

### Outbound Webhooks (`/protected/webhooks`)
**Source File:** [`apps/web/src/app/protected/webhooks/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/webhooks/page.tsx)

| User Action / Control | Element Type | Handler Function | Target API Endpoint / Behavior | Status |
| :--- | :---: | :--- | :--- | :---: |
| Register Webhook Endpoint | `Form Submit` | `handleCreateWebhook(e)` | `POST /workspaces/:id/webhooks` | **IMPLEMENTED** |
| Delete Webhook | `Button ("Delete")` | `handleDeleteWebhook(id)` | `DELETE /workspaces/:id/webhooks/:id` | **IMPLEMENTED** |

### Members & Roles (`/protected/members`)
**Source File:** [`apps/web/src/app/protected/members/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/members/page.tsx)

| User Action / Control | Element Type | Handler Function | Target API Endpoint / Behavior | Status |
| :--- | :---: | :--- | :--- | :---: |
| Send Member Invitation | `Form Submit` | `handleSendInvite(e)` | `POST /workspaces/:id/invitations` | **IMPLEMENTED** |
| Change Member Role | `Select Dropdown` | `handleRoleChange(memberId, role)` | `PUT /workspaces/:id/members/:userId/role` | **IMPLEMENTED** |
| Remove Member | `Button ("Remove")` | `handleRemoveMember(memberId)` | `DELETE /workspaces/:id/members/:userId` | **IMPLEMENTED** |
| Configure Permissions Link | `Link ("Permissions")` | `Link to /protected/members/[memberId]` | `Client Navigation` | **IMPLEMENTED** |

### Member Permissions (`/protected/members/[memberId]`)
**Source File:** [`apps/web/src/app/protected/members/[memberId]/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/members/[memberId]/page.tsx)

| User Action / Control | Element Type | Handler Function | Target API Endpoint / Behavior | Status |
| :--- | :---: | :--- | :--- | :---: |
| Toggle Permission Key | `Checkbox` | `handleTogglePermission(key, enabled)` | `PUT or DELETE /workspaces/:id/permissions/members/:id/:key` | **IMPLEMENTED** |
| Change Resource Scope | `Select (ALL, CAMPAIGN, BUYER)` | `handleScopeChange(key, scope, resourceId)` | `PUT /workspaces/:id/permissions/members/:id/:key` | **IMPLEMENTED** |

### Workspace Settings (`/protected/settings`)
**Source File:** [`apps/web/src/app/protected/settings/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/settings/page.tsx)

| User Action / Control | Element Type | Handler Function | Target API Endpoint / Behavior | Status |
| :--- | :---: | :--- | :--- | :---: |
| Update Workspace Name & General Settings | `Form Submit` | `handleUpdateSettings(e)` | `PUT /workspaces/:id/settings` | **IMPLEMENTED** |

### User Account (`/protected/account`)
**Source File:** [`apps/web/src/app/protected/account/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/account/page.tsx)

| User Action / Control | Element Type | Handler Function | Target API Endpoint / Behavior | Status |
| :--- | :---: | :--- | :--- | :---: |
| Update Display Name | `Form Submit` | `handleUpdateProfile(e)` | `PUT /account/profile` | **IMPLEMENTED** |

---

## Section D: Frontend-to-Backend Endpoint Mapping

The table below documents every API request invoked across the frontend, including its trigger, payload, response handling, and resulting UI state mutation:

| Frontend Feature | HTTP Method | API Path | Source Location | Trigger Event | Payload / Query | Response Handling & UI Result | Status |
| :--- | :---: | :--- | :--- | :--- | :--- | :--- | :---: |
| Protected Layout | `GET` | `/workspaces` | [`app/protected/layout.tsx:39`](file:///C:/Projects/callflow-agent-a/app/protected/layout.tsx) | Server-side layout load | None | Stores workspace list in Shell context; redirects to /onboarding if empty. | **IMPLEMENTED** |
| Calls List | `GET` | `/workspaces/:id/calls` | [`app/protected/calls/page.tsx:82`](file:///C:/Projects/callflow-agent-a/app/protected/calls/page.tsx) | Page mount, filter change, search input | `?limit=25&offset=N&search=...&status=...` | Renders calls table; updates pagination controls. | **IMPLEMENTED** |
| Call Detail | `GET` | `/workspaces/:id/calls/:id` | [`app/protected/calls/[callId]/page.tsx:142`](file:///C:/Projects/callflow-agent-a/app/protected/calls/[callId]/page.tsx) | Page mount with callId | None | Renders call timeline, attempts, buyer, and commercial summary card. | **IMPLEMENTED** |
| Recording Audio URL | `GET` | `/workspaces/:id/recordings/:recId/download` | [`app/protected/calls/[callId]/page.tsx:227`](file:///C:/Projects/callflow-agent-a/app/protected/calls/[callId]/page.tsx) | Click Play or Download button | None | Returns presigned carrier URL; opens in audio player or initiates browser download. | **IMPLEMENTED** |
| Dispute Submission | `POST` | `/workspaces/:id/call-commercials/:commId/dispute` | [`app/protected/calls/[callId]/page.tsx:176`](file:///C:/Projects/callflow-agent-a/app/protected/calls/[callId]/page.tsx) | Submit Dispute modal form | `{ reason: string, description?: string }` | Refreshes call detail; displays success alert. | **IMPLEMENTED** |
| Dispute Resolution | `POST` | `/workspaces/:id/disputes/:id/resolve` | [`app/protected/disputes/page.tsx:151`](file:///C:/Projects/callflow-agent-a/app/protected/disputes/page.tsx) | Click Accept/Reject in modal | `{ status: "ACCEPTED"|"REJECTED", resolution_notes?: string }` | Updates dispute status badge; adjusts profit/revenue; refreshes table. | **IMPLEMENTED** |
| Reporting Metrics | `GET` | `/workspaces/:id/calls/metrics` | [`app/protected/reporting/page.tsx:265`](file:///C:/Projects/callflow-agent-a/app/protected/reporting/page.tsx) | Date range change or page mount | `?startDate=...&endDate=...` | Renders 8 KPI metric cards and time-series Recharts. | **IMPLEMENTED** |
| Live Calls Metric | `GET` | `/workspaces/:id/calls/live-calls` | [`app/protected/reporting/page.tsx:290`](file:///C:/Projects/callflow-agent-a/app/protected/reporting/page.tsx) | 10s interval poll if autoRefresh enabled | None | Updates "Live In-Progress Calls" real-time counter. | **IMPLEMENTED** |
| Export Report | `POST` | `/workspaces/:id/reports/export` | [`app/protected/reporting/page.tsx:383`](file:///C:/Projects/callflow-agent-a/app/protected/reporting/page.tsx) | Click Export CSV or Excel | `{ format: "csv"|"xlsx", filters: {...} }` | Streams binary Blob via `apiDownload`; triggers browser file save. | **IMPLEMENTED** |
| Saved Reports CRUD | `GET/POST/DEL` | `/workspaces/:id/reports` | [`app/protected/reporting/page.tsx:320`](file:///C:/Projects/callflow-agent-a/app/protected/reporting/page.tsx) | Save report button or dropdown select | `{ name, config, visibility }` | Updates saved reports selector; applies stored filters. | **IMPLEMENTED** |
| Settlement Batches | `GET` | `/workspaces/:id/settlements/batches` | [`app/protected/settlements/page.tsx:170`](file:///C:/Projects/callflow-agent-a/app/protected/settlements/page.tsx) | Page mount, tab change, status filter | `?participant_type=...&status=...` | Renders settlement batches table with totals and status. | **IMPLEMENTED** |
| Generate Settlement | `POST` | `/workspaces/:id/settlements/batches/generate` | [`app/protected/settlements/page.tsx:256`](file:///C:/Projects/callflow-agent-a/app/protected/settlements/page.tsx) | Submit Generate Batch modal form | `{ period_start, period_end, participant_type }` | Closes modal; reloads batch table with newly generated batches. | **IMPLEMENTED** |
| Settlement Items | `GET` | `/workspaces/:id/settlements/batches/:id/items` | [`app/protected/settlements/page.tsx:205`](file:///C:/Projects/callflow-agent-a/app/protected/settlements/page.tsx) | Click "View Items" on batch row | `?limit=100` | Opens slide-out drawer displaying individual commercial call items. | **IMPLEMENTED** |
| Payment Instruction Create | `POST` | `/workspaces/:id/settlements/batches/:id/payment-instruction` | [`lib/payments.ts:61`](file:///C:/Projects/callflow-agent-a/lib/payments.ts) | Click "Create Payment" on batch row | None | Creates instruction in CREATED status; navigates to /protected/payments. | **IMPLEMENTED** |
| Payment Instructions List | `GET` | `/workspaces/:id/payments/instructions` | [`lib/payments.ts:78`](file:///C:/Projects/callflow-agent-a/lib/payments.ts) | Page mount, filter tab change | `?direction=...&status=...&limit=25` | Renders payments directory table with execute/retry buttons. | **IMPLEMENTED** |
| Payment Execution | `POST` | `/workspaces/:id/payments/instructions/:id/executions` | [`lib/payments.ts:96`](file:///C:/Projects/callflow-agent-a/lib/payments.ts) | Click "Execute" in modal | `{ provider: "manual"|"wire"|"mock" }` | Updates instruction state; displays execution result badge. | **IMPLEMENTED** |
| Payment Retry | `POST` | `/workspaces/:id/payments/instructions/:id/retry` | [`lib/payments.ts:110`](file:///C:/Projects/callflow-agent-a/lib/payments.ts) | Click "Retry" on failed instruction | `{ provider: "manual"|"wire"|"mock" }` | Dispatches retry execution; refreshes instruction list. | **IMPLEMENTED** |
| Reconciliation Run Batch | `POST` | `/workspaces/:id/reconciliation/batches/:id/run` | [`lib/reconciliation.ts:53`](file:///C:/Projects/callflow-agent-a/lib/reconciliation.ts) | Click "Reconcile" on settlement batch | None | Runs 3-way check; displays discrepancy count banner. | **IMPLEMENTED** |
| Reconciliation Workspace Sweep | `POST` | `/workspaces/:id/reconciliation/run` | [`lib/reconciliation.ts:61`](file:///C:/Projects/callflow-agent-a/lib/reconciliation.ts) | Click "Run Workspace Sweep" | None | Executes comprehensive audit; adds new run to table. | **IMPLEMENTED** |
| Reconciliation Issues | `GET` | `/workspaces/:id/reconciliation/runs/:id/issues` | [`lib/reconciliation.ts:91`](file:///C:/Projects/callflow-agent-a/lib/reconciliation.ts) | Mount run detail page | None | Renders discrepancy table (SUM_MISMATCH, DUPLICATE_CALL, etc.). | **IMPLEMENTED** |
| Campaigns CRUD | `GET/POST` | `/workspaces/:id/campaigns` | [`app/protected/campaigns/page.tsx:55`](file:///C:/Projects/callflow-agent-a/app/protected/campaigns/page.tsx) | Page mount, create form submit | `{ name: string }` | Renders campaigns table; appends newly created campaign. | **IMPLEMENTED** |
| Campaign Buyers Cascade | `POST/DEL/PUT` | `/workspaces/:id/campaigns/:id/buyers` | [`app/protected/campaigns/[campaignId]/page.tsx:120`](file:///C:/Projects/callflow-agent-a/app/protected/campaigns/[campaignId]/page.tsx) | Add buyer, delete buyer, reorder up/down | `{ buyerId, priority }` / `{ buyerIds: [...] }` | Reorders waterfall cascade; persists priority order. | **IMPLEMENTED** |
| Buyers CRUD | `GET/POST` | `/workspaces/:id/buyers` | [`app/protected/buyers/page.tsx:60`](file:///C:/Projects/callflow-agent-a/app/protected/buyers/page.tsx) | Page mount, create form submit | `{ name, destinationNumber, timeout }` | Renders buyer partner directory table. | **IMPLEMENTED** |
| Phone Numbers Provision | `POST` | `/workspaces/:id/phone-numbers` | [`app/protected/phone-numbers/page.tsx:85`](file:///C:/Projects/callflow-agent-a/app/protected/phone-numbers/page.tsx) | Submit Provision Number modal form | `{ type: "local"|"toll_free", areaCode?: string }` | Purchases/provisions number; adds to inventory table. | **IMPLEMENTED** |
| Blocked Callers CRUD | `GET/POST/DEL` | `/workspaces/:id/blocked-callers` | [`app/protected/blocked-callers/page.tsx:50`](file:///C:/Projects/callflow-agent-a/app/protected/blocked-callers/page.tsx) | Page mount, block form submit, unblock click | `{ phoneNumber: string, reason?: string }` | Adds/removes caller ANI from blacklist table. | **IMPLEMENTED** |
| Wallet Balance & Ledger | `GET` | `/workspaces/:id/billing` | [`app/protected/billing/page.tsx:65`](file:///C:/Projects/callflow-agent-a/app/protected/billing/page.tsx) | Page mount | None | Displays micro-dollar balance, available credit, and transactions. | **IMPLEMENTED** |
| Mock Wallet Top-Up | `POST` | `/workspaces/:id/billing/wallet/mock-topup` | [`app/protected/billing/page.tsx:105`](file:///C:/Projects/callflow-agent-a/app/protected/billing/page.tsx) | Click "Add Mock Funds" | `{ amount: number }` | Credits test balance; triggers alert dialog (Dev Mode Only). | **IMPLEMENTED (Dev)** |
| Stripe Portal Session | `POST` | `/workspaces/:id/billing/portal` | [`app/protected/billing/page.tsx:90`](file:///C:/Projects/callflow-agent-a/app/protected/billing/page.tsx) | Click "Manage Subscription" | None | Returns Stripe billing portal URL; redirects window. | **IMPLEMENTED** |
| Usage Metrics Summary | `GET` | `/workspaces/:id/usage` | [`app/protected/usage/page.tsx:45`](file:///C:/Projects/callflow-agent-a/app/protected/usage/page.tsx) | Page mount | None | Renders total metered minutes, active numbers, and storage cards. | **IMPLEMENTED** |
| API Keys CRUD | `GET/POST/DEL` | `/workspaces/:id/api-keys` | [`app/protected/api-keys/page.tsx:65`](file:///C:/Projects/callflow-agent-a/app/protected/api-keys/page.tsx) | Create key form, revoke button click | `{ name: string }` | Generates `pk_...` token; presents plaintext key once in modal. | **IMPLEMENTED** |
| Outbound Webhooks CRUD | `GET/POST/DEL` | `/workspaces/:id/webhooks` | [`app/protected/webhooks/page.tsx:60`](file:///C:/Projects/callflow-agent-a/app/protected/webhooks/page.tsx) | Create webhook form, delete button click | `{ url: string, events: string[] }` | Saves webhook subscription with signing secret. | **IMPLEMENTED** |
| Members & Invitations | `GET/POST/PUT` | `/workspaces/:id/members` | [`app/protected/members/page.tsx:75`](file:///C:/Projects/callflow-agent-a/app/protected/members/page.tsx) | Invite member form, role change dropdown | `{ email, role, participant_type }` | Updates workspace member roster; issues invitation token. | **IMPLEMENTED** |
| Member Permissions | `GET/PUT/DEL` | `/workspaces/:id/permissions/members/:id` | [`app/protected/members/[memberId]/page.tsx:80`](file:///C:/Projects/callflow-agent-a/app/protected/members/[memberId]/page.tsx) | Toggle permission checkbox, change scope | `{ resourceScope, resourceId }` | Updates member granular permission override. | **IMPLEMENTED** |
| Workspace Settings | `PUT` | `/workspaces/:id/settings` | [`app/protected/settings/page.tsx:55`](file:///C:/Projects/callflow-agent-a/app/protected/settings/page.tsx) | Submit Settings form | `{ name: string, timezone?: string }` | Updates workspace record; reloads shell header. | **IMPLEMENTED** |
| User Profile Update | `PUT` | `/account/profile` | [`app/protected/account/page.tsx:40`](file:///C:/Projects/callflow-agent-a/app/protected/account/page.tsx) | Submit Profile form | `{ displayName: string }` | Updates user profile in PostgreSQL database. | **IMPLEMENTED** |

---

## Section E: UI-Only, Mock, Placeholder, and Disconnected Features

A rigorous scan of the frontend codebase identified the following mock, placeholder, or disconnected capabilities:

1. **Mock Wallet Top-Up ([`app/protected/billing/page.tsx:105`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/billing/page.tsx#L105))**:
   - **Nature:** Direct button labelled *"Add Mock Funds"* calling `POST /workspaces/:id/billing/wallet/mock-topup`.
   - **UI Impact:** Pops browser `alert('Mock top-up successful - Development Mode Only')` and adds micro-dollar funds without real Stripe billing.
   - **Production Readiness:** Must be hidden or gated by `NODE_ENV !== 'production'` when live Stripe cards are active.

2. **Mock Payment Execution Provider ([`app/protected/payments/page.tsx:81`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/payments/page.tsx#L81) & [`payments/[instructionId]/page.tsx:80`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/payments/[instructionId]/page.tsx#L80))**:
   - **Nature:** The execution provider dropdown defaults to `'mock'` (*"mock (Internal Mock Provider)"*), alongside `'manual'` and `'wire'`.
   - **UI Impact:** Allows triggering simulated payments that transition to `SUCCEEDED` or `FAILED` instantly via backend test adapters.

3. **Unexposed Backend Capabilities (No Frontend View Present)**:
   - **Audit Logs View:** The backend implements `GET /workspaces/:id/audit-logs` and records mutations to `SecurityAuditLog`, but there is **no corresponding frontend page** (`/protected/audit-logs`).
   - **Number Search UI:** The backend implements `GET /workspaces/:id/phone-numbers/search`, but the frontend provisioning modal directly requests numbers without an interactive search/browse catalog.
   - **Workspace Suspension Toggle:** The backend implements `PUT /workspaces/:id/status`, but workspace settings does not offer an administrative toggle to deactivate/suspend the workspace.

---

## Section F: Authentication, RBAC, and Workspace-Context Findings

### 1. Authentication Lifecycle & Session Synchronization
- **Supabase SSR Client:** Server components use `createClient()` in [`utils/supabase/server.ts`](file:///C:/Projects/callflow-agent-a/apps/web/src/utils/supabase/server.ts); client components use `createClient()` in [`utils/supabase/client.ts`](file:///C:/Projects/callflow-agent-a/apps/web/src/utils/supabase/client.ts).
- **Bearer Token Invariant:** Every request via `apiFetch` extracts `session.access_token` and includes `Authorization: Bearer <token>`. If the session is missing, `apiFetch` throws an error rather than sending an unauthenticated request.
- **Session Expiry Handling:** In [`app/protected/layout.tsx:59`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/layout.tsx#L59), if the API responds with HTTP 401, the layout immediately performs a clean server-side redirect to `/login?message=Session+expired.+Please+log+in+again.`.

### 2. Workspace Context Protection
- **Double Guard Architecture:** Workspace context is guarded by both [`ProtectedLayout`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/layout.tsx) (server-side workspace fetch) and [`WorkspaceValidator`](file:///C:/Projects/callflow-agent-a/apps/web/src/components/workspace-validator.tsx) (client-side URL parameter enforcement).
- **Suppression Invariant:** If the URL query parameter `?workspace=...` is missing or invalid, `WorkspaceValidator` **suppresses rendering of child page components** until `router.replace()` sets a verified workspace UUID. This prevents invalid API calls from executing with `null` workspace IDs.

### 3. Role & Participant Isolation
- **Vendor Isolation:** When `participant_type === 'VENDOR'`, the navigation sidebar hides the entire Routing group (Campaigns, Buyers, Phone Numbers, Blocked Callers) and commercial Disputes. Tests in [`vendor-portal.test.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/vendor-portal.test.tsx) confirm that direct URL access is forbidden.
- **Financial Segregation:** Payments and Reconciliation are hidden from Buyers, Vendors, and Viewers. Members can access them only if assigned `payment:read` or `reconciliation:read` permissions.

---

## Section G: Missing Loading, Error, Validation, and Responsive States

| Page / Surface | Missing State or Vulnerability | Evidence / Code Location | Recommended Enhancement |
| :--- | :--- | :--- | :--- |
| **Disputes Page** | Client-side search & pagination absent for high dispute volumes | [`disputes/page.tsx:101`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/disputes/page.tsx#L101) (`limit=100` hardcoded) | Add server-side pagination controls when disputes exceed 100 records. |
| **Campaign Details** | Cascade priority drag-and-drop handles absent on mobile | [`campaigns/[campaignId]/page.tsx:180`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/campaigns/[campaignId]/page.tsx#L180) | Provide explicit up/down button fallback on touch screens. |
| **Billing Page** | Mock top-up button visible without environment guard | [`billing/page.tsx:160`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/billing/page.tsx#L160) | Conditionally hide mock funding widget when in production. |
| **Members Page** | Invitation email input lacks regex client validation | [`members/page.tsx:120`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/members/page.tsx#L120) | Add HTML5 email type validation before form submission. |

---

## Section H: Frontend Testing and Verification Matrix

The frontend test suite contains **14 test files** and **107 test cases** executed with Vitest:

| Test File | Test Suite Name | Test Cases | Critical Behaviors Verified |
| :--- | :--- | :---: | :--- |
| [`apps/web/src/app/auth.spec.ts`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/auth.spec.ts) | `Frontend Login/Logout Flow (MOCK)` | **3** | "Login/authentication flow calls Supabase signInWithPassword", "Signup flow calls Supabase signUp" ... |
| [`apps/web/src/app/protected/billing/page.test.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/billing/page.test.tsx) | `BillingPage Wallet UI` | **2** | "renders wallet section and development mode label", "successfully triggers mock top-up and refreshes data" |
| [`apps/web/src/app/protected/calls/page.test.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/calls/page.test.tsx) | `CallsPage` | **11** | "1. API response: talkDurationSecs: 120, totalDurationSecs: 130 renders 02:00, 02:10 not —", "2. Legacy calls without lifecycle data remain —" ... |
| [`apps/web/src/app/protected/calls/[callId]/page.test.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/calls/[callId]/page.test.tsx) | `CallDetailPage Dispute & Adjustment UI (COMM-INTEGRATION-4)` | **5** | "renders commercial financial details and dispute filing button when no dispute exists", "allows user to file a dispute with reason and description" ... |
| [`apps/web/src/app/protected/disputes/page.test.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/disputes/page.test.tsx) | `DisputesPage (COMM-INTEGRATION-4)` | **4** | "renders commercial dispute list for authorized workspace members", "allows owner/admin to accept pending dispute" ... |
| [`apps/web/src/app/protected/payments/page.test.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/payments/page.test.tsx) | `Payments Frontend & Security (COMM-INTEGRATION-8C)` | **16** | "1. Owner can see payments", "2. Admin can see payments in read-only mode" ... |
| [`apps/web/src/app/protected/phone-numbers/page.test.ts`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/phone-numbers/page.test.ts) | `PhoneNumbersPage Helpers > getPhoneTypeDisplay` | **4** | "returns ", "returns " ... |
| [`apps/web/src/app/protected/reconciliation/page.test.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/reconciliation/page.test.tsx) | `Reconciliation Frontend & Security (COMM-INTEGRATION-8C)` | **12** | "13. Owner can view reconciliation dashboard", "14. Admin can view reconciliation dashboard" ... |
| [`apps/web/src/app/protected/reporting/page.test.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/reporting/page.test.tsx) | `ReportingPage (Saved Reports Frontend Matrix) > ReportingPage (Export E3 Frontend Matrix) > ReportingPage (Direct apiFetch Payload Regression) > ReportingPage (Owner KPI UI Completion) > COMM-INTEGRATION-3 Commercial Reporting Frontend Matrix` | **23** | "Apply report pushes URL state and saves columns", "CSV export successfully downloads a Blob and does NOT call apiFetch" ... |
| [`apps/web/src/app/protected/settlements/page.test.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/settlements/page.test.tsx) | `SettlementsPage (COMM-INTEGRATION-5)` | **5** | "renders settlement batch list for authorized user", "allows OWNER to see generate button and submit valid generation request" ... |
| [`apps/web/src/app/protected/vendor-portal.test.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/vendor-portal.test.tsx) | `COMM-INTEGRATION-6: Vendor Portal UI Integration Suite > 1. Sidebar Navigation Scoping for Vendor > 2. Calls List Page Vendor Scoping > 3. Call Detail Page Vendor Scoping > 4. Settlements Page Vendor Scoping > 5. Authoritative Workspace Context Verification (No payload heuristic) > 6. Vendor IDOR Rejection & Forbidden Handling` | **9** | "scopes sidebar to Calls, Reporting, and Settlements while hiding Disputes, Routing, Developer, Billing, and Workspace", "renders Payout column, hides Revenue/Profit columns, and omits dispute badges" ... |
| [`apps/web/src/components/sidebar.spec.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/components/sidebar.spec.tsx) | `Sidebar Role-Aware Navigation` | **7** | "11. ADMIN/OWNER appropriate management navigation is available where applicable", "ADMIN sees Payments and Reconciliation" ... |
| [`apps/web/src/utils/supabase/client.spec.ts`](file:///C:/Projects/callflow-agent-a/apps/web/src/utils/supabase/client.spec.ts) | `Frontend Auth Configuration (MOCK)` | **1** | "Authentication configuration/client initialization should pass environment variables" |
| [`apps/web/src/utils/supabase/middleware.spec.ts`](file:///C:/Projects/callflow-agent-a/apps/web/src/utils/supabase/middleware.spec.ts) | `Frontend Middleware Auth (MOCK)` | **5** | "Unauthenticated protected-page behavior - Redirects to /login", "Unauthenticated onboarding behavior - Redirects to /login" ... |

**Total Test Summary:** 14 files, 107 tests passing (100% pass rate in vitest run).

---

## Section I: Preliminary Backend-versus-Frontend Gap Candidates

Comparing the backend route catalog against the frontend reveals the following gap candidates:

1. **Security Audit Log Explorer (Backend exists, Frontend absent)**:
   - **Backend:** `GET /workspaces/:id/audit-logs` with full IP, actor, and action metadata.
   - **Frontend:** No UI page or component exists to view audit logs.
   - **Recommendation:** Implement `apps/web/src/app/protected/audit-logs/page.tsx`.

2. **Carrier Phone Number Search (Backend exists, Frontend direct)**:
   - **Backend:** `GET /workspaces/:id/phone-numbers/search` supports filtering available Telnyx numbers by area code and type.
   - **Frontend:** Phone numbers page modal only takes a manual number input or generic type.
   - **Recommendation:** Add a number search step in the phone number provisioning modal.

3. **Workspace Status Management (Backend exists, Frontend absent)**:
   - **Backend:** `PUT /workspaces/:id/status` supports suspending/activating workspaces.
   - **Frontend:** Workspace settings page has no button to suspend a workspace.
   - **Recommendation:** Add an administrative workspace suspension action for owners in settings.

---

## Section J: Browser Screenshot Checklist

To finalize visual alignment with the backend capabilities, capture screenshots of the following pages and states:

| Screen Name | Route Path | Target Visual State |
| :--- | :--- | :--- |
| **Overview Dashboard** | `/protected` | Default view with active workspace |
| **Calls Log Table** | `/protected/calls` | Table loaded with answered, failed, and duration badges |
| **Call Detail & Audio Player** | `/protected/calls/[callId]` | Audio waveform player open, commercial card visible |
| **Raise Dispute Modal** | `/protected/calls/[callId]` | Dispute reason and description inputs open |
| **Reporting KPI Dashboard** | `/protected/reporting` | 8 KPI cards, Recharts time-series chart, Export dropdown |
| **Disputes Workbench** | `/protected/disputes` | Disputes table with Accept/Reject actions |
| **Settlements Management** | `/protected/settlements` | Settlement batches table with "Generate Batch" button |
| **Generate Batch Modal** | `/protected/settlements` | Date boundary inputs and participant selector |
| **Settlement Items Drawer** | `/protected/settlements` | Slide-out drawer showing commercial call items |
| **Payments Directory** | `/protected/payments` | Payment instructions table with Execute/Retry buttons |
| **Reconciliation Dashboard** | `/protected/reconciliation` | Reconciliation runs and discrepancy issue counters |
| **Reconciliation Issues List** | `/protected/reconciliation/[runId]` | Detailed audit issues table (SUM_MISMATCH, etc.) |
| **Campaigns & Waterfall Cascade** | `/protected/campaigns/[campaignId]` | Buyer priority waterfall with reorder buttons |
| **Phone Number Inventory** | `/protected/phone-numbers` | Active numbers table and Provision Number modal |
| **Billing & Micro-Dollar Wallet** | `/protected/billing` | Balance card, transaction ledger, and Top-Up actions |
| **Members & Granular Scoping** | `/protected/members/[memberId]` | Permission checkboxes with CAMPAIGN/BUYER scoping dropdowns |

---

## Section K: Prioritized Findings (P0, P1, P2, P3)

| Finding ID | Priority | Feature Area | Evidence Source | Operational Impact | Confidence | Runtime Check | Recommendation |
| :--- | :---: | :--- | :--- | :--- | :---: | :---: | :--- |
| `FND-P0-01` | **P0** | Workspace Resolution | `layout.tsx & workspace-validator.tsx` | RESOLVED: Authenticated user routed to valid workspace with full DB membership. | HIGH | NO | Maintain current cookie and workspace query parameter synchronization. |
| `FND-P0-02` | **P0** | Reporting Dashboard Crash | `reporting/page.tsx:949` | RESOLVED: Unguarded .toLocaleString() on undefined properties fixed and verified. | HIGH | NO | Preserve property guards on all optional metrics in reporting dashboard. |
| `FND-P1-01` | **P1** | Mock Top-Up in Production | `billing/page.tsx:105` | Allows test wallet funding in UI. Must be disabled when live Stripe is active. | HIGH | YES | Wrap mock funding button in environment check (`process.env.NODE_ENV !== "production"`). |
| `FND-P2-01` | **P2** | Audit Logs UI Absence | `apps/web/src/app/protected` | SecurityAuditLog backend records exist but cannot be viewed in frontend UI. | HIGH | NO | Build a dedicated audit logs viewing page at `/protected/audit-logs`. |
| `FND-P2-02` | **P2** | Carrier Number Search | `phone-numbers/page.tsx:85` | UI provisions numbers directly without exposing backend number search API. | MEDIUM | YES | Wire `GET /phone-numbers/search` into provisioning modal. |
| `FND-P3-01` | **P3** | Large Volume Pagination | `disputes/page.tsx:101` | Hardcoded limit=100 on disputes table could degrade performance at high scale. | LOW | NO | Add standard pagination controls matching the calls list page. |

---

## Section L: Evidence Index

The evidence cited across this forensic audit is indexed below with absolute repository paths:

- [`apps/web/package.json`](file:///C:/Projects/callflow-agent-a/apps/web/package.json)
- [`apps/web/src/lib/api.ts`](file:///C:/Projects/callflow-agent-a/apps/web/src/lib/api.ts)
- [`apps/web/src/lib/payments.ts`](file:///C:/Projects/callflow-agent-a/apps/web/src/lib/payments.ts)
- [`apps/web/src/lib/reconciliation.ts`](file:///C:/Projects/callflow-agent-a/apps/web/src/lib/reconciliation.ts)
- [`apps/web/src/components/sidebar.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/components/sidebar.tsx)
- [`apps/web/src/components/shell.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/components/shell.tsx)
- [`apps/web/src/components/header.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/components/header.tsx)
- [`apps/web/src/components/workspace-validator.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/components/workspace-validator.tsx)
- [`apps/web/src/components/workspace-selector.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/components/workspace-selector.tsx)
- [`apps/web/src/app/protected/layout.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/layout.tsx)
- [`apps/web/src/app/protected/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/page.tsx)
- [`apps/web/src/app/protected/calls/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/calls/page.tsx)
- [`apps/web/src/app/protected/calls/[callId]/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/calls/[callId]/page.tsx)
- [`apps/web/src/app/protected/reporting/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/reporting/page.tsx)
- [`apps/web/src/app/protected/disputes/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/disputes/page.tsx)
- [`apps/web/src/app/protected/settlements/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/settlements/page.tsx)
- [`apps/web/src/app/protected/payments/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/payments/page.tsx)
- [`apps/web/src/app/protected/payments/[instructionId]/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/payments/[instructionId]/page.tsx)
- [`apps/web/src/app/protected/reconciliation/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/reconciliation/page.tsx)
- [`apps/web/src/app/protected/reconciliation/[runId]/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/reconciliation/[runId]/page.tsx)
- [`apps/web/src/app/protected/campaigns/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/campaigns/page.tsx)
- [`apps/web/src/app/protected/campaigns/[campaignId]/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/campaigns/[campaignId]/page.tsx)
- [`apps/web/src/app/protected/buyers/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/buyers/page.tsx)
- [`apps/web/src/app/protected/buyers/[buyerId]/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/buyers/[buyerId]/page.tsx)
- [`apps/web/src/app/protected/phone-numbers/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/phone-numbers/page.tsx)
- [`apps/web/src/app/protected/blocked-callers/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/blocked-callers/page.tsx)
- [`apps/web/src/app/protected/billing/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/billing/page.tsx)
- [`apps/web/src/app/protected/usage/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/usage/page.tsx)
- [`apps/web/src/app/protected/api-keys/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/api-keys/page.tsx)
- [`apps/web/src/app/protected/webhooks/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/webhooks/page.tsx)
- [`apps/web/src/app/protected/members/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/members/page.tsx)
- [`apps/web/src/app/protected/members/[memberId]/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/members/[memberId]/page.tsx)
- [`apps/web/src/app/protected/invitations/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/invitations/page.tsx)
- [`apps/web/src/app/protected/accept-invitation/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/accept-invitation/page.tsx)
- [`apps/web/src/app/protected/account/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/account/page.tsx)
- [`apps/web/src/app/protected/settings/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/settings/page.tsx)
- [`apps/web/src/app/login/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/login/page.tsx)
- [`apps/web/src/app/signup/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/signup/page.tsx)
- [`apps/web/src/app/onboarding/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/onboarding/page.tsx)
- [`apps/web/src/app/invitations/page.tsx`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/invitations/page.tsx)
- [`apps/web/src/utils/supabase/client.ts`](file:///C:/Projects/callflow-agent-a/apps/web/src/utils/supabase/client.ts)
- [`apps/web/src/utils/supabase/server.ts`](file:///C:/Projects/callflow-agent-a/apps/web/src/utils/supabase/server.ts)
- [`apps/web/src/utils/supabase/middleware.ts`](file:///C:/Projects/callflow-agent-a/apps/web/src/utils/supabase/middleware.ts)
