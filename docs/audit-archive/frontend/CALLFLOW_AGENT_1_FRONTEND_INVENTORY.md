# CALLFLOW — AGENT 1: COMPLETE FRONTEND FEATURE & COMPONENT INVENTORY

**Author:** Agent 1 (Frontend & Client-Side Architecture Specialist)  
**Target Application:** CallFlow Web Client (`apps/web`)  
**Audit Status:** Complete Inventory  

---

## 1. ROUTES & PAGES INVENTORY

The CallFlow frontend architecture is structured using the Next.js App Router (`apps/web/src/app`). The platform features 22 distinct routable pages divided into Public Authentication/Utility screens and Protected Operational views.

### 1.1 Public Routes (Authentication & Utility)

| Route Path | File Location | Purpose & Access Control | Key Features & Elements |
| :--- | :--- | :--- | :--- |
| `/` | `apps/web/src/app/page.tsx` | Root Landing Page | **Defect:** Unconfigured Next.js template page. Contains external Vercel links. Should redirect to `/protected` or `/login`. |
| `/login` | `apps/web/src/app/login/page.tsx` | User Sign In | Email & Password inputs, Server Action login handler, Invitation token query recognition, redirect to `/forgot-password`, `/signup`. |
| `/signup` | `apps/web/src/app/signup/page.tsx` | User Registration | Full Name, Email, Password, Confirm Password, Invitation token pre-fill, Server Action registration handler, redirect to `/login`. |
| `/forgot-password` | `apps/web/src/app/forgot-password/page.tsx` | Password Recovery Request | Email input, Client-side format validation, In-memory dev mailer link capture display in development mode. |
| `/reset-password` | `apps/web/src/app/reset-password/page.tsx` | Password Reset Execution | Token-gated form, Password & Confirm Password inputs, Show/Hide password toggles, Minimum 6 character validation. |
| `/invitations` | `apps/web/src/app/invitations/page.tsx` | Public Invitation Preview | Token verification via API, workspace name and email preview, routing links to signup or login with token preservation. |
| `/auth/callback` | `apps/web/src/app/auth/callback/route.ts` | Supabase OAuth / Magic Link Callback | Route handler exchanging authentication code for session and redirecting to intended path. |
| `/onboarding` | `apps/web/src/app/onboarding/page.tsx` | New User Onboarding | Checks if user has any existing workspaces. If none, renders `OnboardingClient` to create first workspace. |

### 1.2 Protected Routes (Operational & Administrative)

All protected routes are housed under `apps/web/src/app/protected` and inherit the master shell (`apps/web/src/app/protected/layout.tsx`).

| Route Path | File Location | Module / Domain | Role-Based Access (RBAC) | Key UI Elements |
| :--- | :--- | :--- | :--- | :--- |
| `/protected` | `apps/web/src/app/protected/page.tsx` | Root Dashboard Redirect | All authenticated users | Client redirect to `/protected/reporting?workspace=<id>`. |
| `/protected/reporting` | `apps/web/src/app/protected/reporting/page.tsx` | Operational & Financial Reporting | All Workspace Roles (Scoped by participant type) | Dual-axis volume/revenue chart, outcome breakdown pie chart, 8 KPI cards, dynamic data table, saved reports modal, CSV/XLSX export. |
| `/protected/calls` | `apps/web/src/app/protected/calls/page.tsx` | Detailed Call Logs | All Workspace Roles (Scoped by participant type) | Paginated calls table, duration filters, campaign/buyer/status filters, inline audio player. |
| `/protected/calls/[callId]` | `apps/web/src/app/protected/calls/[callId]/page.tsx` | Detailed Call Inspection | All Workspace Roles (Scoped by participant type) | Call timing metrics, routed attempts list, dialed destination snapshot, dispute submission form, dispute resolution modal, audio playback/download. |
| `/protected/campaigns` | `apps/web/src/app/protected/campaigns/page.tsx` | Campaign Routing Management | Owner, Admin, Member (Hidden for Vendor) | Campaign card list, active/inactive tabs, commercial pricing inputs, conversion duration threshold settings, create/edit modals. |
| `/protected/campaigns/[campaignId]` | `apps/web/src/app/protected/campaigns/[campaignId]/page.tsx` | Campaign Waterfall Configuration | Owner, Admin, Member | Priority/Weight destination number waterfall table, tracking numbers association list, assign destination modal. |
| `/protected/buyers` | `apps/web/src/app/protected/buyers/page.tsx` | Buyer Organization Management | Owner, Admin, Member (Read-only for Member; Hidden for Vendor) | Buyer organization grid, metric cards, create buyer modal, edit modal, deactivate confirmation, user invite trigger. |
| `/protected/buyers/[buyerId]` | `apps/web/src/app/protected/buyers/[buyerId]/page.tsx` | Buyer Details & Destinations | Owner, Admin, Member | Buyer metadata, destination phone numbers table, add destination modal with concurrency and timeout configuration. |
| `/protected/vendors` | `apps/web/src/app/protected/vendors/page.tsx` | Vendor Management | Owner, Admin, Member with `vendor:read` (Hidden for Vendor/Buyer) | Vendor organization list, status filter, create vendor modal, edit modal, deactivate/activate actions. |
| `/protected/vendors/[vendorId]` | `apps/web/src/app/protected/vendors/[vendorId]/page.tsx` | Vendor Profile & Tracking Numbers | Owner, Admin, Member with `vendor:read` | Vendor metadata, assigned phone numbers table, assign number modal, unassign confirmation dialog, invite vendor user dialog. |
| `/protected/phone-numbers` | `apps/web/src/app/protected/phone-numbers/page.tsx` | Telephony Ingress & Provisioning | Owner, Admin, Member, Vendor (Scoped to assigned numbers for Vendor) | Tracking numbers table, Telnyx search/provisioning drawer, campaign assignment modal, vendor assignment modal. |
| `/protected/disputes` | `apps/web/src/app/protected/disputes/page.tsx` | Commercial Call Disputes | Owner, Admin, Member, Buyer (Hidden for Vendor) | Paginated disputes data grid, status tabs, resolution modal with acceptance/rejection notes, adjusted revenue summary. |
| `/protected/settlements` | `apps/web/src/app/protected/settlements/page.tsx` | Commercial Settlements | Owner, Admin, Member, Buyer, Vendor | Settlement batch table, date-range filters, batch detail side-drawer, line-item table, batch generation modal (Owner only). |
| `/protected/payments` | `apps/web/src/app/protected/payments/page.tsx` | Settlement Disbursements | Owner, Admin, Member with `payment:read` (Hidden for Vendor/Buyer) | Payment instructions table, status and direction filters, execute payment modal, retry execution modal. |
| `/protected/payments/[instructionId]` | `apps/web/src/app/protected/payments/[instructionId]/page.tsx` | Payment Instruction Detail | Owner, Admin, Member with `payment:read` | Instruction summary, provider transaction logs, execution attempts table, retry action trigger. |
| `/protected/reconciliation` | `apps/web/src/app/protected/reconciliation/page.tsx` | Financial Reconciliation | Owner, Admin, Member with `reconciliation:read` (Hidden for Vendor/Buyer) | Reconciliation runs list, discrepancy status badges, trigger workspace recon modal, trigger batch recon modal. |
| `/protected/reconciliation/[runId]` | `apps/web/src/app/protected/reconciliation/[runId]/page.tsx` | Reconciliation Discrepancies | Owner, Admin, Member with `reconciliation:read` | Discrepancy item list, financial differences breakdown, resolution guidance. |
| `/protected/blocked-callers` | `apps/web/src/app/protected/blocked-callers/page.tsx` | Ingress Call Blocking | Owner, Admin | Blocked callers table, add number form with reason input, unblock confirmation dialog. |
| `/protected/api-keys` | `apps/web/src/app/protected/api-keys/page.tsx` | Developer API Keys | Owner, Admin | Active keys table, create key form, one-time raw secret display card with copy button, revoke confirmation dialog. |
| `/protected/webhooks` | `apps/web/src/app/protected/webhooks/page.tsx` | Developer Webhooks | Owner, Admin | Webhook endpoints table, register endpoint form, signing secret display card, delete confirmation dialog. |
| `/protected/usage` | `apps/web/src/app/protected/usage/page.tsx` | Operational Telephony Usage | Owner, Admin | Voice call minutes card, active phone numbers card, recording storage consumption card, billing cycle display. |
| `/protected/billing` | `apps/web/src/app/protected/billing/page.tsx` | Workspace Wallet & Plans | Owner, Admin | Prepaid wallet balance card, Stripe billing portal button, plan subscription cards, mock top-up trigger, transaction ledger. |
| `/protected/members` | `apps/web/src/app/protected/members/page.tsx` | Team & Participant Management | Owner, Admin | Active members table, role selector dropdown, pending invitations table, revoke invite action, invite modal. |
| `/protected/members/[memberId]` | `apps/web/src/app/protected/members/[memberId]/page.tsx` | Granular Permissions | Owner, Admin | Member details, assigned permissions list, grant permission form with resource scoping, linked buyers management. |
| `/protected/audit-logs` | `apps/web/src/app/protected/audit-logs/page.tsx` | Security & Compliance Audit Logs | Owner, Admin, Member with `audit_log:read` (Hidden for Vendor/Buyer) | Audit event table, action/target filtering, date range filter, metadata JSON inspector modal with key sanitization. |
| `/protected/settings` | `apps/web/src/app/protected/settings/page.tsx` | Workspace Configuration | Owner, Admin | Workspace name edit form, workspace ID display. |
| `/protected/account` | `apps/web/src/app/protected/account/page.tsx` | Personal Account Settings | All authenticated users | Profile full name form, email change form, password change form, theme preference selector. |
| `/protected/accept-invitation` | `apps/web/src/app/protected/accept-invitation/page.tsx` | Auto-Accept Invitation | All authenticated users | Client-side acceptance trigger, status spinner, auto-redirect to accepted workspace. |

---

## 2. REUSABLE UI COMPONENTS INVENTORY

Components located in `apps/web/src/components/ui` and `apps/web/src/components`:

| Component Name | File Path | Props / API | Description & Visual Role |
| :--- | :--- | :--- | :--- |
| `Button` | `apps/web/src/components/ui/button.tsx` | `variant` (primary, secondary, destructive, ghost, outline), `size` (default, sm, lg, icon), `isLoading`, standard button attributes | Base button with integrated loading spinner and disabled state. |
| `Card` | `apps/web/src/components/ui/card.tsx` | Standard HTML div attributes, `CardHeader`, `CardTitle`, `CardDescription` (`as` prop), `CardContent`, `CardFooter` | Modular container card with border, shadow, and background styling. |
| `Badge` | `apps/web/src/components/ui/badge.tsx` | `variant` (default, secondary, destructive, outline, success, warning, error, info) | Pill badge for statuses, roles, and call tags. |
| `Input` | `apps/web/src/components/ui/input.tsx` | Standard HTML input attributes | Themed text, email, number, and password input. |
| `Label` | `apps/web/src/components/ui/label.tsx` | Standard HTML label attributes | Accessible label with disabled styling integration. |
| `Table` | `apps/web/src/components/ui/table.tsx` | `Table`, `TableHeader`, `TableBody`, `TableFooter`, `TableHead`, `TableRow`, `TableCell`, `TableCaption` | Tailwind data grid with borders and hover highlights. |
| `EmptyState` | `apps/web/src/components/ui/empty-state.tsx` | `icon`, `title`, `description`, `action` | Centered state placeholder when collections have zero items. |
| `Skeleton` | `apps/web/src/components/ui/skeleton.tsx` | Standard HTML div attributes | Pulsing gray placeholder box for loading states. |
| `ConfirmDialog` | `apps/web/src/components/ui/confirm-dialog.tsx` | `open`, `onOpenChange`, `title`, `description`, `confirmText`, `cancelText`, `onConfirm`, `isLoading`, `destructive` | Accessible modal dialog with backdrop blur, escape key support, and loading states. |
| `InlineRecordingPlayer` | `apps/web/src/components/ui/recording-player.tsx` | `workspaceId`, `recordingId`, `callWorkspaceId`, `recordings`, `className` | Audio recording player with play/pause controls, presigned download fetch, and error retry state. |
| `InviteUserDialog` | `apps/web/src/components/invite-user-dialog.tsx` | `workspaceId`, `isOpen`, `onClose`, `participantType`, `entityId`, `entityName`, `onSuccess` | Modal for creating and copying invitation links scoped to specific Buyer or Vendor organizations. |
| `WorkspaceSelector` | `apps/web/src/components/workspace-selector.tsx` | `workspaces` array | Global header dropdown that changes the active workspace and updates URL and `sessionStorage`. |
| `WorkspaceValidator` | `apps/web/src/components/workspace-validator.tsx` | `workspaces` array, `children` | Client-side wrapper ensuring user belongs to active workspace, handling URL synchronization and access denied states. |
| `Header` | `apps/web/src/components/header.tsx` | `workspaces`, `user`, `onMenuClick` | Application top navigation bar featuring `HeaderMetrics` (live calls and wallet balance), workspace selector, and logout. |
| `Sidebar` | `apps/web/src/components/sidebar.tsx` | `workspaces`, `onNavClick` | Navigation drawer with categorized links (Overview, Routing, Developer, Billing, Workspace, Personal) scoped by RBAC. |
| `Shell` | `apps/web/src/components/shell.tsx` | `workspaces`, `user`, `children` | Top-level responsive page layout containing desktop sidebar, mobile overlay drawer, header, and main content area. |
| `AppearanceSettings` | `apps/web/src/components/appearance-settings.tsx` | None | Theme toggle card (Light, Dark, System) utilizing `next-themes`. |

---

## 3. INTERACTIVE FORMS & INPUTS INVENTORY

| Form Name | Page / Modal | Target API Endpoint | Input Fields & Types | Validation Rules |
| :--- | :--- | :--- | :--- | :--- |
| **Login Form** | `/login` | Supabase Auth `signInWithPassword` | Email (text/email), Password (password), InviteToken (hidden) | Required fields, email format. |
| **Signup Form** | `/signup` | Supabase Auth `signUp` | Full Name (text), Email (email), Password (password), Confirm Password (password) | Password match check, required fields. |
| **Forgot Password** | `/forgot-password` | `POST /auth/forgot-password` | Email (email) | Valid email regex pattern. |
| **Reset Password** | `/reset-password` | `POST /auth/reset-password` | Token (URL param), Password (password), Confirm Password (password) | Min 6 characters, passwords match. |
| **Onboarding Form** | `/onboarding` | `POST /workspaces` | Workspace Name (text) | Non-empty string required. |
| **Create Buyer** | `/protected/buyers` (Modal) | `POST /workspaces/:id/buyers` | Name (text), Email (email), Destination (text), Timeout (number), MaxConcurrent (number) | Name required, valid email, E.164 destination, Timeout (5–300s), Concurrency (1–1000). |
| **Edit Buyer** | `/protected/buyers` (Modal) | `PUT /workspaces/:id/buyers/:buyerId` | Name (text), Email (email), Timeout (number), MaxConcurrent (number) | Same validation as creation. |
| **Add Destination** | `/protected/buyers/[buyerId]` (Modal) | `POST /workspaces/:id/buyers/:buyerId/destination-numbers` | Phone Number (text), Label (text), Timeout (number), MaxConcurrent (number) | Valid E.164 phone number, timeout 5–300s, concurrency 1–1000. |
| **Create Vendor** | `/protected/vendors` (Modal) | `POST /workspaces/:id/vendors` | Vendor Name (text) | Vendor name required. |
| **Edit Vendor** | `/protected/vendors` (Modal) | `PUT /workspaces/:id/vendors/:vendorId` | Vendor Name (text) | Vendor name required. |
| **Create Campaign** | `/protected/campaigns` (Modal) | `POST /workspaces/:id/campaigns` | Name (text), Revenue (number), Payout (number), Currency (select), ConversionDuration (number) | Positive rates or 0, conversion duration integer >= 0. |
| **Edit Campaign** | `/protected/campaigns` (Modal) | `PUT /workspaces/:id/campaigns/:campaignId` | Name (text), Revenue (number), Payout (number), Currency (select), ConversionDuration (number) | Same as creation. |
| **Assign Waterfall** | `/protected/campaigns/[campaignId]` (Modal) | `POST /workspaces/:id/campaigns/:campaignId/destination-numbers` | Destination (select), Priority (number), Weight (number) | Destination selection required, priority >= 1, weight >= 1. |
| **File Dispute** | `/protected/calls/[callId]` (Card) | `POST /workspaces/:id/call-commercials/:commId/dispute` | Reason (text), Description (textarea) | Reason mandatory. |
| **Resolve Dispute** | `/protected/disputes` & `calls/[callId]` (Modal) | `POST /workspaces/:id/disputes/:disputeId/resolve` | Status (ACCEPTED / REJECTED), Resolution Notes (textarea) | Resolution action selection required. |
| **Generate Settlements** | `/protected/settlements` (Modal) | `POST /workspaces/:id/settlements/batches/generate` | Participant Type (select), Period Start (datetime-local), Period End (datetime-local), Participant ID (text) | Period start must be strictly before period end. |
| **Execute Payment** | `/protected/payments` (Modal) | `POST /workspaces/:id/payments/instructions/:id/executions` | Provider (manual / wire / mock) | Provider selection required. |
| **Run Batch Recon** | `/protected/reconciliation` (Modal) | `POST /workspaces/:id/reconciliation/batches/:batchId/run` | Batch ID (text) | Valid batch ID required. |
| **Block Caller** | `/protected/blocked-callers` (Card) | `POST /workspaces/:id/blocked-callers` | Phone Number (text), Reason (text) | Valid E.164 phone number. |
| **Create API Key** | `/protected/api-keys` (Card) | `POST /workspaces/:id/api-keys` | Key Name (text) | Non-empty string. |
| **Create Webhook** | `/protected/webhooks` (Card) | `POST /workspaces/:id/webhooks` | Endpoint URL (url) | Valid HTTP/HTTPS URL. |
| **Save Report** | `/protected/reporting` (Modal) | `POST /workspaces/:id/reports` | Name (text), Visibility (PERSONAL / SHARED) | Non-empty report name. |
| **Invite Member** | `/protected/members` (Modal) | `POST /workspaces/:id/invitations` | Email (email), Role (select), Participant Type (select), Vendor/Buyer ID (select) | Valid email, mandatory entity ID when participant type is BUYER or VENDOR. |
| **Update Name** | `/protected/account` (Card) | `PUT /account/profile` | Full Name (text) | Non-empty string. |
| **Update Password** | `/protected/account` (Card) | Supabase Auth `updateUser` | Current Password (password), New Password (password), Confirm Password (password) | Min 6 characters, passwords match. |

---

## 4. DATA GRIDS & TABLES INVENTORY

| Table / Grid Name | Page Route | Total Display Columns | Sortable Columns | Pagination Mechanism | Key Actions per Row |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Detailed Calls** | `/protected/reporting` | Up to 15 dynamic columns (Date, Caller, Tracking, Campaign, Destination, Status, Talk, Total, Revenue, Payout, Profit, Commercial, Attempts, Recording, Actions) | Controlled via Reorder Column modal | Server-side query (`page`, `limit=20`) | Inline Play Audio, View Call Details link. |
| **Call Logs** | `/protected/calls` | 10 columns (Date, Caller, Tracking, Campaign, Buyer, Status, Talk, Total, Financials, Actions) | Default reverse chronological | Server-side (`page`, `pageSize=20`, `limit`, `offset`) | View Details link, Inline Play Audio. |
| **Buyer Organizations** | `/protected/buyers` | 7 columns (Organization, Status, Inbound Destinations, Email, Concurrency, Timeout, Actions) | Client-side filterable | Client-side filtered array | Edit modal, Deactivate / Activate action, Invite User modal, View Details link. |
| **Buyer Destinations** | `/protected/buyers/[buyerId]` | 6 columns (Phone Number, Name/Label, Status, Concurrency, Timeout, Actions) | Default display | In-memory array | Deactivate / Delete destination. |
| **Vendor Organizations** | `/protected/vendors` | 6 columns (Name, Status, ID, Created At, Updated At, Actions) | Server filterable (`search`, `status`) | Server-side (`page`, `limit=10`, `offset`) | Edit modal, Deactivate / Activate, Invite User, View Details link. |
| **Vendor Numbers** | `/protected/vendors/[vendorId]` | 4 columns (Phone Number, Status, Campaign, Actions) | In-memory | In-memory array | Unassign Number confirmation. |
| **Tracking Numbers** | `/protected/phone-numbers` | 6 columns (Phone Number, Type, Campaign, Vendor, Status, Actions) | Client-side filterable | Client-side filtered array | Assign Campaign modal, Assign Vendor modal, Unassign Vendor modal. |
| **Campaign List** | `/protected/campaigns` | 7 columns (Name, Status, Tracking Numbers, Buyers, Default Revenue, Default Payout, Actions) | Server filterable | Server-side (`page`, `limit=50`, `offset`) | Edit modal, Deactivate / Activate, View Details link. |
| **Campaign Waterfall** | `/protected/campaigns/[campaignId]` | 7 columns (Priority, Destination, Buyer, Timeout, Max Calls, Weight, Actions) | Waterfall priority order | In-memory array | Priority Move Up, Priority Move Down, Remove from Waterfall. |
| **Disputes Grid** | `/protected/disputes` | 8 columns (Call ID, Created At, Buyer, Reason, Disputed Revenue, Status, Adjusted, Actions) | Server filterable (`status`) | Server-side (`page`, `pageSize=25`, `offset`) | Accept dispute modal, Reject dispute modal, View Call detail. |
| **Settlement Batches** | `/protected/settlements` | 9 columns (Batch Number, Period, Type, Entity, Net Amount, Items, Settlement Status, Payment Status, Actions) | Server filterable | Server-side (`limit=25`, `offset`) | View Batch Line Items drawer, Finalize batch action. |
| **Payment Instructions** | `/protected/payments` | 8 columns (ID, Batch, Direction, Participant, Amount, Status, Created At, Actions) | Server filterable (`status`, `participant_type`, `direction`) | Server-side (`limit=25`, `offset`) | View Detail link, Execute payment modal, Retry payment modal. |
| **Reconciliation Runs** | `/protected/reconciliation` | 7 columns (Run ID, Type, Target, Discrepancies, Total Variance, Status, Executed At, Actions) | Server filterable (`run_type`, `status`) | Server-side (`limit=25`, `offset`) | View Discrepancies link. |
| **Security Audit Logs** | `/protected/audit-logs` | 6 columns (Timestamp, Action, Actor, Target Type, Target ID, Actions) | Server filterable (`action`, `targetType`, `startDate`, `endDate`) | Server-side (`limit=25`, `offset`, Next/Prev controls) | View Full Metadata JSON modal. |
| **Workspace Members** | `/protected/members` | 6 columns (Member / Email, User ID, Role, Participant Type, Joined Date, Actions) | In-memory | In-memory array | Change Role dropdown, Remove Member dialog, Manage Permissions link. |
| **Blocked Callers** | `/protected/blocked-callers` | 4 columns (Phone Number, Reason, Blocked Date, Actions) | In-memory | In-memory array | Unblock Number dialog. |
| **API Keys** | `/protected/api-keys` | 6 columns (Name, Key Prefix, Created At, Last Used, Status, Actions) | In-memory | In-memory array | Revoke Key dialog. |
| **Webhooks** | `/protected/webhooks` | 5 columns (Endpoint URL, Status, Created At, Secret Indicator, Actions) | In-memory | In-memory array | Delete Webhook dialog. |

---

## 5. CHARTS & DATA VISUALIZATIONS INVENTORY

| Widget Name | Page Location | Library Used | Data Dimensions Rendered | Responsiveness & Behavior |
| :--- | :--- | :--- | :--- | :--- |
| **Calls & Revenue by Day** | `apps/web/src/app/protected/reporting/calls-by-day-chart.tsx` | Recharts (`ResponsiveContainer`, `BarChart`, `Bar`, `LineChart`, `Line`, `XAxis`, `YAxis`, `Tooltip`, `Legend`) | Dual Y-Axis: Left Axis = Calls Count (Bars: Converted [green], Not Converted [orange], No Answer [red]); Right Axis = Revenue / Payout currency (Line [emerald]). | Fully responsive with `min-h-[320px]`. Dynamically suppresses Line series if commercial metrics are hidden for user role. |
| **Outcome Distribution** | `apps/web/src/app/protected/reporting/outcome-distribution-chart.tsx` | Recharts (`ResponsiveContainer`, `PieChart`, `Pie`, `Cell`, `Tooltip`, `Legend`) | Single dimension: Answered (emerald), Missed (orange), Failed (rose). Calculates percentages automatically. | Responsive container `min-h-[260px]`. Renders empty placeholder if zero completed calls exist. |
| **Live Calls Indicator** | `apps/web/src/components/header.tsx` | Custom React polling hook | Real-time active calls in progress. | Pulses with green ping animation when `liveCalls > 0`. |
| **Wallet Balance Display** | `apps/web/src/components/header.tsx` | Custom React polling hook | Currency formatted minor balance ($X.XX USD). | Re-renders on `wallet-topup` custom event or 10-second polling. |

---

## 6. MODALS, DRAWERS & DIALOGS INVENTORY

| Dialog Name | Component / Page | Trigger Control | Dismissal Controls | Modal Role & Accessibility |
| :--- | :--- | :--- | :--- | :--- |
| **Confirm Action Dialog** | `apps/web/src/components/ui/confirm-dialog.tsx` | Various (Delete, Deactivate, Revoke) | Cancel Button, Escape Key, Backdrop Click | `role="alertdialog"` for destructive, `role="dialog"` for non-destructive. Includes `aria-labelledby` and `aria-describedby`. |
| **Invite User Dialog** | `apps/web/src/components/invite-user-dialog.tsx` | "Invite User" buttons on Buyer/Vendor rows | Close (X) button, Backdrop Click | Fixed modal with focus trap styling, copy invite link button. |
| **Customize Columns** | `apps/web/src/app/protected/reporting/page.tsx` | "Columns" button | Click outside container | Dropdown popover menu with checkboxes and Up/Down reordering arrows. |
| **Saved Reports Menu** | `apps/web/src/app/protected/reporting/page.tsx` | "Saved Reports" button | Click outside container | Dropdown popover menu with report creation form and delete triggers. |
| **Export Format Menu** | `apps/web/src/app/protected/reporting/page.tsx` | "Export ▾" button | Click outside container | Dropdown with "Export as CSV" and "Export as Excel (.xlsx)". |
| **Create Buyer Modal** | `apps/web/src/app/protected/buyers/page.tsx` | "Add Buyer Organization" button | Cancel button, Backdrop Click | Centered modal with multi-field validation. |
| **Edit Buyer Modal** | `apps/web/src/app/protected/buyers/page.tsx` | "Edit" button on Buyer card | Cancel button, Backdrop Click | Centered modal with prepopulated values. |
| **Add Destination Modal** | `apps/web/src/app/protected/buyers/[buyerId]/page.tsx` | "Add Destination Number" button | Cancel button, Backdrop Click | Destination configuration modal with timeout & concurrency controls. |
| **Create Campaign Modal** | `apps/web/src/app/protected/campaigns/page.tsx` | "Create Campaign" button | Cancel button, Backdrop Click | Commercial rate configuration modal. |
| **Assign Destination Modal** | `apps/web/src/app/protected/campaigns/[campaignId]/page.tsx` | "Assign Destination Number" button | Cancel button, Backdrop Click | Waterfall destination selection with priority and weight controls. |
| **Execute Payment Modal** | `apps/web/src/app/protected/payments/page.tsx` | "Execute" button | Cancel button, Backdrop Click | Provider selection modal (`manual`, `wire`, `mock`). |
| **Audit Metadata Modal** | `apps/web/src/app/protected/audit-logs/page.tsx` | "Inspect" button on log row | Close (X) button, Backdrop Click | Code-block viewer with copy sanitized JSON button. |

---

## 7. SIDEBAR & NAVIGATION STRUCTURE

Sidebar items are conditionally rendered in `apps/web/src/components/sidebar.tsx` based on the active workspace role and permissions:

```
[Overview]
├── Calls                (/protected/calls)          - All Roles
├── Reporting            (/protected/reporting)      - All Roles
├── Tracking Numbers     (/protected/phone-numbers)  - VENDOR Only
├── Disputes             (/protected/disputes)       - OWNER, ADMIN, MEMBER, BUYER (Hidden for VENDOR/VIEWER)
├── Settlements          (/protected/settlements)    - All except VIEWER
├── Payments             (/protected/payments)       - OWNER, ADMIN, MEMBER (with payment:read)
└── Reconciliation       (/protected/reconciliation) - OWNER, ADMIN, MEMBER (with reconciliation:read)

[Routing] (Hidden for VENDOR)
├── Campaigns            (/protected/campaigns)      - OWNER, ADMIN, MEMBER
├── Buyers               (/protected/buyers)         - OWNER, ADMIN, MEMBER
├── Vendors              (/protected/vendors)        - OWNER, ADMIN, MEMBER (with vendor:read)
├── Phone Numbers        (/protected/phone-numbers)  - OWNER, ADMIN, MEMBER
└── Blocked Callers      (/protected/blocked-callers)- OWNER, ADMIN

[Developer] (OWNER & ADMIN Only)
├── API Keys             (/protected/api-keys)
└── Webhooks             (/protected/webhooks)

[Billing] (OWNER & ADMIN Only)
├── Usage                (/protected/usage)
└── Billing              (/protected/billing)

[Workspace]
├── Members              (/protected/members)        - OWNER, ADMIN
├── Audit Logs           (/protected/audit-logs)     - OWNER, ADMIN, MEMBER (with audit_log:read)
└── Settings             (/protected/settings)       - OWNER, ADMIN

[Personal]
└── My Account           (/protected/account)        - All Authenticated Users
```
