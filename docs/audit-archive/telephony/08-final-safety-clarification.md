# CALLFLOW — PHASE QA-2A: FINAL SAFETY CLARIFICATION

**Document ID:** `CALLFLOW-PHASE-QA-2A-FINAL-SAFETY-CLARIFICATION`  
**Owner:** Agent 2 — Backend, API, Database & Security  
**Phase:** QA-2A Final Consolidation & Closure Gate (QA-2A-FC-FINAL)  
**Execution Mode:** STRICT READ-ONLY FORENSIC AUDIT  
**Target Deliverable:** [`qa/reports/qa-2a-final-consolidation/08-final-safety-clarification.md`](file:///C:/Projects/callflow-agent-a/qa/reports/qa-2a-final-consolidation/08-final-safety-clarification.md)  
**Prior Reference Documents:**  
- [`06-master-final-reconciliation.md`](file:///C:/Projects/callflow-agent-a/qa/reports/qa-2a-final-consolidation/06-master-final-reconciliation.md)  
- [`07-qa2b-safety-correction-addendum.md`](file:///C:/Projects/callflow-agent-a/qa/reports/qa-2a-final-consolidation/07-qa2b-safety-correction-addendum.md)

---

## 1. Executive Summary

This document provides the definitive forensic safety clarification requested to close all remaining safety and isolation ambiguities before Phase QA-2A can be formally archived.

Through exhaustive source-code tracing of the NestJS telephony stack, PostgreSQL row locking, and Asterisk ARI integration paths, this report establishes four critical findings:
1. **The Outbound Guard Classification Bypass (SC-01):** [`QaTelephonyGuardService.validateDestinationOrThrow`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-telephony-guard.service.ts#L795-L841) bypasses allowlist validation not only when `TELEPHONY_QA_ENABLED=false`, but **also when `isQaCall(callContext)` returns false**. An empty allowlist does **NOT** reject every outbound destination; it rejects **only calls classified as QA**. Calls created via synthetic direct injection without an active server-side lease are treated as production by default and bypass allowlist protection entirely.
2. **Fake Provider Isolation Boundaries (SC-02):** Overriding `TELEPHONY_PROVIDER` in a Vitest `TestingModule` isolates `CallController` from the Telnyx REST SDK, but **does not isolate Asterisk ARI or PJSIP trunks**. If `QaOrchestratorService` or Asterisk ARI endpoints are invoked, Asterisk can still dispatch live SIP INVITEs over UDP 5060 if credentials exist.
3. **Buyer B Seed Integrity (SC-03):** The proposed seed for `Buyer B` was forensically validated against Prisma models, foreign keys, and unique constraints (`[workspace_id, destination_number]` and `[campaign_id, priority]`). All constraints are satisfied by the proposed specification, but **zero database writes are performed**.
4. **Final Stage A Safety Decision (SC-04):** Stage A can only achieve true carrier isolation under a strict 4-point isolation envelope. Because an end-to-end test suite matching this envelope has not yet been executed in this environment, Stage A remains **`BLOCKED PENDING VERIFICATION & USER AUTHORIZATION`**.

---

## 2. SC-01 — Outbound Guard: QA Classification Bypass Deep Dive

A comprehensive forensic line-by-line inspection of [`apps/api/src/telephony/qa/qa-telephony-guard.service.ts#L792-L841`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-telephony-guard.service.ts#L792-L841):

```typescript
public validateDestinationOrThrow(destination: string, callContext?: any): void {
  // Step 1: Bypass if QA mode is disabled
  if (!this.isQaEnabled()) {
    return; // <-- BYPASS ALLOWLIST!
  }

  // Step 2: Bypass if call is not classified as QA
  if (!this.isQaCall(callContext)) {
    return; // <-- BYPASS ALLOWLIST!
  }

  // Step 3: Fail closed if allowlist is empty or malformed
  const allowlistResult = this.parseAllowlist();
  if (!allowlistResult.valid) {
    this.logger.error(`QA telephony guard failed closed: ${allowlistResult.error}`);
    throw new TelephonyProviderError(
      TelephonyErrorType.ROUTING_FAILED,
      `QA guard blocked outbound call: ${allowlistResult.error}`,
    );
  }

  // Step 4: Validate candidate destination format (E.164)
  const normalizedCandidate = parseAndValidateE164(destination);
  if (!normalizedCandidate) {
    throw new TelephonyProviderError(
      TelephonyErrorType.ROUTING_FAILED,
      `QA guard rejected outbound call: destination "${destination}" is not a valid E.164 number`,
    );
  }

  // Step 5: Validate destination is in allowed set
  if (!allowlistResult.allowedSet.has(normalizedCandidate)) {
    throw new TelephonyProviderError(
      TelephonyErrorType.ROUTING_FAILED,
      `QA guard rejected outbound call: destination ${normalizedCandidate} is not authorized for QA`,
    );
  }
}
```

### Forensic Adjudication of Specific Questions:

#### 1. What happens when `TELEPHONY_QA_ENABLED=false`?
- `this.isQaEnabled()` (line 700: `process.env.TELEPHONY_QA_ENABLED === 'true'`) evaluates to `false`.
- The method executes Step 1 (`if (!this.isQaEnabled()) return;`) and **returns immediately**.
- **Result:** Destination validation is **completely bypassed**. No exceptions are thrown, no allowlist is checked, and the outbound call leg proceeds unconstrained.

#### 2. What happens when QA is enabled (`TELEPHONY_QA_ENABLED=true`), but `isQaCall(callContext)` returns `false`?
- Step 1 passes (`isQaEnabled()` is true).
- Step 2 evaluates `if (!this.isQaCall(callContext)) return;`.
- Because `isQaCall(callContext)` is `false`, the method **returns immediately**.
- **Result:** Destination validation is **completely bypassed**. The guard assumes the call is a legitimate production call and permits outbound dialing without checking the allowlist.

#### 3. Does an empty allowlist reject every outbound destination or only QA-classified calls?
- **CRITICAL FORENSIC REALITY:** An empty allowlist rejects **ONLY QA-CLASSIFIED CALLS**.
- Step 3 (`this.parseAllowlist()`) is located on lines 807–814, which are **only reached after Steps 1 and 2 evaluate to true**.
- If a call is **not** classified as QA, Step 3 is **never executed**.
- **Conclusion:** Describing `TELEPHONY_QA_ENABLED=true` plus an empty allowlist as a "universal outbound kill switch" is **CONTRADICTED BY SOURCE CODE**. It protects only calls that possess an active, valid server-side QA binding.

#### 4. Which code paths create or propagate QA call context?
Inspection of `isQaCall(callContext)` ([`qa-telephony-guard.service.ts#L713-L745`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-telephony-guard.service.ts#L713-L745)):
```typescript
public isQaCall(callContext?: any): boolean {
  if (!callContext) return false;
  if (!this.isQaEnabled()) return false;

  // Branch 1: Internal explicit test override flag (in-memory only)
  if (callContext._trustedServerQaFlag === true) {
    return true;
  }

  // Branch 2: Server-side in-memory call binding
  const callId = callContext.id || callContext.callId;
  if (callId && typeof callId === 'string') {
    const binding = this.boundCalls.get(callId.trim());
    if (binding && binding.state === 'BOUND' && Date.now() <= binding.expiresAt) {
      const testRun = this.activeTestRuns.get(binding.runId);
      if (testRun && Date.now() <= testRun.expiresAt) {
        return true;
      }
    }
  }
  return false;
}
```
Only two mechanisms create QA context:
1. Setting `_trustedServerQaFlag: true` on an in-memory object (not persistable in Prisma DB rows).
2. Binding a `callId` into `this.boundCalls` via `qaGuardService.bindCallToTestRun(callId, runId)`:
   - In [`CallController.handleEvent`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/call-controller.ts#L266-L281), this occurs **only when an inbound call on `TELNYX_QA_TRACKING_DID` successfully matches an active cryptographic lease** (`consumeInboundLease`).
   - In [`QaOrchestratorService.executeTestRun`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-orchestrator.service.ts#L260-L270), this occurs when a test run registers an inbound lease and binds the resulting call ID.

#### 5. Can direct event injection or asynchronous queue dispatch create an outbound call without valid QA classification?
- **YES. THIS IS A PROVEN VULNERABILITY.**
- If a synthetic test dispatches an event directly into `CallController.handleEvent(event)`:
  - If `event.to` is not `TELNYX_QA_TRACKING_DID` (or if no lease was pre-opened in `activeLeases`), `consumeInboundLease` is never executed.
  - The call is saved to PostgreSQL without a binding in `this.boundCalls`.
  - When `CallController.dialNextBuyer` executes line 1009:
    ```typescript
    this.qaGuardService.validateDestinationOrThrow(dialNumber, result.call);
    ```
    `result.call` is a raw Prisma `Call` entity loaded from the database. It does not have `_trustedServerQaFlag`, and its ID is not in `boundCalls`.
  - `isQaCall(result.call)` returns **`false`**.
  - `validateDestinationOrThrow` **returns immediately (BYPASS)**!
  - `this.provider.dialBuyer(dialTarget, ...)` executes! If `TelnyxProvider` is loaded and `TELNYX_API_KEY` is present, it **dispatches an authenticated REST API call to Telnyx to dial the buyer destination**!

---

## 3. SC-02 — Fake Provider Isolation Analysis

A complete audit of every provider injection and outbound dispatch path across `apps/api`:

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                            CALLFLOW OUTBOUND DISPATCH PATH TOPOLOGY                         │
├────────────────────────────────┬───────────────────────────┬────────────────────────────────┤
│ DISPATCH ENTRY POINT           │ INJECTED SERVICE          │ EGRESS TRANSPORT               │
├────────────────────────────────┼───────────────────────────┼────────────────────────────────┤
│ 1. CallController.dialBuyer()  │ TELEPHONY_PROVIDER        │ Telnyx REST API (HTTPS)        │
│ 2. CallController.bridgeCalls()│ TELEPHONY_PROVIDER        │ Telnyx REST API (HTTPS)        │
│ 3. CallController.hangupCall() │ TELEPHONY_PROVIDER        │ Telnyx REST API (HTTPS)        │
│ 4. QaOrchestratorService.run() │ AsteriskAriClientService  │ Asterisk ARI (HTTP POST :8088) │
│ 5. Asterisk Core Engine        │ PJSIP Stack (Asterisk)    │ Telnyx SIP SBCs (UDP :5060)    │
│ 6. TelnyxProvisioningService   │ Telnyx API SDK            │ Telnyx Number API (HTTPS)      │
└────────────────────────────────┴───────────────────────────┴────────────────────────────────┘
```

### Forensic Adjudication of Vitest `TestingModule` Overrides:
When a Vitest test module compiles an override:
```typescript
const moduleRef = await Test.createTestingModule({
  imports: [AppModule],
})
  .overrideProvider(TELEPHONY_PROVIDER)
  .useClass(FakeTelephonyProvider)
  .compile();
```

#### What It Guarantees:
1. **Guarantees Zero Telnyx REST Call Control:** `CallController` receives `FakeTelephonyProvider`. Invocations of `answerCall`, `dialBuyer`, `bridgeCalls`, and `hangupCall` push in-memory objects to `fakeProvider.actions[]`. **Zero HTTPS requests are dispatched to `api.telnyx.com` for call control.**

#### What It Does NOT Guarantee:
1. **Does NOT Prevent Asterisk ARI Origination:** `QaOrchestratorService` does not inject `TELEPHONY_PROVIDER`; it directly injects `AsteriskAriClientService` ([`qa-orchestrator.service.ts#L65`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-orchestrator.service.ts#L65)). If a test triggers `QaOrchestratorService.executeTestRun()`, it issues HTTP requests to Asterisk ARI on port 8088.
2. **Does NOT Prevent Asterisk PJSIP Carrier Dispatch:** Overriding `TELEPHONY_PROVIDER` in Node.js has zero visibility or control over Docker container `callflow-asterisk-qa`. If an ARI command originates an endpoint on `telnyx-caller`, Asterisk sends live SIP INVITEs over UDP 5060 to Telnyx.
3. **Does NOT Prevent Number Provisioning API Calls:** `TelnyxProvisioningService` has an independent `Telnyx` SDK client. If any test touches phone number ordering, it reaches Telnyx APIs.

#### Classification:
- **Proven Test-Module Isolation:** `CallController` $\leftrightarrow$ `FakeTelephonyProvider` in-memory isolation is **`VERIFIED BY SOURCE CODE`**.
- **Full-Process Network Isolation:** Claiming that overriding `TELEPHONY_PROVIDER` isolates the entire backend and telephony network stack is **`UNVERIFIED / REFUTED`**.

---

## 4. SC-03 — Buyer B Seed Integrity Verification

A strict read-only audit of the proposed `Buyer B` seed against the current `callflow_qa` database schema, migrations, foreign keys, and unique constraints:

### 1. Entity Constraint Verification Matrix

| Table | Field | Target Value | Constraint / Foreign Key | Verification Finding | Status |
|---|---|---|---|---|:---:|
| `buyers` | `id` | `b0000000-0000-0000-0000-000000000002` | Primary Key (`UUID`) | Unique RFC 4122 UUID. Does not collide with Buyer A. | ✅ VERIFIED |
| `buyers` | `workspace_id` | `5e20bafe-7306-4da7-9944-62c4c5575a5a` | FK $\to$ `workspaces.id` | Matches verified `QA_WORKSPACE_ID` in `apps/api/.env.qa#L7`. | ✅ VERIFIED |
| `buyers` | `name` | `"QA Test Buyer B (Overflow)"` | `String` (Nullable: No) | Conforms to schema. | ✅ VERIFIED |
| `buyers` | `destination_number` | `"+12025550198"` | `String?` (Default: `""`) | Legacy E.164 field. Valid format. | ✅ VERIFIED |
| `buyers` | `status` | `"ACTIVE"` | `String` (Default: `"ACTIVE"`) | Conforms to routing query filter `where: { status: 'ACTIVE' }`. | ✅ VERIFIED |
| `buyers` | `max_concurrent_calls` | `2` | `Int?` (Default: `1`) | Canonical limit of 2 enforces finite saturation. | ✅ VERIFIED |
| `destination_numbers` | `id` | `d0000000-0000-0000-0000-000000000002` | Primary Key (`UUID`) | Unique UUID. | ✅ VERIFIED |
| `destination_numbers` | `workspace_id` | `5e20bafe-7306-4da7-9944-62c4c5575a5a` | FK $\to$ `workspaces.id` | Matches QA workspace. | ✅ VERIFIED |
| `destination_numbers` | `buyer_id` | `b0000000-0000-0000-0000-000000000002` | FK $\to$ `buyers.id` | Cascades on delete. Links to Buyer B. | ✅ VERIFIED |
| `destination_numbers` | `destination_number` | `"+12025550198"` | `@@unique([workspace_id, destination_number])` | **CRITICAL:** Distinct from Buyer A (`+12025550199`). Unique in workspace. | ✅ VERIFIED |
| `destination_numbers` | `max_concurrent_calls` | `2` | `Int` (Default: `1`) | Synchronized with buyer limit. | ✅ VERIFIED |
| `campaign_destination_numbers` | `campaign_id` | `6af31407-3f46-4f1d-90d0-bf08af2e9600` | FK $\to$ `campaigns.id` | Matches verified `QA_CAMPAIGN_ID` in `apps/api/.env.qa#L8`. | ✅ VERIFIED |
| `campaign_destination_numbers` | `destination_number_id`| `d0000000-0000-0000-0000-000000000002` | `@@unique([campaign_id, destination_number_id])` | Unique association. | ✅ VERIFIED |
| `campaign_destination_numbers` | `priority` | `2` | `Int` (Default: `1`) | Buyer A is Priority 1. Establishes waterfall sequence. | ✅ VERIFIED |
| `campaign_buyers` | `campaign_id` | `6af31407-3f46-4f1d-90d0-bf08af2e9600` | `@@unique([campaign_id, priority])` | **CRITICAL CONSTRAINT:** Priority 2 avoids collision with Buyer A. | ✅ VERIFIED |
| `campaign_buyers` | `buyer_id` | `b0000000-0000-0000-0000-000000000002` | `@@unique([campaign_id, buyer_id])` | Unique mapping for legacy fallback route. | ✅ VERIFIED |

### 2. Commercial / Financial Side Effects:
- When Call 3 overflows to Buyer B and reaches converted state:
  - `CallCommercial` row is created with `buyer_id = b0000000-0000-0000-0000-000000000002`.
  - Financial amounts are derived from campaign defaults (`default_revenue_amount`, `default_payout_amount`).
  - Reporting metrics query (`GET /workspaces/:id/calls/metrics`) will partition revenue to Buyer B and payout to Vendor.
- **Explicit Restriction:** **ZERO database writes, seeds, or SQL statements were executed.**

---

## 4. SC-04 — Final Stage A Safety Decision

To achieve 100% verified carrier isolation for Stage A (Synthetic Concurrency & Overflow Testing), the execution environment must satisfy a strict **5-Point Safety Envelope**:

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                               STAGE A CARRIER ISOLATION ENVELOPE                            │
├────┬─────────────────────────────┬──────────────────────────────────────────────────────────┤
│ #  │ SAFETY CRITERION            │ ENFORCEMENT MECHANISM                                    │
├────┼─────────────────────────────┼──────────────────────────────────────────────────────────┤
│ 1  │ Isolated Test Harness       │ Executed via Vitest Supertest/TestingModule.             │
│    │                             │ Standard bootstrap (main.ts) is strictly prohibited.     │
├────┼─────────────────────────────┼──────────────────────────────────────────────────────────┤
│ 2  │ Explicit Provider Override  │ .overrideProvider(TELEPHONY_PROVIDER)                    │
│    │                             │ .useClass(FakeTelephonyProvider) must be compiled.       │
├────┼─────────────────────────────┼──────────────────────────────────────────────────────────┤
│ 3  │ Pure In-Memory Ingress      │ Normalized events dispatched directly to                 │
│    │                             │ CallController.handleEvent(event).                       │
├────┼─────────────────────────────┼──────────────────────────────────────────────────────────┤
│ 4  │ Asterisk Container Isolation│ QaOrchestratorService and Asterisk ARI must NOT be       │
│    │                             │ invoked. Zero HTTP calls to 127.0.0.1:8088.              │
├────┼─────────────────────────────┼──────────────────────────────────────────────────────────┤
│ 5  │ Defensive Call ID Prefixing │ All injected call IDs must start with mock_ or fake_     │
│    │                             │ (triggers TelnyxProvider isMockCallId defense-in-depth). │
└────┴─────────────────────────────┴──────────────────────────────────────────────────────────┘
```

### Authoritative Classification:
While the 5-point isolation envelope is structurally verified by source code, **no test suite implementing this envelope has been executed or verified against PostgreSQL `callflow_qa` in this environment**.

Therefore, in strict adherence to forensic evidence standards:
# **`STAGE A IS CLASSIFIED AS: BLOCKED PENDING VERIFICATION & USER AUTHORIZATION`**

---

## 5. Summary of Authoritative Recommendations

1. **Phase QA-2A Closure:** **`RECOMMENDED FOR CLOSURE`**. All analytical, forensic, and safety clarification objectives are complete under read-only discipline.
2. **Phase QA-2B Execution:** **`STRICTLY BLOCKED`**. No agent report grants authorization to execute. Stage A execution, database seeding, dialplan deployment, and container operations require separate, explicit human authorization.

---

**CALLFLOW QA-2A FINAL SAFETY CLARIFICATION COMPLETE**  
*Agent 2 — Backend, API, Database & Security*  
*November 12, 2026*
