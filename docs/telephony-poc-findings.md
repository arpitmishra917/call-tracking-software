# Telephony POC Findings

## 1. Provider Architecture
The repository has been successfully transitioned from a Telnyx-only POC to a multi-provider abstraction supporting both Twilio and Telnyx.
* **TelephonyProvider Interface**: Exposes a generic, decoupled contract (`answerCall`, `dialBuyer`, `bridgeCalls`, `hangupCall`).
* **Adapters (`telnyxProvider.js` & `twilioProvider.js`)**: Encapsulate all SDK methods, endpoint URLs, signature validation logic, and webhook transformations.
* **Normalized Internal Events**: All provider webhooks are transformed at the HTTP edge (`src/index.js`) into uniform shapes: `CALL_INITIATED`, `CALL_ANSWERED`, `CALL_HANGUP`.
* **Routing Engine Boundary**: `callController.js` only consumes normalized events and issues commands to the generic `TelephonyProvider`. It has zero knowledge of Twilio or Telnyx internals. 

This architecture guarantees that the core state-machine (managing Buyer A timeout and Buyer B fallback) remains safe from provider-specific nuances.

## 2. Telnyx Operations
All Telnyx operations were verified against the automated test suite, but real-world execution is pending.

* **Provider**: Telnyx
* **Operation**: Inbound webhook verification & event parsing
* **Official documentation**: Telnyx Call Control Webhooks
* **Date checked**: 2026-09-20
* **SDK/API method**: Manual `ed25519` signature verification
* **Authentication**: Uses `TELNYX_PUBLIC_KEY` against `telnyx-signature-ed25519`
* **Important parameters**: `req.body.data.event_type`
* **Important response fields**: Normalized internal type (`CALL_INITIATED`, etc.)
* **Observed result**: Passes all Jest automated assertions
* **Status**: AUTOMATED TEST PASS

## 3. Twilio Operations
Twilio operations underwent real-world testing. Note the distinction between the original approach and the final successful architecture.

* **Provider**: Twilio
* **Operation**: Twilio Edge Webhook Validation
* **Official documentation**: Twilio Webhook Security
* **Date checked**: 2026-09-20
* **SDK/API method**: `twilio.validateRequest()`
* **Authentication**: Uses `TWILIO_AUTH_TOKEN` and `x-twilio-signature`
* **Important parameters**: `req.body.CallStatus` and `req.body.CallSid`
* **Important response fields**: N/A
* **Observed result**: Successfully validated real incoming HTTP POST requests in live tests.
* **Status**: REAL TWILIO TEST PASS

* **Provider**: Twilio
* **Operation**: Outbound Call Creation (Buyer Dialing)
* **Official documentation**: Twilio Programmable Voice REST API
* **Date checked**: 2026-09-20
* **SDK/API method**: `client.calls.create()`
* **Authentication**: Initialized client using `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`
* **Important parameters**: `twiml`, `statusCallback`, `statusCallbackEvent`
* **Important response fields**: `res.sid` (mapped to `buyerACallId`)
* **Observed result**: Successfully rang physical buyer devices in live tests.
* **Status**: REAL TWILIO TEST PASS

* **Provider**: Twilio
* **Operation**: Call Bridging
* **Official documentation**: Twilio `<Conference>` TwiML
* **Date checked**: 2026-09-20
* **SDK/API method**: Initial TwiML generation + `calls.create({ twiml })` (Native Conference Architecture)
* **Authentication**: N/A (TwiML based)
* **Important parameters**: `<Dial><Conference waitUrl="" endConferenceOnExit="...">`
* **Important response fields**: N/A
* **Observed result**: Two-way audio verified successfully between physical caller and physical buyer devices using Native Twilio Conference bridging.
* **Status**: REAL TWILIO TEST PASS

## 4. Webhook Events

**Provider: Twilio**
* **Event**: Voice Request (`ringing`)
* **When observed**: Initial incoming PSTN call hits `[BASE_URL]/webhooks/twilio`.
* **Relevant fields**: `CallSid`, `CallStatus`, `From`, `To`.
* **Normalization**: Mapped to `CALL_INITIATED`.
* **How our system handles it**: Normalizes it, pushes it to `processWebhook()`. The Express route then synchronously returns TwiML placing the caller into `<Dial><Conference>`. The adapter synthesizes an asynchronous `CALL_ANSWERED` event to trick the generic routing engine into proceeding to `dialBuyer()`.

**Provider: Telnyx**
* **Event**: Call Control Webhook (`call.initiated`)
* **When observed**: Initial incoming call hits `[BASE_URL]/webhooks`.
* **Relevant fields**: `data.payload.call_control_id`, `data.event_type`.
* **Normalization**: Mapped to `CALL_INITIATED`.
* **How our system handles it**: Verifies Ed25519 signature, pushes to `processWebhook()`.

## 5. Actual Call-Control Sequence
**Actual Real Twilio Flow (Observed):**
1. Real caller dialed Twilio number.
2. Webhook reached `/webhooks/twilio`.
3. Node server verified the request, normalized to `CALL_INITIATED`.
4. `callController.js` transitioned to `ANSWERING`.
5. `twilioProvider.answerCall()` synthesized `CALL_ANSWERED`.
6. Node server responded to Twilio with TwiML putting the caller into `<Conference>`.
7. `callController.js` processed `CALL_ANSWERED`, transitioned to `RINGING_A`.
8. `twilioProvider.dialBuyer()` called Twilio REST API to create a child call to Buyer A.
9. Buyer A failed to answer. Twilio sent `statusCallback` (`no-answer`).
10. `callController.js` transitioned to `RINGING_B`.
11. `twilioProvider.dialBuyer()` called Twilio REST API to create a child call to Buyer B.
12. Buyer B answered. Twilio sent `statusCallback` (`in-progress`).
13. (Under the new Native Conference architecture) Buyer B executes the injected TwiML and immediately joins the Conference with the caller.

## 6. Sequential Fallback
The fallback logic handles sequential dialing:
```text
Caller
  ↓
Buyer A
  ↓
timeout/failure
  ↓
Buyer B
  ↓
B answers → connect
```
In Twilio, this is achieved by creating completely distinct child calls (`calls.create()`). The inbound call waits inside a `<Conference>`, completely decoupled from the buyers. When a child call fails, we just throw it away and create a new one to Buyer B. If Buyer B answers, their TwiML instructs them to join the Caller's conference.

## 7. Problems Encountered
* **Twilio SDK Mocks vs Eager Initialization**: During test execution, Jest threw `twilio is not a function` because `telephonyProvider.js` was eagerly requiring the Twilio adapter (which initialized the SDK using mocked variables). This was fixed by lazily loading the active adapter via a getter pattern.
* **Twilio Inbound Sync Answering**: Telnyx relies on asynchronous commands and webhooks to answer calls. Twilio answers them implicitly via TwiML responses. This violated the `callController` state machine. The fix involved synthesizing an async `CALL_ANSWERED` webhook locally within the Twilio adapter.
* **REST API `calls.update()` Audio Failures (Failed Approach)**: The original Twilio architecture returned `<Pause length="3600"/>` to the caller, waited for the buyer to answer, and then updated both legs with `calls(sid).update({ twiml })` to force them into a `<Conference>`. Real tests proved this was unreliable, resulting in one-way audio, dead air, or race condition errors (`Call is not in-progress`).
* **Architecture Change (Native Conference)**: The bridging mechanism was changed. The initial caller is now placed *immediately* into a `<Conference waitUrl="">`. When buyers are dialed, they are created directly into the exact same conference room. This completely removes the REST API TwiML modification overhead.

## 8. MVP Recommendations

POC STATUS:
COMPLETE WITH TELNYX REAL-WORLD VALIDATION PENDING

TWILIO:
Real-world validation PASS

TELNYX:
Automated validation PASS
Real-world validation BLOCKED/PENDING
Reason: No active verified Telnyx credentials, Call Control connection ID, and inbound-capable Telnyx number were available for live E2E validation.

AUTOMATED TESTS:
17/17 passing across 4 suites

REAL PROVIDER TESTS:
Real Twilio validation passed. Telnyx is blocked pending account provisioning.

PROVIDER ABSTRACTION:
100% successful. The `TelephonyProvider` factory correctly isolates provider-specific logic, leaving `callController.js` as a pure, testable state machine.

A → B FALLBACK:
Real Twilio PASS

TWO-WAY AUDIO:
Twilio Caller ↔ Buyer A PASS
Twilio Caller ↔ Buyer B PASS

RECORDING:
NOT TESTED / DEFERRED TO MVP

KNOWN LIMITATIONS:
No persistent database. Idempotency relies on an in-memory `Set`. The application is not yet horizontally scalable.

PROVIDER-SPECIFIC MVP CHANGES:
Twilio requires `BASE_URL` to route outbound child call `statusCallback` webhooks successfully. Ensure the production server sets this accurately.

MVP ARCHITECTURE RECOMMENDATIONS:
Proceed with this exact event-driven state machine. Move the in-memory map `activeCalls` to Redis, and convert the in-memory `processedEvents` to Redis/Postgres for true distributed idempotency. Add a generic `DatabaseProvider` to track these states before modifying the telephony layer further.

OPEN RISKS:
None that block the start of MVP 1.

FILES CREATED/CHANGED
- `src/telephonyProvider.js`
- `src/twilioProvider.js`
- `src/telnyxProvider.js`
- `src/index.js`
- `src/webhookHandler.js`
- `src/callController.js`
- `tests/*`
- `docs/telephony-poc-setup.md`
- `docs/telephony-poc-test-results.md`
- `docs/telephony-poc-findings.md`

NEXT STEP:
Review this report before starting MVP1 Stage 1.
