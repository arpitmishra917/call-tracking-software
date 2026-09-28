# CallFlow UI V2 --- Master UI/UX Development Plan

**Product:** CallFlow\
**Document:** UI V2 Master Plan\
**Status:** Planning / Design Specification\
**Objective:** Transform the current functional MVP dashboard into a
polished, professional B2B SaaS call-routing platform UI without
changing product behavior or backend contracts.

------------------------------------------------------------------------

## 1. Purpose

This document is the master plan for the CallFlow UI V2 redesign.

The current application is functionally mature for the MVP, including
authentication, workspaces, RBAC, phone numbers, campaigns, buyers,
sequential routing, calls, recordings, reporting, usage, billing, API
keys, customer webhooks, blocked callers, members, and settings.

The current UI is functional but visually closer to an internal/admin
dashboard than a polished SaaS product.

UI V2 will improve:

-   visual quality
-   information hierarchy
-   navigation
-   usability
-   consistency
-   responsive behavior
-   call-centric visualization
-   analytics presentation
-   empty states
-   tables and cards
-   forms and actions
-   status presentation
-   overall SaaS product feel

This is a **frontend presentation and UX project**, not a backend
rewrite.

------------------------------------------------------------------------

# 2. Core Product UX Principle

CallFlow's central workflow is:

``` text
Incoming Caller
      ↓
Tracking Number
      ↓
Campaign
      ↓
Buyer Priority
      ↓
Buyer Attempt
      ↓
Fallback Buyer
      ↓
Connected / Failed / No Answer
      ↓
Call Recording
      ↓
Call History
      ↓
Reporting / Usage
```

The UI should make this workflow understandable.

The product should feel like a **call-routing and call-operations
platform**, not a generic CRUD dashboard.

------------------------------------------------------------------------

# 3. UI V2 Design Goals

## Professional

The product should look appropriate for a paid B2B SaaS platform.

## Clean

Use whitespace intentionally and avoid unnecessary decoration.

## Information-dense but readable

Users should be able to scan calls, statuses, durations, buyers,
campaigns, and outcomes quickly.

## Consistent

Buttons, cards, forms, tables, badges, headings, spacing, and empty
states should use one visual system.

## Call-centric

Calls, routing attempts, buyer outcomes, and campaign performance
receive stronger visual treatment than secondary administration
settings.

## Honest

Only expose functionality supported by the backend. Never create fake
buttons, fake metrics, fake integrations, or placeholder functionality
that appears operational.

------------------------------------------------------------------------

# 4. Scope Boundaries

UI V2 must **not** introduce or imply unsupported MVP capabilities,
including:

-   DNI
-   website visitor tracking
-   Google Ads attribution
-   Meta attribution
-   GCLID/FBCLID
-   IVR/DTMF flows
-   geographic routing
-   business-hours routing
-   round-robin routing
-   skill routing
-   call-flow builder
-   real-time bidding
-   ping/post lead marketplace
-   white-label functionality
-   fraud detection
-   dispute management
-   AI voice agents
-   transcription unless separately authorized
-   sentiment analysis
-   deepfake detection
-   SIP softphone
-   SMS/chat
-   CRM
-   email marketing
-   marketing automation
-   unsupported billing features
-   unsupported member invitation/role editing
-   unsupported webhook editing or delivery-history features

UI changes must not become accidental product-scope expansion.

------------------------------------------------------------------------

# 5. Design Language

The visual language should be:

-   modern
-   professional
-   minimal
-   neutral
-   operational
-   SaaS-oriented
-   responsive
-   accessible
-   visually structured

Avoid:

-   excessive gradients
-   glassmorphism
-   flashy animations
-   oversized decorative illustrations
-   unnecessary 3D elements
-   excessive rounded cards
-   generic Bootstrap-admin appearance
-   excessive shadows
-   visually noisy dashboards

------------------------------------------------------------------------

# 6. Global Application Shell

The application should use a stable SaaS shell:

``` text
┌──────────────────────────────────────────────────────────────┐
│ CallFlow                 Workspace ▾             User ▾       │
├───────────────┬──────────────────────────────────────────────┤
│ Navigation    │              Main Content                    │
│               │                                              │
│ Overview      │                                              │
│ Routing       │                                              │
│ Developer     │                                              │
│ Billing       │                                              │
│ Workspace     │                                              │
└───────────────┴──────────────────────────────────────────────┘
```

The shell must remain consistent across all protected pages.

------------------------------------------------------------------------

# 7. Navigation Information Architecture

## OVERVIEW

-   Dashboard
-   Calls
-   Reporting

## ROUTING

-   Campaigns
-   Buyers
-   Phone Numbers
-   Blocked Callers

## DEVELOPER

-   API Keys
-   Webhooks

## BILLING

-   Usage
-   Billing

## WORKSPACE

-   Members
-   Settings

### Sidebar requirements

-   CallFlow branding
-   clear active route
-   grouped navigation
-   consistent icons
-   hover states
-   accessible focus states
-   responsive mobile drawer
-   no route removal
-   no fake routes

------------------------------------------------------------------------

# 8. Header

Preserve:

-   workspace selector
-   authenticated user information
-   sign-out action

The workspace selector should be visually prominent because CallFlow is
multi-tenant.

The redesign must not change authentication behavior.

------------------------------------------------------------------------

# 9. Design System

## Colors

Define semantic tokens for:

-   page background
-   card background
-   primary text
-   secondary text
-   muted text
-   border
-   primary action
-   primary action hover
-   success
-   warning
-   error
-   informational state

## Typography

Recommended hierarchy:

-   Page title: approximately 28--32px, semibold
-   Section title: approximately 18--22px, semibold
-   Card title: approximately 15--17px, semibold
-   Primary metric: approximately 28--36px, bold
-   Supporting text: approximately 13--14px

Avoid unnecessary all-caps text.

## Spacing

Use a consistent spacing scale.

## Radius

Use one consistent family of border-radius values.

## Shadows

Use subtle shadows only where they improve hierarchy.

------------------------------------------------------------------------

# 10. Shared Components

Create or improve shared components where useful:

-   PageHeader
-   SectionHeader
-   Card
-   Button
-   ButtonGroup
-   Input
-   Select
-   FormField
-   StatusBadge
-   EmptyState
-   DataTable
-   MetricCard
-   ConfirmDialog
-   Toast/feedback
-   LoadingState
-   ErrorState
-   DateRangeFilter where shared

Do not over-engineer components. Share components when they provide
genuine consistency.

------------------------------------------------------------------------

# 11. Buttons and Forms

Establish clear primary, secondary, and destructive button hierarchy.

Forms should have:

-   clear labels
-   consistent input height
-   helpful placeholders
-   validation/error states
-   disabled/loading state
-   accessible focus state
-   clear success feedback

Do not change backend validation requirements.

------------------------------------------------------------------------

# 12. Status System

Use consistent semantic badges such as:

``` text
● ACTIVE
● ANSWERED
● ROUTING
● RINGING
● COMPLETED
● FAILED
● NO ANSWER
● BLOCKED
```

Use text plus visual treatment. Never rely on color alone.

------------------------------------------------------------------------

# 13. Tables

Tables should support operational scanning:

-   strong column headers
-   appropriate row height
-   subtle row separators
-   hover state
-   consistent alignment
-   status badges
-   clickable rows where appropriate
-   responsive treatment

Avoid prominently displaying raw UUIDs or internal IDs. Use shortened
display formatting where appropriate while preserving actual values
behind the UI.

------------------------------------------------------------------------

# 14. Empty, Loading, and Error States

Replace plain messages such as:

> No webhooks configured.

with intentional empty states:

``` text
No webhooks yet

Connect CallFlow to your application by creating
your first webhook endpoint.

[Create Webhook]
```

Only show a CTA when the backend supports the action.

Loading states should avoid unnecessary layout shifts.

Errors should be understandable and must not expose secrets, stack
traces, or internal implementation details.

------------------------------------------------------------------------

# 15. Page-by-Page V2 Direction

## Dashboard

The Dashboard should become the strongest page.

Concept:

``` text
Dashboard

Good morning, ABC Company
Here's what's happening with your calls.

[ Date / Period ]

Total Calls | Answered | Missed | Answer Rate

Call Activity
[ supported visualization ]

Campaign Performance | Buyer Performance

Recent Calls
```

Only backend-supported metrics may be displayed. Do not invent revenue,
ROI, lead quality, attribution, or unsupported billing metrics.

## Calls

Use a professional operational table:

``` text
Caller | Campaign | Buyer | Status | Duration | Time
```

Preserve supported filters such as date, caller, and status.

## Call Details

Make the routing sequence visually understandable:

``` text
Caller
  ↓
Campaign
  ↓
Buyer A — FAILED
  ↓
Buyer B — ANSWERED
  ↓
Connected
```

Also present:

-   caller
-   tracking number
-   campaign
-   buyer
-   duration
-   date/time
-   recording
-   buyer attempts

Only show actual recorded attempts/events.

## Campaigns

Show:

-   campaign name
-   status
-   tracking numbers
-   buyers
-   buyer priority
-   timeout where supported
-   management actions

Make priority order visually obvious.

## Buyers

Show:

-   buyer name
-   destination number
-   status
-   timeout
-   existing associations where supported
-   available management actions

## Phone Numbers

Show:

-   number
-   campaign assignment
-   status
-   provider where supported
-   management action

Provisioning should have a clear primary action.

## Reporting

Make it feel like analytics:

``` text
Reporting

[ Date range ]

Total Calls | Answered | Missed | Blocked/Failed | Avg Answered Duration

Call Volume
[ supported visualization ]

Campaign Performance
Buyer Performance
```

Do not add unsupported cost or attribution metrics.

## Blocked Callers

Use a clear blocking workflow:

``` text
Blocked Callers

Block a Caller
Phone Number
Reason
[Block Caller]

Blocked Numbers
Caller | Reason | Date | Action
```

Expose removal/unblock only if the backend supports it.

## API Keys

Show:

-   key name
-   shortened key prefix
-   status
-   created date
-   last used
-   revoke action

Secrets must only be shown at creation time if supported by current
behavior.

## Webhooks

Show:

-   endpoint URL
-   active status where supported
-   creation date
-   supported events where available
-   secret handling
-   delete action

Do not present unsupported edit, toggle, or delivery-history controls.

## Usage

Clearly distinguish:

-   call minutes
-   phone numbers
-   recording storage

Show billing-period information when available.

## Billing

Clearly distinguish:

-   subscription state
-   current usage
-   available billing actions
-   empty subscription state

Do not show unsupported actions.

## Members

Show:

-   identity
-   role
-   join date
-   supported actions

Remain honest about backend limitations around invitations and role
editing.

## Settings

Separate editable workspace name from read-only metadata:

-   workspace ID
-   slug
-   status
-   creation date

------------------------------------------------------------------------

# 16. Responsive Design

Support:

-   desktop
-   laptop
-   tablet
-   mobile

On mobile:

-   sidebar becomes a drawer
-   tables become horizontally scrollable or stacked cards where
    appropriate
-   forms fit narrow screens
-   cards do not create horizontal overflow

------------------------------------------------------------------------

# 17. Accessibility

Implement:

-   keyboard navigation
-   visible focus states
-   semantic buttons
-   accessible labels
-   sufficient contrast
-   status information not dependent solely on color
-   sensible heading hierarchy
-   accessible dialogs
-   accessible form errors

------------------------------------------------------------------------

# 18. Animation

Use subtle transitions only:

-   hover
-   sidebar/drawer
-   loading
-   small state changes

Avoid excessive motion or decorative animation.

------------------------------------------------------------------------

# 19. Technical Constraints

Preserve the existing frontend architecture unless there is a strong
reason not to.

Prefer existing:

-   Next.js architecture
-   React components
-   CSS/styling system
-   dependencies
-   API helpers
-   authentication
-   workspace context

Do not introduce a large UI framework solely for visual redesign.

------------------------------------------------------------------------

# 20. Functional Preservation

UI V2 must preserve:

-   Supabase Auth
-   workspace onboarding
-   workspace switching
-   RBAC
-   tenant isolation
-   phone provisioning
-   phone assignment
-   campaigns
-   buyer priority
-   sequential fallback
-   blocked callers
-   call logs
-   call details
-   recording access
-   usage
-   billing
-   API keys
-   customer webhooks
-   members
-   settings

No visual change may alter business rules.

------------------------------------------------------------------------

# 21. Backend Contract Rule

Before adding any UI action or data field, verify that:

-   endpoint exists
-   response field exists
-   action exists
-   authorization exists

If unsupported:

-   do not fake it
-   omit the action or clearly communicate the limitation

Never invent API endpoints or backend fields.

------------------------------------------------------------------------

# 22. Security Rules

Never expose:

-   API key secrets after allowed one-time display
-   webhook secrets after allowed one-time display
-   provider credentials
-   database credentials
-   Supabase service-role credentials
-   internal auth tokens

Do not expose sensitive information through errors or debug UI.

------------------------------------------------------------------------

# 23. Performance Rules

Avoid:

-   unnecessary dependencies
-   excessive re-renders
-   duplicate API requests
-   duplicate fetching
-   huge client bundles
-   heavy chart libraries when lighter existing options suffice

------------------------------------------------------------------------

# 24. Phase-Based Implementation Plan

## PHASE UI-1 --- Design System + Application Shell

Scope:

-   typography
-   colors/tokens
-   spacing
-   cards
-   buttons
-   inputs
-   badges
-   empty states
-   tables
-   sidebar
-   header
-   workspace selector
-   responsive shell

No page-specific redesign yet.

Validation:

-   typecheck
-   lint
-   tests
-   production build
-   browser inspection

Commit:

``` text
feat: establish CallFlow UI v2 design system
```

------------------------------------------------------------------------

## PHASE UI-2 --- Dashboard + Calls + Call Details

Redesign:

-   Dashboard
-   Calls
-   Call Details

Focus:

-   call activity
-   KPI cards
-   operational tables
-   routing timeline
-   buyer attempts
-   recording

Commit:

``` text
feat: redesign call operations experience
```

------------------------------------------------------------------------

## PHASE UI-3 --- Campaigns + Buyers + Phone Numbers

Redesign:

-   Campaigns
-   Buyers
-   Phone Numbers

Focus:

-   buyer priority
-   fallback sequence
-   tracking number assignment
-   statuses
-   operational scanning

Commit:

``` text
feat: redesign routing management UI
```

------------------------------------------------------------------------

## PHASE UI-4 --- Reporting

Redesign:

-   Reporting
-   analytics hierarchy
-   date controls
-   KPI cards
-   supported call-volume visualization
-   campaign performance
-   buyer performance

Commit:

``` text
feat: redesign reporting experience
```

------------------------------------------------------------------------

## PHASE UI-5 --- Developer Tools + Blocked Callers

Redesign:

-   API Keys
-   Webhooks
-   Blocked Callers

Focus:

-   developer clarity
-   secret safety
-   endpoint readability
-   caller management
-   empty states

Commit:

``` text
feat: redesign developer and caller controls
```

------------------------------------------------------------------------

## PHASE UI-6 --- Workspace + Billing

Redesign:

-   Members
-   Settings
-   Usage
-   Billing

Focus:

-   workspace administration
-   subscription state
-   usage presentation
-   role visibility

Commit:

``` text
feat: redesign workspace and billing UI
```

------------------------------------------------------------------------

## PHASE UI-7 --- Responsive + Accessibility + Final Polish

Final pass across all pages:

-   desktop
-   tablet
-   mobile
-   keyboard navigation
-   focus states
-   responsive tables
-   empty states
-   loading states
-   error states
-   spacing
-   typography
-   button consistency
-   status badges
-   visual hierarchy
-   overflow issues

Commit:

``` text
feat: finalize CallFlow UI v2 polish
```

------------------------------------------------------------------------

# 25. Validation Strategy

Every phase must pass:

## Static

-   TypeScript typecheck
-   ESLint
-   existing frontend tests
-   production build

## Browser

Check relevant routes manually:

-   data loads
-   buttons work
-   forms work
-   navigation works
-   workspace switching works
-   authentication remains functional
-   no significant console errors
-   responsive behavior
-   visual consistency

## Git

Before every commit:

``` bash
git status
git diff
```

Only intended files may be changed.

------------------------------------------------------------------------

# 26. Agent Safety Rules

The coding agent must:

1.  Read the current frontend structure before editing.
2.  Inspect existing shared components.
3.  Reuse existing API helpers.
4.  Reuse existing authentication.
5.  Reuse workspace context.
6.  Never invent APIs.
7.  Never invent backend fields.
8.  Never change backend code during frontend-only phases.
9.  Never modify Prisma.
10. Never change routing/business logic.
11. Never remove working features.
12. Never silently change validation.
13. Never expose secrets.
14. Never commit environment files.
15. Run validation after each phase.
16. Stop if a real backend limitation blocks the intended UI.
17. Report unsupported functionality honestly.

------------------------------------------------------------------------

# 27. Visual Quality Checklist

## Layout

-   [ ] Consistent page widths
-   [ ] Consistent spacing
-   [ ] Consistent card treatment
-   [ ] Consistent section spacing

## Typography

-   [ ] Page titles consistent
-   [ ] Section titles consistent
-   [ ] Body text consistent
-   [ ] Metrics visually strong
-   [ ] No unnecessary uppercase

## Components

-   [ ] Buttons consistent
-   [ ] Inputs consistent
-   [ ] Status badges consistent
-   [ ] Tables consistent
-   [ ] Empty states consistent
-   [ ] Loading states consistent

## Navigation

-   [ ] Sidebar grouping logical
-   [ ] Active state obvious
-   [ ] Workspace selector clear
-   [ ] Mobile navigation usable

## Calls

-   [ ] Call status obvious
-   [ ] Routing sequence understandable
-   [ ] Buyer attempts readable
-   [ ] Recording easy to find
-   [ ] Call metadata easy to scan

## Routing

-   [ ] Campaigns clear
-   [ ] Buyer priority obvious
-   [ ] Tracking numbers clear
-   [ ] Fallback concept understandable

## Analytics

-   [ ] Dashboard readable
-   [ ] Reporting readable
-   [ ] Metrics not fabricated
-   [ ] Date controls consistent

## Administration

-   [ ] Members readable
-   [ ] Settings clear
-   [ ] Usage understandable
-   [ ] Billing state understandable

## Developer tools

-   [ ] API keys secure
-   [ ] Webhooks readable
-   [ ] Secrets protected

## Responsive

-   [ ] Desktop
-   [ ] Tablet
-   [ ] Mobile
-   [ ] No horizontal overflow
-   [ ] Tables usable

## Accessibility

-   [ ] Keyboard navigation
-   [ ] Focus states
-   [ ] Semantic controls
-   [ ] Contrast
-   [ ] Status not color-only

------------------------------------------------------------------------

# 28. Definition of Done

CallFlow UI V2 is complete when:

1.  All existing product routes use the unified V2 design language.
2.  The application shell is consistent.
3.  Navigation is logically grouped.
4.  Dashboard communicates call activity clearly.
5.  Calls are easy to scan.
6.  Call Details clearly communicates routing attempts.
7.  Campaign priority is visually obvious.
8.  Buyers are easy to manage.
9.  Phone numbers are easy to understand.
10. Reporting feels like analytics.
11. Developer tools feel professional.
12. Billing and usage feel intentional.
13. Workspace administration is consistent.
14. Empty/loading/error states are polished.
15. Mobile/tablet layouts work.
16. Accessibility basics are implemented.
17. No unsupported backend functionality is presented.
18. Existing functionality remains intact.
19. Typecheck passes.
20. Lint passes.
21. Tests pass.
22. Production build passes.
23. Each phase has a focused Git commit.
24. No secrets are committed.
25. No backend business logic is changed as part of UI V2.

------------------------------------------------------------------------

# 29. Final Product Vision

The final CallFlow UI should communicate the product immediately:

``` text
CALLFLOW

A professional call-routing platform where I can:

1. Get a tracking number
2. Create a campaign
3. Add buyers
4. Set buyer priority
5. Route incoming calls
6. See exactly what happened
7. Listen to recordings
8. Understand performance
9. Manage usage and billing
10. Connect my own systems through API/Webhooks
```

The visual experience should make these capabilities feel like one
coherent product rather than a collection of separate admin pages.

------------------------------------------------------------------------

# 30. Implementation Principle

Do not redesign everything at once.

The workflow is:

``` text
PLAN
  ↓
DESIGN SYSTEM
  ↓
APPLICATION SHELL
  ↓
DASHBOARD / CALLS
  ↓
ROUTING PAGES
  ↓
REPORTING
  ↓
DEVELOPER TOOLS
  ↓
WORKSPACE / BILLING
  ↓
RESPONSIVE + ACCESSIBILITY
  ↓
FINAL QA
```

Each phase must be independently validated and committed.

**This document is the master planning reference for the CallFlow UI V2
effort.**
