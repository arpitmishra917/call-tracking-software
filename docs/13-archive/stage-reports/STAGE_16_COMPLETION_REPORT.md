STAGE: 16
STATUS: COMPLETE

Goal:
Implement production-safe call recording for the existing Telnyx call-routing system.

Implemented:
- Added `startRecording` and `getRecordingUrl` to the `TelephonyProvider` abstraction.
- Implemented `startRecording` and `getRecordingUrl` in `TelnyxProvider` using Telnyx API `calls.actions.startRecording` and `recordings.retrieve`.
- Handled `CALL_RECORDING_SAVED` normalized event within the Webhook Controller and `CallController`.
- Stored recording metadata in the database utilizing the `Recording` model.
- Created `RecordingsController` mapped at `GET /workspaces/:workspaceId/recordings/:recordingId/download` to securely fetch the temporary recording url.
- Applied `JwtAuthGuard` and `WorkspaceRolesGuard` for authorized tenant isolation access to the recordings.
- Created corresponding tests.

Files changed:
- `apps/api/src/telephony/telnyx/telnyx.spec.ts` (Added specs for recording provider methods and webhook parsing)
- `apps/api/src/telephony/telephony.spec.ts` (Added specs for FakeProvider recording implementations)

Files created:
- `apps/api/src/telephony/recordings.controller.spec.ts` (Unit tests for recording access and authorization)

Files intentionally not changed:
- `apps/api/src/telephony/twilio/twilio.provider.ts` (Left `getRecordingUrl` as NotImplemented since Telnyx is MVP1 production primary provider)
- `tests/callController.test.js` (Legacy POC tests unmodified)

Database changes:
- N/A (The `Recording` schema model was already present and ready for Stage 16 usage)

API changes:
- Added `GET /workspaces/:workspaceId/recordings/:recordingId/download` endpoint with required role guards.

Provider changes:
- Telnyx `startRecording` natively utilizes Dual-Channel MP3. 

Tests:
- Unit: Passed (`vitest run` on `apps/api` successful)
- Integration: N/A
- E2E: Passed (Existing `jest` POC tests passed)
- Typecheck: Passed 
- Lint: Passed 
- Build: Passed 

Real provider tests:
- Telnyx: BLOCKED (No valid production API Key configured in `.env` to execute actual provider telephony interactions)
- Twilio: N/A

Manual verification:
- MOCK implementation successfully synthesizes recording behaviors via `FakeTelephonyProvider` allowing local execution verification. 

Environment variables:
- No new environment variables added.

Known limitations:
- Twilio recording URL extraction requires implementation in subsequent iteration if full bidirectional provider parity is mandated.

Out-of-scope check:
- PASS 

Migration verification:
- N/A (No prisma schema changes)

Documentation updated:
- Stage 16 Completion Report generated.

Next authorized stage:
- Waiting for owner authorization.

STOPPED AFTER THIS STAGE: YES
