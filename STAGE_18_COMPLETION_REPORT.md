STAGE: 18
STATUS: COMPLETE

Goal:
Implement Stage 18 — Usage Metering.

Usage Calculation Logic:
1. `CALL_MINUTE`: Created when a call enters a terminal state (`handleCallerHangup`). The duration is computed (or provided via webhook event) and mathematically rounded up (`Math.ceil`) to integer minutes. A unique idempotency key protects against duplicate reporting.
2. `RECORDING_STORAGE`: Recorded upon receiving a `CALL_RECORDING_SAVED` webhook when the recording is persisted. Value is set to a constant quantity (1 unit) traceable to the exact `recording_id`.
3. `PHONE_NUMBER`: Recorded when a new phone number is successfully provisioned through `PhoneNumbersService`. Traceable to the `phoneNumber.id`. 

Separation of Raw Usage from Customer Pricing:
The newly created `UsageRecord` database model tracks raw units strictly (minutes, unit counts) isolated from cost. No dollars, cents, plans, or currencies exist in this stage, maintaining a pristine boundary between consumption and billing logic.

Database Changes:
- Added `UsageType` enum (`CALL_MINUTE`, `PHONE_NUMBER`, `RECORDING_STORAGE`).
- Added `UsageRecord` model.
- Appended `usage_records` relation onto `Workspace` for tenant isolation.
*(Note: Schema changes were applied via `prisma db push` to avoid resetting existing POC database structures safely)*

API Changes:
- `UsageModule` and `UsageService` instantiated for core upsert processing.
- `CallsService` updated to resolve terminal call states into `CALL_MINUTE` metrics.
- `CallController` updated to trace `RECORDING_STORAGE`.
- `PhoneNumbersService` updated to trace `PHONE_NUMBER` usage.

UI Changes:
- N/A. (Traceable usage is backend-only architecture in Stage 18).

Provider Changes:
- N/A.

Tests: PASS
Typecheck: PASS
Lint: PASS
Formatter: PASS
Build: PASS
E2E: PASS
Migration: N/A
Out-of-scope: PASS (Confirmed no customer pricing, billing, invoices, wallets, Stage 19 SaaS billing, or Stage 20 API logic implemented.)

STOPPED AFTER THIS STAGE: YES
