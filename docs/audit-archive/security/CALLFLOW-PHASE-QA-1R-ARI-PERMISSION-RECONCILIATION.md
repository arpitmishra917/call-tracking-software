# CallFlow Phase QA-1R: ARI Permission & Inspection Architecture Reconciliation

**Document ID:** `CALLFLOW-PHASE-QA-1R-ARI-PERMISSION-RECONCILIATION`  
**Phase:** CALLFLOW-PHASE-QA-1R (Evidence Reconciliation & Safety Boundary Clarification)  
**Author:** Agent 4 — Telephony, Asterisk ARI, SIP, RTP & Recording Infrastructure  
**Supporting Agents:** Agent 2 (Backend), Agent 3 (Web UI)  
**Mode:** STRICT READ-ONLY FORENSIC RECONCILIATION  
**Repository Working Copy:** [`CALLFLOW-PHASE-QA-1R-ARI-PERMISSION-RECONCILIATION.md`](file:///C:/Projects/callflow-agent-a/CALLFLOW-PHASE-QA-1R-ARI-PERMISSION-RECONCILIATION.md)  

---

## 1. Executive Summary

During Phase QA-1, the telephony audit observed that the Asterisk ARI (Asterisk REST Interface) configuration operates with Read/Write credentials, while simultaneously asserting that the audit execution itself was strictly read-only. 

This reconciliation investigates:
1. The exact boundary between ARI read-only inspection and state mutation.
2. The exact permissions configured in Asterisk QA (`/etc/asterisk/ari_secrets.conf`).
3. Whether passive observation can be conducted with a genuinely read-only Asterisk credential.
4. The exact mechanical impact of `POST /ari/channels/{channelId}/snoop` on active telephony channels.
5. Feasible non-intrusive observation patterns for live telephony verification.

---

## 2. ARI Endpoint Classification: Query vs. Mutation

Asterisk REST Interface (ARI) endpoints are strictly categorized by HTTP method and operational effect:

### 2.1 GET-Only Inspection Endpoints (Zero State Mutation)

These endpoints perform pure memory/state queries within the Asterisk core engine without modifying channel states, allocation tables, or audio paths:

| Endpoint | HTTP Method | Data Returned | Impact on Running Calls |
| :--- | :---: | :--- | :--- |
| `/ari/asterisk/info` | `GET` | Asterisk version, uptime, system resources, build info | None (Core telemetry) |
| `/ari/endpoints` | `GET` | List of all configured PJSIP/SIP endpoints & technology status | None (Read PJSIP cache) |
| `/ari/endpoints/{tech}/{resource}` | `GET` | Specific endpoint state, channels, and registration state | None (Read PJSIP cache) |
| `/ari/channels` | `GET` | Active channels list, caller ID, account code, creation time | None (Channel table read) |
| `/ari/channels/{channelId}` | `GET` | Full snapshot of specific channel state, dialplan context, vars | None (Channel object read) |
| `/ari/channels/{channelId}/variable`| `GET` | Evaluates channel variable (e.g. `${CALLERID(num)}`, `${CDR}`) | None (Variable lookup) |
| `/ari/bridges` | `GET` | Active bridges list, bridge technology, participant channels | None (Bridge table read) |
| `/ari/bridges/{bridgeId}` | `GET` | Bridge details, channels in bridge, bridge creator | None (Bridge object read) |
| `/ari/recordings/stored` | `GET` | List of completed stored recordings on disk | None (Directory listing) |
| `/ari/recordings/stored/{name}` | `GET` | Metadata of stored recording (duration, format) | None (File metadata read) |
| `/ari/recordings/stored/{name}/file`| `GET` | Raw binary WAV/audio download of completed recording | None (File read stream) |
| `/ari/recordings/live/{name}` | `GET` | Status of in-progress recording session | None (Live recording status) |
| `/ari/sounds` | `GET` | List of available system sounds on Asterisk | None (Disk directory read) |
| `/ari/events` (WebSocket) | `GET` (WS Upgrade) | Real-time event stream (`StasisStart`, `ChannelStateChange`, etc.) | None (Observer subscriber) |

### 2.2 Mutation Endpoints (Create, Modify, or Delete Resources)

These endpoints alter Asterisk core state, allocate or destroy memory structures, attach audio hooks, or modify dialplan execution:

| Endpoint | HTTP Method | Action Performed | Mutation Severity |
| :--- | :---: | :--- | :---: |
| `/ari/channels` | `POST` | Originates a new call (SIP INVITE or Local dial) | **HIGH (Spawns call)** |
| `/ari/channels/{channelId}` | `DELETE` | Hangs up an active call channel | **CRITICAL (Terminates call)** |
| `/ari/channels/{channelId}/answer` | `POST` | Sends 200 OK to answer an incoming SIP channel | **MEDIUM (Transitions state)** |
| `/ari/channels/{channelId}/ring` | `POST` | Generates 180 Ringing indication | **LOW (Signaling state)** |
| `/ari/channels/{channelId}/snoop` | `POST` | Allocates a Snoop channel and attaches audiohook to parent | **HIGH (Allocates channel & audiohook)** |
| `/ari/channels/{channelId}/record` | `POST` | Attaches recording audiohook to channel | **HIGH (Starts disk I/O & hook)** |
| `/ari/channels/{channelId}/play` | `POST` | Plays audio prompt/marker into channel audio stream | **HIGH (Injects audio into stream)** |
| `/ari/channels/{channelId}/variable`| `POST` | Mutates channel variable value | **MEDIUM (State mutation)** |
| `/ari/bridges` | `POST` | Creates a new mixing or holding bridge | **MEDIUM (Allocates bridge)** |
| `/ari/bridges/{bridgeId}` | `DELETE` | Destroys bridge and removes all channels | **HIGH (Destroys bridge)** |
| `/ari/bridges/{bridgeId}/addChannel`| `POST` | Adds channel into bridge (joins media paths) | **HIGH (Bridges media)** |
| `/ari/bridges/{bridgeId}/removeChannel`|`POST`| Removes channel from bridge (breaks media path) | **HIGH (Unbridges media)** |
| `/ari/recordings/stored/{name}` | `DELETE` | Permanently deletes recording file from disk | **HIGH (Filesystem deletion)** |

---

## 3. Existing Agent ARI Credential Audit

Inspection of [`qa/asterisk/docker-entrypoint.sh`](file:///C:/Projects/callflow-agent-a/qa/asterisk/docker-entrypoint.sh#L147-L157) confirms how Asterisk initializes ARI user authentication:

```bash
# Lines 149-156 of qa/asterisk/docker-entrypoint.sh:
cat <<EOF > /etc/asterisk/ari_secrets.conf
[${ARI_USER}]
type = user
read_only = no
password = ${ARI_PASS}
EOF
```

### Forensic Finding:
1. The credentials provisioned in `callflow-asterisk-qa` have `read_only = no`.
2. Therefore, the existing agent possesses **full read/write mutation permissions** over Asterisk ARI.
3. During Phase QA-1, Agent 4 exercised self-enforced operational discipline by restricting all API calls to `GET` endpoints (`/ari/asterisk/info`, `/ari/endpoints`, `/ari/channels`, `/ari/bridges`, `/ari/recordings/stored`).
4. However, at the Asterisk security layer, the credential was NOT constrained by Asterisk RBAC.

---

## 4. Operation Under a Genuinely Read-Only ARI Credential

In Asterisk's `ari.conf`, setting `read_only = yes` for an ARI user enforces the following rules at the HTTP dispatcher:
- Any request with HTTP method `POST`, `PUT`, or `DELETE` is immediately rejected with HTTP `403 Forbidden`.
- Any request with HTTP method `GET` is authorized.
- WebSocket connection to `/ari/events?app=callflow-qa` is authorized, allowing event subscription.

### Can the Agent Operate in Read-Only Mode?
- **For Passive System Audits (Phase QA-1, QA-1R):** **YES.** A read-only credential (`read_only = yes`) is 100% sufficient to query endpoint statuses, active channels, bridge memberships, and listen to the Stasis WebSocket event stream.
- **For Audio Snoop Capture (Phase 7B-10U, QA-2):** **NO.** Creating a Snoop channel requires `POST /ari/channels/{channelId}/snoop`, and starting recording requires `POST /ari/channels/{snoopChannelId}/record`. Asterisk will reject both operations under `read_only = yes`.

---

## 5. Forensic Impact of Snoop Channel Creation (`POST /snoop`)

The Snoop channel architecture was introduced in Phase 7B-10T to resolve the 44-byte buyer recording issue. Does invoking `snoopChannel()` modify active call resources?

### Mechanical Analysis of Asterisk Snoop:
When `POST /ari/channels/{channelId}/snoop` is executed:
1. **Channel Table Allocation:** Asterisk allocates a new core channel object named `Snoop/<parentChannelId>-<subId>`.
2. **Audiohook Attachment:** Asterisk attaches an audiohook (`AUDIOHOOK_TYPE_SPY`) to the parent channel's audio processing pipeline.
3. **Audio Processing Path:** On every 20ms audio frame passing through the parent channel:
   - The audiohook duplicates the linear PCM frame buffer.
   - It routes the copied buffer to the Snoop channel's read queue.
   - In `spy: 'in'` mode, it intercepts RX media (media received from the remote party) before mixing.
   - In `spy: 'out'` mode, it intercepts TX media.
4. **Whisper Capability:** If `whisper` mode is enabled (not used in QA), the Snoop channel can inject audio into the parent channel's TX path.
5. **Teardown Dependency:** When the parent channel hangs up, Asterisk automatically destroys the attached Snoop channel and frees the audiohook. When the Snoop channel is hung up via `DELETE /ari/channels/{snoopId}`, the audiohook is detached without terminating the parent call.

### Verdict on Resource Modification:
Creating a Snoop channel **DOES modify active Asterisk internal resources** (allocates a new channel, adds an audiohook into the parent's audio processing thread, consumes CPU for frame duplication). However, in `spy: 'in'` mode with `whisper: 'none'`, it does **NOT alter the external SIP signaling, does NOT alter the negotiated SDP codecs, and does NOT interrupt the audio bridge between caller and buyer**.

---

## 6. Live-Call Observation Without Creating Additional Channels

Can live calls be observed without creating extra channels or mutating resources?

### Method 1: Passive ARI WebSocket Event Monitoring (Zero Channel Allocation)
- Connect to `GET /ari/events?app=callflow-qa&subscribeAll=true`.
- Asterisk streams all signaling events:
  - `ChannelCreated` (channel name, uniqueid, callerid)
  - `ChannelStateChange` (Ringing, Up, Down)
  - `ChannelEnteredBridge` / `ChannelLeftBridge`
  - `ChannelVarset`
  - `ChannelHangupRequest` / `ChannelDestroyed` (hangup cause)
- **Impact:** ZERO additional channels. Completely non-intrusive.

### Method 2: External Network Packet Capture (PCAP) (Zero Asterisk API Interaction)
- Run `tcpdump` or packet filter on container network interface capturing UDP ports `5060` (SIP) and `10000-10050` (RTP).
- Passive network tapping captures all SIP INVITE/BYE messages and all full-duplex RTP audio payloads without touching Asterisk memory, dialplan, or API.
- **Impact:** ZERO Asterisk core interaction. 100% passive observation.

### Method 3: Core Channel Variable Queries via ARI GET
- Query `GET /ari/channels/{channelId}/variable?variable=PJSIP_DIAL_STATUS`.
- Query `GET /ari/channels/{channelId}/variable?variable=RTPAUDIOQOS`.
- Returns jitter, packet loss, and RTT statistics computed natively by Asterisk RTP stack.
- **Impact:** ZERO additional channels. Read-only.

---

## 7. Recommended Dual-Credential Security Architecture

To guarantee strict safety boundaries for future automated phases, Asterisk should support two distinct ARI users:

```ini
; Recommended configuration for future hardening:
[callflow_qa_observer]
type = user
read_only = yes
password = <OBSERVER_PASSWORD>

[callflow_qa_operator]
type = user
read_only = no
password = <OPERATOR_PASSWORD>
```

- **Auditing & Forensic Agents (Agent 4 read-only passes):** Authenticate strictly as `callflow_qa_observer`. Any accidental mutation attempt immediately fails with `403 Forbidden`.
- **Authorized Execution Agents (Single-call verified phases):** Authenticate as `callflow_qa_operator` only under explicit user authorization.

---

## 8. Summary Matrix

| Capability | Read-Only Credential (`read_only=yes`) | Read/Write Credential (`read_only=no`) | Existing QA Setup |
| :--- | :---: | :---: | :---: |
| Query Asterisk Uptime & Version | ✅ YES | ✅ YES | ✅ Permitted |
| Query Endpoint Registration | ✅ YES | ✅ YES | ✅ Permitted |
| List Active Channels & Bridges | ✅ YES | ✅ YES | ✅ Permitted |
| Subscribe to WebSocket Events | ✅ YES | ✅ YES | ✅ Permitted |
| Read Channel Variables | ✅ YES | ✅ YES | ✅ Permitted |
| Download Completed Recordings | ✅ YES | ✅ YES | ✅ Permitted |
| Create Snoop Channel (`POST /snoop`) | ❌ BLOCKED (403) | ✅ YES | ⚠️ Permitted |
| Record Live Channel (`POST /record`) | ❌ BLOCKED (403) | ✅ YES | ⚠️ Permitted |
| Originate Call (`POST /channels`) | ❌ BLOCKED (403) | ✅ YES | ⚠️ Permitted |
| Hangup Channel (`DELETE /channels/{id}`) | ❌ BLOCKED (403) | ✅ YES | ⚠️ Permitted |

**Reconciliation Conclusion:** The existing QA Asterisk credential (`callflow_qa`) possesses write permissions, but was accessed in a purely non-mutating manner during Phase QA-1. Passive observation without channels is fully viable via WebSocket and PCAP, whereas ARI audio recording inherently requires `POST` mutation permissions.
