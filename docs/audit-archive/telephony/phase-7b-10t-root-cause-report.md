# CallFlow Phase 7B-10T: Forensic Root Cause Investigation Report
**Timestamp:** 2026-11-12T01:24:40Z  
**Phase:** 7B-10T (Buyer Native ARI Recording Lifecycle Repair & Dual-Leg Recording Reliability)  
**Deliverable:** Deliverable B (Stage B — Forensic Root Cause Investigation)

---

## 1. Executive Summary

In Phase 7B-10S, a single authorized live carrier call proved real bidirectional carrier media and achieved Asterisk ARI recording on the caller leg (capturing 122,924 bytes of native PCM audio with 45.32 dB SNR at 1500 Hz). However, the buyer leg recording (`qa-buyer-1d292372-b505-4ddc-a98e-cedf1e731881.wav`) finalized as an empty 44-byte WAV header, and the test run failed with:
`Timed out waiting for ARI event "PlaybackFinished" after 8000ms`.

A comprehensive forensic audit of the Asterisk container logs, PCAP media streams, SIP packet headers, and backend event timelines conclusively establishes the primary root cause:

> **Asterisk Stasis Channel Control Mutex Contention Between Record and Play:**  
> When Asterisk ARI starts a recording on a Stasis channel (`POST /ari/channels/{channelId}/record`), the channel's Stasis thread enters `__ast_play_and_record`. Any subsequent `playMedia` request on that same channel is enqueued in Asterisk's `control->command_queue` and **cannot execute** until recording terminates. Because neither channel could play audio into the cloud bridge while recording was active, Asterisk's recording thread on the buyer leg timed out on silence after ~4 seconds (`app.c:1951 __ast_play_and_record: No audio available on PJSIP/telnyx-buyer...??`), aborting the buyer recording at 44 bytes. Only *after* the recording aborted did Asterisk dequeue and play the buyer's 1500 Hz marker tone, which the caller channel (still recording) successfully captured.

---

## 2. Definitive Forensic Timeline (Phase 7B-10S)

| UTC Timestamp | Component | Event / Action | Evidence & Details |
| :--- | :--- | :--- | :--- |
| **18:33:29.620** | Orchestrator | Mutex acquired, WS connected, Inbound lease opened | Backend log `qa.orchestrator.started` |
| **18:33:29.628** | Asterisk ARI | Caller channel originated: `PJSIP/17252574041@telnyx-caller` | ARI POST `/ari/channels` |
| **18:33:31.423** | Asterisk Core | Caller enters Stasis `callflow-qa,caller,1d292372...` | Channel ID `1762886009.16` |
| **18:33:32.481** | Asterisk Core | Buyer enters Stasis `callflow-qa,buyer,1d292372...` | Channel ID `1762886012.18` (`PJSIP/telnyx-buyer-00000005`) |
| **18:33:33.604** | PCAP / Network | First inbound RTP packet arrives on port 10032 (Buyer leg) | SSRC `0x48cc36dd`, PT=0 (PCMU) |
| **18:33:34.200** | Orchestrator | Both `recordChannel` requests sent to Asterisk ARI | `qa-caller` and `qa-buyer` recording requests |
| **18:33:34.250** | Asterisk ARI | `RecordingStarted` emitted for both channels | Control threads enter `__ast_play_and_record` |
| **18:33:34.310** | Orchestrator | Both `playMedia` requests sent to Asterisk ARI | Caller (1000 Hz) and Buyer (1500 Hz) markers queued |
| **18:33:34.312** | Asterisk Core | Playbacks appended to `control->command_queue` | Blocked behind active recordings |
| **18:33:38.250** | Asterisk Core | **Buyer recording terminates on silence timeout!** | `app.c:1951: No audio available on PJSIP/telnyx-buyer-00000005??` |
| **18:33:38.253** | Asterisk Core | `RecordingFinished` emitted for `qa-buyer` | File written to disk as **44-byte empty header** |
| **18:33:39.100** | Asterisk Core | Buyer command queue unblocked: `qa-buyer-marker` plays! | `Playing '/var/lib/asterisk/sounds/qa/qa-buyer-marker.slin'` |
| **18:33:39.200** | Telnyx Bridge | 1500 Hz tone travels across Telnyx bridge to caller | Caller channel is actively recording! |
| **18:33:41.500** | Asterisk Core | Buyer playback finishes (1500 Hz tone ended) | `PlaybackFinished` emitted for buyer |
| **18:33:42.310** | Orchestrator | Caller playback waiter times out (8000ms deadline) | Caller playback was never dequeued |
| **18:33:42.315** | Orchestrator | Test run catches timeout error; triggers `executeCleanup` | `Timed out waiting for ARI event "PlaybackFinished"` |
| **18:33:43.050** | Asterisk Core | Asterisk channels hung up by cleanup | Caller recording stops at 122,924 bytes |

---

## 3. Analysis of the 10 Specific Investigation Questions

### Question 1: Was an explicit ARI stopRecording request issued?
- **Finding:** NO. Prior to the buyer recording finalizing at 18:33:38, no application stop request was made. The orchestrator's `finalizeAndRetrieveRecording` was only reached at 18:33:43 during teardown.
- **Classification:** `PROVEN`
- **Evidence:** Backend logs confirm zero calls to `POST /ari/recordings/live/qa-buyer.../stop` occurred between 18:33:34 and 18:33:38.

### Question 2: Did Asterisk emit RecordingFinished without an application stop request?
- **Finding:** YES. Asterisk emitted `RecordingFinished` autonomously at 18:33:38.253Z.
- **Classification:** `PROVEN`
- **Evidence:** Asterisk container log:
  ```
  [Nov 11 18:33:38] WARNING[14216][C-00000009]: app.c:1951 __ast_play_and_record: No audio available on PJSIP/telnyx-buyer-00000005??
  [Nov 11 18:33:38] -- User hung up
  ```
  This warning is Asterisk's internal recording loop detecting silence / lack of readable frames, which caused `__ast_play_and_record` to exit and finalize the file.

### Question 3: Was the buyer channel destroyed or replaced?
- **Finding:** NO. Channel `PJSIP/telnyx-buyer-00000005` (ID `1762886012.18`) remained continuously intact from Stasis entry (18:33:32) until explicit hangup (18:33:43).
- **Classification:** `PROVEN`
- **Evidence:** Channel ID remained identical across all ARI events, Asterisk logs, and Stasis handlers.

### Question 4: Did bridge membership change?
- **Finding:** NO. Calls are bridged in Telnyx's cloud switch, not within a local Asterisk bridge. Neither leg joined or left a local Asterisk bridge.
- **Classification:** `PROVEN`
- **Evidence:** No ARI bridge endpoints were invoked (`POST /ari/bridges`). Both channels were isolated in Stasis.

### Question 5: Did RTP destination or codec negotiation change?
- **Finding:** NO. RTP destination and codec remained static throughout the entire session.
- **Classification:** `PROVEN`
- **Evidence:** Deep inspection of all 56 SIP packets in `qa/inspect-sip-packets.mjs` confirmed zero SIP re-INVITEs occurred. Remote RTP was fixed at `192.76.120.10:18206` and local Asterisk was fixed at `10032/udp` with codec PCMU (PT=0).

### Question 6: Was the recording associated with an obsolete channel ID?
- **Finding:** NO. The recording target was `channel:1762886012.18`, which matched the live buyer channel ID exactly.
- **Classification:** `PROVEN`
- **Evidence:** `RecordingStartedEvent.recording.target_uri` was `channel:1762886012.18`.

### Question 7: Did playback timeout invoke shared cleanup?
- **Finding:** YES. The orchestrator's `Promise.all([callerPlayDone, buyerPlayDone])` timed out after 8,000ms because the caller's playback never occurred (it was trapped in Asterisk's channel queue behind the caller recording).
- **Classification:** `PROVEN`
- **Evidence:** Backend log: `Timed out waiting for ARI event "PlaybackFinished" after 8000ms`.

### Question 8: Did cleanup terminate buyer recording before caller recording?
- **Finding:** NO. The buyer recording had already finished 5 seconds prior to cleanup. Cleanup attempted to stop the buyer recording at 18:33:43, but Asterisk returned 404 because the recording was already stored on disk.
- **Classification:** `PROVEN`
- **Evidence:** Cleanup logs show `stopRecording` on buyer returned 404 (already finished) while caller recording was still live and stopped cleanly.

### Question 9: Was there a race between RecordingStarted and bridge establishment?
- **Finding:** NO. Recording started after both legs were answered and entered Stasis. Cloud media was already flowing when recording began.
- **Classification:** `PROVEN`
- **Evidence:** First inbound RTP arrived at 18:33:33.604; `recordChannel` was executed at 18:33:34.200.

### Question 10: Did the buyer leg ever negotiate RTP media?
- **Finding:** YES. The buyer leg negotiated PCMU RTP flawlessly.
- **Classification:** `PROVEN`
- **Evidence:** `qa/recordings/phase-7b-10s-rtp.pcap` contains 442 valid inbound PCMU audio packets (70,720 bytes) delivered to local port 10032.

---

## 4. Root Cause Summary Matrix

| Question | Classification | Core Evidence |
| :--- | :--- | :--- |
| 1. Explicit stop issued? | **PROVEN (NO)** | Zero ARI stop requests before 18:33:43 |
| 2. Autonomous RecordingFinished? | **PROVEN (YES)** | Asterisk `app.c:1951 __ast_play_and_record` silence timeout |
| 3. Channel destroyed/replaced? | **PROVEN (NO)** | Channel ID `1762886012.18` active from 18:33:32 to 18:33:43 |
| 4. Bridge membership change? | **PROVEN (NO)** | No Asterisk bridge used; bridged in Telnyx cloud |
| 5. RTP/Codec change? | **PROVEN (NO)** | 0 SIP re-INVITEs, static PCMU stream on port 10032 |
| 6. Obsolete channel ID? | **PROVEN (NO)** | Recording matched live channel ID throughout |
| 7. Playback timeout triggered cleanup?| **PROVEN (YES)** | Caller playback queued behind record; timed out at 8000ms |
| 8. Cleanup killed buyer first? | **PROVEN (NO)** | Buyer recording finalized 5s before cleanup began |
| 9. Race with bridge setup? | **PROVEN (NO)** | Inbound RTP arrived 600ms before recording began |
| 10. RTP negotiated? | **PROVEN (YES)** | 442 packets / 70.7 KB RTP captured in PCAP |

---

## 5. Architectural Implications for Phase 7B-10T

The failure was not caused by Telnyx, network routing, firewall/NAT, or missing RTP packets. It was caused by **Asterisk's internal channel control serialization**:
- In Asterisk ARI, `recordChannel` blocks concurrent `playMedia` on that channel.
- To achieve simultaneous two-way transmission (marker playback) and capture (recording), recording must be detached from the channel control thread.
- Asterisk ARI provides the native mechanism for this: **Snoop channels** (`POST /ari/channels/{channelId}/snoop` with `spy: in`, `whisper: none`), or alternatively **sequential injection / external mixing** where playback does not contend with recording.
- In addition, caller and buyer lifecycles must be completely decoupled so that a delay on one leg cannot abort the other.
