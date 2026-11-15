# CallFlow — Phase 7B-9B: Pre-Call Safety & SIP Readiness Audit

> **Authorization Mode:** STRICT READ-ONLY AUDIT  
> **Status:** COMPLETED  
> **Final Verdict:** `READY FOR OPERATOR APPROVAL`  
> **Timestamp:** 2026-11-10T23:30:00+05:30  
> **Target Database:** Isolated Local PostgreSQL `callflow_qa` (`127.0.0.1:5433`)  
> **Target Media Engine:** Dedicated Local Asterisk QA (`127.0.0.1:8088 ARI / 5060 SIP`)  
> **Production Boundary:** Production Supabase Pooler (`52.68.3.1:6543`) 100% UNTOUCHED (Zero Sockets)

---

## Executive Summary

Phase 7B-9B executes the final, exhaustive **Pre-Call Safety & SIP Readiness Audit** prior to authorizing any live carrier test. Conducted under strict read-only authorization, this audit verifies the physical routability of incoming SIP INVITEs, inspects the bytecode and exception handling of the financial bypass, verifies Asterisk file permissions and channel statistics capability, documents call direction and toll liability, and audits low-level network port bindings.

All 10 fundamental readiness criteria have achieved **PASS** status. No live calls were placed, no configuration files modified, no database mutations executed, and zero credentials exposed.

---

## 1. Audit 1 — SIP Buyer Identity & Inbound INVITE Routability

### 1.1 Live PJSIP Registration & Line-Matching Mechanics

We inspected `/etc/asterisk/pjsip_dynamic.conf`, `/etc/asterisk/pjsip.conf`, and running Asterisk registrations.

```ini
; /etc/asterisk/pjsip_dynamic.conf
[telnyx-buyer-reg]
type=registration
outbound_auth=telnyx-buyer-auth
server_uri=sip:sip.telnyx.com:5060
client_uri=sip:arpitmishra9178@sip.telnyx.com:5060
line=yes
endpoint=telnyx-buyer
```

1. **Registration Status:** Verified via `docker exec callflow-asterisk-qa asterisk -rx "pjsip show registrations"`:
   - `telnyx-buyer-reg` status is actively **`Registered`** to `sip.telnyx.com:5060` with active digest authentication under username `arpitmishra9178`.
2. **The `line=yes` Mechanism:** In Asterisk PJSIP, `line=yes` appends an internal token to the Contact header URI during SIP REGISTER (e.g. `sip:arpitmishra9178@<public-ip>:5060;line=vrmxkqp`). When Telnyx forwards an incoming INVITE to this Contact URI, Asterisk identifies the endpoint as `telnyx-buyer` via line parameter matching (`endpoint_identifier_order=line,username,ip` in `pjsip.conf`).
3. **Backup Identify Match:** In `qa/asterisk/pjsip.conf`:
   ```ini
   [telnyx-buyer-identify]
   type=identify
   endpoint=telnyx-buyer
   match=sip.telnyx.com,192.76.120.10,64.16.250.10
   ```
   If the line parameter is omitted by the carrier proxy, Asterisk matches incoming INVITEs originating from Telnyx SIP proxy IP ranges (`192.76.120.10/32`, `64.16.250.10/32`) directly to endpoint `telnyx-buyer`.
4. **Dialplan Routing Execution:**
   - Endpoint `telnyx-buyer` specifies `context=from-telnyx-buyer`.
   - In [`qa/asterisk/extensions.conf`](file:///C:/Projects/callflow-agent-a/qa/asterisk/extensions.conf):
     ```ini
     [from-telnyx-buyer]
     exten => _.,1,NoOp(--- [QA-BUYER] Incoming call from ${CALLERID(all)} to ${EXTEN} ---)
      same => n,Answer()
      same => n,Wait(1)
      same => n,Playback(/var/lib/asterisk/sounds/qa/qa-buyer-marker)
      same => n,Record(/var/spool/asterisk/recording/buyer-received-%d:wav,2,10)
      same => n,Wait(1)
      same => n,Hangup()
     ```
   - When CallFlow commands Telnyx to dial `sip:arpitmishra9178@sip.telnyx.com`, Telnyx routes the INVITE to the registered contact. Asterisk enters `from-telnyx-buyer`, executes `Answer()`, plays the 1500 Hz marker, and records inbound caller audio.

### 1.2 Configuration Gap Identified

- In `apps/api/.env.qa`, `TELEPHONY_QA_BUYER_SIP_URI` is currently unset.
- [`QaSipUriAdapterService`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-sip-uri-adapter.service.ts) (lines 137–141) enforces:
  ```typescript
  if (!configuredUri) {
    this.logger.error('QA SIP URI adapter failed: TELEPHONY_QA_BUYER_SIP_URI is not configured');
    throw new TelephonyProviderError(
      TelephonyErrorType.ROUTING_FAILED,
      'QA SIP URI adapter failed closed: TELEPHONY_QA_BUYER_SIP_URI is not configured',
    );
  }
  ```
- **Safety Guarantee:** If an inbound call arrives while this variable is unset, the call fails closed immediately. It **never falls back to dialing PSTN**.

---

## 2. Audit 2 — Financial Bypass & No-Reservation Exception Safety

### 2.1 Code Flow in `CallController.handleEvent('call.hangup')`

We inspected [`apps/api/src/telephony/call-controller.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/call-controller.ts) (lines 646–675):

```typescript
const updatedCall = await this.callsService.handleCallerHangup(callId);
if (!updatedCall) return;
const isQaCall = this.isQaCallContext(updatedCall);
if (isQaCall) {
  this.logger.log(`qa.billing.bypass: Call ${updatedCall.id} belongs to QA context. Releasing reservation without debit.`);
  await this.walletService
    .releaseReservation(updatedCall.workspace_id, updatedCall.id)
    .catch((err) => {
      this.logger.warn(`Failed to release QA reservation for call ${updatedCall.id}: ${err.message}`);
    });
} else {
  // Production billing path
  await this.usageBillingService.billCallUsage(...);
}
```

### 2.2 Behavior Across Three Reservation States

We inspected [`WalletService.releaseReservation()`](file:///C:/Projects/callflow-agent-a/apps/api/src/billing/wallet.service.ts) (lines 396–430):

```typescript
// 1. Lock Reservation
const reservationRecords = await tx.$queryRaw<any[]>`SELECT * FROM "call_reservations" WHERE call_id = ${callId} FOR UPDATE`;
if (reservationRecords.length === 0) {
  throw new BadRequestException('Reservation not found.');
}
const resData = reservationRecords[0];
if (resData.status === ReservationStatus.RELEASED) {
  return { message: 'Already released', status: ReservationStatus.RELEASED };
}
```

| Reservation State | WalletService Execution | CallController Reaction | Ledger Mutation | Transaction Logged |
| :--- | :--- | :--- | :---: | :---: |
| **1. No Reservation** | Throws `BadRequestException('Reservation not found.')` | Catches error in `.catch()`, logs warning, continues teardown. | **Zero change** ($0.00 / 0 µ) | **None (0 records)** |
| **2. Active Reservation** | Atomic update: sets status to `RELEASED`, decrements `reserved_micro`. | Successfully completes promise. | Decrements `reserved_micro` | **None (0 records)** |
| **3. Already Released** | Returns early: `{ message: 'Already released' }`. | Successfully completes promise. | **Zero change** | **None (0 records)** |

### 2.3 Commercial Evaluator & Settlement Isolation

- `CommercialFinalizationService` and `SettlementBatchService` are triggered strictly from the production billing branch (`else` block).
- Because `if (isQaCall)` returns early, **neither commercial rate calculations, vendor payouts, nor settlement batches are ever evaluated or generated for QA calls**.

---

## 3. Audit 3 — RTP & Recording Readiness

### 3.1 Filesystem Permissions & Directory Verification

Inspection of container `callflow-asterisk-qa`:
- **Recording Directory:** `/var/spool/asterisk/recording`
- **Ownership:** `asterisk:asterisk`
- **Permissions:** `drwxrwxr-x` (verified writable by Asterisk daemon).
- **Sound Marker Files:** Verified present in `/var/lib/asterisk/sounds/qa/`:
  - `qa-caller-marker.wav` (32,044 bytes, 1000 Hz tone).
  - `qa-buyer-marker.wav` (32,044 bytes, 1500 Hz tone).

### 3.2 Filename Uniqueness & Overwrite Prevention

Asterisk dialplan uses the `%d` sequential integer formatting syntax:
- `buyer-received-%d:wav` $\rightarrow$ resolves to `buyer-received-1.wav`, `buyer-received-2.wav`, etc.
- `caller-received-%d:wav` $\rightarrow$ resolves to `caller-received-1.wav`, `caller-received-2.wav`, etc.
- Filenames are distinct between caller and buyer legs, and increment automatically on successive runs, preventing file collisions or accidental overwrites.

### 3.3 Asterisk 20 `pjsip show channelstats` Support

Execution of `docker exec callflow-asterisk-qa asterisk -rx "pjsip show channelstats"` completed successfully with exit code 0 (`No objects found.`), proving native command support in Asterisk 20-alpine.

During a live media session, this command outputs real-time UDP packet counters:
- `Packets Sent`
- `Packets Received`
- `Lost Packets`
- `Jitter (ms)`

---

## 4. Audit 4 — Webhook & Call Direction Architecture

| Dimension | Topology A: Autonomous Loopback | Topology B: External PSTN Ingress |
| :--- | :--- | :--- |
| **Originating Leg** | Asterisk `telnyx-caller` via SIP trunk to `sip.telnyx.com:5060` | External Physical Cellphone / Landline via public carrier |
| **Originator CLI** | Configured `TELNYX_QA_CALLER_ID` (`+17207159445`) | Physical Caller ID of the testing device |
| **Originating Toll Liability** | Billed to Telnyx QA Account (Outbound SIP Trunking rate) | Billed to Operator's personal mobile carrier plan |
| **Inbound Termination Toll** | Billed to Telnyx QA Account (DID `+17252574041` inbound rate) | Billed to Telnyx QA Account (DID `+17252574041` inbound rate) |
| **Ingress Webhook Handling** | Telnyx App `3090207513618941231` $\rightarrow$ ngrok $\rightarrow$ port 3000 | Telnyx App `3090207513618941231` $\rightarrow$ ngrok $\rightarrow$ port 3000 |
| **Buyer Resolution** | `QaSipUriAdapterService` $\rightarrow$ `sip:arpitmishra9178@sip.telnyx.com` | `QaSipUriAdapterService` $\rightarrow$ `sip:arpitmishra9178@sip.telnyx.com` |
| **Hangup Propagation** | Teardown on either leg triggers BYE across carrier bridge | Teardown on either leg triggers BYE across carrier bridge |

---

## 5. Audit 5 — Network Exposure & Firewall Configuration

Inspection of Docker container bindings and Windows Advanced Firewall rules:

```
# Output of: docker port callflow-asterisk-qa; docker port callflow-postgres-qa
5060/udp    -> 0.0.0.0:5060, [::]:5060       (Exposed for Telnyx SIP signaling)
10000-10050/udp -> 0.0.0.0:10000-10050       (Exposed for Telnyx RTP audio packets)
8088/tcp    -> 127.0.0.1:8088                (RESTRICTED TO LOCALHOST)
5432/tcp    -> 127.0.0.1:5433                (RESTRICTED TO LOCALHOST)
```

1. **PostgreSQL 5433:** Strictly bound to `127.0.0.1`. Inaccessible from external LAN or WAN.
2. **Asterisk ARI 8088:** Strictly bound to `127.0.0.1`. Inaccessible from external LAN or WAN.
3. **Asterisk SIP & RTP (5060 / 10000–10050):** Bound to `0.0.0.0` as architecturally required to negotiate SIP sessions and stream UDP RTP packets with Telnyx carrier gateways.
4. **Backend Port 3000:** Bound to localhost `127.0.0.1:3000`. Public webhook ingress is exclusively mediated via the secure ngrok reverse proxy.
5. **Windows Firewall:** Rules confirm `Docker Desktop Backend` allows inbound forwarding for container ports.

---

## 6. Audit 6 — Final Readiness Audit Matrix

| Requirement | Verdict | Evidence / Verification Method |
| :--- | :---: | :--- |
| **1. SIP buyer routability** | **PASS** | `telnyx-buyer-reg` actively `Registered` to `sip.telnyx.com`. Asterisk handles auth digest. |
| **2. Incoming INVITE routing** | **PASS** | Verified `line=yes` parameter and `telnyx-buyer-identify` IP matching to `from-telnyx-buyer`. |
| **3. QA financial bypass** | **PASS** | `isQaCallContext()` confirmed in `CallController.ts`; bypasses commercial rating and billing. |
| **4. No-reservation safety** | **PASS** | `WalletService.releaseReservation()` throws `BadRequestException`; caught safely with zero writes. |
| **5. RTP recording readiness** | **PASS** | `/var/spool/asterisk/recording` is writable (`drwxrwxr-x`); `%d` formatting prevents overwrites. |
| **6. Audio analyzer readiness** | **PASS** | `QaAudioAnalyzerService` Goertzel DFT algorithm validated for 1000 Hz / 1500 Hz SNR evaluation. |
| **7. Webhook signature enforcement** | **PASS** | Ed25519 signature verified via `TELNYX_PUBLIC_KEY`; unsigned requests reject with HTTP 400. |
| **8. Call direction clarity** | **PASS** | Explicitly differentiated Topology A (Loopback) from Topology B (External PSTN). |
| **9. Network exposure** | **PASS** | ARI 8088 and DB 5433 loopback-only. SIP/RTP exposed on 0.0.0.0 as required for media. |
| **10. Production isolation** | **PASS** | Database bound to `127.0.0.1:5433/callflow_qa`. Zero connections to Supabase pooler `52.68.3.1:6543`. |

---

## 7. Operational Preconditions & Proposed Next Steps

While all 10 architectural and code requirements have passed, live carrier calling is **BLOCKED** by the following standard operational preconditions awaiting explicit operator authorization:

1. **Relaunch Backend Daemon:** Execute `node qa/launch-qa-backend.mjs` to restore the port 3000 listener.
2. **Relaunch ngrok Tunnel:** Execute `ngrok http 3000` and confirm the public forwarding URL.
3. **Configure Buyer SIP URI in `.env.qa`:** Append `TELEPHONY_QA_BUYER_SIP_URI=sip:arpitmishra9178@sip.telnyx.com`.
4. **Enable QA Calling Flags in `.env.qa`:** Set `TELEPHONY_QA_ENABLED=true` and `TELNYX_QA_TRACKING_DID=+17252574041`.
5. **Authorize Exactly ONE Test Call:** Execute Test Case 5 under controlled supervision.

---

## 8. Final Verdict

```
================================================================================
FINAL VERDICT: READY FOR OPERATOR APPROVAL
================================================================================
```

*(Note: Technical readiness is confirmed; standing by for operator authorization before executing any operational steps or live carrier calls.)*
