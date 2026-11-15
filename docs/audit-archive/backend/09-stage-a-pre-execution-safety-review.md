# CALLFLOW — PHASE QA-2A-FINAL: STAGE A PRE-EXECUTION SAFETY REVIEW

**Document ID:** `CALLFLOW-PHASE-QA-2A-FINAL-STAGE-A-SAFETY-REVIEW`  
**Assigned Agent:** Agent 2 — Backend, API, Database & Security  
**Review Type:** STRICT READ-ONLY FORENSIC REVIEW  
**Scope:** Stage A Synthetic Backend Test Harness Only  
**Output Deliverable:** [`qa/reports/qa-2a-final-consolidation/09-stage-a-pre-execution-safety-review.md`](file:///C:/Projects/callflow-agent-a/qa/reports/qa-2a-final-consolidation/09-stage-a-pre-execution-safety-review.md)  
**Evaluation Date:** November 12, 2026  
**Implementation / Mutation Permission:** NONE (Zero code changes, zero database writes, zero test execution)

---

## 1. Executive Verdict

# **`VERDICT: PASS WITH CONDITIONS`**

### Summary Justification:
1. **Mock ID & Schema Compatibility (QUESTION 1: PASS):** Forensic inspection of Prisma schema and PostgreSQL migrations confirms that both `calls.provider_call_id` and `calls.id` are defined as PostgreSQL `TEXT NOT NULL`. Strings prefixed with `mock_` or `fake_` do not violate database column types, Prisma schema validation, or foreign-key constraints. In `CallController.handleEvent`, Prisma generates a native UUID for primary key `calls.id`, while storing the incoming event `callId` into `provider_call_id`.
2. **Dispatch Path & Carrier Isolation (QUESTION 2: PASS):** Overriding `TELEPHONY_PROVIDER` with `FakeTelephonyProvider` in a Vitest `TestingModule` completely isolates the Stage A execution path. `CallController.handleEvent` dispatches strictly to `FakeTelephonyProvider` in-memory. Zero code paths in `handleEvent` connect to `TelnyxProvider`, `AsteriskAriClientService`, ARI port 8088, Asterisk PJSIP UDP 5060, or `TelnyxProvisioningService`.
3. **Mandatory Conditions Before Execution:**
   - **Condition 1 (Database Seed):** Secondary buyer `Buyer B` (`max_concurrent_calls = 2`, `priority = 2`) must be seeded into `callflow_qa` (`127.0.0.1:5433`) under explicit user approval; otherwise, Call 3 will fail to route to an overflow destination.
   - **Condition 2 (Execution Scope):** Stage A must execute strictly within an isolated Vitest test harness (`*.spec.ts`) compiling an overridden `TestingModule`. Launching via standard application bootstrap (`main.ts`) is strictly prohibited.
   - **Condition 3 (Teardown Hygiene):** The test harness must invoke `app.close()` in `afterAll()` to cleanly terminate background interval timers in `ReservationRecoveryService` and `WebhooksService`.

---

## 2. Question 1 — Mock ID / Schema Compatibility

### 2.1 Prisma Model and PostgreSQL Database Type
Forensic inspection of the `Call` and `CallAttempt` models in [`apps/api/prisma/schema.prisma#L371-L437`](file:///C:/Projects/callflow-agent-a/apps/api/prisma/schema.prisma#L371-L437) and migration [`20260921132240_init_stage13/migration.sql#L8-L37`](file:///C:/Projects/callflow-agent-a/apps/api/prisma/migrations/20260921132240_init_stage13/migration.sql#L8-L37):

```sql
CREATE TABLE "calls" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "campaign_id" TEXT,
    "provider" TEXT NOT NULL,
    "provider_call_id" TEXT NOT NULL,
    "from_number" TEXT NOT NULL,
    "to_number" TEXT NOT NULL,
    "state" "CallState" NOT NULL DEFAULT 'INITIATED',
    "duration_secs" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calls_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "calls_provider_call_id_key" ON "calls"("provider_call_id");
```

```sql
CREATE TABLE "call_attempts" (
    "id" TEXT NOT NULL,
    "call_id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "provider_call_id" TEXT,
    "state" "CallAttemptState" NOT NULL DEFAULT 'INITIATED',
    "duration_secs" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_attempts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "call_attempts" ADD CONSTRAINT "call_attempts_call_id_fkey" 
FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

#### Key Forensic Column Properties:
- **`calls.id`:** Defined as `TEXT NOT NULL` in PostgreSQL. In Prisma, it specifies `@default(uuid())`. If omitted during creation, Prisma generates a standard RFC 4122 v4 UUID in TypeScript client memory.
- **`calls.provider_call_id`:** Defined as `TEXT NOT NULL` with a `UNIQUE` index in PostgreSQL. There is **no database-level UUID constraint, no regex check, and no fixed character length limit**.
- **`call_attempts.id`:** Defined as `TEXT NOT NULL`.
- **`call_attempts.provider_call_id`:** Defined as `TEXT` (nullable) with a `UNIQUE` index.
- **Foreign Keys:** `call_attempts.call_id`, `buyer_reservations.call_id`, `call_commercials.call_id`, and `recordings.call_id` are all defined as `TEXT NOT NULL` matching `calls.id`.

---

### 2.2 Compatibility of `mock_...` and `fake_...` Prefixes
- **Are `mock_...` and `fake_...` compatible with the actual database type?**  
  **YES.** Because the underlying PostgreSQL column type is `TEXT`, any arbitrary string conforming to valid UTF-8 (e.g. `"mock_call_001"`, `"fake_call_abc_123"`) is 100% valid.
- **Would either prefix fail during Prisma validation or SQL insertion?**  
  **NO.** Prisma validation checks that the value satisfies `typeof value === 'string'`. Because there is no `@db.Uuid` attribute on `provider_call_id`, Prisma will not attempt to parse it as a native 128-bit binary UUID. SQL insertion executes cleanly.
- **Would foreign-key constraints fail?**  
  **NO.** In [`CallController.handleEvent`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/call-controller.ts#L436-L447):
  ```typescript
  call = await this.callsService.createCall({
    workspace_id: trackingNumber.workspace_id,
    campaign_id: trackingNumber.campaign_id || undefined,
    phone_number_id: trackingNumber.id,
    vendor_id: vendorId,
    attributed_vendor_id: vendorId,
    attribution_source: attributionSource,
    provider: 'provider',
    provider_call_id: callId, // <-- Incoming event callId (e.g. "mock_call_001")
    from_number: from!,
    to_number: to!,
  });
  ```
  Prisma generates a native UUID for primary key `call.id` (e.g. `c7b5f12e-...`), while storing the incoming synthetic identifier into `call.provider_call_id`. All downstream foreign-key relations (`call_attempts`, `buyer_reservations`, `call_commercials`) link to `call.id`. Foreign keys remain 100% valid.

---

### 2.3 Persistence vs. In-Memory Usage
- **In-Memory:** In the synthetic event payload passed to `callController.handleEvent(event)`, `event.callId` is passed as `"mock_call_001"`.
- **Persisted:** `event.callId` is persisted into `calls.provider_call_id` in PostgreSQL table `calls`. Subsequent lookups by `provider_call_id` (`prisma.call.findUnique({ where: { provider_call_id: callId } })`) succeed with standard index scans.

---

### 2.4 Is the Prefix Required or Invoked in Stage A?
- **Is the prefix required for `FakeTelephonyProvider`?**  
  **NO.** `FakeTelephonyProvider` ([`fake.provider.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/fake.provider.ts)) intercepts all calls unconditionally without checking call ID string patterns.
- **Is `TelnyxProvider.isMockCallId()` invoked anywhere in Stage A?**  
  **NO.** `isMockCallId()` is a private method in `TelnyxProvider` ([`telnyx.provider.ts#L26-L34`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/telnyx/telnyx.provider.ts#L26-L34)). Because `CallController` is injected with `FakeTelephonyProvider`, `TelnyxProvider` is never called, and `isMockCallId()` is never executed. Using `mock_` prefixes provides defense-in-depth in the event of an accidental provider leak, but is not required by `FakeTelephonyProvider`.

---

## 3. Question 2 — Alternate Dispatch Path Analysis

### 3.1 Test Setup & Provider Override
The Stage A test harness initializes an isolated NestJS `TestingModule`:
```typescript
const moduleRef = await Test.createTestingModule({
  imports: [AppModule],
})
  .overrideProvider(TELEPHONY_PROVIDER)
  .useClass(FakeTelephonyProvider)
  .compile();

const callController = moduleRef.get(CallController);
await callController.handleEvent(normalizedEvent);
```

#### 1. Is the provider override applied to every relevant consumer?
- **Forensic Check:** Every consumer of the injection token `TELEPHONY_PROVIDER` across the entire codebase was audited:
  1. [`CallController`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/call-controller.ts#L25) (`constructor(@Inject(forwardRef(() => TELEPHONY_PROVIDER)) private readonly provider: TelephonyProvider)`)
  2. [`ReservationRecoveryService`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/reservation-recovery.service.ts#L24) (`constructor(@Inject(forwardRef(() => TELEPHONY_PROVIDER)) private readonly provider: TelephonyProvider)`)
- **Result:** **YES.** No other services inject `TELEPHONY_PROVIDER`. Both consumers receive the singleton instance of `FakeTelephonyProvider`.

#### 2. Does any service independently instantiate or invoke `TelnyxProvider`?
- **Forensic Check:** In [`TelephonyModule`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/telephony.module.ts#L44-L61), `TelnyxProvider` is listed in `providers`. During NestJS compilation of `AppModule`, `TelnyxProvider`'s constructor is called.
- In `TelnyxProvider`'s constructor ([`telnyx.provider.ts#L15-L24`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/telnyx/telnyx.provider.ts#L15-L24)), it merely stores an instance of `new Telnyx({ apiKey })` in memory. It makes **zero network connections** on instantiation.
- Because `CallController` injects `FakeTelephonyProvider`, `TelnyxProvider` is orphaned in the DI container. Its methods (`answerCall`, `dialBuyer`, `bridgeCalls`, `hangupCall`) are **never invoked**.

---

### 3.2 Direct Event Injection Synchronous Call Graph
Tracing execution from `callController.handleEvent(normalizedEvent)` for `CALL_INITIATED`:

```
CallController.handleEvent(event)
 │
 ├── 1. qaGuardService.isQaIngressDid(to) ─────────────> Local string comparison (No network)
 ├── 2. prisma.phoneNumber.findFirst({ where: { to } })> Local PostgreSQL (Port 5433)
 ├── 3. callsService.createCall(...) ──────────────────> Local PostgreSQL (Port 5433)
 ├── 4. qaGuardService.bindCallToTestRun(...) ─────────> In-memory Map operation (No network)
 ├── 5. walletService.reserveForCall(...) ─────────────> Bypassed via qa.wallet.bypass
 ├── 6. this.provider.answerCall(callId) ──────────────> FakeTelephonyProvider.answerCall() (In-Memory!)
 ├── 7. callsService.transitionCall(ROUTING) ──────────> Local PostgreSQL (Port 5433)
 └── 8. this.dialNextBuyer(call.id)
          │
          ├── a. callsService.prepareNextBuyer(...) ───> PostgreSQL tx: SELECT ... FOR UPDATE
          │                                              Inserts call_attempt & buyer_reservation
          ├── b. qaGuardService.validateDestination... > Local allowlist string check
          ├── c. qaSipAdapter.resolveBuyerDestination > Local string resolution
          ├── d. this.provider.dialBuyer(...) ─────────> FakeTelephonyProvider.dialBuyer() (In-Memory!)
          ├── e. callsService.commitBuyerDial(...) ────> Local PostgreSQL (Port 5433)
          ├── f. callsService.transitionAttempt(RINGING)> Local PostgreSQL (Port 5433)
          └── g. webhooksService.queueEvent(...) ──────> Inserts row into webhook_deliveries
```

#### Detailed Reachability Audit:
- **Telnyx REST API Reachability:** **ZERO.** Call control delegates entirely to `this.provider`, which resolves to `FakeTelephonyProvider`. `FakeTelephonyProvider` appends `{ action: 'dial', ... }` to `this.actions` array and returns string `'fake-buyer-call-1'`. No HTTP requests to `api.telnyx.com` are generated.
- **Asterisk ARI Reachability:** **ZERO.** `CallController` does not inject `AsteriskAriClientService` and has no references to port `8088`. Zero HTTP requests are made to Asterisk.
- **Telnyx SIP/PJSIP Reachability:** **ZERO.** Asterisk channel origination is never invoked. Asterisk PJSIP UDP port 5060 remains completely idle.
- **Telnyx Provisioning SDK Reachability:** **ZERO.** `TelnyxProvisioningService` is part of `PhoneNumbersModule` and is only reached by admin provisioning routes (`POST /phone-numbers`). It is never invoked during call processing.

---

### 3.3 Background Dispatch & Asynchronous Workers
Inspection of background loops active in `AppModule`:
1. **`ReservationRecoveryService` (`reservation-recovery.service.ts#L28-L85`):**
   - Runs on a 5-minute `setInterval` timer.
   - If triggered, invokes `this.provider.getCallStatus(providerCallId)`.
   - Because `TELEPHONY_PROVIDER` is overridden, it executes `FakeTelephonyProvider.getCallStatus()`, which reads in-memory Map `this.mockedStatuses`. It makes **zero external calls**.
2. **`WebhooksService` (`webhooks.service.ts#L22-L25`):**
   - Runs on a 5-second `setInterval` timer.
   - Polls `webhook_deliveries` for pending customer webhooks.
   - For `QA_WORKSPACE_ID`, no customer outbound webhook endpoints exist. If any existed, deliveries use `safeFetch` targeting customer URLs, never telephony carriers.
3. **`UsageBillingService` / `WalletService`:**
   - Execute strictly against local PostgreSQL tables (`wallet_transactions`, `workspace_balances`).

---

### 3.4 AppModule Initialization Side Effects
- **PrismaService:** Connects to local PostgreSQL at `127.0.0.1:5433/callflow_qa`. (Local loopback only).
- **JwtStrategy:** Configured with `SUPABASE_URL`. Lazy-loads public JWKS public keys only when an authenticated HTTP request arrives bearing a Bearer JWT. Direct event injection bypasses the HTTP layer and does not trigger JWKS network fetches.
- **Zero Carrier Side Effects:** No provider registers an `onModuleInit` hook that dials or provisions telephony resources.

---

## 4. Isolation Matrix

| Boundary Dimension | Result | Concrete Source Code / Runtime Evidence |
|---|:---:|---|
| **Fake Provider Injected into CallController** | **PASS** | [`call-controller.ts#L25`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/call-controller.ts#L25): Injects `TELEPHONY_PROVIDER`, replaced by `FakeTelephonyProvider` in `TestingModule`. |
| **Telnyx REST Call-Control Isolation** | **PASS** | [`fake.provider.ts#L20-L55`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/fake.provider.ts#L20-L55): `answer`, `dial`, `bridge`, `hangup` push to in-memory array `this.actions[]`. Zero REST calls. |
| **Asterisk ARI Isolation** | **PASS** | [`call-controller.ts#L1-L40`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/call-controller.ts#L1-L40): `CallController` does not inject `AsteriskAriClientService`. Zero HTTP requests to port 8088. |
| **Telnyx SIP/PJSIP Carrier Isolation** | **PASS** | Zero Asterisk channels originated. Asterisk PJSIP UDP 5060 socket remains completely dormant. |
| **Telnyx Provisioning SDK Isolation** | **PASS** | [`phone-numbers.service.ts#L11`](file:///C:/Projects/callflow-agent-a/apps/api/src/phone-numbers/phone-numbers.service.ts#L11): `TelnyxProvisioningService` is isolated to admin routes; unreferenced in call path. |
| **Background Dispatch Isolation** | **PASS** | [`reservation-recovery.service.ts#L24`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/reservation-recovery.service.ts#L24): Injects overridden `FakeTelephonyProvider`. `WebhooksService` has no carrier links. |
| **Mock ID Schema Compatibility** | **PASS** | [`20260921132240_init_stage13/migration.sql#L8-L22`](file:///C:/Projects/callflow-agent-a/apps/api/prisma/migrations/20260921132240_init_stage13/migration.sql#L8-L22): `calls.provider_call_id` is PostgreSQL `TEXT`. Zero type collisions. |

---

## 5. Unresolved Risks & Missing Pre-Execution Items

The following items are technical prerequisites that must be resolved prior to Stage A execution:

1. **Missing Database Record for Buyer B (Functional Blocker):**  
   - *Risk:* In `callflow_qa` (`127.0.0.1:5433`), `QA_CAMPAIGN_ID` currently maps only to Buyer A.
   - *Impact:* When Call 3 arrives and Buyer A is saturated (2/2), `prepareNextBuyer()` will find no secondary destination, mark Call 3 as `NO_ANSWER`/`FAILED`, and return `{ action: 'HANGUP' }` instead of `{ action: 'DIAL', buyer: Buyer B }`.
   - *Required Action:* The database seed inserting `Buyer B` (`max_concurrent_calls = 2`, `priority = 2`) must be executed under explicit user authorization prior to running Stage A.
2. **Background Interval Teardown in Test Runner:**  
   - *Risk:* `ReservationRecoveryService` (5 min) and `WebhooksService` (5 sec) register Node.js `setInterval` timers on module init.
   - *Impact:* If `app.close()` is omitted in `afterAll()`, the Vitest process will hang after test completion due to active event loop handles.
   - *Required Action:* The Stage A test file must include `afterAll(async () => { await app.close(); });`.
3. **Scope Limitation of Direct Event Injection:**  
   - *Risk:* Direct injection bypasses Express HTTP middleware, body parsers, and Ed25519 signature checks.
   - *Impact:* Stage A validates concurrency locks and waterfall logic, but does **not** validate webhook HTTP ingestion.
   - *Required Action:* Document that HTTP ingress verification is deferred to Stage C.

---

## 6. Final Stage A Pre-Execution Recommendation

# **`RECOMMENDATION: READY FOR SEPARATE USER AUTHORIZATION`**

### Technical Review Finding:
- **QUESTION 1 (Schema Compatibility):** **PASS**. Mock call IDs (`mock_...`, `fake_...`) are 100% compatible with the Prisma schema and PostgreSQL `TEXT` columns.
- **QUESTION 2 (Dispatch Path Isolation):** **PASS**. Overriding `TELEPHONY_PROVIDER` with `FakeTelephonyProvider` in a Vitest `TestingModule` provides 100% verified carrier isolation for call control, REST, ARI, and SIP.

### Crucial Jurisdictional Boundary:
This document is a technical pre-execution safety review. **It does NOT authorize, trigger, or execute Stage A.** 

Agent 2 has performed zero database writes, zero code modifications, and zero test executions. Proceeding to Stage A execution remains strictly subject to **separate, explicit user authorization** and the prior execution of the authorized Buyer B database seed.

---

**STAGE A PRE-EXECUTION SAFETY REVIEW COMPLETE**  
*Agent 2 — Backend, API, Database & Security*  
*November 12, 2026*
