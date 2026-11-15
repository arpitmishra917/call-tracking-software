# CallFlow Phase 7B-10U: Root Cause Analysis
**Timestamp:** 2026-11-12T03:02:25Z  
**Phase:** 7B-10U (Snoop Architecture Audit, Defect Repair & Authorized Live Dual-Leg Verification)  
**Deliverable:** Deliverable 3 (Root Cause Analysis)

---

## 1. Executive Summary

Phase 7B-10T achieved a synthetic `PASS` by introducing Asterisk Snoop channel abstractions and decoupled session states. However, an independent forensic audit in Phase 7B-10U uncovered a critical divergence between the synthetic test harness and actual Asterisk runtime behavior:

1. **Synthetic Mock Bias:** In Phase 7B-10T, unit tests did not mock `snoopChannel()`. To prevent those tests from failing with unhandled rejections, a "seamless fallback to direct channel recording" was introduced.
2. **The Hidden Hazard:** In a live environment, if Snoop channel attachment encounters an error, the code silently falls back to recording the parent channel directly. This reintroduces the exact Stasis control thread mutex deadlock that caused the Phase 7B-10S buyer 44-byte empty WAV failure.
3. **Asynchronous Stasis Entry Gap:** Asterisk launches Snoop channels into Stasis asynchronously, emitting an independent `StasisStart` event. The Phase 7B-10T code assumed that HTTP 200 on `/snoop` meant the channel was immediately ready for `recordChannel`, creating a race condition against Asterisk's internal state machine.

---

## 2. Deep Dive: Asterisk Stasis Command Queues & Audiohooks

### 2.1 The Direct Recording Mutex Serialization (Phase 7B-10S Defect)
In Asterisk ARI, each channel entering a Stasis application has a dedicated control structure (`struct ast_channel_stasis_control` in `res_stasis.c`). Commands sent via ARI REST (such as `playMedia` or `recordChannel`) are queued into `control->command_queue`.
- When `recordChannel` (`POST /ari/channels/{id}/record`) executes:
  - Asterisk invokes `__ast_play_and_record` in `app.c`.
  - This function runs synchronously on the channel's Stasis thread, continually reading audio frames until duration, silence, or hangup occurs.
  - **Crucial Consequence:** While `__ast_play_and_record` is active, the Stasis thread CANNOT pop the next command from `control->command_queue`.
  - Any subsequent `POST /ari/channels/{id}/play` remains stranded in the queue.
  - Without audio playing into the bridge, Asterisk detects silence on the other leg, emits `app.c:1951: No audio available??`, and aborts the recording at 44 bytes.

### 2.2 The Snoop Channel Solution (`ast_audiohook`)
Asterisk Snoop channels (`res/res_ari_channels.c`) solve this contention:
- Calling `POST /ari/channels/{channelId}/snoop?app=callflow-qa&spy=in` attaches a passive `ast_audiohook` to the parent channel.
- An independent auxiliary channel is spawned: `Snoop/<parent_channel_id>-<index>`.
- The Snoop channel is injected into the Stasis application `callflow-qa`, receiving audio frames through the audiohook.
- **Why This Eliminates Contention:**
  - `recordChannel` is issued to the **Snoop channel**. The Snoop channel's Stasis thread enters `__ast_play_and_record` to capture audio.
  - `playMedia` is issued to the **Parent channel**. Because the Parent channel is NOT recording, its Stasis command queue is completely free to execute `playMedia` immediately without queuing!
  - Both operations run in parallel across separate Asterisk threads.

---

## 3. Analysis of Phase 7B-10T Defects

### 3.1 Defect 1: Silent Fallback to Direct Channel Recording
- **Mechanism:** In `qa-orchestrator.service.ts`:
  ```ts
  try {
    const snoopCaller = await this.ariClient.snoopChannel(context.asteriskChannelId!, ...);
    if (snoopCaller?.id) { callerRecChannelId = snoopCaller.id; ... }
  } catch (snoopErr: any) {
    this.logger.debug(`... fallback: ${snoopErr.message}`);
  }
  ```
- **Impact:** If `snoopChannel` failed in a live call, `callerRecChannelId` defaulted back to `context.asteriskChannelId`. Asterisk would once again lock the parent channel in `__ast_play_and_record`, re-creating the Phase 7B-10S deadlocked state.
- **Architectural Fix:** Enforce **Mandatory Snoop Recording**. If Snoop attachment fails, the affected leg must immediately transition to `SNOOP_ATTACHMENT_FAILED` and halt recording on that leg. It must NEVER fall back to direct parent channel recording.

### 3.2 Defect 2: Missing Snoop StasisStart Synchronization
- **Mechanism:** In `qa/test-native-asterisk-snoop.mjs` against live Asterisk, Asterisk emitted:
  `[ARI EVENT] type=StasisStart channelId=1794432664.22 channelName=Snoop/1794432664.20-00000000 appArgs=["snoop","caller","test-run-10u"]`
- **Impact:** In Phase 7B-10T, no waiter was registered for this event. `recordChannel` was fired immediately upon receiving the REST response. Under high load or network latency, `recordChannel` could arrive at Asterisk before the Snoop channel finished entering Stasis, causing Asterisk to reject the recording request with 404 or 409.
- **Architectural Fix:** Register and await `StasisStart` for the Snoop channel before issuing `recordChannel`.

### 3.3 Defect 3: Incomplete Lifecycle States & Validation Bypass
- **Mechanism:** If Snoop attachment or recording start failed, the session states were not properly classified, and subsequent stages still attempted playback and capture on the failed leg.
- **Impact:** Failed legs could mask the root cause of failures, producing misleading telemetry.
- **Architectural Fix:** Add granular lifecycle states (`SNOOP_ATTACHMENT_FAILED`, `RECORDING_START_FAILED`, `RECORDING_FINALIZATION_FAILED`, `AUDIO_VALIDATION_FAILED`) and guard each subsequent step.

---

## 4. Conclusion & Stage C Action Plan

The root causes have been isolated to five concrete defects in `qa-orchestrator.service.ts`. Stage C will implement the repairs, eliminating silent fallback, synchronizing Snoop StasisStart, refining event predicates, and enforcing strict cleanup order.
