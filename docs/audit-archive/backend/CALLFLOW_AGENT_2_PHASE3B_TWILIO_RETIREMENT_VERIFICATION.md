# CALLFLOW AGENT 2 PHASE 3B: TWILIO RETIREMENT & ISOLATION VERIFICATION

**Agent**: Agent 2 (Backend, API, Business Logic, Webhook Processing, and Backend Reliability)  
**Date**: November 12, 2026  
**Focus**: Twilio Retirement, Active Provider Isolation, and Webhook Defense-in-Depth (`BUG-BE-002`)  
**Workspace**: [callflow-agent-a](file:///C:/Projects/callflow-agent-a)  

---

## 1. Provider Decision & Architectural Boundaries

CallFlow has permanently standardized on **TELNYX** as its only supported telephony provider.
Twilio is completely unsupported for all active call handling, SIP routing, Asterisk bridging, and production traffic.

The audit verified seven strict isolation criteria:

### 1.1 Twilio cannot be selected as the active production telephony provider
In [`apps/api/src/telephony/telephony.module.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/telephony.module.ts), the dependency injection factory for `TELEPHONY_PROVIDER` was hardened:
```typescript
{
  provide: TELEPHONY_PROVIDER,
  useFactory: (telnyx: TelnyxProvider) => {
    const configuredProvider = (
      process.env.TELEPHONY_PROVIDER ||
      process.env.ACTIVE_TELEPHONY_PROVIDER ||
      ''
    ).toLowerCase();
    if (configuredProvider === 'twilio') {
      throw new Error(
        'FATAL: Twilio provider has been retired and disabled. CallFlow exclusively uses Telnyx as its telephony provider.',
      );
    }
    return telnyx;
  },
  inject: [TelnyxProvider],
}
```
- `TwilioProvider` is **no longer injected** into `TELEPHONY_PROVIDER`.
- Any environment attempting to configure `TELEPHONY_PROVIDER=twilio` or `ACTIVE_TELEPHONY_PROVIDER=twilio` fails fast with an immediate application bootstrap crash.

### 1.2 Twilio webhook controller is not registered in the active application
In [`apps/api/src/telephony/telephony.module.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/telephony.module.ts), `TwilioWebhookController` was **removed from `controllers: [...]`**:
```typescript
controllers: [
  TelnyxWebhookController,
  RecordingsController,
  QaTestController,
],
```
- NestJS does **not** register or mount `/webhooks/twilio` in the HTTP routing table.
- All requests sent to `/webhooks/twilio` or `/telephony/twilio/events` receive HTTP 404 Not Found at the Express gateway level.

### 1.3 Legacy Twilio Controller Fails Closed
For complete defense-in-depth, in [`apps/api/src/telephony/twilio/twilio.webhook.controller.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/twilio/twilio.webhook.controller.ts), the fail-open bypass behavior was permanently removed:
```typescript
const authToken = process.env.TWILIO_AUTH_TOKEN;
if (!authToken || !signature) {
  this.logger.warn(
    'Twilio webhook rejected: Twilio provider is retired and signature verification cannot be bypassed.',
  );
  return res.status(403).send('Forbidden: Twilio provider is retired');
}
```
If instantiated or called in any testing context, unauthenticated webhook traffic is rejected with HTTP 403 Forbidden.

### 1.4 Active Telnyx Services Do Not Depend on Twilio
Audit of imports across:
- `apps/api/src/telephony/telnyx/`
- `apps/api/src/telephony/call-controller.ts`
- `apps/api/src/calls/calls.service.ts`
- `apps/api/src/routing/`
confirmed **zero imports of `TwilioProvider`, `twilio`, or any Twilio module**. Telnyx operates with complete provider autonomy.

### 1.5 Strict Telnyx Signature Verification
[`apps/api/src/telephony/telnyx/telnyx.webhook.controller.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/telnyx/telnyx.webhook.controller.ts) was audited:
- Enforces presence of `rawBody`, `telnyx-signature-ed25519`, and `telnyx-timestamp`. Missing headers throw `BadRequestException` (HTTP 400).
- In QA and Production environments (`APP_ENV=qa` or `NODE_ENV=production`), missing `TELNYX_PUBLIC_KEY` throws `BadRequestException` and fails closed.
- Signatures are cryptographically validated using Ed25519 via `telnyx.webhooks.unwrap()`. Invalid signatures return HTTP 400 Bad Request.

---

## 2. Test Verification & Results

A dedicated test suite was created in [`apps/api/src/telephony/twilio/twilio-isolation.spec.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/twilio/twilio-isolation.spec.ts), verifying all isolation criteria:

| Test Name | Result | Verification |
| :--- | :--- | :--- |
| `TELEPHONY_PROVIDER resolves to TelnyxProvider by default` | **PASS** | Default DI resolves to TelnyxProvider |
| `Setting TELEPHONY_PROVIDER=twilio throws FATAL retirement error` | **PASS** | Application bootstrap crashes if Twilio requested |
| `Setting ACTIVE_TELEPHONY_PROVIDER=twilio throws FATAL retirement error` | **PASS** | Secondary env config also crashes |
| `TwilioWebhookController is NOT registered in TelephonyModule controllers metadata` | **PASS** | Reflected metadata does not contain Twilio controller |
| `TwilioWebhookController rejects unauthenticated webhook requests with 403 Forbidden` | **PASS** | Fails closed on missing token |
| `TwilioWebhookController rejects requests when signature is missing` | **PASS** | Fails closed on missing signature |
| `TelnyxWebhookController rejects requests missing raw body or signature with 400` | **PASS** | Strict Telnyx ingress validation |
| `TelnyxWebhookController fails closed in QA/Prod when TELNYX_PUBLIC_KEY is missing` | **PASS** | Strict cryptographic enforcement |

All 8 isolation tests passed in 937ms.
In addition, legacy provider unit tests in [`twilio.spec.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/twilio/twilio.spec.ts) (4 tests) passed with updated fail-closed assertions.
