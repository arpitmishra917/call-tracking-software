# CallFlow Phase QA-1 — Deliverable B: Telephony Infrastructure Audit

**Document ID:** `CALLFLOW-PHASE-QA-1-TELEPHONY-INFRASTRUCTURE-AUDIT`  
**Phase:** Phase QA-1 (Autonomous Telephony QA Capability & Infrastructure Readiness Audit)  
**Evaluation Date:** November 12, 2026  
**Primary Owner:** Agent 4 — Telephony, Asterisk ARI, SIP, RTP & Recording Infrastructure  
**Mode:** READ-ONLY FORENSIC AUDIT (Zero Mutations)  
**Overall Readiness Verdict:** **`PARTIAL PASS`**

---

## 1. Executive Summary

This deliverable provides an exhaustive forensic audit of the actual telephony infrastructure supporting CallFlow. The inspection covers carrier connectivity (Telnyx), media server architecture (Asterisk 20.21.0 in Docker), signaling and media protocols (SIP/PJSIP and RTP), and audio verification systems.

Every finding distinguishes strictly between:
1. **Configured:** Present in static configuration files or templates.
2. **Operationally Accessible:** Queryable and reachable in the active runtime environment.
3. **Live-Verified:** Empirically proven during an authorized live carrier session.

---

## 2. Carrier Connectivity Audit (Telnyx Cloud)

### 2.1 Carrier Architecture & Integration Status

```
[Public PSTN / Carrier Network]
              │
              ▼ (Inbound Call to +17252574041)
     [Telnyx Cloud Engine]
     ├── Call Control App: 3090207513618941231
     ├── Webhook Ingress:  https://coherent-undrilled-disarm.ngrok-free.dev/webhooks/telnyx
     │                     (Ed25519 Signed POST requests)
     └── SIP Signaling:    SIP INVITE to Asterisk PJSIP Transport (UDP 5060)
                           RTP Media to Asterisk Port Range (UDP 10000-10050)
```

### 2.2 Carrier Capabilities Classification Table

| Feature / Dimension | Status Level | Implementation Detail | Observability & Verification Method |
| :--- | :---: | :--- | :--- |
| **Telnyx API Integration** | **Live-Verified** | REST API v2 using `TELNYX_API_KEY`. Used for pre/post balance checks and Call Control actions. | Read-only balance query (`$1.8700 USD`). API mutations are strictly gated by `QaTelephonyGuardService`. |
| **Inbound Call Delivery** | **Live-Verified** | Carrier delivers inbound PSTN call to dedicated tracking DID `+17252574041`, triggering Call Control webhook. | Verified in Phase 7B-10U (Run ID `15f2f1d2...`). |
| **SIP Trunk Configuration** | **Live-Verified** | Configured in `/etc/asterisk/pjsip.conf` with endpoints `telnyx-caller` and `telnyx-buyer` pointing to `sip.telnyx.com`. | Inspected via ARI (`GET /ari/endpoints`) $\to$ both endpoints report `online`. |
| **DID / TFN Provisioning** | **Live-Verified** | Dedicated tracking DID: `+17252574041` (E.164 format). Bound to QA Call Control App `3090207513618941231`. | Verified active on Telnyx account. |
| **Webhook Delivery & Auth** | **Live-Verified** | Public webhook endpoint exposed via ngrok reverse proxy. Authenticated with Ed25519 signatures (`TELNYX_PUBLIC_KEY`). | Verified in runtime logs; invalid signatures rejected with HTTP 401. |
| **Carrier Event Logging** | **Live-Verified** | Telnyx emits granular JSON webhooks: `call.initiated`, `call.answered`, `call.bridged`, `call.hangup`. | Recorded in application logs and correlated by `call_control_id`. |
| **Carrier Call Identifiers** | **Live-Verified** | Telnyx `call_control_id` (UUID format, e.g., `v3:call_control_id...`) and `call_leg_id`. | Mapped to internal `callId` and `attemptId` via `QaTelephonyGuardService` in-memory bindings. |
| **Carrier Failure Visibility** | **Operationally Accessible**| Telnyx emits `call.hangup` with `hangup_cause` (e.g., `NORMAL_CLEARING`, `USER_BUSY`, `CALL_REJECTED`, `TIMEOUT`). | Mapped to `CallState.FAILED`, `BUSY`, or `NO_ANSWER` in `CallsService`. |

### 2.3 Carrier Limitations & Gaps
- **Single DID Inventory:** Only one tracking DID (`+17252574041`) is provisioned for QA. Simultaneous testing of multiple independent inbound campaigns is not possible.
- **Single Buyer SIP Trunk:** Only one buyer SIP account (`sip:arpitmishra9178@sip.telnyx.com`) exists. Testing multi-buyer concurrency or waterfall overflow on live trunks is impossible without additional accounts.
- **Tunnel Volatility:** Carrier webhook ingress depends on an ephemeral ngrok tunnel. If the ngrok process restarts, the public URL changes and carrier delivery breaks until manually updated in the Telnyx portal.

---

## 3. Asterisk & ARI Media Gateway Audit

### 3.1 Container Runtime State
- **Container Name:** `callflow-asterisk-qa` (Container ID `d9264b6a5db7`).
- **Image:** `andrius/asterisk:20-alpine`.
- **Status:** `Up 9 hours (healthy)`.
- **Active Asterisk Version:** `Asterisk 20.21.0` (Built 2026-11-02 12:41:37 UTC, Linux kernel `7.0.0-1017-azure`).
- **Port Bindings:**
  - `5060/udp` $\to$ PJSIP SIP signaling
  - `10000-10050/udp` $\to$ RTP Media stream pool (50 ports)
  - `127.0.0.1:8088/tcp` $\to$ ARI REST & WebSocket HTTP server

### 3.2 ARI Architecture & Inspection Capabilities

```mermaid
flowchart TD
    subgraph AsteriskContainer [callflow-asterisk-qa Container]
        PJSIP[PJSIP Stack: 5060/udp]
        RTP[RTP Engine: 10000-10050/udp]
        STASIS[Stasis Application: callflow-qa]
        SNOOP1[Snoop Channel: Caller 'in']
        SNOOP2[Snoop Channel: Buyer 'in']
        HOOK1[ast_audiohook: Caller WAV]
        HOOK2[ast_audiohook: Buyer WAV]
    end

    subgraph NodeBackend [NestJS API / QA Orchestrator]
        ARI_REST[AsteriskAriClientService: REST 8088]
        ARI_WS[AriWebSocketClientService: WS 8088]
    end

    ARI_REST -->|POST /channels/snoop| STASIS
    ARI_REST -->|POST /channels/record| SNOOP1
    ARI_REST -->|POST /channels/record| SNOOP2
    STASIS --> SNOOP1
    STASIS --> SNOOP2
    SNOOP1 --> HOOK1
    SNOOP2 --> HOOK2
    ARI_WS <--|StasisStart / RecordingFinished| STASIS
```

### 3.3 Detailed Asterisk / ARI Evaluation Matrix

| Subsystem | Readiness Status | Architectural Implementation | Observability & Non-Disruptive Inspection |
| :--- | :---: | :--- | :--- |
| **ARI Availability** | **Live-Verified** | HTTP REST & WebSocket on port 8088. Application name: `callflow-qa`. | Inspectable via `GET /ari/asterisk/info` (Status 200). Non-disruptive. |
| **ARI Authentication** | **Live-Verified** | HTTP Basic Authentication using dedicated QA credentials (`callflow_qa`). Redacted in all reports. | Authenticated queries succeed; unauthenticated return HTTP 401. |
| **Channel Lifecycle** | **Live-Verified** | Channels originated into Stasis (`app: callflow-qa`). Monitored via `StasisStart`, `ChannelStateChange`, `ChannelDestroyed`. | Queryable via `GET /ari/channels` (Zero active channels currently confirmed). |
| **Bridge Lifecycle** | **Live-Verified** | Mixing bridges created via `POST /ari/bridges` with technology `mixing`. | Queryable via `GET /ari/bridges` (Zero active bridges currently confirmed). |
| **Stasis Configuration** | **Live-Verified** | Dedicated application `callflow-qa` configured in `extensions.conf` and dynamically registered over WebSocket. | WebSocket emits real-time event JSON for all subscribed channels. |
| **Snoop Architecture** | **Live-Verified** | Dedicated Snoop channels spawned via `POST /ari/channels/{id}/snoop` with `spy: 'in'`, `whisper: 'none'`. | Decouples recording from parent channel command queues, eliminating historical 44-byte deadlocks. |
| **ExternalMedia Usage** | **Configured Only** | ARI supports `POST /ari/channels/externalMedia`, but CallFlow currently uses native Snoop channels + local WAV recording. | Not utilized in current production flow; native Snoop is preferred. |
| **Recording Architecture** | **Live-Verified** | Audio recorded directly to container disk (`/var/spool/asterisk/recording/`) as 16-bit mono 8000 Hz PCM WAV, then downloaded via ARI `/recordings/stored/{name}/file`. | Queryable via `GET /ari/recordings/stored` (12 historical recordings cataloged). |
| **Hangup & Cleanup** | **Live-Verified** | Teardown sequence: (1) Stop recordings, (2) Hang up Snoop channels, (3) Hang up parent channels, (4) Release leases. | Proved 0 lingering channels following live carrier call. |

---

## 4. SIP & RTP Protocol Inspection Capabilities

### 4.1 SIP Signaling Observability
- **SIP INVITE, Provisional (100 Trying, 180 Ringing), 200 OK, ACK, BYE:**
  - **Tooling:** Container-level packet capture (`tcpdump -i any -w ... port 5060`).
  - **Status:** **Live-Verified.** Phase 7B-10U captured 90 SIP packets covering the complete RFC 3261 dialog (INVITE $\to$ 180 Ringing $\to$ 200 OK $\to$ ACK $\to$ BYE).
  - **Limitation:** Asterisk ARI does not expose raw SIP headers directly via standard REST channels without dialplan variable interception (`PJSIP_HEADER`).

### 4.2 RTP Media Flow Observability
- **RTP Packet Flow:**
  - Analyzed via [`QaRtpClassifierService`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-rtp-classifier.service.ts) and [`qa/analyze-pcap-deep.mjs`](file:///C:/Projects/callflow-agent-a/qa/analyze-pcap-deep.mjs).
  - Captures source/destination IP, UDP ports, SSRC, payload types, packet counts, wall durations, and media durations.
- **RTP Packet Loss & Sequencing:**
  - Sequence continuity parsed directly from 16-bit RTP header sequence numbers.
  - Reordering detected by tracking monotonic sequence increases.
  - Phase 7B-10U verified: **0 sequence packet loss across all 4 streams** (with 8 reordered arrivals due to internet jitter).
- **Jitter & Timestamps:**
  - Inter-packet arrival timestamps tracked at microsecond resolution in PCAP (`tsSec + tsUsec / 1e6`).
  - Timestamp discontinuities flagged when $\Delta t > 1600$ units (standard packet is 160 units @ 8 kHz).
- **Codec Negotiation:**
  - Supported: PCMU (G.711u, Payload Type 0) and Comfort Noise (PT 13).
  - Confirmed via SDP in SIP INVITE/200 OK: Negotiated `audio 0 PCMU/8000`.
- **NAT and Media Connectivity:**
  - NAT traversal enforced in `pjsip_transport.conf`:
    - `external_media_address = 172.19.0.3` (or public IP)
    - `rtp_symmetric = yes`
    - `direct_media = no` (Media anchored in Asterisk)
    - `rtp_keepalive = 1`

---

## 5. Audio Verification Levels & Signal Forensics

To guarantee rigorous evaluation, CallFlow distinguishes between four discrete levels of audio verification:

```
[Level 1: Bridge Existence] ──► [Level 2: RTP Presence] ──► [Level 3: Signal Detection] ──► [Level 4: Intelligibility]
 Asterisk Mixing Bridge         UDP Packets Flowing          Goertzel Tone DFT & SNR          PESQ / POLQA / Human
```

### 5.1 The Four Verification Levels

1. **Level 1 — Audio Bridge Existence:**
   - *Definition:* Asterisk ARI reports that two channels are members of the same mixing bridge (`bridge_type: mixing`).
   - *Limitation:* Does NOT prove media is flowing; channels can be bridged while muted, blocked by NAT, or dropping packets.
   - *Status:* **Live-Verified.**
2. **Level 2 — RTP Packet Presence:**
   - *Definition:* Network capture confirms bi-directional UDP packets with RTP Version 2 headers and non-zero payload bytes.
   - *Limitation:* Does NOT prove audio content; packets can contain continuous silence, comfort noise, or one-way audio.
   - *Status:* **Live-Verified (752 packets across 4 streams).**
3. **Level 3 — Actual Audio Signal Detection (Mathematical DFT):**
   - *Definition:* Binary audio extracted from Asterisk Snoop channels is analyzed via dual-pass windowed Goertzel Discrete Fourier Transform algorithms to detect specific target frequencies with high Signal-to-Noise Ratio (SNR $\ge 5.0$ dB) and verify absence of clipping and silence.
   - *Capability:*
     - Caller audio reaches buyer: **Proven (+48.06 dB SNR for 1000 Hz marker).**
     - Buyer audio reaches caller: **Proven (+44.96 dB SNR for 1500 Hz marker).**
     - Full-duplex: **Proven (Both directions verified simultaneously).**
     - Non-silent: **Proven (RMS -14.2 dBFS and -18.1 dBFS; clipping 0.00%).**
   - *Status:* **Live-Verified.**
4. **Level 4 — Audio Intelligibility & Quality (PESQ / POLQA):**
   - *Definition:* Perceptual Evaluation of Speech Quality (PESQ, ITU-T P.862) or POLQA (ITU-T P.863) scoring human speech against reference audio.
   - *Current Status:* **Unavailable.** The system currently tests synthetic sine-wave markers (1000 Hz, 1500 Hz) rather than phonetically balanced spoken voice samples.

---

## 6. Infrastructure Visibility Summary

| Infrastructure Layer | Visibility Level | Disruptive to Live Calls? | Inspection Tool |
| :--- | :---: | :---: | :--- |
| **SIP Signaling (Port 5060)** | High (Complete packet trace) | **No** (Passive tcpdump) | Container tcpdump / PCAP |
| **RTP Media (Ports 10000-10050)**| High (Complete stream trace) | **No** (Passive tcpdump) | Container tcpdump / PCAP |
| **Asterisk Channels & Bridges** | High (State, variables, IDs) | **No** (ARI REST read queries) | `GET /ari/channels`, `GET /ari/bridges` |
| **Active Live Audio on Channel** | High (Full-duplex recording) | **No** (Non-intrusive Snoop audiohook)| `POST /ari/channels/{id}/snoop` (`spy: 'in'`) |
| **Stored Recordings** | High (Direct binary download) | **No** (Read-only download) | `GET /ari/recordings/stored/{name}/file` |
| **PostgreSQL Database** | High (Read-only SQL queries) | **No** (Read committed isolation) | PrismaClient on port 5433 |

**Conclusion:** The infrastructure provides **exceptional non-disruptive observability**. Agent 4 can passively capture, inspect, and analyze live signaling, media, and audio without terminating or altering active calls.
