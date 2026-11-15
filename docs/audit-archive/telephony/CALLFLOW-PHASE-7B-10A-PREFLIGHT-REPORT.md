# CallFlow Phase 7B-10A: Implementation Acceptance & Controlled Call Preflight

**Status:** COMPLETE & VERIFIED  
**Final Verdict:** **READY FOR CONTROLLED CALL AUTHORIZATION**  
**Audit Mode:** STRICT READ-ONLY VERIFICATION — ZERO LIVE CALLS PLACED  
**Date:** 2026-11-11  
**Branch:** `agent/reporting-backend-fix`  

---

## 1. Source-Code Acceptance Findings

All implementation files reported in Phase 7B-10 have been inspected in the active repository. Exact file paths, method names, and line references are documented below:

| Component / Service | File Path | Method / Identifier | Line References | Status |
| :--- | :--- | :--- | :--- | :---: |
| **`AriWebSocketClientService`** | [`apps/api/src/telephony/qa/ari-websocket-client.service.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/ari-websocket-client.service.ts) | `getWebSocketUrl()`<br>`sanitize()`<br>`connect()`<br>`waitForEvent()`<br>`disconnect()`<br>`handleRawMessage()` | L120–L133<br>L138–L155<br>L167–L253<br>L291–L315<br>L258–L261<br>L332–L385 | **VERIFIED** |
| **`QaOrchestratorService`** | [`apps/api/src/telephony/qa/qa-orchestrator.service.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-orchestrator.service.ts) | `executeTestRun()`<br>`correlateInboundCall()`<br>`notifyBuyerDialed()`<br>`cleanup()` | L155–L449<br>L127–L140<br>L145–L150<br>L452–L585 | **VERIFIED** |
| **`AsteriskAriClientService`** | [`apps/api/src/telephony/qa/asterisk-ari-client.service.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/asterisk-ari-client.service.ts) | `getChannel()`<br>`getChannelVariable()`<br>`getLiveRecording()`<br>`originateChannel()`<br>`recordChannel()` | L344–L355<br>L361–L365<br>L455–L467<br>L373–L408<br>L416–L447 | **VERIFIED** |
| **`QaTelephonyGuardService`** | [`apps/api/src/telephony/qa/qa-telephony-guard.service.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-telephony-guard.service.ts) | `getBoundTestRun()`<br>`isCallBoundToRun()`<br>`bindCallToTestRun()`<br>`consumeInboundTestLease()`<br>`validateDestinationOrThrow()` | L376–L383<br>L388–L392<br>L303–L331<br>L214–L253<br>L591–L613 | **VERIFIED** |
| **`TelephonyProvider.dialBuyer`** | [`apps/api/src/telephony/telephony.provider.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/telephony.provider.ts) | `dialBuyer(..., customHeaders?)` | L13–L20 | **VERIFIED** |
| **`TelnyxProvider.dialBuyer`** | [`apps/api/src/telephony/telnyx/telnyx.provider.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/telnyx/telnyx.provider.ts) | `dialBuyer()` forwards `custom_headers` | L53–L92 (specifically L75–L77) | **VERIFIED** |
| **`CallController.dialNextBuyer`** | [`apps/api/src/telephony/call-controller.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/call-controller.ts) | `dialNextBuyer()` forwards `customHeaders` & binds `buyerCallId` | L850–L1060 (specifically L987–L1007) | **VERIFIED** |
| **Asterisk Dialplan** | [`qa/asterisk/extensions.conf`](file:///C:/Projects/callflow-agent-a/qa/asterisk/extensions.conf) | `[from-telnyx-buyer]` context | L6–L14 | **VERIFIED** |

---

## 2. SIP Custom-Header Correlation Tracing

The complete correlation path from test run creation to Asterisk ARI WebSocket channel correlation was verified step-by-step:

```
[1. QaOrchestratorService.executeTestRun] (L183, L209, L216)
   │  Creates runId = crypto.randomUUID()
   │  Registers runId in QaTelephonyGuardService
   │  Opens inbound lease: { runId, secretToken, expectedCallerCli: +17252574041 }
   ▼
[2. Inbound Webhook: CallController.handleEvent] (L350-L480)
   │  Telnyx delivers call.initiated webhook for DID +17252574041
   │  Checks lease: qaGuardService.consumeInboundTestLease()
   │  Binds caller provider_call_id to runId via bindCallToTestRun()
   ▼
[3. CallController.dialNextBuyer] (L987-L1007)
   │  Evaluates: boundRunId = qaGuardService.getBoundTestRun(call.id) || getBoundTestRun(call.provider_call_id)
   │  Constructs: customHeaders = [{ name: 'X-QA-Run-Id', value: boundRunId }]
   │  Calls: provider.dialBuyer(..., customHeaders)
   │  Binds: qaGuardService.bindCallToTestRun(buyerCallId, boundRunId)
   ▼
[4. TelnyxProvider.dialBuyer] (L75-L77)
   │  Constructs dialParams.custom_headers = customHeaders
   │  Executes: telnyxClient.calls.dial(dialParams)
   ▼
[5. Telnyx Carrier Call Control -> SIP Bridge]
   │  Telnyx formats SIP INVITE towards Asterisk SIP trunk:
   │  INVITE sip:arpitmishra9178@sip.telnyx.com SIP/2.0
   │  X-QA-Run-Id: <boundRunId>
   ▼
[6. Asterisk Media Engine: qa/asterisk/extensions.conf] (L9-L12)
   │  PJSIP matches endpoint [telnyx-buyer]
   │  Executes context [from-telnyx-buyer]:
   │    exten => _.,1,NoOp(Incoming call ... RunID: ${PJSIP_HEADER(read,X-QA-Run-Id)})
   │    same => n,Answer()
   │    same => n,Stasis(callflow-qa,buyer,${PJSIP_HEADER(read,X-QA-Run-Id)})
   ▼
[7. Native WebSocket: AriWebSocketClientService] (L332-L372)
   │  Ingests StasisStart event:
   │  { type: "StasisStart", channel: { id: "ch_buyer_1", state: "Up" }, args: ["buyer", "<boundRunId>"] }
   │  Dispatches to pre-registered waiter in QaOrchestratorService
   ▼
[8. QaOrchestratorService Multi-Factor Correlation] (L283-L301)
   │  Check 1: buyerStasisEvent.args[1] === context.runId (exact string equality)
   │  Check 2: Live Asterisk ARI state verification (GET /ari/channels/{id} === "Up")
   │  Sets context.buyerChannelId = buyerStasisEvent.channel.id
```

### Correlation Security Findings
- **Header Integrity:** The header name `X-QA-Run-Id` and value `<runId>` are preserved identically across all 8 layers.
- **Telnyx SDK Compliance:** Telnyx Node SDK requires `custom_headers` as an array of `{ name: string, value: string }` objects on `calls.dial()`. This exact structure is passed on line 76 of `TelnyxProvider`.
- **Anti-Spoofing Immunity:** An external caller cannot spoof `X-QA-Run-Id` because `CallController.dialNextBuyer` extracts `boundRunId` exclusively from the internal `qaGuardService` in-memory map, populated only when a valid single-use inbound lease is consumed by a matching caller CLI.
- **Rejection of Unmatched/Expired Channels:** Line 284 of `QaOrchestratorService` strictly rejects channels where `args[1] !== runId`. Lines 379 and 496 of `QaTelephonyGuardService` verify timestamps and immediately reject bindings if `Date.now() > binding.expiresAt`.
- **Concurrency Isolation:** The single-concurrency mutex in `QaOrchestratorService` (lines 157–165) ensures that only one test run can be active on the instance at any time. Any unrelated buyer channel entering Asterisk is immediately rejected.
- **Carrier-Level Delivery Caveat:** While code paths, SDK params, Asterisk PJSIP config, and dialplan functions are 100% verified locally, carrier-level header delivery across the live Telnyx PSTN/SIP boundary cannot be certified until the first live SIP INVITE packet is received by Asterisk.

---

## 3. Cleanup Ownership Verification

All 10 cleanup targets in `QaOrchestratorService.cleanup()` ([`qa-orchestrator.service.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-orchestrator.service.ts#L465-L585)) were verified for ownership isolation:

1. **Target 1 (Asterisk Caller Channel):** Hangs up only `context.asteriskChannelId` originated by this run.
2. **Target 2 (Asterisk Buyer Channel):** Hangs up only `context.buyerChannelId` correlated to this run.
3. **Target 3 (Telnyx Legs):** Hangs up only `context.telnyxCallControlId` and `context.telnyxBuyerCallControlId` bound to this run.
4. **Target 4 (Asterisk Live Recordings):** Stops only `context.callerRecordingName` (`qa-caller-<uuid>`) and `context.buyerRecordingName` (`qa-buyer-<uuid>`).
5. **Target 5 (Asterisk Stored Recordings):** Deletes only `context.callerRecordingName` and `context.buyerRecordingName`.
6. **Target 6 (Server Test Run Registry):** Unregisters only `context.runId`.
7. **Target 7 (Call Bindings):** Releases only `context.prismaCallId`, `context.telnyxCallControlId`, and `context.telnyxBuyerCallControlId`.
8. **Target 8 (Inbound Leases):** Invokes `expireStaleBindings()` which sweeps expired leases and released bindings.
9. **Target 9 (Wallet Reservation):** Invokes `walletService.releaseReservation(context.workspaceId, callRef)`. In CallFlow wallet mechanics, `releaseReservation` only unblocks reserved funds with **ZERO debits** and **ZERO ledger mutations**.
10. **Target 10 (WebSocket Disconnection):** Invokes `wsClient.disconnect()` on the local service instance without touching other connections.
- **Production Guard:** `context.workspaceId` is strictly restricted to the QA workspace. Production workspace IDs are unconditionally rejected by `FORBIDDEN_WORKSPACE_IDS`.

---

## 4. Media & Recording Test Boundaries

Test boundaries are cleanly demarcated across three distinct tiers:

1. **Mocked Audio Tests ([`qa-audio-analyzer.service.spec.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-audio-analyzer.service.spec.ts), [`qa-orchestrator.service.spec.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-orchestrator.service.spec.ts)):**
   - Synthetically generated PCM mono WAV buffers (1000 Hz and 1500 Hz).
   - Validates Goertzel FFT filter math, SNR calculations, clipping detection, and silence detection.
   - **Boundary:** Proves analyzer correctness, but does *not* prove carrier RTP transport.
2. **Local Asterisk Recording Tests ([`asterisk-ari-client.service.spec.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/asterisk-ari-client.service.spec.ts)):**
   - Communicates with the live local Docker container `callflow-asterisk-qa` on `127.0.0.1:8088`.
   - Validates ARI REST recording creation, stopping, deletion, and downloading.
   - **Boundary:** Proves Asterisk 20 ARI recording APIs function, but does *not* prove audio traversal through the carrier.
3. **Actual Carrier RTP Verification (Pending First Live Call):**
   - Requires a real carrier call bridged through Telnyx to Asterisk.
   - Asterisk will record the incoming media on both legs and Goertzel FFT will analyze the true carrier audio streams.
   - **Boundary:** Must occur during the controlled live test.

---

## 5. Current Environment Status

A strict read-only audit of the current environment confirms:

- **QA Database Target:** `postgresql://callflow_qa_user:***@127.0.0.1:5433/callflow_qa` (Docker container `callflow-postgres-qa` healthy, air-gapped from production Supabase).
- **Asterisk ARI Media Engine:** Listening on `127.0.0.1:8088`, `5060/udp`, `10000-10050/udp` (Docker container `callflow-asterisk-qa` healthy, Asterisk 20.21.0).
- **QA Backend Process (Port 3000):** Stopped (Ready to launch via `node qa/launch-qa-backend.mjs`).
- **Public Ingress / ngrok Tunnel:** Stopped (Ready to launch via `ngrok http 3000` to expose `https://coherent-undrilled-disarm.ngrok-free.dev`).
- **Fail-Closed Configuration Guards in `apps/api/.env.qa`:**
  - `TELEPHONY_QA_ENABLED=false` (strictly disabled)
  - `TELNYX_QA_TRACKING_DID=""` (empty)
  - `TELEPHONY_QA_ALLOWED_DESTINATIONS=""` (empty)

---

## 6. Exact Preflight Requirements Before Live Test

To initiate the first controlled carrier test call, the operator must execute the following sequence:

1. **Launch Ingress Tunnel:**  
   Start ngrok on port 3000: `ngrok http 3000 --domain=coherent-undrilled-disarm.ngrok-free.dev`.
2. **Start QA Backend:**  
   Launch NestJS backend on port 3000: `node qa/launch-qa-backend.mjs`.
3. **Configure Guard Flags in `apps/api/.env.qa`:**  
   ```ini
   TELEPHONY_QA_ENABLED=true
   TELNYX_QA_TRACKING_DID=+17252574041
   TELEPHONY_QA_ALLOWED_DESTINATIONS=+12025550199
   ```
4. **Authorize Single Test Run:**  
   Trigger `POST /qa/test-run` with options `{ trackingDid: "+17252574041", minDurationSecs: 2.0 }`.
5. **Immediate Post-Test Lockout:**  
   Revert `TELEPHONY_QA_ENABLED=false` immediately upon completion.

---

## 7. Final Verdict

**READY FOR CONTROLLED CALL AUTHORIZATION**
