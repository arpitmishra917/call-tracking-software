# CallFlow Phase 7B-10U: Source Code Forensic Audit
**Timestamp:** 2026-11-12T03:02:15Z  
**Phase:** 7B-10U (Snoop Architecture Audit, Defect Repair & Authorized Live Dual-Leg Verification)  
**Deliverable:** Deliverable 1 (Stage A — Source Code Forensic Audit)

---

## 1. Executive Summary

An independent forensic audit was conducted on the Phase 7B-10T implementation across `apps/api/src/telephony/qa/*`, related Asterisk ARI integration modules, and live Asterisk container behavior.

While Phase 7B-10T correctly identified Asterisk command queue contention as the cause of the Phase 7B-10S failure and successfully proved synthetic decoupled lifecycles, the live container inspection revealed critical production defects in the native Asterisk Snoop path:
1. **Silent Fallback Defect:** If Snoop attachment throws or fails, `QaOrchestratorService` silently fell back to direct parent channel recording. This reintroduces the exact command-queue mutex serialization defect from Phase 7B-10S.
2. **Missing Snoop StasisStart Waiter:** Asterisk ARI fires an explicit `StasisStart` event when a Snoop channel is spawned (`channel: Snoop/<parent>-<id>`). In Phase 7B-10T, `recordChannel` was invoked immediately without awaiting Snoop `StasisStart`, introducing a race condition against Asterisk channel initialization.
3. **Incomplete Lifecycle Taxonomy:** Granular failure states (`SNOOP_ATTACHMENT_FAILED`, `RECORDING_START_FAILED`, `RECORDING_FINALIZATION_FAILED`, `AUDIO_VALIDATION_FAILED`) were missing from `RecordingLifecycleState`.
4. **Relaxed Target URI Matching:** The `RecordingStarted` predicate accepted `channel:${context.asteriskChannelId}` (the parent channel), inadvertently permitting silent fallback.
5. **Teardown Ordering Flaw:** Parent channels were hung up before Snoop channels, risking abrupt termination of active audiohooks prior to clean recording finalization.

---

## 2. Component-by-Component Forensic Audit

### 2.1 `AsteriskAriClientService` (`apps/api/src/telephony/qa/asterisk-ari-client.service.ts`)
- **Endpoint:** `POST /ari/channels/{channelId}/snoop` (L439).
- **Parameters:** `app`, `spy`, `whisper`, `appArgs`, `snoopId`.
- **Audit Finding:** The method correctly formats query parameters and executes HTTP POST. However, error responses (e.g. 404 if channel already destroyed, or 409 if channel state invalid) are wrapped in `AsteriskAriError`.
- **Verdict:** Operationally valid, but calling code must handle Stasis entry synchronization and avoid silent fallback.

### 2.2 `QaOrchestratorService` (`apps/api/src/telephony/qa/qa-orchestrator.service.ts`)
- **Lines 495–529 (Snoop Creation):**
  ```ts
  try {
    const snoopCaller = await this.ariClient.snoopChannel(context.asteriskChannelId!, ...);
    if (snoopCaller?.id) { callerRecChannelId = snoopCaller.id; ... }
  } catch (snoopErr: any) {
    this.logger.debug(`... skipped/fallback: ${snoopErr.message}`);
  }
  ```
  **Flaw:** If Snoop creation failed, `callerRecChannelId` defaulted to `context.asteriskChannelId`. This silent fallback defeats the purpose of the Snoop architecture.
- **Lines 533–552 (Waiters):**
  Pre-registered `RecordingStarted` waiters with predicate checking `e.recording?.target_uri === channel:${context.asteriskChannelId}`.
  **Flaw:** Target URI must strictly enforce `channel:${snoopChannelId}`.
- **Lines 554–574 (State Transitions):**
  Sessions set to `'ATTACHING'`. If `callerStartRes` was rejected, `callerSession.state` remained `'ATTACHING'` instead of transitioning to `'RECORDING_START_FAILED'`.
- **Lines 645–646 (Playback Progression):**
  Transitions sessions to `'PLAYBACK_ACTIVE'` even if Snoop attachment or recording start had failed.
- **Lines 945 & 964 (Validation State):**
  Failed audio validation assigned generic `'FAILED'` instead of `'AUDIO_VALIDATION_FAILED'`.
- **Lines 1197–1202 (`finalizeLegRecording`):**
  Failed buffer retrieval assigned generic `'FAILED'` instead of `'RECORDING_FINALIZATION_FAILED'`.

### 2.3 Asterisk Container Live Behavior
Live execution of `qa/test-native-asterisk-snoop.mjs` against `callflow-asterisk-qa` established:
1. Snoop channel created: `Snoop/<main_channel_id>-00000000` with state `Up`.
2. Asterisk ARI emits `StasisStart` for the Snoop channel:
   ```json
   {
     "type": "StasisStart",
     "channel": { "id": "1794432664.22", "name": "Snoop/1794432664.20-00000000", "state": "Up" },
     "args": ["snoop", "caller", "test-run-10u"]
   }
   ```
3. Asterisk ARI accepts `POST /ari/channels/{snoopChannelId}/record` and emits `RecordingStarted`.
4. While the Snoop channel is actively recording, Asterisk immediately executes `POST /ari/channels/{mainChannelId}/play` without any queue contention (PlaybackFinished received in 3122ms).
5. Upon `stopRecording`, Asterisk successfully finalizes and writes a valid RIFF/WAVE PCM file (51,884 bytes).

---

## 3. Summary of Identified Vulnerabilities

| Vulnerability | Component | Severity | Description |
| :--- | :--- | :---: | :--- |
| **VULN-1: Silent Direct Fallback** | `qa-orchestrator.service.ts` | **P1** | Re-exposes the call to Asterisk command-queue deadlock if Snoop fails. |
| **VULN-2: Missing Snoop Stasis Waiter** | `qa-orchestrator.service.ts` | **P1** | Race condition: calls `recordChannel` before Snoop `StasisStart` confirms channel readiness. |
| **VULN-3: Target URI Masking** | `qa-orchestrator.service.ts` | **P2** | Predicate accepted parent channel URI, masking fallback. |
| **VULN-4: Truncated Lifecycle States** | `qa-orchestrator.service.ts` | **P2** | Missing granular states (`SNOOP_ATTACHMENT_FAILED`, `RECORDING_START_FAILED`, etc.). |
| **VULN-5: Inverse Cleanup Order** | `qa-orchestrator.service.ts` | **P2** | Parent channel hung up before Snoop channel cleanup. |

---

## 4. Next Steps

All vulnerabilities have been assigned tracking IDs in the Canonical Bug Register (Stage B) and will be corrected in Stage C.
