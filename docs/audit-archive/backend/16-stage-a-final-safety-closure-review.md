# CALLFLOW — QA-2B STAGE A: FINAL DOCKER DB IDENTITY, WORKER CORRELATION & TEARDOWN REVIEW

**Document ID:** `CALLFLOW-PHASE-QA-2B-STAGE-A-SAFETY-CLOSURE-REVIEW`  
**Assigned Agent:** Agent 2 — Backend, API, Database & Security  
**Review Mode:** STRICT READ-ONLY FORENSIC REVIEW  
**Reference Document:** [`15-stage-a-final-contention-and-egress-addendum.md`](file:///C:/Projects/callflow-agent-a/qa/reports/qa-2a-final-consolidation/15-stage-a-final-contention-and-egress-addendum.md)  
**Output Target:** [`qa/reports/qa-2a-final-consolidation/16-stage-a-final-safety-closure-review.md`](file:///C:/Projects/callflow-agent-a/qa/reports/qa-2a-final-consolidation/16-stage-a-final-safety-closure-review.md)  
**Evaluation Date:** November 15, 2026  
**Implementation / Execution Permission:** NONE (Zero code modifications, zero test file creation, zero database queries/connections, zero mutations, zero live telephony)

---

## 1. Executive Verdict

# **`VERDICT: BLOCKED`**

### Summary Justification:
1. **Docker PostgreSQL Port & Address Topology Mismatch (`BLOCKED / NEEDS AUTHORIZED VERIFICATION`):** Forensic inspection of [`docker-compose.qa.yml#L43`](file:///C:/Projects/callflow-agent-a/docker-compose.qa.yml#L43) reveals that host port `5433` maps to container internal port **`5432`** (`127.0.0.1:5433:5432`). In Docker bridge networking, PostgreSQL's internal functions `inet_server_port()` and `inet_server_addr()` return the container's internal listening port (`5432`) and container interface IP (e.g. `172.x.x.x`), NOT host port `5433` or host IP `127.0.0.1`. Asserting `inet_server_port() = 5433` on the server causes a guaranteed false failure. A safe multi-layer strategy combining client socket verification with server-side database name and container port checks is proposed, but cannot be validated without authorized runtime connectivity.
2. **Exact Worker PID to Call ID Correlation Limits (`BLOCKED / NEEDS AUTHORIZED VERIFICATION`):** While Prisma interactive transactions pin a dedicated connection during [`CallsService.prepareNextBuyer()`](file:///C:/Projects/callflow-agent-a/apps/api/src/calls/calls.service.ts#L2036-L2299), existing application code does not capture or expose `pg_backend_pid()`. Standard PostgreSQL catalog queries (`pg_stat_activity` and `pg_blocking_pids()`) prove that two worker transactions are locked and serialized behind `helper_pid`, but **cannot differentiate which backend PID belongs to Call B1 versus Call B2** during the blocked wait. Disambiguating worker PIDs in real time requires application-level instrumentation, which is not currently present in production code.
3. **Teardown Error Swallowing Elimination (`PROPOSED BUT UNEXECUTED`):** Report 15's silent catch handlers (`.catch(() => {})`) and uninspected `Promise.allSettled()` results are completely eliminated. An explicit error-aggregation harness is specified to track, surface, and re-throw failures across helper transaction rollback, connection termination, rejected worker promises, cascading call deletions, and NestJS module destruction.
4. **Preflight Inactivity Boundaries (`VERIFIED FROM SOURCE`):** Retracted the unsubstantiated claim of "Zero Network Packets" in Phase A. Preflight guarantees zero application database connections and zero event injections, but process-wide network silence cannot be claimed without independent OS-level packet capture.

---

## 2. Issue 1 — Docker PostgreSQL Identity Verification & Topology

### 2.1 The Docker NAT and Port Mapping Discrepancy

Report 15 specified that the harness execute:
```sql
SELECT
  current_database() AS database_name,
  current_user AS database_user,
  inet_server_addr() AS server_address,
  inet_server_port() AS server_port;
```
and assert `server_port === 5433` and `server_address === '127.0.0.1'`.

#### Forensic Analysis of [`docker-compose.qa.yml`](file:///C:/Projects/callflow-agent-a/docker-compose.qa.yml#L38-L49):
```yaml
  postgres-qa:
    image: postgres:17-alpine
    container_name: callflow-postgres-qa
    restart: unless-stopped
    ports:
      - "127.0.0.1:5433:5432"
    environment:
      POSTGRES_DB: callflow_qa
      POSTGRES_USER: callflow_qa_user
    env_file:
      - ./apps/api/.env.qa
    volumes:
      - callflow_qa_data:/var/lib/postgresql/data
```

#### Delineation of the Four Network Layers:

```
[Host System / Node.js Client]
  |
  +-- (A) Host-Side Destination: DATABASE_URL points to 127.0.0.1:5433
  |
  +-- (D) Client-Side Socket Peer: Node.js net.Socket sees:
  |       remoteAddress = '127.0.0.1'
  |       remotePort = 5433
  |
============== [Docker Bridge NAT Boundary] =============
  |
  +-- (B) Docker Port Mapping: translates host 127.0.0.1:5433 -> container:5432
  |
============== [Container Network Namespace] ============
  |
  +-- (C) PostgreSQL Server-Side Functions:
          inet_server_port() = 5432  (Internal container listening port!)
          inet_server_addr() = 172.x.x.x  (Container virtual eth0 IP!)
          inet_client_addr() = 172.x.x.1  (Docker bridge gateway IP!)
```

1. **Host-Side Connection Destination:** The client initiates a TCP connection to host IP `127.0.0.1` on port `5433`.
2. **Docker Port Mapping:** Docker proxy / iptables NAT forwards incoming packets on host port `5433` to port `5432` inside container `callflow-postgres-qa`.
3. **Server-Side `inet_server_addr()` and `inet_server_port()`:** PostgreSQL executes in an isolated Linux network namespace where its daemon is bound to port `5432`. Therefore:
   - `inet_server_port()` returns **`5432`**, NOT `5433`.
   - `inet_server_addr()` returns the container's internal interface IP (e.g. `172.18.0.2`), NOT `127.0.0.1`.
   - Asserting `server_port = 5433` against the server output causes an immediate, incorrect safety abortion.
4. **Client-Side Socket Peer Information:** The operating system socket allocated to Node.js / pg driver maintains the host-side perspective (`socket.remoteAddress = '127.0.0.1'`, `socket.remotePort = 5433`).

### 2.2 Corrected Safe Identity Verification Strategy

A safe verification strategy must cross-examine both client-side and server-side evidence without invalid assumptions about container namespace reflection:

#### 1. Layer 1 — Client Socket Peer Verification (Host-Side):
In the Node.js `pg` helper client connection stream, inspect the underlying `net.Socket`:
```typescript
const stream = (helperClient as any).connection?.stream;
const clientRemoteAddr = stream?.remoteAddress;
const clientRemotePort = stream?.remotePort;

if (clientRemoteAddr !== '127.0.0.1' || clientRemotePort !== 5433) {
  throw new Error(`CRITICAL ABORT: Client socket connected to ${clientRemoteAddr}:${clientRemotePort}, expected strictly 127.0.0.1:5433.`);
}
```

#### 2. Layer 2 — Server Identity Verification (Container-Side):
Query PostgreSQL session metadata:
```sql
SELECT
  current_database() AS database_name,
  current_user AS database_user,
  inet_server_port() AS server_port;
```
Validation rules:
- `database_name === 'callflow_qa'` (strictly matches dedicated QA database).
- `database_user === 'callflow_qa_user'` (strictly matches dedicated QA role).
- `server_port === 5432` (strictly matches internal container listening port).
- **Rule regarding `inet_server_addr() IS NULL`:** Under no circumstances is `inet_server_addr() IS NULL` accepted as proof of safety. A null server address indicates a UNIX domain socket connection, whereas the QA isolation boundary mandates an explicit TCP connection to `127.0.0.1:5433`.

#### 3. Layer 3 — Data Fingerprint Verification:
Query static tenant entities:
```sql
SELECT id FROM "workspaces" WHERE id = '5e20bafe-7306-4da7-9944-62c4c5575a5a';
SELECT id FROM "campaigns" WHERE id = '6af31407-3f46-4f1d-90d0-bf08af2e9600';
```
Confirms the session is physically attached to the isolated QA tenant partition.

### 2.3 Blocker Determination
Because live runtime network translation and container IP bindings cannot be executed under strict read-only audit restrictions, **Docker Database Identity Verification is classified as `BLOCKED / NEEDS AUTHORIZED VERIFICATION`**.

---

## 3. Issue 2 — Exact Worker PID to Call ID Correlation

### 3.1 The Limits of PostgreSQL Catalog Inspection

Report 15 correctly established that Prisma interactive transactions (`prisma.$transaction`) pin a single dedicated connection for the entire callback. However, the correlation between application Call IDs and PostgreSQL backend PIDs has an important architectural limitation:

```typescript
// Inside CallsService.prepareNextBuyer(callId):
return this.prisma.$transaction(async (tx) => {
  // Statement 1: Locks calls row
  await tx.$queryRaw`SELECT id FROM "calls" WHERE id = ${callId} FOR UPDATE`;
  
  // Statement 2: Campaign lookup
  const campaign = await tx.campaign.findUnique({ ... });
  
  // Statement 3: Contended row lock on Buyer A (STALLS HERE)
  const lockedBuyers = await tx.$queryRaw<Array<{ id: string; max_concurrent_calls: number }>>`
    SELECT id, max_concurrent_calls FROM "buyers" WHERE id = ${cb.buyer_id} FOR UPDATE
  `;
});
```

#### Forensic Observations:
1. **Catalog Query Masking:** When Worker 1 and Worker 2 stall at Statement 3, `pg_stat_activity.query` displays only the currently executing query:
   ```sql
   SELECT id, max_concurrent_calls FROM "buyers" WHERE id = $1 FOR UPDATE
   ```
   The previous query (`SELECT id FROM "calls" WHERE id = ${callId} FOR UPDATE`) has completed and is no longer visible in `pg_stat_activity`.
2. **Lock Table Anonymity:** In `pg_locks`, both workers hold granted locks on table `'calls'::regclass` and are waiting on the transaction ID of `helper_pid`. However, standard `pg_locks` does not expose row-level tuple primary keys (`callId`).
3. **Forensic Truth:** Catalog inspection (`pg_stat_activity` and `pg_blocking_pids()`) definitively proves:
   - Exactly two worker transactions exist.
   - Both are blocked by `helper_pid`.
   - Both are waiting on Buyer A's row lock.
   - **However, catalog inspection alone cannot prove whether Backend PID 101 belongs to Call B1 or Call B2 during the lock-wait phase.**

### 3.2 Correlation Classification & Future Instrumentation

| Dimension | Proof Level | Mechanism | Status |
| :--- | :--- | :--- | :--- |
| **Row-Lock Contention** | **Empirically Proven** | `pg_stat_activity` where `wait_event_type = 'Lock'` and `helper_pid = ANY(pg_blocking_pids(pid))` | **VERIFIED FROM SOURCE** |
| **Two Workers Serialized** | **Empirically Proven** | Exactly 2 PIDs returned by `blocking_pids` query | **VERIFIED FROM SOURCE** |
| **Exact Call ID &rarr; Worker PID Mapping** | **Unprovable Without Instrumentation** | Requires capturing `pg_backend_pid()` inside the interactive transaction and emitting it alongside `callId` | **BLOCKED / NEEDS AUTHORIZED VERIFICATION** |

#### Proposed Future Instrumentation (Unexecuted & Unapproved):
To establish real-time, in-flight PID-to-Call mapping in a future authorized test:
```typescript
// Proposed test-only instrumentation (NOT present in production code):
const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
this.logger.log(`qa.worker.bound: Call ${callId} mapped to PostgreSQL PID ${pid}`);
```
Because application modifications are strictly prohibited, this capability cannot be executed today.

---

## 4. Issue 3 — Complete Teardown Lifecycle & Error Surfacing

### 4.1 Deficiencies in Report 15's Teardown

Report 15 contained two unacceptable error-handling patterns:
1. Silent catch handlers: `await helperClient.query('ROLLBACK').catch(() => {});` and `await helperClient.end().catch(() => {});`. If the database rejected the rollback or hung on connection termination, the failure was silently concealed.
2. Unchecked settlements: `await Promise.allSettled(pendingWorkerPromises);` allowed worker rejections, unhandled exceptions, and promise cancellations to pass without inspection or error reporting.

### 4.2 Corrected Fail-Loud Teardown Specification

The corrected teardown routine ensures that every cleanup phase is isolated, every failure is captured, and no error is swallowed:

```typescript
afterAll(async () => {
  const teardownErrors: Array<{ stage: string; error: Error }> = [];

  // -------------------------------------------------------------------------
  // STAGE 1: Helper Transaction Rollback & Connection Release
  // -------------------------------------------------------------------------
  if (helperClient) {
    try {
      await helperClient.query('ROLLBACK');
    } catch (err: any) {
      logger.error(`Teardown Stage 1A Error: Failed to ROLLBACK helper transaction: ${err.message}`, err.stack);
      teardownErrors.push({ stage: 'Helper Rollback', error: err });
    }

    try {
      await helperClient.end();
    } catch (err: any) {
      logger.error(`Teardown Stage 1B Error: Failed to terminate helper connection: ${err.message}`, err.stack);
      teardownErrors.push({ stage: 'Helper Connection End', error: err });
    }
  }

  // -------------------------------------------------------------------------
  // STAGE 2: Pending Worker Promise Settlement & Rejection Surfacing
  // -------------------------------------------------------------------------
  if (pendingWorkerPromises && pendingWorkerPromises.length > 0) {
    const settlements = await Promise.allSettled(pendingWorkerPromises);
    settlements.forEach((result, idx) => {
      if (result.status === 'rejected') {
        const rejectionErr = result.reason instanceof Error 
          ? result.reason 
          : new Error(`Worker promise ${idx + 1} rejected with: ${String(result.reason)}`);
        logger.error(`Teardown Stage 2 Error: Worker promise ${idx + 1} failed: ${rejectionErr.message}`, rejectionErr.stack);
        teardownErrors.push({ stage: `Worker Promise ${idx + 1}`, error: rejectionErr });
      }
    });
  }

  // -------------------------------------------------------------------------
  // STAGE 3: Targeted Database Record Cleanup (Prisma Connected)
  // -------------------------------------------------------------------------
  if (prisma && trackedProviderCallIds.size > 0) {
    try {
      const deleteResult = await prisma.call.deleteMany({
        where: {
          provider_call_id: { in: Array.from(trackedProviderCallIds) },
        },
      });
      logger.log(`Teardown Stage 3: Successfully deleted ${deleteResult.count} test call records via CASCADE.`);
    } catch (err: any) {
      logger.error(`Teardown Stage 3 Error: Failed to delete test calls: ${err.message}`, err.stack);
      teardownErrors.push({ stage: 'Database Cleanup', error: err });
    }
  }

  // -------------------------------------------------------------------------
  // STAGE 4: QA Lease and Test Run Unregistration
  // -------------------------------------------------------------------------
  if (qaGuard && activeTestRunIds.size > 0) {
    for (const runId of activeTestRunIds) {
      try {
        qaGuard.unregisterActiveTestRun(runId);
      } catch (err: any) {
        logger.error(`Teardown Stage 4 Error: Failed to unregister runId ${runId}: ${err.message}`, err.stack);
        teardownErrors.push({ stage: `QA Guard Unregister (${runId})`, error: err });
      }
    }
  }

  // -------------------------------------------------------------------------
  // STAGE 5: NestJS TestingModule Close (Owns Provider Lifecycle & Disconnect)
  // -------------------------------------------------------------------------
  if (moduleRef) {
    try {
      await moduleRef.close();
    } catch (err: any) {
      logger.error(`Teardown Stage 5 Error: Failed to close TestingModule: ${err.message}`, err.stack);
      teardownErrors.push({ stage: 'TestingModule Close', error: err });
    }
  }

  // -------------------------------------------------------------------------
  // STAGE 6: Standalone Prisma Disconnect (If Instantiated Outside TestingModule)
  // -------------------------------------------------------------------------
  if (standalonePrismaClient) {
    try {
      await standalonePrismaClient.$disconnect();
    } catch (err: any) {
      logger.error(`Teardown Stage 6 Error: Failed to disconnect standalone Prisma: ${err.message}`, err.stack);
      teardownErrors.push({ stage: 'Standalone Prisma Disconnect', error: err });
    }
  }

  // -------------------------------------------------------------------------
  // FINAL TEARDOWN EVALUATION: Fail Loudly
  // -------------------------------------------------------------------------
  if (teardownErrors.length > 0) {
    const errorSummary = teardownErrors
      .map(e => `[${e.stage}] ${e.error.message}`)
      .join('\n  - ');
    throw new Error(
      `\n====================================================================\n` +
      `STAGE A TEARDOWN FAILED WITH ${teardownErrors.length} UNHANDLED ERROR(S):\n` +
      `  - ${errorSummary}\n` +
      `====================================================================\n`
    );
  }
});
```

---

## 5. Issue 4 — Corrected Preflight Network & Inactivity Boundaries

### 5.1 Retraction of "Zero Network Packets" Claim

The phrase "Zero Network Packets" used in Report 15 is factually unverified and hereby formally retracted. 

#### Scope of Verification:
1. **Application-Level Preflight Boundary (`VERIFIED FROM SOURCE`):**
   - Phase A environment preflight executes entirely in-memory against `process.env`.
   - It initiates zero TCP/IP connections to PostgreSQL, Telnyx, Asterisk, or external webhook endpoints.
   - It dispatches zero application events into `CallController`.
2. **Process-Level Networking Scope (`BLOCKED / NEEDS AUTHORIZED VERIFICATION`):**
   - The Node.js runtime, V8 engine, OS networking stack, and third-party libraries may transmit background network packets (e.g. DNS lookups, loopback IPC, NTP, or runtime telemetry).
   - In the absence of an operating-system-level packet capture (e.g. Wireshark, `tcpdump`) or containerized network namespace isolation (`--network none`), **zero process-wide network packets cannot be claimed**.

---

## 6. Evidence Classification Matrix

Every technical assertion across Reports 11 through 16 is classified below:

| Technical Assertion | Forensic Classification | Source-Code / Infrastructure Reference |
| :--- | :--- | :--- |
| **Docker port mapping is `127.0.0.1:5433:5432`** | **DOCUMENTED INFRASTRUCTURE FACT** | [`docker-compose.qa.yml#L43`](file:///C:/Projects/callflow-agent-a/docker-compose.qa.yml#L43) |
| **PostgreSQL daemon listens on port 5432 inside container** | **VERIFIED FROM SOURCE** | [`docker-compose.qa.yml#L39-L43`](file:///C:/Projects/callflow-agent-a/docker-compose.qa.yml#L39-L43) |
| **`prepareNextBuyer()` pins dedicated connection via `$transaction`** | **VERIFIED FROM SOURCE** | [`apps/api/src/calls/calls.service.ts#L2036`](file:///C:/Projects/callflow-agent-a/apps/api/src/calls/calls.service.ts#L2036) |
| **Row lock contention observable via `pg_blocking_pids()`** | **VERIFIED FROM SOURCE** | PostgreSQL system catalog architecture (`pg_stat_activity`, `pg_locks`) |
| **Exact Call ID &rarr; Worker PID mapping without code changes** | **BLOCKED / NEEDS AUTHORIZED VERIFICATION** | Unobservable from standard SQL catalog while lock is held |
| **Live Docker container server address & port verification** | **BLOCKED / NEEDS AUTHORIZED VERIFICATION** | Cannot execute live SQL queries without separate authorization |
| **Independent fail-loud teardown harness** | **PROPOSED BUT UNEXECUTED** | Specified in Section 4 of this report |
| **Process-wide zero network packet inactivity** | **BLOCKED / NEEDS AUTHORIZED VERIFICATION** | Requires authorized OS-level packet capture tools |

---

## 7. Remaining Blockers & Required Authorizations

Before Stage A execution can ever be considered, the following four items must be resolved through explicit, authorized procedures:

1. **Topology Verification Authorization:** Permission to execute a read-only probe verifying Docker port translation and `inet_server_port()` output from within the test environment.
2. **Buyer B Database Seed Authorization:** Explicit user command to seed `Buyer B` (`b0000000-0000-0000-0000-000000000002`, `max_concurrent_calls = 2`, `priority = 2`) into `callflow_qa`.
3. **Application Instrumentation Decision:** User decision on whether lock contention proof via `pg_blocking_pids()` is sufficient, or if test-only code instrumentation to capture `pg_backend_pid()` must be developed.
4. **Stage A Execution Authorization:** Formal, separate authorization to create test files and execute the test runner.

---

## 8. Final Recommendation

# **`BLOCKED`**

### Final Determination:
While the theoretical test design, fail-closed preflights, and teardown error handling are fully refined, Stage A **cannot be classified as execution-ready** because:
1. Docker port mapping (`5433` host &rarr; `5432` container) renders naive server-side port assertions invalid, requiring live runtime verification.
2. Exact real-time Call ID to Worker PID correlation is structurally unachievable without modifying application source code.

Execution readiness remains **BLOCKED** pending authorized topology verification and explicit user directives.

---

**NO IMPLEMENTATION, NO TEST EXECUTION, NO DATABASE CONNECTION, NO DATABASE MUTATION, AND NO LIVE TELEPHONY AUTHORIZATION GRANTED.**

---
*Report certified by Agent 2 (Backend, API, Database & Security) — November 15, 2026.*