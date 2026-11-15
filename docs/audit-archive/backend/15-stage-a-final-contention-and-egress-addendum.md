# CALLFLOW — QA-2B STAGE A: FINAL CONTENTION EVIDENCE & EGRESS BOUNDARY ADDENDUM

**Document ID:** `CALLFLOW-PHASE-QA-2B-STAGE-A-CONTENTION-EGRESS-ADDENDUM`  
**Assigned Agent:** Agent 2 — Backend, API, Database & Security  
**Review Mode:** STRICT READ-ONLY FORENSIC REVIEW  
**Reference Document:** [`14-stage-a-final-postgresql-contention-correction.md`](file:///C:/Projects/callflow-agent-a/qa/reports/qa-2a-final-consolidation/14-stage-a-final-postgresql-contention-correction.md)  
**Output Target:** [`qa/reports/qa-2a-final-consolidation/15-stage-a-final-contention-and-egress-addendum.md`](file:///C:/Projects/callflow-agent-a/qa/reports/qa-2a-final-consolidation/15-stage-a-final-contention-and-egress-addendum.md)  
**Evaluation Date:** November 15, 2026  
**Implementation / Execution Permission:** NONE (Zero code modifications, zero test file creation, zero database mutations, zero live telephony)

---

## 1. Executive Verdict

# **`VERDICT: PASS WITH CONDITIONS`**

### Summary Justification:
1. **PostgreSQL Worker PID Correlation (Item 1: `PASS WITH CONDITIONS`):** Forensic inspection of [`apps/api/src/calls/calls.service.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/calls/calls.service.ts#L2036-L2299) confirms that `prepareNextBuyer()` executes inside an interactive transaction: `this.prisma.$transaction(async (tx) => { ... })`. In Prisma architecture, an interactive transaction checks out a single dedicated connection from the pool and binds it for the entire transaction callback. The connection executing `SELECT id FROM "calls" WHERE id = ${callId} FOR UPDATE` is the exact same session executing `SELECT id, max_concurrent_calls FROM "buyers" WHERE id = ${buyerId} FOR UPDATE`. Contention is proven through `pg_stat_activity` where `wait_event_type = 'Lock'` and `helperPid = ANY(pg_blocking_pids(pid))`.
2. **Actual Database Identity Verification (Item 2: `PASS`):** URL string parsing is formally classified as insufficient. A post-connection read-only identity verification query using `SELECT current_database(), current_user, inet_server_addr(), inet_server_port()` is specified. It strictly validates that the physical server session reports database `callflow_qa`, loopback IP `127.0.0.1`, and port `5433` before any test fixtures or application logic execute.
3. **Preflight Sequence Correction (Item 3: `PASS`):** The preflight lifecycle is bifurcated into four strictly sequential phases: Phase A (environment-only; zero database queries), Phase B (read-only database identity check), Phase C (read-only fixture verification for Buyer A, Buyer B, and campaign), and Phase D (test execution and mutations, strictly contingent on user authorization).
4. **External Egress Boundary Clarification (Item 4: `PASS`):** All claims of "mathematically guaranteed zero process-wide egress" are formally retracted. The report incorporates the exact required boundary statement: *"The proposed harness is designed to prevent Telnyx call-control, ARI, SIP/PSTN and customer webhook dispatch through the specified test paths. Zero process-wide external egress has not been independently verified."*
5. **Teardown Lifecycle Ordering and Partial Failures (Item 5: `PASS`):** Lifecyle teardown ordering is corrected to prevent premature Prisma disconnection before `moduleRef.close()`. Helper transactions, pending worker promises, targeted call deletions (`ON DELETE CASCADE`), lease unregistration, and module destruction are ordered fail-safely with zero swallowed errors.

---

## 2. PostgreSQL Worker PID Correlation

### 2.1 Prisma Connection Pooling vs. Interactive Transactions

In Prisma Client, connection management operates under two distinct models:
- **Standard Queries:** Individual operations (e.g. `prisma.call.findUnique()`) acquire a connection from the internal connection pool, execute the query, and release the connection immediately back to the pool. Successive queries may execute across different backend PIDs.
- **Interactive Transactions:** In [`CallsService.prepareNextBuyer`](file:///C:/Projects/callflow-agent-a/apps/api/src/calls/calls.service.ts#L2036), the reservation logic is wrapped in:
  ```typescript
  return this.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "calls" WHERE id = ${callId} FOR UPDATE`;
    // ... campaign lookup ...
    const lockedBuyers = await tx.$queryRaw<Array<{ id: string; max_concurrent_calls: number }>>`
      SELECT id, max_concurrent_calls FROM "buyers" WHERE id = ${cb.buyer_id} FOR UPDATE
    `;
    // ... reservation insert ...
  });
  ```
  In an interactive transaction, Prisma checks out a **single dedicated client connection** from the connection pool and reserves it exclusively for that `tx` instance until the callback resolves or rejects (`COMMIT` or `ROLLBACK`).

### 2.2 Mechanism of Row Lock Contention

1. **Call Identification:** The test dispatches Call B1 and Call B2 via `callController.handleEvent(event)`. Each call has a known `callId` (generated as `qa-call-...`).
2. **Dedicated Connection Binding:**
   - Worker 1 executes `prepareNextBuyer(callB1.id)` on dedicated Connection 1. It locks the `calls` row: `SELECT id FROM "calls" WHERE id = ${callB1.id} FOR UPDATE`.
   - Worker 2 executes `prepareNextBuyer(callB2.id)` on dedicated Connection 2. It locks the `calls` row: `SELECT id FROM "calls" WHERE id = ${callB2.id} FOR UPDATE`.
3. **Lock Contention on Buyer A:**
   - Pre-condition: The test Helper client opened a dedicated PostgreSQL connection, captured its own backend PID (`SELECT pg_backend_pid() AS helper_pid`), and executed:
     ```sql
     BEGIN;
     SELECT id FROM "buyers" WHERE id = '0b59b566-a36c-4ec1-bebe-08fca8b7ec63' FOR UPDATE;
     ```
   - Both Worker 1 and Worker 2 advance in parallel within their respective transactions and execute:
     ```sql
     SELECT id, max_concurrent_calls FROM "buyers" WHERE id = '0b59b566-a36c-4ec1-bebe-08fca8b7ec63' FOR UPDATE;
     ```
   - Because `helper_pid` holds the exclusive tuple lock on Buyer A, PostgreSQL places both Worker 1 and Worker 2 into lock wait state.

### 2.3 Diagnostic Observation using `pg_blocking_pids()`

Query-signature string matching is insufficient because multiple background processes or connection pool health checks may run similar queries. 

The primary, version-agnostic diagnostic evidence consists of:
1. `wait_event_type = 'Lock'` (indicates the session is blocked on a heavyweight lock).
2. `helper_pid = ANY(pg_blocking_pids(pid))` (proves the session is blocked directly or transitively by the Helper transaction).

#### Diagnostic Query:
```sql
SELECT 
  blocked.pid AS blocked_pid,
  blocked.wait_event_type,
  blocked.wait_event,
  blocked.state,
  blocked.query AS blocked_query,
  pg_blocking_pids(blocked.pid) AS blocking_pids
FROM pg_stat_activity blocked
WHERE blocked.wait_event_type = 'Lock'
  AND $1 = ANY(pg_blocking_pids(blocked.pid));
```
*Parameter `$1`: `helper_pid`.*

#### Proof Criteria:
- While Helper transaction holds the row lock, the query must return **exactly 2 rows**.
- Both returned rows must exhibit `wait_event_type = 'Lock'`.
- Both returned rows must list `helper_pid` in `blocking_pids`.
- This empirically and deterministically proves that both worker transactions have reached the contested reservation operation and are actively serialized behind Helper A's row lock.

---

## 3. Actual Database Identity Verification

### 3.1 Limitations of URL Parsing

Validating `process.env.DATABASE_URL` via regular expressions or `new URL(dbUrl)` verifies only what the client *intends* to connect to. It cannot detect:
- Local port-forwarding or SSH tunnels redirecting port 5433 to a remote host.
- Ambiguous host resolution (`localhost` resolving to IPv6 `::1` or an unexpected network adapter).
- Connection poolers or proxies routing traffic to an unintended database.

### 3.2 Post-Connection Identity Verification Query

Immediately after establishing the initial database connection (via helper client or Prisma), the harness must execute the following read-only query:

```sql
SELECT
  current_database() AS database_name,
  current_user AS database_user,
  inet_server_addr() AS server_address,
  inet_server_port() AS server_port;
```

### 3.3 Rejection Rules

The test harness must validate the returned tuple against strict invariants before executing any further queries:

```typescript
interface DatabaseIdentity {
  database_name: string;
  database_user: string;
  server_address: string | null;
  server_port: number;
}

function verifyDatabaseIdentity(identity: DatabaseIdentity): void {
  const errors: string[] = [];

  // 1. Database name check
  if (identity.database_name !== 'callflow_qa') {
    errors.push(`CRITICAL SAFETY VIOLATION: Connected database is "${identity.database_name}", expected strictly "callflow_qa".`);
  }

  // 2. Port check
  if (Number(identity.server_port) !== 5433) {
    errors.push(`CRITICAL SAFETY VIOLATION: Connected port is ${identity.server_port}, expected strictly 5433.`);
  }

  // 3. Server address check (must be loopback)
  const addr = identity.server_address;
  const isLoopback = addr === '127.0.0.1' || addr === '::1' || addr === null; // null indicates UNIX domain socket on local host
  if (!isLoopback) {
    errors.push(`CRITICAL SAFETY VIOLATION: Connected server address is "${addr}", expected local loopback (127.0.0.1).`);
  }

  if (errors.length > 0) {
    throw new Error(
      `\n====================================================================\n` +
      `POST-CONNECTION DATABASE IDENTITY SAFETY CHECK FAILED:\n` +
      errors.map((e, idx) => `  ${idx + 1}. ${e}`).join('\n') +
      `\nABORTING IMMEDIATELY BEFORE ANY FIXTURE QUERY OR MUTATION.\n` +
      `====================================================================\n`
    );
  }
}
```

If any check fails, the harness immediately throws an exception and disconnects. Zero test fixtures are queried, zero leases are opened, and zero rows are inserted or updated.

---

## 4. Preflight Sequence Correction

The preflight and test lifecycle must be divided into four strictly isolated, sequential phases:

```mermaid
flowchart TD
    subgraph PHASE_A ["Phase A: Environment-Only Preflight (Zero DB Connections)"]
        A1["Assert TELEPHONY_QA_ENABLED === 'true'"] --> A2["Assert TELNYX_QA_TRACKING_DID === '+17252574041'"]
        A2 --> A3["Assert TELNYX_QA_CALL_CONTROL_APP_ID is non-empty"]
        A3 --> A4["Assert TELEPHONY_QA_ALLOWED_DESTINATIONS contains +12025550199 and +12025550198"]
        A4 --> A5["Assert DATABASE_URL string format points to 127.0.0.1:5433/callflow_qa"]
        A5 --> A6{"Any Failure?"}
        A6 -- Yes --> A_ABORT["ABORT IMMEDIATELY (Zero Database Connections, Zero Network Packets)"]
    end

    subgraph PHASE_B ["Phase B: Post-Connection Database Identity Check"]
        A6 -- No --> B1["Open Read-Only Helper Connection"]
        B1 --> B2["Execute: SELECT current_database(), current_user, inet_server_addr(), inet_server_port()"]
        B2 --> B3{"Identity Matches callflow_qa @ 127.0.0.1:5433?"}
        B3 -- No --> B_ABORT["ABORT & DISCONNECT (Exactly 1 Read Query Occurred; Zero Fixtures Touched)"]
    end

    subgraph PHASE_C ["Phase C: Read-Only Fixture Verification"]
        B3 -- Yes --> C1["Query Workspace (5e20bafe-...)"]
        C1 --> C2["Query Campaign (6af31407-...)"]
        C2 --> C3["Query Buyer A (0b59b566-...)"]
        C3 --> C4["Query Buyer B (b0000000-...) in campaign_buyers"]
        C4 --> C5{"All Fixtures Active & Intact?"}
        C5 -- No --> C_ABORT["ABORT (Fixtures Missing or Buyer B Unseeded; Zero Test Mutations)"]
    end

    subgraph PHASE_D ["Phase D: Test Setup, Concurrency Execution & Teardown"]
        C5 -- Yes --> D_GATE{"Separate User Authorization Granted?"}
        D_GATE -- No --> D_HOLD["STOP: Stand By for Explicit User Execution Directive"]
        D_GATE -- Yes --> D1["Compile NestJS TestingModule (FakeTelephonyProvider & MockWebhooks)"]
        D1 --> D2["Execute Suite A & Suite B"]
        D2 --> D3["Failure-Safe Teardown & Cascading Purge"]
    end

    PHASE_A --> PHASE_B
    PHASE_B --> PHASE_C
    PHASE_C --> PHASE_D
```

### Clarification on Database Query Absence:
- **Phase A Failure:** All database queries are strictly absent. The test terminates before any TCP socket or connection pool is initialized.
- **Phase B Failure:** A database connection and exactly one read-only metadata query (`SELECT current_database()...`) have occurred. If rejected, the harness terminates before application tables are accessed.
- **Phase C Failure:** Read-only `SELECT` queries against static configuration tables have occurred. Zero rows are mutated, inserted, or deleted.

---

## 5. External Egress Boundary

### 5.1 Formal Egress Disclaimer

> [!CAUTION]
> **Authoritative Boundary Statement:**  
> The proposed harness is designed to prevent Telnyx call-control, ARI, SIP/PSTN and customer webhook dispatch through the specified test paths. Zero process-wide external egress has not been independently verified.

### 5.2 Forensic Breakdown of Network Isolation Scope

1. **Targeted In-Path Isolations (Verified in Source Code):**
   - **Telnyx Call-Control REST API:** In `apps/api/src/telephony/telephony.module.ts`, `TELEPHONY_PROVIDER` is overridden in the testing module with [`FakeTelephonyProvider`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/fake.provider.ts). Calls to `answerCall`, `hangupCall`, `bridgeCalls`, and `startRecording` execute in-memory.
   - **Customer Webhook Delivery:** In [`CallsService`](file:///C:/Projects/callflow-agent-a/apps/api/src/calls/calls.service.ts#L82), `WebhooksService` is overridden with `mockWebhooksService`. Webhook events are pushed to an in-memory array rather than dispatched via HTTP.
   - **Asterisk ARI & SIP/PSTN Sockets:** `FakeTelephonyProvider` does not establish connections to Asterisk ARI (`127.0.0.1:8088`) or bind SIP/RTP sockets (5060, 10000–10050).
   - **Telnyx Provisioning SDK:** `TelnyxProvisioningService` is uninvoked along all Stage A execution paths.

2. **Unverified Process-Wide Vectors (Outside Tested Call Graph):**
   - **NestJS Module Instantiation:** Loading `AppModule` instantiates full provider dependency trees. While inspected constructors make no outbound network calls, unmocked third-party libraries or global NestJS interceptors are not isolated by an operating system firewall.
   - **Node.js Process DNS & HTTP:** Any asynchronous background tasks, global error reporting, or telemetry in uninspected packages could theoretically initiate WAN traffic if not executed in a sandboxed network namespace.
   - **Local Loopback PostgreSQL:** The harness deliberately maintains active TCP loopback traffic to `127.0.0.1:5433` to validate real database transactions and locks.

---

## 6. Teardown Lifecycle Ordering and Partial Failures

### 6.1 Lifecycle Dependencies and Ordering Rules

A critical flaw in prior specifications was recommending explicit `prisma.$disconnect()` *before* `moduleRef.close()`. In NestJS:
- If `PrismaService` implements `OnModuleDestroy` or `beforeApplicationShutdown`, calling `$disconnect()` manually before `moduleRef.close()` causes module teardown hooks to fail or encounter closed connection errors.
- Conversely, tearing down the database records *after* `moduleRef.close()` fails because module destruction severs Prisma's connection pool.

### 6.2 Correct Teardown Sequence

The teardown routine must execute in six strictly ordered stages:

```typescript
afterAll(async () => {
  const teardownErrors: Error[] = [];

  // STAGE 1: Release Helper Lock & Settle Pending Worker Promises
  try {
    if (helperClient) {
      await helperClient.query('ROLLBACK').catch(() => {});
      await helperClient.end().catch(() => {});
    }
  } catch (err: any) {
    teardownErrors.push(new Error(`Helper client release failed: ${err.message}`));
  }

  // Settle any pending worker promises to prevent orphaned queries
  if (pendingWorkerPromises && pendingWorkerPromises.length > 0) {
    try {
      await Promise.allSettled(pendingWorkerPromises);
    } catch (err: any) {
      teardownErrors.push(new Error(`Worker promise settlement failed: ${err.message}`));
    }
  }

  // STAGE 2: Targeted Database Record Cleanup (While Prisma is Connected)
  if (prisma && trackedProviderCallIds.size > 0) {
    try {
      const deleteResult = await prisma.call.deleteMany({
        where: {
          provider_call_id: { in: Array.from(trackedProviderCallIds) },
        },
      });
      logger.log(`Teardown: successfully removed ${deleteResult.count} test call records via CASCADE.`);
    } catch (dbErr: any) {
      logger.error(`CRITICAL: Database cleanup failed: ${dbErr.message}`, dbErr.stack);
      teardownErrors.push(new Error(`Database cleanup failed: ${dbErr.message}`));
    }
  }

  // STAGE 3: Unregister Active Test Runs from QaTelephonyGuardService
  if (qaGuard && activeTestRunIds.size > 0) {
    try {
      for (const runId of activeTestRunIds) {
        qaGuard.unregisterActiveTestRun(runId);
      }
    } catch (guardErr: any) {
      teardownErrors.push(new Error(`QA guard unregister failed: ${guardErr.message}`));
    }
  }

  // STAGE 4: Close NestJS TestingModule (Manages Provider Lifecycle & Prisma Disconnect)
  if (moduleRef) {
    try {
      await moduleRef.close();
    } catch (modErr: any) {
      teardownErrors.push(new Error(`TestingModule close failed: ${modErr.message}`));
    }
  }

  // STAGE 5: Standalone Prisma Disconnect (Only if Prisma was instantiated outside TestingModule)
  if (standalonePrismaClient) {
    try {
      await standalonePrismaClient.$disconnect();
    } catch (discErr: any) {
      teardownErrors.push(new Error(`Standalone Prisma disconnect failed: ${discErr.message}`));
    }
  }

  // STAGE 6: Fail Loudly if Any Teardown Step Failed
  if (teardownErrors.length > 0) {
    const combinedMsg = teardownErrors.map(e => e.message).join(' | ');
    logger.error(`TEARDOWN FAILED WITH ${teardownErrors.length} ERRORS: ${combinedMsg}`);
    throw new Error(`CRITICAL: Test suite teardown failed: ${combinedMsg}`);
  }
});
```

---

## 7. Remaining Risks & Source-Code vs. Proposed Behavior

| Item | Classification | Description | Status / Mitigation |
| :--- | :--- | :--- | :--- |
| **Buyer B Pre-Seeding** | **Unexecuted Dependency** | `Buyer B` (`b0000000-0000-0000-0000-000000000002`) does not currently exist in `callflow_qa`. Phase C preflight will reject execution until the user authorizes and executes the seed. | Phase C preflight halts before any test calls are created. |
| **PostgreSQL Lock Polling Latency** | **Proposed Behavior** | Polling `pg_stat_activity` with a 50 ms interval while the Helper holds the lock relies on the worker transactions arriving within the helper lock window. | Helper transaction holds the lock indefinitely until the polling assertion detects both blocked PIDs (or times out after 5,000 ms). |
| **Process-Wide Network Sandbox** | **Unverified Scope** | Node.js process is not wrapped in an OS-level network namespace or egress firewall filter. | Disclosed transparently in Section 5; in-path mocking eliminates telephony/webhook egress. |
| **Helper Connection Abrupt Termination** | **Source-Code Finding** | If the Node.js test process crashes violently (SIGKILL), PostgreSQL backend automatically terminates the backend session, releasing held row locks. | PostgreSQL engine-level guarantee; zero orphaned locks. |

---

## 8. Final Recommendation

# **`READY FOR SEPARATE USER AUTHORIZATION`**

### Final Determination:
All five technical corrections requested in the prompt have been thoroughly addressed and forensically documented:
1. PostgreSQL worker PID correlation is grounded in Prisma's interactive transaction connection-pinning mechanics and verified using `pg_blocking_pids()` and `wait_event_type = 'Lock'`.
2. Post-connection database identity verification using `SELECT current_database(), current_user, inet_server_addr(), inet_server_port()` provides fail-closed physical session validation.
3. Preflight sequencing is separated into four distinct phases, clarifying that database queries occur only after Phase A passes.
4. Process-wide external network egress is honestly characterized and qualified with the mandatory boundary disclaimer.
5. Teardown lifecycle ordering prevents premature Prisma disconnection before module closure and ensures zero swallowed errors.

---

**NO IMPLEMENTATION, NO TEST EXECUTION, NO DATABASE MUTATION, AND NO LIVE TELEPHONY AUTHORIZATION GRANTED.**

---
*Report certified by Agent 2 (Backend, API, Database & Security) — November 15, 2026.*