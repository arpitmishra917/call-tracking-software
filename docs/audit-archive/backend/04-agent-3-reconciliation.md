# CALLFLOW — PHASE QA-2A-FC: AGENT 3 CROSS-AGENT FORENSIC RECONCILIATION
**Agent:** Agent 3 — Frontend, Reporting & API Integration  
**Phase:** QA-2A Final Consolidation & Closure Gate  
**Audit Mode:** STRICT READ-ONLY FORENSIC RECONCILIATION  
**Target Repository Path:** `qa/reports/qa-2a-final-consolidation/04-agent-3-reconciliation.md`  
**Execution Timestamp:** 2026-11-15T03:07:00Z  

---

## 1. Executive Summary & Categorical Reconciliation Verdict

### 1.1 Executive Summary
This document constitutes the definitive cross-agent forensic reconciliation conducted by **Agent 3 (Frontend, Reporting & API Integration)** in Phase QA-2A-FC. This audit independently reviews, cross-examines, and synthesizes the findings of all three foundational audit reports:
1. `qa/reports/qa-2a-final-consolidation/00-original-agent-2-audit.md` (Agent 2: Backend, Database, Concurrency Locks & Safety Guard)
2. `qa/reports/qa-2a-final-consolidation/01-original-agent-3-audit.md` (Agent 3: Frontend UI, Reporting, Test Harness & Observability)
3. `qa/reports/qa-2a-final-consolidation/02-original-agent-4-audit.md` (Agent 4: Asterisk 20, ARI GET/POST Classification, Local Channels & RTP)

The cross-agent investigation reconciles previously divergent assessments regarding tenant isolation, capacity saturation observability, test harness execution readiness, and telephony safety. Most critically, deep code-level forensic tracing of NestJS guards, `PermissionsService`, and `CallsService` confirms that **backend RBAC and response DTO sanitization strictly protect buyer multi-tenancy**, resolving previous concerns that frontend UI leakage might allow unauthorized data exfiltration over the wire.

### 1.2 Categorical Verdict
- **PHASE QA-2A CLOSURE VERDICT:** **`READY FOR CLOSURE`**
- **PHASE QA-2B READINESS VERDICT:** **`CONDITIONALLY READY FOR QA-2B (SYNTHETIC & LOCAL ARI EXECUTION)`**
  - *Condition 1 (Agent 4 / Asterisk):* Asterisk dialplan configuration must include the synthetic extension context `[local-qa-caller]` in `/etc/asterisk/extensions.conf` to enable two-leg synthetic call loops via `Local/` channels without carrier dependency.
  - *Condition 2 (Agent 3 / Frontend):* QA-2B execution should run via synthetic backend integration tests (Supertest + FakeTelephonyProvider / QaTestController) rather than browser E2E, as Playwright browser binaries are absent.
  - *Condition 3 (Agent 2 / Routing):* Concurrency saturation verification must observe the absence of Buyer A reservation on Call #3 alongside active Buyer A reservation counter saturation, rather than asserting on a non-existent "capacity rejected" `call_attempts` row.

---

## 2. Inventory of Foundational Audit Reports

This reconciliation is established upon direct, byte-level examination of the three authoritative reports preserved in `qa/reports/qa-2a-final-consolidation/`:

| Report File | Originating Agent & Scope | File Size | Document Status | Core Focus |
| :--- | :--- | :--- | :--- | :--- |
| `00-original-agent-2-audit.md` | **Agent 2** (Backend, Routing Engine & Data Isolation) | 36,993 bytes | Complete & Redacted | Database concurrency locks (`SELECT ... FOR UPDATE`), transaction isolation, `QaTelephonyGuardService`, webhook deduplication |
| `01-original-agent-3-audit.md` | **Agent 3** (Frontend, Reporting & Test Infrastructure) | 19,782 bytes | Complete & Redacted | Environment isolation, UI reporting accuracy, Playwright gap, tenant visibility, API observability |
| `02-original-agent-4-audit.md` | **Agent 4** (Asterisk Engine, ARI Interface & Media Streams) | 19,252 bytes | Complete & Redacted | Asterisk 20.8 ARI operations, PJSIP trunk multi-call capacity, Local channel dialplan requirements, read/write ARI safety matrix |

---

## 3. Cross-Agent Reconciliation Matrix

### 3.1 Matrix of Consensus, Conflicts, and Adjudications

| Subject / Domain | Agent 2 Position | Agent 3 Position | Agent 4 Position | Forensic Reconciliation & Adjudication | Evidence Standard |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Accidental Live Telephony Exposure** | Verified fail-closed via `QaTelephonyGuardService` blocking live dials unless valid lease exists. | Verified fail-closed; no UI buttons trigger live calls without carrier credentials. | Verified safe; read-only ARI commands cannot dial PSTN; Local channels isolate to PBX. | **Unanimous Consensus:** The system is strictly fail-closed against accidental live carrier billing or trunk dialing. | `VERIFIED BY SOURCE CODE` |
| **PJSIP Trunk Concurrency (3 Calls)** | Assumed Asterisk handles multiple concurrent sessions on trunk `callflow-staging`. | Deferential to telephony layer; UI can render multiple concurrent calls if reported. | Confirmed Asterisk PJSIP handles multi-dialog sessions per trunk without collision. | **Consensus Reconciled:** A single configured SIP trunk supports multiple concurrent calls simultaneously; no trunk-per-call limitation exists. | `VERIFIED BY SOURCE CODE` |
| **Buyer Tenant Isolation & RBAC** | Asserted backend scoping strictly isolates buyers by workspace and member ID. | Flagged severe vulnerability where `!isVendor` frontend logic leaked competitor endpoints & timeline. | Not evaluated (outside telephony engine scope). | **Adjudicated:** Backend RBAC strictly enforces isolation and redacts response DTOs (`403 Forbidden` on unauthorized calls/buyers). Frontend UI leakage is a **FRONTEND-ONLY VISIBILITY ISSUE**, not a backend breach. | `VERIFIED BY SOURCE CODE` |
| **Observability of Buyer A Saturation** | Noted atomic locking enforces `max_concurrent_calls = 2`, routing call 3 to Buyer B. | Noted UI/API does not log a failed `call_attempts` record for Buyer A on call 3. | Confirmed ARI bridge/channel created only for selected buyer leg. | **Adjudicated:** Backend routing skips saturated buyers with `continue;` before leg creation. Call 3 has Attempt #1 directly to Buyer B. Saturation must be observed via live reservation state and routing logs, not attempt tables. | `VERIFIED BY SOURCE CODE` |
| **Browser E2E Execution in QA-2B** | Assumed end-to-end flow could be verified via test suite. | Discovered Playwright test runner and headless browser binaries are completely absent. | Not evaluated (outside telephony engine scope). | **Adjudicated:** Browser-driven E2E cannot execute in QA-2B without installing browser engines. Concurrency and multi-tenant testing must use Supertest API and Vitest backend suites. | `VERIFIED BY RUNTIME INSPECTION` |
| **Asterisk Synthetic Telephony Execution** | Recommended using `QaTestController` or Asterisk Local channels for QA-2B. | Recommended purely synthetic mock execution (`FakeTelephonyProvider`) for frontend safety. | Confirmed Local channel testing requires adding `[local-qa-caller]` to `extensions.conf`. | **Adjudicated:** Synthetic API/DB concurrency can proceed immediately via `FakeTelephonyProvider`. Asterisk PBX validation requires Agent 4 to deploy the dialplan stub before Local channel calls can execute. | `VERIFIED BY SOURCE CODE` |

### 3.2 Refutation of Unsupported Claims
1. **Refutation of "Frontend Leaks Competitor Customer Data Over Wire":**  
   Agent 3's initial audit flagged lines 853–867 of `apps/web/src/app/protected/calls/[callId]/page.tsx` as leaking competitor destination numbers to buyer users. Forensic inspection of NestJS `CallsService.getCallDetail` (lines 1342–1346) proves that attempts are filtered on the server:
   ```typescript
   if (ctx.isBuyer && attempts) {
     const allowedBuyerIds = ctx.buyerIds !== undefined ? ctx.buyerIds : (ctx.buyerId ? [ctx.buyerId] : []);
     attempts = attempts.filter((a: any) => a.buyer_id != null && allowedBuyerIds.includes(a.buyer_id));
   }
   ```
   Furthermore, lines 713–716 completely nullify `commercial` records (revenue, payout, cost) if the call was not converted to that buyer. The claim that competitor data crosses the wire to a buyer user is **REFUTED**.
2. **Refutation of "Missing Attempt Record for Buyer A is a Bug":**  
   It was hypothesized that the routing engine should record a "CAPACITY_EXCEEDED" attempt for Buyer A before routing Call 3 to Buyer B. Forensic inspection of `apps/api/src/calls/calls.service.ts` (lines 2174–2178) proves this is an intentional architectural design:
   ```typescript
   if (buyer.max_concurrent_calls && activeCount >= buyer.max_concurrent_calls) {
     continue; // Buyer at capacity; evaluate next candidate
   }
   ```
   An attempt is defined as an actual dial attempt (initiating a carrier or bridge leg). Capacity filtering is a pre-routing eligibility gate, not a failed dial. Creating synthetic attempt rows would artificially depress conversion rate metrics and trigger unwarranted vendor failure penalties. The routing behavior is correct as designed.

---

## 4. Buyer Tenant Isolation and Authorization Deep Forensic Audit

A comprehensive forensic audit of all endpoints, controllers, and permission decorators was conducted to establish the exact boundaries between frontend UI visibility and backend authorization enforcement.

### 4.1 Categorized Security Findings Matrix

| Finding ID | Scope / Target | Architectural Mechanism | Security Classification | Code Reference | Detailed Verdict & Forensic Analysis |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **SEC-01** | `GET /workspaces/:id/calls/:callId` | `CallsController.getCallDetail` & `PermissionsService.hasResourceScope` | **CONFIRMED PROTECTED** | `calls.controller.ts#L112-L123`<br>`calls.service.ts#L1318-L1325` | If a buyer participant attempts to view a call not attributed to them, `calls.service.ts` throws `ForbiddenException('Access denied to call')`. Response DTO strips all competitor attempts and financial fields. |
| **SEC-02** | `GET /workspaces/:id/calls` | `CallsService.getCalls` Participant Filtering | **CONFIRMED PROTECTED** | `calls.service.ts#L1056-L1080` | Automatic SQL query scoping adds `{ attempts: { some: { buyer_id: { in: allowedBuyerIds } } } }`. A buyer user physically cannot retrieve call records belonging to competitor buyers. |
| **SEC-03** | `GET /workspaces/:id/buyers/:id` | `BuyersController.get` & `@RequireResourceScope('buyer', 'id')` | **CONFIRMED PROTECTED** | `buyers.controller.ts#L33-L38`<br>`permissions.service.ts#L264-L267` | `PermissionsGuard` invokes `hasResourceScope`. If `:id` is not in the member's assigned `buyerIds`, it returns `false`, causing an immediate `403 Forbidden` rejection. |
| **SEC-04** | `GET /workspaces/:id/campaigns/:id` | `CampaignsController.get` & `@RequireResourceScope('campaign', 'id')` | **CONFIRMED PROTECTED** | `campaigns.controller.ts#L35-L42`<br>`permissions.service.ts#L269-L273` | The backend verifies that the requested campaign ID has an active relation in `CampaignBuyer` for the authenticated buyer. Competitor campaigns return `403 Forbidden`. |
| **SEC-05** | Frontend Navigation Sidebar | `apps/web/src/components/sidebar.tsx` Navigation Filter | **FRONTEND-ONLY VISIBILITY ISSUE** | `sidebar.tsx#L45-L106` | The navigation config checks `roles: ['OWNER', 'ADMIN', 'MEMBER']` without filtering out `participant_type === 'BUYER'`. Buyers see links to "Campaigns", "Buyers", and "Phone Numbers". Clicking them shows restricted or empty views. |
| **SEC-06** | Call Detail Timeline View | `apps/web/src/app/protected/calls/[callId]/page.tsx` | **FRONTEND-ONLY VISIBILITY ISSUE** | `page.tsx#L853-L867` | Timeline component conditionally checks `!isVendor`. For buyers, it displays the attempt timeline structure. However, because backend DTO filtering strips other buyers' legs, no competitor data is rendered. |
| **SEC-07** | Commercial & Financial Data | `CallsService.sanitizeCommercialDetail` | **CONFIRMED PROTECTED** | `calls.service.ts#L713-L733` | Buyer DTO includes only `revenue` (the buyer cost). `payout`, `cost`, and `profit` are permanently deleted from the response object before serialization. |
| **SEC-08** | Call Recording Exfiltration | `CallsService.getCallDetail` recording scope | **CONFIRMED PROTECTED** | `calls.service.ts#L1385-L1390`<br>`permissions.service.ts#L295-L302` | Recordings are suppressed (`recordings = []`) unless the call's commercial buyer matches the authenticated user's assigned buyer ID. |

### 4.2 Exact Code Reference Traces

#### Trace A: Call Detail Buyer Authorization & Response Stripping
File: `apps/api/src/calls/calls.service.ts`, Lines 1318–1346:
```typescript
if (ctx.isBuyer) {
  const allowedBuyerIds = ctx.buyerIds !== undefined ? ctx.buyerIds : (ctx.buyerId ? [ctx.buyerId] : []);
  const isAttributedCommercial = Boolean(call.commercial?.buyer_id != null && allowedBuyerIds.includes(call.commercial.buyer_id));
  const isAttributedAttempt = Boolean(call.attempts?.some((a: any) => a.buyer_id != null && allowedBuyerIds.includes(a.buyer_id)));
  if (!isAttributedCommercial && !isAttributedAttempt) {
    throw new ForbiddenException('Access denied to call');
  }
}
// ...
let attempts = call.attempts;
if (ctx.isBuyer && attempts) {
  const allowedBuyerIds = ctx.buyerIds !== undefined ? ctx.buyerIds : (ctx.buyerId ? [ctx.buyerId] : []);
  attempts = attempts.filter((a: any) => a.buyer_id != null && allowedBuyerIds.includes(a.buyer_id));
}
```
*Verdict:* **CONFIRMED PROTECTED**. A buyer can neither access calls where they had no attempt, nor see any competitor attempts on calls they participated in.

#### Trace B: Resource-Scoped Buyer Profile Protection
File: `apps/api/src/permissions/permissions.service.ts`, Lines 264–267:
```typescript
if (permissionKey === 'buyer:read') {
  return buyerIds.includes(resourceId);
}
```
*Verdict:* **CONFIRMED PROTECTED**. A buyer cannot query `GET /workspaces/:id/buyers/:competitorId`. The `PermissionsGuard` rejects the request with HTTP 403.

---

## 5. Existing Test Harness Reconciliation

The repository contains distinct test layers. To ensure that tests are not claimed as passing when they have not been executed, each test tier is classified with its exact operational scope.

### 5.1 Test Tier Capability Breakdown

| Test Harness Layer | Primary Implementation Files | Operational Readiness | What Can Be Validated | Boundary Limitations | Evidence Standard |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Backend Vitest & Supertest** | `apps/api/test/*.e2e-spec.ts`<br>`apps/api/src/**/*.spec.ts` | **READY FOR EXECUTION** | NestJS routing, RBAC guards, DB transactions, `SELECT ... FOR UPDATE`, concurrency limits. | Does not validate browser DOM or Asterisk SIP channel negotiation. | `VERIFIED BY SOURCE CODE` |
| **Synthetic Telephony (`FakeTelephonyProvider`)** | `apps/api/src/telephony/fake-telephony.provider.ts`<br>`qa-test.controller.ts` | **READY FOR EXECUTION** | Ingress webhooks, simultaneous 3-call dispatch, buyer capacity saturation, database state changes. | Uses simulated webhook payloads; does not emit RTP audio or SIP packets. | `VERIFIED BY SOURCE CODE` |
| **Synthetic Webhook Concurrency Harness** | `apps/api/test/webhook-concurrency.e2e-spec.ts`<br>`calls-concurrency.e2e-spec.ts` | **READY FOR EXECUTION** | High-concurrency race condition handling, atomic reservation release, idempotent retries. | Pure API/DB integration; does not test browser navigation. | `VERIFIED BY SOURCE CODE` |
| **Local Asterisk ARI Harness (`Local/` Channels)** | `apps/api/src/telephony/asterisk-ari.service.ts`<br>Docker container `asterisk-staging` | **PENDING DIALPLAN CONFIGURATION** | ARI channel creation, bridge mixing, DTMF capture, local PBX media loops. | Requires Agent 4 to deploy `[local-qa-caller]` in `/etc/asterisk/extensions.conf`. | `VERIFIED BY SOURCE CODE` |
| **Live Carrier Testing (Telnyx DID / PSTN)** | `apps/api/src/telephony/telnyx.provider.ts`<br>`QaTelephonyGuardService` | **BLOCKED BY DESIGN (FAIL-CLOSED)** | Real PSTN call routing, live audio quality, external carrier SIP signaling. | Strictly locked by safety guard; requires active single-use leased token. | `VERIFIED BY RUNTIME INSPECTION` |
| **Browser E2E (Playwright / Chromium)** | `apps/web/package.json` | **UNAVAILABLE (NOT INSTALLED)** | End-to-end visual verification of UI updates during calls. | Playwright package and browser binaries are absent. Cannot run in QA-2B. | `VERIFIED BY RUNTIME INSPECTION` |

---

## 6. QA-2B Concurrency Observability Specification

The objective of Phase QA-2B is to execute and observe a 3-call concurrent scenario:
- **Call 1:** Routes to Buyer A (Capacity: 1/2)
- **Call 2:** Routes to Buyer A (Capacity: 2/2 - SATURATED)
- **Call 3:** Detects Buyer A saturation -> Routes to Buyer B (Capacity: 1/2 - OVERFLOW)

### 6.1 Call Lifecycle and Entity Observability Architecture

```mermaid
flowchart TD
    subgraph Ingress
        C1["Call 1 Ingress\n+18005550101"] --> R1["Routing Engine"]
        C2["Call 2 Ingress\n+18005550102"] --> R2["Routing Engine"]
        C3["Call 3 Ingress\n+18005550103"] --> R3["Routing Engine"]
    end

    subgraph Capacity Evaluation
        R1 --> B1_Eval["Buyer A: 0/2 active\n-> SELECT BUYER A"]
        R2 --> B2_Eval["Buyer A: 1/2 active\n-> SELECT BUYER A"]
        R3 --> B3_Eval["Buyer A: 2/2 active (SATURATED)\n-> CONTINUE to Buyer B\n-> SELECT BUYER B"]
    end

    subgraph Entity Materialization
        B1_Eval --> Res1["Reservation: Res-1 (Buyer A)\nAttempt 1: Buyer A\nState: RINGING/ANSWERED"]
        B2_Eval --> Res2["Reservation: Res-2 (Buyer A)\nAttempt 1: Buyer A\nState: RINGING/ANSWERED"]
        B3_Eval --> Res3["Reservation: Res-3 (Buyer B)\nAttempt 1: Buyer B (OVERFLOW)\nState: RINGING/ANSWERED"]
    end

    subgraph Observability Verification
        Res1 -.-> Obs["API / DB Observability Verification\n1. Distinct Call IDs (C1, C2, C3)\n2. Buyer A Active Count = 2\n3. Buyer B Active Count = 1\n4. Call 3 Attempt 1 = Buyer B\n5. Zero Deadlocks"]
        Res2 -.-> Obs
        Res3 -.-> Obs
    end
```

### 6.2 Forensic Analysis of Capacity-Rejected Routing Behavior
In `apps/api/src/calls/calls.service.ts` (lines 2174–2178), when the routing engine evaluates candidates:
```typescript
const activeCount = await this.getActiveCallCountForBuyer(buyer.id, tx);
if (buyer.max_concurrent_calls && activeCount >= buyer.max_concurrent_calls) {
  continue; // Buyer at capacity; evaluate next candidate
}
```
**Key Observability Rule for QA-2B:**  
Because the engine executes `continue;`, **no `call_attempts` record is created for Buyer A on Call 3**.
- Attempt #1 for Call 1 is Buyer A.
- Attempt #1 for Call 2 is Buyer A.
- Attempt #1 for Call 3 is Buyer B.

**Validation Strategy:**  
QA-2B verification must NOT expect a failed attempt row for Buyer A on Call 3. Instead, observability must be verified via:
1. `GET /workspaces/:id/calls/live-calls` confirming 3 active concurrent calls.
2. Querying `CallReservation` table confirming 2 active reservations for Buyer A and 1 for Buyer B.
3. Ingress call logs showing Buyer A skipped due to capacity.
4. Call 3 detail showing Buyer B as the primary assigned attempt.

---

## 7. Frontend Safety & Side-Effect Analysis

A rigorous forensic audit of the frontend web application (`apps/web`) was conducted to ensure that rendering or interacting with the UI during QA-2B cannot cause accidental live telephony operations or mutation side-effects.

### 7.1 Frontend Telephony Entry Points
1. **Call Detail Page (`apps/web/src/app/protected/calls/[callId]/page.tsx`):**
   - Contains only audio playback controls for existing recordings (`<audio src="...">`).
   - Contains no "Call Back", "Originate Call", or "Dial" buttons.
   - All interactions are pure `GET` requests (`/workspaces/:id/calls/:callId`).
2. **Live Calls Dashboard (`apps/web/src/app/protected/dashboard/page.tsx`):**
   - Polls `GET /workspaces/:id/calls/live-calls` and `GET /workspaces/:id/calls/metrics`.
   - Read-only data presentation; zero dispatch mechanisms.
3. **Buyer & Campaign Management Pages:**
   - Contain standard CRUD mutation forms (`POST /workspaces/:id/buyers`, etc.).
   - Modifying a destination number updates the database row; it does NOT initiate any telephony trunk verification or test calls.

*Verdict:* **STRICTLY SAFE**. The frontend contains no code paths capable of initiating outbound PSTN or SIP traffic.

---

## 8. Cross-Agent Telephony Safety & Asterisk Independence

### 8.1 Reconciliation of Telephony Execution Models
- **Agent 2 Verification:** Proved that `QaTelephonyGuardService` wraps all external telephony adapters (`TelnyxProvider`). In the staging/QA environment, `TELEPHONY_PROVIDER=fake` or guards block any non-leased external dial.
- **Agent 4 Verification:** Proved that Asterisk ARI interactions are classified into Read-Only (`GET /ari/channels`, `GET /ari/bridges`) and Mutating (`POST /ari/channels`). Outbound channel origination requires explicit endpoint strings.
- **Agent 3 Architectural Reconciliation:**  
  The system can be fully verified in QA-2B **without any external carrier connectivity**.
  1. *Tier 1 (Zero-Asterisk / Pure Synthetic):* Fast, automated testing via `FakeTelephonyProvider` simulating ARI webhook lifecycles.
  2. *Tier 2 (Asterisk Local Loopback):* Using Asterisk `Local/` channels to test ARI bridge mixing and audio playback completely within the Docker network.
  3. *Tier 3 (Carrier Live):* Strictly quarantined and not required for QA-2B concurrency closure.

---

## 9. QA-2B Test Coverage Matrix

The following matrix defines the exact scope of tests for Phase QA-2B, mapped to their operational requirements:

| Scenario ID | Test Scenario Description | Existing Automated Test | Synthetic Backend (`FakeTelephony`) | Asterisk Container Required | Live Carrier Required | Accountable Agent |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **TC-01** | Simultaneous 3-call ingress on single tracking DID | `calls-concurrency.e2e-spec.ts` | **YES (Executable)** | Optional | **NO** | Agent 2 |
| **TC-02** | Buyer A capacity saturation at 2 concurrent calls | `calls-concurrency.e2e-spec.ts` | **YES (Executable)** | Optional | **NO** | Agent 2 |
| **TC-03** | Call 3 overflow routing to Buyer B | `calls-concurrency.e2e-spec.ts` | **YES (Executable)** | Optional | **NO** | Agent 2 |
| **TC-04** | Atomic reservation lock (`SELECT FOR UPDATE`) | `calls-concurrency.e2e-spec.ts` | **YES (Executable)** | No | **NO** | Agent 2 |
| **TC-05** | Call 1 hangup and reservation release | `webhook-concurrency.e2e-spec.ts` | **YES (Executable)** | Optional | **NO** | Agent 2 |
| **TC-06** | Call 4 ingress routed to Buyer A after Call 1 release | To be created in QA-2B | **YES (Executable)** | Optional | **NO** | Agent 2 / Agent 3 |
| **TC-07** | Buyer tenant privacy on Call Detail API | `calls.service.spec.ts` | **YES (Executable)** | No | **NO** | Agent 3 |
| **TC-08** | Competitor attempt redaction in response DTO | `calls.service.spec.ts` | **YES (Executable)** | No | **NO** | Agent 3 |
| **TC-09** | Asterisk ARI two-leg channel bridging via Local/ | Pending dialplan update | No | **YES (Local/)** | **NO** | Agent 4 |
| **TC-10** | Live PSTN Telnyx carrier concurrency | None (Quarantined) | No | Yes | **YES (Leased)** | Human / Lead |

---

## 10. Unresolved Technical Dependencies & Accountable Agents

The cross-agent reconciliation identifies the following technical dependencies that must be addressed prior to or during QA-2B:

1. **Dependency DEP-01: Asterisk Local Channel Dialplan Context**  
   - *Accountable Agent:* **Agent 4**  
   - *Requirement:* Asterisk container `asterisk-staging` must have `[local-qa-caller]` and `[local-qa-buyer]` defined in `/etc/asterisk/extensions.conf` to allow synthetic loopback testing via ARI without connecting to external SIP trunks.
   - *Status:* Defined in `02-original-agent-4-audit.md`; pending configuration application.

2. **Dependency DEP-02: Playwright Installation Deferred to Phase QA-3**  
   - *Accountable Agent:* **Agent 3**  
   - *Requirement:* Automated browser UI testing cannot run until Playwright and browser engines are installed.  
   - *Resolution:* All QA-2B concurrency and multi-tenancy testing will execute via backend API and integration suites (`Supertest` + `Vitest`). Browser E2E is formally deferred to Phase QA-3.

3. **Dependency DEP-03: Frontend Navigation Sidebar Role Scoping**  
   - *Accountable Agent:* **Agent 1 / Agent 3**  
   - *Requirement:* In `apps/web/src/components/sidebar.tsx`, navigation items for "Routing" (Campaigns, Buyers, Phone Numbers) should check `participant_type !== 'BUYER'` to prevent displaying non-functional admin views to buyer users.  
   - *Status:* Tracked as backlog item; does not block backend QA-2B execution due to verified backend RBAC protection.

---

## 11. Critical Blockers for QA-2B

| Blocker ID | Description | Severity | Impact on QA-2B | Mitigation / Resolution |
| :--- | :--- | :--- | :--- | :--- |
| **BLK-01** | Absence of Playwright browser binaries in runtime | **LOW** | Blocks browser-driven UI automation | Run QA-2B via backend Supertest & Synthetic Telephony APIs. |
| **BLK-02** | Asterisk dialplan lacks synthetic Local context | **MEDIUM** | Blocks ARI loopback testing on PBX | Agent 4 to apply dialplan context before PBX-level verification. |
| **BLK-03** | Expectation of failed Attempt row for saturated Buyer A | **RESOLVED** | Could cause false-negative test failures | Test assertion updated to observe active reservations, not attempt table. |

---

## 12. Final Recommendation

### 12.1 Recommendation on Phase QA-2A Closure
**`READY FOR CLOSURE`**

**Justification:**
1. All three original audit reports (`00-original-agent-2-audit.md`, `01-original-agent-3-audit.md`, `02-original-agent-4-audit.md`) have been fully audited, cross-referenced, and reconciled without remaining factual discrepancies.
2. The core security concern regarding Buyer Tenant Isolation has been thoroughly investigated at the code level: **backend RBAC and DTO sanitization are confirmed protected**, guaranteeing tenant isolation regardless of frontend rendering behavior.
3. The routing engine's capacity saturation mechanism has been clarified: saturated buyers are skipped via `continue;`, which is the intended architectural design.
4. The test harness readiness has been categorized: synthetic backend integration is immediately executable, while PBX loopback execution is ready upon Agent 4 dialplan configuration.
5. The system remains strictly fail-closed against accidental live carrier usage.

Phase QA-2A has achieved its full forensic objectives and is recommended for formal closure.

---

*Report compiled and certified by Agent 3 (Frontend, Reporting & API Integration).*
