# CALLFLOW — QA-2F REMEDIATION REPORT: BUYER B SIP & WEBHOOK INGRESS

**Phase ID:** `CALLFLOW-PHASE-QA-2F-REMEDIATION-B`  
**Phase Name:** Live Telephony QA Prerequisites Remediation (Buyer B SIP & Webhook Ingress)  
**Owner:** Agent 4 — Telephony, Asterisk ARI, SIP, RTP & Recording Infrastructure  
**Mode:** CONTROLLED READ/WRITE REMEDIATION (ZERO CARRIER EXPENDITURE, ZERO CALL MUTATION)  
**Execution Timestamp:** 2026-11-15T01:21:00Z  
**Final Verdict:** **`READY FOR FRESH PREFLIGHT`**

---

## 1. Executive Summary & Remediation Verdict

Following the identification of the Stage 1 preflight blockers in `CALLFLOW-PHASE-QA-2F-LIVE-CARRIER-OVERFLOW-REPORT.md`, Agent 4 was commissioned under **QA-2F Remediation B** to resolve all telephony prerequisites necessary to conduct controlled live carrier testing without incurring carrier costs, purchasing phone numbers, or disrupting production boundaries.

All remediation objectives have been successfully accomplished with **$0.00 carrier expenditure** and **zero service disruption**:

1. **Telnyx Buyer B SIP Credential Connection:** Configured secondary credential connection `ID 3093376551908017755` (`arpitmishra9178b`) at $0.00 cost with `sip_uri_calling_preference: "unrestricted"`.
2. **Asterisk PJSIP Isolation:** Added isolated endpoint `[telnyx-buyer-b]` and outbound registration `[telnyx-buyer-b-reg]` to `/etc/asterisk/pjsip_dynamic.conf`. PJSIP reloaded non-disruptively without container restart.
3. **Asterisk Dialplan Context:** Created `[from-telnyx-buyer-b]` in `qa/asterisk/extensions.conf`, routing incoming calls to `Stasis(callflow-qa,buyer-b,...)`. Dialplan reloaded dynamically.
4. **Independent SIP Registrations Verified:** Asterisk simultaneously maintains active, independent registrations for `telnyx-caller`, `telnyx-buyer` (Buyer A), and `telnyx-buyer-b` (Buyer B).
5. **Backend Database Isolation:** Dedicated NestJS QA backend launched on port 3000 targeting `callflow_qa` on PostgreSQL port 5433. Production database environment variables stripped.
6. **ngrok Webhook Ingress Restored:** ngrok tunnel active on `https://coherent-undrilled-disarm.ngrok-free.dev` forwarding to `http://localhost:3000`. Webhook signature enforcement validated.
7. **Production Boundary & Cost Enforcement:** Zero phone numbers purchased, zero paid subscriptions incurred, balance remains untouched at `$1.86 USD`. Zero live calls initiated during remediation.

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                             QA-2F REMEDIATION B STATUS MATRIX                                    │
├───────────────────────────────────────────────────┬───────────────┬──────────────────────────────┤
│ REMEDIATION DIMENSION                             │ STATUS        │ VERIFICATION EVIDENCE        │
├───────────────────────────────────────────────────┼───────────────┼──────────────────────────────┤
│ 1. Zero-Cost Buyer B Carrier SIP Connection       │ RESOLVED      │ Telnyx Conn 3093376551908017 │
│ 2. Carrier Account Balance Preservation           │ VERIFIED      │ $1.86 USD (Cost: $0.00)      │
│ 3. Asterisk Buyer B PJSIP Endpoint & AOR          │ CONFIGURED    │ Endpoint: telnyx-buyer-b     │
│ 4. Independent Dual-Buyer SIP Registrations       │ VERIFIED      │ Both registered with Telnyx  │
│ 5. Isolated Dialplan Context [from-telnyx-buyer-b]│ DEPLOYED      │ extensions.conf:18-24        │
│ 6. NestJS QA Backend & Database Identity          │ HEALTHY       │ callflow_qa @ 127.0.0.1:5433 │
│ 7. QA Webhook Ingress (ngrok + Signature Guard)   │ OPERATIONAL   │ ngrok online, Ed25519 active │
│ 8. Active Channel Safety & Zero Disruption        │ VERIFIED      │ 0 active channels, 0 calls   │
└───────────────────────────────────────────────────┴───────────────┴──────────────────────────────┘
```

**Final Remediation Verdict:** **`READY FOR FRESH PREFLIGHT`**

---

## 2. Granular Remediation Audit Evidence

### 2.1 Telnyx Carrier Credential Connections & Cost Audit
- **Carrier:** Telnyx API v2 (`https://api.telnyx.com/v2`)
- **Carrier Balance Before Remediation:** `$1.86 USD`
- **Carrier Balance After Remediation:** `$1.86 USD`
- **Total Incurred Cost:** **`$0.00 USD`** (Zero expenditure, no new numbers or paid plans purchased)

#### Configured Credential Connections:
```json
[
  {
    "id": "3093376551908017755",
    "connection_name": "QA Buyer B",
    "user_name": "arpitmishra9178b",
    "active": true,
    "sip_uri_calling_preference": "unrestricted"
  },
  {
    "id": "3089429617522508888",
    "connection_name": "Buyer",
    "user_name": "arpitmishra9178",
    "active": true,
    "sip_uri_calling_preference": "unrestricted"
  },
  {
    "id": "3089420521612248192",
    "connection_name": "caller",
    "user_name": "arpitmishra917",
    "active": true,
    "sip_uri_calling_preference": null
  }
]
```
*Note: Passwords and access tokens are strictly redacted and stored in gitignored local configuration (`qa/asterisk/.buyer_b_creds.json`).*

---

### 2.2 Asterisk PJSIP Dual-Buyer Configuration & Registration Evidence

Dynamic endpoint configuration was injected into container `/etc/asterisk/pjsip_dynamic.conf` and reloaded using `asterisk -rx "pjsip reload"`. Container was **not** restarted.

#### Live PJSIP Registration Status (`pjsip show registrations`):
```text
<Registration/ServerURI..............................>  <Auth....................>  <Status.......>
==========================================================================================
 telnyx-buyer-b-reg/sip:sip.telnyx.com:5060              telnyx-buyer-b-auth         Registered        (exp. 219s)
 telnyx-buyer-reg/sip:sip.telnyx.com:5060                telnyx-buyer-auth           Registered        (exp. 277s)
 telnyx-caller-reg/sip:sip.telnyx.com:5060               telnyx-caller-auth          Registered        (exp. 245s)
Objects found: 3
```

#### Live PJSIP Endpoint Status (`pjsip show endpoints`):
```text
Endpoint:  telnyx-buyer                                         Not in use    0 of inf
    OutAuth:  telnyx-buyer-auth/arpitmishra9178
        Aor:  telnyx-buyer-aor                                   0
      Contact:  telnyx-buyer-aor/sip:sip.telnyx.com:5060   a4e8719e5d Avail       372.636
  Transport:  transport-udp             udp      0      0  0.0.0.0:5060
   Identify:  telnyx-buyer-identify/telnyx-buyer
        Match: 192.76.120.10/32
        Match: 64.16.250.10/32

Endpoint:  telnyx-buyer-b                                       Not in use    0 of inf
    OutAuth:  telnyx-buyer-b-auth/arpitmishra9178b
        Aor:  telnyx-buyer-b-aor                                 0
      Contact:  telnyx-buyer-b-aor/sip:sip.telnyx.com:5060 a4e8719e5d Avail       372.636
  Transport:  transport-udp             udp      0      0  0.0.0.0:5060

Endpoint:  telnyx-caller/+17207159445                           Not in use    0 of inf
    OutAuth:  telnyx-caller-auth/arpitmishra917
        Aor:  telnyx-caller-aor                                  0
      Contact:  telnyx-caller-aor/sip:sip.telnyx.com:5060  a4e8719e5d Avail       472.960
  Transport:  transport-udp             udp      0      0  0.0.0.0:5060
Objects found: 3
```

**Line Identification Mechanism:**  
Both `telnyx-buyer-reg` and `telnyx-buyer-b-reg` use `line=yes` with `endpoint_identifier_order=line,username,ip`. When Telnyx delivers inbound SIP INVITEs to the registered Contact URI, the incoming request contains the registered line parameter, enabling Asterisk to unambiguously route Buyer A to `context=from-telnyx-buyer` and Buyer B to `context=from-telnyx-buyer-b`.

---

### 2.3 Asterisk Dialplan Routing Contexts

In `qa/asterisk/extensions.conf`, the isolated context `[from-telnyx-buyer-b]` was added and loaded via `asterisk -rx "dialplan reload"`:

```text
[ Context 'from-telnyx-buyer-b' created by 'pbx_config' ]
  'h' =>            1. NoOp(--- [QA-BUYER-B] Call hangup with cause: ${HANGUPCAUSE} ---) [extensions.conf:24]
  '_.' =>           1. NoOp(--- [QA-BUYER-B] Incoming call from ${CALLERID(all)} to ${EXTEN} (RunID: ${PJSIP_HEADER(read,X-QA-Run-Id)}) ---) [extensions.conf:19]
                    2. Answer()                                   [extensions.conf:20]
                    3. Stasis(callflow-qa,buyer-b,${PJSIP_HEADER(read,X-QA-Run-Id)}) [extensions.conf:21]
                    4. Hangup()                                   [extensions.conf:22]

-= 2 extensions (5 priorities) in 1 context. =-
```

This mirrors the Buyer A context `[from-telnyx-buyer]` while passing the dedicated `buyer-b` Stasis argument to distinguish channel lifecycle events in the ARI test harness.

---

### 2.4 NestJS Backend Health & Database Isolation

The QA backend was launched via `qa/launch-qa-backend.mjs` running in daemon mode:
- **Host / Port:** `http://127.0.0.1:3000`
- **Target Database:** `postgresql://callflow_qa_user:***@127.0.0.1:5433/callflow_qa?schema=public`
- **Production Stripping:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and remote database strings scrubbed from process environment before boot.

#### Live Verification Endpoints:
1. `GET http://127.0.0.1:3000/health`:
   ```json
   {
     "status": "healthy",
     "timestamp": "2026-11-15T01:19:25.685Z",
     "services": {
       "database": {
         "status": "up"
       }
     }
   }
   ```
2. `GET http://127.0.0.1:3000/qa/status` (Authenticated with `x-qa-key`):
   ```json
   {
     "qaEnabled": true,
     "configValid": true,
     "configErrors": [],
     "activeRun": null
   }
   ```

---

### 2.5 ngrok Ingress & Webhook Security Verification

- **ngrok Process:** Running as background daemon
- **Tunnel Public URL:** `https://coherent-undrilled-disarm.ngrok-free.dev`
- **Local Forwarding Target:** `http://localhost:3000`
- **Telnyx Call Control Application Webhook URL:** `https://coherent-undrilled-disarm.ngrok-free.dev/webhooks/telnyx`

#### Webhook Ingress Route Probes:
1. **Local Endpoint Probe (`http://127.0.0.1:3000/webhooks/telnyx`):**
   - Unsigned POST request returns: `HTTP 400 Bad Request` (`{"message":"Missing webhook signature headers or body","error":"Bad Request","statusCode":400}`)
   - Invalid signature header returns: `HTTP 400 Bad Request` (`"Webhook Error: Invalid signature format: invalid_base64_sig=="`)
2. **Public ngrok Probe (`https://coherent-undrilled-disarm.ngrok-free.dev/webhooks/telnyx`):**
   - Public Unsigned POST returns: `HTTP 400 Bad Request` (`{"message":"Missing webhook signature headers or body"}`)
   - Verifies that external carrier traffic is routed across the public Internet through ngrok directly to the local NestJS webhook handler.

---

### 2.6 Environment Variable Alignment

The following configuration is synchronized across `.env` and `apps/api/.env.qa`:
```bash
TELEPHONY_QA_ENABLED=true
TELNYX_QA_TRACKING_DID=+17252574041
TELNYX_QA_CALL_CONTROL_APP_ID=3090207513618941231
TELEPHONY_QA_ALLOWED_DESTINATIONS=+12025550199,+12025550198
TELEPHONY_QA_BUYER_A_SIP_URI=sip:arpitmishra9178@sip.telnyx.com
TELEPHONY_QA_BUYER_B_SIP_URI=sip:arpitmishra9178b@sip.telnyx.com
TELEPHONY_QA_CALLER_SIP_URI=sip:arpitmishra917@sip.telnyx.com
TELEPHONY_QA_MAX_CONCURRENT_CALLS=3
TELEPHONY_QA_MAX_CALLS_PER_RUN=3
```

---

## 3. Strict Safety & Mutation Audit

During the execution of Remediation B:
1. **Zero Carrier / PSTN Calls:** No live calls were placed or triggered.
2. **Zero Incurred Costs:** Balance remained strictly at `$1.86 USD`.
3. **Zero Disruption to Active Calls:** Active channels remained `0` throughout. No container restarts were performed. Dialplan and PJSIP were reloaded in-memory via Asterisk CLI.
4. **Zero Production Mutation:** The production database on Supabase was never contacted; the QA backend is strictly pinned to port 5433 / `callflow_qa`.

---

## 4. Final Verdict & Next Steps

All prerequisites for live carrier testing have been remediated, verified, and stabilized. The previous `BLOCKED` status is resolved.

### Categorical Verdict: **`READY FOR FRESH PREFLIGHT`**

### Recommended Next Action:
Execute a fresh **Phase QA-2F Stage 1 Preflight** to formally validate all check gates before authorizing Stage 2 live test calls.
