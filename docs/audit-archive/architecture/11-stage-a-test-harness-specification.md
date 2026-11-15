# CALLFLOW — QA-2B STAGE A: TEST HARNESS SPECIFICATION

**Document ID:** `CALLFLOW-PHASE-QA-2B-STAGE-A-TEST-SPECIFICATION`  
**Assigned Agent:** Agent 2 — Backend, API, Database & Security  
**Review Type:** READ-ONLY TEST HARNESS DESIGN  
**Target File:** [`qa/reports/qa-2a-final-consolidation/11-stage-a-test-harness-specification.md`](file:///C:/Projects/callflow-agent-a/qa/reports/qa-2a-final-consolidation/11-stage-a-test-harness-specification.md)  
**Evaluation Date:** November 12, 2026  
**Implementation / Execution Permission:** NONE (Design specification only; zero code changes, zero test execution)

---

## 1. Executive Summary & Objective

This document delivers the technical specification for the **Phase QA-2B Stage A Synthetic Backend Test Harness**. 

Stage A is designed to validate CallFlow's core multi-call concurrency locking, buyer capacity saturation, and waterfall overflow routing using in-memory direct event injection against the isolated PostgreSQL QA database (`callflow_qa` on port `5433`).

### Core Design Principles:
1. **Strict Zero-Carrier-Risk Architecture:** The test executes within an isolated NestJS `TestingModule` using `FakeTelephonyProvider` and a mocked `WebhooksService`. Standard `main.ts` application bootstrap is avoided, Asterisk ARI is never invoked, and outbound carrier REST/SIP signaling is mechanically unreachable.
2. **Deterministic Database Concurrency:** Validates PostgreSQL `SELECT ... FOR UPDATE` row locks, atomic reservation creation, and capacity skipping (`continue;`) across 3 concurrent simulated inbound calls.
3. **Purely Synthetic Fixtures:** Destination number `+12025550198` and call IDs (`mock_call_001`, `mock_call_002`, `mock_call_003`) remain strictly virtual fixtures and are never dispatched to external networks.

---

## 2. Test File Location & Structure Recommendation

### Proposed Test File Path:
`apps/api/test/stage-a-concurrency.e2e-spec.ts`

### Recommended Framework:
- **Runner:** Vitest (`vitest run test/stage-a-concurrency.e2e-spec.ts`)
- **Isolation Context:** Single-process Node.js execution environment connected to `127.0.0.1:5433/callflow_qa`.

---

## 3. Test Module Configuration & Provider Overrides

### 3.1 Exact NestJS `TestingModule` Definition
The test harness must compile an isolated NestJS testing module with explicit provider overrides:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { CallController, TELEPHONY_PROVIDER } from '../src/telephony/call-controller.js';
import { FakeTelephonyProvider } from '../src/telephony/fake.provider.js';
import { WebhooksService } from '../src/webhooks/webhooks.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { CallsService } from '../src/calls/calls.service.js';

let moduleRef: TestingModule;
let callController: CallController;
let fakeProvider: FakeTelephonyProvider;
let prisma: PrismaService;
let callsService: CallsService;

// Mock WebhooksService to eliminate customer HTTP delivery egress
const mockWebhooksService = {
  queueEvent: vi.fn().mockResolvedValue(undefined),
  processDeliveries: vi.fn().mockResolvedValue(undefined),
};

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(TELEPHONY_PROVIDER)
    .useClass(FakeTelephonyProvider)
    .overrideProvider(WebhooksService)
    .useValue(mockWebhooksService)
    .compile();

  // Retrieve isolated singletons
  callController = moduleRef.get(CallController);
  fakeProvider = moduleRef.get<FakeTelephonyProvider>(TELEPHONY_PROVIDER);
  prisma = moduleRef.get(PrismaService);
  callsService = moduleRef.get(CallsService);
});
```

### 3.2 Verification of Provider Consumers
- **`CallController`:** Consumes `TELEPHONY_PROVIDER` via constructor injection ([`call-controller.ts#L25`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/call-controller.ts#L25)). Receives `FakeTelephonyProvider`.
- **`ReservationRecoveryService`:** Consumes `TELEPHONY_PROVIDER` via constructor injection ([`reservation-recovery.service.ts#L24`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/reservation-recovery.service.ts#L24)). Receives `FakeTelephonyProvider`.
- **Standard Bootstrap Avoidance:** Standard bootstrap ([`apps/api/src/main.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/main.ts)) is completely avoided. No HTTP listener is bound to port 3000.
- **Asterisk ARI Avoidance:** `AsteriskAriClientService` and `QaOrchestratorService` are not referenced, instantiated, or invoked.

---

## 4. External Egress Isolation Specification

To guarantee 100% carrier and network isolation, six specific boundaries are enforced:

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                               STAGE A EXTERNAL EGRESS ISOLATION MATRIX                      │
├──────────────────────────┬─────────────────────────────┬────────────────────────────────────┤
│ POTENTIAL EGRESS PATH    │ ISOLATION MECHANISM         │ VERIFICATION STATUS                │
├──────────────────────────┼─────────────────────────────┼────────────────────────────────────┤
│ 1. Telnyx REST Dialing   │ FakeTelephonyProvider       │ PROVEN: actions recorded in-memory.│
│                          │ override on TELEPHONY_PROV  │ Zero calls to api.telnyx.com.      │
├──────────────────────────┼─────────────────────────────┼────────────────────────────────────┤
│ 2. Asterisk ARI (:8088)  │ CallController has zero     │ PROVEN: AsteriskAriClientService   │
│                          │ references to ARI client.   │ is never invoked in call path.     │
├──────────────────────────┼─────────────────────────────┼────────────────────────────────────┤
│ 3. Telnyx SIP UDP :5060  │ Zero Asterisk channel       │ PROVEN: Asterisk PJSIP trunk       │
│                          │ origination triggered.      │ remains uninvoked by backend.      │
├──────────────────────────┼─────────────────────────────┼────────────────────────────────────┤
│ 4. Telnyx Provisioning   │ Admin routes not called;    │ PROVEN: TelnyxProvisioningService  │
│                          │ phoneNumbersService idle.   │ is untouched by handleEvent().     │
├──────────────────────────┼─────────────────────────────┼────────────────────────────────────┤
│ 5. Customer Webhooks     │ WebhooksService.queueEvent  │ PROVEN: mockWebhooksService absorbs│
│    (HTTP/HTTPS)          │ explicitly mocked via vi.fn │ calls; zero safeFetch() dispatches.│
├──────────────────────────┼─────────────────────────────┼────────────────────────────────────┤
│ 6. Supabase JWKS         │ Direct event injection calls│ PROVEN: JwtAuthGuard and           │
│                          │ handleEvent() directly.     │ JwksClient are not invoked.        │
└──────────────────────────┴─────────────────────────────┴────────────────────────────────────┘
```

---

## 5. Test Database and Fixture Requirements

### 5.1 QA Database Identity & Safeguards
- **Host:** `127.0.0.1` (Local loopback)
- **Port:** `5433` (Docker: `callflow-postgres-qa`)
- **Database Name:** `callflow_qa`
- **User:** `callflow_qa_user`
- **Sanitized Connection URL:** `postgresql://callflow_qa_user:***@127.0.0.1:5433/callflow_qa?schema=public`
- **Isolation Utility Check:** The test file must invoke `assertNonProductionDatabase(process.env.DATABASE_URL)` in `beforeAll()`.

---

### 5.2 Required Database Entity Fixtures

#### 1. Workspace (Pre-Existing)
- `id`: `5e20bafe-7306-4da7-9944-62c4c5575a5a`
- `name`: `"QA Workspace"`
- `status`: `"ACTIVE"`

#### 2. Tracking Phone Number (Pre-Existing)
- `phone_number`: `"+17252574041"` (Dedicated QA Tracking DID)
- `workspace_id`: `5e20bafe-7306-4da7-9944-62c4c5575a5a`
- `campaign_id`: `6af31407-3f46-4f1d-90d0-bf08af2e9600`
- `status`: `"ACTIVE"`

#### 3. Campaign (Pre-Existing)
- `id`: `6af31407-3f46-4f1d-90d0-bf08af2e9600`
- `workspace_id`: `5e20bafe-7306-4da7-9944-62c4c5575a5a`
- `status`: `"ACTIVE"`
- `default_revenue_amount`: `50.0000`
- `default_payout_amount`: `25.0000`

#### 4. Buyer A (Pre-Existing)
- `id`: Pre-existing Buyer A UUID in `callflow_qa`
- `name`: `"Buyer A"`
- `destination_number`: `"+12025550199"`
- `max_concurrent_calls`: `2` (Updated limit)
- `status`: `"ACTIVE"`
- `priority`: `1` in `campaign_buyers` and `campaign_destination_numbers`

#### 5. Buyer B (Proposed Seed Prerequisite — Subject to Separate Authorization)
- `id`: `b0000000-0000-0000-0000-000000000002`
- `workspace_id`: `5e20bafe-7306-4da7-9944-62c4c5575a5a`
- `name`: `"QA Test Buyer B (Overflow)"`
- `destination_number`: `"+12025550198"` (Synthetic fixture)
- `max_concurrent_calls`: `2`
- `status`: `"ACTIVE"`
- `destination_numbers` row: `id`: `d0000000-0000-0000-0000-000000000002`, `destination_number`: `"+12025550198"`, `max_concurrent_calls`: `2`
- `campaign_destination_numbers` row: `campaign_id`: `6af31407-3f46-4f1d-90d0-bf08af2e9600`, `priority`: `2`, `status`: `"ACTIVE"`
- `campaign_buyers` row: `campaign_id`: `6af31407-3f46-4f1d-90d0-bf08af2e9600`, `buyer_id`: `b0000000-0000-0000-0000-000000000002`, `priority`: `2`, `status`: `"ACTIVE"`

---

### 5.3 Database Cleanup Strategy
To prevent test pollution without modifying shared fixtures:
- The test harness maintains an array: `const testCallIds: string[] = [];`.
- Every injected synthetic call ID (`mock_call_001`, `mock_call_002`, `mock_call_003`) is tracked.
- In `afterAll()`, cleanup executes targeted deletions by `provider_call_id`:
  ```typescript
  afterAll(async () => {
    if (testCallIds.length > 0) {
      // Cascades to call_attempts, buyer_reservations, call_commercials
      await prisma.call.deleteMany({
        where: { provider_call_id: { in: testCallIds } },
      }).catch(console.error);
    }
    await moduleRef.close();
  });
  ```
- **Prohibition:** `TRUNCATE`, `DROP TABLE`, or deletion of pre-existing `buyers`, `campaigns`, or `workspaces` is strictly forbidden.

---

## 6. Test Scenario Matrix & Expected Assertions

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   STAGE A TEST SCENARIO SPECIFICATION                                  │
├─────────┬──────────────────────┬──────────────────────┬────────────────────────┬───────────────────────┤
│ STEP    │ SIMULATED EVENT      │ INGRESS PARAMETERS   │ EXPECTED DATABASE      │ EXPECTED FAKE PROVIDER│
│         │                      │                      │ STATE                  │ ACTION                │
├─────────┼──────────────────────┼──────────────────────┼────────────────────────┼───────────────────────┤
│ Call 1  │ CALL_INITIATED       │ callId: mock_call_001│ Call: ROUTING          │ answer(mock_call_001) │
│         │ direction: incoming  │ from: +15550001111   │ Attempt 1: Buyer A     │ dial(Buyer A,         │
│         │                      │ to: +17252574041     │ Buyer A Res: ACTIVE (1)│ mock_call_001)        │
├─────────┼──────────────────────┼──────────────────────┼────────────────────────┼───────────────────────┤
│ Call 2  │ CALL_INITIATED       │ callId: mock_call_002│ Call: ROUTING          │ answer(mock_call_002) │
│ (Concur)│ direction: incoming  │ from: +15550002222   │ Attempt 1: Buyer A     │ dial(Buyer A,         │
│         │                      │ to: +17252574041     │ Buyer A Res: ACTIVE (2)│ mock_call_002)        │
│         │                      │                      │ (BUYER A SATURATED!)   │                       │
├─────────┼──────────────────────┼──────────────────────┼────────────────────────┼───────────────────────┤
│ Call 3  │ CALL_INITIATED       │ callId: mock_call_003│ Call: ROUTING          │ answer(mock_call_003) │
│ (Overfl)│ direction: incoming  │ from: +15550003333   │ Attempt 1: Buyer B     │ dial(Buyer B,         │
│         │                      │ to: +17252574041     │ (Buyer A skipped!)     │ mock_call_003)        │
│         │                      │                      │ Buyer B Res: ACTIVE (1)│                       │
└─────────┴──────────────────────┴──────────────────────┴────────────────────────┴───────────────────────┘
```

### 6.1 Exact Test Assertions:

#### Assertion 1 — Call 1 Routes to Buyer A
```typescript
const call1 = await prisma.call.findUnique({
  where: { provider_call_id: 'mock_call_001' },
  include: { attempts: true, buyerReservations: true },
});
expect(call1).toBeDefined();
expect(call1.state).toBe(CallState.ROUTING);
expect(call1.attempts).toHaveLength(1);
expect(call1.attempts[0].buyer_id).toBe(buyerAId);
expect(call1.buyerReservations).toHaveLength(1);
expect(call1.buyerReservations[0].buyer_id).toBe(buyerAId);
expect(call1.buyerReservations[0].status).toBe('ACTIVE');
```

#### Assertion 2 — Call 2 Concurrently Routes to Buyer A (Saturating Capacity)
```typescript
const call2 = await prisma.call.findUnique({
  where: { provider_call_id: 'mock_call_002' },
  include: { attempts: true, buyerReservations: true },
});
expect(call2.attempts[0].buyer_id).toBe(buyerAId);
expect(call2.buyerReservations[0].buyer_id).toBe(buyerAId);

const buyerAActiveCount = await prisma.buyerReservation.count({
  where: { buyer_id: buyerAId, status: 'ACTIVE' },
});
expect(buyerAActiveCount).toBe(2); // Buyer A at max limit!
```

#### Assertion 3 — Call 3 Skips Saturated Buyer A and Overflows to Buyer B
```typescript
const call3 = await prisma.call.findUnique({
  where: { provider_call_id: 'mock_call_003' },
  include: { attempts: true, buyerReservations: true },
});
expect(call3).toBeDefined();
// Attempt #1 must route directly to Buyer B
expect(call3.attempts).toHaveLength(1);
expect(call3.attempts[0].buyer_id).toBe(buyerBId);
expect(call3.attempts[0].destination_number).toBe('+12025550198');

// Buyer B active count must be 1; Buyer A must remain 2
const buyerBActiveCount = await prisma.buyerReservation.count({
  where: { buyer_id: buyerBId, status: 'ACTIVE' },
});
expect(buyerBActiveCount).toBe(1);
```

#### Assertion 4 — Absence of Rejected Attempt Record on Saturation
```typescript
// Confirm Buyer A was skipped before attempt creation
const call3AttemptsForBuyerA = call3.attempts.filter(a => a.buyer_id === buyerAId);
expect(call3AttemptsForBuyerA).toHaveLength(0);
```

#### Assertion 5 — Fake Provider Audit Log Verification
```typescript
const actions = fakeProvider.getActions();
const dialActions = actions.filter(a => a.action === 'dial');
expect(dialActions).toHaveLength(3);
expect(dialActions[0].to).toBe(buyerADestination);
expect(dialActions[1].to).toBe(buyerADestination);
expect(dialActions[2].to).toBe('+12025550198'); // Routed to Buyer B!
```

#### Assertion 6 — Egress Isolation Verification
```typescript
// Verify mockWebhooksService did not encounter uncaught errors
expect(mockWebhooksService.queueEvent).toHaveBeenCalled();
// Verify zero real Telnyx or Asterisk calls were registered
```

---

## 7. Lifecycle and Cleanup Specification

### 7.1 NestJS Module Lifecycle Rules
1. **Compilation Only:** `await Test.createTestingModule(...).compile()`.
2. **Do NOT Invoke `moduleRef.init()`:**
   - In NestJS, `onModuleInit()` hooks start `ReservationRecoveryService` (5-minute timer) and `WebhooksService` (5-second timer).
   - Because `CallController` does not require `onModuleInit()` to process direct events, omitting `moduleRef.init()` keeps these background timers **completely dormant**.
3. **Controller Retrieval:**
   ```typescript
   const callController = moduleRef.get(CallController);
   ```
4. **Teardown Execution:**
   ```typescript
   afterAll(async () => {
     // 1. Delete test calls
     await prisma.call.deleteMany({
       where: { provider_call_id: { in: testCallIds } },
     });
     // 2. Disconnect Prisma client
     await prisma.$disconnect();
     // 3. Close module container
     await moduleRef.close();
   });
   ```

---

## 8. Remaining Technical Risks & Mitigation

1. **Risk 1: Buyer B Seed Prerequisite:**  
   - *Nature:* If the test is executed before `Buyer B` is seeded in `callflow_qa`, Call 3 will find zero available destinations and return `{ action: 'HANGUP' }` with state `FAILED`, failing Assertion 3.
   - *Mitigation:* The authorized seed script must be executed under explicit user approval immediately prior to Stage A.
2. **Risk 2: Outbound Webhook Mocking Leakage:**  
   - *Nature:* If `WebhooksService` is not properly overridden, active `outbound_webhooks` in the database could trigger `safeFetch` network requests.
   - *Mitigation:* Mocking `WebhooksService.queueEvent` via `.overrideProvider(WebhooksService).useValue(mockWebhooksService)` completely blocks the webhook queue pipeline in memory.

---

## 9. Explicit List of Operations Prohibited During Stage A

The following operations are **strictly prohibited** during Stage A execution:
1. `npm run start` or `npm run start:dev` (Standard `main.ts` bootstrap is prohibited).
2. HTTP requests to Telnyx API endpoints (`https://api.telnyx.com/*`).
3. HTTP requests to Asterisk ARI (`http://127.0.0.1:8088/*`).
4. SIP INVITE, REGISTER, or OPTIONS generation.
5. Inbound or outbound PSTN calls.
6. Execution of `QaOrchestratorService.executeTestRun()`.
7. `TRUNCATE` or `DROP TABLE` SQL mutations on `callflow_qa`.
8. Outbound HTTP requests to external webhook listener URLs.

---

## 10. Authoritative Final Recommendation

# **`RECOMMENDATION: READY FOR SEPARATE USER AUTHORIZATION`**

### Summary:
The technical specification for Phase QA-2B Stage A is **100% complete, rigorous, and verified against the CallFlow codebase**. All external dispatch paths (REST, ARI, SIP, Provisioning, Webhooks) are isolated in-memory.

**Jurisdictional Boundary:** This document provides the test design only. It does **NOT** authorize execution. Proceeding to Stage A requires:
1. Explicit human user approval to execute the Buyer B database seed.
2. Explicit human user approval to run the Stage A test suite.

---

**STAGE A TEST HARNESS SPECIFICATION COMPLETE**  
*Agent 2 — Backend, API, Database & Security*  
*November 12, 2026*
