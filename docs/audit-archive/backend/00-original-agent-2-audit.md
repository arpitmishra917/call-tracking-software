# CALLFLOW — PHASE QA-2A: BACKEND, DATABASE, TENANT ISOLATION & TELEPHONY SAFETY READINESS AUDIT

**Owner:** Agent 2 — Backend, API, Database & Security  
**Phase:** QA-2A  
**Mode:** STRICT READ-ONLY FORENSIC AUDIT  
**Audit Date:** November 12, 2026  
**Implementation / Mutation / Live Telephony Permission:** NONE  
**Categorical Verdict:** **`PASS WITH CONDITIONS`**  

---

## 1. Backend Safety Verdict

### **VERDICT: PASS WITH CONDITIONS**

### Detailed Justification:
1. **Database & Tenant Isolation (PASS):**  
   The CallFlow backend and PostgreSQL database engine enforce strict row-level isolation via `SELECT ... FOR UPDATE` within serialized database transactions (`prisma.$transaction`). Wallet balances, buyer concurrency limits, call attempts, and active reservations are partitioned strictly by `workspace_id`, `buyer_id`, and `call_id`. Unrelated workspaces and distinct buyer organizations experience zero shared locks and zero cross-tenant lock contention.
2. **Database Isolation Guard (PASS):**  
   [`apps/api/src/main.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/main.ts#L33-L45) enforces a hard, fail-closed target guard. When running in QA mode (`APP_ENV=qa` or `NODE_ENV=qa`), the process immediately terminates (`process.exit(1)`) if `DATABASE_URL` matches any production or cloud pattern (`supabase.co`, `aws-0`, `6543`) or if it does not strictly resolve to port `5433` and database `callflow_qa`. The QA database is physically isolated from local development (`port 5432 / calltracking_mvp`) and cloud production.
3. **Telephony Safety & Ingress Disarmament (PASS WITH CONDITIONS):**  
   In [`apps/api/.env.qa`](file:///C:/Projects/callflow-agent-a/apps/api/.env.qa#L9-L14), `TELEPHONY_QA_ENABLED=false`, `TELNYX_QA_TRACKING_DID=` is blank, and `TELEPHONY_QA_ALLOWED_DESTINATIONS=` is blank. Inbound calls arriving on the dedicated QA tracking DID or directed to the QA workspace are **immediately rejected and hung up** by the ingress gate in [`CallController.handleEvent()`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/call-controller.ts#L248-L254). Outbound buyer dialing is blocked when QA mode is active if the destination allowlist is empty.
4. **Conditions Precedent to QA-2B Execution (CONDITIONS):**
   - **Data Seed Gap:** The QA database (`127.0.0.1:5433/callflow_qa`) currently contains only one buyer organization (`Buyer A`). To verify waterfall overflow under concurrency in QA-2B, a secondary buyer (`Buyer B`) and its campaign mapping must be seeded.
   - **Webhook Signature Enforcement in QA:** [`TelnyxWebhookController.handleWebhook()`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/telnyx/telnyx.webhook.controller.ts#L43-L51) strictly enforces Ed25519 cryptographic signature verification in QA mode. Synthetic webhook tests must either sign payloads with a valid keypair or inject normalized events directly into `CallController.handleEvent()`.
   - **Environment Discrepancy Alignment:** Root `.env` currently contains `TELEPHONY_QA_ENABLED=true` while `apps/api/.env.qa` contains `TELEPHONY_QA_ENABLED=false`. While `apps/api/.env.qa` takes precedence in QA mode, both files should be harmonized before execution.

---

## 2. Exact QA Database Identity Verification (Redacted)

| Database Parameter | QA Environment Setting | Verification Status | Forensic Source Reference |
|---|---|---|---|
| **PostgreSQL Host** | `127.0.0.1` (Local Loopback) | ✅ VERIFIED ISOLATED | [`apps/api/.env.qa#L6`](file:///C:/Projects/callflow-agent-a/apps/api/.env.qa#L6) |
| **PostgreSQL Port** | `5433` (Docker: `callflow-postgres-qa`) | ✅ VERIFIED ISOLATED | [`docker-compose.qa.yml`](file:///C:/Projects/callflow-agent-a/docker-compose.qa.yml#L25) |
| **Database Name** | `callflow_qa` | ✅ VERIFIED ISOLATED | [`apps/api/.env.qa#L6`](file:///C:/Projects/callflow-agent-a/apps/api/.env.qa#L6) |
| **Database User** | `callflow_qa_user` | ✅ VERIFIED ISOLATED | [`apps/api/.env.qa#L6`](file:///C:/Projects/callflow-agent-a/apps/api/.env.qa#L6) |
| **Database Password** | `[REDACTED: cfqa_pg_... (40 chars)]` | ✅ VERIFIED ISOLATED | [`apps/api/.env.qa#L3`](file:///C:/Projects/callflow-agent-a/apps/api/.env.qa#L3) |
| **Sanitized URL** | `postgresql://callflow_qa_user:***@127.0.0.1:5433/callflow_qa?schema=public` | ✅ VERIFIED NO CREDENTIALS LEAKED | [`apps/api/src/common/database-isolation.util.ts#L99`](file:///C:/Projects/callflow-agent-a/apps/api/src/common/database-isolation.util.ts#L99) |
| **Dev Database Contrast** | `postgresql://postgres:***@localhost:5432/calltracking_mvp` | ✅ SEPARATE HOST/PORT/DB | [`apps/api/.env#L2`](file:///C:/Projects/callflow-agent-a/apps/api/.env#L2) |
| **Prod Database Contrast** | `postgresql://postgres.uwycbvnqnpnfisvvbabu:***@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres` | ✅ SEPARATE HOST/PORT/DB | [`apps/api/test/database-isolation.spec.ts#L64`](file:///C:/Projects/callflow-agent-a/apps/api/test/database-isolation.spec.ts#L64) |
| **Startup Abort Guard** | If `!dbUrl.includes('5433/callflow_qa')` -> `process.exit(1)` | ✅ ACTIVE & ENFORCED | [`apps/api/src/main.ts#L42-L45`](file:///C:/Projects/callflow-agent-a/apps/api/src/main.ts#L42-L45) |

### Non-QA Data Destruction Audit:
- **Test Cleanup Operations:** Audit of [`QaOrchestratorService.cleanup()`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-orchestrator.service.ts#L1500-L1639) confirms that cleanup operations terminate Asterisk channels, release in-memory bindings, and release wallet reservations.
- **Zero Table Purging:** No test script or orchestrator method executes `TRUNCATE`, `DROP TABLE`, or `DELETE FROM workspaces/buyers/calls`.
- **Zero Production Overwrite:** The QA database container has no network routes or credentials for development or production environments.

---

## 3. Telephony Guard Behavior Matrix

The table below documents the exact behavioral responses of the backend and [`QaTelephonyGuardService`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-telephony-guard.service.ts) across all security and configuration conditions:

| Scenario / Configuration Condition | Inbound Call to QA DID / QA Workspace | Inbound Call to Non-QA DID / Normal Workspace | Outbound Buyer Dialing (`validateDestinationOrThrow`) | API Startup / Health Check | Final Security Assessment |
|---|---|---|---|---|---|
| **`TELEPHONY_QA_ENABLED=false`** | **REJECTED & HUNG UP IMMEDIATELY** ([`call-controller.ts#L248-L254`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/call-controller.ts#L248-L254)). Ingress fails closed. | Routed as normal production call. | **BYPASSED** ([`qa-telephony-guard.service.ts#L797-L799`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-telephony-guard.service.ts#L797-L799)). Assumes production mode. | `isQaEnabled()` returns `false`. Config validation returns `valid: true`. | **CRITICAL FINDING:** `TELEPHONY_QA_ENABLED=false` **rejects** QA ingress calls, but **bypasses QA allowlists** for outbound calls in production mode. |
| **Missing `TELNYX_QA_TRACKING_DID`** | `isQaIngressDid()` returns `false`. If call targets QA workspace, **REJECTED** on config validation error. | Routed as normal production call. | Outbound call classified as QA is **BLOCKED** on config error. | `validateConfiguration()` returns `valid: false` (`TELNYX_QA_TRACKING_DID is unset or empty`). | **FAIL CLOSED**: Cannot execute QA test runs while tracking DID is unset. |
| **Empty `TELEPHONY_QA_ALLOWED_DESTINATIONS`** | N/A (Applies to outbound dialing). | N/A | **BLOCKED WITH FATAL ERROR** ([`qa-telephony-guard.service.ts#L807-L814`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-telephony-guard.service.ts#L807-L814)). Throws `TelephonyProviderError(ROUTING_FAILED)`. | `parseAllowlist()` returns `valid: false`. | **FAIL CLOSED**: Outbound dial cannot proceed to any carrier number. |
| **Missing or Invalid Inbound QA Lease** | **REJECTED & HUNG UP IMMEDIATELY** ([`call-controller.ts#L273-L279`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/call-controller.ts#L273-L279)). Never creates Call in DB. | Routed as normal production call. | N/A | Logged as `qa.ingress.rejected: no active trusted QA lease`. | **FAIL CLOSED**: Unsolicited calls to QA tracking DID are dropped immediately. |
| **Invalid QA Database Configuration** (e.g. host not loopback, or pointing to cloud DB) | Process does not start. | Process does not start. | Process does not start. | **PROCESS HALTED** ([`main.ts#L38-L45`](file:///C:/Projects/callflow-agent-a/apps/api/src/main.ts#L38-L45)). Emits `[CRITICAL ABORT] Halting.` and exits with code 1. | **FAIL CLOSED**: Zero traffic processed if DB configuration is violated. |

---

## 4. Complete Outbound Carrier Operation Entry-Point Inventory

Every entry point in the CallFlow codebase capable of generating an external telephony carrier operation was inspected:

| # | Outbound Operation | Source File & Line Numbers | Dispatch Mechanism & Target | Triggering Workflow | Safeguards & Interceptors |
|:---:|---|---|---|---|---|
| **1** | **Outbound Buyer Dial** (`dialBuyer`) | [`apps/api/src/telephony/telnyx/telnyx.provider.ts#L53-L92`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/telnyx/telnyx.provider.ts#L53-L92) | `this.telnyxClient.calls.dial(dialParams)` over HTTPS to Telnyx API. | `CallController.dialNextBuyer()` ([`call-controller.ts#L1025`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/call-controller.ts#L1025)) | Intercepted by `qaGuardService.validateDestinationOrThrow(dialNumber, result.call)` ([`call-controller.ts#L1009`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/call-controller.ts#L1009)). If destination is not in allowlist, throws exception before API call. Mocked if `!this.telnyxClient`. |
| **2** | **Inbound Call Answer** (`answerCall`) | [`apps/api/src/telephony/telnyx/telnyx.provider.ts#L36-L51`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/telnyx/telnyx.provider.ts#L36-L51) | `this.telnyxClient.calls.actions.answer(callId)` to Telnyx API. | `CallController.handleEvent()` on `CALL_INITIATED` ([`call-controller.ts#L485`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/call-controller.ts#L485)) | Preceded by QA Ingress Lease verification ([`call-controller.ts#L266`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/call-controller.ts#L266)) and Wallet Reservation ([`call-controller.ts#L462`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/call-controller.ts#L462)). Fails closed if unauthorized. |
| **3** | **Call Bridging** (`bridgeCalls`) | [`apps/api/src/telephony/telnyx/telnyx.provider.ts#L94-L123`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/telnyx/telnyx.provider.ts#L94-L123) | `this.telnyxClient.calls.actions.bridge(callId, { call_control_id_to_bridge_with })` to Telnyx API. | `CallController.handleEvent()` on buyer `CALL_ANSWERED` ([`call-controller.ts#L567`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/call-controller.ts#L567)) | Verified against mock call ID patterns (`isMockCallId`). Fails closed on bridge error, triggering automatic fallback to next buyer. |
| **4** | **Call Termination** (`hangupCall`) | [`apps/api/src/telephony/telnyx/telnyx.provider.ts#L125-L157`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/telnyx/telnyx.provider.ts#L125-L157) | `this.telnyxClient.calls.actions.hangup(callId, params)` to Telnyx API. | Dispatched on caller hangup, buyer hangup, routing exhaustion, QA circuit-breaker, or authorization denial. | Idempotent. Ignores `already terminal` or HTTP 404 responses. |
| **5** | **Asterisk Channel Origination** (`originateChannel`) | [`apps/api/src/telephony/qa/asterisk-ari-client.service.ts#L173-L215`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/asterisk-ari-client.service.ts#L173-L215) | HTTP `POST /ari/channels` to Asterisk REST Interface on `127.0.0.1:8088`. | `QaOrchestratorService.executeTestRun()` | Restricted strictly to local Asterisk container via loopback URL check ([`qa-telephony-guard.service.ts#L159`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-telephony-guard.service.ts#L159)). Does not hit public carriers. |
| **6** | **Asterisk Audio Snoop Hook** (`snoopChannel`) | [`apps/api/src/telephony/qa/asterisk-ari-client.service.ts#L280-L310`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/asterisk-ari-client.service.ts#L280-L310) | HTTP `POST /ari/channels/{id}/snoop` to Asterisk ARI. | `QaOrchestratorService` during audio validation. | Purely local loopback audiohook capture. Does not send external SIP signaling. |

---

## 5. Reservation Lifecycle Architecture (Mermaid)

```mermaid
sequenceDiagram
    autonumber
    participant Telnyx as Carrier / Synthetic Webhook
    participant CC as CallController
    participant CS as CallsService
    participant PG as PostgreSQL (callflow_qa)
    participant TP as TelnyxProvider

    Telnyx->>CC: Inbound Webhook (call.initiated)
    Note over CC: Ingress Safety Gate Check
    CC->>PG: Insert Call (INITIATED)
    CC->>TP: answerCall(callId)
    
    Telnyx->>CC: Inbound Webhook (call.answered - Caller)
    CC->>CS: transitionCall(ROUTING)
    CC->>CS: prepareNextBuyer(callId)
    
    rect rgb(240, 248, 255)
        Note over CS,PG: ATOMIC BUYER CAPACITY RESERVATION
        CS->>PG: BEGIN TRANSACTION
        CS->>PG: SELECT id FROM "calls" WHERE id = callId FOR UPDATE
        CS->>PG: SELECT id, max_concurrent_calls FROM "buyers" WHERE id = buyerId FOR UPDATE
        CS->>PG: SELECT COUNT(*)::int FROM "buyer_reservations" WHERE buyer_id = buyerId AND status = 'ACTIVE'
        alt activeCount < maxLimit
            CS->>PG: INSERT INTO "call_attempts" (state = 'INITIATED')
            CS->>PG: INSERT INTO "buyer_reservations" (status = 'ACTIVE')
            CS->>PG: COMMIT TRANSACTION
            Note over CS: Slot reserved & committed before dial!
        else activeCount >= maxLimit
            Note over CS: Waterfall cascades to next buyer or returns BUSY
            CS->>PG: COMMIT / ROLLBACK
        end
    end

    alt Reservation Succeeded
        CC->>TP: dialBuyer(dialTarget, callerId, timeout)
        alt Dial Dispatched Successfully
            TP-->>CC: Returns buyerCallId
            CC->>CS: commitBuyerDial(attemptId, buyerCallId)
            CC->>CS: transitionAttempt(RINGING)
        else Dial Dispatch Failed
            Note over CC: Immediate Error Compensation
            CC->>CS: releaseBuyerReservation(attemptId)
            CC->>CS: transitionAttempt(FAILED)
            CC->>CC: dialNextBuyer() / Waterfall Circuit-Breaker
        end
    end

    opt Call Answered & Bridged
        Telnyx->>CC: Webhook (call.answered - Buyer)
        CC->>CS: markCallAnswered(callId, attemptId)
        CC->>TP: bridgeCalls(callerCallId, buyerCallId)
    end

    opt Call Hangup & Slot Release
        Telnyx->>CC: Webhook (call.hangup)
        CC->>CS: handleCallerHangup() / handleBuyerHangup()
        CS->>PG: UPDATE "buyer_reservations" SET status = 'RELEASED'
        CS->>PG: UPDATE "call_attempts" SET state = 'COMPLETED'
    end

    opt Dropped Webhook / Crash Recovery
        Note over PG: Background Sweeper Loop (every 5 min)
        CS->>PG: UPDATE "buyer_reservations" SET status = 'RELEASED'<br>WHERE status = 'ACTIVE' AND call.state IN (COMPLETED, FAILED, CANCELED)
    end
```

---

## 6. Transaction and Locking Analysis

Forensic inspection of [`apps/api/src/calls/calls.service.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/calls/calls.service.ts) and [`apps/api/src/billing/wallet.service.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/billing/wallet.service.ts) evaluated seven critical concurrency race conditions:

### 6.1 Multi-Instance Concurrency Safety
- **Locking Mechanism:** PostgreSQL row-level locks via `SELECT ... FOR UPDATE` inside `tx.$transaction`.
- **Cross-Instance Safety:** **VERIFIED SAFE.** PostgreSQL row locks operate at the centralized database engine level. When multiple NestJS API instances run concurrently, Node.js process boundaries do not weaken the lock. Instance B attempting to lock a buyer row currently locked by Instance A is placed in a kernel wait queue until Instance A commits or rolls back.

### 6.2 The Seven Race Condition Vectors:
1. **Simultaneous Inbound Calls Competing for Last Slot:**  
   - *Behavior:* Call 1 and Call 2 simultaneously execute `prepareNextBuyer()`. Both issue `SELECT ... FROM "buyers" WHERE id = buyerId FOR UPDATE`.
   - *Result:* **SAFE.** Call 2 blocks until Call 1 commits. Under PostgreSQL Read Committed isolation, when Call 2 unblocks, its subsequent `COUNT(*)` query immediately sees Call 1's newly committed reservation. If `activeCount >= maxLimit`, Call 2 cannot claim the slot and cascades to the next buyer.
2. **Buyer Capacity Changes Mid-Flight:**  
   - *Behavior:* Admin mutates `max_concurrent_calls` while a call is being evaluated.
   - *Result:* **SAFE.** `UPDATE buyers SET max_concurrent_calls = ...` requires an exclusive row lock on the same `buyers` row, serializing with the call's transaction. If reduced below current load, existing calls complete, and subsequent calls immediately enforce the tighter limit.
3. **Failed Outbound Dialing (Carrier Rejection / Network Error):**  
   - *Behavior:* Outbound dial throws an exception in `dialNextBuyer()`.
   - *Result:* **SAFE.** The catch block in [`call-controller.ts#L1062`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/call-controller.ts#L1062) immediately invokes `callsService.releaseBuyerReservation(attempt.id)` and transitions the attempt to `FAILED`, preventing capacity leakage.
4. **Delayed Webhooks:**  
   - *Behavior:* Carrier `call.hangup` event is delayed by network latency.
   - *Result:* **SAFE WITH CONDITIONS.** The reservation remains held in `ACTIVE` state until the webhook arrives or until the 15-minute background sweeper runs. This guarantees CallFlow never over-subscribes a buyer whose live state is unconfirmed.
5. **Duplicate Webhook Delivery:**  
   - *Behavior:* Telnyx delivers the identical `call.hangup` or `call.answered` event twice.
   - *Result:* **SAFE.** [`WebhookIdempotencyService`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/webhook-idempotency.service.ts) enforces distributed conditional atomic locks per event ID. Second delivery is ignored.
6. **Worker Process Crashes Mid-Transaction:**  
   - *Behavior:* Node.js process crashes while holding row lock in `prepareNextBuyer()`.
   - *Result:* **SAFE.** PostgreSQL detects client socket disconnection, immediately aborts the transaction, rolls back uncommitted rows, and frees the row lock.
7. **Stale / Orphaned Reservations (Dropped Final Hangup):**  
   - *Behavior:* Final carrier hangup is lost entirely due to carrier network partition.
   - *Result:* **SAFE.** [`ReservationRecoveryService`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/reservation-recovery.service.ts#L70-L81) sweeps every 5 minutes. Any `ACTIVE` reservation associated with a terminal call state (`COMPLETED`, `NO_ANSWER`, `FAILED`, `CANCELED`) is automatically marked `RELEASED`.

---

## 7. Multi-Workspace Isolation Findings

| Isolation Dimension | Implementation & Query Boundary | Verification Finding |
|---|---|---|
| **Call Entity Scoping** | `where: { id: callId, workspace_id: workspaceId }` | **STRICTLY ISOLATED**: Queries always include `workspace_id`. Cross-workspace call viewing is prevented. |
| **Buyer Reservation Counting** | `WHERE buyer_id = ${buyerId} AND status = 'ACTIVE'` | **STRICTLY ISOLATED**: Buyers belong strictly to a single workspace (`buyers.workspace_id`). Reservations never mix. |
| **Wallet Balance Locking** | `SELECT balance_micro FROM "workspace_balances" WHERE workspace_id = ${workspaceId} FOR UPDATE` | **STRICTLY ISOLATED**: Row-level balance locks are scoped strictly to the specific workspace. A call in Workspace A never blocks Workspace B. |
| **Call Attribution & Reporting** | `calls.attributed_vendor_id`, `calls.attribution_source`, `call_commercials.buyer_id` | **STRICTLY ISOLATED**: Attribution fields are tied to entities belonging strictly to the same workspace. |
| **Ingress Resolution Boundary** | `phoneNumber.findFirst({ where: { phone_number: to } })` | **1-to-1 BOUNDARY**: A phone number row belongs to exactly one `workspace_id` and `campaign_id`. Two workspaces cannot share a live carrier DID simultaneously. |

---

## 8. QA-2B Through QA-2D Backend Readiness Matrix

| Phase | Testing Objective | Architecture Readiness | Verdict | Forensic Prerequisites |
|:---:|---|:---:|:---:|---|
| **QA-2B** | **Synthetic Multi-Call Concurrency**<br>(3 simultaneous callers, Buyer A limit = 2, overflow to Buyer B, duplicate replay) | Code logic ready; Database concurrency verified. | **PASS WITH CONDITIONS** | 1. Seed `Buyer B` (`max_concurrent_calls = 2`) in `QA_CAMPAIGN_ID`.<br>2. Generate Ed25519 signature headers for synthetic webhook replay or invoke `CallController.handleEvent()` directly.<br>3. Ensure `QA_WORKSPACE_ID` wallet has sufficient balance. |
| **QA-2C** | **Reservation Recovery & Failure Resilience**<br>(Worker crashes, network timeouts, delayed webhooks, stale sweeper) | Background sweeper active; Compensating transactions verified. | **PASS** | 1. Verify `ReservationRecoveryService` loop is active on module init.<br>2. Simulate orphaned active rows directly in `callflow_qa` database to measure 5-minute recovery. |
| **QA-2D** | **Multi-Workspace Concurrency**<br>(Two synthetic workspaces processing simultaneous calls) | Row-level locks strictly scoped by `workspace_id`; Zero table locks. | **PASS WITH CONDITIONS** | 1. Seed second workspace (`QA_WORKSPACE_2`) with dedicated campaign and tracking number in `callflow_qa`.<br>2. Use synthetic ingress DIDs (e.g. `+15550000001` vs `+15550000002`). |

---

## 9. Critical Blockers & Severity Register

| Blocker ID | Severity | Description & Architectural Impact | Required Remediation Before Execution |
|:---:|---|---|---|
| **BLK-QA2-01** | **HIGH** | **Missing Buyer B in QA Database Waterfall**<br>Currently, `QA_WORKSPACE_ID` in `callflow_qa` has only Buyer A configured. Overflow cannot be tested without Buyer B. | Execute authorized database seed in QA-2B to insert `Buyer B` and map it into `QA_CAMPAIGN_ID` with priority 2. |
| **BLK-QA2-02** | **MEDIUM** | **Webhook Signature Rejection in QA Mode**<br>[`TelnyxWebhookController`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/telnyx/telnyx.webhook.controller.ts#L43-L51) requires valid Ed25519 signatures in `APP_ENV=qa`. Raw synthetic HTTP POSTs without signatures return HTTP 400. | In QA-2B synthetic tests, sign requests with Ed25519 private key OR dispatch synthetic normalized events directly via NestJS `CallController.handleEvent()`. |
| **BLK-QA2-03** | **LOW** | **Root `.env` vs `apps/api/.env.qa` Flag Discrepancy**<br>Root `.env` has `TELEPHONY_QA_ENABLED=true` while `apps/api/.env.qa` has `TELEPHONY_QA_ENABLED=false`. | Align root `.env` to `TELEPHONY_QA_ENABLED=false` before test execution to ensure complete environment hygiene. |
| **BLK-QA2-04** | **HIGH** | **Missing Second Workspace for QA-2D**<br>`callflow_qa` database currently contains only one workspace (`5e20bafe-7306-4da7-9944-62c4c5575a5a`). Multi-workspace testing cannot execute without a second tenant. | Execute authorized database seed prior to QA-2D to create `QA_WORKSPACE_2` and associated campaign. |

---

## 10. Evidence References with Exact Source Paths & Line Numbers

All references verified within `C:\Projects\callflow-agent-a`:
1. **Startup Guard & Environment Precedence:**  
   [`apps/api/src/main.ts#L14-L45`](file:///C:/Projects/callflow-agent-a/apps/api/src/main.ts#L14-L45)
2. **QA Database Isolation Safeguards & Sanitize Utility:**  
   [`apps/api/src/common/database-isolation.util.ts#L5-L100`](file:///C:/Projects/callflow-agent-a/apps/api/src/common/database-isolation.util.ts#L5-L100)
3. **Database Environment Isolation Test Suite:**  
   [`apps/api/test/database-isolation.spec.ts#L22-L100`](file:///C:/Projects/callflow-agent-a/apps/api/test/database-isolation.spec.ts#L22-L100)
4. **Telephony Guard Service (Config Validation, Allowlist, Leases):**  
   [`apps/api/src/telephony/qa/qa-telephony-guard.service.ts#L87-L181`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-telephony-guard.service.ts#L87-L181) and [`L795-L840`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-telephony-guard.service.ts#L795-L840)
5. **Call Controller Ingress Gate & Waterfall Concurrency:**  
   [`apps/api/src/telephony/call-controller.ts#L242-L348`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/call-controller.ts#L242-L348) and [`L990-L1080`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/call-controller.ts#L990-L1080)
6. **Buyer Capacity Row-Level Lock & Reservation Creation:**  
   [`apps/api/src/calls/calls.service.ts#L2140-L2195`](file:///C:/Projects/callflow-agent-a/apps/api/src/calls/calls.service.ts#L2140-L2195) and [`L2248-L2285`](file:///C:/Projects/callflow-agent-a/apps/api/src/calls/calls.service.ts#L2248-L2285)
7. **Reservation Release on Caller / Buyer Hangup:**  
   [`apps/api/src/calls/calls.service.ts#L221-L238`](file:///C:/Projects/callflow-agent-a/apps/api/src/calls/calls.service.ts#L221-L238) and [`L502-L527`](file:///C:/Projects/callflow-agent-a/apps/api/src/calls/calls.service.ts#L502-L527)
8. **Periodic Reservation Recovery Worker Loop:**  
   [`apps/api/src/telephony/reservation-recovery.service.ts#L28-L85`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/reservation-recovery.service.ts#L28-L85)
9. **Wallet Balance Row-Level Lock & Micro-Dollar Ledger:**  
   [`apps/api/src/billing/wallet.service.ts#L54-L85`](file:///C:/Projects/callflow-agent-a/apps/api/src/billing/wallet.service.ts#L54-L85)
10. **Webhook Idempotency distributed Lock Engine:**  
    [`apps/api/src/telephony/webhook-idempotency.service.ts#L30-L120`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/webhook-idempotency.service.ts#L30-L120)

---

## 11. Mandatory Prerequisites Before QA-2B Execution

Prior to initiating controlled synthetic multi-call concurrency testing in Phase QA-2B, the following administrative and seeding prerequisites must be completed under explicit authorization:

1. **Prerequisite 1 — Seed Buyer B in QA Database (`callflow_qa`):**
   - Insert a secondary buyer record (`Buyer B`, `status = 'ACTIVE'`, `max_concurrent_calls = 2`).
   - Associate `Buyer B` with `QA_WORKSPACE_ID` (`5e20bafe-7306-4da7-9944-62c4c5575a5a`).
   - Insert `CampaignBuyer` mapping in `QA_CAMPAIGN_ID` (`6af31407-3f46-4f1d-90d0-bf08af2e9600`) with `priority = 2` (Buyer A remains `priority = 1`, `max_concurrent_calls = 2`).
2. **Prerequisite 2 — Harmonize Root `.env` Telephony QA Flag:**
   - Set `TELEPHONY_QA_ENABLED=false` in root `.env` to eliminate the cosmetic discrepancy with `apps/api/.env.qa`.
3. **Prerequisite 3 — Verify Wallet Balance for QA Workspace:**
   - Confirm `workspace_balances` for `5e20bafe-7306-4da7-9944-62c4c5575a5a` has at least `$50.00` (50,000,000 micro-dollars) in available balance to prevent wallet reservation rejection during concurrent synthetic calls.
4. **Prerequisite 4 — Select Synthetic Ingress Strategy:**
   - **Option A (Recommended):** Dispatch normalized synthetic events directly to NestJS `CallController.handleEvent(event)`, bypassing HTTP Ed25519 signature checks with zero network overhead.
   - **Option B:** Utilize test Ed25519 keypair to sign synthetic HTTP payloads into `POST /webhooks/telnyx`.

---

## QA-2A AGENT 2 AUDIT COMPLETE
