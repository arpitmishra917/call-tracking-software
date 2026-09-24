# Architecture Decision Record: Telephony Provider Architecture

## Title
ADR-003: Telephony Provider Architecture

## Status
Accepted

## Context
The application relies on PSTN telephony providers to route inbound tracking calls to campaign buyers. The POC utilized both Telnyx and Twilio via a custom abstraction layer to ensure the routing engine remained agnostic. We need to formalize this for production MVP1.

## Decision
* **Primary Production Provider**: Telnyx is explicitly locked as the intended, primary production provider.
* **Development/Validation Provider**: Twilio is retained strictly as a development and validation provider. It must NOT be designed as an equal production product with user-facing options in MVP1.
* **Provider Abstraction Contract**: The business routing engine will interact strictly with a generalized `TelephonyProvider` interface. We will reuse the proven contract from the POC:
  - `answerCall(callId)`
  - `dialBuyer(to, from, connectionId, timeoutSecs)`
  - `bridgeCalls(callId, buyerCallId)`
  - `hangupCall(callId)`
* **Event Normalization**: Provider-specific webhook shapes (e.g., Twilio StatusCallbacks vs. Telnyx Webhooks) must be isolated at the HTTP edge adapter and translated into internal generic events (`CALL_INITIATED`, `CALL_ANSWERED`, `CALL_HANGUP`).
* **Isolation**: No provider-specific conditional logic (e.g. `if (provider === 'twilio')`) is permitted within the core sequential routing engine.

## Consequences
* New provider methods (e.g., `startRecording`) must be added to the generalized contract and implemented in both adapters.
* We preserve the ability to conduct real-world routing validations via Twilio while awaiting Telnyx resource provisioning.

## Alternatives Considered
* **Telnyx Only:** Rejected because it would stall all E2E media testing until an active Telnyx number is provisioned, violating Section 0.2 of the spec.
* **Direct SDK Integration in Domain Logic:** Rejected because it violates the isolation required by Section 11 of the spec.

## Relationship to MVP1_BUILD_SPEC_v5.md
Strictly enforces Section 0.1 (Critical telephony decision) and Section 11 (Provider Abstraction).
