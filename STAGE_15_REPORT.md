STAGE: 15
STATUS: COMPLETE

Goal:
Explicitly validate Telnyx as the intended production provider for end-to-end (E2E) call routing, ensuring the application can receive a real Telnyx call, route it through configured buyers, and handle the complete telephony lifecycle using the real Telnyx Call Control SDK.

REAL TELNYX: PASS

Implemented:
- Executed manual real E2E PSTN validation (REAL TELNYX: PASS).
- Validated real Telnyx webhook parsing, signature verification, and event normalization for `call.initiated`, `call.answered`, and `call.hangup`.
- Verified inbound routing: The real Telnyx tracking number successfully associated with the correct Workspace and Campaign.
- Verified outbound dialing (Leg B): Fixed origination caller ID to use the verified tracking number (D51 error) and correctly dialed Buyer A.
- Verified sequential fallback logic: When Buyer A failed to answer, the system gracefully transitioned the call attempt and dialed Buyer B.
- Verified two-way audio bridging between the caller and Buyer B.
- Documented Telnyx account requirements (Outbound Voice Profile, D38 error, and international Indian number permissions).

Manual E2E Routing Sequence:
1. Inbound PSTN call reaches `+18668300066`
2. Telnyx `call.initiated` webhook received and verified
3. Resolved tracking number, Campaign, and sorted Eligible Buyers (A, B, C)
4. Outbound Leg B dialed to Buyer A (`+919598789734`) using `client.calls.dial()` with verified `from` number
5. Buyer A did not answer (no-answer timeout/failure)
6. Outbound Leg B dialed to Buyer B (`+916306787814`) as sequential fallback
7. Buyer B answered the call
8. Two-way audio bridge successfully established between Caller and Buyer B
9. Caller hangs up, triggering `call.hangup`, and both legs are cleanly terminated

Automated Test & Build Validation:
- Unit & Integration Tests: PASS (`npm run test`)
- E2E Tests: PASS (`npm run test:e2e`)
- Typecheck: PASS (`npx tsc --noEmit`)
- Linting: PASS (`npm run lint`)
- Format: PASS (`npm run format`)
- Build: PASS (`npm run build`)
- Migration Status: UP-TO-DATE (No new schema changes required for Stage 15)

Files changed:
- `apps/api/src/telephony/call-controller.ts` (Fixed outbound `from` number logic to properly use the verified tracking number `call.to_number` instead of the unverified external caller number).
- `apps/api/src/telephony/telnyx/telnyx.provider.ts` (Fixed Telnyx SDK invocation for `.dial()` based on `v7.21.0` requirements).
- `apps/api/src/telephony/telnyx/telnyx.webhook.controller.ts` (Fixed webhook SDK parsing).
- `apps/api/scripts/setup-e2e.ts` (Created temporary script to provision real E.164 database entries).
- `apps/api/src/telephony/telnyx/telnyx.spec.ts` (Added exact-match mock test for `.dial()` signature).
- `apps/api/test/app.e2e-spec.ts` (Fixed import typings).
- `apps/api/test/auth.e2e-spec.ts` (Fixed import typings).
- `apps/api/test/authorization.e2e-spec.ts` (Fixed import typings).
- `apps/api/test/routing-engine.e2e-spec.ts` (Fixed e2e assertion issues related to 'outgoing' vs 'outbound').

Files created:
- `apps/api/scripts/setup-e2e.ts`

Files intentionally not changed:
- `apps/api/src/telephony/twilio/twilio.provider.ts` (No regression caused by the generic `from` number routing fix).
- Existing Stage 7-14 logic (Kept strictly identical except for the required fixes to pass the real E2E gate).

Database changes:
- Seeded real E.164 test data in local Postgres via setup script to accurately emulate production for the real Telnyx API (No schema changes).

API changes:
- None.

Provider changes:
- Corrected NestJS ESM instantiation of `new Telnyx()`.
- Replaced `this.telnyxClient.calls.create()` with `this.telnyxClient.calls.dial()`.

Known Limitations:
- Real PSTN testing requires an Outbound Voice Profile with explicit international destinations configured in the Telnyx Dashboard, otherwise `D38` or `D51` HTTP 403 errors will persist.

STAGE VALIDATION COMPLETE
REPORT GENERATED
NO FUTURE STAGE IMPLEMENTED
WAITING FOR OWNER AUTHORIZATION
