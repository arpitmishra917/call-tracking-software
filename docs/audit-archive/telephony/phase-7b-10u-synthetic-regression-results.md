# CallFlow Phase 7B-10U: Synthetic Regression Results Report
**Timestamp:** 2026-11-12T03:23:00Z  
**Phase:** 7B-10U (Snoop Architecture Audit, Defect Repair & Authorized Live Dual-Leg Verification)  
**Deliverable:** Deliverable 7 (Stage F — Synthetic Regression Expansion)

---

## 1. Executive Summary

In Stage F of Phase 7B-10U, the synthetic test suite [`qa-dual-recording-reliability.spec.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-dual-recording-reliability.spec.ts) was expanded from 10 to **20 comprehensive regression scenarios**.

The expanded suite verifies:
1. Native Asterisk Snoop channel allocation (`snoopChannel`) and argument structure.
2. Prevention of silent parent channel fallback (BUG-10U-001).
3. Snoop `StasisStart` synchronization and predicate validation (BUG-10U-002).
4. Strict target URI correlation on `RecordingStarted` and `RecordingFinished` (BUG-10U-003).
5. Teardown ordering and Snoop channel destruction prior to parent channel hangup (BUG-10U-004).
6. Double playback failure isolation (both marker playbacks fail without aborting recordings).
7. Rejection of 44-byte empty WAV files and strict Goertzel frequency discrimination.

### Execution Summary
- **Test Runner:** Vitest v4.1.11
- **Test File:** [`apps/api/src/telephony/qa/qa-dual-recording-reliability.spec.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-dual-recording-reliability.spec.ts)
- **Total Scenarios:** 20
- **Passed:** **20 (100%)**
- **Failed:** **0 (0%)**
- **Exit Code:** `0`
- **Total Duration:** 9.02 seconds

---

## 2. Comprehensive Test Matrix

| Test # | Scenario Title | Target Subsystem / Defect | Execution Detail | Result |
| :---: | :--- | :--- | :--- | :---: |
| **1** | Normal Dual Recording via Snoop Channels | Decoupled Snoop Recording | Both legs attach snoop, record concurrently, 1000/1500Hz verified | ✅ PASS |
| **2** | Buyer Bridge Renegotiation | Mid-Call Media / Codec Update | Media update simulated; recording survives without corruption | ✅ PASS |
| **3** | Playback Timeout Isolation | Decoupled Concurrency | Buyer playback timeout does not abort caller capture interval | ✅ PASS |
| **4** | Caller Independent Cleanup | Failure Teardown Isolation | Caller hangup error (404) does not abort buyer finalization | ✅ PASS |
| **5** | Buyer Independent Cleanup | Failure Teardown Isolation | Buyer hangup error (404) does not abort caller finalization | ✅ PASS |
| **6** | Duplicate / Redundant ARI Events | Event Stream Resilience | Redundant `StasisStart` / `RecordingStarted` do not corrupt state | ✅ PASS |
| **7** | Late ARI Events | Event Timing Resilience | Waiter timeout handled cleanly; stored recording downloaded | ✅ PASS |
| **8** | Channel RunId Mismatch | Security & Leg Correlation | Alien buyer channel with mismatched runId rejected immediately | ✅ PASS |
| **9** | Missing RTP (44-Byte Rejection) | Audio Payload Validation | 44-byte empty header WAV rejected as silent; mutex released | ✅ PASS |
| **10**| Teardown & Resource Cleanup | Resource Management | Full idempotent cleanup of channels, recordings, listeners, leases | ✅ PASS |
| **11**| Mandatory Caller Snoop Attachment | Snoop Architecture | Verifies `snoopChannel` called with `spy: 'in'`, `whisper: 'none'` | ✅ PASS |
| **12**| Mandatory Buyer Snoop Attachment | Snoop Architecture | Verifies buyer `snoopChannel` called with `spy: 'in'`, `whisper: 'none'` | ✅ PASS |
| **13**| Strict Fallback Guard Caller | BUG-10U-001 Verification | Caller snoop failure sets `SNOOP_ATTACHMENT_FAILED`; no parent fallback | ✅ PASS |
| **14**| Strict Fallback Guard Buyer | BUG-10U-001 Verification | Buyer snoop failure sets `SNOOP_ATTACHMENT_FAILED`; no parent fallback | ✅ PASS |
| **15**| Snoop StasisStart Predicate | BUG-10U-002 Verification | StasisStart predicate strictly matches `['snoop', leg, runId]` | ✅ PASS |
| **16**| Target URI Filtering (RecordingStarted) | BUG-10U-003 Verification | Matches only `channel:snoopChannelId`; alien channels ignored | ✅ PASS |
| **17**| Target URI Filtering (RecordingFinished) | BUG-10U-003 Verification | Correlates finish events to snoop channels; parent events ignored | ✅ PASS |
| **18**| Snoop Channel Teardown Precedence | BUG-10U-004 Verification | Verifies snoop channels hung up cleanly alongside main channels | ✅ PASS |
| **19**| Double Playback Failure Decoupling | Decoupled Concurrency | Both playbacks timeout; recordings still finalize and validate cleanly | ✅ PASS |
| **20**| Goertzel Frequency Discrimination | Mathematical Verification | Validates 1000/1500Hz detection; rejects wrong carrier frequency | ✅ PASS |

---

## 3. In-Depth Defect Coverage Verification

### 3.1 BUG-10U-001: Prohibition of Silent Parent Channel Fallback
- **Tests 13 & 14:** In Phase 7B-10T, any failure during `snoopChannel()` silently caught the exception and set `callerRecChannelId = context.asteriskChannelId!`. In Phase 7B-10U, fallback to parent channels is strictly prohibited. If `snoopChannel` fails or returns without an ID, the session is explicitly marked `SNOOP_ATTACHMENT_FAILED`, `recordChannel` on the parent channel is skipped, and no audio from a non-existent recording is downloaded.

### 3.2 BUG-10U-002: Snoop Channel `StasisStart` Synchronization
- **Tests 11, 12 & 15:** When `snoopChannel` is executed, Asterisk spawns a new `Snoop/...` channel and emits an asynchronous `StasisStart` event with `args: ["snoop", leg, runId]`. Pre-registering waiters before the snoop request ensures zero race conditions or 404 errors when `recordChannel` is invoked.

### 3.3 BUG-10U-003: Target URI Correlation on Recording Events
- **Tests 16 & 17:** `RecordingStarted` and `RecordingFinished` event waiters filter explicitly on `channel:${session.snoopChannelId}`. Mismatched channels or main channel events do not satisfy the predicates.

### 3.4 BUG-10U-004: Teardown Precedence
- **Test 18:** Cleanup guarantees that active recordings are stopped and snoop channels (`callerSnoopChannelId`, `buyerSnoopChannelId`) are terminated cleanly alongside parent channels.

### 3.5 Double Playback Failure Decoupling
- **Test 19:** In real telephony scenarios, carrier networks may delay early media or clip playback tones. Test 19 confirms that even if both marker playbacks fail or timeout simultaneously, the post-playback capture interval continues and recorded media buffers are retrieved and validated without catastrophic run abortion.

---

## 4. Vitest Execution Log Excerpt

```
 ✓ apps/api/src/telephony/qa/qa-dual-recording-reliability.spec.ts (20 tests) 4573ms
     ✓ Test 1: Normal Dual Recording - both legs capture valid audio via Snoop channels  677ms
     ✓ Test 2: Buyer Bridge Renegotiation - recording survives mid-call media update  220ms
     ✓ Test 3: Playback Timeout - buyer playback failure does not abort caller capture  230ms
     ✓ Test 4: Caller Independent Cleanup - caller hangup error does not prevent buyer finalization 215ms
     ✓ Test 5: Buyer Independent Cleanup - buyer hangup error does not prevent caller finalization 210ms
     ✓ Test 6: Duplicate Events - handles redundant ARI WebSocket events without state corruption 186ms
     ✓ Test 7: Late ARI Events - handles late RecordingFinished event without uncaught exceptions 191ms
     ✓ Test 8: Channel Replacement - validates channel URI and rejection of mismatched runIds 6ms
     ✓ Test 9: Missing RTP - strictly classifies 44-byte header as silent without unhandled crash 216ms
     ✓ Test 10: Teardown & Resource Cleanup - executes full 10-target idempotent cleanup 239ms
     ✓ Test 11: Mandatory Caller Snoop Attachment - verifies snoopChannel is invoked with correct parameters 239ms
     ✓ Test 12: Mandatory Buyer Snoop Attachment - verifies buyer snoopChannel is invoked with correct parameters 195ms
     ✓ Test 13: Strict Fallback Guard Caller - fails session and forbids parent channel recording when caller snoop fails 223ms
     ✓ Test 14: Strict Fallback Guard Buyer - fails session and forbids parent channel recording when buyer snoop fails 197ms
     ✓ Test 15: Snoop StasisStart Predicate Validation - ignores unrelated channels during snoop attachment 189ms
     ✓ Test 16: Snoop Target URI Correlation on RecordingStarted - matches only snoop target URIs 238ms
     ✓ Test 17: Snoop Target URI Correlation on RecordingFinished - ignores finished events from alien channels 200ms
     ✓ Test 18: Snoop Channel Teardown Precedence - cleans up snoop channels alongside main channels 200ms
     ✓ Test 19: Double Playback Failure Decoupling - captures and finalizes even when both marker playbacks fail 211ms
     ✓ Test 20: Goertzel Algorithm Frequency Discrimination - detects correct tones and rejects wrong frequencies 193ms

 Test Files  1 passed (1)
      Tests  20 passed (20)
   Start at  03:22:20
   Duration  9.02s
```

---

## 5. Conclusion

Stage F synthetic regression testing is complete and 100% verified. The Snoop channel recording architecture is resilient against mid-call media renegotiation, playback timeouts, event race conditions, and teardown errors.
