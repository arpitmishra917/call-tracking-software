# CallFlow Phase 7B-10T: Source Code Discovery & Map
**Timestamp:** 2026-11-12T01:23:50Z  
**Phase:** 7B-10T (Buyer Native ARI Recording Lifecycle Repair & Dual-Leg Recording Reliability)  
**Deliverable:** Deliverable A (Stage A — Source Code Discovery & Map)

---

## 1. Executive Overview

This document provides a forensic source code map of the telephony QA recording and playback orchestration subsystem in `apps/api/src/telephony/qa/` and related telephony controllers. It catalogs exact source file paths, relevant methods, line numbers, event ownership, lifecycle dependencies, cleanup dependencies, and identified race conditions prior to the Phase 7B-10T repair.

---

## 2. Source Code Architecture & File Map

### 2.1 Primary Orchestration & ARI Services

| Component | Source Path | Primary Responsibility |
| :--- | :--- | :--- |
| **QA Orchestrator Service** | `apps/api/src/telephony/qa/qa-orchestrator.service.ts` | Controls test run lifecycle, concurrency mutex, channel origination, dual-leg recording, tone playback injection, event synchronization, audio analysis, and teardown. |
| **Asterisk ARI REST Client** | `apps/api/src/telephony/qa/asterisk-ari-client.service.ts` | REST client executing HTTP operations against Asterisk ARI (originating channels, starting/stopping recordings, injecting playback, retrieving WAV buffers, deleting recordings). |
| **ARI WebSocket Client** | `apps/api/src/telephony/qa/ari-websocket-client.service.ts` | Maintains real-time WebSocket connection to `/ari/events`, dispatches Stasis, Recording, and Playback events to registered waiters with timeout enforcement. |
| **QA Audio Analyzer** | `apps/api/src/telephony/qa/qa-audio-analyzer.service.ts` | Parses WAV PCM buffers, calculates RMS dBFS, clipping, and runs Goertzel discrete Fourier transform for frequency detection and SNR calculation. |
| **QA Telephony Guard** | `apps/api/src/telephony/qa/qa-telephony-guard.service.ts` | Safety gate enforcing environment flags, isolated QA database, tracking DID whitelisting, inbound single-use leases, and multi-factor call bindings. |
| **Call Controller** | `apps/api/src/telephony/call-controller.ts` | Core telephony webhook handler correlating incoming Telnyx calls, executing campaign routing, initiating buyer dial, and bridging legs. |

---

## 3. Method & Line Number Mapping

### 3.1 `QaOrchestratorService` (`apps/api/src/telephony/qa/qa-orchestrator.service.ts`)

| Lines | Method / Symbol | Purpose & Critical Dependencies |
| :--- | :--- | :--- |
| `23-35` | `interface QaRunOptions` | Run configuration options (`trackingDid`, `callerCli`, `minDurationSecs`, `minSnrDb`, `postPlaybackCaptureMs`, `maxDurationMs`). |
| `37-71` | `interface QaRunContext` | In-memory context tracking run state (`MUTEX_ACQUIRED` through `COMPLETED`/`FAILED`), channel IDs, recording names, and timestamps. |
| `73-84` | `interface QaCleanupSummary` | Boolean checklist of 10 cleanup targets. |
| `86-98` | `interface QaRunResult` | Returned outcome object containing audio analysis results, cleanup summary, and base64 audio. |
| `129-138` | `isRunActive`, `getActiveRunContext` | Concurrency status inspectors. |
| `143-161` | `correlateInboundCall` | Webhook correlation handler associating `telnyxCallControlId` and `prismaCallId` with active `runId`. |
| `166-176` | `notifyBuyerDialed` | Registers Telnyx buyer call control ID upon buyer leg dispatch. |
| `185-244` | `executeTestRun` (Initialization) | Mutex validation (L187-195), QA enablement check (L198-203), config validation (L206-211), context creation (L219-228), watchdog initialization (L241-244). |
| `246-275` | `executeTestRun` (Preflight) | Test run registration (L247), WebSocket connection (L250), inbound test lease opening (L254-268), ARI REST connectivity check (L271-274). |
| `277-314` | `watchdogPromise` | Authoritative 30,000ms server-side hard watchdog deadline with eager channel teardown. |
| `321-360` | `executeTestRun` (Caller Leg) | Registers caller `StasisStart` waiter (L321-326), originates caller channel via ARI (L329-337), verifies caller state `'Up'` (L346-358). |
| `364-400` | `executeTestRun` (Buyer Leg) | Registers buyer `StasisStart` waiter (L364-370), awaits buyer entry from Telnyx (L373-377), performs multi-factor validation & verifies buyer state `'Up'` (L380-398). |
| `402-454` | `executeTestRun` (Dual Record) | Pre-registers `RecordingStarted` waiters (L418-434), executes `ariClient.recordChannel` simultaneously on caller & buyer channels (L437-454). |
| `457-460` | `executeTestRun` (Rec Wait) | Awaits `Promise.all([callerRecStarted, buyerRecStarted])`. |
| `462-485` | `executeTestRun` (Marker Play) | Pre-registers `PlaybackFinished` waiters (L463-474), executes `ariClient.playMedia` on both channels (L477-480), awaits `Promise.all([callerPlayDone, buyerPlayDone])` (L483). |
| `488-506` | `executeTestRun` (Post-Play Capture)| Post-playback capture delay (default 7,000ms, clamped 1,000ms-15,000ms). |
| `511-546` | `executeTestRun` (Rec Finalize) | Pre-registers `RecordingFinished` waiters (L511-526), finalizes & retrieves both WAV buffers via `finalizeAndRetrieveRecording` (L529-538). |
| `548-565` | `executeTestRun` (Persistence) | Writes caller and buyer WAV buffers to `qa/recordings/`. |
| `568-682` | `executeTestRun` (Analysis) | Strict WAV buffer validation & Goertzel frequency analysis (1500 Hz on caller, 1000 Hz on buyer). |
| `711-723` | `executeTestRun` (Success Return) | Triggers `cleanup(context)` and returns successful result. |
| `724-749` | `executeTestRun` (Error Catch) | Catches timeout/failure, triggers `cleanup(context)`, returns structured failure. |
| `750-757` | `executeTestRun` (Finally Block) | Clears watchdog timer, releases single-concurrency mutex (`this.activeRun = null`). |
| `765-812` | `validateRecordingBuffer` | Rejects null, 0-byte, sub-44-byte, 44-byte header-only, non-RIFF/WAVE, and zero-sample buffers. |
| `822-883` | `finalizeAndRetrieveRecording` | Attempts live stop, handles 404 cleanly, awaits `RecordingFinished`, retrieves binary stored file. |
| `889-903` | `cleanup` | In-flight deduplication and post-cleanup caching. |
| `905-1046` | `executeCleanup` | 10-target idempotent cleanup (Caller ARI, Buyer ARI, Telnyx legs, Stop recs, Delete recs, Unregister run, Release bindings, Expire leases, Release wallet, Disconnect WS). |

### 3.2 `AsteriskAriClientService` (`apps/api/src/telephony/qa/asterisk-ari-client.service.ts`)

| Lines | Method | Purpose |
| :--- | :--- | :--- |
| `79-110` | `getBaseUrl`, `getAuthHeader` | Resolves `http://127.0.0.1:8088` and HTTP Basic Auth. |
| `116-136` | `sanitize` | Redacts passwords, usernames, and Basic tokens from all logs and error messages. |
| `139-217` | `request<T>` | JSON REST fetch with deterministic AbortController timeout. |
| `222-261` | `requestBinary` | Binary GET fetch for `/ari/recordings/stored/{name}/file`. |
| `271-284` | `checkConnectivity` | Queries `/ari/asterisk/info` to verify ARI health and latency. |
| `344-355` | `getChannel` | Queries `/ari/channels/{channelId}` for channel state. |
| `404-428` | `originateChannel` | POST `/ari/channels` to initiate outbound calls into Stasis application. |
| `434-464` | `recordChannel` | POST `/ari/channels/{channelId}/record` to record channel media directly. |
| `470-481` | `getLiveRecording` | GET `/ari/recordings/live/{recordingName}`. |
| `487-490` | `stopRecording` | POST `/ari/recordings/live/{recordingName}/stop`. |
| `496-511` | `playMedia` | POST `/ari/channels/{channelId}/play` to inject audio file into channel. |
| `517-523` | `hangupChannel` | DELETE `/ari/channels/{channelId}`. |
| `529-532` | `deleteStoredRecording` | DELETE `/ari/recordings/stored/{recordingName}`. |
| `538-541` | `getStoredRecordingFile` | GET `/ari/recordings/stored/{recordingName}/file`. |

### 3.3 `AriWebSocketClientService` (`apps/api/src/telephony/qa/ari-websocket-client.service.ts`)

| Lines | Method | Purpose |
| :--- | :--- | :--- |
| `120-133` | `getWebSocketUrl` | Formats WebSocket endpoint `ws://127.0.0.1:8088/ari/events?app=callflow-qa&api_key=...`. |
| `153-184` | `connect` | Connects native WebSocket with connection timeout. |
| `185-230` | `handleEvent` | Ingests Asterisk JSON events, performs deduplication, and routes to waiters. |
| `240-280` | `waitForEvent<T>` | Registers one-shot predicate listener with strict per-event timeout. |
| `285-300` | `cancelPendingWaiters` | Cancels in-flight waiters on watchdog timeout or unexpected disconnect. |
| `315-335` | `disconnect` | Gracefully closes WebSocket connection. |

---

## 4. Event Ownership & Lifecycle Dependencies

```
[Asterisk Core / PJSIP]
       │
       ├─► StasisStart (caller) ──► QaOrchestratorService (L346)
       │
       ├─► StasisStart (buyer)  ──► QaOrchestratorService (L373)
       │
       ├─► RecordingStarted (caller) ──► QaOrchestratorService (L457)
       │
       ├─► RecordingStarted (buyer)  ──► QaOrchestratorService (L457)
       │
       ├─► PlaybackFinished (caller) ──► QaOrchestratorService (L483)
       │
       ├─► PlaybackFinished (buyer)  ──► QaOrchestratorService (L483)
       │
       ├─► RecordingFinished (caller) ──► QaOrchestratorService (L529)
       │
       └─► RecordingFinished (buyer)  ──► QaOrchestratorService (L534)
```

### 4.1 Dependency Chain
1. `callerStasisPromise` must resolve before initiating buyer Stasis wait.
2. `buyerStasisPromise` must resolve before recording start.
3. `recordChannel` on both channels must return before `RecordingStarted` waiter resolves.
4. `RecordingStarted` for BOTH legs must resolve before `playMedia` is issued (L457).
5. `PlaybackFinished` for BOTH legs must resolve before the post-playback capture delay begins (L483).
6. Post-playback capture delay must expire before `finalizeAndRetrieveRecording` is invoked (L505).
7. `finalizeAndRetrieveRecording` calls `stopRecording`, awaits `RecordingFinished`, and downloads stored WAV via REST (L529-538).

---

## 5. Identified Race Conditions & Premature Termination Paths

### 5.1 Race Condition 1: Asterisk Stasis Channel Control Mutex (The Proven Root Cause)
- **Mechanism:** In Asterisk ARI, calling `recordChannel` (`POST /ari/channels/{id}/record`) places the channel's Stasis control thread into `__ast_play_and_record`.
- **Conflict:** While `recordChannel` is active, any subsequent `playMedia` (`POST /ari/channels/{id}/play`) on that **same channel** cannot execute concurrently; it is enqueued in Asterisk's `control->command_queue`.
- **Failure Progression in Phase 7B-10S:**
  1. Both channels started recording at 18:33:34.
  2. Both playbacks were requested at 18:33:34 and queued behind their respective recordings.
  3. Because neither channel was playing tone into the bridge, both transmitted silence/comfort noise.
  4. Asterisk's `__ast_play_and_record` on the buyer channel timed out waiting for audio and terminated at 18:33:38 (`No audio available on PJSIP/telnyx-buyer-00000005??`), finalizing the buyer recording as an empty 44-byte WAV header.
  5. Upon termination of the buyer recording, Asterisk immediately popped and played `qa-buyer-marker` (1500 Hz) on the buyer channel at 18:33:39.
  6. That 1500 Hz marker traveled across the Telnyx cloud bridge into the caller channel, which was **still recording**! Caller successfully captured 122KB of 1500 Hz audio.
  7. Caller's own playback (1000 Hz) was never released from Asterisk's queue until the orchestrator's buyer playback waiter timed out at 18:33:42 and triggered hangups.

### 5.2 Race Condition 2: Coupled Waiter Fate-Sharing (`Promise.all`)
- **Mechanism:** Lines 483: `await Promise.all([callerPlayDone, buyerPlayDone]);` coupled the lifecycle of both channels.
- **Vulnerability:** When buyer playback was delayed or blocked, caller playback completion could not progress the pipeline. When the 8,000ms waiter expired, an exception was thrown to the main `catch` block (L724), aborting the run and invoking full cleanup.

### 5.3 Race Condition 3: Monolithic Run Context State
- **Mechanism:** `QaRunContext.state` is a single string enum (`RECORDINGS_STARTED`, `PLAYBACK_FINISHED`, `RECORDINGS_FINISHED`).
- **Vulnerability:** Neither leg maintains an isolated state machine. If buyer recording terminates early (or experiences late renegotiation), the orchestrator has no granular state tracking for buyer vs caller leg.

---

## 6. Conclusion & Transition to Stage B

The source code mapping confirms that the premature termination of the buyer recording is rooted in:
1. Direct recording on Stasis channels conflicting with subsequent playback on the same channel's control thread.
2. Coupled synchronization where buyer playback timeout aborted downstream capture.

Stage B will document the complete forensic root-cause report with evidence classifications.
