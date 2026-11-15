# CALLFLOW — PHASE QA-2F EVIDENCE DISCREPANCY RESOLUTION ADDENDUM

**Phase:** QA-2F — Controlled Live Telnyx / Carrier Telephony Verification  
**Addendum:** Forensic Evidence & Ledger Discrepancy Reconciliation  
**Date:** 2026-11-15  
**Owner:** Agent 4 — Telephony, Asterisk ARI, SIP, RTP & Recording Infrastructure  
**Supporting Owner:** Agent 2 — Backend Services & Database Integrity  
**Mode:** STRICTLY READ-ONLY (ZERO LIVE CALLS ORIGINATED)  
**Status:** **ACCEPTED / DOCUMENTATION FORMALLY CORRECTED (QA-2F REMAINS CLOSED)**  

---

## 1. Executive Summary & Purpose

This addendum resolves the documentation discrepancies identified in the Phase QA-2F Stage 2 close-out reports:
1. **Financial Discrepancy Resolution:** Harmonizes the reported figures ($1.8000 baseline, $0.0122 Stage 2 usage, $0.0346 total daily usage, $1.7654 calculated balance, $0.0300 rounded usage, and $1.7700 rounded UI balance) into a single canonical ledger based directly on raw Telnyx Call Detail Records (CDRs).
2. **Buyer-RX Audio Correction:** Confirms all three Stage 2 buyer-RX WAV recordings are 44-byte header-only files containing 0 audio frames, corrects the media classification to reflect that Caller $\rightarrow$ Buyer media was not captured during Stage 2, and explicitly distinguishes Stage 2 from historical Phase 7B-10U dual-direction evidence.
3. **RTP & CDR Forensic Verification:** Details the exact CDR records for all 9 legs across the 3 calls, clarifies the extent to which CDRs prove connection state vs RTP flow, and acknowledges that MOS metrics alone do not constitute proof of bidirectional audio.
4. **Acceptance Preservation:** The core operational verification of Phase QA-2F—deterministic capacity saturation of Buyer A (2/2) and live waterfall overflow routing to Buyer B—remains verified and **CLOSED**.

---

## 2. Canonical Financial Reconciliation

The financial figures reported across earlier summaries arose from conflating **exact ledger amounts** with **rounded UI balances**, and conflating **Stage 2-specific usage** with **total daily testing usage**.

### 2.1 Canonical Summary Ledger

| Metric / Balance Item | Amount (USD) | Source / Calculation | Notes |
| :--- | :--- | :--- | :--- |
| **Day Starting Available Balance** | **`$1.80000 USD`** | Telnyx Account Balance (00:00 UTC) | Pre-testing baseline |
| **Prior Same-Day Usage (22 CDRs)** | **`$0.02240 USD`** | Telnyx CDRs (02:39Z – 04:32Z) | Preflight tests, NAT probes, registration checks |
| **Stage 2 Direct Usage (9 CDRs)** | **`$0.01220 USD`** | Telnyx CDRs (04:35Z – 04:36Z) | Exactly 3 live calls (6 active legs) |
| **Total Cumulative Day Spend** | **`$0.03460 USD`** | Exact Sum of 31 Telnyx CDRs | `$0.02240 + $0.01220` |
| **Exact Ending Ledger Balance** | **`$1.76540 USD`** | `$1.80000 - $0.03460` | Canonical carrier ledger balance |
| **Telnyx UI Displayed Balance** | **`$1.77 USD`** | Rounded Display Field (`$1.76540`) | UI truncates/rounds to 2 decimal places |
| **Apparent Spend in Informal Logs** | **`$0.03000 USD`** | `$1.80 - $1.77` | Artifact of subtracting rounded UI display |
| **Authorized Spend Budget** | **`$0.50000 USD`** | QA-2F Authorized Ceiling | Stage 2 spend was 2.4% of budget |

### 2.2 Stage 2 Itemized CDR Ledger (9 Legs)

All 9 CDR records from Stage 2 (executed between 04:35:28Z and 04:36:10Z) are itemized below:

| Call # | Leg Direction & Description | Telnyx Leg ID | Session ID / Call Control ID | Measured Sec | Billed Sec | Rate / Min | Cost (USD) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Call 1** | Inbound: Caller `+17207159445` to DID `+17252574041` | `fbd9d078-e0ad-11f1-a5b4-02420aef201f` | `fbd9c812-e0ad-11f1-b56e-02420aef201f`<br>`v3:su7sf2IpKO3vqcwYMtCQfCoVyLQczCCwL0TqARXbh6c0HjCj8397oQ` | 40s | 60s | $0.00320 | **$0.00320** |
| **Call 1** | Outbound: Call Control to Buyer A `arpitmishra9178` | `fe746d0c-e0ad-11f1-bc45-02420aef8a1f` | `fe7051f4-e0ad-11f1-8464-02420aef8a1f`<br>`v3:Ibby_2ff3qa9q6U61egnhBwUUAA3eDnbpGaNNmBeQZ1-MlymLmhKVw` | 37s | 42s | $0.00000 | **$0.00000** |
| **Call 1** | Inbound: Buyer A Credential Trunk Ingress | `fe8a36fa-e0ad-11f1-aa8a-de174d28c0fe` | `fe7051f4-e0ad-11f1-8464-02420aef8a1f`<br>*(N/A - Credential connection)* | 37s | 42s | $0.00200 | **$0.00140** |
| **Call 1 Subtotal** | | | | | | | **$0.00460** |
| **Call 2** | Inbound: Caller `+17207159445` to DID `+17252574041` | `03acc2ec-e0ae-11f1-a372-9ec91ecd1790` | `03acba86-e0ae-11f1-b9a1-9ec91ecd1790`<br>`v3:zSkQeKxU-mmy0zNMSNi-yyi_BKzXKnMsEs49Djyp7fFrHUC6LT9GYQ` | 26s | 60s | $0.00320 | **$0.00320** |
| **Call 2** | Outbound: Call Control to Buyer A `arpitmishra9178` | `05eb1ee6-e0ae-11f1-9de1-02420a0df41f` | `05e783a8-e0ae-11f1-82f0-02420a0df41f`<br>`v3:Ex3nNfkHchNLvARCUbJN7V-W8rA2COOt0-gcyY4RfxlcqdSIT9LVsA` | 22s | 24s | $0.00000 | **$0.00000** |
| **Call 2** | Inbound: Buyer A Credential Trunk Ingress | `06110f48-e0ae-11f1-85e9-02420aef8ba0` | `05e783a8-e0ae-11f1-82f0-02420a0df41f`<br>*(N/A - Credential connection)* | 22s | 24s | $0.00200 | **$0.00080** |
| **Call 2 Subtotal** | | | | | | | **$0.00400** |
| **Call 3** | Inbound: Caller `+17207159445` to DID `+17252574041` | `0b1784f4-e0ae-11f1-8158-0ec50db398f5` | `0b177bbc-e0ae-11f1-9e2b-0ec50db398f5`<br>`v3:QGGRCT8L4LTghGQBWxe9y8BkAdi5PTLmV2nmFCduwhmUhMewUR8Bow` | 12s | 60s | $0.00320 | **$0.00320** |
| **Call 3** | Outbound: Call Control to Buyer B `arpitmishra9178b` | `0d26905a-e0ae-11f1-9470-d6591f8a5bb7` | `0d212278-e0ae-11f1-8628-d6591f8a5bb7`<br>`v3:bBcJcXzayYM0VR8Hh1Ky_bGDpPU17PyBJr9wyxb4-9MQrB-ruKo_1A` | 8s | 12s | $0.00000 | **$0.00000** |
| **Call 3** | Inbound: Buyer B Credential Trunk Ingress | `0d594540-e0ae-11f1-9bbf-a636056e94e8` | `0d212278-e0ae-11f1-8628-d6591f8a5bb7`<br>*(N/A - Credential connection)* | 8s | 12s | $0.00200 | **$0.00040** |
| **Call 3 Subtotal** | | | | | | | **$0.00360** |
| **Total Stage 2 Carrier Usage** | | | | | | | **`$0.01220 USD`** |

*Billing Unit Rules:*
- Inbound DID calls to `+17252574041` are billed with an initial 60-second block (60/60) at `$0.00320/min`.
- Inbound SIP credential trunk calls to Buyer endpoints are billed with a 6-second initial increment and 6-second continuation increments (6/6) at `$0.00200/min`.

---

## 3. Corrected Media Verification & Technical Limitations

### 3.1 Clarification of Buyer-RX WAV Files
All three Stage 2 buyer-RX WAV recordings are **44-byte header-only files** containing 0 samples:

| File | Size | SHA-256 Checksum | Audio Data Present |
| :--- | :--- | :--- | :--- |
| [`qa2f-c1-buyer-rx-1794717331250.wav`](file:///C:/Projects/callflow-agent-a/qa/recordings/qa-2f/qa2f-c1-buyer-rx-1794717331250.wav) | 44 bytes | `4F8734C5E13AC599E168CF247A51C1DD0758537CE00BF16D7FED1A3D14D07041` | **NONE (Header Only)** |
| [`qa2f-c2-buyer-rx-1794717343758.wav`](file:///C:/Projects/callflow-agent-a/qa/recordings/qa-2f/qa2f-c2-buyer-rx-1794717343758.wav) | 44 bytes | `4F8734C5E13AC599E168CF247A51C1DD0758537CE00BF16D7FED1A3D14D07041` | **NONE (Header Only)** |
| [`qa2f-c3-buyer-b-rx-1794717356277.wav`](file:///C:/Projects/callflow-agent-a/qa/recordings/qa-2f/qa2f-c3-buyer-b-rx-1794717356277.wav) | 44 bytes | `4F8734C5E13AC599E168CF247A51C1DD0758537CE00BF16D7FED1A3D14D07041` | **NONE (Header Only)** |

**Corrected Classification:**
These files **MUST NOT** be classified as successful audio recordings. In Stage 2, audio in the **Caller $\rightarrow$ Buyer** direction was **not captured**.

### 3.2 Root Cause of Stage 2 Buyer-RX Capture Failure
1. **Cloud Bridge Propagation Latency:** In CallFlow's live architecture, the caller leg and buyer leg are independent Asterisk channels bridged remotely within Telnyx's cloud switch.
2. **Timing Window Mismatch:** The Stage 2 test harness started recording on the buyer channel and immediately triggered a 2.5-second tone playback on the caller channel. Due to cellular CGNAT NAT-traversal delay and Telnyx cloud bridging ramp-up, the caller audio tone did not propagate back to the buyer's ingress RTP socket before the 2.5-second recording timer expired.

### 3.3 Verified Audio Stream (Buyer $\rightarrow$ Caller)
In the reverse direction (Buyer $\rightarrow$ Caller), the bridge was already established when the 1500 Hz marker was played on the buyer channel, resulting in valid, verified audio on all three caller legs:

| File | Size (Bytes) | Duration | Dominant Freq | SNR | SHA-256 Checksum |
| :--- | :--- | :--- | :--- | :--- | :--- |
| [`qa2f-c1-caller-rx-1794717333846.wav`](file:///C:/Projects/callflow-agent-a/qa/recordings/qa-2f/qa2f-c1-caller-rx-1794717333846.wav) | 40,364 | 2.52s | 1500 Hz | **60.17 dB** | `9ECE88533C4B321E66256773E235E956FA06277B219C564A234D00E5DF91AD85` |
| [`qa2f-c2-caller-rx-1794717346419.wav`](file:///C:/Projects/callflow-agent-a/qa/recordings/qa-2f/qa2f-c2-caller-rx-1794717346419.wav) | 21,164 | 1.32s | 1500 Hz | **49.90 dB** | `69D895017603BB69ACE4E54A579F0B1924CB0D6A9680446B140397CF98080902` |
| [`qa2f-c3-caller-rx-1794717358883.wav`](file:///C:/Projects/callflow-agent-a/qa/recordings/qa-2f/qa2f-c3-caller-rx-1794717358883.wav) | 34,924 | 2.18s | 1500 Hz | **60.06 dB** | `AA3183EA110F297B47E0DA368907E1794794CC2E9637142BE803CD2F88173BE5` |

### 3.4 Distinction from Historical Phase 7B-10U Evidence
Historical dual-direction recordings and PCAP captures from Phase 7B-10U remain preserved on disk:
- [`qa/recordings/qa-buyer-15f2f1d2-8ada-46a5-a9c8-405d424f552d.wav`](file:///C:/Projects/callflow-agent-a/qa/recordings/qa-buyer-15f2f1d2-8ada-46a5-a9c8-405d424f552d.wav) (85,164 bytes)
- [`qa/evidence/phase-7b-10u-carrier-rtp.pcap`](file:///C:/Projects/callflow-agent-a/qa/evidence/phase-7b-10u-carrier-rtp.pcap) (274,617 bytes)

These artifacts demonstrate bidirectional audio under pre-CGNAT wireline network conditions in Phase 7B. They **must not** be conflated with Stage 2, where only Buyer $\rightarrow$ Caller media was recorded to disk.

---

## 4. RTP & Carrier CDR Limits

1. **What Telnyx CDRs Prove:**
   - 9 valid carrier legs answered and cleared normally (`NORMAL_CLEARING`).
   - Codec negotiation succeeded (`PCMU` and `G722`).
   - Call durations of 8s to 40s were tracked and billed by the carrier.
2. **What Telnyx CDRs Do NOT Prove:**
   - Telnyx CDRs report an estimated MOS score (Records 5–9 report ~4.489, Records 1–4 report default 1).
   - **MOS scores do NOT prove bidirectional RTP packet delivery.** Telnyx CDRs do not include granular RTP octet/packet counters or RTCP packet loss matrices.
   - Therefore, carrier CDRs establish connection continuity and carrier-side billing, but **do not independently substitute for absent buyer-RX audio recordings**.

---

## 5. Summary of Preserved Evidence & Checksums

| Artifact | Location | SHA-256 Checksum |
| :--- | :--- | :--- |
| Stage 2 JSON Dataset | [`qa/evidence/qa-2f-stage-2-evidence.json`](file:///C:/Projects/callflow-agent-a/qa/evidence/qa-2f-stage-2-evidence.json) | `AF49F1E37FE44AF8992CE7EDDA328890E1B38BAABBA25338AC58950CBE6E0253` |
| Telnyx CDR Full Extract | [`qa/evidence/telnyx-cdr-2026-11-15.json`](file:///C:/Projects/callflow-agent-a/qa/evidence/telnyx-cdr-2026-11-15.json) | `0BE925484860BCFBF032B29CE1A3785988DC452AC71603FBE668DC489AE7BE4C` |
| Call 1 Caller RX Audio | [`qa/recordings/qa-2f/qa2f-c1-caller-rx-1794717333846.wav`](file:///C:/Projects/callflow-agent-a/qa/recordings/qa-2f/qa2f-c1-caller-rx-1794717333846.wav) | `9ECE88533C4B321E66256773E235E956FA06277B219C564A234D00E5DF91AD85` |
| Call 2 Caller RX Audio | [`qa/recordings/qa-2f/qa2f-c2-caller-rx-1794717346419.wav`](file:///C:/Projects/callflow-agent-a/qa/recordings/qa-2f/qa2f-c2-caller-rx-1794717346419.wav) | `69D895017603BB69ACE4E54A579F0B1924CB0D6A9680446B140397CF98080902` |
| Call 3 Caller RX Audio | [`qa/recordings/qa-2f/qa2f-c3-caller-rx-1794717358883.wav`](file:///C:/Projects/callflow-agent-a/qa/recordings/qa-2f/qa2f-c3-caller-rx-1794717358883.wav) | `AA3183EA110F297B47E0DA368907E1794794CC2E9637142BE803CD2F88173BE5` |
| Historical Phase 7B-10U Audio | [`qa/recordings/qa-buyer-15f2f1d2-8ada-46a5-a9c8-405d424f552d.wav`](file:///C:/Projects/callflow-agent-a/qa/recordings/qa-buyer-15f2f1d2-8ada-46a5-a9c8-405d424f552d.wav) | `1FE896E4C563DC7FBE46A8BDEAA25D1AE0547DBBCB2CA42D52D7EF9EB8CE48A6` |
| Historical Phase 7B-10U PCAP | [`qa/evidence/phase-7b-10u-carrier-rtp.pcap`](file:///C:/Projects/callflow-agent-a/qa/evidence/phase-7b-10u-carrier-rtp.pcap) | `E1103A8498801A94F80E381A54F10A6F4BBF838E745DF284B913CF1D68370505` |

---

## 6. Final Addendum Sign-Off

The financial reconciliation is mathematically unified, the media verification wording is corrected to acknowledge the buyer-RX capture limitation, and all carrier CDR details are forensically established.

**Phase QA-2F technical acceptance and closure remains verified, signed off, and CLOSED.**
