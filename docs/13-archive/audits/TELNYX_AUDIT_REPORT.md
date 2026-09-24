# TELNYX VOICE PROVISIONING AUDIT REPORT

## 1. Executive Summary
This audit examines the Telnyx voice provisioning flow, tracking how phone numbers are purchased, assigned to workspaces, and linked to Telnyx Voice Connections (Call Control Applications). The audit confirms that the system successfully provisions numbers via the Telnyx API but relies entirely on a single, global SIP Connection ID for voice association, matching an architecture where one connection routes all numbers.

## 2. Database Schema Analysis
The Prisma schema includes a `PhoneNumber` model with `provider_number_id` and `connection_id` fields. However, neither the `Workspace` nor the `PhoneNumber` model is designed to store newly generated Telnyx Application IDs. This confirms the system is not creating a unique Voice Connection per workspace or per number, but rather storing a singular connection ID reference.

## 3. Number Provisioning Flow
In `PhoneNumbersService`, the `provisionNumber` method triggers a call to `TelnyxProvisioningService.provisionNumber(phoneNumber)`. The method creates a `numberOrders` request with Telnyx, successfully adding the phone number to the tenant's workspace while recording the transaction in the `UsageService`. 

## 4. Telnyx Voice Connection Association
The code relies on a fallback mechanism for association:
`connection_id: connectionId || process.env.TELNYX_SIP_CONNECTION_ID`
Since no `connectionId` is explicitly passed from the `PhoneNumbersService`, every purchased number defaults to the global `process.env.TELNYX_SIP_CONNECTION_ID`. The code also attempts to run an `update` on the number if the association was not finalized during the order.

## 5. Environment Variable Dependencies
The system relies heavily on `TELNYX_API_KEY` and `TELNYX_PUBLIC_KEY` (documented in `.env.example`). Crucially, the system also depends on `TELNYX_SIP_CONNECTION_ID`, which is **missing** from `.env.example`. If this variable is not provided at runtime, numbers will be provisioned but left completely unassociated with any voice infrastructure.

## 6. Webhook Configuration Strategy
The system does not programmatically configure webhooks via the Telnyx API. Instead, it assumes that the global `TELNYX_SIP_CONNECTION_ID` has already been manually configured in the Telnyx Portal to point to `BASE_URL/webhooks/telnyx`.

## 7. Inbound Call Flow & Normalization
The `TelnyxWebhookController` listens for inbound events on `/webhooks/telnyx`. Incoming payloads are securely verified using `telnyx-signature-ed25519` and normalized via `normalizeTelnyxEvent()`. Events like `call.initiated`, `call.answered`, `call.hangup`, and `call.recording.saved` are correctly mapped to internal enums.

## 8. Idempotency & Concurrency Management
The webhook controller employs a robust `WebhookIdempotencyService` (using `acquireLock`) based on the Telnyx Event ID. This guarantees that duplicate or retried webhooks do not trigger duplicate routing logic or ghost calls.

## 9. Telephony Provider Interface (Call Control)
The `TelnyxProvider` class implements `TelephonyProvider` using Telnyx Call Control commands (`answer`, `dial`, `bridge`, `hangup`, `startRecording`). This confirms the backend uses Telnyx Call Control Applications (which require a connection ID) rather than raw SIP trunks.

## 10. Missing Architectural Components
- **Programmatic App Creation:** The system does not create Call Control Applications dynamically.
- **Webhook Management:** The system does not automatically configure webhook URLs for the numbers.
- **Configuration Documentation:** The `TELNYX_SIP_CONNECTION_ID` is entirely undocumented in `.env.example`.

## 11. Security & Tenant Isolation Analysis
Webhook verification is strictly enforced using `TELNYX_PUBLIC_KEY` (unless omitted, falling back to a risky mock mode). Tenant isolation during provisioning relies on the `PhoneNumber` database records rather than Telnyx billing groups or distinct connections. 

## 12. Final Verdict

**Architecture Pattern:** Pattern E (Another architecture) – specifically, One Global Connection/Application → ALL phone numbers.

**Verdict:** 
**B. CONFIGURED THROUGH EXISTING CONNECTION**

*Explanation:* The code successfully provisions numbers and natively attempts to associate them with an existing, globally defined Voice Connection/Call Control Application using `process.env.TELNYX_SIP_CONNECTION_ID`. It expects the webhook configuration to already exist on that connection rather than building it dynamically.
