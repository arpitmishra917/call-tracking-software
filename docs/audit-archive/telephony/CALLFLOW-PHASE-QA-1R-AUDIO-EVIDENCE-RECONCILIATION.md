# CallFlow Phase QA-1R: Audio Evidence & Speech Intelligibility Reconciliation

**Document ID:** `CALLFLOW-PHASE-QA-1R-AUDIO-EVIDENCE-RECONCILIATION`  
**Phase:** CALLFLOW-PHASE-QA-1R (Evidence Reconciliation & Safety Boundary Clarification)  
**Author:** Agent 4 — Telephony, Asterisk ARI, SIP, RTP & Recording Infrastructure  
**Supporting Agents:** Agent 2 (Backend), Agent 3 (Web UI)  
**Mode:** STRICT READ-ONLY FORENSIC RECONCILIATION  
**Repository Working Copy:** [`CALLFLOW-PHASE-QA-1R-AUDIO-EVIDENCE-RECONCILIATION.md`](file:///C:/Projects/callflow-agent-a/CALLFLOW-PHASE-QA-1R-AUDIO-EVIDENCE-RECONCILIATION.md)  

---

## 1. Executive Summary

During Phase 7B-10U, dual-leg audio recordings and network packet captures (PCAP) were gathered from an authorized live carrier call over Telnyx trunks.

This reconciliation provides a forensic re-examination of the audio data to establish:
1. Exactly what has been proven with mathematical certainty.
2. The fundamental technical boundary between in-band tone discrimination and human speech intelligibility.
3. The specific scientific requirements and testing methodology needed to certify conversational speech quality.

---

## 2. Rigorous Breakdown of Proven vs. Unproven Audio Attributes

A forensic evaluation of the binary recordings (`qa-caller-15f2f1d2-8ada-46a5-a9c8-405d424f552d.wav` and `qa-buyer-15f2f1d2-8ada-46a5-a9c8-405d424f552d.wav`), the raw packet capture (`phase-7b-10u-carrier-rtp.pcap`), and the Goertzel DFT analysis yields the following classifications:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        AUDIO VERIFICATION MATURITY SPECTRUM                            │
├─────────────────────┬──────────────────────┬─────────────────────┬─────────────────────┤
│ Level 1: Network &  │ Level 2: In-Band Raw │ Level 3: Dual-Leg   │ Level 4: Conversa-  │
│ Signaling Presence  │ Acoustic Energy      │ Frequency Isolation │ tional Speech PESQ  │
├─────────────────────┼──────────────────────┼─────────────────────┼─────────────────────┤
│ Bridge: PROVEN      │ Silence: PROVEN      │ Caller->Buyer:PROVEN│ Intelligibility:    │
│ RTP Pkts: PROVEN    │ Clipping: PROVEN     │ Buyer->Caller:PROVEN│ NOT PROVEN          │
│ Codec: G.711u PROVEN│ Integrity: PROVEN    │ SNR: +48 dB PROVEN  │ (Requires ITU-T)    │
└─────────────────────┴──────────────────────┴─────────────────────┴─────────────────────┘
```

### Detailed Attribute Evaluation Table:

| Audio Evaluation Dimension | Empirical Finding | Measurement / Metric | Status |
| :--- | :--- | :--- | :---: |
| **1. Bridge Existence** | Telnyx bridged caller leg and buyer leg into full-duplex media session | 4 active RTP streams confirmed between Telnyx carrier IPs (`50.114.148.118`, `50.114.146.93`) and Asterisk | **PROVEN** |
| **2. RTP Packet Presence** | Real PCMU (PT 0) audio packets traversed the public network in both directions | 752 total packets; 660 RTP packets across 4 streams (113 Caller TX, 295 Caller RX, 107 Buyer TX, 145 Buyer RX) | **PROVEN** |
| **3. Caller-to-Buyer Signal** | Caller TX (1000 Hz) reached Buyer RX Snoop recording | Buyer WAV contains 1000 Hz tone dominant by **39,711x** over 1500 Hz | **PROVEN** |
| **4. Buyer-to-Caller Signal** | Buyer TX (1500 Hz) reached Caller RX Snoop recording | Caller WAV contains 1500 Hz tone dominant by **396,924x** over 1000 Hz | **PROVEN** |
| **5. Signal-to-Noise Ratio (SNR)** | Target frequencies measured via windowed Goertzel DFT | Buyer RX SNR: **+48.06 dB**; Caller RX SNR: **+44.96 dB** (Threshold: $\ge 5.0\text{ dB}$) | **PROVEN** |
| **6. Silence Detection** | RMS power calculated across PCM samples | Caller: **-18.10 dBFS**; Buyer: **-14.22 dBFS** (Threshold: $> -50\text{ dBFS}$) | **PROVEN** |
| **7. Clipping Analysis** | Peak amplitude sample check ($\le 32,767$) | Caller Peak: 15,996 (48.8% FSD); Buyer Peak: 32,124 (98.0% FSD); **0 clipped samples** | **PROVEN** |
| **8. Recording Integrity** | RIFF chunk header, duration, sample count, and SHA-256 hashes | Valid 8000 Hz 16-bit mono PCM; 76,204 bytes (Caller) & 85,164 bytes (Buyer) | **PROVEN** |
| **9. Speech Intelligibility** | Real human conversational clarity, formant preservation, phoneme articulation | Evaluated purely via synthetic sine waves (1000 Hz / 1500 Hz); **No human speech tested** | **NOT PROVEN** |

---

## 3. Why Tone Detection Does Not Equal Human Speech Verification

It is critical not to conflate Level 3 (Frequency Tone Isolation) with Level 4 (Perceptual Speech Quality).

### The Technical Limitations of Pure Sine Waves:
1. **Narrow Spectral Envelope:** A sine tone concentrates 100% of its acoustic energy at a single discrete Fourier bin ($k = f_0 \cdot N / f_s$). Human speech, by contrast, is a wideband, dynamic acoustic signal spanning complex fundamental frequencies ($F_0 \sim 85\text{–}255\text{ Hz}$) and multiple formants ($F_1\text{–}F_4$ up to 3400 Hz in narrowband telephony).
2. **Codec Non-Linearities & VAD:** Modern carrier networks employ Voice Activity Detection (VAD), Comfort Noise Generation (CNG), and adaptive echo cancellation. Continuous pure tones can trigger aggressive carrier suppression, noise gates, or DTMF notch filters that treat pure tones differently from non-stationary speech.
3. **Phoneme & Transcoding Distortion:** G.711 $\mu$-law companding logarithmic quantization ($\mu = 255$) can induce quantization distortion, phase jitter, and packet loss concealment (PLC) artifacts that degrade speech consonants (fricatives like /s/, /f/ and plosives like /p/, /t/) while leaving pure sine waves easily detectable.

---

## 4. Evidence Required for Real Conversational Audio Certification

To advance CallFlow audio verification from Level 3 to Level 4 (Certified Conversational Speech Quality), the following additional testing protocol must be executed:

### 1. Standardized Reference Speech Corpus (ITU-T P.862 / P.863)
- Use phonetically balanced reference audio files:
  - ITU-T P.862 Annex A / Harvard Sentences (e.g., *"The birch canoe slid on the smooth dark water"*).
  - Male and female voice samples sampled at 8 kHz / 16 kHz.
- Play reference speech out onto Caller TX and Buyer TX instead of synthetic sine markers.

### 2. Perceptual Evaluation of Speech Quality (PESQ / POLQA)
- Compute ITU-T P.862 PESQ score comparing the captured Snoop WAV against the reference source WAV.
- **Pass Criterion:** PESQ MOS-LQO (Mean Opinion Score - Listening Quality Objective) $\ge 3.8$ (Commercial Toll Quality).

### 3. Automated Speech Recognition (ASR) Word Error Rate (WER)
- Run an offline transcription engine (e.g. OpenAI Whisper Large-v3 or Vosk Small 8kHz) on the recorded Snoop audio files.
- Calculate Word Error Rate: $\text{WER} = \frac{S + D + I}{N}$.
- **Pass Criterion:** $\text{WER} \le 5.0\%$ across a 20-word reference utterance.

### 4. Acoustic Latency & Mouth-to-Ear Delay Measurement
- Transmit a chirp/bark impulse at $t_0$ and calculate cross-correlation peak on the receiving Snoop leg to measure one-way transport delay.
- **Pass Criterion:** One-way latency $\le 250\text{ ms}$ (ITU-T G.114 standard).

---

## 5. Summary Matrix

| Verification Attribute | Status in QA-1R | Required for Production Certification |
| :--- | :---: | :--- |
| Carrier Bridge Established | ✅ PROVEN | Baseline operational requirement |
| Bidirectional Media Flow | ✅ PROVEN | Baseline operational requirement |
| Snoop Channel Audiohook Isolation | ✅ PROVEN | Confirmed non-empty recording architecture |
| Frequency Discrimination (+45 dB SNR)| ✅ PROVEN | Mathematical verification of media crossing bridge |
| Human Speech Intelligibility | ❌ NOT PROVEN | Requires Phase QA-3 (ITU-T Reference Speech Corpus) |
| PESQ MOS Score $\ge 3.8$ | ❌ NOT PROVEN | Requires automated PESQ calculation utility |
| ASR Word Error Rate $\le 5\%$ | ❌ NOT PROVEN | Requires speech recognition test harness |

**Reconciliation Conclusion:** The existing Phase 7B-10U evidence definitively proves bidirectional acoustic transmission and high SNR signal capture across the Telnyx carrier bridge. However, it must be officially categorized as **Level 3 Synthetic Acoustic Validation**, not human conversational speech verification.
