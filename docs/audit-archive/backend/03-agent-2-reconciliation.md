# CALLFLOW — PHASE QA-2A-FC: AGENT 2 CROSS-AGENT FORENSIC RECONCILIATION

**Document ID:** `CALLFLOW-PHASE-QA-2A-FC-AGENT-2-RECONCILIATION`  
**Owner:** Agent 2 — Backend, API, Database & Security  
**Phase:** QA-2A Final Consolidation & Closure Gate (QA-2A-FC)  
**Mode:** STRICT READ-ONLY FORENSIC AUDIT  
**Evaluation Date:** November 12, 2026  
**Implementation / Mutation Permission:** NONE (Zero code changes, zero database mutations, zero live telephony)  
**Authoritative Closure Recommendation:** **`READY FOR CLOSURE WITH MANDATORY PRE-EXECUTION CONDITIONS`**

---

## 1. Executive Summary

This forensic report delivers the independent cross-agent reconciliation of all three original Phase QA-2A readiness reports produced across the CallFlow engineering organization:
- **Agent 2 Report:** Backend, Database, Tenant Isolation & Telephony Safety Readiness Audit ([`00-original-agent-2-audit.md`](file:///C:/Projects/callflow-agent-a/qa/reports/qa-2a-final-consolidation/00-original-agent-2-audit.md))
- **Agent 3 Report:** Frontend, Reporting & Application Integration Forensic Audit ([`01-original-agent-3-audit.md`](file:///C:/Projects/callflow-agent-a/qa/reports/qa-2a-final-consolidation/01-original-agent-3-audit.md))
- **Agent 4 Report:** Asterisk, ARI, SIP, RTP & Telephony Test Harness Readiness Audit ([`02-original-agent-4-audit.md`](file:///C:/Projects/callflow-agent-a/qa/reports/qa-2a-final-consolidation/02-original-agent-4-audit.md))

### Categorical Verdict: **`PASS WITH CONDITIONS`**
All three auditing agents independently arrived at the identical top-level verdict: **`PASS WITH CONDITIONS`**. The core architecture—spanning PostgreSQL serialized row-locking transactions, database isolation guards, Asterisk 20 container infrastructure, and read-only frontend controls—is structurally sound and capable of supporting controlled concurrency testing.

However, forensic cross-examination reveals **four critical technical divergences and architectural assumptions** that must be reconciled before Phase QA-2B execution:
1. **The Asterisk Local Channel vs. Telnyx Outbound Dialing Mismatch:** Agent 4 proposed routing synthetic buyers via Asterisk Local channels (`Local/buyer-a@local-buyer/n`). Forensic source inspection proves that the backend dialing pipeline ([`TelnyxProvider.dialBuyer`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/telnyx/telnyx.provider.ts#L53-L92)) and validation layers ([`QaTelephonyGuardService.validateDestinationOrThrow`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-telephony-guard.service.ts#L795-L835) and [`QaSipUriAdapterService.resolveBuyerDestination`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-sip-uri-adapter.service.ts#L101-L150)) reject non-E.164 and non-`sip.telnyx.com` destinations, failing closed immediately.
2. **The "TELEPHONY_QA_ENABLED=false" Safety Fallacy:** Agent 3 and Agent 4 treated `TELEPHONY_QA_ENABLED=false` as a universal safety switch. Source code proves that while `false` disables dedicated QA ingress calls, it **bypasses QA allowlists** for outbound calls in production mode.
3. **The $50 Wallet Requirement vs. QA Bypass:** Original Agent 2 and Agent 3 reports stated that the QA workspace wallet requires $50.00 funding. Source code inspection reveals that [`CallController.handleEvent`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/call-controller.ts#L454-L482) **completely bypasses wallet reservation** for verified QA calls (`qa.wallet.bypass`), but **strictly enforces** wallet balances for secondary workspaces in QA-2D.
4. **Competitor Endpoint Leakage Reality:** Agent 3 flagged that the frontend leaks competitor buyer endpoints via `!isVendor`. Backend code inspection proves that the API layer ([`CallsService.getCallDetail`](file:///C:/Projects/callflow-agent-a/apps/api/src/calls/calls.service.ts#L1342-L1345) and [`CampaignsService.sanitizeCampaignForBuyer`](file:///C:/Projects/callflow-agent-a/apps/api/src/routing/campaigns.service.ts#L8-L58)) already redacts competitor attempts and destinations prior to serialization.

---

## 2. Original Report References

All source reports were read and verified directly from the repository consolidation archive:

| Identifier | Source Document | Primary Focus & Domain | Line Count | File Size | Hash / Status |
|:---:|---|---|:---:|:---:|:---:|
| **RPT-00** | [`00-original-agent-2-audit.md`](file:///C:/Projects/callflow-agent-a/qa/reports/qa-2a-final-consolidation/00-original-agent-2-audit.md) | Backend, Database, Concurrency & Security | 262 | 18,788 bytes | ✅ AUDIT COMPLETE |
| **RPT-01** | [`01-original-agent-3-audit.md`](file:///C:/Projects/callflow-agent-a/qa/reports/qa-2a-final-consolidation/01-original-agent-3-audit.md) | Frontend UI, API Observability & Browser E2E | 248 | 16,842 bytes | ✅ AUDIT COMPLETE |
| **RPT-02** | [`02-original-agent-4-audit.md`](file:///C:/Projects/callflow-agent-a/qa/reports/qa-2a-final-consolidation/02-original-agent-4-audit.md) | Asterisk ARI, SIP Multiplexing & RTP Audio | 296 | 20,412 bytes | ✅ AUDIT COMPLETE |

---

## 3. Cross-Agent Reconciliation Matrix

| Domain / Issue | Agent 2 Position | Agent 3 Position | Agent 4 Position | Reconciled Forensic Reality | Classification |
|---|---|---|---|---|:---:|
| **PostgreSQL Isolation** | Port 5433 / `callflow_qa` enforced by hard startup abort in `main.ts`. | Verified frontend targets port 3000 API connected to QA DB. | Verified container `callflow-postgres-qa` healthy on port 5433. | **UNANIMOUS:** Hard fail-closed container & port separation confirmed. | **VERIFIED BY RUNTIME INSPECTION** |
| **Frontend Outbound Dialing** | Ingress webhooks only; zero frontend dial triggers. | Zero dialpad controls, zero WebRTC endpoints, zero origination APIs. | Telephony initiated solely via ARI origination or Telnyx webhook. | **UNANIMOUS:** Web UI cannot originate accidental outbound PSTN calls. | **VERIFIED BY SOURCE CODE** |
| **Buyer Capacity Skipping** | `SELECT ... FOR UPDATE` locks row, serializes reservations. | Noted capacity saturation skips attempt row (`continue;`) without DB attempt. | Assumed failure creates retry attempt. | **AGENT 3 CONFIRMED:** When buyer is saturated, loop executes `continue;` skipping directly to next buyer without creating attempt row. | **VERIFIED BY SOURCE CODE** |
| **Browser E2E Harness** | Out of scope for backend audit. | `@playwright/test` is missing; headless browser tests are blocked. | Relies on Node.js native ARI runner scripts. | **AGENT 3 CONFIRMED:** Playwright is not installed. E2E browser automation is blocked; API tests must be used. | **VERIFIED BY RUNTIME INSPECTION** |
| **ARI User Permissions** | ARI client connects to `127.0.0.1:8088` on local loopback. | Not audited. | Only 1 ARI user (`callflow_qa`, `read_only=no`); needs read-only observer user. | **AGENT 4 CONFIRMED:** Asterisk lacks RBAC. Tooling must self-enforce GET-only discipline until `ari.conf` is updated. | **VERIFIED BY SOURCE CODE** |
| **SIP Concurrency Feasibility** | Database handles concurrent transactions without deadlocks. | Assumed backend handles multi-call concurrency. | Refuted "1 registration = 1 call" myth; SIP dialogs multiplex on 1 trunk. | **AGENT 4 CONFIRMED:** RFC 3261 dialog multiplexing supports concurrent calls on `telnyx-caller` and `telnyx-buyer`. | **VERIFIED BY SOURCE CODE** |
| **Buyer Overflow Destination** | Requires seeding Buyer B in `callflow_qa` with E.164 destination. | Requires Buyer B configuration in Campaign waterfall. | Proposed Asterisk Local channels (`Local/buyer-a@local-buyer/n`). | **CONTRADICTION:** Backend `TelnyxProvider` cannot dial `Local/` channels. Outbound dial target must be E.164 or `sip.telnyx.com` SIP URI. | **VERIFIED BY SOURCE CODE** |
| **`TELEPHONY_QA_ENABLED=false` Safety** | Noted that `false` rejects QA ingress calls but bypasses allowlists in prod. | Assumed `false` is safe for synthetic mock tests. | Assumed `false` guarantees zero live carrier calls. | **OVERSTATED SAFETY:** `false` disables QA ingress, but outbound calls bypass QA allowlists if triggered. | **VERIFIED BY SOURCE CODE** |
| **Wallet $50 Balance Prerequisite** | Stated $50 balance required to prevent reservation rejection. | Stated wallet funding required before QA-2B. | Did not audit wallet. | **REFINED REALITY:** `call-controller.ts` bypasses wallet reservation for verified QA calls; however, secondary workspace in QA-2D requires wallet funding. | **VERIFIED BY SOURCE CODE** |
| **Competitor Endpoint Leakage** | Stated queries always include `workspace_id`. | Claimed `CallDetailPage:853` leaks competitor endpoints via `!isVendor`. | Did not audit web app. | **CORRECTED:** API layer (`calls.service.ts:1344`) filters attempts to buyer's own ID before response is sent to frontend. | **VERIFIED BY SOURCE CODE** |

---

## 4. Confirmed Findings (Unanimous Across Agents)

The following 6 core architectural findings are corroborated by independent evidence across all reports:

1. **Physical QA Database Isolation (Unanimous):**  
   The QA database runs on Docker container `callflow-postgres-qa` on port `5433` with database `callflow_qa`. [`apps/api/src/main.ts#L33-L45`](file:///C:/Projects/callflow-agent-a/apps/api/src/main.ts#L33-L45) actively aborts (`process.exit(1)`) on startup if `DATABASE_URL` references production, cloud poolers, or any port other than `5433`. *(Classification: VERIFIED BY RUNTIME INSPECTION)*
2. **PostgreSQL Concurrency Protection via Row Locks (Agents 2, 3, 4):**  
   Buyer capacity checks in [`apps/api/src/calls/calls.service.ts#L2140-L2195`](file:///C:/Projects/callflow-agent-a/apps/api/src/calls/calls.service.ts#L2140-L2195) utilize `SELECT ... FOR UPDATE` inside `tx.$transaction`. Multi-instance concurrent calls serialize atomically at the database kernel level, preventing capacity overselling. *(Classification: VERIFIED BY SOURCE CODE)*
3. **Absence of User-Facing Telephony Controls in Frontend (Agents 2, 3):**  
   The web frontend (`apps/web`) contains zero softphones, zero WebRTC controls, and zero outbound dialpad triggers. The UI cannot initiate external PSTN or SIP traffic. *(Classification: VERIFIED BY SOURCE CODE)*
4. **Single-Credential ARI Risk (Agents 2, 4):**  
   Asterisk container `callflow-asterisk-qa` has only one ARI user configured ([`qa/asterisk/ari.conf`](file:///C:/Projects/callflow-agent-a/qa/asterisk/ari.conf)), which possesses `read_only = no`. A true read-only audit observer role is currently missing from Asterisk. *(Classification: VERIFIED BY SOURCE CODE)*
5. **RTP Port Space Adequacy (Agent 4):**  
   Asterisk RTP port range is configured for 51 ports (10000–10050), supporting 25 simultaneous audio streams (up to 12 bridged calls), which is more than 4x the requirement for a 3-caller concurrent test. *(Classification: VERIFIED BY SOURCE CODE)*
6. **Buyer Capacity Saturation Attempt Skipping (Agent 3):**  
   When a buyer has reached its concurrency limit, the waterfall routing loop in `calls.service.ts` executes `continue;` without creating a `call_attempts` record for the skipped buyer. *(Classification: VERIFIED BY SOURCE CODE)*

---

## 5. Contradictions, Overstated Claims and Corrections

### Contradiction 1: Asterisk Local Channels vs. CallFlow Dialing Architecture
- **Agent 4's Claim:** Proposed that Buyer A and Buyer B can be pointed to Asterisk Local channels (`Local/buyer-a@local-buyer/n` and `Local/buyer-b@local-buyer/n`) to achieve 100% synthetic local testing without Telnyx.
- **Forensic Correction:** **IMPOSSIBLE WITHOUT ARCHITECTURAL REWRITE.**
  - `CallController.dialNextBuyer` delegates outbound dialing to [`this.provider.dialBuyer(dialTarget)`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/call-controller.ts#L1025).
  - When using `TelnyxProvider` ([`telnyx.provider.ts#L53-L92`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/telnyx/telnyx.provider.ts#L53-L92)), `dialBuyer` sends an HTTPS request to the Telnyx REST API (`this.telnyxClient.calls.dial`). Telnyx is a cloud SIP carrier and cannot dial an internal Asterisk Local channel.
  - Furthermore, [`QaTelephonyGuardService.validateDestinationOrThrow`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-telephony-guard.service.ts#L817-L824) strictly validates that `dialNumber` conforms to E.164. The string `"Local/buyer-a@local-buyer/n"` fails E.164 normalization and throws a fatal `TelephonyProviderError(ROUTING_FAILED)`.
  - Finally, [`QaSipUriAdapterService.validateSipUri`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-sip-uri-adapter.service.ts#L71-L76) explicitly restricts SIP domains to `sip.telnyx.com`.
  - **Verdict:** Local channels can only be used on the **caller ingress side** within Asterisk, or in pure Asterisk-to-Asterisk standalone tests. The backend dialing engine requires an E.164 phone number or an authorized `sip.telnyx.com` SIP URI.

### Contradiction 2: The Meaning of `TELEPHONY_QA_ENABLED=false`
- **Agent 3 & 4 Overstated Claim:** Treated `TELEPHONY_QA_ENABLED=false` as a failsafe mode that guarantees zero external telephony risk.
- **Forensic Correction:** **FALSE SENSE OF SECURITY.**
  - In [`apps/api/src/telephony/qa/qa-telephony-guard.service.ts#L797`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-telephony-guard.service.ts#L797):
    ```typescript
    public validateDestinationOrThrow(destination: string, callContext?: any): void {
      if (!this.isQaEnabled()) {
        return; // BYPASS!
      }
    ```
  - When `TELEPHONY_QA_ENABLED=false`, `isQaEnabled()` returns `false`, causing `validateDestinationOrThrow` to **bypass all allowlist validation immediately**!
  - If a non-QA call enters the system while `TELEPHONY_QA_ENABLED=false`, CallFlow treats it as **production** and will dial live carrier numbers if configured.
  - `TELEPHONY_QA_ENABLED=false` only protects **inbound QA ingress** on the dedicated tracking DID ([`call-controller.ts#L248-L254`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/call-controller.ts#L248-L254)), where it hangs up immediately.
  - **Verdict:** True carrier isolation requires either `ACTIVE_TELEPHONY_PROVIDER=fake`, an empty allowlist with `TELEPHONY_QA_ENABLED=true`, or direct normalized event injection.

### Contradiction 3: Competitor Endpoint Leakage in Call Detail
- **Agent 3 Claim:** Stated that [`CallDetailPage:853`](file:///C:/Projects/callflow-agent-a/apps/web/src/app/protected/calls/[callId]/page.tsx#L853) leaks competitor endpoint names to Buyer participants due to `!isVendor`.
- **Forensic Correction:** **PARTIALLY INCORRECT.**
  - While line 853 in the React component renders endpoint details when `!isVendor`, the API layer in [`CallsService.getCallDetail`](file:///C:/Projects/callflow-agent-a/apps/api/src/calls/calls.service.ts#L1342-L1345) performs mandatory backend filtering:
    ```typescript
    if (ctx.isBuyer && attempts) {
      const allowedBuyerIds = ctx.buyerIds !== undefined ? ctx.buyerIds : (ctx.buyerId ? [ctx.buyerId] : []);
      attempts = attempts.filter((a: any) => a.buyer_id != null && allowedBuyerIds.includes(a.buyer_id));
    }
    ```
  - A Buyer participant never receives competitor attempts in the API payload. The array returned to the browser contains only their own buyer's attempt records.
  - **Verdict:** No data leak occurs over the wire. The UI condition is defensively sloppy, but the backend RBAC is securely enforced.

---

## 6. TELEPHONY_QA_ENABLED Definitive Analysis

Forensic source-code audit of all occurrences of `TELEPHONY_QA_ENABLED` in `apps/api/src`:

```
====================================================================================================
FILE & LINE REFERENCE                     LOGICAL EXPRESSION                          EXACT BEHAVIOR
====================================================================================================
qa-telephony-guard.service.ts:700         process.env.TELEPHONY_QA_ENABLED === 'true'  Defines isQaEnabled()
qa-telephony-guard.service.ts:123         if (!this.isQaEnabled()) return valid: true  Startup config check bypassed
qa-telephony-guard.service.ts:188         if (!this.isQaEnabled()) return false        Disables dedicated QA candidate flag
qa-telephony-guard.service.ts:715         if (!this.isQaEnabled()) return false        isQaCall() returns false
qa-telephony-guard.service.ts:797         if (!this.isQaEnabled()) return;             validateDestinationOrThrow() BYPASSED!
qa-sip-uri-adapter.service.ts:36          process.env.TELEPHONY_QA_ENABLED === 'true'  Defines adapter isQaEnabled()
qa-sip-uri-adapter.service.ts:105         if (!this.isQaEnabled()) return origDest     SIP URI adapter BYPASSED!
call-controller.ts:248                    if (!this.qaGuardService?.isQaEnabled())     Inbound QA DID call HUNG UP immediately
====================================================================================================
```

### Definitive Behavior Summary:
1. **When `TELEPHONY_QA_ENABLED=false`:**
   - **Inbound QA DID:** Calls arriving on `TELNYX_QA_TRACKING_DID` are **instantly rejected and hung up** ([`call-controller.ts#L252`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/call-controller.ts#L252)). No Call row is inserted into the database.
   - **Outbound Dialing:** If an outbound dial is triggered via normal routes, the QA destination allowlist is **completely bypassed** ([`qa-telephony-guard.service.ts#L797`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-telephony-guard.service.ts#L797)). The system behaves as a production instance!
   - **Wallet Reservation:** Verified QA bypass is disabled; wallet reservation is enforced.
2. **When `TELEPHONY_QA_ENABLED=true`:**
   - **Inbound QA DID:** Inbound calls require an active, cryptographic single-use lease registered in `QaTelephonyGuardService`. Unleased calls are hung up immediately.
   - **Outbound Dialing:** Destination must be in `TELEPHONY_QA_ALLOWED_DESTINATIONS`. If the allowlist is empty or the number is missing, the dial fails closed and throws `TelephonyProviderError(ROUTING_FAILED)`.
   - **SIP URI Adapter:** The dial target is rewritten to `TELEPHONY_QA_BUYER_SIP_URI` on `sip.telnyx.com`.
   - **Wallet Reservation:** Bypassed with `qa.wallet.bypass` log.

### Can `FakeTelephonyProvider` be Enforced Without Ambiguous Environment Settings?
**YES.** In NestJS module configuration, `TELEPHONY_PROVIDER` can be explicitly bound to `FakeTelephonyProvider` (`apps/api/src/telephony/fake.provider.ts`) in test module definitions (`Test.createTestingModule`). When `FakeTelephonyProvider` is injected, the real `TelnyxClient` is never instantiated, rendering carrier egress physically impossible regardless of environment variable settings.

---

## 7. Carrier-Isolated Synthetic Test Architecture

To validate each layer of the CallFlow system while guaranteeing zero risk to live carriers, five distinct architectural modes are defined:

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                               5-TIER TESTING ARCHITECTURE TAXONOMY                               │
├──────────────────────┬────────────────────────┬─────────────────────────┬────────────────────────┤
│ TIER / MODE          │ INGRESS MECHANISM      │ EGRESS MECHANISM        │ VALIDATION SCOPE       │
├──────────────────────┼────────────────────────┼─────────────────────────┼────────────────────────┤
│ Tier 1: Direct Event │ CallController.        │ In-Memory Return /      │ DB row locks, waterfall│
│ Injection            │ handleEvent(event)     │ Mock Provider           │ overflow, commercials  │
├──────────────────────┼────────────────────────┼─────────────────────────┼────────────────────────┤
│ Tier 2: Signed HTTP  │ POST /webhooks/telnyx  │ FakeTelephonyProvider   │ Full HTTP stack, Ed25519│
│ Webhook Replay       │ (Ed25519 signed)       │                         │ signatures, idempotency│
├──────────────────────┼────────────────────────┼─────────────────────────┼────────────────────────┤
│ Tier 3: Fake Telephony│ Webhooks or Synthetic │ FakeTelephonyProvider   │ CallController, timers,│
│ Provider Harness     │ Events                 │ Audit Log Inspection    │ ringback, billing logic│
├──────────────────────┼────────────────────────┼─────────────────────────┼────────────────────────┤
│ Tier 4: Asterisk     │ Asterisk ARI Originate │ Asterisk PJSIP loopback │ Signaling, ARI client, │
│ Local/Loopback       │ to Stasis application  │ to [from-telnyx-buyer]  │ Snoop audio, RTP QoS   │
├──────────────────────┼────────────────────────┼─────────────────────────┼────────────────────────┤
│ Tier 5: Live Carrier │ PSTN / Telnyx SIP Trunk│ Telnyx API Dial to      │ Carrier interop, real  │
│ (Final Validation)   │ to Tracking DID        │ Registered SIP URI      │ PSTN latency, codecs   │
└──────────────────────┴────────────────────────┴─────────────────────────┴────────────────────────┘
```

### Layer Validation Breakdown:
1. **Tier 1 (Direct Event Injection):** Validates database transactions, `SELECT ... FOR UPDATE`, buyer reservations, attempt state transitions, and commercial evaluation. **Carrier Egress Risk: ZERO.**
2. **Tier 2 (Signed HTTP Webhook Replay):** Validates Express middleware, body parsers, Ed25519 signature verification, replay attacks, and distributed `WebhookIdempotencyService` leases. **Carrier Egress Risk: ZERO.**
3. **Tier 3 (FakeTelephonyProvider):** Validates the entire application container with simulated carrier call legs (`mock_buyer_leg_id_...`), call state queries, and timeout handlers. **Carrier Egress Risk: ZERO.**
4. **Tier 4 (Asterisk Loopback):** Validates Asterisk ARI integration, WebSocket event streams, dual-channel Snoop recording, and audio spectral analysis. Media loops back inside Docker. **Carrier Egress Risk: ZERO.**
5. **Tier 5 (Live Telnyx):** Validates external carrier SIP trunks, transcoding, and public webhook delivery. **Carrier Egress Risk: REAL TOLL SPEND ($1.87 Telnyx balance).**

### How to Mechanically Prevent Synthetic Tests from Reaching Telnyx:
- Set `TELNYX_API_KEY=""` or inject `FakeTelephonyProvider`.
- Set `TELEPHONY_QA_ENABLED=true` with `TELEPHONY_QA_ALLOWED_DESTINATIONS=""` (fails closed on dial).
- Ensure `qaGuardService.validateDestinationOrThrow` executes before every carrier dispatch.

---

## 8. Buyer A/B Backend Integration Analysis

Forensic inspection of the waterfall routing implementation in [`apps/api/src/calls/calls.service.ts#L2080-L2260`](file:///C:/Projects/callflow-agent-a/apps/api/src/calls/calls.service.ts#L2080-L2260):

### 8.1 Destination Resolution Pipeline
When a call arrives and prepares the next buyer leg (`prepareNextBuyer`):
1. **Primary Routing Path (Phase DN-1):** Queries `campaign_destination_numbers` mapped to the campaign, ordered by priority.
2. **Endpoint Capacity Check:** Executes `SELECT id, max_concurrent_calls FROM "destination_numbers" WHERE id = ... FOR UPDATE`. Counts active attempts in `call_attempts`.
3. **Buyer Capacity Check:** Executes `SELECT id, max_concurrent_calls FROM "buyers" WHERE id = ... FOR UPDATE`. Counts active rows in `buyer_reservations`.
4. **Waterfall Overflow:** If Buyer A is full (`activeCount >= maxLimit`), the loop executes `continue;` and proceeds to Buyer B.
5. **Dial Target Resolution:** In `CallController.dialNextBuyer`, the destination number is resolved:
   ```typescript
   const dialTarget = this.qaSipAdapter
     ? this.qaSipAdapter.resolveBuyerDestination(dialNumber, result.call)
     : dialNumber;
   ```

### 8.2 Correlation of Reservations, Attempts and Buyer Legs
- **Reservation:** Inserted into `buyer_reservations` with status `ACTIVE`, linking `call_id`, `buyer_id`, and `attempt_id`.
- **Attempt:** Inserted into `call_attempts` with `state: INITIATED`.
- **Correlation via `client_state`:** When dialing, CallFlow packages `{ callId, attemptId, workspaceId }` into a base64 `client_state` payload sent to the carrier ([`call-controller.ts#L996-L1003`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/call-controller.ts#L996-L1003)). When the buyer answers, the webhook echoes `client_state`, enabling 100% deterministic correlation even if provider call IDs differ.

### 8.3 Can Waterfall Logic be Tested Without a Real Carrier?
**YES.** Under Tier 1 (Direct Event Injection) or Tier 3 (`FakeTelephonyProvider`), the entire waterfall logic—including row locks, capacity saturation, overflow from Buyer A to Buyer B, attempt creation, and client state correlation—can be verified with 100% mathematical precision against PostgreSQL `callflow_qa` without a single SIP packet.

---

## 9. Database and Wallet Seed Readiness

### 9.1 Buyer B Schema Requirements (Prerequisite for QA-2B)
To support both the primary Phase DN-1 routing engine and legacy campaign buyer fallbacks, the Buyer B seed must populate the following relations in `callflow_qa` (`127.0.0.1:5433`):

1. **`buyers` Table:**
   - `id`: Unique UUID (e.g., `b0000000-0000-0000-0000-000000000002`)
   - `workspace_id`: `5e20bafe-7306-4da7-9944-62c4c5575a5a`
   - `name`: `"QA Test Buyer B (Overflow)"`
   - `destination_number`: `"+12025550198"` (Valid E.164)
   - `status`: `"ACTIVE"`
   - `max_concurrent_calls`: `2`
   - `timeout`: `30`
2. **`destination_numbers` Table (Primary Route):**
   - `id`: Unique UUID
   - `workspace_id`: `5e20bafe-7306-4da7-9944-62c4c5575a5a`
   - `buyer_id`: Buyer B UUID
   - `destination_number`: `"+12025550198"`
   - `max_concurrent_calls`: `2`
   - `status`: `"ACTIVE"`
3. **`campaign_destination_numbers` Table:**
   - `campaign_id`: `6af31407-3f46-4f1d-90d0-bf08af2e9600`
   - `destination_number_id`: Buyer B Destination Number UUID
   - `priority`: `2` (Buyer A is Priority 1)
   - `status`: `"ACTIVE"`
4. **`campaign_buyers` Table (Legacy Fallback Route):**
   - `campaign_id`: `6af31407-3f46-4f1d-90d0-bf08af2e9600`
   - `buyer_id`: Buyer B UUID
   - `priority`: `2`
   - `status`: `"ACTIVE"`

### 9.2 Financial Side Effects & Wallet Balance Assessment
- **Is the Proposed $50 Wallet Requirement Justified?**
  - **For Verified QA Calls in `QA_WORKSPACE_ID`:** **NO, UNJUSTIFIED.** In [`call-controller.ts#L455-L482`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/call-controller.ts#L455-L482), verified QA calls execute `qa.wallet.bypass` and do not debit or reserve funds from the wallet.
  - **For Unverified Synthetic Calls or QA-2D Multi-Workspace Calls:** **YES, MANDATORY.** In Phase QA-2D, testing involves a secondary workspace (`QA_WORKSPACE_2`). Because `isQaWorkspace` only checks the single UUID in `process.env.QA_WORKSPACE_ID`, calls in `QA_WORKSPACE_2` will execute real wallet reservation checks. Without a seeded `workspace_balances` row containing at least `$50.00` (50,000,000 micro-dollars), calls in `QA_WORKSPACE_2` will fail with `Insufficient balance`.

---

## 10. Reservation Lifecycle and Recovery Assessment

### 10.1 Code Inspection vs. Empirically Verified Behavior

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                               RESERVATION LIFECYCLE RECONCILIATION                               │
├──────────────────────────┬─────────────────────────────┬─────────────────────────────────────────┤
│ LIFECYCLE EVENT          │ CODE IMPLEMENTATION         │ EMPIRICAL RUNTIME VERIFICATION          │
├──────────────────────────┼─────────────────────────────┼─────────────────────────────────────────┤
│ Initial Slot Lock        │ SELECT ... FOR UPDATE       │ Verified in Postgres integration spec;  │
│                          │ in prepareNextBuyer()       │ zero deadlocks under parallel load.     │
├──────────────────────────┼─────────────────────────────┼─────────────────────────────────────────┤
│ Active Reservation Hold  │ INSERT INTO buyer_res...    │ Verified in DB schema; state = ACTIVE.   │
├──────────────────────────┼─────────────────────────────┼─────────────────────────────────────────┤
│ Normal Release on Hangup │ UPDATE buyer_reservations   │ Verified in calls.service.ts:526 on     │
│                          │ SET status = 'RELEASED'     │ caller or buyer hangup webhook.         │
├──────────────────────────┼─────────────────────────────┼─────────────────────────────────────────┤
│ Dial Failure Compensate  │ Catch block in dialNextBuyer│ Verified in call-controller.ts:1062     │
│                          │ releases reservation slot   │ releases slot before next buyer attempt.│
├──────────────────────────┼─────────────────────────────┼─────────────────────────────────────────┤
│ 5-Minute Sweeper Loop    │ runRecoveryBatch() every    │ Code inspection confirms setInterval;   │
│ (Terminal Calls)         │ 5 mins in recovery.service  │ UNVERIFIED IN CONTINUOUS RUNTIME.       │
├──────────────────────────┼─────────────────────────────┼─────────────────────────────────────────┤
│ 15-Minute Stale Timeout  │ RESERVATION_RECOVERY_STALE_ │ Code inspection confirms 15 min filter  │
│ (Provider Poll)          │ SECONDS = 900 in recovery   │ before getCallStatus; UNVERIFIED LIVE.  │
└──────────────────────────┴─────────────────────────────┴─────────────────────────────────────────┘
```

### Critical Architectural Distinctions:
- **Terminal Call Cleanup (5-minute loop):** Lines 71–81 of `reservation-recovery.service.ts` execute on every 5-minute tick and immediately release all `buyer_reservations` whose call state is in `['COMPLETED', 'NO_ANSWER', 'FAILED', 'CANCELED']`. This does **not** require waiting 15 minutes.
- **Provider Status Polling (15-minute threshold):** Only active reservations whose `updated_at` is older than 15 minutes trigger external provider polling via `this.provider.getCallStatus(providerCallId)`.

---

## 11. Tenant-Isolation Assessment

### Reconciling Agent 3's Isolation Concerns:
1. **Competitor Endpoint Information:** As proven in Section 5, `CallsService.getCallDetail` filters `attempts` by `allowedBuyerIds`. A buyer participant cannot see competitor buyer attempts or destinations.
2. **Nested Commercial Redaction:** In `calls.service.ts#L662-L679`, `sanitizeCommercial` strips `payout`, `cost`, and `profit` from Buyer responses, returning only `revenue` and buyer-specific dispute data.
3. **Sidebar Exposure vs. API Guards:** While the frontend sidebar may display navigation tabs due to `!isVendor`, the API endpoints ([`BuyersController`](file:///C:/Projects/callflow-agent-a/apps/api/src/routing/buyers.controller.ts) and [`CampaignsController`](file:///C:/Projects/callflow-agent-a/apps/api/src/routing/campaigns.controller.ts)) enforce `PermissionsGuard` and `WorkspaceRolesGuard`. Unauthorized attempts to list or mutate cross-tenant resources return `HTTP 403 Forbidden`.

---

## 12. QA-2B Blockers and Severity Register

| Blocker ID | Severity | Description | Owner | Required Remediation |
|:---:|:---:|---|:---:|---|
| **BLK-FC-01** | **CRITICAL** | **Missing Buyer B in `callflow_qa` Database**<br>Only Buyer A exists. Waterfall overflow cannot occur without Buyer B. | Agent 2 / DB | Execute authorized seed inserting Buyer B (`max_concurrent_calls = 2`), destination number, and campaign mapping in `callflow_qa`. |
| **BLK-FC-02** | **HIGH** | **Local Channel Dialing Incompatibility**<br>Agent 4's Local channel buyer proposal is rejected by `TelnyxProvider` and QA guards. | Agent 4 / Agent 2 | Align testing harness to use Tier 1 (Direct Injection) or Tier 2/3 (FakeTelephonyProvider) with E.164 destinations for synthetic tests. |
| **BLK-FC-03** | **HIGH** | **Playwright E2E Test Harness Missing**<br>Headless browser tests cannot execute. | Agent 3 | Conduct QA-2B observability verification via backend API polling (`/calls/live-calls`, `/calls`) and Vitest component suites. |
| **BLK-FC-04** | **MEDIUM** | **Single ARI User Lack of Read-Only Role**<br>Asterisk has only `read_only = no`. | Agent 4 | Enforce strict HTTP GET discipline in test scripts; configure `callflow_qa_observer` in `ari.conf` prior to live tests. |
| **BLK-FC-05** | **MEDIUM** | **Missing Asterisk Local Ingress Dialplan Context**<br>`[local-qa-caller]` missing from `extensions.conf`. | Agent 4 | Add `[local-qa-caller]` to `qa/asterisk/extensions.conf` to allow synthetic callers into Stasis. |
| **BLK-FC-06** | **LOW** | **Root `.env` vs `apps/api/.env.qa` Discrepancy**<br>Root has `TELEPHONY_QA_ENABLED=true`; `.env.qa` has `false`. | Agent 2 | Align root `.env` to `false` to maintain consistent hygiene. |

---

## 13. Evidence References & Standards

Every factual finding in this report is classified according to the required evidence standards:

1. **[`apps/api/src/main.ts#L33-L45`](file:///C:/Projects/callflow-agent-a/apps/api/src/main.ts#L33-L45)** — Hard database abort guard terminating non-5433 connections in QA mode. *(Classification: VERIFIED BY RUNTIME INSPECTION)*
2. **[`apps/api/src/telephony/qa/qa-telephony-guard.service.ts#L795-L840`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-telephony-guard.service.ts#L795-L840)** — Outbound allowlist validation and bypass behavior when `isQaEnabled()` is false. *(Classification: VERIFIED BY SOURCE CODE)*
3. **[`apps/api/src/telephony/qa/qa-sip-uri-adapter.service.ts#L55-L85`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-sip-uri-adapter.service.ts#L55-L85)** — Strict restriction of SIP URIs to `sip.telnyx.com`. *(Classification: VERIFIED BY SOURCE CODE)*
4. **[`apps/api/src/telephony/call-controller.ts#L248-L285`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/call-controller.ts#L248-L285)** — Permanent ingress gate rejecting unleased or disabled QA ingress calls. *(Classification: VERIFIED BY SOURCE CODE)*
5. **[`apps/api/src/telephony/call-controller.ts#L455-L482`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/call-controller.ts#L455-L482)** — Explicit QA wallet reservation bypass (`qa.wallet.bypass`). *(Classification: VERIFIED BY SOURCE CODE)*
6. **[`apps/api/src/telephony/call-controller.ts#L996-L1035`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/call-controller.ts#L996-L1035)** — Outbound buyer dialing, client state packaging, and carrier dispatch. *(Classification: VERIFIED BY SOURCE CODE)*
7. **[`apps/api/src/calls/calls.service.ts#L2140-L2195`](file:///C:/Projects/callflow-agent-a/apps/api/src/calls/calls.service.ts#L2140-L2195)** — Row-level locking (`SELECT ... FOR UPDATE`), buyer saturation skipping (`continue;`), and atomic reservation creation. *(Classification: VERIFIED BY SOURCE CODE)*
8. **[`apps/api/src/calls/calls.service.ts#L1342-L1345`](file:///C:/Projects/callflow-agent-a/apps/api/src/calls/calls.service.ts#L1342-L1345)** — Backend filtering of call attempts by `buyer_id`. *(Classification: VERIFIED BY SOURCE CODE)*
9. **[`apps/api/src/routing/campaigns.service.ts#L8-L58`](file:///C:/Projects/callflow-agent-a/apps/api/src/routing/campaigns.service.ts#L8-L58)** — Backend sanitization of campaign responses for buyer participants. *(Classification: VERIFIED BY SOURCE CODE)*
10. **[`apps/api/src/telephony/reservation-recovery.service.ts#L28-L85`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/reservation-recovery.service.ts#L28-L85)** — 5-minute sweeper loop and 15-minute stale threshold. *(Classification: VERIFIED BY SOURCE CODE)*
11. **[`docker ps` Inspection](file:///C:/Projects/callflow-agent-a/qa/reports/qa-2a-final-consolidation/02-original-agent-4-audit.md#L39-L53)** — Verification of `callflow-asterisk-qa` (Asterisk 20.21.0, Up 11 hours) and `callflow-postgres-qa` (Port 5433). *(Classification: VERIFIED BY RUNTIME INSPECTION)*
12. **Historical Phase 1R Results ([`CALLFLOW-PHASE-QA-1R-FINAL-VERDICT.md`](file:///C:/Projects/callflow-agent-a/CALLFLOW-PHASE-QA-1R-FINAL-VERDICT.md))** — Audio tone verification (+48.06 dB SNR). *(Classification: HISTORICAL EVIDENCE)*

---

## 14. Final Recommendation

### Authoritative Recommendation: **`READY FOR CLOSURE WITH MANDATORY PRE-EXECUTION CONDITIONS`**

Phase QA-2A forensic investigations are **concluded**. All technical contradictions between Agent 2, Agent 3, and Agent 4 have been resolved with concrete source-code evidence. 

The closure gate for Phase QA-2A is **APPROVED TO CLOSE**, and Phase QA-2B (Controlled Synthetic Concurrency & Waterfall Testing) is authorized to proceed once the following **four mandatory pre-execution conditions** are satisfied:

1. **Database Condition:** Execute authorized seed script to insert `Buyer B` (`max_concurrent_calls = 2`, `priority = 2`) into `callflow_qa` (`127.0.0.1:5433`).
2. **Telephony Mode Condition:** Authorize QA-2B to execute under **Tier 1 (Direct Event Injection)** or **Tier 3 (FakeTelephonyProvider)** to validate concurrency and overflow with zero carrier egress risk.
3. **Observability Condition:** Authorize API polling (`GET /calls/live-calls` and `GET /calls`) as the authoritative verification harness in lieu of missing Playwright browser automation.
4. **Asterisk Dialplan Condition:** Prior to any local Asterisk tests, add `[local-qa-caller]` to `qa/asterisk/extensions.conf`.

---

**QA-2A-FC AGENT 2 FORENSIC RECONCILIATION COMPLETE**
