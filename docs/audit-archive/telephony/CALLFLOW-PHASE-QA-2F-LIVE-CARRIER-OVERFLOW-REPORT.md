# CALLFLOW — QA-2F: LIVE TELNYX CARRIER OVERFLOW VERIFICATION AUDIT & PREFLIGHT REPORT

**Phase ID:** `CALLFLOW-PHASE-QA-2F`  
**Phase Name:** Live Telnyx Carrier Overflow Verification  
**Owner:** Agent 4 — Telephony, Asterisk ARI, SIP, RTP & Recording Infrastructure  
**Mode:** CONTROLLED LIVE QA CARRIER AUDIT (STAGE 1 PREFLIGHT)  
**Execution Timestamp:** 2026-11-15T01:00:00Z  
**Final Verdict:** **`BLOCKED`** (Mandatory Hard Stop Enforced in Stage 1)

---

## 1. Executive Summary & Hard Stop Declaration

In accordance with the explicit governance instructions for Phase QA-2F:
> *"Hard stop: If Buyer B is unavailable, a destination is unverified, the QA/production boundary is unclear, or any required resource would need purchasing or production modification, do not improvise. Report the blocker."*

Agent 4 has executed the exhaustive **Stage 1 Mandatory Preflight**. The inspection conclusively proved that while the QA Asterisk environment, local database schema, and single-buyer carrier SIP trunk are verified, **a distinct, independent live Buyer B carrier/SIP endpoint does NOT exist in the infrastructure or application routing layer**.

Furthermore, the live webhook ingress path is currently inactive (NestJS backend on port 3000 is stopped, and the ngrok ingress URL returns HTTP 404).

Initiating live carrier calls under these conditions would result in immediate call drop, unhandled routing errors, or safety guard rejection. Therefore, **Stage 2 Live Execution is halted under strict safety policy**. The categorical verdict for Phase QA-2F is **`BLOCKED`**.

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 QA-2F STAGE 1 PREFLIGHT VERDICT MATRIX                           │
├───────────────────────────────────────────────────┬───────────────┬──────────────────────────────┤
│ EVALUATION DIMENSION                              │ STATUS        │ FINDING & EVIDENCE           │
├───────────────────────────────────────────────────┼───────────────┼──────────────────────────────┤
│ 1. QA Asterisk Container & ARI Idle State         │ PASS          │ Asterisk 20.21.0, 0 ch, 0 br │
│ 2. Telnyx Account Balance & API Reachability      │ PASS          │ $1.86 USD available          │
│ 3. Telnyx QA Tracking DID Ingress Mapping         │ PASS          │ +17252574041 -> App 30902075 │
│ 4. Caller & Buyer A SIP Endpoint Reachability     │ PASS          │ arpitmishra917 / 9178 online │
│ 5. Distinct Buyer B Carrier/SIP Endpoint          │ BLOCKED (FATAL│ NO Buyer B SIP connection    │
│ 6. Backend SIP URI Adapter Mapping for Buyer B    │ BLOCKED (FATAL│ Hardcoded to Buyer A only    │
│ 7. Telephony Guard Allowlist Configuration        │ BLOCKED (FATAL│ ALLOWED_DESTINATIONS empty   │
│ 8. Live Webhook Ingress Availability              │ BLOCKED       │ Port 3000 down / ngrok 404   │
└───────────────────────────────────────────────────┴───────────────┴──────────────────────────────┘
```

---

## 2. Granular Stage 1 Preflight Forensic Findings

### 2.1 Asterisk 20 Container, ARI Application & Bridge State
- **Container Identity:** `callflow-asterisk-qa` (Container ID: `d9264b6a5db7`)
- **Asterisk Version:** `Asterisk 20.21.0` (Alpine Linux)
- **Status:** Healthy (Uptime $> 1$ hour)
- **ARI API Status:** `127.0.0.1:8088` responsive, authenticated via Basic Auth `callflow_qa`
- **Active Channels:** `0` (Idle)
- **Active Bridges:** `0` (Idle)
- **PJSIP Endpoints:**
  - `PJSIP/telnyx-caller`: State `online`
  - `PJSIP/telnyx-buyer`: State `online`
  - `PJSIP/telnyx-buyer-b`: **DOES NOT EXIST**

### 2.2 Telnyx Account Balance, Applications & DIDs
Inspection via Telnyx REST API v2 (`https://api.telnyx.com/v2`):
- **Account Balance:** `$1.86 USD` (Credit limit: `$0.00`). Balance is positive and sufficient for low-duration test calls if authorized, but cannot support purchasing new numbers.
- **QA Call Control Application:**
  - Application ID: `3090207513618941231`
  - Name: `CallFlow Autonomous QA`
  - Configured Webhook URL: `https://coherent-undrilled-disarm.ngrok-free.dev/webhooks/telnyx`
- **Associated QA Inbound DID:**
  - Phone Number: `+17252574041`
  - Connection ID: `3090207513618941231` (mapped directly to the QA Call Control Application)
  - Carrier Status: `active`

### 2.3 Live Webhook Ingress Availability (BLOCKER)
- Direct probe to ngrok tunnel `https://coherent-undrilled-disarm.ngrok-free.dev/` returned **HTTP 404 Not Found**.
- Direct probe to local NestJS API `http://localhost:3000/` returned **`fetch failed` (Connection Refused)**.
- **Forensic Assessment:** The NestJS API process is offline. If a carrier call were placed to `+17252574041`, Telnyx would dispatch `call.initiated` to ngrok, receive HTTP 404, fail to obtain call control commands, and terminate the call immediately.

### 2.4 Verified SIP Endpoints & Registration Status
Inspection of Telnyx Credential Connections:
1. **Connection `3089420521612248192` (Caller Leg):**
   - Username: `arpitmishra917`
   - Active: `true`
   - Asterisk PJSIP Registration: `telnyx-caller` (Bound to outbound CLI `+17207159445`)
2. **Connection `3089429617522508888` (Buyer Leg A):**
   - Username: `arpitmishra9178`
   - Active: `true`
   - Asterisk PJSIP Registration: `telnyx-buyer` (Terminates incoming buyer calls in context `[from-telnyx-buyer]`)
3. **Connection for Buyer Leg B:**
   - **NOT CONFIGURED ON TELNYX.**
   - No secondary SIP credential connection exists for Buyer B.

---

## 3. The Buyer B Hard Stop Root-Cause Analysis

The objective of QA-2F is to verify live waterfall overflow: Call 1 and Call 2 route to Buyer A, while Call 3 overflows to Buyer B. Stage 1 preflight revealed three independent structural blockers preventing Buyer B from receiving a real routed call:

### Blocker A: Absence of Distinct Carrier SIP Endpoint for Buyer B
On the carrier side, Telnyx has only one buyer SIP account (`arpitmishra9178`). There is no second SIP user or credential connection. On the Asterisk container side, only `telnyx-buyer` is configured in `/etc/asterisk/pjsip.conf`. There is no `telnyx-buyer-b` endpoint or registration.

### Blocker B: Architectural Hardcoding in `QaSipUriAdapterService`
Inspection of [`apps/api/src/telephony/qa/qa-sip-uri-adapter.service.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-sip-uri-adapter.service.ts) reveals that the routing translation layer is architecturally incapable of handling Buyer B:
1. **Logical Buyer Guard Hardcoded to Buyer A Only:**
   ```typescript
   // Line 15
   public static readonly LOGICAL_QA_BUYER_CLI = '+12025550199';
   ```
   In the QA database, Buyer B is seeded as `destination_number = '+12025550198'`. When Call 3 attempts to route to Buyer B, `isLogicalQaBuyer('+12025550198')` evaluates to `false`.
2. **Single Destination URI Resolution:**
   ```typescript
   // Line 136
   const configuredUri = this.getConfiguredBuyerSipUri();
   ```
   The service only reads `process.env.TELEPHONY_QA_BUYER_SIP_URI`, which points exclusively to `sip:arpitmishra9178@sip.telnyx.com`. It has no knowledge of or support for a secondary Buyer B SIP destination.

### Blocker C: Telephony Guard Allowlist Fails Closed
In [`apps/api/src/telephony/qa/qa-telephony-guard.service.ts#L806-L814`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-telephony-guard.service.ts#L806-L814):
```typescript
const allowlistResult = this.parseAllowlist();
if (!allowlistResult.valid) {
  this.logger.error(`QA telephony guard failed closed: ${allowlistResult.error}`);
  throw new TelephonyProviderError(
    TelephonyErrorType.ROUTING_FAILED,
    `QA guard blocked outbound call: ${allowlistResult.error}`,
  );
}
```
In both `.env` and `apps/api/.env.qa`, `TELEPHONY_QA_ALLOWED_DESTINATIONS=` is completely **empty**. When the routing engine attempts to validate Buyer B (`+12025550198`), `validateDestinationOrThrow()` fails closed and immediately rejects the call.

---

## 4. QA Database & Application Routing State

Inspection of PostgreSQL QA database (`callflow_qa` on port 5433):
- **Workspace:** `5e20bafe-7306-4da7-9944-62c4c5575a5a` (`CallFlow QA Autonomous Workspace`)
- **Tracking DID:** `+17252574041` (Mapped to Campaign `6af31407-3f46-4f1d-90d0-bf08af2e9600`)
- **Campaign Waterfall:**
  - **Priority 1:** Buyer A (`7deb4e0a-8674-4b4b-a170-0aff3991f69c`), `max_concurrent_calls = 2`, `status = ACTIVE`
  - **Priority 2:** Buyer B (`b0000000-0000-0000-0000-000000000002`), `max_concurrent_calls = 2`, `status = ACTIVE`
- **Database Consistency:** Database schema and campaign priorities are correctly seeded for 2-call concurrency with overflow to Buyer B.
- **Resource Boundary:** Database queries verified strictly targeting `callflow_qa` (Port 5433). Zero production databases or tables were accessed.

---

## 5. Carrier Expenditure & Financial Safety Assessment

- **Current Telnyx Balance:** `$1.86 USD`
- **Carrier Spend During QA-2F:** **`$0.0000 USD`** (Zero calls placed).
- **Purchases Avoided:** No additional carrier phone numbers, SIP trunks, or subscriptions were purchased.
- **Financial Safety Verdict:** **100% INTACT**.

---

## 6. Prerequisites Required Before QA-2F Can Proceed

To unblock Phase QA-2F without violating production boundaries or carrier budgets:

| # | Domain | Required Remediation |
|---|---|---|
| **1** | **Backend Webhook Host** | Start the NestJS API application (`apps/api`) on port 3000 and establish a live, verified ngrok tunnel targeting `/webhooks/telnyx`. |
| **2** | **Buyer B SIP Endpoint** | Create a secondary SIP connection on Telnyx (or a secondary Asterisk PJSIP endpoint `telnyx-buyer-b`) to receive overflow calls independently. |
| **3** | **SIP Adapter Support** | Update `QaSipUriAdapterService` to support dual-buyer resolution (e.g. mapping Buyer A to `TELEPHONY_QA_BUYER_A_SIP_URI` and Buyer B to `TELEPHONY_QA_BUYER_B_SIP_URI`). |
| **4** | **Telephony Guard Allowlist** | Populate `TELEPHONY_QA_ALLOWED_DESTINATIONS=+12025550199,+12025550198` in `apps/api/.env.qa` to allow both buyer legs to pass validation. |
| **5** | **Asterisk Dialplan** | Add dialplan routing in `qa/asterisk/extensions.conf` to handle and distinguish Buyer B inbound legs. |

---

## 7. Categorical Verdict & Stage 1 Sign-Off

### Final Categorical Verdict: **`BLOCKED`**

**Audit Determination:**
In strict compliance with the Phase QA-2F preflight protocol, live carrier call initiation was halted prior to any live dialing. Real carrier-originated overflow routing cannot be verified until a distinct Buyer B destination is created and the webhook ingestion path is online.

*Agent 4 — Telephony, Asterisk ARI, SIP, RTP & Recording Infrastructure*  
*November 15, 2026*
