# CALLFLOW — QA-2F FRESH STAGE 1 PREFLIGHT & RELEASE GATE AUDIT REPORT

**Phase ID:** `CALLFLOW-PHASE-QA-2F-STAGE-1`  
**Phase Name:** Live Telnyx Carrier Overflow Verification — Fresh Preflight & Release Gate  
**Owner:** Agent 4 — Telephony, Asterisk ARI, SIP, RTP & Recording Infrastructure  
**Supporting Owner:** Agent 2 — Backend & Application Services  
**Mode:** STRICT READ-ONLY FORENSIC AUDIT (ZERO MUTATIONS, ZERO LIVE CALLS)  
**Execution Timestamp:** 2026-11-15T01:46:00Z  
**Final Release Gate Verdict:** **`BLOCKED`**

---

## 1. Executive Summary & Categorical Release Gate Verdict

In accordance with explicit governance instructions for Phase QA-2F:
> *"Mode: READ-ONLY VERIFICATION. Live calls: STRICTLY PROHIBITED IN THIS STAGE. Perform a fresh independent preflight against the CURRENT running environment. Do not rely solely on previous remediation report claims... Do not restart services or change configuration during this read-only preflight."*

Agent 4, supported by Agent 2, conducted an independent forensic audit of the active runtime environment across all five mandatory verification dimensions (A through E).

### The Critical Gating Blocker
The source TypeScript codebase ([`apps/api/src/telephony/qa/qa-sip-uri-adapter.service.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-sip-uri-adapter.service.ts)) contains the correct dual-buyer logic and passes **96 out of 96 unit and regression tests**.

**However, the compiled distribution artifact ([`apps/api/dist/main.js`](file:///C:/Projects/callflow-agent-a/apps/api/dist/main.js)) currently executing in the live NestJS process on port 3000 is STALE.** It was compiled prior to the dual-buyer implementation. Direct runtime inspection of `apps/api/dist/telephony/qa/qa-sip-uri-adapter.service.js` revealed:
1. `isLogicalQaBuyer()` only inspects `LOGICAL_QA_BUYER_CLI = '+12025550199'` (Buyer A).
2. `resolveBuyerDestination()` unconditionally calls `this.getConfiguredBuyerSipUri()`, resolving **all** buyer calls to Buyer A (`sip:arpitmishra9178@sip.telnyx.com`).
3. When the live backend process resolves Buyer B's logical number (`+12025550198`), **it resolves to Buyer A's SIP URI instead of Buyer B's SIP URI**.

Because this phase is strictly read-only and restarts or re-compilations are prohibited during the audit, this critical defect cannot be bypassed. If live carrier calls were placed right now, **Buyer B calls would fall back to Buyer A**, violating the primary overflow test objective.

Therefore, the categorical verdict for the Fresh Stage 1 Preflight is **`BLOCKED`**.

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                            QA-2F FRESH STAGE 1 PREFLIGHT VERDICT MATRIX                          │
├───────────────────────────────────────────────────┬───────────────┬──────────────────────────────┤
│ EVALUATION DIMENSION                              │ STATUS        │ AUDIT EVIDENCE & FINDINGS    │
├───────────────────────────────────────────────────┼───────────────┼──────────────────────────────┤
│ A. Backend Routing (Dist vs Source Desync)        │ BLOCKED       │ Dist resolves Buyer B -> A   │
│ B. QA Database & Process Isolation                │ PASS          │ callflow_qa @ 127.0.0.1:5433 │
│ C. Telnyx & Asterisk Dual-Buyer SIP Identity      │ PASS          │ Dual credential conn & PJSIP │
│ D. Webhook End-to-End Cryptographic Security      │ PASS          │ Ed25519 signature verified   │
│ E. Resource & Production Zero-Expenditure Safety  │ PASS          │ 0 channels, $1.86 balance    │
└───────────────────────────────────────────────────┴───────────────┴──────────────────────────────┘
```

**Final Release Gate Verdict:** **`BLOCKED`** (Recompilation of `apps/api/dist` required before authorizing Stage 2).

---

## 2. Granular Forensic Preflight Findings

### Section A: Backend Routing Verification

#### 1 & 2. Buyer A and Buyer B Logical Resolution & Fallback Behavior
- **TypeScript Source (`apps/api/src/telephony/qa/qa-sip-uri-adapter.service.ts`):**
  - Resolves Buyer A (`+12025550199` or UUID `7deb4e0a-8674-4b4b-a170-0aff3991f69c`) -> `sip:arpitmishra9178@sip.telnyx.com`.
  - Resolves Buyer B (`+12025550198` or UUID `b0000000-0000-0000-0000-000000000002`) -> `sip:arpitmishra9178b@sip.telnyx.com`.
  - Fails closed with `TelephonyProviderError` if `TELEPHONY_QA_BUYER_B_SIP_URI` is unset. Fallback to Buyer A is strictly prohibited.
- **Compiled Runtime Distribution (`apps/api/dist/telephony/qa/qa-sip-uri-adapter.service.js`):**
  - Contains stale code from single-buyer implementation.
  - `isLogicalQaBuyer()` only knows `+12025550199`.
  - Lines 88-99 unconditionally execute `configuredUri = this.getConfiguredBuyerSipUri()` (`sip:arpitmishra9178@sip.telnyx.com`).
  - **Live Runtime Test Result:**
    ```text
    [Nest] LOG [QaSipUriAdapterService] QA SIP URI adapter resolved buyer destination: +12025550198 -> sip:arpitmishra9178@sip.telnyx.com
    Error: FATAL: Buyer A and Buyer B resolved to identical SIP URIs!
    ```
  - **Verdict:** **BLOCKED**.

#### 3. Matching SIP URIs to Telnyx Credential Connections
- Configured Buyer A URI: `sip:arpitmishra9178@sip.telnyx.com` -> Username: `arpitmishra9178` (Matches Telnyx Connection `3089429617522508888`).
- Configured Buyer B URI: `sip:arpitmishra9178b@sip.telnyx.com` -> Username: `arpitmishra9178b` (Matches Telnyx Connection `3093376551908017755`).
- Configured Caller URI: `sip:arpitmishra917@sip.telnyx.com` -> Username: `arpitmishra917` (Matches Telnyx Connection `3089420521612248192`).
- **Verdict:** **PASS**.

#### 4 & 5. Allowlist & Unknown Destination Fail-Closed Enforcement
- `TELEPHONY_QA_ALLOWED_DESTINATIONS`: Strictly contains `+12025550199,+12025550198`.
- Live test of unknown destinations:
  - `+12025550197`: Throws `TelephonyProviderError(ROUTING_FAILED, "destination +12025550197 is not authorized for QA")`.
  - `+15551234567`: Throws `TelephonyProviderError(ROUTING_FAILED, "destination +15551234567 is not authorized for QA")`.
  - Non-E.164 strings: Throws `TelephonyProviderError(ROUTING_FAILED, "is not a valid E.164 number")`.
- **Verdict:** **PASS**.

#### 6. Unit & Regression Suite Applicability
- Ran Vitest against [`qa-sip-uri-adapter.service.spec.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-sip-uri-adapter.service.spec.ts) and [`qa-telephony-guard.service.spec.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-telephony-guard.service.spec.ts):
  ```text
  Test Files  2 passed (2)
       Tests  96 passed (96)
    Duration  6.11s
  ```
- All 96 tests passed cleanly, validating that Agent 2's test suite covers all fail-closed boundaries.
- **Verdict:** **PASS**.

---

### Section B: QA Isolation Verification

#### 1. NestJS Process Database Target
- The running NestJS process (PID 18144) was bootstrapped via `qa/launch-qa-backend.mjs`.
- Startup logs verify:
  ```text
  [PASS] Validated QA Database Target: callflow_qa_user@127.0.0.1:5433/callflow_qa
  [PASS] Stage A Workspace (5e20bafe-7306-4da7-9944-62c4c5575a5a) and Campaign (6af31407-3f46-4f1d-90d0-bf08af2e9600) confirmed present in callflow_qa.
  ```
- Endpoint `GET http://127.0.0.1:3000/health` confirms `services.database.status: "up"`.
- **Verdict:** **PASS**.

#### 2. Production Database & Supabase Credential Stripping
- Process environment variables `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_SERVICE_ROLE_KEY` were deleted prior to boot.
- Startup log line 225 confirms:
  ```text
  [Nest] LOG [DatabaseIsolation] Stripped production environment variable: SUPABASE_URL
  ```
- Production pooler port 6543 and remote Supabase domains are strictly rejected by the startup regex.
- **Verdict:** **PASS**.

#### 3. Investigation: Root `.env` Synchronization of `TELEPHONY_QA_ENABLED=true`
- **Cause:** In Phase QA-2D, Agent 2 synchronized QA environment variables into the root `.env` to allow root test runners (`npx vitest`) and ad-hoc Node CLI scripts running from repo root to load QA defaults via `dotenv`.
- **Cross-Process Impact Analysis:**
  - `apps/web`: Source search confirmed `apps/web` contains **zero references** to `TELEPHONY_QA_ENABLED`.
  - Normal NestJS startup: If `apps/api` were started without `APP_ENV=qa`, `main.ts` would load root `.env`, setting `TELEPHONY_QA_ENABLED=true`.
  - **Defense-in-Depth:** In `QaTelephonyGuardService.isQaCall(callContext)`, a call is only classified as QA if it has an explicit in-memory binding in `boundCalls` or an unconsumed lease in `activeLeases`. Real production calls lack this server-side registration and are processed strictly as production calls.
  - **Recommendation:** Although shielded by the server-side binding guard, `TELEPHONY_QA_ENABLED=true` should be removed from root `.env` and kept strictly within `apps/api/.env.qa` to ensure zero possibility of ambient leakage.
- **Verdict:** **PASS (WITH ARCHITECTURAL NOTE)**.

#### 4. Server-Bound Execution Guard Fail-Closed Enforcement
- Probed `GET http://127.0.0.1:3000/qa/status`:
  - Without header: Returns `HTTP 401 Unauthorized` (`Authentication required for QA operations`).
  - With `x-qa-key`: Returns `HTTP 200 OK` (`{"qaEnabled":true,"configValid":true,"configErrors":[],"activeRun":null}`).
- Inbound calls arriving at `CallController` without an active, unconsumed lease in `activeLeases` are immediately terminated via `hangupCall()` without database persistence or outbound dialing.
- **Verdict:** **PASS**.

---

### Section C: Telnyx & Asterisk Buyer B Identity Verification

#### 1 & 2. Telnyx Credential Connections Audit
Direct query to Telnyx API v2 (`https://api.telnyx.com/v2/credential_connections`):
```text
- Connection ID: 3089429617522508888 | Name: Buyer      | User: arpitmishra9178  | Pref: unrestricted
- Connection ID: 3093376551908017755 | Name: QA Buyer B | User: arpitmishra9178b | Pref: unrestricted
- Connection ID: 3089420521612248192 | Name: caller     | User: arpitmishra917   | Pref: null
```
Buyer A and Buyer B credential connections are completely distinct entities on the carrier.
- **Verdict:** **PASS**.

#### 3 & 4. Live Asterisk PJSIP Registration & Endpoint Inspection
Query `pjsip show registrations` inside container `callflow-asterisk-qa`:
```text
telnyx-buyer-b-reg/sip:sip.telnyx.com:5060  telnyx-buyer-b-auth  Registered  (exp. 55s)
telnyx-buyer-reg/sip:sip.telnyx.com:5060    telnyx-buyer-auth    Registered  (exp. 113s)
telnyx-caller-reg/sip:sip.telnyx.com:5060   telnyx-caller-auth   Registered  (exp. 67s)
```
- Both registrations use `line=true`.
- Buyer A endpoint: `telnyx-buyer`, AOR: `telnyx-buyer-aor`.
- Buyer B endpoint: `telnyx-buyer-b`, AOR: `telnyx-buyer-b-aor`.
- **Verdict:** **PASS**.

#### 5 & 6. Dialplan Context Isolation & Identical SBC Proxy Contact IP
- **Identical Proxy Contact Investigation:**
  Both `telnyx-buyer-aor` and `telnyx-buyer-b-aor` point to `sip:sip.telnyx.com:5060` (resolving to Telnyx SBC proxy IPs `192.76.120.10` / `64.16.250.10`).
  This is the standard architectural design for Telnyx credential connections: Asterisk registers outbound to Telnyx's centralized SBC proxy cluster.
- **Disambiguation via RFC 3261 Line Identification:**
  In `pjsip.conf`, the global endpoint identifier order is:
  ```text
  endpoint_identifier_order: line,username,ip
  ```
  Because both registrations have `line=true`, Asterisk injects a unique token into its Contact header during REGISTER. When Telnyx delivers inbound calls for Buyer A vs Buyer B, the incoming Request-URI contains the specific line token. PJSIP evaluates the line token **before** inspecting the source IP, guaranteeing deterministic endpoint matching.
- **Mapped Contexts:**
  - `telnyx-buyer` -> `context: from-telnyx-buyer`
  - `telnyx-buyer-b` -> `context: from-telnyx-buyer-b`
- **Verdict:** **PASS**.

#### 7. Cross-Routing Prevention
- Inbound Buyer B calls match `telnyx-buyer-b` and execute context `[from-telnyx-buyer-b]`, calling `Stasis(callflow-qa,buyer-b,...)`. It is structurally impossible for Buyer B to route into `[from-telnyx-buyer]`.
- **Verdict:** **PASS**.

---

### Section D: Webhook End-to-End Security Verification

#### 1 & 5. ngrok Public Webhook Ingress Forwarding
- ngrok client API (`http://127.0.0.1:4040/api/tunnels`) inspection:
  ```text
  Tunnel: command_line -> https://coherent-undrilled-disarm.ngrok-free.dev -> http://localhost:3000
  ```
- Public URL exactly matches Telnyx Call Control Application `3090207513618941231` webhook destination: `https://coherent-undrilled-disarm.ngrok-free.dev/webhooks/telnyx`.
- **Verdict:** **PASS**.

#### 2 & 3. Ed25519 Cryptographic Signature Rejection Matrix
Tested directly against the running NestJS backend:

| Test Case | Request Condition | Response Code | Handler Response Body | Verdict |
| :--- | :--- | :--- | :--- | :--- |
| **Missing Headers** | No signature or timestamp | `HTTP 400` | `{"message":"Missing webhook signature headers or body"}` | **PASS** |
| **Malformed Sig** | Non-64-byte base64 string | `HTTP 400` | `Webhook Error: Invalid signature format` | **PASS** |
| **Expired Timestamp**| Timestamp > 300s old | `HTTP 400` | `Webhook Error: Webhook timestamp too old or too new` | **PASS** |
| **Tampered / Invalid**| Valid 64-byte random signature | `HTTP 400` | `Webhook Error: Signature verification failed: signature does not match payload` | **PASS** |

#### 6. Valid Signed Synthetic Telnyx Webhook Fixture
- Generated an isolated Ed25519 keypair and signed a full Telnyx `call.initiated` payload over `${timestamp}|${payload}`.
- Verified using Telnyx SDK `unwrapWebhook`:
  - Valid signature verified cleanly; returned decoded event ID `evt_synthetic_1794707118721`.
  - Mutated payload (`call.initiated` -> `call.bridged`) immediately failed cryptographic verification.
- **Verdict:** **PASS**.

#### 4. Synthetic Event Processing & Zero Outbound Dialing
- Source inspection of `CallController.ts` lines 246–285 confirms:
  Inbound `call.initiated` events directed to `TELNYX_QA_TRACKING_DID` are validated against `consumeInboundLease()`.
  If no active, unconsumed server-side lease matches the incoming call, the controller executes:
  ```typescript
  this.logger.warn(`qa.ingress.rejected: Call ${callId} to dedicated QA tracking DID has no active trusted QA lease. Terminating immediately.`);
  await this.provider.hangupCall(callId);
  return;
  ```
  The call is immediately hung up. It never creates a database record, never enters the waterfall router, and never dials an outbound buyer leg.
- **Verdict:** **PASS**.

---

### Section E: Resource & Safety Verification

#### 1. Asterisk Active Channels & Bridges
- `docker exec callflow-asterisk-qa asterisk -rx "core show channels count"`:
  ```text
  0 active channels
  0 active calls
  ```
- `docker exec callflow-asterisk-qa asterisk -rx "bridge show all"`:
  ```text
  0 active bridges
  ```
- **Verdict:** **PASS**.

#### 2. Carrier Active Calls Check
- Telnyx API query (`https://api.telnyx.com/v2/calls`):
  ```text
  Active Live Calls on Telnyx Account: 0
  ```
- **Verdict:** **PASS**.

#### 3 & 4. Carrier Balance & Purchase Audit
- Telnyx balance query (`https://api.telnyx.com/v2/balance`):
  ```text
  Balance: $1.86 USD (Credit limit: $0.00 USD)
  ```
- Balance remains unchanged from pre-audit baseline. Zero charges incurred.
- Phone number inventory query (`https://api.telnyx.com/v2/phone_numbers`):
  Account contains 5 existing pre-owned phone numbers. Exactly zero phone numbers were purchased during QA-2E, QA-2F, or remediation.
- **Verdict:** **PASS**.

#### 5. Read-Only Execution Adherence
- Zero service restarts performed.
- Zero configuration files modified.
- Zero live calls initiated.
- **Verdict:** **PASS**.

---

## 3. Required Remediation to Unblock Stage 2

To unblock Phase QA-2F for Stage 2 live execution, the following single remediation step must be authorized:

1. **Rebuild the NestJS Backend Binary:**
   ```bash
   npm --workspace=api run build
   ```
2. **Restart the QA Backend Daemon:**
   Restart `node qa/launch-qa-backend.mjs` to load the freshly compiled `apps/api/dist/main.js` containing the dual-buyer routing adapter.

---

## 4. Final Verdict

### Categorical Verdict: **`BLOCKED`**

**Reason:** Compiled distribution artifact `apps/api/dist/main.js` is desynchronized from TypeScript source, causing Buyer B calls to resolve to Buyer A in the live running process.

**Hold Status:** Live PSTN/Telnyx calls remain strictly prohibited. Awaiting user authorization to recompile the backend.
