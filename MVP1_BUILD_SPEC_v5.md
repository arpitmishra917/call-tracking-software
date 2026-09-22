# MVP 1 --- Call Tracking & Sequential Buyer Routing Platform

## Controlled AI Coding Agent Build Specification --- v5

> **Document status:** This document supersedes `MVP1_BUILD_SPEC(4).md`.
>
> **Purpose:** This is the single source of truth for building MVP 1 of
> a multi-tenant call-tracking and sequential buyer-routing SaaS.
>
> **Primary production telephony:** Telnyx.
>
> **Development/validation telephony:** Twilio.
>
> **Authentication:** Supabase Auth.
>
> **Core database:** PostgreSQL.
>
> **Build philosophy:** Small, explicitly authorized stages with a hard
> stop after every stage. The owner controls progression. The coding
> agent must not silently implement future stages.

------------------------------------------------------------------------

# 0. EXECUTIVE DECISIONS --- READ FIRST

These decisions are already made and are NOT open for reinterpretation.

  -----------------------------------------------------------------------
  Area                                Decision
  ----------------------------------- -----------------------------------
  Primary production telephony        Telnyx

  Temporary development/validation    Twilio
  telephony                           

  Telephony architecture              Provider abstraction

  Authentication                      Supabase Auth

  Application authorization           Our application/workspace
                                      membership + roles

  Core database                       PostgreSQL

  Redis                               Optional; only if a demonstrated
                                      requirement exists

  Routing model                       Sequential priority-based fallback

  DNI                                 Not included

  Visitor tracking                    Not included

  IVR                                 Not included

  Geographic routing                  Not included

  Time/business-hours routing         Not included

  Round robin                         Not included

  RTB/Ping/Post                       Not included

  White label                         Not included

  Buyer employee routing              Not included

  Billing provider                    Decide during billing stage after
                                      current official-doc research
  -----------------------------------------------------------------------

## 0.1 Critical telephony decision

Telnyx is the intended production provider for MVP 1.

Twilio exists so development does not stop while Telnyx resources are
unavailable and so the provider-independent application architecture can
be validated with real calls.

Twilio is **not** a second equal production product in MVP 1.

The application must not contain business logic such as:

``` text
if provider === twilio then use a different routing algorithm
```

Provider-specific behavior belongs inside provider adapters.

## 0.2 Telnyx number availability must not block early development

The absence of a Telnyx number does not block:

-   database work
-   authentication
-   authorization
-   workspace management
-   campaign/buyer CRUD
-   routing-domain tests
-   block-list logic
-   provider abstraction
-   mocked telephony tests
-   frontend development
-   API development
-   usage model
-   billing model

When the Telnyx number becomes available, real Telnyx end-to-end
validation becomes a controlled integration gate.

------------------------------------------------------------------------

# 1. NON-NEGOTIABLE AI AGENT RULES

The coding agent must:

1.  Read this entire specification before architectural work.
2.  Inspect the entire existing repository before changing architecture.
3.  Inspect existing files before creating replacements.
4.  Preserve verified working code unless there is a documented reason
    to change it.
5.  Never invent APIs, SDK methods, webhook events, database behavior,
    environment variables, or provider capabilities.
6.  Consult current official provider documentation before implementing
    provider-specific behavior.
7.  Prefer official documentation over blogs, tutorials, forums, memory,
    or guesses.
8.  If documentation is ambiguous, create a small isolated proof before
    committing to the design.
9.  Never silently substitute a technology or provider.
10. Never implement an explicitly out-of-scope feature.
11. Never implement a later stage because it is described here.
12. Never silently expand a stage.
13. Keep secrets out of source control.
14. Use `.env.example` with placeholders only.
15. Add automated tests for business logic.
16. Run the relevant validation commands before declaring a stage
    complete.
17. Fix failures instead of hiding them.
18. Document setup and behavior changes.
19. Never claim a real provider test passed unless it actually ran.
20. Clearly distinguish automated/mock verification from real provider
    verification.
21. If an essential fact cannot be verified, stop and report the
    blocker.
22. Do not replace the POC provider abstraction merely because another
    architecture looks cleaner.
23. Do not introduce Redis unless a concrete current-stage requirement
    is demonstrated.
24. Do not store Supabase passwords in the application database.
25. Do not create a second application authentication system.
26. Do not put Telnyx or Twilio secrets in browser code.
27. Do not expose recordings publicly.
28. Do not trust a client-supplied workspace ID without authorization.
29. Do not allow duplicate routing transitions.
30. After every stage: report, verify, STOP.

------------------------------------------------------------------------

# 2. ANTI-HALLUCINATION PROTOCOL

For every external integration:

``` text
1. Identify the exact operation required.
2. Open the current official documentation.
3. Confirm the exact API/SDK operation.
4. Confirm authentication.
5. Confirm request parameters.
6. Confirm response/event shape.
7. Confirm webhook/event names.
8. Confirm error behavior.
9. Implement the smallest verified integration.
10. Add unit/mock tests.
11. If credentials/resources exist, perform a real test.
12. Record exactly what was verified.
```

Never infer an SDK method from a method name.

If current provider documentation conflicts with this specification:

-   provider documentation controls provider-specific implementation
    details;
-   this specification controls product scope and business behavior;
-   if the conflict changes product behavior, STOP and ask the owner.

------------------------------------------------------------------------

# 3. CURRENT POC HANDOFF --- MANDATORY

A previous telephony POC has already been developed.

The coding agent must inspect and understand that POC before replacing
telephony code.

## 3.1 Verified POC findings

The POC established:

-   Telnyx webhook signature handling was implemented using the current
    SDK approach available during the POC.
-   Telnyx `constructEvent` was found deprecated and replaced with
    `client.webhooks.unwrap`.
-   Raw request body handling was required for signature verification.
-   In-memory idempotency was proven in the POC but is not sufficient
    for production.
-   Telnyx Call Control concepts were verified.
-   Telnyx events used in the POC included `call.initiated`,
    `call.answered`, and `call.hangup`.
-   The POC used provider abstraction.
-   The provider abstraction included operations equivalent to:
    -   `answerCall`
    -   `dialBuyer`
    -   `bridgeCalls`
    -   `hangupCall`
-   Internal normalized events were introduced so routing logic did not
    depend directly on Telnyx event names.
-   A Twilio adapter was implemented.
-   Twilio real inbound call testing passed.
-   Twilio A-answer passed.
-   Twilio A-no-answer → B passed.
-   Twilio B-answer passed.
-   Caller-to-A audio passed.
-   Caller-to-B audio passed.
-   Twilio Conference was used after an earlier Twilio bridge approach
    caused an audio problem.
-   Real Telnyx E2E validation remained pending because the required
    active Telnyx number/setup was unavailable.
-   Recording was not fully validated in the POC and remains a later MVP
    stage.
-   The POC exposed the importance of persistent state and atomic
    transitions around timeout/answer races.

## 3.2 POC reuse rule

Before Stage 1 implementation, inspect the POC.

Reuse verified concepts/code where appropriate.

Do NOT:

-   copy in-memory production state directly into MVP;
-   copy test-only shortcuts into production;
-   rebuild the provider integration from scratch without justification;
-   assume POC behavior is automatically production-ready.

The MVP must replace transient POC state with persistent database state
and durable idempotency.

------------------------------------------------------------------------

# 4. PRODUCT DEFINITION

The platform is a multi-tenant SaaS for businesses/agencies that need:

-   Telnyx tracking numbers
-   inbound call tracking
-   call forwarding/bridging
-   sequential buyer routing
-   campaign-specific buyer priority
-   buyer fallback
-   call recording
-   call history
-   call attempts
-   blocked caller numbers
-   campaigns
-   buyers
-   reporting
-   usage metering
-   subscription billing
-   authenticated API
-   customer webhooks
-   workspaces
-   roles and permissions

Core flow:

``` text
Caller
  ↓
Telnyx Tracking Number
  ↓
Platform
  ↓
Normalize caller
  ↓
Blocked-number check
  ↓
Campaign
  ↓
Eligible buyers sorted by priority
  ↓
Buyer A
  ↓
No answer/failure
  ↓
Buyer B
  ↓
No answer/failure
  ↓
Buyer C
  ↓
First successful buyer wins
```

The caller remains in one platform-controlled inbound call flow.

The platform never asks the caller to hang up and call again.

------------------------------------------------------------------------

# 5. EXPLICITLY OUT OF SCOPE

Do not build:

1.  Website visitor tracking
2.  Website JavaScript tracking
3.  Dynamic Number Insertion (DNI)
4.  Number pools for visitor/session assignment
5.  Google Ads attribution
6.  Meta/Facebook attribution
7.  GCLID/FBCLID attribution
8.  IVR
9.  DTMF menus
10. Call Flow Builder
11. Geographic routing
12. Time/business-hours routing
13. Round robin
14. Skill-based routing
15. Complex routing rules
16. Real-time bidding
17. Ping/Post lead distribution
18. Lead marketplace
19. White labeling
20. Fraud detection
21. Dispute management
22. Complex lead-credit wallet
23. Buyer employee routing
24. Buyer salesperson management
25. Internal buyer fallback
26. AI voice agents
27. Call transcription unless separately authorized
28. Sentiment analysis
29. Deepfake detection
30. SIP softphone product
31. Chat/SMS product
32. Email marketing
33. CRM product
34. Marketing automation
35. Unrequested integrations

If something seems useful but is out of scope, document it as future
work instead of building it.

------------------------------------------------------------------------

# 6. CORE BUSINESS RULES

## 6.1 Campaign-specific priority

Priority belongs to the campaign-buyer relationship.

Example:

``` text
Campaign A:
Buyer A = 1
Buyer B = 2

Campaign B:
Buyer B = 1
Buyer A = 2
```

Never store only a global buyer priority.

## 6.2 Sequential routing

For:

``` text
A priority 1
B priority 2
C priority 3
```

the platform must:

``` text
A answers
→ connect A
→ stop

A fails/no-answer
→ attempt B

B answers
→ connect B
→ stop

B fails/no-answer
→ attempt C
```

Only one buyer may win the call.

## 6.3 Buyer responsibility

A buyer supplies a destination number.

The platform does not manage the buyer's employees or internal phone
system.

## 6.4 Duplicate priority

For MVP 1:

``` text
UNIQUE(campaign_id, priority)
```

Duplicate priorities must be rejected.

## 6.5 Blocked caller

Normalize caller number to E.164 before comparison.

Flow:

``` text
Inbound
 ↓
Normalize
 ↓
Blocked?
 ├─ YES → reject/hangup + record BLOCKED
 └─ NO  → continue
```

A blocked caller must never reach a buyer.

## 6.6 Tracking number

A tracking number is an actual provider phone number.

There is no DNI and no visitor/session number replacement.

------------------------------------------------------------------------

# 7. DATA AND SECURITY PRINCIPLES

## 7.1 Database is the source of business truth

The database owns:

-   workspace relationships
-   campaigns
-   buyers
-   priorities
-   block list
-   call state
-   call attempts
-   usage
-   recording metadata
-   billing state
-   API keys
-   outbound webhook configuration

The provider owns telephony events, not business truth.

## 7.2 Tenant isolation

Every tenant-owned resource must belong to a workspace.

Every read/write must verify workspace membership and role.

Test IDOR explicitly.

## 7.3 Secrets

Never commit:

-   Supabase secret/service-role keys
-   Telnyx API keys
-   Twilio auth tokens
-   database passwords
-   encryption keys
-   payment credentials
-   customer webhook signing secrets

API keys should be hashed when only verification is required.

Secrets that must later be recovered for signing/decryption must be
encrypted at rest, not merely hashed.

------------------------------------------------------------------------

# 8. DATABASE MODEL

Use PostgreSQL.

The following is the target conceptual model. Exact columns may be
refined during the relevant stage without changing the product behavior.

## users / profiles

Supabase Auth owns authentication identity.

Application profile data may contain:

``` text
id
display_name
created_at
updated_at
```

`id` should map to the Supabase Auth user ID.

Do NOT store a second password hash.

## workspaces

``` text
id
name
slug
status
created_at
updated_at
```

## workspace_members

``` text
id
workspace_id
user_id
role
created_at
updated_at
```

## phone_numbers

Provider-neutral:

``` text
id
workspace_id
provider
phone_number_e164
provider_number_id
provider_connection_id nullable
status
created_at
updated_at
```

Do not name production schema fields `telnyx_*` when the field
represents a generic provider concept.

## campaigns

``` text
id
workspace_id
name
description
status
ring_timeout_seconds
created_at
updated_at
```

## campaign_phone_numbers

``` text
id
campaign_id
phone_number_id
active
created_at
updated_at
```

Enforce an unambiguous active mapping.

## buyers

``` text
id
workspace_id
name
company_name
default_destination_number_e164 nullable
status
notes nullable
created_at
updated_at
```

## campaign_buyers

``` text
id
campaign_id
buyer_id
priority
destination_number_e164
active
created_at
updated_at
```

Constraint:

``` text
UNIQUE(campaign_id, priority)
```

## blocked_numbers

``` text
id
workspace_id
phone_number_e164
reason
created_by
created_at
```

Constraint:

``` text
UNIQUE(workspace_id, phone_number_e164)
```

## calls

Provider-neutral IDs:

``` text
id
workspace_id
campaign_id
tracking_phone_number_id
provider
provider_call_id
provider_session_id nullable
caller_number_e164
started_at
answered_at nullable
ended_at nullable
duration_seconds nullable
status
final_buyer_id nullable
hangup_cause nullable
recording_status
created_at
updated_at
```

## call_attempts

``` text
id
call_id
buyer_id
priority
destination_number_e164
provider
provider_call_id nullable
provider_leg_id nullable
started_at
answered_at nullable
ended_at nullable
duration_seconds nullable
result
failure_reason nullable
created_at
updated_at
```

## recordings

``` text
id
call_id
call_attempt_id nullable
provider
provider_recording_id
format nullable
channels nullable
storage_provider nullable
storage_key nullable
duration_seconds nullable
status
created_at
updated_at
```

## webhook_events

``` text
id
provider
provider_event_id
event_type
payload_hash
payload_json
occurred_at
processed_at nullable
processing_status
error_message nullable
created_at
```

Constraint:

``` text
UNIQUE(provider, provider_event_id)
```

## usage_records

``` text
id
workspace_id
call_id nullable
usage_type
quantity
unit
provider_cost nullable
customer_cost nullable
occurred_at
metadata_json
created_at
```

## subscriptions

``` text
id
workspace_id
plan
status
billing_provider nullable
provider_customer_id nullable
provider_subscription_id nullable
current_period_start nullable
current_period_end nullable
created_at
updated_at
```

## transactions

SaaS billing/accounting only:

``` text
id
workspace_id
type
amount
currency
status
external_reference nullable
metadata_json
created_at
```

No lead marketplace wallet.

## api_keys

``` text
id
workspace_id
name
key_prefix
hashed_secret
last_used_at nullable
revoked_at nullable
created_at
```

Never store raw API secrets.

## outbound_webhooks

``` text
id
workspace_id
url
secret_encrypted
status
created_at
updated_at
```

The signing secret must be recoverable by the delivery service, so
hashing alone is insufficient.

## webhook_deliveries

``` text
id
outbound_webhook_id
event_type
payload_json
status
attempt_count
next_attempt_at nullable
last_error nullable
delivered_at nullable
created_at
updated_at
```

------------------------------------------------------------------------

# 9. AUTHENTICATION --- SUPABASE AUTH

Supabase Auth is the authentication provider.

Supabase Auth is responsible for:

-   signup
-   sign-in
-   session handling
-   email verification where enabled
-   password reset if password authentication is selected
-   access tokens/JWTs
-   authentication identity

Our application is responsible for:

-   workspace membership
-   application roles
-   resource authorization
-   tenant isolation

Do not build custom password storage.

The backend must verify Supabase-authenticated identity according to
current Supabase documentation.

The exact frontend/server integration must use the current recommended
Supabase SSR/client packages for the chosen Next.js architecture.

Do not copy an old Supabase auth tutorial blindly.

------------------------------------------------------------------------

# 10. ROLE MODEL

Minimum roles:

``` text
OWNER
ADMIN
MEMBER
VIEWER
```

Initial permission model:

  Action                        OWNER   ADMIN        MEMBER   VIEWER
  --------------------------- ------- ------- ------------- --------
  View workspace                  Yes     Yes           Yes      Yes
  View calls                      Yes     Yes           Yes      Yes
  View recordings                 Yes     Yes           Yes      Yes
  Create/edit campaign            Yes     Yes           Yes       No
  Manage buyers                   Yes     Yes           Yes       No
  Manage block list               Yes     Yes           Yes       No
  Manage phone numbers            Yes     Yes   Limited/Yes       No
  Manage members                  Yes     Yes            No       No
  Change workspace settings       Yes     Yes            No       No
  Billing                         Yes     Yes            No       No

The implementation must document exact permissions and test them.

------------------------------------------------------------------------

# 11. PROVIDER ABSTRACTION

Core domain code must not import Telnyx or Twilio SDKs directly.

Conceptual interface based on the verified POC:

``` text
TelephonyProvider
 ├─ answerCall(callId)
 ├─ dialBuyer(to, from, connectionId, timeoutSecs)
 ├─ bridgeCalls(callId, buyerCallId)
 └─ hangupCall(callId)
```

Additional operations may be added only when required by an authorized
stage, such as:

``` text
startRecording(...)
stopRecording(...)
```

The exact production method signatures are implementation details.

## Provider event normalization

Provider-specific webhook events must be translated at the edge into
internal events.

Example:

``` text
CALL_INITIATED
CALL_ANSWERED
CALL_HANGUP
```

The normalized event must contain only verified data needed by the
domain layer.

The routing engine must not know whether the source event was:

``` text
Telnyx call.answered
```

or a Twilio status callback.

------------------------------------------------------------------------

# 12. CALL STATE MACHINE

Use an explicit persisted state machine.

High-level states may include:

``` text
RECEIVED
BLOCKED
ROUTING
RINGING_BUYER
BUYER_ANSWERED
CONNECTED
BUYER_NO_ANSWER
BUYER_BUSY
BUYER_FAILED
NEXT_BUYER
COMPLETED
CALLER_HUNG_UP
FAILED
NO_BUYER_AVAILABLE
```

Exact states may be refined during implementation.

Every transition must be controlled.

Terminal states must not transition into new buyer attempts.

Example impossible transition:

``` text
ANSWERED → NO_ANSWER
```

------------------------------------------------------------------------

# 13. CONCURRENCY AND RACE PROTECTION

This is mandatory.

Potential race:

``` text
Buyer A answer event
       +
Buyer A timeout/failure event
       +
caller hangup
```

may arrive almost simultaneously.

The system must guarantee:

``` text
one call
one winning buyer
one authoritative terminal transition
```

Use appropriate PostgreSQL transactions, row locks, optimistic versions,
unique constraints, or another justified mechanism.

Do not rely only on JavaScript memory.

A process restart must not cause duplicate buyer routing.

------------------------------------------------------------------------

# 14. CALL VS CALL ATTEMPT

A `call` represents the caller's overall inbound interaction.

A `call_attempt` represents one attempt to connect that call to one
buyer.

Example:

``` text
Call #10001

Attempt 1
Buyer A
NO_ANSWER
20 seconds

Attempt 2
Buyer B
ANSWERED
05:32

Final buyer = Buyer B
```

Never create a new top-level customer call simply because the next buyer
is attempted.

------------------------------------------------------------------------

# 15. TESTING MODEL

Every stage must have tests appropriate to that stage.

## 15.1 Unit tests

At minimum:

-   priority sorting
-   duplicate priority rejection
-   blocked caller
-   inactive buyer skipping
-   A answers → B not attempted
-   A fails → B attempted
-   A fails + B answers → B wins
-   A/B/C fail → no buyer available
-   caller hangs up → no later buyer
-   race condition → one winner
-   tenant isolation
-   role authorization
-   webhook signature validation
-   webhook idempotency

## 15.2 Provider tests

Use deterministic fake provider adapters.

Do not require a live Telnyx account for ordinary CI.

## 15.3 Twilio real tests

Twilio may be used for real development validation when configured.

Every real test must be clearly labelled:

``` text
REAL-TWILIO
```

## 15.4 Telnyx real tests

Real Telnyx tests require the required active Telnyx resources.

Until then:

``` text
TELNYX REAL E2E = BLOCKED / NOT YET AVAILABLE
```

That is not a software failure.

Do not falsely mark it PASS.

------------------------------------------------------------------------

# 16. DEVELOPMENT STACK

Preferred stack if starting from scratch:

``` text
Frontend:
Next.js + React + TypeScript

Backend:
NestJS + TypeScript

Database:
PostgreSQL

ORM:
Prisma or another mature TypeScript PostgreSQL ORM

Authentication:
Supabase Auth

Queue/cache:
Only if required; Redis is NOT mandatory

Testing:
Jest/Vitest + Playwright

API:
REST

Local environment:
Docker / Docker Compose where useful
```

If the repository already has a justified stack, inspect it first.

Do not replace it without an explicit reason and owner approval.

------------------------------------------------------------------------

# 17. REPOSITORY STRUCTURE

If starting from scratch:

``` text
/
├── apps/
│   ├── web/
│   └── api/
├── packages/
│   ├── database/
│   ├── shared/
│   ├── validation/
│   ├── config/
│   └── telephony/
├── docs/
│   ├── architecture/
│   ├── api/
│   ├── runbooks/
│   └── decisions/
├── tests/
│   ├── integration/
│   └── e2e/
├── docker/
├── .env.example
├── docker-compose.yml
├── package.json
├── README.md
└── AGENTS.md
```

Exact structure may differ if justified.

------------------------------------------------------------------------

# 18. CONTROLLED STAGE PLAN

MVP 1 is intentionally divided into **20 controlled stages**.

The stages are deliberately small.

The agent must never implement a later stage automatically.

## Stage 0 --- Repository Audit and POC Inventory

### Goal

Understand the repository and previous POC before changing anything.

### Build

Nothing.

### Inspect

-   repository structure
-   package manager
-   existing source
-   existing tests
-   existing environment configuration
-   POC files
-   Telnyx adapter
-   Twilio adapter
-   provider abstraction
-   current scripts
-   current database state if any

### Deliverable

Create an audit report containing:

``` text
1. Repository structure
2. Existing stack
3. Existing POC components
4. Reusable components
5. Components unsafe for production reuse
6. Missing MVP components
7. Current test status
8. Blockers
9. Proposed Stage 1 changes
```

### Acceptance

No application feature is implemented.

### STOP

------------------------------------------------------------------------

# Stage 1 --- Architecture Lock and ADRs

### Goal

Turn the already-decided architecture into explicit machine-readable
decisions.

### Build

Create architecture decision records for:

-   Telnyx primary
-   Twilio development/validation
-   Supabase Auth
-   PostgreSQL
-   provider abstraction
-   provider-neutral identifiers
-   database source of truth
-   Redis optional
-   workspace isolation
-   role model
-   POC reuse strategy

### Acceptance

Every unresolved architecture choice required by later stages is either:

-   decided here, or
-   explicitly marked as a later decision gate.

### STOP

------------------------------------------------------------------------

# Stage 2 --- Repository Foundation and Tooling

### Goal

Establish reproducible development tooling.

### Build

Only:

-   package/workspace setup
-   TypeScript configuration
-   lint
-   formatting
-   test runner
-   build scripts
-   environment loader
-   base documentation
-   CI-ready scripts
-   Docker/local infrastructure where justified

### Do NOT build

-   authentication
-   campaigns
-   buyers
-   Telnyx calls
-   billing

### Acceptance

A clean environment can install, typecheck, lint, test, and build.

### STOP

------------------------------------------------------------------------

# Stage 3 --- Supabase Project and Authentication

### Goal

Integrate Supabase Auth without creating a second auth system.

### Build

-   Supabase client configuration
-   server-side authentication integration
-   signup/login
-   logout
-   session handling
-   protected routes
-   authenticated API identity
-   email verification behavior according to selected Supabase
    configuration
-   password reset only if password auth is selected
-   auth-related tests

### Do NOT build

-   workspace authorization
-   buyer management
-   Telnyx

### Acceptance

A user can:

``` text
Sign up
→ authenticate
→ receive session
→ access protected page
→ call protected API
→ logout
→ lose protected access
```

### Evidence

Record Supabase configuration used.

### STOP

------------------------------------------------------------------------

# Stage 4 --- PostgreSQL Schema and Migrations

### Goal

Create the persistent domain foundation.

### Build

-   PostgreSQL connection
-   ORM
-   migrations
-   users/profile mapping
-   workspaces
-   workspace_members
-   initial common metadata

Do not create every future table unless needed for this stage.

### Acceptance

-   clean database migration works
-   rollback/recovery procedure documented where applicable
-   schema generated consistently
-   no passwords stored in application tables
-   Supabase user ID mapping documented

### STOP

------------------------------------------------------------------------

# Stage 5 --- Multi-Tenant Authorization and Roles

### Goal

Make workspace isolation real.

### Build

-   workspace membership service
-   role checks
-   authorization guard/service
-   tenant-scoped repository/query helpers
-   OWNER/ADMIN/MEMBER/VIEWER permissions
-   IDOR protection

### Tests

``` text
Workspace A cannot read Workspace B.
Workspace A cannot edit Workspace B.
Viewer cannot mutate protected resources.
Member cannot manage members.
```

### Acceptance

Tenant isolation is tested, not merely documented.

### STOP

------------------------------------------------------------------------

# Stage 6 --- Application Shell and Workspace UI

### Goal

Create the basic usable SaaS shell.

### Build

-   login state
-   dashboard shell
-   navigation
-   workspace selector if required
-   account/profile area
-   role-aware navigation
-   loading/error/empty states

### Do NOT build

-   call dashboard
-   campaign functionality
-   buyer functionality

### Acceptance

Authenticated users can navigate the protected application without
accessing another workspace.

### STOP

------------------------------------------------------------------------

# Stage 7 --- Telephony Contract and Fake Provider

### Goal

Lock the provider-independent telephony boundary.

### Build

-   `TelephonyProvider` interface
-   normalized internal events
-   fake provider
-   deterministic test fixtures
-   provider error model
-   call-control command abstractions

### Critical rule

Start from the verified POC abstraction.

Do not rename/rewrite working methods merely for stylistic preference.

### Acceptance

Routing/domain tests can run without Telnyx or Twilio.

### STOP

------------------------------------------------------------------------

# Stage 8 --- Telnyx Adapter Foundation

### Goal

Convert the verified Telnyx POC integration into a production-oriented
adapter.

### Build

-   Telnyx configuration
-   official SDK integration
-   webhook raw-body handling
-   signature verification
-   normalized events
-   provider error mapping
-   idempotency boundary
-   adapter unit tests

### Research

Verify current official Telnyx docs before implementation.

### Important

Real Telnyx E2E may remain blocked by number/resource availability.

### Acceptance

Mocked Telnyx adapter tests pass.

Real Telnyx status must be reported honestly.

### STOP

------------------------------------------------------------------------

# Stage 9 --- Twilio Development Adapter

### Goal

Preserve the working real-call development path.

### Build

-   Twilio provider adapter
-   Twilio webhook validation
-   normalized events
-   development configuration
-   automated tests

If existing working Twilio code already satisfies the contract, reuse
it.

Do not add Twilio-specific product features.

### Acceptance

Existing real Twilio call scenarios remain functional when
credentials/configuration are available.

### STOP

------------------------------------------------------------------------

# Stage 10 --- Provider Webhook Persistence and Idempotency

### Goal

Move webhook processing from transient POC state to PostgreSQL.

### Build

-   webhook_events table
-   unique provider/event ID constraint
-   persisted event receipt
-   processing state
-   duplicate handling
-   safe retries
-   unknown-event handling

### Acceptance

Same provider event delivered multiple times results in one business
effect.

### STOP

------------------------------------------------------------------------

# Stage 11 --- Phone Number Domain and Telnyx Number Management

### Goal

Manage actual tracking numbers.

### Build

-   provider-neutral phone number model
-   Telnyx number search/provision flow based on current docs
-   number assignment
-   number status
-   release protection
-   phone-number UI

### Real Telnyx gate

When a real Telnyx number becomes available:

``` text
Search
→ Provision
→ Configure
→ Receive inbound test
```

If unavailable, complete mock/unit coverage and mark real E2E blocked.

### Acceptance

No number is automatically released.

### STOP

------------------------------------------------------------------------

# Stage 12 --- Campaigns, Buyers and Block List

### Goal

Build routing configuration without activating sequential calling.

### Build

-   campaigns
-   buyers
-   campaign_buyer relationship
-   unique priority
-   destination numbers
-   tracking-number assignment
-   active/inactive status
-   block list
-   E.164 normalization
-   corresponding UI

### Do NOT build

Actual sequential routing.

### Acceptance

Owner can configure:

``` text
Campaign
Tracking number
Buyer A priority 1
Buyer B priority 2
Buyer C priority 3
Timeout
Blocked caller
```

### STOP

------------------------------------------------------------------------

# Stage 13 --- Call Domain and Persistent State Machine

### Goal

Create durable call and attempt records before activating routing.

### Build

-   calls table
-   call_attempts table
-   state machine
-   transition guards
-   provider-neutral call identifiers
-   call lifecycle service
-   caller hangup handling
-   terminal-state protection

### Acceptance

A simulated call can move through valid states and invalid transitions
are rejected.

### STOP

------------------------------------------------------------------------

# Stage 14 --- Sequential Buyer Routing Engine

### Goal

Implement the core business behavior.

### Build

-   inbound call identification
-   tracking number → campaign
-   block check
-   eligible buyer selection
-   priority ordering
-   call attempt creation
-   buyer dial
-   timeout
-   fallback
-   answer
-   hangup
-   no-buyer behavior
-   winner selection
-   concurrency protection

### Mandatory scenarios

#### A

``` text
A answers
→ A wins
→ B never attempted
```

#### B

``` text
A no-answer
→ B answers
→ B wins
```

#### C

``` text
A no-answer
→ B no-answer
→ C answers
→ C wins
```

#### D

``` text
A/B/C fail
→ no buyer available
```

#### E

``` text
Caller hangs up during A
→ A stops
→ B is not attempted
```

#### F

``` text
A answer and timeout race
→ exactly one winner
→ no B connection
```

### Provider validation

Run domain tests against fake provider first.

Then run real Twilio validation if configured.

Then run real Telnyx validation when the number/resource is available.

### STOP

------------------------------------------------------------------------

# Stage 15 --- Real Telnyx End-to-End Validation Gate

### Goal

Explicitly validate Telnyx as the intended production provider.

This stage is separate so a missing Telnyx number cannot block the rest
of MVP development.

### Required real tests

``` text
Telnyx number receives inbound call
→ webhook arrives
→ signature validates
→ call persists
→ caller is controlled
→ Buyer A rings
→ A answers
→ caller ↔ A audio

A no-answer
→ B rings
→ B answers
→ caller ↔ B audio

Caller hangs up
→ active buyer leg terminates
→ call becomes terminal

Duplicate webhook
→ no duplicate routing

Answer/timeout race
→ one winner
```

### Evidence

Record:

-   timestamp
-   test scenario
-   expected result
-   actual result
-   relevant internal call ID
-   provider event IDs
-   PASS/FAIL
-   blockers

### Critical rule

Do not mark this stage PASS if the real Telnyx tests were not performed.

If Telnyx resources are still unavailable:

``` text
STATUS: BLOCKED — external resource unavailable
```

The owner may still authorize later stages that do not depend on this
gate.

### STOP

------------------------------------------------------------------------

# Stage 16 --- Recording

### Goal

Implement production-safe recording.

### Build

-   provider recording command
-   recording events
-   recording metadata
-   recording status
-   private storage if required
-   signed/private access
-   authorization
-   recording failure handling

### Research

Verify current Telnyx recording behavior and storage requirements.

Never assume a temporary provider URL is permanent.

### Acceptance

A verified test call produces correct recording metadata and authorized
access when recording is enabled.

### STOP

------------------------------------------------------------------------

# Stage 17 --- Call Logs and Reporting

### Goal

Make the system operationally useful.

### Build

-   recent calls
-   call details
-   attempt history
-   search
-   filters
-   date filters
-   campaign metrics
-   buyer metrics
-   answered/missed/blocked
-   duration
-   dashboard

### Acceptance

Call detail shows:

``` text
Caller
Tracking number
Campaign
Start
Answer
End
Duration
Final buyer
Attempts
Recording status
Final status
```

### STOP

------------------------------------------------------------------------

# Stage 18 --- Usage Metering

### Goal

Create traceable raw usage data.

### Build

At minimum:

``` text
CALL_MINUTE
PHONE_NUMBER
RECORDING_STORAGE
```

Keep raw usage independent from customer pricing.

Every usage record must be traceable to source data where applicable.

### Acceptance

A test call generates deterministic usage records.

### STOP

------------------------------------------------------------------------

# Stage 19 --- SaaS Billing

### Goal

Make the product commercially usable.

### Build

-   plans
-   subscription state
-   billing customer
-   billing status
-   recurring subscription
-   invoice/history
-   billing UI
-   usage relationship

### Billing provider

Choose only after current official documentation research.

Do not invent billing API calls.

### Do NOT build

-   buyer payouts
-   lead wallet
-   RTB wallet
-   marketplace accounting
-   dispute credits

### Acceptance

A workspace can view plan, billing status, billing period, usage and
invoice/history.

### STOP

------------------------------------------------------------------------

# Stage 20 --- Public API

### Goal

Expose controlled customer APIs.

### Build

``` text
/api/v1/workspaces/*
/api/v1/phone-numbers/*
/api/v1/campaigns/*
/api/v1/buyers/*
/api/v1/blocked-numbers/*
/api/v1/calls/*
/api/v1/recordings/*
/api/v1/usage/*
/api/v1/billing/*
/api/v1/api-keys/*
/api/v1/webhooks/*
```

### API keys

Use:

``` text
key_prefix
hashed_secret
```

Never store raw API secrets.

### Acceptance

A customer can authenticate an API request and retrieve only their
workspace data.

### STOP

------------------------------------------------------------------------

# Stage 21 --- Customer Webhooks

### Goal

Deliver customer-facing call lifecycle events.

Possible events:

``` text
call.started
call.attempt.started
call.attempt.ended
call.answered
call.ended
call.blocked
recording.available
```

Exact names may be finalized during implementation.

### Build

-   endpoint configuration
-   encrypted signing secret
-   event IDs
-   signatures
-   delivery attempts
-   retries
-   delivery logs
-   idempotency

### Acceptance

A customer receives a signed event, failed delivery retries, and
duplicate delivery processing is safe.

### STOP

------------------------------------------------------------------------

# Stage 22 --- Production Security and Hardening

### Goal

Review the completed application without adding new product features.

### Verify

-   tenant isolation
-   authorization
-   Supabase session handling
-   secret handling
-   provider secret isolation
-   webhook signature verification
-   API rate limiting
-   input validation
-   SSRF protection for customer webhook URLs
-   secure headers
-   XSS protections
-   SQL injection protection
-   private recording access
-   audit logs
-   error leakage
-   sensitive logging
-   dependency vulnerabilities where appropriate

### Acceptance

Security review produces:

``` text
PASS
FAIL
NOT APPLICABLE
```

for every checklist item.

### STOP

------------------------------------------------------------------------

# Stage 23 --- Production Operations and Release Readiness

### Goal

Prepare the MVP for actual customer use.

### Build/document

-   deployment procedure
-   environment variable checklist
-   database migration procedure
-   backup procedure
-   restore procedure
-   monitoring
-   alerting
-   log inspection
-   incident runbook
-   provider outage procedure
-   Telnyx failure procedure
-   Twilio development-only procedure
-   rollback procedure
-   release checklist

### Acceptance

A fresh deployment can be performed from documented instructions.

### STOP

------------------------------------------------------------------------

# 19. STAGE GATE --- MANDATORY AFTER EVERY STAGE

At the end of every stage:

1.  Run tests.
2.  Run typecheck.
3.  Run lint.
4.  Run formatter/check.
5.  Run build where applicable.
6.  Run relevant integration tests.
7.  Run relevant E2E tests.
8.  Test migrations from a clean database where schema changed.
9.  Inspect environment/secrets.
10. Review for out-of-scope work.
11. Update README/docs.
12. Update stage progress.
13. Produce the completion report.
14. STOP.

Do not automatically continue.

------------------------------------------------------------------------

# 20. STAGE COMPLETION REPORT

Every stage must end with:

``` text
STAGE: X
STATUS: COMPLETE / BLOCKED

Goal:
...

Implemented:
- ...
- ...

Files changed:
- ...

Files created:
- ...

Files intentionally not changed:
- ...

Database changes:
- ...

API changes:
- ...

Provider changes:
- ...

Tests:
- Unit:
- Integration:
- E2E:
- Typecheck:
- Lint:
- Build:

Real provider tests:
- Telnyx:
- Twilio:

Manual verification:
- ...

Environment variables:
- ...

Known limitations:
- ...

Out-of-scope check:
- PASS/FAIL

Migration verification:
- PASS/FAIL/N/A

Documentation updated:
- ...

Next authorized stage:
- ...

STOPPED AFTER THIS STAGE: YES
```

Never say `COMPLETE` when required validation failed.

------------------------------------------------------------------------

# 21. REAL PROVIDER TEST STATUS RULE

The agent must maintain separate status for:

``` text
AUTOMATED
MOCK
REAL TWILIO
REAL TELNYX
```

Example:

``` text
Sequential routing unit tests: PASS
Fake provider integration: PASS
Real Twilio: PASS
Real Telnyx: BLOCKED — number unavailable
```

This is acceptable and honest.

Never convert:

``` text
mock PASS
```

into:

``` text
Telnyx PASS
```

------------------------------------------------------------------------

# 22. ENVIRONMENT CONFIGURATION

Use environment variables.

Conceptually:

``` text
NODE_ENV

DATABASE_URL

SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY   # server only if required by chosen architecture

TELEPHONY_PRIMARY_PROVIDER=telnyx
TELEPHONY_DEV_PROVIDER=twilio

TELNYX_API_KEY
TELNYX_PUBLIC_KEY

TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_PHONE_NUMBER

RECORDING_STORAGE_*

BILLING_*
```

Exact variable names must be finalized from actual implementation.

Do not expose server-only secrets to the browser.

Do not commit `.env`.

------------------------------------------------------------------------

# 23. API DESIGN RULES

Use REST.

Every protected endpoint must:

1.  authenticate user/API key;
2.  resolve workspace;
3.  authorize access;
4.  validate input;
5.  execute domain operation;
6.  return a consistent response.

Never trust:

``` text
workspace_id
buyer_id
campaign_id
call_id
```

from a client without checking ownership/authorization.

------------------------------------------------------------------------

# 24. TELNYX WEBHOOK RULES

Provider webhook endpoint must be isolated.

Conceptually:

``` text
/api/webhooks/telnyx
```

The implementation must:

1.  receive raw request when required;
2.  verify signature using the current official method;
3.  identify event ID;
4.  check provider/event uniqueness;
5.  persist event;
6.  process safely;
7.  return appropriate acknowledgement;
8.  avoid duplicate business effects.

Do not trust arbitrary POST requests.

------------------------------------------------------------------------

# 25. TWILIO DEVELOPMENT RULES

Twilio is a development/validation provider.

It must:

-   implement the same internal provider contract;
-   normalize events into the same internal model;
-   remain outside core business logic;
-   be removable/replaced without rewriting routing.

Do not add Twilio-specific customer features.

------------------------------------------------------------------------

# 26. PHONE NUMBER RULES

A tracking number belongs to a provider and workspace.

An active tracking number must map unambiguously to a campaign.

Do not automatically release numbers.

Phone numbers must be normalized consistently.

The application must distinguish:

``` text
phone number
provider number ID
provider connection ID
```

Do not use a provider-specific database field name for generic concepts.

------------------------------------------------------------------------

# 27. RECORDING RULES

Recording is an MVP feature but deliberately comes after routing.

Recording must:

-   respect provider capabilities;
-   store metadata;
-   avoid public URLs;
-   enforce workspace authorization;
-   handle missing recording events;
-   tolerate provider recording failures;
-   avoid unnecessary file copying.

------------------------------------------------------------------------

# 28. OBSERVABILITY

Call-related structured logs should include where available:

``` text
workspace_id
call_id
provider
provider_call_id
provider_session_id
call_attempt_id
buyer_id
campaign_id
event_type
correlation_id
```

Never log:

-   passwords
-   provider API keys
-   auth secrets
-   webhook signing secrets
-   full payment credentials

------------------------------------------------------------------------

# 29. ERROR HANDLING

Handle at minimum:

``` text
provider unavailable
provider 4xx
provider 5xx
invalid webhook signature
duplicate webhook
unknown webhook
invalid buyer number
missing campaign
inactive campaign
no active buyers
caller blocked
database unavailable
recording unavailable
billing provider failure
customer webhook failure
```

Errors must be diagnosable without exposing secrets.

------------------------------------------------------------------------

# 30. CHANGE CONTROL

If the owner changes a requirement:

1.  Stop implementation if the change affects architecture.
2.  Update this specification or create an ADR.
3.  Identify affected stages.
4.  Identify database impact.
5.  Identify API impact.
6.  Identify migration impact.
7.  Identify test impact.
8.  Obtain owner authorization.
9.  Implement only the authorized change.

The agent must not silently reinterpret the product.

------------------------------------------------------------------------

# 31. UNCERTAINTY RULE

When something is unclear:

``` text
Is it specified?
 |
 ├─ YES → follow it
 |
 └─ NO
      |
      ├─ Required for current stage?
      │     |
      │     ├─ NO → do not add it
      │     |
      │     └─ YES
      │           |
      │           ├─ Official docs answer?
      │           │     ├─ YES → research + verify
      │           │     └─ NO → STOP and ask owner
```

No guessing.

------------------------------------------------------------------------

# 32. OFFICIAL RESEARCH SOURCES

These are starting points, not permission to use stale behavior.

## Telnyx

Current official documentation must be checked at implementation time
for:

-   Programmable Voice
-   Voice webhooks
-   Call Control
-   Dial
-   Answer
-   Hangup
-   Recording
-   Call tracking
-   Phone number provisioning

Use the current official Telnyx Developer documentation.

## Supabase

Use current official Supabase documentation for:

-   Auth
-   SSR/session handling
-   JWT verification
-   user management
-   authorization/RLS where applicable

Do not blindly copy old Supabase examples.

## Other providers

For billing or any additional provider, current official documentation
is mandatory before implementation.

------------------------------------------------------------------------

# 33. PRODUCT TERMINOLOGY

### Tracking number

An actual telephone number used to receive and track calls.

### Campaign

A routing configuration associated with one or more tracking numbers and
ordered buyers.

### Buyer

A business/entity receiving a call through one configured destination
number.

### Buyer priority

Campaign-specific order in which buyers are attempted.

### Call

The overall inbound caller interaction.

### Call attempt

One attempt to connect the caller to one buyer.

### Sequential fallback

Trying the next eligible buyer after the current buyer fails to
answer/connect.

### Blocked number

A caller number that must not reach any buyer.

### DNI

Dynamic Number Insertion. Not part of MVP 1.

### Visitor tracking

Website/session/source tracking. Not part of MVP 1.

------------------------------------------------------------------------

# 34. FINAL MVP 1 DEFINITION

MVP 1 is:

> A multi-tenant SaaS platform using Supabase Auth for authentication
> and Telnyx as the intended production telephony provider, with a
> provider-independent telephony architecture and a Twilio
> development/validation adapter. It provisions and manages tracking
> numbers, receives inbound calls, associates tracking numbers with
> campaigns, blocks unwanted callers, routes allowed calls to campaign
> buyers according to explicit priority, sequentially falls back when a
> buyer does not answer, records persistent call and attempt history,
> supports recording, reporting, usage metering, SaaS billing, customer
> APIs and webhooks, and enforces workspace isolation and roles.

MVP 1 does not include:

-   DNI
-   visitor tracking
-   marketing attribution
-   IVR
-   geographic routing
-   time routing
-   round robin
-   advanced routing
-   RTB
-   Ping/Post
-   white labeling
-   fraud detection
-   dispute management
-   buyer-internal routing
-   buyer employee management
-   CRM
-   SMS
-   AI voice agents
-   other unrequested integrations

------------------------------------------------------------------------

# 35. MOST IMPORTANT RULE --- DO NOT OVERBUILD

If the owner says:

> Build Stage 7

build Stage 7 only.

If Stage 7 reveals a dependency on Stage 6:

-   report it;
-   do not silently build Stage 6;
-   ask the owner to authorize the dependency if necessary.

If the owner says:

> Connect Telnyx

the agent must:

``` text
Research
→ Verify
→ Implement
→ Test
→ Report
→ Stop
```

If the Telnyx number is unavailable:

``` text
Do not fake a real test.
Do not mark it PASS.
Continue only with stages that do not require the resource.
```

------------------------------------------------------------------------

# 36. OWNER WORKFLOW

## First command

``` text
Read MVP1_BUILD_SPEC.md completely.

Do not build anything.

Inspect the repository and report:

1. repository structure
2. existing technologies
3. existing POC components
4. reusable POC components
5. current tests
6. current scripts
7. what is missing
8. blockers
9. exact proposed work for Stage 0

STOP after the report.
```

## Then

``` text
Build Stage 0 only according to MVP1_BUILD_SPEC.md.

Do not build Stage 1 or later.

Research only what Stage 0 requires.

Run the required validation.

Produce the Stage 0 completion report.

STOP.
```

Then:

``` text
Build Stage 1 only according to MVP1_BUILD_SPEC.md.
```

Continue one stage at a time.

------------------------------------------------------------------------

# 37. OWNER CONTROL CHECKLIST

Before authorizing a stage, the owner should know:

``` text
[ ] What this stage builds
[ ] What this stage explicitly does not build
[ ] What files may change
[ ] What external providers are involved
[ ] What tests are expected
[ ] Whether real credentials/resources are required
[ ] What constitutes PASS
[ ] What constitutes BLOCKED
```

After the stage:

``` text
[ ] Read completion report
[ ] Check files changed
[ ] Check tests
[ ] Check real-provider status
[ ] Check database changes
[ ] Check no out-of-scope work
[ ] Decide whether to authorize next stage
```

------------------------------------------------------------------------

# 38. END-OF-STAGE HARD STOP

Every stage must end with:

``` text
STAGE VALIDATION COMPLETE
REPORT GENERATED
NO FUTURE STAGE IMPLEMENTED
WAITING FOR OWNER AUTHORIZATION
```

The coding agent must stop.

------------------------------------------------------------------------

# END OF MVP 1 SPECIFICATION
