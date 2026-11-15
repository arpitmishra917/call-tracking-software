# CallFlow — Phase 7B-6C: Safe QA ngrok Tunnel Recovery Report

**Verification Status**: COMPLETED  
**Final Verdict**: **PHASE 7B-6C — PASS**  
**Timestamp**: 2026-11-10T22:33:30+05:30  
**Target QA Database**: `callflow_qa` (`127.0.0.1:5433`, PostgreSQL 17.11)  
**Public Ingress URL**: `https://coherent-undrilled-disarm.ngrok-free.dev`  
**Execution Scope**: QA ngrok Tunnel Activation & Public Ingress Route Verification  

---

## 1. Pre-Tunnel Safety Gate Verification

Prior to starting ngrok, all pre-tunnel safety invariants were verified:

| Check | Target / Expected | Actual Value | Verdict |
| :--- | :--- | :--- | :---: |
| **Backend Process Identity** | `qa/launch-qa-backend.mjs` | PID `11016` (`qa/launch-qa-backend.mjs`) | **PASS** |
| **QA Database Connection** | `127.0.0.1:5433` (Established) | `127.0.0.1:65205 -> 127.0.0.1:5433` | **PASS** |
| **Production Sockets** | 0 sockets to port 6543 / Supabase | **0 sockets** | **PASS** |
| **Port 3000 Ownership** | PID 11016 | PID 11016 | **PASS** |
| **Local Health Endpoint** | `HTTP 200` (`status: healthy`) | `HTTP 200 OK` (DB status: `up`) | **PASS** |
| **Telephony Calling Guard** | `TELEPHONY_QA_ENABLED=false` | Confirmed `false` | **PASS** |
| **Destination Allowlist** | `TELEPHONY_QA_ALLOWED_DESTINATIONS=""` | Confirmed empty string `""` | **PASS** |
| **Tracking DID** | `TELNYX_QA_TRACKING_DID=""` | Confirmed empty string `""` | **PASS** |

---

## 2. ngrok Tunnel Activation & Topology

With all safety gates verified, a single ngrok process was launched:
- **ngrok Process ID**: **PID 8568** (`ngrok http 3000`, started `10-11-2026 22:31:50`).
- **Management API**: Queried `http://127.0.0.1:4040/api/tunnels`.
- **Public Ingress URL**: `https://coherent-undrilled-disarm.ngrok-free.dev`
- **Forwarding Target**: `http://localhost:3000` (strictly bound to verified QA backend PID 11016).
- **Duplicate Tunnels**: 0 (single tunnel active).

---

## 3. Public Ingress & Webhook Route Verification

Direct probes were performed locally and across the public internet through ngrok:

### 3.1. Health Endpoint Synchronization
- **Local Probe**: `GET http://127.0.0.1:3000/health`
  - Response: `HTTP 200 OK`
  - Payload: `{"status":"healthy","timestamp":"2026-11-10T17:02:53.951Z","services":{"database":{"status":"up"}}}`
- **Public Probe**: `GET https://coherent-undrilled-disarm.ngrok-free.dev/health`
  - Response: `HTTP 200 OK`
  - Payload: `{"status":"healthy","timestamp":"2026-11-10T17:02:54.292Z","services":{"database":{"status":"up"}}}`
- **Correlation**: Confirms that public traffic through ngrok hits the verified QA backend.

### 3.2. Public Webhook Route & Signature Verification
- **Endpoint**: `POST https://coherent-undrilled-disarm.ngrok-free.dev/webhooks/telnyx`
- **Probe**: Unsigned JSON payload (`{"test":"unsigned"}`) submitted without Telnyx cryptographic headers.
- **Response**: `HTTP 400 Bad Request`
- **Payload**:
  ```json
  {
    "message": "Missing webhook signature headers or body",
    "error": "Bad Request",
    "statusCode": 400
  }
  ```
- **Cryptographic Enforcement**: Confirms that [`TelnyxWebhookController`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/telnyx/telnyx.webhook.controller.ts) strictly rejects unsigned or spoofed events at the controller boundary.

---

## 4. Post-Activation Production Isolation Audit

After ngrok actively routed traffic into the backend:
- **Backend PID Network Sockets**:
  ```text
  LocalAddress LocalPort RemoteAddress RemotePort State       OwningProcess
  ------------ --------- ------------- ---------- -----       -------------
  ::           3000      ::            0          Listen      11016
  127.0.0.1    65205     127.0.0.1     5433       Established 11016
  ```
- **Production Supabase Connections**: **0** (No sockets to port 6543, no connections to `52.68.3.1`).
- **Target Database**: Exclusively Docker container `callflow-postgres-qa` on `127.0.0.1:5433/callflow_qa`.

---

## 5. Ten Required Report Items

| # | Item | Status / Value |
| :---: | :--- | :--- |
| **1** | **Verified QA Backend PID** | **11016** (`node.exe` executing `qa/launch-qa-backend.mjs`) |
| **2** | **QA Database Connection Evidence** | `127.0.0.1:65205 -> 127.0.0.1:5433 (Established)` |
| **3** | **Production Connection Count** | **0** (Zero sockets to port 6543 / Supabase) |
| **4** | **ngrok PID** | **8568** (`ngrok.exe http 3000`) |
| **5** | **Actual HTTPS Forwarding URL** | `https://coherent-undrilled-disarm.ngrok-free.dev` |
| **6** | **Local Health Response** | `HTTP 200 OK` (`{"status":"healthy","services":{"database":{"status":"up"}}}`) |
| **7** | **Public Health Response** | `HTTP 200 OK` (`{"status":"healthy","services":{"database":{"status":"up"}}}`) |
| **8** | **Webhook Route & Signature Rejection** | `POST /webhooks/telnyx` returned `HTTP 400 Missing webhook signature headers or body` |
| **9** | **Production Isolation After Tunnel** | **PASS** (Zero production connections maintained) |
| **10** | **QA Calling Guard State** | `TELEPHONY_QA_ENABLED=false`, `TELNYX_QA_TRACKING_DID=""`, `TELEPHONY_QA_ALLOWED_DESTINATIONS=""` |

---

## 6. Final Verdict

**PHASE 7B-6C — PASS**

*(Execution has stopped per protocol. The QA public ingress pipeline is fully online, cryptographically guarded, and safely connected to the isolated QA database. Awaiting separate authorization before proceeding to Stage B Carrier Attachment or live telephony calls).*
