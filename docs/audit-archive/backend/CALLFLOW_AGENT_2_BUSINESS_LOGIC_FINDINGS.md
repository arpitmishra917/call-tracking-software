# CALLFLOW — AGENT 2 BUSINESS LOGIC FINDINGS

This document provides a comprehensive audit of all server-side business logic, lifecycle workflows, routing rules, calculations, and state machine transitions across CallFlow.

---

## 1. WORKSPACE DOMAIN AUDIT

### 1.1 Creation & Ownership
- **Rule Enforced**: A user can only own one active workspace (`workspaces.service.ts:16-23`). If an owner membership already exists, `createWorkspace` returns the existing workspace idempotently.
- **Race Condition Handling**: Concurrency is handled both before and inside the transaction (`tx.workspaceMember.findFirst`) with a catch on Prisma error code `P2002`/`P2010` (`workspaces.service.ts:29-76`).
- **Profile Auto-Provisioning**: User profile is automatically upserted (`tx.profile.upsert`) during workspace creation.

### 1.2 User Membership & Invitations
- **Invitation Token Flow**: Tokens are hashed via SHA-256 (`token_hash`) before storage and verification (`workspaces.service.ts:659`).
- **Expiration**: Invitations expire after their `expires_at` timestamp.
- **Role Normalization**: When a participant (`VENDOR` or `BUYER`) accepts an invitation with elevated roles (`OWNER` or `ADMIN`), the role is automatically normalized down to `MEMBER` (`workspaces.service.ts:705-709`).
- **Ownership Transfer**: If an existing owner accepts an invitation with `OWNER` role, the role is demoted to `ADMIN` (`workspaces.service.ts:710-717`).

### 1.3 Workspace Status Transitions
- **Valid States**: `ACTIVE`, `SUSPENDED`, `ARCHIVED`.
- **Enforcement**:
  - Inbound calls arriving at tracking numbers belonging to non-`ACTIVE` workspaces are rejected (`call-controller.ts:359-383`).
  - Stored calls transition immediately to `FAILED` with provider hangup.
- **Gap Identified**: When a workspace transitions to `SUSPENDED` or `ARCHIVED`, existing active API keys are not automatically revoked or blocked unless the endpoint checks workspace status.

---

## 2. CAMPAIGN DOMAIN AUDIT

### 2.1 Creation & Configuration
- **Commercially Configured Rule**: A campaign is considered commercially active if and only if `default_revenue_amount !== null` AND `default_payout_amount !== null` (`commercial-evaluator.service.ts:153-157`).
- **Validation Defect**: In `CampaignsController.create` and `CampaignsController.update`, input fields (`default_revenue_amount`, `default_payout_amount`, `conversion_duration_secs`) are unvalidated plain objects without `ValidationPipe` or class-validator rules. Negative amounts and zero durations are accepted at the controller layer.

### 2.2 Routing Configuration & Waterfalls
- **Dual Architecture**:
  1. **Primary Path (Modern)**: `CampaignDestinationNumbers` (Independent endpoints linked to buyers with individual `priority`, `weight`, `timeout`, and `max_concurrent_calls`).
  2. **Fallback Path (Legacy)**: `CampaignBuyers` (Waterfall ordered strictly by `priority ASC`).
- **Workspace Isolation**: In `prepareNextBuyer` (`calls.service.ts:2123`), `cdn.destination_number.workspace_id !== call.workspace_id` strictly prevents cross-tenant endpoint leaking.

---

## 3. BUYER DOMAIN AUDIT

### 3.1 Buyer Organizations & Destination Numbers
- **Buyer Organization Architecture**: Introduced in migration `20261107120000`. A Buyer is an organization entity having multiple destination endpoints (`DestinationNumber`).
- **Concurrency Tracking**:
  - Destination-level concurrency tracked in `call_attempts` table (`state IN ('INITIATED', 'RINGING', 'ANSWERED')`).
  - Organization-level concurrency tracked in `buyer_reservations` table (`status = 'ACTIVE'`).
- **Atomic Concurrency Reservation**:
  - `prepareNextBuyer` locks the candidate destination number row using `SELECT id, max_concurrent_calls FROM "destination_numbers" WHERE id = ? FOR UPDATE` (`calls.service.ts:2146-2148`).
  - Next locks buyer organization row: `SELECT id, max_concurrent_calls FROM "buyers" WHERE id = ? FOR UPDATE` (`calls.service.ts:2163-2165`).
  - If capacity exists, it creates both `CallAttempt` and `BuyerReservation` atomically within the database transaction.

### 3.2 Buyer Business Logic Defects Identified
1. **Invalid Destination Number Accepted (BUG-BE-001)**: `BuyersService.createBuyer` and `updateBuyer` rely on `normalizeE164(dest)`. If `dest` contains non-numeric strings (e.g. `"invalid"`), `normalizeE164` returns the input string, which evaluates as truthy and is stored directly in PostgreSQL.
2. **Missing Validation for Negative Limits**: If `timeout` is passed as a negative number or `NaN`, it defaults without throwing a 400 error.

---

## 4. CALL WORKFLOW & STATE MACHINE AUDIT

### 4.1 State Machine Specification
```
[INITIATED] -> [ROUTING] -> [COMPLETED] (talk duration > 0, bridged)
            -> [ROUTING] -> [NO_ANSWER] (all waterfall buyers exhausted / timeout)
            -> [ROUTING] -> [FAILED]    (capacity exhausted / busy / error)
            -> [ROUTING] -> [CANCELED]  (caller hung up before bridge)
            -> [FAILED]                 (unregistered DID, inactive WS, blocked)
            -> [CANCELED]               (early hangup)
```

### 4.2 State Machine Defect: Webhook Event Mismatch on Hangup (BUG-BE-005)
- In `CallsService.handleCallerHangup` (`calls.service.ts:288-291`):
  ```typescript
  } else if (finalState === CallState.COMPLETED) {
    this.webhooksService
      .queueEvent(updatedCall.workspace_id, 'call.answered', updatedCall)
      .catch(console.error);
  } else if (this.isTerminalCallState(finalState)) {
    this.webhooksService
      .queueEvent(updatedCall.workspace_id, 'call.ended', updatedCall)
      .catch(console.error);
  }
  ```
- **Finding**: When a call completes normally (`finalState === CallState.COMPLETED`), it queues `'call.answered'`, bypassing the `call.ended` branch! As a result, webhook consumers receive duplicate `call.answered` events and NEVER receive `call.ended` for successfully completed calls.

### 4.3 Blocked Caller Normalization Defect (BUG-BE-004)
- In `CallController.handleEvent` (`call-controller.ts:385-392`):
  ```typescript
  const isBlocked = await this.prisma.blockedCaller.findUnique({
    where: {
      workspace_id_phone_number: {
        workspace_id: trackingNumber.workspace_id,
        phone_number: from!, // RAW unnormalized string!
      },
    },
  });
  ```
- `BlockedCallersService.blockCaller` normalizes numbers to E.164 (e.g., `+15551234567`). If Telnyx sends `from: "15551234567"`, `from: "+1 (555) 123-4567"`, or a SIP URI (`sip:+15551234567@...`), the raw query fails to find the block record, allowing blocked callers to enter the waterfall!

---

## 5. COMMERCIAL EVALUATION & FINANCIAL CALCULATIONS

### 5.1 Connected Talk Duration Calculation
- **Rule**: Evaluated strictly between `answered_at` and `ended_at` on the winning connected attempt (`commercial-evaluator.service.ts:37-80`).
- Pre-answer ringing and waterfall routing time before buyer answer is strictly excluded.

### 5.2 Call Conversion Rule
- A call is converted if and only if:
  `connectedTalkDurationSecs >= campaign.conversion_duration_secs`.

### 5.3 Duplicate Detection Engine
- **Duplicate Eligibility**:
  1. Only converted calls are eligible to establish or trigger duplicates (`commercial-evaluator.service.ts:201`).
  2. Unidentifiable/anonymous callers (`isIdentifiableCallerNumber === false`) cannot establish or trigger duplicates.
  3. Scope: Same `workspace_id`, `campaign_id`, normalized caller, and normalized destination within `campaign.duplicate_window_secs` (default 30 days).
  4. PostgreSQL transaction-level advisory locking (`pg_advisory_xact_lock`) prevents concurrent calls from both claiming original status.
  5. Chaining protection: If the prior call was itself a duplicate, `rootOriginalId` is resolved to prevent cascading reference chains.

### 5.4 Revenue, Payout, Cost & Profit Arithmetic
- **Revenue**: If qualified (`converted && !isDuplicate`), `Decimal(campaign.default_revenue_amount)`, else `0.0000`.
- **Payout**: If qualified, `Decimal(campaign.default_payout_amount)`, else `0.0000`.
- **Operational Cost**: Authoritatively extracted from `WalletTransaction` where `reference_type = 'CALL_SETTLEMENT' AND type = 'DEBIT'` (`commercial-evaluator.service.ts:345-359`).
- **Profit**: `profit = revenue - payout - cost` (exact Decimal 12,4 precision).
- **Settlement Status Requirement**: Commercial evaluation requires `CallReservation.status === 'SETTLED'`. If wallet settlement has not occurred, commercial evaluation is safely deferred.

---

## 6. RELIABILITY & CONCURRENCY FINDINGS

1. **Advisory Locking**: Duplicate call detection properly utilizes 64-bit advisory locking (`getDuplicateScopeAdvisoryLockKey`).
2. **Row Locking on Buyer Capacity**: `prepareNextBuyer` uses `SELECT ... FOR UPDATE` on both destination and buyer rows to prevent over-allocation under concurrent inbound bursts.
3. **Webhook Ingestion Idempotency Lock Expiration Defect (BUG-BE-003)**:
   - `WebhookIdempotencyService` records `status = 'PENDING'`.
   - If a worker dies while processing, there is no timeout or cleanup for stuck `PENDING` events.
   - Provider retries will encounter `status === 'PENDING'` and return `{ canProcess: false }`, dropping the redelivered event forever.
4. **Stale Call Reservation Recovery**: `ReservationRecoveryService` runs on a 5-minute interval (`RESERVATION_RECOVERY_STALE_SECONDS = 900s`) to release unfinalized active reservations.
