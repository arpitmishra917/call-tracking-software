# CallFlow Frontend Agent Context

## 1. Document Purpose

This document provides project-specific technical context for new frontend developers and AI coding agents joining the CallFlow project. It explains the frontend architecture, technology stack, routing, component patterns, API interactions, and strict boundaries.

This document does NOT replace the master product specification. `MVP1_BUILD_SPEC_v5.md` remains the authoritative master product specification.

The actual source code is authoritative for implementation. If documentation conflicts with the source code, the source code and database schema prevail.

------------------------------------------------------------

## 2. Project Identity

- **Product Name**: CallFlow
- **Purpose**: A multi-tenant SaaS platform for call tracking and sequential buyer routing. It provisions tracking numbers, routes inbound calls to a sequence of buyers based on campaign priorities, and provides tracking, recording, and usage billing for its tenants.
- **Frontend Technology**: Next.js (App Router), React, TailwindCSS, TypeScript.
- **Backend Technology**: NestJS.
- **Database**: PostgreSQL (via Prisma ORM).
- **Authentication**: Supabase Auth (Asymmetric JWT verification).
- **Primary Telephony Provider**: Telnyx (production).
- **Development/Validation Telephony**: Twilio.
- **Billing Provider**: Stripe.

------------------------------------------------------------

## 3. Frontend Technology Stack

Based on `apps/web/package.json`:
- **Next.js**: v16.3.5 (App Router paradigm)
- **React**: v19.2.8
- **TypeScript**: v5.x
- **Supabase SSR**: `@supabase/ssr` v0.12.7 (cookies-based auth)
- **Styling**: Tailwind CSS v4 (`@tailwindcss/postcss`)
- **Testing**: Vitest (`vitest` v4.1.11) with `@testing-library/react`
- **Linting**: ESLint v9 (`eslint-config-next`)

------------------------------------------------------------

## 4. Repository Structure

The current frontend worktree is structured as a monorepo, though frontend work should remain strictly inside `apps/web/`.

- `apps/web/`: The Next.js frontend application.
  - `src/app/`: Next.js App Router defining pages, layouts, and API routes (e.g., `/auth/callback`).
  - `src/components/`: Reusable React UI components (e.g., `sidebar.tsx`, `workspace-selector.tsx`).
  - `src/lib/`: Library code and utilities, most notably `api.ts` for authenticated API fetching.
  - `src/utils/`: Supabase client and server utilities (`supabase/client.ts`, `supabase/server.ts`, `supabase/middleware.ts`).
- `apps/api/`: The NestJS backend application. (Do not modify from frontend-dev).
- `apps/api/prisma/`: The Prisma ORM schema. (Do not modify from frontend-dev).
- `docs/`: Technical documentation and historical stage reports.
- `tests/`: End-to-end and integration tests.

------------------------------------------------------------

## 5. Frontend Route Map

Current implemented routes in `apps/web/src/app/`:

| Route | Purpose | Access | Notes |
|-------|---------|--------|-------|
| `/login` | User authentication entry | Public | Redirects to `/protected` if authenticated. |
| `/signup` | User registration | Public | |
| `/auth/callback` | Supabase Auth callback | Public | Exchanges auth code for session. |
| `/onboarding` | Initial user setup | Protected | For creating the first workspace. |
| `/protected` | Dashboard / Home | Protected | Main layout (`layout.tsx`) includes Sidebar. |
| `/protected/phone-numbers`| Manage tracking numbers | Protected | Fetches `/workspaces/{id}/phone-numbers`. Modal for campaign assignment. |
| `/protected/campaigns` | Manage campaigns | Protected | CRUD for campaigns. |
| `/protected/buyers` | Manage buyers | Protected | CRUD for buyers. |
| `/protected/blocked-callers`| Manage block lists | Protected | Only for OWNER/ADMIN roles. |
| `/protected/calls` | Call history list | Protected | Lists calls for the workspace. |
| `/protected/calls/[callId]`| Call detail view | Protected | Detailed call attempts and recording playback. |
| `/protected/api-keys` | Manage API keys | Protected | Only for OWNER/ADMIN roles. |
| `/protected/billing` | Manage subscriptions | Protected | Only for OWNER/ADMIN roles. |

*Note: Protected workspace pages use the `?workspace={id}` query parameter to maintain the active workspace context. The protected layout/onboarding flow handles users who do not yet have an active workspace.*

------------------------------------------------------------

## 6. Authentication Architecture

The frontend uses Supabase Auth via SSR cookies.
- **Login/Signup**: The frontend uses the current Supabase SSR implementation through `@supabase/ssr` and the project's Supabase client utilities.
- **Middleware**: `apps/web/src/middleware.ts` delegates to `updateSession` in `src/utils/supabase/middleware.ts`. It intercepts requests to `/protected*`. If `user` is null, it redirects to `/login`.
- **JWT Retrieval**: `apiFetch` in `src/lib/api.ts` retrieves the session via `supabase.auth.getSession()` and attaches the `access_token` as a Bearer token.
- **Backend Verification**: The backend validates the asymmetric Supabase JWT using JWKS (JSON Web Key Set). Do NOT describe JWT as HS256.

Authentication is strictly separated from Authorization. Supabase handles identity; the backend database handles workspace roles.

------------------------------------------------------------

## 7. Workspace and Multi-Tenant Architecture

- **Workspace Selection**: Driven by the `?workspace={id}` query parameter in the URL.
- **Workspace Context**: The `Sidebar` and `WorkspaceSelector` components read `useSearchParams().get('workspace')` to maintain context. Navigation links append this parameter.
- **Roles**: OWNER, ADMIN, MEMBER, VIEWER. The frontend may conditionally render UI (e.g., Administration links in `sidebar.tsx` are for OWNER/ADMIN).
- **Strict Isolation**: The frontend must always supply the active workspace ID in API paths (e.g., `/workspaces/${workspaceId}/...`).
- **Never Do**: The frontend must never trust the workspace ID from the UI alone for security. The backend verifies that the authenticated user actually belongs to the requested `workspace_id`.

------------------------------------------------------------

## 8. API Communication Architecture

Located in `apps/web/src/lib/api.ts`, the `apiFetch` helper standardizes backend communication:

- **Base URL**: `process.env.NEXT_PUBLIC_API_URL` (falls back to `http://localhost:3000`).
- **Authentication**: Fetches `session.access_token` from Supabase and attaches it as `Authorization: Bearer <token>`.
- **Content-Type**: Defaults to `application/json`.
- **Error Handling**: Throws an `Error` if `!res.ok`, unpacking the response text.
- **Response Parsing**: Automatically parses JSON, or returns null if the response is empty.

**Example Pattern**:
```typescript
const data = await apiFetch(`/workspaces/${workspaceId}/phone-numbers/search?countryCode=US`);
await apiFetch(`/workspaces/${workspaceId}/phone-numbers`, {
  method: 'POST',
  body: JSON.stringify({ phoneNumber })
});
```

Do NOT invent helper functions or endpoints. Always use `apiFetch` for backend calls.

------------------------------------------------------------

## 9. Backend APIs Used By Frontend

The frontend consumes internal REST APIs hosted by the NestJS backend. These routes follow the `/workspaces/:workspaceId/...` pattern.

- **Workspaces**: `workspaces.controller.ts` (GET `/workspaces`, POST `/workspaces`)
- **Phone Numbers**: `phone-numbers.controller.ts` (GET `/workspaces/:id/phone-numbers`, POST `/workspaces/:id/phone-numbers`, GET search)
- **Campaigns**: `campaigns.controller.ts` (GET `/workspaces/:id/campaigns`, POST `/workspaces/:id/campaigns/:id/phone-numbers` for assignment)
- **Buyers**: `buyers.controller.ts`
- **Blocked Callers**: `blocked-callers.controller.ts`
- **Calls**: `calls.controller.ts` (GET `/workspaces/:id/calls`, GET `/workspaces/:id/calls/:callId`)
- **Recordings**: `recordings.controller.ts` (GET `/workspaces/:id/calls/:callId/recording`)
- **API Keys**: `api-keys.controller.ts`
- **Billing**: `billing.controller.ts`

Only document and consume endpoints verified in the actual backend controllers.

------------------------------------------------------------

## 10. Frontend Pages and Responsibilities

- **`/protected`**: Dashboard overview. Needs to gracefully handle empty states.
- **`/protected/phone-numbers`**: Lists provisioned numbers. Includes a search modal for available Telnyx/US numbers and an assignment modal to map a number to a Campaign. Performs `POST` to provision and assign.
- **`/protected/campaigns`**: Lists campaigns. Manages the priority list of buyers.
- **`/protected/buyers`**: Lists buyers and their destination numbers (E.164).
- **`/protected/calls`**: Call history list with duration, status, and caller info.
- **`/protected/calls/[callId]`**: Detailed call view showing individual attempts to buyers and recording playback.
- **`/protected/blocked-callers`**: Manages the workspace blocklist.
- **`/protected/api-keys`**: Generates and lists API keys (Secret only shown once).
- **`/protected/billing`**: Displays current plan and Stripe integration links.
- **`/login` & `/signup`**: Supabase authentication forms.

------------------------------------------------------------

## 11. Campaign Configuration Model

The routing configuration hierarchy is:
`Workspace` → `PhoneNumber` → `Campaign` → `CampaignBuyer` (Join table) → `Buyer`

- **Assignment**: A `PhoneNumber` can route to exactly one `Campaign`.
- **Buyer Priority**: A `Campaign` can route to multiple `Buyer`s, defined in `CampaignBuyer`. Priority is explicit, numeric, and ordered ascending.
- **Priority Uniqueness**: Priorities must be unique within a campaign (`UNIQUE(campaign_id, priority)` in Prisma).
- **Frontend Responsibility**: The frontend only provides UI to create these mappings via API calls.
- **Backend Engine**: The backend routing engine consumes this configuration to execute sequential routing with fallback.
- **CRITICAL RULE**: The frontend must NOT implement its own call-routing logic. The backend routing engine remains authoritative.

------------------------------------------------------------

## 12. Phone Number UI

The Phone Numbers page (`/protected/phone-numbers`) is responsible for:
- Listing provisioned numbers and their current Campaign assignment.
- Abstracting provider details, though provider name (Telnyx/Twilio) is stored.
- Providing a "Search US Numbers" function that hits the backend search API.
- Providing a "Provision" action to purchase a number.
- Providing an "Assign" modal to map a provisioned number to a Campaign.

*Note: Provider-side number provisioning is distinct from Application-side campaign mapping. A number must be successfully provisioned before it can be assigned.*

------------------------------------------------------------

## 13. Buyer UI

The Buyers page manages the business entities receiving calls.
- Buyers have a name and a `destination_number` (E.164 formatted).
- Buyers are scoped to the `workspace_id`.
- The assignment of a Buyer to a Campaign (with a specific priority) happens on the Campaign management side.

------------------------------------------------------------

## 14. Calls and Recording UI

- **Call List**: Displays inbound calls, final status, duration, and the winning buyer.
- **Call Details**: Shows the breakdown of `CallAttempt`s. It must display the sequential routing attempts (e.g., Buyer A failed, Buyer B answered).
- **Recordings**: Playback is highly sensitive. The UI must fetch secure playback URLs using the authenticated backend session. Private recordings require authenticated, authorized access.

------------------------------------------------------------

## 15. Reusable Components

Located in `apps/web/src/components/`:
- `sidebar.tsx`: The main protected layout navigation. Reads the `?workspace=` query parameter. Dynamically hides Administration links if the user is not OWNER/ADMIN.
- `workspace-selector.tsx`: A dropdown to switch the active workspace. It updates the URL query parameter `?workspace={id}` without breaking the current path.

Do not invent components. Reuse these existing structural components.

------------------------------------------------------------

## 16. UI State and UX Patterns

- **Loading**: Use local state (`isSearching`, `isProvisioning`) to disable buttons and show loading text (e.g., "Provisioning...").
- **Errors**: Display API errors in a red banner (`bg-red-50 text-red-600`) at the top of the content area.
- **Success Feedback**: Display success messages in a green banner (`bg-green-50 text-green-700`).
- **Empty States**: Display clear "No items found" messages instead of empty tables.
- **Workspace Context**: If no workspace is selected, components should render a fallback prompt ("Please select a workspace first").

------------------------------------------------------------

## 17. Styling and Design System

The project uses **Tailwind CSS v4** (`@tailwindcss/postcss`).
- **Approach**: Utility-first CSS directly in React `className` props.
- **Colors**: Standard Tailwind palette. Primary actions use blue (`bg-blue-600`, `hover:bg-blue-700`). Success uses green. Destructive uses red.
- **Tables**: Simple HTML tables with `border-collapse`, `border-b border-gray-200`, and `hover:bg-gray-50`.
- **Forms**: Standard input fields with `border-gray-300`, `focus:ring-blue-500`.

Do not create an unrelated visual system or introduce new CSS frameworks (e.g., Material UI, Chakra). Stick to raw Tailwind.

------------------------------------------------------------

## 18. Frontend Security Rules

- **Never expose secrets**: Do not put Telnyx or Twilio API keys in browser code.
- **Tenant isolation**: Always pass the `workspaceId` to the backend. The backend is the ultimate enforcer of tenant isolation (via `workspace_id` and Supabase JWT).
- **Never bypass Supabase**: Do not store passwords or create parallel authentication flows.
- **Recording access**: Never link directly to an unprotected S3/provider recording URL. Always route through the authenticated backend proxy.
- **API Keys**: When generating API keys, the secret is shown only once. Do not attempt to retrieve it again.

------------------------------------------------------------

## 19. Frontend / Backend Boundary

### Frontend MAY do:
- Presentation, layouts, and routing using Next.js App Router.
- Forms, client-side validation (e.g., E.164 format checks).
- API requests via `apiFetch`.
- Loading, error, and empty-state UI management.
- URL query parameter management (`?workspace=`).

### Frontend MUST NOT do:
- Routing decisions (deciding which buyer to call).
- Billing authorization or payment processing directly without backend tracking.
- Tenant authorization (trusting UI data without backend validation).
- Provider secret handling (No Telnyx API calls from the browser).
- Webhook verification or processing.
- Direct database writes via Prisma (Prisma belongs to the backend).

------------------------------------------------------------

## 20. Telephony Context For Frontend Developers

- **Telnyx**: Primary production provider (Voice API / Call Control).
- **Twilio**: Development/validation provider.
- **Not TeXML**: The platform uses Call Control APIs, not TwiML/TeXML bins.
- **Provider Abstraction**: The backend abstracts provider differences. The frontend should NEVER directly control provider credentials or provider-specific APIs.
- **Current Status**: Real Telnyx E2E has verified provisioning, call control, and recording. Real campaign-routing E2E has not yet been verified.

------------------------------------------------------------

## 21. Current Frontend Status

| Feature | Status | Notes |
|---------|--------|-------|
| Authentication | Implemented | Supabase SSR cookies |
| Onboarding | Implemented | `/onboarding` route exists |
| Workspace Selection| Implemented | `?workspace=` query param |
| Phone Numbers | Implemented | Listing, search, provisioning, and campaign assignment |
| Campaigns | Implemented | Campaign management and buyer-priority configuration |
| Buyers | Implemented | Route exists |
| Blocked Callers | Implemented | Route exists |
| Calls | Implemented | Route exists |
| Recordings | Implemented | Accessed via Call detail page |
| API Keys | Implemented | Route exists |
| Billing | Implemented | Route exists |

------------------------------------------------------------

## 22. Known Limitations

- Routing concurrency/data-collision E2E limitation exists in the backend.
- Real campaign-routing E2E has not yet been verified.
- The frontend relies on the backend to enforce `workspace_id` security; UI glitches causing cross-workspace requests will be rejected with API errors.

------------------------------------------------------------

## 23. Out-of-Scope Features

Do NOT build or attempt to support:
- Dynamic Number Insertion (DNI)
- Website visitor tracking
- Google Ads attribution
- Facebook attribution
- GCLID
- FBCLID
- IVR
- DTMF
- Geographic routing
- Business-hours routing
- Round robin routing
- Skill routing
- Call Flow Builder
- Real-time bidding
- Ping/Post
- Lead marketplace
- White-labeling
- Fraud detection
- Dispute management
- AI voice agents
- Transcription unless separately authorized
- SIP softphone
- Chat/SMS
- CRM
- Email marketing
- Marketing automation
- Buyer employee routing
- Any other feature explicitly excluded by MVP1_BUILD_SPEC_v5.md

------------------------------------------------------------

## 24. Frontend Development Rules

For any AI coding agent modifying `apps/web/`:
1. Inspect the existing implementation in `apps/web/src/` first.
2. Reuse existing components (`sidebar.tsx`, `workspace-selector.tsx`).
3. Reuse `apiFetch` in `src/lib/api.ts`.
4. Do not invent APIs; check backend controllers first.
5. Do not modify backend/Prisma files without authorization.
6. Preserve workspace isolation (`?workspace=`).
7. Preserve Supabase authentication behavior.
8. Keep changes scoped strictly to the requested task.
9. Avoid unnecessary dependencies in `package.json`.
10. Run typecheck and lint before considering a task done.
11. Inspect `git diff` before asking for review.
12. Do not commit unless instructed.

------------------------------------------------------------

## 25. Git / Worktree Rules

- **Current frontend worktree**: `C:\Users\prate\OneDrive\Desktop\callflow-frontend`
- **Current branch**: `frontend-dev`
- **Main repository**: `C:\Users\prate\OneDrive\Desktop\call-tracking-software`
- **Main branch**: `main`

Frontend development happens exclusively in `frontend-dev`.
Do not checkout `main` from the frontend worktree. Do not modify another worktree. Do not force push. Do not commit or push unless explicitly authorized.

------------------------------------------------------------

## 26. How A New Frontend Agent Should Start

MANDATORY procedure for new AI agents:
1. Check `git status`.
2. Check current branch.
3. Read `FRONTEND_AGENT_CONTEXT.md`.
4. Read `MVP1_BUILD_SPEC_v5.md` when task scope requires it.
5. Inspect relevant source files in `apps/web/`.
6. Inspect relevant backend contracts in `apps/api/src/`.
7. Explain proposed changes to the user.
8. Implement only authorized changes.
9. Verify changes locally.
10. Report files changed and stop for review.

------------------------------------------------------------

## 27. Current Known Documentation Conflicts

- `docs/13-archive/` contains historical reports, POCs, and old ADRs that do not reflect the current Supabase/Telnyx Call Control architecture. Do not treat archived documents as authoritative.
- Some archived architecture docs mention HS256 JWTs. The actual source code uses Supabase Asymmetric JWTs (`@supabase/ssr`). The source code (`apps/web/src/utils/supabase`) is authoritative.

------------------------------------------------------------

## 28. Frontend Agent Quick Reference

- **Project**: CallFlow
- **Frontend**: Next.js 16 / React 19 / TypeScript / Tailwind v4
- **Frontend Path**: `apps/web`
- **Frontend Worktree**: `C:\Users\prate\OneDrive\Desktop\callflow-frontend`
- **Frontend Branch**: `frontend-dev`
- **Main Repo**: `main`
- **Auth**: Supabase SSR (Cookies)
- **Backend**: NestJS
- **Database**: PostgreSQL / Prisma
- **Production Telephony**: Telnyx Voice API / Call Control
- **Development Telephony**: Twilio
- **Master Specification**: `MVP1_BUILD_SPEC_v5.md`
- **Project Context**: `CALLFLOW_PROJECT_CONTEXT.md`
- **Frontend Context**: `FRONTEND_AGENT_CONTEXT.md`
