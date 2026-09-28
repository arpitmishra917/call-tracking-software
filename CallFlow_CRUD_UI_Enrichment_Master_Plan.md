# CallFlow — CRUD & UI Enrichment Master Implementation Plan

## 1. Objective

This document is the implementation blueprint for the next major CallFlow development phase.

The current CallFlow MVP already has a functional foundation covering authentication, multi-tenancy, RBAC, campaigns, buyers, sequential routing, phone numbers, calls, recordings, usage, billing, reporting, members, settings, customer webhooks, and the public API.

The objective is to make the application feel like a complete, mature B2B SaaS product by adding missing CRUD/lifecycle capabilities and enriching the UI wherever the product model supports it.

**Core principle:**

> Configuration resources should have complete lifecycle management. Historical, operational, financial, and derived records should remain immutable unless there is a strong documented reason otherwise.

This plan is based on the completed CRUD audit and the current CallFlow architecture.

---

# 2. Scope Rules

## 2.1 Explicitly Deferred

The following are NOT part of this implementation program:

- Public API enhancement
- Customer Webhook enhancement
- DNI
- Website visitor tracking
- Google Ads attribution
- Facebook attribution
- GCLID / FBCLID attribution
- IVR
- DTMF
- Geographic routing
- Business-hours routing
- Round robin routing
- Skill routing
- Call Flow Builder
- Real-time bidding
- Ping/Post lead marketplace
- Lead marketplace
- White-label
- Fraud detection
- Dispute management
- AI voice agents
- Transcription unless separately authorized
- Sentiment analysis
- Deepfake detection
- SIP softphone
- SMS/chat
- CRM
- Email marketing
- Marketing automation
- Unapproved integrations

Do not introduce these features indirectly while implementing CRUD.

---

# 3. CRUD Philosophy

Not every database entity should receive traditional CRUD.

## 3.1 Mutable Configuration Resources

Generally eligible for lifecycle management:

- Campaigns
- Buyers
- Campaign-to-Buyer routing configuration
- Phone Numbers
- Members
- Workspace configuration

## 3.2 Lifecycle-Based Resources

Prefer state transitions over destructive deletion:

- Campaigns
- Buyers
- Workspaces

Potential conceptual states:

- Active
- Paused
- Inactive
- Archived
- Suspended

Use existing schema/domain states where possible. Do not add states blindly.

## 3.3 Immutable Operational Data

Remain read-only:

- Calls
- Call Attempts
- Recordings
- Usage records
- Billing history
- Derived reporting data

---

# 4. Target Resource Matrix

| Resource | Create | Read | Update | Delete | Lifecycle | Target |
|---|---:|---:|---:|---:|---:|---|
| Workspace | Yes | Yes | Yes | No | Suspend/Archive | Lifecycle |
| Members | Invite | Yes | Role | Remove | Invitation lifecycle | CRUD |
| Phone Numbers | Yes | Yes | Yes | Release | Provider lifecycle | CRUD |
| Campaigns | Yes | Yes | Yes | No | Pause/Archive | Lifecycle |
| Buyers | Yes | Yes | Yes | No | Deactivate/Archive | Lifecycle |
| Campaign ↔ Buyer | Yes | Yes | Yes | Detach | Routing lifecycle | CRUD |
| Blocked Callers | Yes | Yes | Optional | Unblock | Simple | Already mature |
| Calls | No | Yes | No | No | Immutable | Read-only |
| Call Attempts | No | Yes | No | No | Immutable | Read-only |
| Recordings | Provider | Yes | No | No | Provider-managed | Read-only |
| Usage | System | Yes | No | No | Immutable | Read-only |
| Billing | Provider/System | Yes | Provider actions | No | Subscription lifecycle | Read-only + billing actions |
| API Keys | Existing | Existing | Existing | Existing | Deferred | Out of scope |
| Webhooks | Existing | Existing | Existing | Existing | Deferred | Out of scope |

---

# 5. Implementation Sequence

1. CRUD-1 — Phone Number UI Parity
2. CRUD-2 — Buyer Lifecycle
3. CRUD-3 — Campaign Lifecycle
4. CRUD-4 — Campaign ↔ Buyer Routing Management
5. CRUD-5 — Members & Roles
6. CRUD-6 — Workspace Lifecycle
7. CRUD-7 — Blocked Caller Optional Enrichment
8. CRUD-8 — UI Enrichment
9. CRUD-9 — Search / Filter / Sort / Pagination
10. CRUD-10 — Detail Views
11. CRUD-11 — Destructive Action UX
12. CRUD-12 — Backend Security & Data Integrity Hardening
13. CRUD-13 — Routing Regression Protection
14. CRUD-14 — Full E2E Verification
15. CRUD-15 — Final UI/UX Polish

Each phase has a hard stop. Do not silently continue into the next phase.

---

# CRUD-1 — Phone Number UI Parity

## Objective

Expose backend phone-number capabilities that already exist while first verifying the actual provider lifecycle.

The backend already supports Create, Read, Update, and Delete/Release while the frontend lacks Edit and Release.

## Mandatory Pre-Implementation Verification

Before changing UI, inspect:

- `PUT /workspaces/:workspaceId/phone-numbers/:id`
- `DELETE /workspaces/:workspaceId/phone-numbers/:id`

Determine exactly what DELETE does.

Verify whether it:

1. Releases the number from Telnyx/Twilio and then updates/deletes the DB record, or
2. Only changes/deletes the local DB record.

Do not expose a production Release action until this is understood.

## Frontend Target

Phone Number list should support:

- View
- Edit name
- Release

Example:

```text
Phone Number
Provider
Status
Campaign
Actions
```

Actions:

```text
View
Edit
Release
```

## Release Safety

Before release:

- verify workspace ownership
- verify RBAC
- check campaign association
- check provider relationship
- show destructive confirmation
- show number being released
- show potential campaign impact
- prevent accidental double-submit

## Tests

Backend:

- update success
- update unauthorized
- tenant isolation
- release success
- provider failure
- invalid number ownership
- campaign association protection

Frontend:

- Edit modal
- Release confirmation
- Loading state
- Error state
- Success feedback
- Responsive behavior

## Hard Stop

After CRUD-1:

- run backend validation
- run frontend validation
- run relevant E2E
- verify no routing regression
- verify no billing regression
- verify no unrelated files changed

STOP.

---

# CRUD-2 — Buyer Lifecycle

## Objective

Transform Buyers from Create/Read-only resources into properly managed configuration resources.

Missing:

- Edit
- Deactivate
- Archive

## Backend

Add update capability using the existing Buyer domain.

Only expose fields that already belong to the Buyer model or are explicitly required by the product specification.

Do not invent unnecessary fields.

## Lifecycle

Prefer non-destructive state management:

```text
ACTIVE
INACTIVE
ARCHIVED
```

Only introduce these states if compatible with the current schema. If a status field already exists, extend/use it instead of creating a duplicate lifecycle system.

## Routing Rule

Only active buyers may receive new calls.

Inactive/archived buyers:

- must not be selected for new routing
- must remain visible in historical records
- must remain associated with historical calls when required

## Frontend

Buyer table:

```text
Buyer
Phone
Status
Campaigns
Actions
```

Actions:

```text
View
Edit
Activate
Deactivate
Archive
```

Only show actions valid for the current state.

## Tests

- edit buyer
- deactivate buyer
- activate buyer
- archive buyer
- routing skips inactive buyer
- tenant isolation
- RBAC
- historical call integrity
- invalid state transition
- concurrent routing safety

## Hard Stop

Run complete backend/frontend validation and routing regression tests.

STOP.

---

# CRUD-3 — Campaign Lifecycle

## Objective

Give Campaigns proper lifecycle management.

Current system supports Create/Read but lacks full lifecycle management.

## Backend

Add appropriate:

- Update
- Pause
- Activate
- Archive

Do not introduce a hard-delete model for campaigns with historical calls.

## Lifecycle

Potential conceptual states:

```text
DRAFT
ACTIVE
PAUSED
ARCHIVED
```

Only implement states actually supported by the existing architecture.

## Routing Rules

Paused/archived/inactive campaigns must not accept new inbound routing.

Historical calls remain available.

## Campaign Editing

Support legitimate existing configuration fields such as:

- name
- description/configuration fields already in the domain
- status

Do not create arbitrary settings.

## Campaign Associations

Management should eventually include:

- assigned phone number
- assigned buyers
- buyer priority

## Frontend

Campaign page should expose:

```text
Edit
Pause
Activate
Archive
```

Show existing supported data such as status, tracking number, buyer count, and routing configuration.

## Tests

- update campaign
- pause
- activate
- archive
- routing ignores inactive campaign
- tenant isolation
- RBAC
- historical calls remain
- reporting remains intact

## Hard Stop

Run regression suite.

STOP.

---

# CRUD-4 — Campaign ↔ Buyer Routing Management

## Objective

Make sequential buyer routing fully manageable from the UI without compromising routing concurrency.

This is a core CallFlow feature.

## Required Operations

### Add Buyer

Continue using existing assignment behavior.

### Remove Buyer

Add an operation conceptually equivalent to:

```text
DELETE /campaigns/:campaignId/buyers/:buyerId
```

Requirements:

- campaign tenant check
- buyer tenant check
- assignment existence check
- RBAC
- safe handling around active calls

### Reorder Buyers

Prefer a single transactional operation:

```text
PUT /campaigns/:campaignId/buyers/reorder
```

Conceptual payload:

```json
{
  "buyerIds": [
    "buyer-a",
    "buyer-c",
    "buyer-b"
  ]
}
```

The backend derives priorities from array order.

## Unique Constraint Safety

Existing priority uniqueness means naïve sequential updates can create temporary collisions.

Example:

```text
A = 1
B = 2

A → 2
B → 1
```

This can violate:

```text
UNIQUE(campaign_id, priority)
```

The reorder operation must therefore be transactional and designed to avoid intermediate collisions.

## Routing Concurrency

Do not weaken existing routing protections.

Do not:

- make state decisions from unlocked stale rows
- put external provider calls inside DB locks
- change existing call state-machine behavior
- modify provider dialing semantics

## Frontend

Campaign detail should contain:

```text
ROUTING

1  Buyer A   Active
2  Buyer B   Active
3  Buyer C   Active

[+ Add Buyer]
```

Support:

- drag/reorder
- remove
- activate/deactivate where applicable
- save routing order

## Mid-Call Safety

Changing routing configuration must affect future routing decisions without corrupting active calls.

Existing in-progress call attempts must remain valid.

## Tests

Mandatory:

- add buyer
- remove buyer
- reorder 2 buyers
- reorder 3+ buyers
- no duplicate priorities
- invalid buyer
- cross-tenant buyer
- unauthorized user
- concurrent reorder
- concurrent routing
- inactive buyer skipped
- historical calls preserved

## Hard Stop

Run concurrency tests and full routing regression.

STOP.

---

# CRUD-5 — Members & Roles

## Objective

Complete workspace member management.

Current system supports listing/removal but lacks invitation and role-update functionality.

## Backend

### Invitation

Conceptual:

```text
POST /workspaces/:workspaceId/invitations
```

Requirements:

- email
- role
- expiration
- invitation token
- duplicate invitation handling
- existing member handling
- acceptance flow
- tenant isolation
- RBAC

Do not build a new email-delivery provider without first documenting the requirement.

### Role Update

Conceptual:

```text
PUT /workspaces/:workspaceId/members/:userId
```

Requirements:

- valid role
- workspace ownership
- authorization
- prevent privilege escalation
- prevent invalid last-owner states

## Authorization

Verify the actual current RBAC before implementation.

The audit indicates:

- OWNER/ADMIN for invitations
- OWNER for role changes

Do not blindly assume these if the existing policy differs.

## Frontend

Members page:

```text
[+ Invite Member]

Name
Email
Role
Status
Joined
Actions
```

Actions:

```text
Change Role
Remove
```

Invitation modal:

```text
Email
Role
[Send Invitation]
```

## Tests

- invite
- duplicate invite
- existing member
- role update
- unauthorized role update
- self-promotion prevention
- last-owner protection
- remove member
- tenant isolation

## Hard Stop

Run full auth/RBAC regression.

STOP.

---

# CRUD-6 — Workspace Lifecycle

## Objective

Add safe workspace lifecycle management.

Workspace deletion is high-risk because it contains members, numbers, buyers, campaigns, calls, recordings, usage, and billing relationships.

## Preferred Lifecycle

Conceptually:

```text
ACTIVE
SUSPENDED
ARCHIVED
```

Use existing schema where possible.

## Backend

Potential operations:

- Suspend workspace
- Archive workspace
- Restore workspace

Only implement restoration if it is safe and useful.

## Hard Delete

Do NOT implement hard workspace deletion in the initial CRUD program.

## Frontend

Settings → Danger Zone:

```text
Workspace Status

[Suspend Workspace]
[Archive Workspace]
```

Require:

- OWNER
- strong confirmation
- workspace name confirmation where appropriate

## Tests

- owner-only
- admin/member rejection
- tenant isolation
- suspend
- archive
- restoration if implemented
- historical data preservation

## Hard Stop

STOP after validation.

---

# CRUD-7 — Blocked Caller Enrichment

Blocked Callers are already effectively CRUD-complete.

Do not over-engineer.

Optional improvements:

- edit reason
- search
- filtering
- pagination
- bulk unblock

Only prioritize these if the data volume and UX justify them.

Do not edit the canonical normalized phone number itself. Unblock/re-add is safer.

---

# CRUD-8 — UI Enrichment

After backend capabilities are stable, enrich the UI consistently.

## Standard Action Menu

Use a shared pattern:

```text
⋮
├── View
├── Edit
├── Activate
├── Pause
├── Archive
└── Release/Delete
```

Only display actions valid for the current resource/state.

Never render unsupported actions.

## Standard Forms

All CRUD forms should have:

- labels
- validation
- inline errors
- loading state
- disabled submit while saving
- success feedback
- server error handling
- cancellation
- keyboard accessibility

## Standard Confirmation Dialogs

For destructive actions:

```text
Archive Campaign?

This campaign will stop receiving new calls.
Historical calls and reports will remain available.

[Cancel] [Archive]
```

---

# CRUD-9 — Search / Filter / Sort / Pagination

Perform a separate audit before adding these globally.

## Campaigns

Potential:

- search
- status
- tracking number
- date

## Buyers

Potential:

- search
- status
- campaign

## Phone Numbers

Potential:

- search
- status
- campaign
- provider

## Members

Potential:

- search
- role
- status

## Blocked Callers

Potential:

- search
- status

Only add backend pagination where data-access patterns justify it.

---

# CRUD-10 — Detail Views

Improve resource management through dedicated detail pages where appropriate.

## Campaign Detail

Potential sections:

```text
Overview
Routing
Tracking Number
Recent Calls
Performance
Settings
```

Only show metrics/data actually available from backend contracts.

## Buyer Detail

Potential sections:

```text
Overview
Status
Campaign Assignments
Routing Positions
Call History
```

## Phone Number Detail

Potential:

```text
Number
Provider
Status
Campaign
Created
Actions
```

## Member Detail

Potential:

```text
Identity
Role
Workspace
Joined
Status
```

Do not invent unsupported data.

---

# CRUD-11 — Destructive Action UX

Every destructive operation must have consistent UX.

## Archive Campaign

Warn:

- new calls will stop
- historical calls remain

## Archive Buyer

Warn:

- buyer will stop receiving new calls
- historical records remain

## Release Phone Number

Warn:

- provider number may be released
- campaign configuration may be affected
- operation may be irreversible

## Remove Member

Warn:

- user loses workspace access

---

# CRUD-12 — Backend Security & Data Integrity

Every mutation must satisfy:

## Authentication

Valid Supabase session/JWT.

## Tenant Isolation

Every resource mutation must verify the authenticated workspace.

Never trust a client-supplied workspace ID without authorization.

## RBAC

Apply existing workspace roles.

Do not create an independent permission model.

## Validation

Use existing DTO/validation conventions.

## Transactions

Use transactions where multiple rows must change atomically.

Especially:

- routing reorder
- member role changes where ownership constraints apply
- lifecycle transitions affecting dependent configuration

## Provider Safety

For phone numbers:

```text
Application
    ↓
Provider API
    ↓
Database state
```

must be handled safely.

If provider operation fails, application state must not incorrectly claim success.

---

# CRUD-13 — Routing Regression Protection

CRUD changes must not break the routing engine.

| Scenario | Expected |
|---|---|
| Active campaign | Can route |
| Paused campaign | Cannot start new routing |
| Archived campaign | Cannot start new routing |
| Active buyer | Eligible |
| Inactive buyer | Skipped |
| Archived buyer | Skipped |
| Buyer removed | Skipped |
| Priority changed | New order used |
| Historical call | Unchanged |
| Active call during config change | Remains valid |
| Concurrent routing | Existing locking remains intact |

This phase is mandatory because Campaign/Buyer lifecycle changes directly affect routing.

---

# CRUD-14 — Full E2E Verification

Each completed phase should have:

## Backend

- unit tests
- service tests
- controller/API tests
- E2E tests
- tenant isolation tests
- RBAC tests
- validation tests

## Frontend

- component tests where applicable
- page tests where practical
- interaction testing
- responsive checks
- loading/error/empty states

## Regression

Run:

- backend tests
- frontend tests
- typecheck
- lint
- production build
- routing concurrency suite

Do not accept a phase merely because its new tests pass.

---

# CRUD-15 — Final UI/UX Polish

After all functional work is complete:

## Responsive

Verify:

- desktop
- tablet
- mobile

## Accessibility

Verify:

- keyboard navigation
- focus visibility
- labels
- ARIA where needed
- modal focus handling
- action menu accessibility
- color-independent status communication

## UX

Verify:

- loading states
- empty states
- errors
- confirmation dialogs
- success feedback
- disabled states
- no accidental duplicate submissions
- consistent terminology
- consistent action placement

## Product Honesty

Verify:

- no fake metrics
- no fake integrations
- no unsupported buttons
- no UI actions that backend cannot perform
- no misleading statuses

---

# 6. Lifecycle Rules

## Workspace

```text
ACTIVE
  ↓
SUSPENDED
  ↓
ARCHIVED
```

Prefer lifecycle management over deletion.

## Campaign

```text
ACTIVE
  ↓
PAUSED
  ↓
ARCHIVED
```

Exact states must follow the existing domain.

## Buyer

```text
ACTIVE
  ↓
INACTIVE
  ↓
ARCHIVED
```

Exact states must follow the existing domain.

## Phone Number

```text
PROVISIONED
  ↓
ASSIGNED
  ↓
UNASSIGNED
  ↓
RELEASED
```

Provider state must be verified.

## Member

```text
INVITED
  ↓
ACTIVE
  ↓
REMOVED
```

## Blocked Caller

```text
ACTIVE BLOCK
  ↓
UNBLOCKED
```

## Calls / Attempts / Recordings / Usage / Billing

Immutable/read-only.

---

# 7. Data Dependency Model

```text
Workspace
│
├── Members
│
├── Phone Numbers
│
├── Buyers
│
└── Campaigns
      │
      ├── Phone Number
      │
      └── Buyer Assignments
              │
              └── Priority

Campaign
   │
   └── Calls
          │
          └── Call Attempts
                  │
                  └── Recordings

Workspace
   │
   └── Usage
          │
          └── Billing
```

Historical data must survive configuration lifecycle changes.

---

# 8. Authorization Matrix

| Operation | OWNER | ADMIN | MEMBER | VIEWER |
|---|---:|---:|---:|---:|
| Campaign edit | Yes | Yes | No | No |
| Campaign archive | Yes | Yes | No | No |
| Buyer edit | Yes | Yes | No | No |
| Buyer archive | Yes | Yes | No | No |
| Routing reorder | Yes | Yes | No | No |
| Routing detach | Yes | Yes | No | No |
| Phone release | Yes | Yes | No | No |
| Member invite | Yes | Yes | No | No |
| Member role change | Yes | Verify existing policy | No | No |
| Member remove | Existing policy | Existing policy | No | No |
| Workspace lifecycle | Yes | No | No | No |

**Important:** This is an implementation target, not permission truth. Verify the actual existing RBAC definitions before implementation.

---

# 9. API Design Principles

When adding backend endpoints:

1. Follow existing route conventions.
2. Follow existing DTO conventions.
3. Follow existing response format.
4. Follow existing authentication guards.
5. Follow existing workspace authorization patterns.
6. Do not create duplicate endpoint styles.
7. Prefer REST semantics consistent with the existing API.
8. Validate all IDs.
9. Never trust client workspace IDs.
10. Return appropriate HTTP status codes.
11. Use transactions for multi-row mutations.
12. Preserve idempotency where relevant.
13. Never expose secrets unnecessarily.
14. Never change unrelated API contracts.

---

# 10. Frontend Architecture Principles

All new CRUD UI must use the existing UI V2 design system.

Use shared:

- buttons
- inputs
- dialogs
- dropdowns
- badges
- tables
- cards
- empty states
- loading states
- error states
- feedback/toast patterns

Maintain:

- responsive behavior
- accessibility
- consistent spacing
- consistent typography
- consistent action placement

---

# 11. Testing Strategy

Every mutation should be tested at four levels where applicable.

## Level 1 — Validation

Invalid:

- IDs
- states
- roles
- phone numbers
- relationships

must fail safely.

## Level 2 — Authorization

Test:

- valid role
- insufficient role
- unauthenticated
- cross-tenant

## Level 3 — Data Integrity

Test:

- foreign keys
- unique constraints
- historical references
- provider synchronization
- rollback behavior

## Level 4 — Product Behavior

Test:

- routing
- reporting
- usage
- billing
- UI behavior

---

# 12. Git / Agent Workflow

Each phase should be handled independently.

## Before Phase

```bash
git status
git branch
git log -1 --oneline
```

Confirm expected state.

## During Phase

Agent must stay within phase scope.

## After Phase

Run:

```bash
git status
git diff --stat
```

Then:

- typecheck
- lint
- tests
- build
- relevant E2E

## Commit

Use one focused commit per phase.

Examples:

```text
feat: add phone number management UI
```

```text
feat: add buyer lifecycle management
```

Do not mix unrelated changes.

---

# 13. Hard Scope Rules for Coding Agents

Every implementation prompt must state:

> Implement ONLY the specified phase.

The agent must NOT:

- modify unrelated modules
- redesign unrelated pages
- modify API/Webhooks
- introduce excluded features
- rewrite routing
- refactor unrelated architecture
- upgrade dependencies unnecessarily
- modify environment configuration unnecessarily
- weaken security
- bypass RBAC
- add fake frontend controls
- create unsupported backend fields
- delete historical records

If an agent discovers a dependency belonging to another phase:

1. document it
2. stop
3. report it

Do not silently expand scope.

---

# 14. Definition of Done

A phase is complete only when:

## Functionality

- intended backend operations work
- intended frontend operations work
- lifecycle rules work
- existing behavior is preserved

## Security

- authentication
- RBAC
- tenant isolation
- ownership checks

## Data Integrity

- transactions
- constraints
- historical records
- provider consistency

## Tests

- unit
- E2E where appropriate
- regression

## Frontend

- responsive
- accessible
- loading states
- error states
- empty states
- confirmations

## Quality

- typecheck passes
- lint passes
- tests pass
- build passes

Known pre-existing issues may be documented rather than fixed if outside the phase scope.

---

# 15. Recommended Execution Order

## Priority Group 1 — Core Configuration

### CRUD-1
Phone Number UI Parity

### CRUD-2
Buyer Lifecycle

### CRUD-3
Campaign Lifecycle

### CRUD-4
Campaign ↔ Buyer Routing

These four phases directly affect the core product.

## Priority Group 2 — Workspace Administration

### CRUD-5
Members & Roles

### CRUD-6
Workspace Lifecycle

## Priority Group 3 — Product Enrichment

### CRUD-7
Blocked Caller optional improvements

### CRUD-8
UI enrichment

### CRUD-9
Search/filter/sort/pagination

### CRUD-10
Detail views

## Priority Group 4 — Hardening

### CRUD-11
Destructive action UX

### CRUD-12
Security/data integrity

### CRUD-13
Routing regression

### CRUD-14
Full E2E

### CRUD-15
Final UI polish

---

# 16. Important Design Decisions

## Decision 1 — Do not CRUD historical data

Calls, attempts, recordings, usage and billing remain immutable.

## Decision 2 — Prefer lifecycle over deletion

Campaigns, buyers and workspaces should not be hard-deleted when historical dependencies exist.

## Decision 3 — Routing priority is a transactional operation

Do not update priorities one row at a time.

## Decision 4 — Provider resources require provider-aware lifecycle

Phone number release must be verified against the real provider adapter.

## Decision 5 — UI must reflect actual backend capability

No fake actions.

## Decision 6 — Backend should be enriched where required

CRUD is not limited to frontend buttons. Missing backend operations should be added where logically required.

## Decision 7 — Preserve existing routing concurrency protections

CRUD work must not regress the hardened call state machine.

## Decision 8 — API and Webhooks remain deferred

Do not expand these areas during this program.

---

# 17. Final Target State

```text
CALLFLOW
│
├── Dashboard
│
├── Operations
│   ├── Calls
│   └── Reporting
│
├── Routing
│   ├── Campaigns
│   ├── Buyers
│   └── Phone Numbers
│
├── Controls
│   └── Blocked Callers
│
├── Workspace
│   ├── Members
│   ├── Usage
│   ├── Billing
│   └── Settings
│
└── Developer
    ├── API Keys       [DEFERRED]
    └── Webhooks       [DEFERRED]
```

Configuration resources should be manageable through complete lifecycle operations.

Operational history should remain trustworthy and immutable.

The final UI should expose the full capability of the backend without pretending unsupported functionality exists.

---

# 18. Final Success Criteria

The CRUD & UI Enrichment program is complete when:

- Campaigns can be safely edited and lifecycle-managed.
- Buyers can be safely edited and lifecycle-managed.
- Campaign-to-Buyer routing priorities can be safely reordered.
- Buyers can be detached from campaigns.
- Phone Number backend capabilities are fully exposed in UI.
- Phone release is provider-safe.
- Members can be invited and roles managed according to RBAC.
- Workspace lifecycle is safely managed.
- Blocked Callers are appropriately enriched if needed.
- Configuration pages have coherent action menus.
- Detail views expose useful existing data.
- Search/filter/sort/pagination are added where justified.
- Destructive actions have proper safeguards.
- Tenant isolation remains intact.
- RBAC remains intact.
- Routing concurrency remains intact.
- Historical data remains intact.
- Billing/usage integrity remains intact.
- Existing provider abstractions remain intact.
- Full regression suite passes.
- Frontend and backend builds pass.
- No unsupported features are introduced.
- Public API and Customer Webhooks remain untouched.

---

# 19. Next Immediate Action

Do NOT implement the entire plan at once.

The next implementation task is:

## CRUD-1 — Phone Number UI Parity

The coding agent should first:

1. Audit the existing Phone Number backend implementation.
2. Verify the actual Telnyx/Twilio release behavior.
3. Confirm campaign dependency behavior.
4. Implement only the required Phone Number UI/backend adjustments.
5. Add required tests.
6. Run validation.
7. Produce a completion report.
8. STOP.

Only after CRUD-1 is reviewed should CRUD-2 begin.

---

# 20. Master Principle

> Build CallFlow as a mature SaaS configuration platform around an immutable operational history.

Configuration should be manageable.

Routing should be controllable.

Provider resources should have safe lifecycles.

Workspace administration should be complete.

Historical calls and financial records should remain trustworthy.

Every feature should be backed by real backend capability, proper authorization, tenant isolation, validation, and tests.

No fake functionality.

No silent scope expansion.

No unnecessary destruction of historical data.

No regression of the existing routing engine.
