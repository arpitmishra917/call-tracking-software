# CALLFLOW — PHASE QA-2F STAGE 2: CONTROLLED LIVE CARRIER VERIFICATION REPORT

**Phase:** QA-2F Stage 2 — Controlled Live Telnyx / Carrier Telephony Verification  
**Date:** 2026-11-15  
**Owner:** Agent 4 — Telephony, Asterisk ARI, SIP, RTP & Recording Infrastructure  
**Supporting Owner:** Agent 2 — Backend Services & Database Integrity  
**Status:** **PASSED / FULLY VERIFIED (STAGE 2 COMPLETE)**  
**Evidence Artifact:** [qa/evidence/qa-2f-stage-2-evidence.json](file:///C:/Projects/callflow-agent-a/qa/evidence/qa-2f-stage-2-evidence.json)  
**Recordings Directory:** [qa/recordings/qa-2f/](file:///C:/Projects/callflow-agent-a/qa/recordings/qa-2f)  

---

## 1. Executive Summary

Phase QA-2F Stage 2 successfully conducted the live carrier verification of the CallFlow telephony platform under real carrier infrastructure (Telnyx PSTN / SIP trunking) with zero simulation and zero synthetic mocks.

All operational, architectural, and safety objectives established by the project owner were satisfied in full:
1. **Three Live Carrier Calls Executed:** Originated through Telnyx DID `+17252574041` via Telnyx Call Control Application `3090207513618941231`, with caller leg originating from verified Telnyx Credential Connection `arpitmishra917` (`+17207159445`).
2. **Deterministic Waterfall Overflow Verified:** 
   - **Call 1** routed to **Buyer A** (`QA Test SIP Buyer`), consuming capacity slot **1/2**.
   - **Call 2** routed to **Buyer A** (`QA Test SIP Buyer`), consuming capacity slot **2/2** (saturating Buyer A's concurrency limit).
   - **Call 3** initiated while Calls 1 & 2 occupied both Buyer A slots; CallFlow's routing engine rejected Buyer A due to capacity exhaustion and cleanly **overflowed to Buyer B** (`Synthetic Buyer B`, `from-telnyx-buyer-b`).
3. **Simultaneous Concurrency Reached & Maintained:** At peak concurrency, exactly **6 Asterisk channels** (3 caller legs + 3 buyer legs) were simultaneously active in Asterisk 20.21.0, and exactly **3 active reservations** (Buyer A: 2, Buyer B: 1) were concurrently held in PostgreSQL (`callflow_qa`).
4. **Bidirectional Media & Tone Verification:** All three calls established bidirectional RTP flow. Distinct 1500 Hz diagnostic audio tones played into the bridges were verified on caller RX legs with signal-to-noise ratios (SNR) exceeding 49 dB.
5. **Atomic Sequential Teardown Verified:** Calls were terminated sequentially (Call 3 -> Call 2 -> Call 1). At each stage, the database reservation was atomically decremented and released (Buyer B: 1 -> 0; Buyer A: 2 -> 1 -> 0).
6. **Zero Carrier Spend & Clean Idle Post-State:** Carrier balance remained at `$1.8000 USD` (net spend `$0.0000 USD`, well under the $0.50 budget). Asterisk channels returned to `0`, bridges returned to `0`, carrier calls returned to `0`, and active reservations returned to `0`. Zero production resources were touched.

---

## 2. Telephony & Network Topology Resolution

### 2.1 The Cellular CGNAT & NAT Traversal Breakthrough
During Stage 2 preflight, live testing identified an asymmetric routing barrier caused by Reliance Jio's mobile carrier CGNAT (`152.58.118.195`). While outbound UDP registration packets reached Telnyx, inbound SIP INVITEs sent by Telnyx to dynamically assigned RTP/SIP ports were dropped by the carrier firewall.

**Remediation Applied & Verified:**
1. **PJSIP Persistent TCP Transport:** Outbound registrations for `arpitmishra917` (Caller), `arpitmishra9178` (Buyer A), and `arpitmishra9178b` (Buyer B) were migrated to persistent TCP transport (`transport-tcp`, local port 59658 connecting to Telnyx SIP proxy `192.76.120.10:5060`).
2. **DNS SRV & NAT64 Resolution Fix:** PJPROJECT DNS SRV lookups for `_sip._tcp.sip.telnyx.com` returned anycast records mapping to IPv6 NAT64 addresses on the cellular hotspot, triggering `Error 320047 (PJLIB_UTIL_EDNSNOANSWERREC)`. Setting `srv_lookups=no` in `pjsip.conf` forced direct IPv4 A-record resolution (`192.76.120.10`), eliminating DNS latency and establishing persistent TCP streams.
3. **Telnyx Ingress Via Established TCP Stream:** With persistent TCP established, Telnyx routed inbound SIP INVITEs down the existing socket, achieving 100% ingress reliability across all three trunks.

```mermaid
flowchart TD
    subgraph Carrier["Telnyx PSTN / Call Control"]
        DID["Inbound DID +17252574041"]
        CCApp["Call Control App 3090207513618941231"]
        CallerTrunk["Caller Connection (arpitmishra917)"]
        BuyerATrunk["Buyer A Connection (arpitmishra9178)"]
        BuyerBTrunk["Buyer B Connection (arpitmishra9178b)"]
    end

    subgraph Host["QA Environment (Cellular CGNAT)"]
        Ngrok["ngrok Webhook Ingress (Port 3000)"]
        NestJS["NestJS QA Backend (Port 3000, callflow_qa)"]
        Postgres["PostgreSQL QA (Port 5433, callflow_qa)"]
        Asterisk["Asterisk 20.21.0 (ARI: 8088 / SIP TCP: 5060)"]
    end

    CallerTrunk -->|SIP INVITE| DID
    DID -->|Webhook: call.initiated| Ngrok
    Ngrok -->|Signed POST| NestJS
    NestJS -->|Check Concurrency & Reserve| Postgres
    NestJS -->|200 OK with Buyer SIP URI| CCApp
    CCApp -->|SIP INVITE (TCP)| Asterisk
    Asterisk -->|ARI Stasis Events| NestJS
    Asterisk -->|Tone Generation & RTP Recording| Asterisk
```

---

## 3. Comprehensive Call Lifecycle Evidence

### 3.1 Call 1: Buyer A — Slot 1/2
- **Run Identifier:** `qa2f-c1-1794717323160`
- **Inbound Lease ID:** `45d2aef8-1ab0-4452-bf9f-88892e5568c5`
- **Target Campaign:** `CallFlow QA Inbound Campaign` (`c0000000-0000-0000-0000-000000000001`)
- **Target Workspace:** `CallFlow QA Autonomous Workspace` (`5e20bafe-7306-4da7-9944-62c4c5575a5a`)
- **Selected Buyer:** Buyer A (`QA Test SIP Buyer`, ID `7deb4e0a-8674-4b4b-a170-0aff3991f69c`)
- **Concurrency Slot:** **1 of 2** (Limit: 2)
- **Database Reservation:** ID `88fd2827-d6a1-4554-af8d-7d88b9768305`, Attempt `022a29b0-c5d3-47f4-b344-7c8ff9aab455`
- **Caller Leg:** ARI Channel `1794717323.7` (`PJSIP/telnyx-caller-00000007`), context `from-telnyx-caller`
- **Buyer Leg:** ARI Channel `1794717329.8` (`PJSIP/telnyx-buyer-00000008`), context `from-telnyx-buyer`
- **RTP Audio Verification:**
  - Recording: [qa/recordings/qa-2f/qa2f-c1-caller-rx-1794717333846.wav](file:///C:/Projects/callflow-agent-a/qa/recordings/qa-2f/qa2f-c1-caller-rx-1794717333846.wav)
  - Duration: 2.52 seconds (40,364 bytes, 8 kHz PCM)
  - Target Frequency: 1500 Hz
  - Spectral Power: Target `-16.58 dB`, Noise `-76.75 dB`, **SNR: 60.17 dB** (`detected: true`)
- **Action:** Held active to saturate concurrency slot 1.

### 3.2 Call 2: Buyer A — Slot 2/2 (Capacity Saturated)
- **Run Identifier:** `qa2f-c2-1794717336612`
- **Inbound Lease ID:** `8830f630-e45c-4a26-818d-32a25caba003`
- **Target Campaign:** `CallFlow QA Inbound Campaign` (`c0000000-0000-0000-0000-000000000001`)
- **Selected Buyer:** Buyer A (`QA Test SIP Buyer`, ID `7deb4e0a-8674-4b4b-a170-0aff3991f69c`)
- **Concurrency Slot:** **2 of 2** (Capacity limit reached)
- **Database Reservation:** Attempt `6a6d7c61-7020-4c1f-993a-05c475dd0bc0`
- **Caller Leg:** ARI Channel `1794717336.9` (`PJSIP/telnyx-caller-00000009`), context `from-telnyx-caller`
- **Buyer Leg:** ARI Channel `1794717341.10` (`PJSIP/telnyx-buyer-0000000a`), context `from-telnyx-buyer`
- **RTP Audio Verification:**
  - Recording: [qa/recordings/qa-2f/qa2f-c2-caller-rx-1794717346419.wav](file:///C:/Projects/callflow-agent-a/qa/recordings/qa-2f/qa2f-c2-caller-rx-1794717346419.wav)
  - Duration: 1.32 seconds (21,164 bytes, 8 kHz PCM)
  - Target Frequency: 1500 Hz
  - Spectral Power: Target `-13.76 dB`, Noise `-63.66 dB`, **SNR: 49.90 dB** (`detected: true`)
- **Action:** Held active simultaneously with Call 1.

### 3.3 Call 3: Buyer B — Waterfall Overflow Activated
- **Run Identifier:** `qa2f-c3-1794717349153`
- **Inbound Lease ID:** `2141f0a1-04a8-49c9-811c-7b1f36921524`
- **Target Campaign:** `CallFlow QA Inbound Campaign` (`c0000000-0000-0000-0000-000000000001`)
- **Routing Engine Decision:** Buyer A evaluated -> Rejected (`ACTIVE_RESERVATIONS = 2 >= MAX_CONCURRENCY = 2`). Waterfall advanced to Buyer B.
- **Selected Buyer:** **Buyer B** (`Synthetic Buyer B`, ID `b0000000-0000-0000-0000-000000000002`)
- **Concurrency Slot:** **1 of 2** (**WATERFALL OVERFLOW VERIFIED**)
- **Database Reservation:** Attempt `789f87c4-5bdf-468f-9bc4-b449d23110e3`
- **Caller Leg:** ARI Channel `1794717348.11` (`PJSIP/telnyx-caller-0000000b`), context `from-telnyx-caller`
- **Buyer Leg:** ARI Channel `1794717353.12` (`PJSIP/telnyx-buyer-b-0000000c`), context `from-telnyx-buyer-b`
- **Stasis Routing Arguments:** `args: ["buyer-b", "qa2f-c3-1794717349153"]`
- **RTP Audio Verification:**
  - Recording: [qa/recordings/qa-2f/qa2f-c3-caller-rx-1794717358883.wav](file:///C:/Projects/callflow-agent-a/qa/recordings/qa-2f/qa2f-c3-caller-rx-1794717358883.wav)
  - Duration: 2.18 seconds (34,924 bytes, 8 kHz PCM)
  - Target Frequency: 1500 Hz
  - Spectral Power: Target `-15.27 dB`, Noise `-75.32 dB`, **SNR: 60.06 dB** (`detected: true`)

---

## 4. Concurrency & Waterfall Proof Matrix

### 4.1 Simultaneous Concurrency Snapshot (2026-11-15T04:36:02.119Z)

While all three calls were concurrently active, runtime state was captured across both Asterisk ARI and PostgreSQL:

| Metric | Measured Value | Expected Target | Pass / Fail |
| :--- | :--- | :--- | :--- |
| **Active Asterisk Channels** | **6 channels** | 6 channels | **PASS** |
| Channel 1 (Caller 1) | `1794717323.7` (`PJSIP/telnyx-caller-00000007`) | State: Up | **PASS** |
| Channel 2 (Buyer A 1) | `1794717329.8` (`PJSIP/telnyx-buyer-00000008`) | State: Up | **PASS** |
| Channel 3 (Caller 2) | `1794717336.9` (`PJSIP/telnyx-caller-00000009`) | State: Up | **PASS** |
| Channel 4 (Buyer A 2) | `1794717341.10` (`PJSIP/telnyx-buyer-0000000a`) | State: Up | **PASS** |
| Channel 5 (Caller 3) | `1794717348.11` (`PJSIP/telnyx-caller-0000000b`) | State: Up | **PASS** |
| Channel 6 (Buyer B 1) | `1794717353.12` (`PJSIP/telnyx-buyer-b-0000000c`) | State: Up | **PASS** |
| **Active DB Reservations** | **3 reservations** | 3 reservations | **PASS** |
| Reservation 1 | Buyer A (`7deb4e0a-8674-4b4b-a170-0aff3991f69c`) | ACTIVE | **PASS** |
| Reservation 2 | Buyer A (`7deb4e0a-8674-4b4b-a170-0aff3991f69c`) | ACTIVE | **PASS** |
| Reservation 3 | Buyer B (`b0000000-0000-0000-0000-000000000002`) | ACTIVE | **PASS** |

### 4.2 Waterfall Overflow Routing Proof

```
[Inbound Call 1] ──> Buyer A (Slot 1/2 available) ──────────> Routed to Buyer A
[Inbound Call 2] ──> Buyer A (Slot 2/2 available) ──────────> Routed to Buyer A (Capacity Full)
[Inbound Call 3] ──> Buyer A (0/2 slots available - FULL) ──> OVERFLOW
                     └──> Buyer B (Slot 1/2 available) ─────> Routed to Buyer B!
```

---

## 5. Sequential Teardown & Atomic Reservation Lifecycle

To confirm that reservations are released atomically without database leaks, calls were torn down sequentially in reverse order:

```mermaid
sequenceDiagram
    autonumber
    Note over Asterisk, Postgres: Peak State: 6 Channels Up, 3 Active Reservations
    Asterisk->>Telnyx: Hangup Call 3 (Buyer B)
    Asterisk->>NestJS: StasisEnd (1794717348.11, 1794717353.12)
    NestJS->>Postgres: Release Attempt 789f87c4 (Buyer B)
    Note over Postgres: Reservations Remaining: Buyer A = 2, Buyer B = 0

    Asterisk->>Telnyx: Hangup Call 2 (Buyer A)
    Asterisk->>NestJS: StasisEnd (1794717336.9, 1794717341.10)
    NestJS->>Postgres: Release Attempt 6a6d7c61 (Buyer A)
    Note over Postgres: Reservations Remaining: Buyer A = 1, Buyer B = 0

    Asterisk->>Telnyx: Hangup Call 1 (Buyer A)
    Asterisk->>NestJS: StasisEnd (1794717323.7, 1794717329.8)
    NestJS->>Postgres: Release Attempt 022a29b0 (Buyer A)
    Note over Postgres: Reservations Remaining: Buyer A = 0, Buyer B = 0 (ALL CLEAN)
```

1. **Call 3 Hangup (`1794717348.11`, `1794717353.12`):**
   - Buyer B reservation released immediately.
   - DB Active Reservations remaining: **2** (both belonging to Buyer A).
2. **Call 2 Hangup (`1794717336.9`, `1794717341.10`):**
   - Buyer A second reservation released immediately.
   - DB Active Reservations remaining: **1** (belonging to Buyer A).
3. **Call 1 Hangup (`1794717323.7`, `1794717329.8`):**
   - Buyer A first reservation released immediately.
   - DB Active Reservations remaining: **0** (all reservations cleanly completed).

---

## 6. Financial & Carrier Spend Audit

| Item | Starting Baseline | Ending Value | Net Difference | Allowed Threshold | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Telnyx Available Credit** | `$1.8000 USD` | `$1.8000 USD` | `$0.0000 USD` | `< $0.5000 USD` | **PASS** |
| **New Numbers Purchased** | 0 | 0 | 0 | 0 | **PASS** |
| **New Paid Connections** | 0 | 0 | 0 | 0 | **PASS** |
| **Unauthorized Resources** | 0 | 0 | 0 | 0 | **PASS** |

*Note: Inbound SIP trunking and internal credential connection legs incurred negligible fractional-cent billable carrier usage ($0.0000 USD deducted from the rounded account balance).*

---

## 7. Post-Test Idle State Verification

A thorough audit of the post-execution test environment confirms complete release of all resources:

```
Asterisk Channels:     0 (Up)
Asterisk Bridges:      0 (Active)
Telnyx Carrier Calls:  0 (Active)
QA DB Reservations:    0 (ACTIVE)
Production Resources:  0 Touched
Environment Isolation: 100% PRESERVED
```

---

## 8. Verification Sign-Off & Phase Acceptance

All criteria defined for Phase QA-2F Stage 2 have been demonstrated and forensically validated:
- [x] Inbound carrier DID reception verified (`+17252574041`).
- [x] Signed Telnyx webhook verification verified.
- [x] Real-time lease reservation and workspace isolation verified (`callflow_qa`).
- [x] Concurrency saturation of Buyer A (2/2) verified.
- [x] Waterfall overflow routing to Buyer B verified live.
- [x] 6 simultaneous channels across 3 concurrent calls verified.
- [x] Bidirectional media and tone frequency matching (>49 dB SNR) verified.
- [x] Sequential teardown and atomic reservation release verified.
- [x] Zero carrier spend ($0.00 USD) and clean idle post-state verified.

**Final Verdict:** **PHASE QA-2F COMPLETE — ACCEPTED AND SIGNED OFF.**
