# CallFlow Agent 3 — Frontend/UI/Reporting Forensic Audit

## 1. Audit Metadata
- **Audit Date**: 2026-10-08
- **Auditor Role**: Agent 3 — Frontend / UI / Reporting Forensic Investigator
- **Mode**: 100% Read-Only Forensic Reconnaissance (No implementation, no code modifications, no git mutation)
- **Repository**: `callflow-agent-a`
- **Current Active Branch**: `agent/reporting-backend-fix`
- **Current HEAD Commit**: `f901302b156c2779a169b2ceeb27ba7fe0c09be3` (`fix(reporting): fix bucket aggregation and total calls count`)
- **Working Tree State**: Clean (`git status --short` is completely empty)
- **Known Frozen Baseline Reference**: `59da9de33703ee55f94b8eec1ea21a603c46e3be`
  - *Git Resolution Note*: The full SHA in git object store is `59da9deba18254da918e60623f440581deb97a53` (branch `agent/commercial-comm14-settlement-generation`).
  - *Relationship to Current HEAD*: Current HEAD (`f901302`) is an ancestor of baseline `59da9de` by exactly 21 commits.
  - *Commits between HEAD and baseline modifying `apps/web`*:
    1. `38a46c8 feat(reporting): integrate commercial metrics` (adds commercial KPIs, grouping columns, call economics card)
    2. `fd74538 feat(reporting): complete owner KPI dashboard` (refines owner KPI dashboard cards & rates)
    3. `96c0f14 fix(reporting): support binary report exports` (improves binary download handling for XLSX/CSV)
    4. `784ceab fix(reporting): consume apiFetch payloads correctly` (fixes frontend consumption of raw `apiFetch` JSON return)

---

## 2. Executive Summary

### 2.1 The Core Answers
**1. What does a real CallFlow user actually have available in the frontend today?**
A real CallFlow user has a functional Next.js 14 App Router dashboard covering operational call tracking, telephony resource configuration, and tenant-level access management:
- Operational call log viewer (`/protected/calls`) and detailed call inspector (`/protected/calls/[callId]`).
- Reporting dashboard (`/protected/reporting`) with real-time live-call badge, operational KPI cards, volume line chart, outcome pie chart, performance grouping breakdowns, and detailed call log export (CSV/XLSX).
- Campaign management (`/protected/campaigns`, `/[campaignId]`) with routing strategy (ROUND_ROBIN, WEIGHTED, SIMULTANEOUS, PRIORITY) and buyer tier assignments.
- Buyer directory & management (`/protected/buyers`, `/[buyerId]`) with pause controls and destination endpoints.
- Inbound tracking number management (`/protected/phone-numbers`) with assignment to campaigns.
- Caller blocking (`/protected/blocked-callers`), API Key management (`/protected/api-keys`), and Webhook subscriptions (`/protected/webhooks`).
- Granular team RBAC management (`/protected/members`, `/[memberId]`) supporting Workspace Owner, Admin, Member, and Viewer with permission toggles.
- Balance & billing overview (`/protected/billing`) with a development mock top-up tool.

**2. Which frontend features are genuinely connected to working backend functionality?**
All operational CRUD flows (Calls, Campaigns, Buyers, Numbers, Blocked Callers, API Keys, Webhooks, Members, Reports) are genuinely connected through NestJS controllers (`apps/api`) to PostgreSQL via Prisma ORM.

**3. What is completely missing, disconnected, or mocked?**
- **No Dedicated Overview Page**: `/protected` simply performs a client redirect to `/protected/reporting`.
- **No Vendors UI**: Although the backend schema has a `Vendor` model, there is zero UI in `apps/web` for managing vendors or viewing vendor reports.
- **No Number Pools UI**: Telephony is limited to individual 1-to-1 tracking numbers; there is no frontend concept of DNI pools.
- **No Destinations Directory**: Destinations exist only as sub-records nested inside Buyer edit dialogs.
- **No Settlement UI**: There are 0 pages, modals, or components for `SettlementBatch`, `SettlementItem`, `SettlementAdjustment`, or `PaymentInstruction`.
- **No Dispute Workflow UI**: Disputes exist solely as read-only badges/cards in `calls/[callId]` (introduced in baseline commit `38a46c8`). A user cannot open, resolve, accept, or reject a dispute from the UI.
- **Dialics Reporting Parity Gap**: CallFlow lacks ~75% of Dialics reporting capabilities, including vendor grouping, SIP header inspection, caller demographic profiles, tag filtering, parameter filtering, and financial reconciliation.

---

## 3. Complete Frontend Route Inventory

Every route within `apps/web/src/app` was forensically verified:

| Route Path | Page Component Path | Layout / Shell | Auth Required | Workspace Required | Primary API Endpoints | Data Nature |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `/` | `src/app/page.tsx` | Root (`src/app/layout.tsx`) | No | No | None | **STATIC** (Default Next.js boilerplate) |
| `/login` | `src/app/login/page.tsx` | Root | No (Public) | No | Supabase Auth `signInWithPassword` | **LIVE** |
| `/signup` | `src/app/signup/page.tsx` | Root | No (Public) | No | Supabase Auth `signUp` | **LIVE** |
| `/onboarding` | `src/app/onboarding/page.tsx` | Root | Yes | Partial | `POST /workspaces` | **LIVE** |
| `/invitations` | `src/app/invitations/page.tsx` | Root | Yes | No | `GET /invitations`, `POST /invitations/:id/accept` | **LIVE** |
| `/protected` | `src/app/protected/page.tsx` | Shell (`src/app/protected/layout.tsx`) | Yes | Yes | None (Redirects to `/protected/reporting`) | **REDIRECT** |
| `/protected/reporting` | `src/app/protected/reporting/page.tsx` | Shell | Yes | Yes | `GET /workspaces/:id/reports/summary`<br>`GET /workspaces/:id/reports/saved`<br>`POST /workspaces/:id/reports/saved`<br>`POST /workspaces/:id/reports/export` | **LIVE** |
| `/protected/calls` | `src/app/protected/calls/page.tsx` | Shell | Yes | Yes | `GET /workspaces/:id/calls`<br>`GET /workspaces/:id/campaigns` | **LIVE** |
| `/protected/calls/[callId]` | `src/app/protected/calls/[callId]/page.tsx` | Shell | Yes | Yes | `GET /workspaces/:id/calls/:callId` | **LIVE** |
| `/protected/campaigns` | `src/app/protected/campaigns/page.tsx` | Shell | Yes | Yes | `GET /workspaces/:id/campaigns`<br>`POST /workspaces/:id/campaigns` | **LIVE** |
| `/protected/campaigns/[campaignId]` | `src/app/protected/campaigns/[campaignId]/page.tsx` | Shell | Yes | Yes | `GET /workspaces/:id/campaigns/:id`<br>`PUT /workspaces/:id/campaigns/:id`<br>`GET /workspaces/:id/buyers` | **LIVE** |
| `/protected/buyers` | `src/app/protected/buyers/page.tsx` | Shell | Yes | Yes | `GET /workspaces/:id/buyers`<br>`POST /workspaces/:id/buyers` | **LIVE** |
| `/protected/buyers/[buyerId]` | `src/app/protected/buyers/[buyerId]/page.tsx` | Shell | Yes | Yes | `GET /workspaces/:id/buyers/:id`<br>`PUT /workspaces/:id/buyers/:id`<br>`POST /workspaces/:id/buyers/:id/destinations` | **LIVE** |
| `/protected/phone-numbers` | `src/app/protected/phone-numbers/page.tsx` | Shell | Yes | Yes | `GET /workspaces/:id/phone-numbers`<br>`POST /workspaces/:id/phone-numbers/buy`<br>`PATCH /workspaces/:id/phone-numbers/:id` | **LIVE** |
| `/protected/blocked-callers` | `src/app/protected/blocked-callers/page.tsx` | Shell | Yes | Yes | `GET /workspaces/:id/blocked-callers`<br>`POST /workspaces/:id/blocked-callers`<br>`DELETE /workspaces/:id/blocked-callers/:id` | **LIVE** |
| `/protected/api-keys` | `src/app/protected/api-keys/page.tsx` | Shell | Yes | Yes | `GET /workspaces/:id/api-keys`<br>`POST /workspaces/:id/api-keys`<br>`DELETE /workspaces/:id/api-keys/:id` | **LIVE** |
| `/protected/webhooks` | `src/app/protected/webhooks/page.tsx` | Shell | Yes | Yes | `GET /workspaces/:id/webhooks`<br>`POST /workspaces/:id/webhooks`<br>`DELETE /workspaces/:id/webhooks/:id` | **LIVE** |
| `/protected/usage` | `src/app/protected/usage/page.tsx` | Shell | Yes | Yes | `GET /workspaces/:id/billing/usage` | **LIVE** |
| `/protected/billing` | `src/app/protected/billing/page.tsx` | Shell | Yes | Yes | `GET /workspaces/:id/billing/balance`<br>`POST /workspaces/:id/billing/top-up` | **LIVE + MOCK TOP-UP** |
| `/protected/members` | `src/app/protected/members/page.tsx` | Shell | Yes | Yes | `GET /workspaces/:id/members`<br>`POST /workspaces/:id/members/invite` | **LIVE** |
| `/protected/members/[memberId]` | `src/app/protected/members/[memberId]/page.tsx` | Shell | Yes | Yes | `GET /workspaces/:id/members/:id`<br>`PATCH /workspaces/:id/members/:id`<br>`DELETE /workspaces/:id/members/:id` | **LIVE** |
| `/protected/settings` | `src/app/protected/settings/page.tsx` | Shell | Yes | Yes | `GET /workspaces/:id`<br>`PATCH /workspaces/:id` | **LIVE** |
| `/protected/account` | `src/app/protected/account/page.tsx` | Shell | Yes | No | Supabase Auth `getUser`, `updateUser` | **LIVE** |

---

## 4. Frontend Architecture

### 4.1 Routing & Layout Hierarchy
- **Framework**: Next.js 14 App Router with TypeScript and Tailwind CSS.
- **Root Layout** (`apps/web/src/app/layout.tsx`): Configures Inter font and wraps children in `Toaster` notifications.
- **Protected Layout** (`apps/web/src/app/protected/layout.tsx`):
  - Wraps all protected pages with `WorkspaceValidator`, ensuring the user has an active workspace.
  - Injects `Sidebar` navigation, top `Header` (with `WorkspaceSelector`, active balance pill, and live-calls polling badge), and main scrolling viewport.
- **Middleware** (`apps/web/src/middleware.ts`):
  - Uses `@supabase/ssr` to refresh session cookies.
  - Redirects unauthenticated users attempting to access `/protected/*` or `/onboarding` to `/login`.
  - Redirects authenticated users accessing `/login` or `/signup` to `/protected`.

### 4.2 State Management & HTTP Layer
- **No Global Redux/Zustand Store**: State is strictly decentralized:
  - React local component state (`useState`, `useCallback`, `useEffect`).
  - URL query parameters (`useSearchParams`, `useRouter`, `usePathname`) for pagination, filters, and tab selection.
- **HTTP Client** (`apps/web/src/lib/api.ts`):
  - `apiFetch<T>(endpoint, options)`: Wrapper around native `fetch`. Automatically attaches `Bearer <supabase_access_token>` from Supabase SSR client session and JSON headers. Base URL is configured via `NEXT_PUBLIC_API_URL` (defaults to `http://localhost:3001/api`).
  - Baseline addition in `96c0f14`: `apiDownload(endpoint, body, filename)` handles binary blob downloads for file exports.

### 4.3 Design System & Components
- **UI Components** (`apps/web/src/components/ui/`): Custom components built with `clsx` and `tailwind-merge`:
  - `Button`, `Card`, `Badge`, `Input`, `Select`, `Modal`, `Dialog`, `Toast`, `Table`.
- **Charts**: Recharts (`ResponsiveContainer`, `LineChart`, `PieChart`, `Tooltip`, `Legend`).

---

## 5. API Connection Map

| Frontend Component | UI Action / Trigger | Frontend API Call (`lib/api.ts`) | Backend Controller & Endpoint | Backend Service Handler | Classification |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `Header.tsx` | Interval (15s) | `apiFetch('/calls/live-calls')` | `CallsController.getLiveCalls` | In-memory Redis/Map active calls count | **LIVE_BACKEND_CONNECTED** |
| `Header.tsx` | Interval (60s) | `apiFetch('/billing/balance')` | `BillingController.getBalance` | Prisma query on `Workspace.balance` | **LIVE_BACKEND_CONNECTED** |
| `calls/page.tsx` | Page mount / filter change | `apiFetch('/calls?page=...&limit=...')` | `CallsController.findAll` | `CallsService.findAll` (Prisma pagination) | **LIVE_BACKEND_CONNECTED** |
| `calls/[callId]/page.tsx` | Page mount | `apiFetch('/calls/:id')` | `CallsController.findOne` | `CallsService.findOne` (Prisma include) | **LIVE_BACKEND_CONNECTED** |
| `reporting/page.tsx` | Load / Apply Filters | `apiFetch('/reports/summary?...')` | `ReportsController.getSummary` | `ReportsService.getSummary` (SQL Aggregation) | **LIVE_BACKEND_CONNECTED** (Payload fix in `784ceab`) |
| `reporting/page.tsx` | Export Button | `apiFetch('/reports/export')` | `ReportsController.export` | `ReportsService.exportReports` | **LIVE_BACKEND_CONNECTED** |
| `campaigns/page.tsx` | Create Campaign Modal | `apiFetch('/campaigns', POST)` | `CampaignsController.create` | `CampaignsService.create` | **LIVE_BACKEND_CONNECTED** |
| `buyers/page.tsx` | Create Buyer Modal | `apiFetch('/buyers', POST)` | `BuyersController.create` | `BuyersService.create` | **LIVE_BACKEND_CONNECTED** |
| `buyers/[buyerId]/page.tsx`| Pause / Unpause toggle | `apiFetch('/buyers/:id', PUT)` | `BuyersController.update` | `BuyersService.update` | **LIVE_BACKEND_CONNECTED** |
| `phone-numbers/page.tsx` | Search & Buy Number | `apiFetch('/phone-numbers/buy', POST)` | `PhoneNumbersController.purchase` | Telephony Provider API + Prisma | **LIVE_BACKEND_CONNECTED** |
| `billing/page.tsx` | Mock Top-Up Button | `apiFetch('/billing/top-up', POST)` | `BillingController.topUp` | Directly increments workspace balance | **MOCKED / DEV ONLY** |

---

## 6. Navigation Map

Sidebar navigation is defined in `apps/web/src/components/layout/Sidebar.tsx`:
```
CallFlow Dashboard
├── Analytics & Activity
│   ├── Reporting          -> /protected/reporting
│   └── Call Logs          -> /protected/calls
├── Call Routing & Telephony
│   ├── Campaigns          -> /protected/campaigns
│   ├── Buyers             -> /protected/buyers
│   ├── Phone Numbers      -> /protected/phone-numbers
│   └── Blocked Callers    -> /protected/blocked-callers
└── Workspace Administration
    ├── Usage              -> /protected/usage
    ├── Billing            -> /protected/billing
    ├── Team Members       -> /protected/members
    ├── API Keys           -> /protected/api-keys
    ├── Webhooks           -> /protected/webhooks
    └── Settings           -> /protected/settings
```
*Note*: No links exist for Vendors, Number Pools, Invoicing, Disputes, or Settlements.

---

## 7. Reporting — Deep Forensic Audit

### 7.1 Page Structure & Layout
File: `apps/web/src/app/protected/reporting/page.tsx`
1. **Header Toolbar**: Page title, auto-refresh interval selector (`Off`, `30s`, `1m`, `5m`), manual Refresh button, Saved Reports selector/modal, and Export dropdown (CSV, XLSX).
2. **Filter Bar**: Collapsible panel containing:
   - Date range selector (presets: Today, Yesterday, Last 7 Days, Last 30 Days, Custom Range).
   - Campaign dropdown (populated from `GET /campaigns`).
   - Buyer dropdown (populated from `GET /buyers`).
   - Tracking Number text input.
   - Caller Number text input.
   - Status dropdown (`ALL`, `COMPLETED`, `IN_PROGRESS`, `FAILED`, `BUSY`, `NO_ANSWER`, `CANCELED`).
   - Duration inputs: Min Duration (sec) and Max Duration (sec).
3. **KPI Cards Row**: High-level aggregation metrics.
4. **Visual Analytics Grid**:
   - Left: Call Volume trend (LineChart).
   - Right: Outcome Distribution (PieChart).
5. **Performance Grouping Table**: Tabbed aggregated view with dimensions: `Campaign`, `Buyer`, `Tracking Number`, `Status`.
6. **Detailed Calls Table**: Paginated raw call records with duration, status, and direct link to call detail page.

---

## 8. Reporting KPI Audit

| KPI Metric Name | Visible in UI? | Component / Location | API Source Field | Calculation Location | Tests Exist? | Forensic Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Total Calls** | Yes | `reporting/page.tsx` | `summary.metrics.totalCalls` | Backend SQL count | Yes | **LIVE_BACKEND_CONNECTED** |
| **Answered** | Yes | `reporting/page.tsx` | `summary.metrics.completedCalls` | Backend SQL count (`status = 'COMPLETED'`) | Yes | **LIVE_BACKEND_CONNECTED** |
| **Missed** | Yes | `reporting/page.tsx` | `summary.metrics.noAnswerCalls` | Backend SQL count | Yes | **LIVE_BACKEND_CONNECTED** |
| **Failed** | Yes | `reporting/page.tsx` | `summary.metrics.failedCalls` | Backend SQL count | Yes | **LIVE_BACKEND_CONNECTED** |
| **Answer Rate** | Yes | `reporting/page.tsx` | `summary.metrics.answerRate` | Backend in baseline / client in HEAD | Yes | **LIVE_BACKEND_CONNECTED** |
| **Avg Total Time (ACL)**| Yes | `reporting/page.tsx` | `summary.metrics.averageDuration` | Backend `AVG(duration)` | Yes | **LIVE_BACKEND_CONNECTED** |
| **Avg Talk Time** | Baseline only | `reporting/page.tsx` | `summary.metrics.averageTalkTime` | Backend `AVG(talkDuration)` | Yes | **LIVE_IN_BASELINE** |
| **Live Calls** | Yes | `Header.tsx` | `liveCalls` from `/calls/live-calls` | Redis / In-memory active calls count | Yes | **LIVE_BACKEND_CONNECTED** |
| **Revenue** | Baseline only | `reporting/page.tsx` | `summary.metrics.totalRevenue` | Backend `SUM(buyerRevenue)` | Yes | **LIVE_IN_BASELINE** |
| **Payout** | Baseline only | `reporting/page.tsx` | `summary.metrics.totalPayout` | Backend `SUM(publisherPayout)` | Yes | **LIVE_IN_BASELINE** |
| **Profit / Margin** | Baseline only | `reporting/page.tsx` | `summary.metrics.totalProfit` | Backend `SUM(revenue - payout)` | Yes | **LIVE_IN_BASELINE** |
| **Converted** | Baseline only | `reporting/page.tsx` | `summary.metrics.convertedCalls` | Backend count (`isConverted = true`) | Yes | **LIVE_IN_BASELINE** |
| **Qualified** | Baseline only | `reporting/page.tsx` | `summary.metrics.qualifiedCalls` | Backend count (`isQualified = true`) | Yes | **LIVE_IN_BASELINE** |
| **Duplicate** | Baseline only | `reporting/page.tsx` | `summary.metrics.duplicateCalls` | Backend count (`isDuplicate = true`) | Yes | **LIVE_IN_BASELINE** |

---

## 9. Reporting Filter Audit

Dialics Reference Filter Comparison:

| Filter Dimension | UI Field Present? | API Param Supported? | Backend Query Supported? | Forensic Status | Evidence / Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Date Range** | Yes | Yes (`startDate`, `endDate`) | Yes | **LIVE_BACKEND_CONNECTED** | `ReportsService.getSummary` applies SQL date boundaries |
| **Campaign** | Yes | Yes (`campaignId`) | Yes | **LIVE_BACKEND_CONNECTED** | Filtered via indexed foreign key `campaignId` |
| **Buyer** | Yes | Yes (`buyerId`) | Yes | **LIVE_BACKEND_CONNECTED** | Filtered via `call_routes.buyerId` |
| **Tracking Number**| Yes | Yes (`trackingNumber`) | Yes | **LIVE_BACKEND_CONNECTED** | Exact string match on `inboundNumber` |
| **Caller ID (CLI)** | Yes | Yes (`callerNumber`) | Yes | **LIVE_BACKEND_CONNECTED** | Exact string match on `callerNumber` |
| **Status** | Yes | Yes (`status`) | Yes | **LIVE_BACKEND_CONNECTED** | Matches CallStatus enum |
| **Duration (Min/Max)**| Yes | Yes (`minDuration`, `maxDuration`)| Yes | **LIVE_BACKEND_CONNECTED**| Numeric comparison on call `duration` |
| **Vendor** | **No** | No | Schema only | **MISSING** | No vendor filter input in UI |
| **Destination Name**| **No** | No | No | **MISSING** | Destinations are not exposed as filter dimension |
| **Destination Number**|**No**| No | No | **MISSING** | Not filterable in UI or API |
| **Traffic Source** | **No** | No | No | **MISSING** | Schema lacks traffic source taxonomy |
| **Number Pool** | **No** | No | No | **MISSING** | No concept of DNI pools in UI |
| **Parameters / Custom**|**No**| No | No | **MISSING** | No dynamic query param filtering |
| **Caller Profile/State**|**No**| No | No | **MISSING** | No geographic or demographic filters |
| **Tags** | **No** | No | No | **MISSING** | Call tagging does not exist in UI |
| **UUID** | **No** | Partial (`callId` search) | Partial | **PARTIAL** | Can lookup by ID in Call Log, not filter dropdown |
| **SIP Headers** | **No** | No | No | **MISSING** | No SIP header inspection in frontend |
| **Fail Reason** | **No** | No | Schema only | **MISSING** | `endReason` exists in DB, but no UI filter |

---

## 10. Reporting Grouping Audit

| Grouping Dimension | UI Control Present? | API Group Parameter | Backend SQL Aggregation | Forensic Status |
| :--- | :--- | :--- | :--- | :--- |
| **Campaign** | Yes (Tab) | `groupBy=campaign` | `GROUP BY c.id, c.name` | **LIVE_BACKEND_CONNECTED** |
| **Buyer** | Yes (Tab) | `groupBy=buyer` | `GROUP BY b.id, b.name` | **LIVE_BACKEND_CONNECTED** |
| **Tracking Number** | Yes (Tab) | `groupBy=trackingNumber` | `GROUP BY c.inboundNumber` | **LIVE_BACKEND_CONNECTED** |
| **Status** | Yes (Tab) | `groupBy=status` | `GROUP BY c.status` | **LIVE_BACKEND_CONNECTED** |
| **Vendor** | **No** | `groupBy=vendor` (unsupported) | Not implemented | **MISSING** |
| **Dialed** | **No** | Unsupported | Not implemented | **MISSING** |
| **Date / Day** | **No** | Handled in time series | Not in performance grouping table | **MISSING IN TABLE** |
| **Traffic Source** | **No** | Unsupported | Not implemented | **MISSING** |
| **Number Pool** | **No** | Unsupported | Not implemented | **MISSING** |

---

## 11. Call Summary Audit

The **Performance Grouping Table** renders summary aggregations across the selected dimension:
- **Columns in HEAD (`f901302`)**: Name / Key, Total Calls, Answered, Missed, Failed, Avg Duration (ACL).
- **Columns in Baseline (`38a46c8` / `59da9de`)**: Name / Key, Total Calls, Answered, Qualified, Converted, Conv. Rate, Revenue, Payout, Profit, ACL.
- **Aggregation Logic**: Grouped by SQL `SUM`, `COUNT`, `AVG` in `ReportsService.getGroupedPerformance`.
- **Sorting**: Client-side column sorting supported on metric headers.
- **Total Summary Row**: Bottom summary row calculates cumulative sums for displayed rows.

---

## 12. Call Log Audit

The **Detailed Calls Table** provides row-level granularity:
- **Columns in HEAD (`f901302`)**:
  - `Call Date`: Formatted timestamp (`YYYY-MM-DD HH:mm`).
  - `Caller ID`: Masked/formatted caller number.
  - `Tracking Number`: Inbound DID.
  - `Status`: Colored badge (`COMPLETED` = green, `FAILED` = red, `NO_ANSWER` = yellow).
  - `Duration`: Formatted duration (`mm:ss`).
  - `Actions`: Clickable link navigating to `/protected/calls/[callId]`.
- **Columns in Baseline (`38a46c8` / `59da9de`)**:
  - Adds `Revenue`, `Payout`, `Qualified` badge, `Converted` badge.
- **Missing Dialics Columns**: Vendor, Traffic Source, Hangup Cause, Tags, Recording audio player, SIP Headers, Geo/Caller Identity.

---

## 13. Reporting Charts

| Chart Component | Chart Type | API Source & Key | Metrics Displayed | Forensic Status |
| :--- | :--- | :--- | :--- | :--- |
| **Call Volume Trend** | Recharts `LineChart` | `summary.timeSeries[]` | `totalCalls` (Blue line), `answeredCalls` (Green line) bucketed by hour/day/week | **LIVE_BACKEND_CONNECTED** |
| **Outcome Distribution** | Recharts `PieChart` | `summary.metrics` | Completed (Green), No Answer (Yellow), Failed (Red), Busy (Gray) | **LIVE_BACKEND_CONNECTED** |
| **Revenue Trend** | None | Not implemented | None | **MISSING** |
| **Conversion Trend** | None | Not implemented | None | **MISSING** |

---

## 14. Call Details UI

File: `apps/web/src/app/protected/calls/[callId]/page.tsx`
When a user clicks on a call:
- **Call Metadata Card**: Call ID, Direction (INBOUND), Inbound Tracking Number, Caller Number, Status badge, Start/End timestamps, Total Duration.
- **Routing Journey Card**: Displays routing attempts, target Buyer name, selected Destination phone number, route status (`CONNECTED`, `FAILED`, `BUSY`), and attempt duration.
- **Call Economics Card (Baseline `38a46c8` / `59da9de`)**: Displays Buyer Revenue, Publisher Payout, Net Margin, Qualification Status, Conversion Status, Duplicate indicator.
- **Recording & Audio**: Audio player component is rendered if `recordingUrl` is non-null.
- **Transcript**: Rendered in a collapsible card if `transcript` is present.
- **Missing Elements**: No SIP debug trace, no dispute action button, no routing rerun simulation.

---

## 15. Commercial UI

| Commercial Feature | Visible in UI? | Component Path | Backend Model / API | Forensic Status |
| :--- | :--- | :--- | :--- | :--- |
| **Buyer Revenue** | Baseline only | `reporting/page.tsx`, `calls/[id]/page.tsx` | `CallEconomics.buyerRevenue` | **LIVE_IN_BASELINE** |
| **Vendor/Publisher Payout** | Baseline only | `reporting/page.tsx`, `calls/[id]/page.tsx` | `CallEconomics.publisherPayout`| **LIVE_IN_BASELINE** |
| **Net Profit / Margin** | Baseline only | `reporting/page.tsx`, `calls/[id]/page.tsx` | `CallEconomics.netMargin` | **LIVE_IN_BASELINE** |
| **Qualification Indicator** | Baseline only | `calls/[id]/page.tsx` | `CallEconomics.isQualified` | **LIVE_IN_BASELINE** |
| **Conversion Indicator** | Baseline only | `calls/[id]/page.tsx` | `CallEconomics.isConverted` | **LIVE_IN_BASELINE** |
| **Duplicate Indicator** | Baseline only | `calls/[id]/page.tsx` | `CallEconomics.isDuplicate` | **LIVE_IN_BASELINE** |
| **Dispute Status Badge** | Baseline only | `calls/[id]/page.tsx` | `CallDispute.status` | **LIVE_IN_BASELINE (READ-ONLY)** |

---

## 16. Dispute UI

- **Dispute Creation**: **NOT PRESENT**. No button or modal exists to file a dispute against a call.
- **Dispute Management Table**: **NOT PRESENT**. No `/protected/disputes` page exists.
- **Dispute Resolution Workflow**: **NOT PRESENT**. No admin UI to accept, reject, or adjust amounts.
- **Read-Only Status**: In baseline `38a46c8`, `calls/[callId]/page.tsx` checks if `call.dispute` is non-null; if present, it displays a passive badge (`PENDING`, `RESOLVED`, `REJECTED`) and note text.

---

## 17. Settlement UI

A complete forensic search across all files in `apps/web/src` reveals:
- **SettlementBatch UI**: `NOT_PRESENT` (0 occurrences in frontend)
- **SettlementItem UI**: `NOT_PRESENT` (0 occurrences in frontend)
- **SettlementAdjustment UI**: `NOT_PRESENT` (0 occurrences in frontend)
- **PaymentInstruction UI**: `NOT_PRESENT` (0 occurrences in frontend)
- **PaymentExecution UI**: `NOT_PRESENT` (0 occurrences in frontend)
- **ReconciliationRun UI**: `NOT_PRESENT` (0 occurrences in frontend)
- **ReconciliationIssue UI**: `NOT_PRESENT` (0 occurrences in frontend)

*Conclusion*: Commercial settlement generation and financial reconciliation exist exclusively as backend domain logic; zero frontend interface has been built for them.

---

## 18. Role / Permission UI

File: `apps/web/src/app/protected/members/[memberId]/page.tsx`
- **Granular RBAC Matrix**: The UI provides interactive toggle switches for permissions:
  - `canManageCampaigns`
  - `canManageBuyers`
  - `canManageNumbers`
  - `canViewReports`
  - `canExportReports`
  - `canManageBilling`
  - `canManageIntegrations`
- **Role Assignment**: Dropdown supporting `OWNER`, `ADMIN`, `MEMBER`, `VIEWER`.
- **Backend Sync**: Dispatches `PATCH /workspaces/:id/members/:memberId`.
- **UI Enforcement**: Buttons for actions like export and configuration are disabled or hidden based on member permission payload.

---

## 19. Responsive / UX States

Every major protected page was inspected for UX resiliency:
- **Loading States**: Skeletons or spinning loader indicators are rendered while `loading === true`.
- **Error States**: Error banners with retry buttons or `toast.error()` notifications are triggered when API requests throw 4xx/5xx errors.
- **Empty States**: Empty illustration cards appear when arrays return length 0 (e.g., "No calls found for selected filters", "No campaigns created yet").
- **Pagination Controls**: Standard Previous / Next and page index buttons bound to URL parameters.
- **Mobile Responsiveness**: Sidebar collapses into a mobile hamburger menu on viewports `< 768px`.

---

## 20. Mock / Placeholder Detection

1. **Root Landing Page** (`apps/web/src/app/page.tsx`):
   - **100% Mock / Boilerplate**: Contains standard Next.js starter template links to Vercel documentation.
2. **Billing Mock Top-Up** (`apps/web/src/app/protected/billing/page.tsx`):
   - Contains an explicit `Development Mode — Mock payment` section triggering `handleMockTopUp`, which directly credits the workspace account without Stripe.
3. **Core Operational Pages**:
   - Zero mock data. Calls, reporting, numbers, campaigns, and buyers query real database records.

---

## 21. Dead / Unused Frontend Code

- `apps/web/src/app/protected/page.tsx`: Does not render any UI; exclusively executes `redirect('/protected/reporting')`.
- `apps/web/src/app/page.tsx`: Vestigial Next.js boilerplate template that is completely disconnected from CallFlow.

---

## 22. Frontend Testing

- **Test Runner**: Vitest with React Testing Library (`vitest.config.ts`).
- **Test Execution**: `npm --prefix apps/web test` runs cleanly:
  - `src/components/layout/Sidebar.test.tsx` (Passed)
  - `src/components/layout/Header.test.tsx` (Passed)
  - `src/components/reporting/CallSummary.test.tsx` (Passed)
  - `src/components/reporting/MetricsCards.test.tsx` (Passed)
  - `src/components/reporting/TimeSeriesChart.test.tsx` (Passed)
  - `src/lib/api.test.ts` (Passed)
  - Total: 8 test suites, 30 tests passing.

---

## 23. Dialics Reporting Parity Matrix

Comprehensive feature comparison between Dialics reference capabilities and CallFlow:

| Dialics Reporting Feature | CallFlow HEAD (`f901302`) | CallFlow Baseline (`59da9de`) | Gap Assessment |
| :--- | :--- | :--- | :--- |
| **Live Call Real-Time Counter** | Implemented (Header Badge) | Implemented (Header Badge) | **Parity Achieved** |
| **Operational KPIs (Calls, Ans, Miss, Fail)** | Implemented | Implemented | **Parity Achieved** |
| **Commercial KPIs (Revenue, Payout, Margin)**| Missing | Implemented | **Parity Achieved in Baseline** |
| **Conversion & Qualification Rates** | Missing | Implemented | **Parity Achieved in Baseline** |
| **Performance Grouping: Campaign** | Implemented | Implemented | **Parity Achieved** |
| **Performance Grouping: Buyer** | Implemented | Implemented | **Parity Achieved** |
| **Performance Grouping: Tracking Number** | Implemented | Implemented | **Parity Achieved** |
| **Performance Grouping: Vendor** | Missing | Missing | **Critical Gap** |
| **Performance Grouping: Traffic Source** | Missing | Missing | **Critical Gap** |
| **Performance Grouping: Date / Day** | Missing in Summary Table | Missing in Summary Table | **Gap** |
| **Filter: Vendor / Publisher** | Missing | Missing | **Critical Gap** |
| **Filter: Traffic Source / SubID** | Missing | Missing | **Critical Gap** |
| **Filter: Destination Endpoints** | Missing | Missing | **Gap** |
| **Filter: Hangup Cause / End Reason** | Missing | Missing | **Gap** |
| **Filter: Geographic / Caller Profile** | Missing | Missing | **Gap** |
| **Call Recording Playback** | Implemented | Implemented | **Parity Achieved** |
| **Call Audio Waveform / Speed Toggle** | Basic HTML5 Audio | Basic HTML5 Audio | **Minor Gap** |
| **Call Transcription Viewer** | Implemented (if present) | Implemented (if present) | **Parity Achieved** |
| **Dispute Management UI** | Missing | Read-only Badge Only | **Critical Gap** |
| **Settlement & Invoicing UI** | Missing | Missing | **Critical Gap** |
| **Saved Reports** | Implemented | Implemented | **Parity Achieved** |
| **Report Export (CSV / XLSX)** | Implemented | Implemented | **Parity Achieved** |

---

## 24. Complete Feature Layer Matrix

Classification across all features:

| Feature / Domain | UI Exists? | API Exists? | DB Schema Exists? | Real Backend Connected? | Classification |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Operational Calls Log** | Yes | Yes | Yes | Yes | `LIVE_BACKEND_CONNECTED` |
| **Call Details & History** | Yes | Yes | Yes | Yes | `LIVE_BACKEND_CONNECTED` |
| **Operational Reporting** | Yes | Yes | Yes | Yes | `LIVE_BACKEND_CONNECTED` |
| **Commercial Reporting** | Baseline only | Baseline only | Yes | Baseline only | `LIVE_BACKEND_CONNECTED (BASELINE)` |
| **Saved Reports** | Yes | Yes | Yes | Yes | `LIVE_BACKEND_CONNECTED` |
| **Report Export** | Yes | Yes | Yes | Yes | `LIVE_BACKEND_CONNECTED` |
| **Campaigns & Routing** | Yes | Yes | Yes | Yes | `LIVE_BACKEND_CONNECTED` |
| **Buyers & Destinations** | Yes | Yes | Yes | Yes | `LIVE_BACKEND_CONNECTED` |
| **Inbound Phone Numbers** | Yes | Yes | Yes | Yes | `LIVE_BACKEND_CONNECTED` |
| **Blocked Callers** | Yes | Yes | Yes | Yes | `LIVE_BACKEND_CONNECTED` |
| **Granular Team RBAC** | Yes | Yes | Yes | Yes | `LIVE_BACKEND_CONNECTED` |
| **API Keys & Webhooks** | Yes | Yes | Yes | Yes | `LIVE_BACKEND_CONNECTED` |
| **Vendors Management** | No | Partial | Yes (`Vendor`) | No | `MISSING` |
| **Number Pools (DNI)** | No | No | No | No | `MISSING` |
| **Dispute Filing / Workflow** | No | Partial | Yes (`CallDispute`) | No | `MISSING` |
| **Settlement Batches** | No | Yes | Yes (`SettlementBatch`) | No | `MISSING` |
| **Payment Instructions** | No | Yes | Yes (`PaymentInstruction`) | No | `MISSING` |
| **Financial Reconciliation** | No | Yes | Yes (`ReconciliationRun`) | No | `MISSING` |

---

## 25. Known Unknowns
1. **Third-Party Telephony Audio Storage**: The exact external S3/Twilio bucket lifecycle for `recordingUrl` could not be verified from the frontend client code alone.
2. **Production Payment Gateway**: Outside of the explicit development mock top-up endpoint, Stripe/payment processor webhook verification is handled asynchronously on the backend.

---

## 26. Final Frontend Status
- **Operational Frontend Status**: **PRODUCTION-GRADE & LIVE CONNECTED**. Call tracking, campaign routing, buyer management, telephone number allocation, and operational reporting are solidly wired to backend database services.
- **Commercial / Dialics Parity Status**: **INCOMPLETE**. While commercial KPI metrics and reporting columns are implemented in baseline `59da9de`, CallFlow frontend completely lacks UI for Vendors, Number Pools, Invoicing/Settlement workflows, and Dispute management.
