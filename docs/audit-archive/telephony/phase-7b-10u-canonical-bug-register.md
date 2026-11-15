# CallFlow Phase 7B-10U: Canonical Bug Register
**Timestamp:** 2026-11-12T03:02:45Z  
**Phase:** 7B-10U (Snoop Architecture Audit, Defect Repair & Authorized Live Dual-Leg Verification)  
**Deliverable:** Deliverable 2 (Stage B — Defect Register)

---

## 1. Bug Registry Summary

| Bug ID | Severity | Category | Target Component | Description | Status |
| :--- | :---: | :---: | :--- | :--- | :---: |
| **BUG-10U-001** | **P1** | Telephony/Media | `qa-orchestrator.service.ts` | Silent direct-channel fallback on Snoop attachment failure reintroduces command queue deadlock. | **CONFIRMED** |
| **BUG-10U-002** | **P1** | Race Condition | `qa-orchestrator.service.ts` | Missing `StasisStart` synchronization for Asterisk Snoop channels before recording start. | **CONFIRMED** |
| **BUG-10U-003** | **P2** | State Machine | `qa-orchestrator.service.ts` | Missing granular failure states (`SNOOP_ATTACHMENT_FAILED`, `RECORDING_START_FAILED`, etc.). | **CONFIRMED** |
| **BUG-10U-004** | **P2** | Event Correlation | `qa-orchestrator.service.ts` | `RecordingStarted` predicate accepts parent channel URI, masking direct recording fallback. | **CONFIRMED** |
| **BUG-10U-005** | **P2** | Lifecycle Teardown | `qa-orchestrator.service.ts` | Cleanup hangs up parent channels before stopping/cleaning Snoop channels. | **CONFIRMED** |

---

## 2. Detailed Bug Entries

### BUG-10U-001: Silent Direct-Channel Fallback Reintroducing Deadlock
- **Severity:** **P1** (Critical Telephony / Recording Failure)
- **Source File & Lines:** `apps/api/src/telephony/qa/qa-orchestrator.service.ts`, Lines 495–529
- **Actual Observed Behavior:** If `snoopChannel()` throws or returns null, the catch block logs a debug statement and leaves `callerRecChannelId = context.asteriskChannelId!`. It silently attempts direct channel recording on the main Stasis channel.
- **Root Cause:** Intentionally coded in Phase 7B-10T to accommodate unit tests that did not mock `snoopChannel`. In production, this causes the main channel's Stasis thread to enter `__ast_play_and_record`, blocking subsequent `playMedia` requests and reintroducing the silence timeout defect from Phase 7B-10S.
- **Reproduction Method:** Call `executeTestRun()` with an invalid channel ID for Snoop or simulated Snoop error; observe that recording is issued to parent channel instead of failing the Snoop step.
- **Evidence:** Source lines 492–511 and 521–529.
- **Recommended Correction:** Remove silent fallback. If Snoop channel creation fails, transition the affected session to `SNOOP_ATTACHMENT_FAILED`, record the failure reason, and do not attempt recording or playback on that leg. Allow the other leg to continue independently.
- **Regression Test:** `Test: Mandatory Snoop Attachment - rejects silent direct fallback and transitions to SNOOP_ATTACHMENT_FAILED`.
- **Status:** **CONFIRMED (Fix scheduled for Stage C)**

---

### BUG-10U-002: Missing Snoop StasisStart Synchronization Race Condition
- **Severity:** **P1** (Critical Race Condition)
- **Source File & Lines:** `apps/api/src/telephony/qa/qa-orchestrator.service.ts`, Lines 503–535
- **Actual Observed Behavior:** `recordChannel` is invoked immediately after the ARI REST `POST /ari/channels/{id}/snoop` request returns, without awaiting the asynchronous `StasisStart` WebSocket event for the newly spawned Snoop channel.
- **Root Cause:** Assumption that HTTP 200 on `/snoop` implies the Snoop channel is already active in Stasis. In Asterisk, the Snoop channel is launched into Stasis asynchronously.
- **Reproduction Method:** Under network latency or Asterisk load, issuing `POST /ari/channels/{snoopId}/record` immediately can return HTTP 404/409 ("Channel not in Stasis application").
- **Evidence:** Live Asterisk container testing in `qa/test-native-asterisk-snoop.mjs` proved Asterisk generates a distinct `StasisStart` event with `appArgs: ["snoop", leg, runId]`.
- **Recommended Correction:** Pre-register `waitForEvent<StasisStartEvent>('StasisStart', (e) => e.channel?.id === snoopId)` before or immediately after issuing `snoopChannel`, and await it before calling `recordChannel`.
- **Regression Test:** `Test: Snoop StasisStart Synchronization - awaits Snoop StasisStart before initiating recording`.
- **Status:** **CONFIRMED (Fix scheduled for Stage C)**

---

### BUG-10U-003: Incomplete Lifecycle State Taxonomy
- **Severity:** **P2** (State Machine / Observability Defect)
- **Source File & Lines:** `apps/api/src/telephony/qa/qa-orchestrator.service.ts`, Lines 41–55, 608–625, 945–965
- **Actual Observed Behavior:** Lifecycle states jumped to generic `FAILED` or remained stuck in `ATTACHING` when Snoop creation or recording start failed.
- **Root Cause:** `RecordingLifecycleState` lacked specific failure states mandated by specification.
- **Reproduction Method:** Cause recording start to fail; observe session state remains `ATTACHING` or sets generic `FAILED`.
- **Evidence:** `RecordingLifecycleState` enum definition in `qa-orchestrator.service.ts`.
- **Recommended Correction:** Add `SNOOP_ATTACHMENT_FAILED`, `RECORDING_START_FAILED`, `RECORDING_FINALIZATION_FAILED`, and `AUDIO_VALIDATION_FAILED` to `RecordingLifecycleState` and apply them at exact transition points.
- **Regression Test:** `Test: Granular Failure States - verifies transitions to specific failure states upon individual stage faults`.
- **Status:** **CONFIRMED (Fix scheduled for Stage C)**

---

### BUG-10U-004: RecordingStarted Predicate Accepts Parent Channel URI
- **Severity:** **P2** (Event Correlation / Verification Defect)
- **Source File & Lines:** `apps/api/src/telephony/qa/qa-orchestrator.service.ts`, Lines 538–540, 547–549
- **Actual Observed Behavior:** The `RecordingStarted` waiter predicate allowed `e.recording?.target_uri === channel:${context.asteriskChannelId}` (the parent channel).
- **Root Cause:** Tolerated parent channel URI for backward compatibility with direct recording.
- **Reproduction Method:** If a recording accidentally started on parent channel, the waiter accepted it as valid Snoop recording.
- **Evidence:** `(!e.recording?.target_uri || e.recording?.target_uri === channel:${callerRecChannelId} || e.recording?.target_uri === channel:${context.asteriskChannelId})`.
- **Recommended Correction:** Enforce that when Snoop is active, the target URI must match `channel:${callerSnoopChannelId}` specifically.
- **Regression Test:** `Test: Target URI Strictness - rejects RecordingStarted event with parent channel URI when Snoop is configured`.
- **Status:** **CONFIRMED (Fix scheduled for Stage C)**

---

### BUG-10U-005: Inverse Cleanup Order Between Parent and Snoop Channels
- **Severity:** **P2** (Resource Management Defect)
- **Source File & Lines:** `apps/api/src/telephony/qa/qa-orchestrator.service.ts`, Lines 1345–1375
- **Actual Observed Behavior:** `executeCleanup` hung up Target 1 (Caller parent channel) and Target 2 (Buyer parent channel) before Target 2b (Snoop channels).
- **Root Cause:** Target 2b was appended after parent channels instead of prepended.
- **Reproduction Method:** In Asterisk, hanging up parent channels destroys associated audiohooks and can abruptly terminate live recordings before `stopRecording` is processed.
- **Evidence:** `executeCleanup` code structure in `qa-orchestrator.service.ts`.
- **Recommended Correction:** Reorder cleanup so that recordings are stopped (Target 1), Snoop channels are hung up (Target 2), and only then are parent channels hung up (Target 3).
- **Regression Test:** `Test: Cleanup Ordering - verifies Snoop channels and recordings are torn down cleanly before parent channels`.
- **Status:** **CONFIRMED (Fix scheduled for Stage C)**

---

## 3. Conclusion

All 5 defects have been cataloged with reproduction steps and planned corrections. Stage C will implement the repairs directly in the codebase.
