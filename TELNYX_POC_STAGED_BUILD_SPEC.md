# TELNYX POC — STAGED AI CODING AGENT BUILD SPECIFICATION

## Document Purpose

This document replaces the single-shot Telnyx POC build approach with a controlled, staged workflow.

The objective is to reduce AI-agent hallucination, prevent premature architecture decisions, and validate Telnyx behavior with evidence before the full MVP is built.

The POC is NOT the production SaaS.

The only purpose of this POC is to answer:

> Can our platform reliably receive a Telnyx inbound call, control that call, and keep the caller in the same call flow while sequentially attempting Buyer A and then Buyer B when Buyer A does not answer?

The agent must work one stage at a time.

The owner must explicitly authorize each build stage.

NEVER automatically continue to the next stage.

---

# 1. NON-NEGOTIABLE AGENT RULES

You are an AI coding agent.

These rules apply to every stage.

1. Inspect the existing repository before making architecture changes.
2. Do not replace an existing technology stack without a documented reason and owner approval.
3. Do not invent Telnyx APIs, SDK methods, webhook events, parameters, request bodies, response fields, or call-control behavior.
4. Before implementing provider-specific behavior, consult the current official Telnyx Developer documentation.
5. If current official Telnyx documentation conflicts with this document, current official Telnyx documentation wins for provider-specific implementation details.
6. Product behavior stated in this document is authoritative unless the owner explicitly changes it.
7. If a required Telnyx behavior cannot be verified, STOP and report the blocker.
8. Do not guess when provider behavior is unclear.
9. Do not expose Telnyx API keys in frontend/browser code.
10. Never commit real secrets.
11. Use environment variables and `.env.example`.
12. Never print full secrets in logs.
13. Keep Telnyx-specific implementation behind a small provider boundary where practical.
14. Keep routing/business logic testable without a live Telnyx account.
15. Add automated tests for logic introduced in the current stage.
16. Do not build features belonging to later stages.
17. Do not refactor unrelated parts of the repository merely for style.
18. Do not claim a feature works unless it was actually verified.
19. Clearly distinguish:
   - VERIFIED
   - AUTOMATED TEST PASS
   - MOCK TEST PASS
   - REAL TELNYX TEST PASS
   - BLOCKED
   - UNKNOWN
20. At the end of every stage:
   - run relevant tests
   - run typecheck if applicable
   - run lint if applicable
   - run build if applicable
   - document results
   - report changes
   - STOP
21. The owner decides whether the next stage begins.

---

# 2. ANTI-HALLUCINATION PROTOCOL

For every Telnyx-specific implementation, follow:

```text
OFFICIAL TELNYX DOCUMENTATION
        ↓
VERIFY CURRENT API/EVENT
        ↓
IDENTIFY EXACT REQUEST/RESPONSE
        ↓
IMPLEMENT MINIMAL CODE
        ↓
AUTOMATED/MOCK TEST
        ↓
REAL TELNYX TEST WHEN AVAILABLE
        ↓
DOCUMENT ACTUAL RESULT
```

Never use:

```text
MEMORY / GUESS
      ↓
CODE
      ↓
ASSUME IT WORKS
```

If documentation is ambiguous:

1. Stop implementation of that behavior.
2. State exactly what is unclear.
3. Identify the relevant official documentation.
4. If possible, create a minimal isolated proof rather than changing the production architecture.
5. Wait for owner direction if the ambiguity affects architecture.

---

# 3. STAGE CONTROL MODEL

The complete POC has five stages:

```text
STAGE 0
Research + Repository Inspection
        ↓
OWNER APPROVAL
        ↓
STAGE 1
Telnyx API + Webhook Foundation
        ↓
OWNER APPROVAL
        ↓
STAGE 2
Single Inbound Call + Buyer A
        ↓
OWNER APPROVAL
        ↓
STAGE 3
Sequential A → B Routing
        ↓
OWNER APPROVAL
        ↓
STAGE 4
Recording + Final Validation + Findings
        ↓
STOP
```

Each stage is independently reviewable.

A later stage must not be started simply because an earlier stage succeeded.

---

# 4. STAGE 0 — RESEARCH AND REPOSITORY INSPECTION

## Objective

Understand the repository and verify the current Telnyx documentation before writing code.

## Build permission

NONE.

This stage is inspection/research only.

## Agent command

Use:

```text
Read TELNYX_POC_STAGED_BUILD_SPEC.md completely.

Execute STAGE 0 only.

Do not write or modify code.

Inspect the repository and current official Telnyx documentation.

Report:
1. Repository structure
2. Existing frontend technology
3. Existing backend technology
4. Existing database
5. Existing package manager
6. Existing test framework
7. Existing environment configuration
8. Existing Docker/local development setup
9. Whether a backend suitable for Telnyx webhooks already exists
10. Relevant existing abstractions that should be reused
11. Files that would need to be created/changed for Stage 1
12. Current official Telnyx documentation relevant to Stage 1
13. Exact provider operations/events that appear verified
14. Any ambiguities or blockers
15. Recommended minimal implementation approach

Do not modify files.

STOP after the report.
```

## Required research

Verify current official Telnyx documentation for at least:

- Programmable Voice getting started
- Voice API webhooks
- Sending Call Control commands
- Call tracking/inbound call handling
- Authentication
- Webhook authenticity/signature verification
- Relevant event identifiers

Starting references from the original POC specification may be used as navigation, but the agent must verify that they are current.

## Required output

The agent should produce a report only.

Suggested report:

```text
TELNYX POC STAGE 0 REPORT

Repository:
...

Stack:
...

Existing backend:
...

Existing frontend:
...

Database:
...

Tests:
...

Telnyx documentation checked:
...

Verified provider behavior:
...

Unverified behavior:
...

Blockers:
...

Recommended Stage 1 approach:
...

Files expected to change:
...

STATUS: READY / BLOCKED
```

## Acceptance criteria

Stage 0 passes only when:

- Repository has been inspected.
- Current Telnyx documentation has been checked.
- No code was changed.
- Provider assumptions are explicitly separated from verified behavior.
- Blockers are reported.
- Minimal Stage 1 plan is clear.

Then STOP.

---

# 5. STAGE 1 — TELNYX API AND WEBHOOK FOUNDATION

## Objective

Prove that the backend can securely communicate with Telnyx and receive/process Telnyx webhook events.

Do NOT implement buyer routing.

Do NOT implement A → B fallback.

## Scope

Implement only:

- Telnyx API authentication
- Environment configuration
- `.env.example`
- Minimal Telnyx provider boundary
- Telnyx webhook endpoint
- Current documented webhook authenticity verification
- Provider event ID extraction
- Idempotency handling
- Safe handling of duplicate events
- Basic structured logging
- Minimal persistence if required
- Automated webhook tests

## Explicitly NOT in Stage 1

Do not build:

- Buyer A routing
- Buyer B routing
- Campaigns
- Buyer CRUD
- Sequential fallback
- Call Flow Builder
- IVR
- DNI
- Number pools
- Billing
- SaaS dashboard
- Multi-tenancy
- Customer API
- Customer webhooks
- Reporting
- Recording workflow unless strictly required to prove webhook infrastructure

## Agent command

```text
Execute STAGE 1 of TELNYX_POC_STAGED_BUILD_SPEC.md only.

Before implementing any Telnyx-specific behavior, verify the current official Telnyx documentation.

Build only the Stage 1 scope.

Do not implement buyer routing or A → B fallback.

Use the existing repository architecture where appropriate.

Do not invent provider APIs or event names.

Add automated tests for:
1. Valid webhook
2. Invalid signature
3. Duplicate webhook
4. Unknown event
5. Malformed request

Run relevant tests, typecheck, lint, and build if available.

Document:
- Telnyx documentation checked
- Exact API/event behavior used
- Files changed
- Tests run
- Test results
- Known limitations
- Blockers

Do not continue to Stage 2.

STOP after the Stage 1 report.
```

## Acceptance criteria

Stage 1 is successful only if:

- API credentials are securely configured.
- API key is never exposed to browser code.
- Webhook endpoint exists.
- Authenticity verification follows current Telnyx documentation.
- Invalid webhook requests are rejected safely.
- Duplicate provider events are handled idempotently.
- Unknown events do not corrupt state.
- Automated tests pass.
- No Stage 2/3 functionality was added.

Then STOP.

---

# 6. STAGE 2 — SINGLE INBOUND CALL AND BUYER A

## Objective

Prove the basic call-control path before introducing fallback complexity.

The system should handle one inbound caller and one configured test buyer.

## Target flow

```text
Caller
  ↓
Telnyx Number
  ↓
Webhook
  ↓
POC Backend
  ↓
Answer / control inbound call
  ↓
Buyer A
  ↓
A answers
  ↓
Caller ↔ Buyer A
```

## Scope

Implement/verify:

- Incoming call detection
- Inbound call identification
- Call state
- Basic call answering/control
- Buyer A destination configuration
- Dialing Buyer A
- Buyer A answer handling
- Connecting/bridging caller and Buyer A according to verified Telnyx behavior
- Caller hangup handling
- Basic call completion
- Call lifecycle logs
- Automated tests using a fake provider
- Real Telnyx test when credentials/numbers are available

## Call model

Keep the concepts of:

```text
CALL
```

and

```text
ATTEMPT
```

separate even though Stage 2 has only Buyer A.

Example:

```text
Call: CALL-1001

Attempt:
Buyer A
result = ANSWERED
```

## Explicitly NOT in Stage 2

Do not implement:

- Buyer B fallback
- Sequential routing
- Campaigns
- Buyer management UI
- Buyer priorities in database
- Round robin
- Geographic routing
- Time routing
- IVR
- DNI
- Billing
- SaaS dashboard
- Customer API

## Agent command

```text
Execute STAGE 2 of TELNYX_POC_STAGED_BUILD_SPEC.md only.

First verify the current official Telnyx documentation for the exact inbound call-control flow.

Do not assume webhook names, command names, event ordering, or response fields.

Implement the smallest possible single-buyer call flow.

Flow required:
Caller → Telnyx Number → Backend → Answer/Control → Buyer A → A answers → Caller connected to A.

Implement caller hangup handling.

Do NOT implement Buyer B or sequential fallback.

Use a fake/mock telephony provider for automated tests.

If real Telnyx credentials and numbers are available, run the minimum real test.

Do not claim real functionality unless actually tested.

Run relevant tests, typecheck, lint, and build if available.

Document:
- Exact Telnyx commands/events verified
- Actual event sequence observed
- Files changed
- Automated test results
- Real Telnyx test results
- Known limitations
- Blockers

STOP after the Stage 2 report.
```

## Acceptance criteria

Stage 2 passes when:

- Inbound call is recognized.
- Backend can control it using verified Telnyx behavior.
- Buyer A can be attempted.
- Buyer A can answer.
- Caller can connect to Buyer A.
- Caller hangup is safely handled.
- Automated tests pass.
- Real Telnyx test is PASS or explicitly BLOCKED.
- No Buyer B fallback exists yet.

Then STOP.

---

# 7. STAGE 3 — SEQUENTIAL BUYER A → B ROUTING

## Objective

This is the most important stage.

Prove that the caller remains in the same platform-controlled call flow while Buyer A is attempted first and Buyer B is attempted only when A does not answer/fails according to verified provider behavior.

## Required behavior

### Scenario A — A answers

```text
Caller
 ↓
A
 ↓
A answers
 ↓
Caller ↔ A

B is NEVER attempted.
```

### Scenario B — A does not answer

```text
Caller
 ↓
A
 ↓
Timeout / verified no-answer result
 ↓
B
 ↓
B answers
 ↓
Caller ↔ B
```

### Scenario C — A and B fail

```text
Caller
 ↓
A
 ↓
failure
 ↓
B
 ↓
failure
 ↓
No buyer
 ↓
Safe call termination
```

### Scenario D — Caller hangs up during A

```text
Caller hangs up
 ↓
Stop routing
 ↓
Do NOT attempt B
```

### Scenario E — Answer vs timeout race

If A answers near the timeout boundary:

```text
Exactly ONE terminal outcome
```

Never:

```text
A connected
AND
B dialed
```

## Same-call requirement

Fallback must NOT be implemented as:

```text
Caller calls
 ↓
Platform hangs up
 ↓
Platform calls caller again
```

The intended behavior is:

```text
One continuous caller call
        ↓
Platform call control
        ↓
Buyer A attempt
        ↓
A fails/no-answer
        ↓
Buyer B attempt
```

The exact implementation must be based on current Telnyx documentation and real verification.

## Scope

Implement:

- Explicit call state machine
- Call vs attempt model
- Buyer A priority 1
- Buyer B priority 2
- Sequential attempt logic
- Ring timeout
- No-answer handling
- Buyer failure handling where verified
- Caller hangup cancellation
- Same-call fallback
- Concurrency protection
- Atomic/transactional winner selection
- Duplicate webhook safety
- Fake telephony provider
- Automated tests
- Real Telnyx test when available

## Suggested state model

```text
RECEIVED
  ↓
ANSWERING
  ↓
ROUTING
  ↓
RINGING_A
  ├── A_ANSWERED → CONNECTED_A
  ├── A_NO_ANSWER → RINGING_B
  ├── A_FAILED → RINGING_B
  └── CALLER_HUNG_UP → COMPLETED

RINGING_B
  ├── B_ANSWERED → CONNECTED_B
  ├── B_NO_ANSWER → NO_BUYER
  ├── B_FAILED → NO_BUYER
  └── CALLER_HUNG_UP → COMPLETED
```

Refine the exact states based on verified Telnyx event semantics.

Do not assume provider event ordering.

## Agent command

```text
Execute STAGE 3 of TELNYX_POC_STAGED_BUILD_SPEC.md only.

This stage introduces sequential Buyer A → Buyer B fallback.

Before coding, verify the exact current Telnyx call-control behavior required for:
- dialing
- answer
- call connection/bridging
- call progress
- timeout/no-answer
- buyer failure
- caller hangup
- relevant asynchronous events

Do not invent provider behavior.

Implement the smallest state-machine-based routing engine.

Required behavior:
1. A answers → connect A and NEVER attempt B.
2. A no-answer/verified failure → attempt B.
3. B answers → connect B.
4. A and B fail → end safely.
5. Caller hangs up during A → stop routing and NEVER attempt B.
6. A answer vs timeout race → exactly one winner.
7. Duplicate webhooks → no duplicate routing.
8. All fallback attempts remain part of the same inbound call flow.

Use a fake telephony provider for normal automated tests.

Add tests for every scenario above.

Add concurrency/race tests.

If real Telnyx credentials and test numbers are available, perform real tests for:
- A answer
- A no-answer → B answer
- caller hangup
- duplicate webhook behavior where reproducible
- timeout/answer race where reproducible

Do not claim real behavior unless tested.

Run tests, typecheck, lint, and build if available.

Document the actual verified call-control sequence.

Do not implement Stage 4.

STOP after the Stage 3 report.
```

## Acceptance criteria

Stage 3 passes only when:

- A is always attempted before B.
- A answer prevents B from being attempted.
- A no-answer/failure can cause B to be attempted.
- B can answer and receive the caller.
- Caller remains in the same call flow.
- Caller hangup prevents unnecessary fallback.
- A/B race has exactly one winner.
- Duplicate webhooks are safe.
- Automated routing tests pass.
- Real Telnyx tests are PASS or clearly BLOCKED.
- Actual provider behavior is documented.

Then STOP.

---

# 8. STAGE 4 — RECORDING, FINAL VALIDATION AND FINDINGS

## Objective

Finish the isolated POC without turning it into the production SaaS.

## Scope

Implement/verify:

- Optional recording behavior
- Recording event handling
- Recording metadata logging
- Final structured logs
- Full POC test matrix
- Real Telnyx validation
- Setup documentation
- Findings document
- MVP handoff recommendations

Recording is secondary.

If recording creates unnecessary complexity, isolate it and clearly mark it as optional or blocked.

## Required documentation

Create/update:

```text
docs/telnyx-poc-setup.md
docs/telnyx-poc-test-results.md
docs/telnyx-poc-findings.md
```

## Findings must contain

### 1. Telnyx operations verified

For each:

```text
Operation:
Official documentation:
Date checked:
SDK/API method actually used:
Authentication:
Important parameters:
Important response fields:
Observed result:
```

### 2. Webhook events verified

```text
Event:
When observed:
Relevant fields:
How our system handles it:
```

### 3. Actual call-control sequence

Document only what was actually verified.

Do NOT write a hypothetical sequence.

### 4. Fallback behavior

Document exactly how:

```text
A timeout/failure
        ↓
B attempt
```

was implemented.

### 5. Problems encountered

Include:

- provider limitations
- timing issues
- webhook issues
- configuration issues
- SDK issues
- unexpected behavior
- architecture concerns for MVP

### 6. MVP recommendations

```text
Safe to proceed: YES / NO

Recommended MVP changes:
...

Open risks:
...
```

## Final test matrix

```text
| Test | Expected | Result |
|---|---|---|
| Webhook received | Event received | |
| Signature valid | Accepted | |
| Invalid signature | Rejected | |
| Duplicate event | Processed once | |
| Incoming call | Recognized | |
| Call answered | Successful | |
| Buyer A answers | A connected | |
| A no-answer | B attempted | |
| A no-answer + B answers | B connected | |
| A+B fail | No buyer | |
| Caller hangs up | Routing stops | |
| A answer/timeout race | One winner | |
| Recording | Verified if tested | |
```

Never mark a test PASS unless it was actually executed.

## Agent command

```text
Execute STAGE 4 of TELNYX_POC_STAGED_BUILD_SPEC.md only.

Complete the isolated Telnyx POC.

Verify recording only if it can be tested cleanly without delaying or destabilizing the core call-control validation.

Run the complete automated test suite.

Run final real Telnyx tests if credentials, numbers, and required webhook configuration are available.

Create/update:
- docs/telnyx-poc-setup.md
- docs/telnyx-poc-test-results.md
- docs/telnyx-poc-findings.md

Document only verified provider behavior.

Clearly label PASS, FAIL, BLOCKED, and UNKNOWN.

Do not begin the full MVP.

Do not implement SaaS features.

Do not modify the MVP build specification automatically.

Provide:
1. POC status
2. Verified behavior
3. Real Telnyx tests
4. Automated tests
5. Actual call-control sequence
6. A → B fallback result
7. Known limitations
8. Recommended MVP changes
9. Files created/changed
10. Open risks

STOP permanently after the final report.
```

---

# 9. GLOBAL OUT-OF-SCOPE LIST

The following are NOT part of this Telnyx POC:

- User registration
- Authentication UI
- Multi-tenant workspaces
- Campaigns
- Buyer CRUD
- SaaS dashboard
- Billing
- Subscription plans
- Customer API
- Customer webhooks
- Reporting dashboard
- Marketing attribution
- Google Ads integration
- Meta integration
- DNI
- Website visitor tracking
- Number pools
- IVR
- DTMF menus
- Geographic routing
- Business-hours routing
- Round robin
- Skill routing
- RTB
- Ping/Post
- Lead marketplace
- Fraud detection
- Dispute management
- White labeling
- CRM integrations
- SMS
- Email
- AI voice agents
- Call transcription
- Sentiment analysis
- Buyer employee management
- Buyer internal routing

If any out-of-scope feature appears technically necessary, STOP and report why.

Do not silently add it.

---

# 10. POC ARCHITECTURE PRINCIPLE

Use the smallest architecture that reliably validates the telephony behavior.

Conceptually:

```text
Caller
   ↓
Telnyx
   ↓
POC Backend
   ├── Webhook Handler
   ├── Call Controller
   ├── Routing Engine
   └── State Store
   ↓
Telnyx Provider
```

Keep provider-specific code behind:

```text
RoutingEngine
      ↓
TelephonyProvider
      ↓
TelnyxProvider
      ↓
Telnyx API
```

The exact class/function names are implementation details.

Do not force this conceptual architecture onto an existing repository if its existing architecture provides an equally safe or better boundary.

---

# 11. FAKE TELEPHONY PROVIDER

The routing engine must be testable without a live Telnyx account.

The fake provider should be able to simulate the minimum behaviors needed by the current stage, including where relevant:

```text
answer
dial
buyer answers
buyer no-answer
buyer busy
buyer fails
caller hangs up
timeout
recording
```

Normal automated tests must not depend on a live Telnyx account.

---

# 12. LOGGING REQUIREMENTS

Structured logs should include, where available:

```text
timestamp
call_id
provider_call_control_id
provider_call_session_id
event_type
attempt_id
buyer
destination
state_before
state_after
```

Example:

```text
CALL_RECEIVED
call_id=abc123

BUYER_ATTEMPT_STARTED
call_id=abc123
buyer=A
sequence=1

BUYER_NO_ANSWER
call_id=abc123
buyer=A

BUYER_ATTEMPT_STARTED
call_id=abc123
buyer=B
sequence=2

BUYER_ANSWERED
call_id=abc123
buyer=B

CALL_CONNECTED
call_id=abc123
final_buyer=B
```

Never log:

- API keys
- passwords
- webhook secrets
- full credential values

---

# 13. SECURITY REQUIREMENTS

Telnyx credentials must remain server-side.

Use environment configuration.

Example:

```text
TELNYX_API_KEY=...
```

Provide:

```text
.env.example
```

Never commit real credentials.

Never expose the API key in frontend code.

Never print complete secrets in logs.

Webhook authenticity must be verified according to current official Telnyx documentation.

---

# 14. DEFINITION OF VERIFIED

The agent must use these definitions:

## VERIFIED

The behavior was confirmed from current official documentation and/or successfully observed in a real provider test.

## AUTOMATED TEST PASS

A test passed against the local implementation/fake provider.

This does NOT by itself prove Telnyx works.

## MOCK TEST PASS

The application logic works against the provider abstraction/mock.

This does NOT by itself prove live Telnyx behavior.

## REAL TELNYX TEST PASS

The behavior was actually executed against Telnyx with valid credentials/configuration.

## BLOCKED

A required verification could not be performed because of a concrete dependency or provider limitation.

## UNKNOWN

The behavior remains unresolved.

UNKNOWN must never be silently converted to PASS.

---

# 15. FINAL POC SUCCESS CRITERIA

The POC is successful when the following have been established with evidence:

### Technical

- Telnyx authentication works.
- Webhook reaches backend.
- Webhook authenticity is verified.
- Duplicate events are safely handled.
- Incoming call is recognized.
- Backend can control the call.
- Buyer A can be dialed.
- Buyer B can be dialed.
- Caller can remain in one continuous call flow.
- A → B sequential fallback works.
- Caller hangup stops routing.
- A answer/timeout race cannot create two winners.
- Logs explain the call lifecycle.

### Automated

- Routing tests pass.
- Webhook tests pass.
- Concurrency/race test passes.
- Typecheck passes if available.
- Lint passes if available.
- Build passes if available.

### Real-world

If credentials and test numbers are available:

- Real inbound call tested.
- Real A-answer path tested.
- Real A-no-answer → B-answer path tested.
- Caller hangup tested.

If a real test cannot be performed:

```text
REAL TELNYX TEST: BLOCKED
```

Do not call the POC complete as a real-world validation unless the limitation is clearly stated.

---

# 16. WHAT THIS POC DOES NOT PROVE

This POC does NOT prove:

- multi-tenancy
- billing
- customer API
- production scaling
- customer onboarding
- campaign management
- production reporting
- production recording storage
- production-grade monitoring
- number inventory management at SaaS scale
- complete production security posture

It only validates the Telnyx telephony foundation needed by the MVP.

---

# 17. HANDOFF TO FULL MVP

The POC must NOT automatically modify the full MVP build specification.

After Stage 4, produce a handoff:

```text
TELNYX POC STATUS:
COMPLETE / BLOCKED

VERIFIED:
- ...

AUTOMATED TESTS:
- ...

MOCK TESTS:
- ...

REAL TELNYX TESTS:
- ...

ACTUAL CALL-CONTROL SEQUENCE:
- ...

A → B FALLBACK:
PASS / FAIL / BLOCKED

KNOWN LIMITATIONS:
- ...

PROVIDER-SPECIFIC CHANGES REQUIRED FOR MVP:
- ...

MVP ARCHITECTURE RECOMMENDATIONS:
- ...

OPEN RISKS:
- ...

FILES CREATED/CHANGED:
- ...

NEXT RECOMMENDED ACTION:
Review POC findings before starting the full MVP.
```

The owner will decide what happens next.

---

# 18. OWNER WORKFLOW

Use these commands in order.

## First

```text
Read TELNYX_POC_STAGED_BUILD_SPEC.md completely.

Execute STAGE 0 only.

Do not modify anything.

STOP after the report.
```

Review the agent's report.

## Then

```text
Execute STAGE 1 only.
```

Review the result.

## Then

```text
Execute STAGE 2 only.
```

Review the result.

## Then

```text
Execute STAGE 3 only.
```

Review the result carefully.

This is the most important stage.

## Finally

```text
Execute STAGE 4 only.
```

Then:

```text
Show me the complete Telnyx POC findings and stop permanently.
```

---

# 19. OWNER REVIEW CHECKLIST

Before authorizing each next stage, verify:

```text
[ ] Agent stayed within scope
[ ] No unexplained files changed
[ ] No invented Telnyx behavior
[ ] Official documentation was checked
[ ] Tests actually ran
[ ] Failures are reported honestly
[ ] Secrets were not exposed
[ ] No later-stage features were added
[ ] Provider assumptions are documented
[ ] Blockers are explicit
```

If any important item is questionable:

```text
DO NOT AUTHORIZE THE NEXT STAGE.
```

Ask the agent to investigate the specific issue first.

---

# 20. MOST IMPORTANT RULE

The POC is not successful because the agent produced a lot of code.

The POC is successful only if it produces evidence.

The desired sequence is:

```text
Research
   ↓
Verify
   ↓
Implement minimally
   ↓
Test
   ↓
Observe
   ↓
Document
   ↓
STOP
```

Never:

```text
Guess
   ↓
Build a large system
   ↓
Assume provider behavior
   ↓
Claim success
```

The purpose of the staged process is to make wrong assumptions cheap to detect and easy to correct.

---

# END
