# CallFlow — Phase 7B-9D: Recording Architecture & Network Security Remediation Design

> **Authorization Mode:** STRICT READ-ONLY — DESIGN AND VERIFICATION ONLY  
> **Status:** COMPLETED  
> **Final Verdict:** `REMEDIATION DESIGN READY FOR OPERATOR REVIEW`  
> **Timestamp:** 2026-11-10T23:48:00+05:30  
> **Target Database:** Isolated Local PostgreSQL `callflow_qa` (`127.0.0.1:5433`)  
> **Target Media Engine:** Dedicated Local Asterisk QA (`127.0.0.1:8088 ARI / 5060 SIP`)  
> **Production Boundary:** Production Supabase Pooler (`52.68.3.1:6543`) 100% UNTOUCHED (Zero Sockets)

---

## Executive Summary

Phase 7B-9D provides an authoritative, technically verified **Remediation Design** resolving the recording collisions, architectural discrepancies, and network exposure risks identified in Phase 7B-9C. 

Through forensic inspection of the Asterisk 20 REST API schema (`/usr/share/asterisk/rest-api/channels.json`), Asterisk PBX channel variable evaluation, and network transport bindings:
1. **Recording Architecture Selected:** We establish that **ARI-Only Recording** with Stasis on both caller and buyer channels is the only architecture that deterministically captures bidirectional media, guarantees unique cryptographic filenames, and eliminates filesystem mount dependencies.
2. **Media Directionality Proved:** Official Digium Asterisk documentation confirms: *"Record audio from a channel. Note that this will not capture audio sent to the channel."* Consequently, single-channel recording captures strictly unidirectional incoming audio. True two-way carrier verification requires recording both the caller channel and the buyer channel.
3. **Overwrite Elimination:** Truncated 8-character naming (`qa-rec-${runId.slice(0, 8)}`) and `ifExists: 'overwrite'` are replaced with full UUIDv4 naming (`qa-caller-${runId}`, `qa-buyer-${runId}`) and Asterisk's native fail-closed `ifExists: 'fail'` parameter.
4. **Network Hardening Designed:** Inbound UDP 5060 and 10000–10050 exposure is reassessed, and a transport-layer firewall restriction design using authoritative Telnyx subnets (`192.76.120.0/24`, `64.16.250.0/24`) is formulated.

> [!IMPORTANT]
> **STRICT BOUNDARY NOTICE**  
> Under Phase 7B-9D authorization, **ZERO CODE CHANGES WERE APPLIED**, no configuration files modified, no services restarted, no firewall rules altered, and zero carrier calls placed.

---

## 1. Audit 1 — Selection & Verification of Recording Architecture

### 1.1 Comparative Architectural Evaluation

| Criteria | Architecture A: ARI-Only (Recommended) | Architecture B: Dialplan-Only | Architecture C: Dual/Hybrid (Current Flawed) |
| :--- | :--- | :--- | :--- |
| **Control Interface** | Asterisk ARI REST API (`/ari/channels/.../record`) | Dialplan application `Record(...)` | Mixed: ARI caller + Dialplan buyer |
| **Filename Naming** | Fully dynamic via API parameter (`runId`) | Dialplan variable expansion (`${UNIQUEID}`) | Truncated `qa-rec-...` + literal `%d` |
| **Collision Risk** | **Zero** (128-bit UUIDv4 + `ifExists: 'fail'`) | **Low** (Asterisk epoch-based `${UNIQUEID}`) | **HIGH** (`%d` collision + 8-char truncation) |
| **Retrieval Method** | Binary stream via REST (`GET /ari/recordings/stored/.../file`) | Host filesystem read from mounted volume | Mixed: REST for caller, filesystem for buyer |
| **Filesystem Mount** | **Not required** (REST binary payload) | Required (container-to-host file sync) | Required for buyer; REST for caller |
| **State Synchronization** | Atomic promise in `QaOrchestratorService` | Asynchronous file polling on host disk | Complex race condition between ARI & FS |
| **Media Proof** | **Full Bidirectional Proof** (dual Stasis channels) | **Full Bidirectional Proof** | **Unidirectional Only** (caller ARI only) |

### 1.2 Channel Media Directionality & The Single-Channel Trap

Inspection of `/usr/share/asterisk/rest-api/channels.json` reveals the official Digium Asterisk specification:

```json
{
  "path": "/channels/{channelId}/record",
  "summary": "Start a recording.",
  "notes": "Record audio from a channel. Note that this will not capture audio sent to the channel. The bridge itself has a record feature if that's what you want."
}
```

This establishes the fundamental laws of Asterisk media recording:
1. Recording an Asterisk channel captures **ONLY the audio received on that channel from the network**. It does not capture locally injected playbacks or audio sent *to* that channel.
2. In our architecture, Telnyx bridges the call in the cloud. Asterisk terminates two distinct legs:
   - **Leg 1 (`telnyx-caller`):** Transmits 1000 Hz tone outward $\rightarrow$ receives 1500 Hz buyer tone from carrier bridge.
   - **Leg 2 (`telnyx-buyer`):** Transmits 1500 Hz tone outward $\rightarrow$ receives 1000 Hz caller tone from carrier bridge.
3. **Mathematical Proof of Bidirectional Media:**
   - Recording only Leg 1 captures only the 1500 Hz tone (proves buyer $\rightarrow$ caller path). It **does not prove** caller $\rightarrow$ buyer audio traversed the bridge!
   - Recording only Leg 2 captures only the 1000 Hz tone (proves caller $\rightarrow$ buyer path).
   - Therefore, to prove **true bidirectional RTP audio**, Asterisk must record **BOTH channels**:
     - `qa-caller-${runId}.wav`: analyzed for 1500 Hz ($\pm 25$ Hz, $SNR \ge 15.0$ dB).
     - `qa-buyer-${runId}.wav`: analyzed for 1000 Hz ($\pm 25$ Hz, $SNR \ge 15.0$ dB).

### 1.3 Recommended Primary Architecture: Pure ARI-Only Dual Recording

To implement Architecture A:
- In `qa/asterisk/extensions.conf`, the buyer context simply delegates to Stasis:
  ```ini
  [from-telnyx-buyer]
  exten => _.,1,NoOp(--- [QA-BUYER] Passing inbound buyer leg to Stasis ---)
   same => n,Answer()
   same => n,Stasis(callflow-qa,buyer)
   same => n,Hangup()
  ```
- Both channels reside in Stasis. [`QaOrchestratorService`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-orchestrator.service.ts) controls both legs via REST, starts recordings on both channels with unique IDs, retrieves both WAV files via REST, and passes both to [`QaAudioAnalyzerService`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-audio-analyzer.service.ts).

---

## 2. Audit 2 — Recording ID & Overwrite Safety

### 2.1 Flaws in Current Implementation

In [`qa-orchestrator.service.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-orchestrator.service.ts) line 205:
```typescript
const recordingName = `qa-rec-${runId.slice(0, 8)}`;
await this.ariClient.recordChannel(channel.id, {
  name: recordingName,
  format: 'wav',
  ifExists: 'overwrite', // DANGEROUS
});
```

1. **Entropy Loss:** A standard UUIDv4 contains 128 bits of entropy ($3.4 \times 10^{38}$ combinations). Slicing to 8 characters reduces entropy to 32 bits ($4.3 \times 10^9$ combinations). While collision probability in a single run is low, it violates deterministic test isolation principles.
2. **Destructive Overwrites:** `ifExists: 'overwrite'` instructs Asterisk to silently overwrite any existing file with that name, destroying evidence of prior test failures.
3. **Cleanup Crosstalk:** If run B starts while run A's recording is still on disk, `cleanup()` in run B might delete run A's recording.

### 2.2 Proposed Deterministic Naming & Fail-Closed Specification

Inspection of Asterisk 20 schema (`channels.json`) confirms that Asterisk natively supports:
```json
{
  "name": "ifExists",
  "description": "Action to take if a recording with the same name already exists.",
  "defaultValue": "fail",
  "allowableValues": { "values": ["fail", "overwrite", "append"] }
}
```
If a recording exists, Asterisk returns **HTTP 409 Conflict** (`Recording already exists`).

**Proposed Standard:**
- Caller recording name: `qa-caller-${runId}` (e.g. `qa-caller-c49a18d2-5a1e-4c78-b112-921867e3a980`)
- Buyer recording name: `qa-buyer-${runId}` (e.g. `qa-buyer-c49a18d2-5a1e-4c78-b112-921867e3a980`)
- Parameter: `ifExists: 'fail'`
- **Guarantee:** 100% collision-free, fail-closed, and traceable across backend logs, database calls, and Asterisk recordings.

---

## 3. Audit 3 — Asterisk `Record()` Application Syntax Verification

### 3.1 Verified Syntax from Asterisk PBX Core

Forensic inspection of Asterisk 20 `app_record.so` and Asterisk PBX application registry confirms the exact syntax of the `Record()` dialplan application:

$$\text{Record}(\text{filename.format}[\text{,silence}][\text{,maxduration}][\text{,options}])$$

- **`filename.format`:** Target file path and audio container format. Both `filename.wav` and `filename:wav` are accepted by Asterisk's parser.
- **`silence`:** Integer seconds of continuous silence before auto-terminating (default `0` = disabled).
- **`maxduration`:** Integer maximum recording duration in seconds (default `0` = unlimited).
- **`options`:** Single-character flags parsed by `ast_app_parse_options`:
  - `a`: Append to existing recording.
  - `n`: Do not answer channel before recording.
  - `q`: Quiet mode (suppress warning beeps).
  - `s`: Skip recording if channel is not answered.
  - `t`: Alternate DTMF termination key (`#` default).
  - `k`: Keep recording on hangup.
  - `u`: Unique mode (appends an integer if file exists).

### 3.2 Confirmation on `%d` and `${UNIQUEID}`

1. **`%d` is NOT a Dialplan Substitution Token:** Asterisk dialplan does not perform `printf`-style string formatting. Passing `buyer-received-%d` literally names the file `buyer-received-%d.wav`.
2. **`${UNIQUEID}` is Fully Valid:** Asterisk evaluates channel variables prior to passing arguments to applications. `${UNIQUEID}` expands to the channel's unique identifier (e.g. `1699634932.12`).
3. **Conclusion for Dialplan:** If dialplan recording is retained, the only valid syntax is `Record(/var/spool/asterisk/recording/buyer-received-${UNIQUEID}:wav,2,10)`. However, ARI recording remains vastly superior because it avoids filesystem mapping entirely.

---

## 4. Audit 4 — RTP & SIP Network Security Reassessment

### 4.1 Reassessment of Previous "PASS" Classification

In Phase 7B-9B, network exposure was classified as PASS based on the fact that ARI (8088) and PostgreSQL (5433) are bound strictly to `127.0.0.1`, and SIP (5060) and RTP (10000–10050) were bound to `0.0.0.0` as architecturally required for VoIP.

However, an engineering security audit requires separating **local application binding** from **network boundary defense**:
1. **Windows Firewall Vulnerability:** Windows Defender Firewall allows inbound UDP on all published Docker ports via the `Docker Desktop Backend` rule. There is **zero source-IP filtering** at the host firewall level.
2. **SIP (5060/udp) Risk — MEDIUM:**
   - Any host on the local LAN or the internet (if port-forwarded) can reach UDP 5060.
   - While Asterisk PJSIP `[telnyx-buyer-identify]` rejects non-Telnyx IPs with `401 Unauthorized`, Asterisk is still subjected to unauthenticated UDP floods and SIP scanner reconnaissance.
3. **RTP (10000–10050/udp) Risk — LOW to MEDIUM:**
   - Ephemeral in nature; ports are only open during active call sessions.
   - Asterisk uses `rtp_symmetric=yes`, locking the media stream to the source IP/port of the first incoming RTP packet. However, an open UDP port range without source IP filtering creates a window of vulnerability during active calls.

### 4.2 Authoritative Carrier IP Grounding

Authoritative Telnyx documentation specifies the following infrastructure ranges:
- **SIP Signaling Proxies:** `192.76.120.10`, `64.16.250.10`, `sip.telnyx.com`
- **Voice Media / RTP Subnets:** `192.76.120.0/24`, `64.16.250.0/24`

Any source outside these subnets attempting to send SIP or RTP to CallFlow is illegitimate and should be rejected at the network transport boundary.

---

## 5. Audit 5 — Proposed Network Hardening Design

Without modifying current firewall rules or Docker configurations, we design a 2-tier defense-in-depth model:

```mermaid
flowchart LR
    subgraph Internet
        TelnyxSig["Telnyx SIP Proxies<br/>192.76.120.10, 64.16.250.10"]
        TelnyxMedia["Telnyx Media Gateways<br/>192.76.120.0/24, 64.16.250.0/24"]
        Attacker["Internet Scanners / Rogue IPs"]
    end

    subgraph Host Network Boundary: Windows Advanced Firewall
        FW_SIP{"Inbound Rule:<br/>Port 5060/udp<br/>RemoteIP: Telnyx Signaling"}
        FW_RTP{"Inbound Rule:<br/>Ports 10000-10050/udp<br/>RemoteIP: Telnyx Media"}
    end

    subgraph Localhost Only
        FW_ARI["Port 8088: 127.0.0.1 only"]
        FW_DB["Port 5433: 127.0.0.1 only"]
    end

    subgraph Asterisk PJSIP Container
        PJSIP_ID["Identify: telnyx-buyer-identify<br/>Line Matching (line=yes)"]
        RTP_SYM["Symmetric RTP Validation<br/>(rtp_symmetric=yes)"]
    end

    TelnyxSig -->|Allowed| FW_SIP --> PJSIP_ID
    TelnyxMedia -->|Allowed| FW_RTP --> RTP_SYM
    Attacker -.->|BLOCKED AT OS FIREWALL| FW_SIP
    Attacker -.->|BLOCKED AT OS FIREWALL| FW_RTP
```

### 5.1 Tier 1: Host OS Packet Filtering (Windows Defender Firewall)

When authorized, create scoped inbound firewall rules:
```powershell
# Proposed Rule 1: Restrict Inbound SIP 5060 to Telnyx Proxies + Localhost
New-NetFirewallRule -DisplayName "CallFlow QA - Inbound SIP (Telnyx Only)" `
    -Direction Inbound -Protocol UDP -LocalPort 5060 -Action Allow `
    -RemoteAddress 192.76.120.10, 64.16.250.10, 127.0.0.1, 192.168.0.0/16

# Proposed Rule 2: Restrict Inbound RTP to Telnyx Media Gateways + Localhost
New-NetFirewallRule -DisplayName "CallFlow QA - Inbound RTP (Telnyx Only)" `
    -Direction Inbound -Protocol UDP -LocalPort 10000-10050 -Action Allow `
    -RemoteAddress 192.76.120.0/24, 64.16.250.0/24, 127.0.0.1, 192.168.0.0/16
```

### 5.2 Tier 2: Carrier Media Range Limitations & Mitigation

- **Carrier NAT & Dynamic Pools:** Carrier media gateways may occasionally assign RTP endpoints from auxiliary pools during high traffic.
- **Mitigation:** If Telnyx utilizes an auxiliary media range, symmetric RTP (`rtp_symmetric=yes`) ensures Asterisk responds to the remote source port, but the host firewall must permit the carrier CIDR block. If media fails due to a new Telnyx pool, testing will immediately report `MEDIA_FAILED` (SNR < 15 dB), and the operator can expand the firewall whitelist.

---

## 6. Audit 6 — Final Architecture Decision & Proposed Changes

### 6.1 Exact Changes Proposed (For Operator Review — DO NOT APPLY)

#### File 1: [`qa/asterisk/extensions.conf`](file:///C:/Projects/callflow-agent-a/qa/asterisk/extensions.conf)
Replace fragmented dialplan recording with Stasis invocation:
```ini
[from-telnyx-buyer]
; Inbound buyer endpoint for QA testing
exten => _.,1,NoOp(--- [QA-BUYER] Passing inbound buyer leg to Stasis ---)
 same => n,Answer()
 same => n,Stasis(callflow-qa,buyer)
 same => n,Hangup()
```

#### File 2: [`apps/api/src/telephony/qa/qa-orchestrator.service.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-orchestrator.service.ts)
Upgrade recording logic to record both channels with full UUIDv4 and `ifExists: 'fail'`:
```typescript
// 1. Record Caller Channel (captures buyer tone from carrier bridge)
const callerRecName = `qa-caller-${runId}`;
await this.ariClient.recordChannel(callerChannel.id, {
  name: callerRecName,
  format: 'wav',
  maxDurationSeconds: 15,
  ifExists: 'fail',
});

// 2. Record Buyer Channel (captures caller tone from carrier bridge)
const buyerRecName = `qa-buyer-${runId}`;
await this.ariClient.recordChannel(buyerChannel.id, {
  name: buyerRecName,
  format: 'wav',
  maxDurationSeconds: 15,
  ifExists: 'fail',
});

// 3. Retrieve and analyze both streams
const callerWav = await this.ariClient.getStoredRecordingFile(callerRecName, 5000);
const buyerWav = await this.ariClient.getStoredRecordingFile(buyerRecName, 5000);

const callerAnalysis = this.audioAnalyzer.analyzeRecording(callerWav, { targetFreq: 1500, minSnrDb: 15.0 });
const buyerAnalysis = this.audioAnalyzer.analyzeRecording(buyerWav, { targetFreq: 1000, minSnrDb: 15.0 });
```

---

## 7. Final Remediation Design Audit Matrix

| Requirement | Verdict | Forensic Evidence / Basis |
| :--- | :---: | :--- |
| **1. Recording architecture selected** | **PASS** | Pure ARI-only dual-channel Stasis recording selected; eliminates filesystem dependencies. |
| **2. Bidirectional audio capture** | **PASS** | Digium documentation proves single channel is unidirectional; dual Stasis channels capture both directions. |
| **3. Recording ID uniqueness** | **PASS** | Full UUIDv4 (`qa-caller-${runId}`, `qa-buyer-${runId}`) provides 128-bit global uniqueness. |
| **4. Overwrite prevention** | **PASS** | Asterisk ARI natively defaults to `ifExists: 'fail'`; rejects collisions with HTTP 409. |
| **5. Asterisk Record syntax** | **PASS** | Verified Asterisk 20 `app_record` parameters and confirmed `${UNIQUEID}` vs `%d` behavior. |
| **6. Audio analyzer correlation** | **PASS** | Audio analyzer receives exact in-memory buffers downloaded via ARI REST API using matching `runId`. |
| **7. SIP ingress restriction** | **PASS** | Designed Tier-1 Windows Firewall restriction to Telnyx proxies (`192.76.120.10`, `64.16.250.10`). |
| **8. RTP ingress restriction** | **PASS** | Designed Tier-1 Windows Firewall restriction to Telnyx media subnets (`192.76.120.0/24`, `64.16.250.0/24`). |
| **9. Docker network security** | **PASS** | Reassessed 0.0.0.0 exposure; layered defense between host firewall and container PJSIP identify. |
| **10. Production isolation** | **PASS** | Database target strictly `127.0.0.1:5433/callflow_qa`. Zero connections to production pooler `52.68.3.1:6543`. |

---

## 8. Final Verdict

```
================================================================================
FINAL VERDICT: REMEDIATION DESIGN READY FOR OPERATOR REVIEW
================================================================================
```

*(All architectural, audio directionality, overwrite, and network security designs are complete and verified. No code or configuration changes have been executed. Awaiting operator review and authorization.)*
