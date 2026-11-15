# CALLFLOW — AGENT 2 BACKEND TEST COVERAGE

This document presents the complete backend test coverage audit, test execution results, identified test gaps, and database migration blockers.

---

## 1. TEST SUITE EXECUTION SUMMARY

### 1.1 Backend Unit Test Suite (`npm run test -- src/`)
- **Total Test Files Evaluated**: 69
- **Files Passing**: 64 (92.7%)
- **Files Failing**: 5 (7.3%)
- **Total Individual Tests**: 1047
- **Passing Tests**: 1039 (99.2%)
- **Failing Tests**: 8 (0.8%)
- **Total Execution Duration**: 367 seconds

### 1.2 Integration & E2E Test Suite Status
- **Total Test Files in `apps/api/test/`**: 43
- **Execution Status**: **BLOCKED**
- **Blocker Cause**: Database schema drift / unapplied migration.
- **Specific Error**:
  ```
  PrismaClientKnownRequestError: The column call_attempts.destination_number_id does not exist in the current database.
  ```
  Migration `20261107120000_buyer_org_and_destination_number_foundation` was committed to the repository, but the local/QA database has not been migrated. Under the Phase 0 Read-Only Safety mandate, migrations were not applied during this audit.

---

## 2. FAILING UNIT TESTS & ROOT CAUSE ANALYSIS

| Spec File | Test Name | Failure Category | Root Cause |
|---|---|---|---|
| `src/routing/blocked-callers.service.spec.ts` | `should throw BadRequestException on invalid phone number` | Business Logic Defect | `normalizeE164('invalid')` returns `'invalid'`, bypassing the falsy check and preventing `BadRequestException` from being thrown (**BUG-BE-001**). |
| `src/telephony/caller-exhaustion-ringback.spec.ts` | `3. Buyer rejects but another eligible buyer remains -> fallback continues, ringback maintained` | Signature Mismatch | `CallController.dialNextBuyer` was updated to pass 6 parameters (`customHeaders` as 6th arg for QA), while older test asserts 5 arguments (**BUG-BE-014**). |
| `src/telephony/concurrency.spec.ts` | `TEST 1: CALL_ANSWERED + CALL_HANGUP concurrently (hangup wins)` | CPU Saturation Timeout | Vitest parallel thread pool timeout during full suite run; passes in isolated run. |
| `src/telephony/concurrency.spec.ts` | `TEST 6: Normal sequential routing regression` | Signature Mismatch | Asserts `dialBuyer` called with 5 arguments instead of 6 (**BUG-BE-014**). |
| `src/telephony/telnyx-bridge-remediation.spec.ts` | `9. Buyer A times out -> Buyer B dialed -> Buyer B answers -> bridge succeeds...` | Signature Mismatch | Asserts `dialBuyer` called with 5 arguments instead of 6 (**BUG-BE-014**). |
| `src/telephony/telnyx-callflow.spec.ts` | `Scenario 1: One inbound call creates exactly one initial buyer dial attempt` | Signature Mismatch | Asserts `dialBuyer` called with 5 arguments instead of 6 (**BUG-BE-014**). |
| `src/telephony/telnyx-callflow.spec.ts` | `Scenario 5: Buyer hangs up before bridging completes -> triggers sequential fallback` | Signature Mismatch | Asserts `dialBuyer` called with 5 arguments instead of 6 (**BUG-BE-014**). |
| `src/telephony/telnyx-callflow.spec.ts` | `Scenario 13: Sequential fallback advances to next buyer in campaign priority` | Signature Mismatch | Asserts `dialBuyer` called with 5 arguments instead of 6 (**BUG-BE-014**). |

---

## 3. COVERAGE BY DOMAIN & WORKFLOW

### 3.1 Fully Tested Workflows (PASS)
- **Authentication & JWT Validation**: `auth.service.spec.ts`, `jwt.strategy.ts` validation, trusted issuer verification (`auth.controller.spec.ts`).
- **Commercial Evaluation & Duplicate Detection**: `commercial-evaluator.spec.ts` (35+ test cases covering conversion thresholds, identifiable numbers, advisory locking, root duplicate reference resolution).
- **Settlement Adjustments & Batch Generation**: `settlement-adjustment-integration.spec.ts`, `settlement.controller.spec.ts`.
- **Telephony Audio Analysis & RTP Classification**: `qa-audio-analyzer.service.spec.ts`, `qa-rtp-classifier.service.spec.ts`.
- **Telephony Recordings Download**: `recordings.controller.spec.ts` (11 unit tests covering vendor and buyer access control).
- **Wallet Core Operations**: `wallet.service.spec.ts` (balance queries, reservations, debit/credit transactions).

### 3.2 Partially Tested Workflows
- **Public API Controllers**: `public-api.e2e-spec.ts` tests mock keys, but unit tests do not test `PublicBuyersController.getBuyer`, `PublicCallsController.getCall`, or `PublicCampaignsController.getCampaign` with `PermissionsGuard` active. (This allowed **BUG-BE-006** to escape detection).
- **Webhook Ingestion Idempotency**: `telnyx.spec.ts` and `twilio.spec.ts` test happy-path parsing, but do not test worker crash recovery during `status === 'PENDING'` (**BUG-BE-003**).

### 3.3 Untested & Weakly Asserted Workflows
1. **Request Body DTO Validation**: No integration tests verify that submitting malformed or out-of-bounds payloads (e.g. negative prices, non-integer concurrency limits) to `CampaignsController` or `BuyersController` returns `400 Bad Request`.
2. **Twilio Webhook Missing Auth Token Behavior**: No negative test checks what happens when `TWILIO_AUTH_TOKEN` is unset in production (**BUG-BE-002**).
3. **Password Reset for Invited Workspace Members**: No unit test covers resetting a password for an email address that accepted a `WorkspaceInvitation` (**BUG-BE-008**).
4. **Phone Number Reconciliation**: `phone-numbers.service.ts:reconcileNumber` has zero tests and zero callers (**BUG-BE-017**).
