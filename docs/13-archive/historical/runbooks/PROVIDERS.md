# Provider Operations Procedure

This document explains procedures for interacting with telephony providers in this MVP.

## 1. Telnyx (Production Provider)

Telnyx is the sole authorized production telephony provider for this MVP.

### Telnyx Outage Procedure
If Telnyx experiences a partial or full outage:
1. **Identify the outage:** Check `https://status.telnyx.com` and cross-reference with API logs showing Telnyx API timeouts or 5xx errors.
2. **Determine Scope:** Is it an API outage, or are inbound webhooks also affected?
3. **Avoid Destructive Changes:** Do NOT attempt to swap API keys or alter the call state machine. Do NOT silently implement Twilio failover.
4. **Communicate:** Notify affected workspaces that the upstream carrier is experiencing issues.
5. **Recovery:** When Telnyx resolves the issue, standard webhook processing will resume. Perform a manual test call to verify.

### Telnyx Webhook Failures
If Telnyx webhooks are delayed or failing to reach the system:
- Verify the Webhook URL configured in Telnyx Mission Control matches your production URL.
- Ensure the `TELNYX_PUBLIC_KEY` environment variable is correctly set; otherwise, valid webhooks will be rejected with a 400 signature mismatch.

---

## 2. Twilio (Development/Validation Provider)

Twilio is strictly a **DEVELOPMENT and VALIDATION** provider. 
**DO NOT** position Twilio as a production provider or implement automatic Telnyx -> Twilio failover.

### Twilio Configuration
For local development and E2E testing:
1. Set `TELEPHONY_PROVIDER=twilio` in `.env`.
2. Provide `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`.
3. Start the application.

### Identifying Real Twilio Tests
Tests that actually hit the Twilio API or require Twilio credentials must be clearly separated from standard unit tests, usually invoked with specific E2E test commands and requiring local environment variable setup.

### Disabling Twilio for Production
To ensure Twilio is disabled in production:
1. Ensure `TELEPHONY_PROVIDER=telnyx` in the production `.env`.
2. Do not supply `TWILIO_ACCOUNT_SID` or `TWILIO_AUTH_TOKEN` to the production environment, forcing the Twilio adapter to fail initialization if accidentally selected.
