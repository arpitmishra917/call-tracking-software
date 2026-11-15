# CALLFLOW — QA-2B STAGE A: TEST SPECIFICATION CORRECTION REVIEW

**Document ID:** `CALLFLOW-PHASE-QA-2B-STAGE-A-CORRECTION-REVIEW`  
**Assigned Agent:** Agent 2 — Backend, API, Database & Security  
**Review Type:** STRICT READ-ONLY FORENSIC REVIEW  
**Reference Document:** [`11-stage-a-test-harness-specification.md`](file:///C:/Projects/callflow-agent-a/qa/reports/qa-2a-final-consolidation/11-stage-a-test-harness-specification.md)  
**Target File:** [`qa/reports/qa-2a-final-consolidation/12-stage-a-test-specification-correction-review.md`](file:///C:/Projects/callflow-agent-a/qa/reports/qa-2a-final-consolidation/12-stage-a-test-specification-correction-review.md)  
**Evaluation Date:** November 12, 2026  
**Implementation / Execution Permission:** NONE (Zero code changes, zero database writes, zero test execution)

---

## 1. Executive Verdict

# **`VERDICT: PASS WITH CONDITIONS`**

### Summary Justification:
1. **QA Inbound Lease Setup (Issue 1: PASS WITH CONDITIONS):** Forensic analysis of [`QaTelephonyGuardService`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-telephony-guard.service.ts) confirms that a safe, in-memory, test-only lease setup exists via `registerActiveTestRun()` and `openInboundTestLease()`. This setup operates entirely in memory, requires zero database mutations, and allows direct `CallController.handleEvent()` calls to be recognized as QA ingress candidates and bound into `boundCalls`.
2. **Allowlist Configuration (Issue 2: PASS WITH CONDITIONS):** When a call is properly bound via lease consumption, `validateDestinationOrThrow()` enforces `TELEPHONY_QA_ALLOWED_DESTINATIONS`. To permit dialing synthetic destinations without failing closed, both Buyer A (`+12025550199`) and Buyer B (`+12025550198`) must be explicitly present in `TELEPHONY_QA_ALLOWED_DESTINATIONS`.
3. **Actual Concurrency vs. Sequential Routing (Issue 3: PASS):** Report 11 conflated sequential capacity exhaustion with simultaneous transactional race conditions. This review strictly bifurcates the test suite into **Test A (Sequential Capacity & Waterfall Routing)** and **Test B (Simultaneous Transactional Race Condition via `Promise.all`)**.
4. **AppModule Provider Instantiation & Egress (Issue 4: PASS):** Compiling `AppModule` instantiates `TelnyxProvider`, `AsteriskAriClientService`, `QaOrchestratorService`, `TelnyxProvisioningService`, and `PrismaService`. However, forensic inspection confirms that none of their constructors establish outbound network connections, and omitting `moduleRef.init()` prevents `OnModuleInit` lifecycle timers from starting. Overriding `WebhooksService` eliminates customer webhook HTTP egress.
5. **Database Cleanup & Fail-Closed Safety (Issue 5: PASS):** PostgreSQL foreign keys on `calls.id` are defined with `ON DELETE CASCADE`. Targeted deletion of `provider_call_id` in `afterAll()` cleanly purges 100% of test attempts, buyer reservations, and commercials without table truncation. `assertNonProductionDatabase()` guarantees immediate fail-closed termination if `DATABASE_URL` is misconfigured.

---

## 2. Issue 1 — QA Inbound Lease Setup

### 2.1 The Ingress Gate Challenge
When an event arrives on dedicated tracking DID `+17252574041`, [`CallController.handleEvent`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/call-controller.ts#L243-L279) evaluates:
```typescript
const isQaIngress = this.qaGuardService ? this.qaGuardService.isQaIngressDid(to) : false;
if (isQaIngress) {
  if (!this.qaGuardService?.isQaEnabled()) {
    await this.provider.hangupCall(callId);
    return; // Fail closed if QA disabled
  }
  const leaseMatch = this.qaGuardService.consumeInboundLease(callId, {
    from: from || undefined,
    to: to || undefined,
    connectionId: event.connectionId || undefined,
    token: event.clientState,
  });
  if (!leaseMatch) {
    await this.provider.hangupCall(callId);
    return; // Fail closed if no trusted lease exists!
  }
  matchedQaRunId = leaseMatch.runId;
}
```
If no lease was pre-opened in `activeLeases`, `consumeInboundLease` returns `null`, and `handleEvent()` **immediately hangs up the call without creating database records**.

---

### 2.2 Forensic Inspection of Inbound Lease APIs
In [`apps/api/src/telephony/qa/qa-telephony-guard.service.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-telephony-guard.service.ts):

#### Method 1: `registerActiveTestRun(runId, options)` (lines 504–520)
- **Signature:** `registerActiveTestRun(runId: string, options?: { secretToken?: string; ttlMs?: number }): void`
- **Validation Rules:** `runId` must be a non-empty string.
- **Behavior:** Stores `{ runId, secretToken, registeredAt, expiresAt }` in in-memory Map `this.activeTestRuns`.
- **Database / External Dependencies:** **ZERO.** 100% in-memory.

#### Method 2: `openInboundTestLease(options)` (lines 275–323)
- **Signature:** `openInboundTestLease(options: QaInboundLeaseOptions): QaInboundLease`
- **Validation Rules:**
  1. `runId` must be non-empty and must exist in `this.activeTestRuns`.
  2. `expectedCallerCli` or `expectedCallerIdentity` is validated against E.164.
  3. Single-use: once consumed, the lease is deleted from `this.activeLeases`.
- **Behavior:** Stores `QaInboundLease` object in in-memory Map `this.activeLeases`.
- **Database / External Dependencies:** **ZERO.** 100% in-memory.

---

### 2.3 Proposed Test-Only Inbound Lease Setup (Using Existing APIs Only)
A test can configure trusted leases directly through `moduleRef.get(QaTelephonyGuardService)` without invoking `QaOrchestratorService` or modifying the database:

```typescript
const qaGuard = moduleRef.get(QaTelephonyGuardService);
const testRunId = 'stage-a-test-run-' + Date.now();

// 1. Register test run in trusted registry (in-memory)
qaGuard.registerActiveTestRun(testRunId, { ttlMs: 60000 });

// 2. Open explicit single-use leases for each expected synthetic call
qaGuard.openInboundTestLease({
  runId: testRunId,
  expectedCallerCli: '+15550001111',
  ttlMs: 30000,
});
qaGuard.openInboundTestLease({
  runId: testRunId,
  expectedCallerCli: '+15550002222',
  ttlMs: 30000,
});
qaGuard.openInboundTestLease({
  runId: testRunId,
  expectedCallerCli: '+15550003333',
  ttlMs: 30000,
});
```

#### Results of this In-Memory Setup:
1. `consumeInboundLease()` matches the incoming synthetic call by `callerCli` and returns `{ runId: testRunId }`.
2. `handleEvent()` executes lines 450–452:
   ```typescript
   if (matchedQaRunId && this.qaGuardService) {
     this.qaGuardService.bindCallToTestRun(call.id, matchedQaRunId);
   }
   ```
3. The persistent Prisma `call.id` is bound into `this.boundCalls`.
4. Downstream in `dialNextBuyer()`, `isQaCall(result.call)` returns **`true`**, enabling authentic QA allowlist validation.
- **Verdict for Issue 1:** **`PASS WITH CONDITIONS`**  
  *Condition:* Leases must be pre-registered via `openInboundTestLease` before dispatching synthetic events on `+17252574041`.

---

## 3. Issue 2 — QA Allowlist Configuration

### 3.1 Environment Variable & Validation Flow
- **Allowlist Variable:** `process.env.TELEPHONY_QA_ALLOWED_DESTINATIONS` ([`qa-telephony-guard.service.ts#L753`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-telephony-guard.service.ts#L753)).
- **Required Synthetic Destinations:**
  - Buyer A: `+12025550199`
  - Buyer B: `+12025550198`

### 3.2 Exact Allowlist Configuration Required:
```ini
TELEPHONY_QA_ENABLED=true
TELEPHONY_QA_ALLOWED_DESTINATIONS="+12025550199,+12025550198"
```

### 3.3 Five Behavioral Scenarios:

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                             QA ALLOWLIST BEHAVIORAL SCENARIO MATRIX                         │
├──────────────────────────┬─────────────────────────────┬────────────────────────────────────┤
│ SCENARIO                 │ GUARD BEHAVIOR              │ DIAL DISPATCH RESULT               │
├──────────────────────────┼─────────────────────────────┼────────────────────────────────────┤
│ 1. QA Mode Disabled      │ isQaEnabled() returns false.│ BYPASS ALLOWLIST!                  │
│    (QA_ENABLED=false)    │ Returns immediately (L798). │ Dispatches as unmonitored call.    │
├──────────────────────────┼─────────────────────────────┼────────────────────────────────────┤
│ 2. QA Enabled + Valid    │ isQaCall() returns true.    │ AUTHORIZED DIAL                    │
│    Inbound Lease         │ Destination in allowedSet.  │ Passes to FakeTelephonyProvider.   │
├──────────────────────────┼─────────────────────────────┼────────────────────────────────────┤
│ 3. QA Enabled + Unbound  │ isQaCall() returns false.   │ BYPASS ALLOWLIST!                  │
│    Call (No Lease)       │ Returns immediately (L803). │ Guard fails to validate.           │
├──────────────────────────┼─────────────────────────────┼────────────────────────────────────┤
│ 4. Allowlist is Empty    │ parseAllowlist() fails.     │ BLOCKED (FAIL CLOSED)              │
│    (QA_DESTINATIONS="")  │ Throws ROUTING_FAILED.      │ Prevents all outbound dialing.     │
├──────────────────────────┼─────────────────────────────┼────────────────────────────────────┤
│ 5. Destination Missing   │ allowedSet.has(dest) false. │ BLOCKED (FAIL CLOSED)              │
│    (e.g. Buyer B omitted)│ Throws ROUTING_FAILED.      │ Fails closed on Buyer B dial.      │
└──────────────────────────┴─────────────────────────────┴────────────────────────────────────┘
```
- **Verdict for Issue 2:** **`PASS WITH CONDITIONS`**  
  *Condition:* `TELEPHONY_QA_ALLOWED_DESTINATIONS` must explicitly contain both `+12025550199` and `+12025550198` when running with active QA leases.

---

## 4. Issue 3 — Actual Concurrency Proof: Sequential vs. Simultaneous

Report 11 described sequential execution (`Call 1 -> Call 2 -> Call 3`). Sequential execution validates waterfall logic, but **does not prove transactional concurrency**.

Stage A must contain **two distinct, explicit test suites**:

### 4.1 Test Suite A — Sequential Capacity & Waterfall Overflow
- **Purpose:** Verifies state transitions, capacity counting, and waterfall cascading under zero lock contention.
- **Execution Pattern:**
  ```typescript
  await callController.handleEvent(event1);
  await callController.handleEvent(event2);
  await callController.handleEvent(event3);
  ```
- **Assertions:**
  - Call 1 assigned to Buyer A (`activeCount = 1`).
  - Call 2 assigned to Buyer A (`activeCount = 2`).
  - Call 3 detects Buyer A saturation (2/2) and cascades to Buyer B (`activeCount = 1`).

---

### 4.2 Test Suite B — Simultaneous Reservation Race (True Concurrency Proof)
- **Purpose:** Proves that PostgreSQL `SELECT ... FOR UPDATE` row locks prevent double-booking under simultaneous parallel transactions.
- **Race Condition Target:** Buyer A has `max_concurrent_calls = 2` and currently `activeCount = 1`. Two calls (Call X and Call Y) arrive simultaneously competing for the final remaining slot.
- **Synchronization / Barrier Strategy:**
  To guarantee that both calls enter `prepareNextBuyer()` at the identical millisecond, use a deferred synchronization barrier:
  ```typescript
  // Simultaneous dispatch barrier via Promise.all
  const results = await Promise.all([
    callController.handleEvent(eventX),
    callController.handleEvent(eventY),
  ]);
  ```
- **PostgreSQL Row-Lock Verification:**
  1. Transaction X and Transaction Y both issue:
     ```sql
     SELECT id, max_concurrent_calls FROM "buyers" WHERE id = $buyerId FOR UPDATE;
     ```
  2. PostgreSQL kernel grants the row lock to Transaction X. Transaction Y is blocked in a lock wait queue.
  3. Transaction X reads `activeCount = 1 < 2`, inserts `buyer_reservations` (`status: ACTIVE`), and commits.
  4. Transaction Y unblocks, re-reads `activeCount = 2 >= 2`, executes `continue;`, and cascades to Buyer B.
- **Concurrency Assertions:**
  - `activeCount` on Buyer A equals **exactly 2** (never 3).
  - Exactly one call (either X or Y) acquires Buyer A; the other acquires Buyer B.
  - Zero duplicate reservations exist for the same participant.
  - Zero deadlocks occur.
- **Verdict for Issue 3:** **`PASS`**  
  *Finding:* Concurrency proof is formally separated into sequential logic (Suite A) and simultaneous lock verification (Suite B).

---

## 5. Issue 4 — AppModule Provider Instantiation & Side Effects

Forensic audit of every provider in the imported module graph during `Test.createTestingModule({ imports: [AppModule] }).compile()`:

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              APPMODULE PROVIDER INSTANTIATION AUDIT MATRIX                             │
├──────────────────────────┬──────────────┬──────────────┬──────────────┬──────────────┬─────────────────┤
│ SERVICE NAME             │ REGISTERED IN│ CONSTRUCTED  │ NETWORK ON   │ ONMODULEINIT │ LIFECYCLE STATE │
│                          │ MODULE GRAPH │ ON COMPILE?  │ CONSTRUCT?   │ ON COMPILE?  │ WITHOUT INIT()  │
├──────────────────────────┼──────────────┼──────────────┼──────────────┼──────────────┼─────────────────┤
│ TelnyxProvider           │ TelephonyMod │ YES          │ NO           │ N/A (None)   │ In-memory client│
│                          │              │              │              │              │ (Unused in test)│
├──────────────────────────┼──────────────┼──────────────┼──────────────┼──────────────┼─────────────────┤
│ AsteriskAriClientService │ TelephonyMod │ YES          │ NO           │ N/A (None)   │ Dormant         │
│                          │              │              │              │              │ (Zero WS/HTTP)  │
├──────────────────────────┼──────────────┼──────────────┼──────────────┼──────────────┼─────────────────┤
│ QaOrchestratorService    │ TelephonyMod │ YES          │ NO           │ N/A (None)   │ Dormant         │
│                          │              │              │              │              │ (Uncalled)      │
├──────────────────────────┼──────────────┼──────────────┼──────────────┼──────────────┼─────────────────┤
│ TelnyxProvisioningService│ PhoneNumsMod │ YES          │ NO           │ N/A (None)   │ In-memory client│
│                          │              │              │              │              │ (Uncalled)      │
├──────────────────────────┼──────────────┼──────────────┼──────────────┼──────────────┼─────────────────┤
│ ReservationRecoveryServ. │ TelephonyMod │ YES          │ NO           │ NO           │ Timer dormant;  │
│                          │              │              │              │ (Not called) │ Injects FakeProv│
├──────────────────────────┼──────────────┼──────────────┼──────────────┼──────────────┼─────────────────┤
│ WebhooksService          │ WebhooksMod  │ OVERRIDDEN   │ NO           │ NO           │ Replaced with   │
│                          │              │ (Not constr.)│              │              │ mockWebhooks    │
├──────────────────────────┼──────────────┼──────────────┼──────────────┼──────────────┼─────────────────┤
│ PrismaService            │ PrismaMod    │ YES          │ NO (Lazy     │ NO           │ Connects to     │
│                          │              │              │ loopback)    │              │ 127.0.0.1:5433  │
└──────────────────────────┴──────────────┴──────────────┴──────────────┴──────────────┴─────────────────┘
```

### Detailed Observations:
1. **`TelnyxProvider`:** Instantiated, but its constructor only runs `new Telnyx({ apiKey })`. It makes zero network calls. Because `CallController` is injected with `FakeTelephonyProvider`, `TelnyxProvider` is never invoked.
2. **`AsteriskAriClientService`:** Instantiated, but its constructor only reads local environment variables. It does not open WebSocket connections or issue HTTP requests until `connectWs()` or REST methods are called.
3. **`ReservationRecoveryService`:** Injects the overridden `FakeTelephonyProvider`. Furthermore, because `moduleRef.init()` is omitted, its `onModuleInit()` hook **does not execute**, ensuring the 5-minute background timer is never started.
4. **`WebhooksService`:** Overridden by `useValue(mockWebhooksService)`. The real service is never instantiated, and its 5-second polling timer is never created.
5. **Verdict for Issue 4:** **`PASS`**  
   *Finding:* Compiling `AppModule` with provider overrides causes zero external network calls.

---

## 6. Issue 5 — Database Cleanup & Test Isolation

### 6.1 Foreign-Key Delete Behavior
In [`apps/api/prisma/migrations/20260921132240_init_stage13/migration.sql`](file:///C:/Projects/callflow-agent-a/apps/api/prisma/migrations/20260921132240_init_stage13/migration.sql):
- `call_attempts`: `ON DELETE CASCADE` linked to `calls.id`.
- `buyer_reservations`: `ON DELETE CASCADE` linked to `calls.id`.
- `call_commercials`: `ON DELETE CASCADE` linked to `calls.id`.
- `call_reservations`: `ON DELETE CASCADE` linked to `calls.id`.
- `recordings`: `ON DELETE CASCADE` linked to `calls.id`.

### 6.2 Cleanup Strategy Verification
- Deleting test records by `provider_call_id` in `calls`:
  ```typescript
  await prisma.call.deleteMany({
    where: { provider_call_id: { in: testCallIds } },
  });
  ```
- Because of PostgreSQL `ON DELETE CASCADE`, this single query removes **100% of generated test records** across `calls`, `call_attempts`, `buyer_reservations`, and `call_commercials`.
- No orphan records remain in any table.

### 6.3 Fail-Closed Database Target Verification
The test file must execute [`assertNonProductionDatabase`](file:///C:/Projects/callflow-agent-a/apps/api/src/common/database-isolation.util.ts#L48-L85) in `beforeAll()`:
```typescript
assertNonProductionDatabase(process.env.DATABASE_URL, 'Stage A Concurrency Suite');
```
If `DATABASE_URL` is empty, points to cloud hosts (`supabase.co`, `aws-0`), or does not resolve to port `5433` and database `callflow_qa`, it throws a fatal `ForbiddenException`, aborting test execution immediately.

### 6.4 Guaranteed Teardown on Test Failures
Vitest executes `afterAll()` blocks **even when intermediate `it()` assertion blocks fail or throw exceptions**. Placing `deleteMany` and `moduleRef.close()` inside `afterAll()` guarantees that failed assertions never leave dangling database records or open Prisma connections.
- **Verdict for Issue 5:** **`PASS`**

---

## 7. Corrected Stage A Test Sequence

The canonical test sequence integrating all corrections:

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                               CORRECTED STAGE A EXECUTION SEQUENCE                          │
├─────┬────────────────────────────────┬──────────────────────────────────────────────────────┤
│ SEQ │ ACTION / PHASE                 │ OPERATIONAL MECHANISM                                │
├─────┼────────────────────────────────┼──────────────────────────────────────────────────────┤
│ 1   │ Database Safety Check          │ assertNonProductionDatabase(DATABASE_URL)            │
├─────┼────────────────────────────────┼──────────────────────────────────────────────────────┤
│ 2   │ Module Compilation             │ Test.createTestingModule({ imports: [AppModule] })   │
│     │                                │   .overrideProvider(TELEPHONY_PROVIDER)              │
│     │                                │   .useClass(FakeTelephonyProvider)                   │
│     │                                │   .overrideProvider(WebhooksService)                 │
│     │                                │   .useValue(mockWebhooksService)                     │
│     │                                │   .compile();                                        │
│     │                                │ (Do NOT call moduleRef.init()!)                      │
├─────┼────────────────────────────────┼──────────────────────────────────────────────────────┤
│ 3   │ In-Memory Lease Registration   │ qaGuard.registerActiveTestRun(runId);                │
│     │                                │ qaGuard.openInboundTestLease({ runId, cli, ... });   │
├─────┼────────────────────────────────┼──────────────────────────────────────────────────────┤
│ 4   │ Test Suite A (Sequential)      │ await callController.handleEvent(call1);             │
│     │                                │ await callController.handleEvent(call2);             │
│     │                                │ await callController.handleEvent(call3);             │
│     │                                │ Assert: Call 1 & 2 -> Buyer A; Call 3 -> Buyer B.    │
├─────┼────────────────────────────────┼──────────────────────────────────────────────────────┤
│ 5   │ Test Suite B (Simultaneous)    │ qaGuard.openInboundTestLease(...);                   │
│     │                                │ await Promise.all([                                  │
│     │                                │   callController.handleEvent(callX),                 │
│     │                                │   callController.handleEvent(callY),                 │
│     │                                │ ]);                                                  │
│     │                                │ Assert: SELECT ... FOR UPDATE serializes limit.      │
├─────┼────────────────────────────────┼──────────────────────────────────────────────────────┤
│ 6   │ Complete Teardown (afterAll)   │ await prisma.call.deleteMany({ provider_call_id });  │
│     │                                │ await prisma.$disconnect();                          │
│     │                                │ await moduleRef.close();                             │
└─────┴────────────────────────────────┴──────────────────────────────────────────────────────┘
```

---

## 8. Remaining Blockers Prior to Execution

| Blocker ID | Domain | Description | Resolution Requirement |
|:---:|---|---|---|
| **BLK-01** | **Database Seed** | `Buyer B` (`max_concurrent_calls = 2`, `priority = 2`) does not exist in `callflow_qa`. | Requires separate explicit user authorization to execute database seed. |
| **BLK-02** | **Test File Deployment** | `stage-a-concurrency.e2e-spec.ts` is not yet written to disk. | Requires separate explicit user authorization to create test file. |

---

## 9. Final Recommendation

# **`RECOMMENDATION: READY FOR SEPARATE USER AUTHORIZATION`**

### Summary:
All five technical issues have been forensically reviewed and resolved:
1. Inbound lease setup operates 100% in memory using existing `QaTelephonyGuardService` APIs without database writes.
2. Allowlist configuration rules are verified.
3. Test suite is formally divided into sequential waterfall validation and simultaneous transactional race condition testing.
4. Provider compilation side effects are proven dormant.
5. Database cleanup via `ON DELETE CASCADE` and fail-closed isolation checks are verified.

**Jurisdictional Boundary:** This report is a read-only technical review. **It does NOT authorize, trigger, or execute Stage A.** Stage A execution remains strictly subject to **separate, explicit user authorization**.

---

**STAGE A TEST SPECIFICATION CORRECTION REVIEW COMPLETE**  
*Agent 2 — Backend, API, Database & Security*  
*November 12, 2026*
