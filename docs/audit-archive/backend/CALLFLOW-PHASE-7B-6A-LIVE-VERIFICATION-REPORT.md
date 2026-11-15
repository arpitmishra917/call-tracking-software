# CallFlow — Phase 7B-6A: Live QA Backend & ngrok Verification Report

**Verification Status**: COMPLETED (Read-Only Safety Audit)  
**Timestamp**: 2026-11-10T22:15:30+05:30  
**Final Verdict**: **PHASE 7B-6A — BLOCKED**  

---

## 1. Executive Summary & Critical Safety Alert

> [!CAUTION]
> ### CRITICAL SAFETY INTERCEPTION: BACKEND IS CONNECTED TO PRODUCTION SUPABASE
> The running NestJS backend process (**PID 4588**) was inspected via network telemetry. It has an active TCP connection to **`52.68.3.1:6543`**, which DNS independently resolves to **`aws-0-ap-northeast-1.pooler.supabase.com`** (the live Production Supabase connection pooler).
> 
> **PID 4588 has ZERO connections to the local QA database (`127.0.0.1:5433`)**.
> 
> **Cause**: When launched via `node apps/api/dist/main`, the application bootstrap script ([`main.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/main.ts#L6-L10)) defaults to loading `.env` and `apps/api/.env` (which contains live production Supabase credentials). It does not automatically load `apps/api/.env.qa`.
> 
> Per mandatory protocol: *"If the running process is using production configuration or its environment cannot be established, STOP and report BLOCKED."* Execution is immediately halted. No carrier calls or Telnyx webhook tests may proceed.

---

## 2. Verification Checklist Table

| Check | Result | Evidence & Technical Findings |
| :--- | :---: | :--- |
| **Backend process** | **PASS** | `node.exe` is running as **PID 4588** (Command line: `node --enable-source-maps C:\Projects\callflow-agent-a\apps\api\dist\main`, started `10-11-2026 22:08:01`). |
| **Port 3000** | **PASS** | TCP listener active on `[::]:3000` owned by PID 4588. |
| **QA environment loaded** | **FAIL** | Process loaded `apps/api/.env` instead of `apps/api/.env.qa`. `main.ts` hardcodes paths to `.env` files without checking for `.env.qa`. |
| **QA database connection** | **FAIL** | `Get-NetTCPConnection -OwningProcess 4588` reveals active connection to `192.168.1.74:65022 -> 52.68.3.1:6543` (Production Supabase Pooler `aws-0-ap-northeast-1.pooler.supabase.com`). Active connections to `127.0.0.1:5433`: **0**. |
| **Local health endpoint** | **PASS** | `GET http://127.0.0.1:3000/health` returned `HTTP 200` with `{"status":"healthy","services":{"database":{"status":"up"}}}`. |
| **ngrok process** | **PASS** | `ngrok.exe` is running as **PID 6468** (Command line: `ngrok http 3000`, started `10-11-2026 22:09:23`). |
| **ngrok forwarding** | **PASS** | ngrok local API (`http://127.0.0.1:4040/api/tunnels`) confirms tunnel `command_line` is forwarding `https://coherent-undrilled-disarm.ngrok-free.dev` -> `http://localhost:3000`. |
| **Public health endpoint** | **PASS** | `GET https://coherent-undrilled-disarm.ngrok-free.dev/health` returned `HTTP 200` with `{"status":"healthy","services":{"database":{"status":"up"}}}`. |
| **Webhook route** | **PASS** | Route `POST /webhooks/telnyx` is registered and responded with `HTTP 400 Missing webhook signature headers or body` on unauthenticated probe. |
| **Signature verification** | **PASS** | Code audit of `TelnyxWebhookController` confirms Ed25519 signature validation is strictly enforced before any event dispatching. |
| **Production isolation** | **FAIL** | **CRITICAL FAILURE**: The backend process is connected to Production Supabase! Any incoming Telnyx webhook would query or mutate production records. |

---

## 3. Detailed Forensic Evidence

### 3.1. Process Inventory
```text
ProcessId    : 4588
Name         : node.exe
CommandLine  : node  --enable-source-maps C:\Projects\callflow-agent-a\apps\api\dist\main
CreationDate : 10-11-2026 22:08:01

ProcessId    : 6468
Name         : ngrok.exe
CommandLine  : ngrok  http 3000
CreationDate : 10-11-2026 22:09:23
```

### 3.2. Network Telemetry of PID 4588
```powershell
Get-NetTCPConnection -OwningProcess 4588
LocalAddress LocalPort RemoteAddress RemotePort State AppliedSetting OwningProcess
------------ --------- ------------- ---------- ----- -------------- -------------
::           3000      ::            0                Internet       4588         
0.0.0.0      65022     0.0.0.0       0                Internet       4588         
192.168.1.74 65022     52.68.3.1     6543             Compat         4588         
```

### 3.3. Remote Endpoint DNS Resolution
```powershell
Resolve-DnsName aws-0-ap-northeast-1.pooler.supabase.com
NameHost  : pool-tcp-ap-northeast-1-4a2b510-70cf7098715bc881.elb.ap-northeast-1.amazonaws.com
IP4Address: 52.68.3.1
```
The remote IP `52.68.3.1` matches the Supabase production pooler.

### 3.4. ngrok Active Tunnel Configuration
```json
{
  "name": "command_line",
  "public_url": "https://coherent-undrilled-disarm.ngrok-free.dev",
  "proto": "https",
  "config": {
    "addr": "http://localhost:3000"
  }
}
```

---

## 4. Remediation Required to Unblock

Per the strict execution boundary, the agent did **NOT** terminate or restart the backend process.

To safely transition the backend to the isolated QA environment:
1. Stop the current backend process (PID 4588).
2. Start the backend injecting `apps/api/.env.qa` explicitly, for example:
   ```bash
   node --env-file=apps/api/.env.qa --enable-source-maps apps/api/dist/main
   ```
   *(or export `DATABASE_URL` and `DIRECT_URL` pointing to `127.0.0.1:5433/callflow_qa` before launching `node`)*.
3. Verify that `Get-NetTCPConnection -OwningProcess <NEW_PID>` establishes a connection to `127.0.0.1:5433` and has **zero** connections to port `6543`.

---

## 5. Final Verdict

**PHASE 7B-6A — BLOCKED**

*(Execution halted per safety protocol. No database writes, Telnyx mutations, or carrier calls were performed).*
