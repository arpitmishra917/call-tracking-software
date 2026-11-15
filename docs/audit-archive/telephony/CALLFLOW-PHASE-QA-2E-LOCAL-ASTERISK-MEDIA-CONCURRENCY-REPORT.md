# CALLFLOW — QA-2E: LOCAL ASTERISK MEDIA CONCURRENCY ACCEPTANCE REPORT

**Phase ID:** `CALLFLOW-PHASE-QA-2E`  
**Phase Name:** Local Asterisk Media Concurrency Verification  
**Owner:** Agent 4 — Telephony, Asterisk ARI, SIP, RTP & Recording Infrastructure  
**Mode:** LOCAL ISOLATED EXECUTION (ZERO CARRIER EGRESS)  
**Execution Timestamp:** 2026-11-15T00:46:56Z  
**Final Verdict:** **`PASS`**

---

## 1. Executive Summary

Phase QA-2E has successfully proven simultaneous local Asterisk call channels, independent bridges, bidirectional media flow, and isolated recording lifecycles without any live carrier interaction, PSTN egress, or Telnyx expenditure.

### Key Milestones Proven:
1. **At Least Two Simultaneous Independent Calls:** Established Call 1 (`Bridge 1`) and Call 2 (`Bridge 2`) concurrently inside Asterisk 20.21.0 via Local channel pairs (`Local/...;1` and `Local/...;2`).
2. **Correct & Non-Intersecting Bridge Membership:** 
   - Bridge 1 (`3b61d9e3-bc20-4a4b-b34c-ae75b65f78bd`): `[1794703616.38, 1794703616.40]`
   - Bridge 2 (`e786fc12-b1c9-4753-80ef-6d39b4137a7c`): `[1794703618.46, 1794703618.48]`
   - Bridge channel intersection: $\emptyset$ (Zero cross-connection).
3. **Bidirectional Media Flow Proven for Every Call:**
   - Call 1: Caller TX (700 Hz) verified at Buyer RX (`-23.2 dB`); Buyer TX (1000 Hz) verified at Caller RX (`-24.0 dB`).
   - Call 2: Caller TX (1400 Hz) verified at Buyer RX (`-22.3 dB`); Buyer TX (1800 Hz) verified at Caller RX (`-21.7 dB`).
4. **Zero Cross-Call Audio Contamination:** 
   - Call 1 recordings showed $> 71.0 \text{ dB}$ discrimination against Call 2 frequencies (1400/1800 Hz).
   - Call 2 recordings showed $> 77.9 \text{ dB}$ discrimination against Call 1 frequencies (700/1000 Hz).
5. **Independent Staggered Teardown:** Terminating Call 1 while Call 2 was active had zero impact on Call 2; Bridge 2 and Call 2 recordings continued uninterrupted until scheduled termination.
6. **Zero Orphaned Resources:** Post-test ARI audit confirmed 0 active channels and 0 active bridges.

---

## 2. Actual Commands Executed

1. **Preflight Environment Inspection:**
   ```bash
   node qa/preflight-qa-2e.mjs
   docker inspect callflow-asterisk-qa --format "{{json .Mounts}}"
   ```
2. **Multi-Frequency Marker Synthesis:**
   ```bash
   node qa/generate-test-markers.mjs
   ```
3. **Local Media Far-End Architecture Probe:**
   ```bash
   node qa/probe-local-far-end.mjs
   ```
4. **Full Concurrency Test Execution:**
   ```bash
   node qa/test-qa-2e-media-concurrency.mjs
   ```

---

## 3. Files Created or Changed

| File Path | Description / Action |
|---|---|
| [`qa/generate-test-markers.mjs`](file:///C:/Projects/callflow-agent-a/qa/generate-test-markers.mjs) | Generates mathematically pure 8000 Hz 16-bit PCM WAV markers (700, 1000, 1400, 1800 Hz). |
| [`qa/asterisk/sounds/qa-caller1-700hz.wav`](file:///C:/Projects/callflow-agent-a/qa/asterisk/sounds/qa-caller1-700hz.wav) | 700 Hz synthetic audio marker (3.0s, 48,044 bytes). |
| [`qa/asterisk/sounds/qa-buyer1-1000hz.wav`](file:///C:/Projects/callflow-agent-a/qa/asterisk/sounds/qa-buyer1-1000hz.wav) | 1000 Hz synthetic audio marker (3.0s, 48,044 bytes). |
| [`qa/asterisk/sounds/qa-caller2-1400hz.wav`](file:///C:/Projects/callflow-agent-a/qa/asterisk/sounds/qa-caller2-1400hz.wav) | 1400 Hz synthetic audio marker (3.0s, 48,044 bytes). |
| [`qa/asterisk/sounds/qa-buyer2-1800hz.wav`](file:///C:/Projects/callflow-agent-a/qa/asterisk/sounds/qa-buyer2-1800hz.wav) | 1800 Hz synthetic audio marker (3.0s, 48,044 bytes). |
| [`qa/test-qa-2e-media-concurrency.mjs`](file:///C:/Projects/callflow-agent-a/qa/test-qa-2e-media-concurrency.mjs) | Complete end-to-end local media concurrency test harness. |
| [`qa/evidence/qa-2e-concurrency-audit.json`](file:///C:/Projects/callflow-agent-a/qa/evidence/qa-2e-concurrency-audit.json) | Granular JSON audit evidence containing power spectra and isolation margins. |
| `qa/recordings/qa-2e/*.wav` | 6 retrieved forensic audio recordings (Bridge mix and RX snoops for both calls). |

---

## 4. Telephony Architecture: Local Far-End Injection Mechanics

A fundamental discovery resolved in this phase is the structural mechanics of Asterisk Local channels in Stasis:
```
[Far-End TX Channel (;2)]  ----(Transmits Audio)---->  [Bridge Leg Channel (;1)]
         │                                                      │
(Plays Synthetic Marker)                                  (Inside Mixing Bridge)
                                                                │
                                                         (Mixes Across Bridge)
                                                                │
                                                                ▼
                                                        [Peer Leg Channel (;1)]
                                                                │
                                                                ▼
                                                       [Snoop Channel 'spy: out']
                                                                │
                                                       (Records Received Audio)
```
- When `play` is issued to `;2` (the far-end leg), Asterisk treats it as ingress speech from the remote party.
- Audio traverses across the Local channel into `;1`, enters the mixing bridge, and reaches the peer leg.
- An attached Snoop channel with `spy: out` on `;1` captures strictly what the participant hears across the bridge.

---

## 5. Execution Test Results & Evidence

### 5.1 Call & Bridge Identity Evidence
- **Call 1:**
  - Bridge ID: `3b61d9e3-bc20-4a4b-b34c-ae75b65f78bd`
  - Caller Bridge Leg: `1794703616.38` (`Local/c1@from-telnyx-buyer-00000010;1`)
  - Caller Far-End TX: `1794703616.39` (`Local/c1@from-telnyx-buyer-00000010;2`)
  - Buyer Bridge Leg: `1794703616.40` (`Local/b1@from-telnyx-buyer-00000011;1`)
  - Buyer Far-End TX: `1794703616.41` (`Local/b1@from-telnyx-buyer-00000011;2`)
- **Call 2:**
  - Bridge ID: `e786fc12-b1c9-4753-80ef-6d39b4137a7c`
  - Caller Bridge Leg: `1794703618.48` (`Local/c2@from-telnyx-buyer-00000014;1`)
  - Caller Far-End TX: `1794703618.49` (`Local/c2@from-telnyx-buyer-00000014;2`)
  - Buyer Bridge Leg: `1794703618.46` (`Local/b2@from-telnyx-buyer-00000013;1`)
  - Buyer Far-End TX: `1794703618.47` (`Local/b2@from-telnyx-buyer-00000013;2`)

### 5.2 Concurrency Snapshot
- Active Bridges during simultaneous phase: **2**
- Active Channels during simultaneous phase: **12** (4 bridge legs + 4 far-end legs + 4 snoop channels)
- Bridge 1 Membership: `["1794703616.38", "1794703616.40"]`
- Bridge 2 Membership: `["1794703618.46", "1794703618.48"]`
- Cross-bridge channel leakage: **0 channels (Zero intersection)**

### 5.3 Audio Spectral & Isolation Metrics

| Recording ID / Role | Duration | Expected Tone(s) | Forbidden Tone(s) | Isolation Margin | Verdict |
|---|:---:|:---:|:---:|:---:|:---:|
| `qa2e-call1-bridge` (Call 1 Mix) | 4.36s | **700 Hz** (-23.4 dB)<br>**1000 Hz** (-23.9 dB) | **1400 Hz** (-97.2 dB)<br>**1800 Hz** (-103.6 dB) | **+73.3 dB** | **PASS** |
| `qa2e-call1-caller-rx` (Caller 1 RX) | 4.18s | **1000 Hz** (-24.0 dB) | **700 Hz** (-95.0 dB)<br>**1400 Hz** (-99.8 dB)<br>**1800 Hz** (-106.6 dB) | **+71.0 dB** | **PASS** |
| `qa2e-call1-buyer-rx` (Buyer 1 RX) | 4.22s | **700 Hz** (-23.2 dB) | **1000 Hz** (-97.7 dB)<br>**1400 Hz** (-106.5 dB)<br>**1800 Hz** (-111.3 dB) | **+74.5 dB** | **PASS** |
| `qa2e-call2-bridge` (Call 2 Mix) | 4.30s | **1400 Hz** (-21.9 dB)<br>**1800 Hz** (-21.9 dB) | **700 Hz** (-102.8 dB)<br>**1000 Hz** (-99.8 dB) | **+77.9 dB** | **PASS** |
| `qa2e-call2-caller-rx` (Caller 2 RX) | 4.24s | **1800 Hz** (-21.7 dB) | **1400 Hz** (-103.8 dB)<br>**700 Hz** (-110.5 dB)<br>**1000 Hz** (-108.6 dB) | **+82.0 dB** | **PASS** |
| `qa2e-call2-buyer-rx` (Buyer 2 RX) | 4.54s | **1400 Hz** (-22.3 dB) | **1800 Hz** (-106.6 dB)<br>**700 Hz** (-107.8 dB)<br>**1000 Hz** (-103.6 dB) | **+81.2 dB** | **PASS** |

### 5.4 Staggered Teardown & Resilience Proof
- At $T = 6.5\text{s}$, Call 1 was completely torn down (Bridge 1 deleted, 2 main channels + 2 far-end channels + 2 snoops destroyed).
- At $T = 7.5\text{s}$, ARI inspection confirmed:
  - Active bridges: **1** (`Bridge 2` intact)
  - Bridge 2 channels: `["1794703618.46", "1794703618.48"]` (Active and undamaged)
  - Proves that terminating Call 1 had **zero adverse effect** on Call 2.

### 5.5 Resource Release & Cleanup Audit
- Post-test ARI channel count: **0**
- Post-test ARI bridge count: **0**
- Post-test live recording count: **0**
- Orphaned channels/bridges: **None**

---

## 6. Acceptance Criteria Verification

- [x] **At least two simultaneous independent calls:** Verified (Call 1 & Call 2 ran simultaneously).
- [x] **Correct bridge membership for every call:** Verified (Bridge 1 & Bridge 2 had completely disjoint sets of channels).
- [x] **Bidirectional media proven independently for each call:** Verified (Both Caller RX and Buyer RX captured opposing leg markers at $\approx -23 \text{ dB}$).
- [x] **No cross-call audio contamination:** Verified (Cross-talk isolation margin exceeded $+71.0 \text{ dB}$ across all streams).
- [x] **Separate valid recordings:** Verified (6 independent WAV files captured, parsed, and validated).
- [x] **Correct termination and recording cleanup:** Verified (Staggered teardown executed without anomalies).
- [x] **No orphaned channels or bridges:** Verified (Post-test Asterisk state is clean and idle).

---

## 7. Final Verdict

### Categorical Verdict: **`PASS`**

Phase QA-2E objectives have been 100% satisfied. The Asterisk QA environment supports controlled multi-call concurrency, independent mixing bridges, bidirectional media routing, and isolated recording lifecycles with zero carrier expenditure.
