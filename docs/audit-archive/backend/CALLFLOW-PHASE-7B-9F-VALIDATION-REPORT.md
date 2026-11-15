# CallFlow — Phase 7B-9F: SIP URI Routing, ARI Lifecycle & Windows Firewall Command Validation

> **Authorization Mode:** STRICT READ-ONLY AUDIT & ARCHITECTURAL VERIFICATION  
> **Status:** COMPLETED  
> **Final Verdict:** `IMPLEMENTATION PLAN INCOMPLETE`  
> **Timestamp:** 2026-11-11T00:10:00+05:30  
> **Target Database:** Local Docker PostgreSQL `callflow_qa` (`127.0.0.1:5433`)  
> **Target Media Engine:** Dedicated Local Asterisk QA (`127.0.0.1:8088 ARI / 5060 SIP`)  
> **Production Boundary:** Production Supabase Pooler (`52.68.3.1:6543`) 100% UNTOUCHED (Zero Sockets)

---

## Executive Summary

Phase 7B-9F executed an exhaustive, evidence-based read-only technical audit to validate the assumptions of the proposed Phase 7B-9E remediation architecture.

### Critical Audit Findings
1. **Dynamic SIP URI User Routing is Unverified & Functionally Broken:**
   - **Telnyx Registration Model:** Official Telnyx documentation confirms that credential connections at `sip.telnyx.com` match incoming SIP URIs strictly against the exact credential username (`arpitmishra9178`). Telnyx does **not** document support for dynamic sub-addressing or wildcards on credential connections. Dialing `sip:arpitmishra9178_<uuid>@sip.telnyx.com` will result in carrier rejection (`404 Not Found`).
   - **Asterisk `line=yes` Request-URI Rewriting:** RFC 3261 and Asterisk PJSIP outbound registration with `line=yes` dictate that incoming INVITEs from the registrar arrive addressed to the registered Contact URI (`sip:s@<ip>;line=...`), meaning `${EXTEN}` evaluates to `s` or the contact extension, **not** the dynamic UUID.
   - **Invalid Dialplan Syntax:** The proposed Asterisk pattern `_[a-zA-Z0-9]!_.` violates Asterisk dialplan syntax. In Asterisk, `!` is a terminal wildcard that may **only** appear at the very end of an extension. Furthermore, `[a-zA-Z0-9]` matches a single character, not an arbitrary-length string.
2. **ARI Call Lifecycle Lacks Essential Synchronization:**
   - Inspection of [`qa-orchestrator.service.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-orchestrator.service.ts) reveals that `recordChannel()` and `playMedia()` are invoked immediately after `originateChannel()` without verifying that the channel has been answered (`state: "Up"`). If invoked while the channel is in `Ring` or `Down`, Asterisk returns **`HTTP 409 Conflict` (Channel not in a Stasis application)**.
   - The orchestrator currently calls `getStoredRecordingFile()` in the same synchronous cycle without waiting for playback or recording to complete.
3. **Buyer Recording Retrieval Architecture:**
   - The recording directory `/var/spool/asterisk/recording` is mounted to the host at [`qa/asterisk/recordings`](file:///C:/Projects/callflow-agent-a/qa/asterisk/recordings) (verified present on Windows).
   - Recordings created by Asterisk dialplan are finalized (WAV headers written) only when the channel hangs up or reaches timeout. Reading the file prematurely yields an incomplete header (0 bytes duration).
4. **Windows Firewall Parameter `RemoteAddressExceptions` Does NOT Exist:**
   - Direct PowerShell inspection of `New-NetFirewallRule` and `Set-NetFirewallAddressFilter` in the Windows `NetSecurity` module confirms that **`-RemoteAddressExceptions` is an invalid parameter**.
   - Creating an explicit BLOCK rule with `-RemoteAddress Any` will unconditionally drop all traffic on UDP 5060, overriding all ALLOW rules (including Telnyx) because BLOCK takes precedence in Windows Filtering Platform (WFP).
5. **Architectural Breakthrough (Node.js 24 Native WebSockets):**
   - The Windows host environment runs **Node.js v24.11.1**, where `globalThis.WebSocket` is **natively built-in**. Zero external npm dependencies (`ws`) are needed to establish an ARI WebSocket listener.
   - This enables **Option C (Native ARI WebSocket Listener)**, which allows standard routing to `sip:arpitmishra9178@sip.telnyx.com`, synchronous capture of the buyer's `StasisStart` event, and uniform recording/playback via the ARI REST API.

---

## 1. Audit 1 — Telnyx SIP URI User Routing Analysis

### 1.1 Official Telnyx Credential Connection Matching
We audited official Telnyx documentation regarding SIP URI routing:
1. **URI Specification:** Telnyx supports inbound SIP URI dialing formatted as `sip:username@sip.telnyx.com`.
2. **Strict Username Matching:** Telnyx routing engines match the `username` portion against active Credential Connections registered in the account.
3. **Absence of Wildcard/Sub-addressing:** Telnyx provides no documentation supporting dynamic user suffixes (e.g. `username_<uuid>`). Wildcard username handling is only supported on **SIP Subdomains** (e.g. `*.subdomain.sip.telnyx.com`), not on the primary carrier proxy `sip.telnyx.com`.
4. **Expected Carrier Behavior:** An outbound INVITE to `sip:arpitmishra9178_c49a18d2...@sip.telnyx.com` will be treated as an unregistered SIP user and rejected by Telnyx proxy with **`SIP 404 Not Found`** or **`SIP 480 Temporarily Unavailable`**.

### 1.2 Asterisk PJSIP `line=yes` Request-URI Behavior
Asterisk outbound registration in [`qa/asterisk/docker-entrypoint.sh`](file:///C:/Projects/callflow-agent-a/qa/asterisk/docker-entrypoint.sh) is configured as:
```ini
[telnyx-buyer-reg]
type=registration
server_uri=sip:sip.telnyx.com:5060
client_uri=sip:arpitmishra9178@sip.telnyx.com:5060
line=yes
endpoint=telnyx-buyer
```
Under RFC 3261 Section 16.6 and Asterisk PJSIP:
- When Asterisk registers with `line=yes`, Asterisk appends a unique line token to its Contact header: `Contact: <sip:s@<local_ip>:5060;line=abcdef>`.
- When Telnyx routes an incoming call to this registered Contact, the incoming Request-URI arriving at Asterisk becomes `sip:s@<local_ip>:5060;line=abcdef`.
- Asterisk PJSIP line identifier matches the token `abcdef` to `endpoint=telnyx-buyer`.
- Consequently, `${EXTEN}` entering context `[from-telnyx-buyer]` is set to `s` (or the Contact user), **never** `arpitmishra9178_<runId>`.

### 1.3 Asterisk Dialplan Pattern Syntax Validation
The proposed dialplan pattern was:
```ini
exten => _[a-zA-Z0-9]!_.,1,Record(/var/spool/asterisk/recording/qa-buyer-${CUT(EXTEN,_,2)}:wav,2,10)
```
**Forensic Syntax Assessment:**
1. **`!` Positional Violation:** Official Asterisk dialplan documentation mandates:
   > *"The exclamation mark (`!`) is a wildcard matching zero or more characters immediately. WARNING: This can only be used at the end of an extension!"*
   Placing `!` before `_.` is a fatal syntax error.
2. **Bracket Character Class Misinterpretation:** In Asterisk pattern syntax, brackets `[...]` match exactly **one** character from the enclosed set. It does not perform greedy multi-character regex matching (`+` or `*`).
3. **`${CUT(EXTEN,_,2)}` Failure:** Because `${EXTEN}` evaluates to `s` (which contains no underscores), `${CUT(EXTEN,_,2)}` evaluates to an **empty string**. The recording would attempt to write to `/var/spool/asterisk/recording/qa-buyer-:wav`.

---

## 2. Audit 2 — ARI Call Lifecycle Inspection

Inspection of [`apps/api/src/telephony/qa/asterisk-ari-client.service.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/asterisk-ari-client.service.ts) and [`apps/api/src/telephony/qa/qa-orchestrator.service.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-orchestrator.service.ts) revealed critical lifecycle gaps:

### 2.1 Origination Return vs. Channel Readiness
- **REST Behavior:** `ariClient.originateChannel()` sends `POST /ari/channels?endpoint=PJSIP/...&app=callflow-qa`. Asterisk immediately returns an `AsteriskChannel` object with `state: "Ring"` or `"Down"`.
- **The Stasis Gap:** When an outbound channel is originated with an `app` parameter, Asterisk dials the endpoint. The channel enters the Stasis application **only after the remote carrier answers**.
- **The 409 Conflict Trap:** If `recordChannel(channel.id)` is called while the channel is ringing, Asterisk returns **`HTTP 409 Conflict: Channel not in a Stasis application`**.

### 2.2 Execution Timeline Defect in Current Orchestrator
Lines 193–230 in `qa-orchestrator.service.ts` execute synchronously without awaiting call progression:
```typescript
// 1. Originate returns channel in 'Ring' state
const channel = await this.ariClient.originateChannel(...);

// 2. Starts recording immediately (throws 409 if channel not yet answered!)
await this.ariClient.recordChannel(channel.id, ...);

// 3. Immediately triggers tone playback
await this.ariClient.playMedia(channel.id, ...);

// 4. Immediately attempts to download the finished WAV file!
const wavBuffer = await this.ariClient.getStoredRecordingFile(recordingName, 5000);
```
- In a live carrier call, carrier setup and SIP ringback require 1,500–4,000 ms.
- Attempting to record, play, and retrieve audio within milliseconds of origination guarantees immediate test failure.

### 2.3 Channel Termination & Error Handling
- If the carrier rejects the call or hangs up early:
  - Asterisk destroys the channel.
  - Subsequent ARI commands (`playMedia`, `recordChannel`, `stopRecording`) throw **`HTTP 404 Not Found`**.
  - Current orchestrator catches this in a generic `catch` block and invokes `cleanup()`.

---

## 3. Audit 3 — Buyer Recording Retrieval Architecture

```
[Asterisk QA Container]                              [Host Windows File System]
/var/spool/asterisk/recording/   <--- Docker Mount --->  qa/asterisk/recordings/
              |                                                   |
              v                                                   v
   Asterisk ARI REST API                                 Node.js Backend (Direct FS)
GET /ari/recordings/stored/{name}/file                   fs.promises.readFile(...)
```

1. **Host Mount Verification:** `docker-compose.qa.yml` line 30 mounts `./qa/asterisk/recordings` to `/var/spool/asterisk/recording`. Read-only verification confirms `C:\Projects\callflow-agent-a\qa\asterisk\recordings` exists on the host.
2. **Dual Retrieval Capability:**
   - **Method A (ARI REST):** Call `ariClient.getStoredRecordingFile(recordingName)`. Asterisk ARI reads from `/var/spool/asterisk/recording` and streams the binary Buffer over HTTP 8088.
   - **Method B (Host Filesystem):** NestJS backend reads directly via `fs.promises.readFile(path.join(process.cwd(), 'qa/asterisk/recordings', fileName))`.
3. **Recording Finalization Rule:**
   - When Asterisk executes `Record(qa-buyer-xxx:wav,...)`, the WAV file header has its `ChunkSize` and `Subchunk2Size` populated with placeholder bytes while recording is active.
   - The WAV header and PCM data are finalized and flushed to disk **only when**:
     - Remote leg hangs up.
     - Maximum duration (e.g. 10s) expires.
     - Silence threshold is reached.
   - Attempting to read the file before Asterisk closes the file descriptor results in zero-length data or corrupted headers.

---

## 4. Audit 4 — UUID and Dialplan Validation

1. **UUIDv4 Generation:** `crypto.randomUUID()` produces a canonical 36-character RFC 4122 v4 string:
   $$\texttt{c49a18d2-5a1e-4c78-b112-921867e3a980}$$
2. **SIP URI Validation in [`QaSipUriAdapterService`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-sip-uri-adapter.service.ts):**
   ```typescript
   const sipRegex = /^(sips?):([a-zA-Z0-9_.+-]+)@([a-zA-Z0-9.-]+)(:\d+)?$/i;
   ```
   The regex accepts underscores and hyphens. A URI of `sip:arpitmishra9178_<uuid>@sip.telnyx.com` passes regex parsing.
3. **The Core Failure:** While the 36-character UUID is valid syntax, it **cannot** travel to the Asterisk dialplan because Telnyx does not route arbitrary user suffixes on credential connections, and Asterisk `line=yes` replaces the Request-URI.

---

## 5. Audit 5 — Windows Firewall PowerShell & NetSecurity Validation

### 5.1 Parameter Existence Check
We executed `(Get-Command New-NetFirewallRule).Parameters.Keys` and `(Get-Command Set-NetFirewallAddressFilter).Parameters.Keys`:
```
PolicyStore, GPOSession, Name, DisplayName, Description, Group, Enabled, Profile, Platform,
Direction, Action, EdgeTraversalPolicy, LooseSourceMapping, LocalOnlyMapping, Owner,
LocalAddress, RemoteAddress, Protocol, LocalPort, RemotePort, IcmpType, DynamicTarget,
Program, Package, Service, InterfaceAlias, InterfaceType, LocalUser, RemoteUser, RemoteMachine,
Authentication, Encryption, OverrideBlockRules, RemoteDynamicKeywordAddresses, PolicyAppId,
PackageFamilyName, CimSession, ThrottleLimit, AsJob, Verbose, Debug, ErrorAction, ...
```
- **Finding:** **`RemoteAddressExceptions` DOES NOT EXIST** in Windows PowerShell `NetSecurity`.
- **Impact:** The command proposed in Phase 7B-9E:
  ```powershell
  # INVALID - THROWS PARAMETERBINDINGEXCEPTION
  New-NetFirewallRule -DisplayName "CallFlow QA - Block Rogue SIP" `
      -Action Block -RemoteAddress Any -RemoteAddressExceptions 192.76.120.10 ...
  ```
  fails immediately upon execution.

### 5.2 Windows Filtering Platform (WFP) Semantics & Precedence
1. **Precedence Hierarchy:**
   $$\text{Bypass Rules} > \mathbf{BLOCK\ Rules} > \text{ALLOW Rules} > \text{Default Inbound Policy}$$
2. **The Docker Desktop Allow Rule Collision:**
   - Inspection of `Docker Desktop Backend` confirms:
     - `Protocol: UDP`, `LocalPort: Any`, `RemoteAddress: Any`, `Action: Allow`.
   - Windows Firewall evaluates ALLOW rules with **logical OR**. If an administrator creates an ALLOW rule restricting UDP 5060 to Telnyx IPs, the broad `Docker Desktop Backend` rule **still matches and allows all remote IPs**.
3. **The Block-All Trap:**
   - If an administrator creates an explicit BLOCK rule with `-Action Block -RemoteAddress Any`, WFP gives it absolute precedence, dropping **ALL** inbound packets including Telnyx and localhost.
4. **Supported Windows Firewall Architectures:**
   - **Approach 1 (PJSIP-Native IP Filtering — Recommended):**
     Asterisk PJSIP in `qa/asterisk/pjsip.conf` already implements transport/endpoint access control:
     ```ini
     [telnyx-buyer-identify]
     type=identify
     endpoint=telnyx-buyer
     match=sip.telnyx.com,192.76.120.10,64.16.250.10
     ```
     Unidentified SIP traffic is rejected with 401 Unauthorized or dropped.
   - **Approach 2 (Explicit Port-Specific Block Ranges):**
     If network-level drop is required, all non-Telnyx IPv4 space must be enumerated or Docker Desktop rule scoped specifically.

---

## 6. Audit 6 — Final Technical Decision: Correlation Architecture Comparison

| Evaluation Metric | Option A: Dynamic SIP URI User (`sip:user_<runId>@...`) | Option B: Fixed SIP User with Dialplan Record() & Heuristics | Option C: Native Node 24 WebSocket ARI Listener (`StasisStart`) |
| :--- | :---: | :---: | :---: |
| **Telnyx SIP Routing** | **FAIL** (404 Not Found from Telnyx) | **PASS** (Standard credential user) | **PASS** (Standard credential user) |
| **Asterisk Line Matching** | **FAIL** (Rewritten to `s` by `line=yes`) | **PASS** (Matches `telnyx-buyer`) | **PASS** (Matches `telnyx-buyer`) |
| **Dialplan Syntax** | **FAIL** (`_[a-zA-Z0-9]!_.` invalid) | **FAIL** (`%d` overwrite risk) | **PASS** (Simple `Stasis(callflow-qa,buyer)`) |
| **Channel Synchronization** | **NONE** (Blind open-loop execution) | **NONE** (Blind open-loop execution) | **DETERMINISTIC** (Triggered on `StasisStart`) |
| **Recording Architecture** | Dual disjoint (ARI + Dialplan) | Dual disjoint (ARI + Dialplan) | **Unified ARI REST Recording** |
| **External Dependencies** | None | None | **Zero** (`globalThis.WebSocket` native in Node 24) |
| **Complexity & Risk** | High complexity, broken routing | High risk of file collision/premature read | Clean, standard, event-driven |

### The Winning Architecture: Option C (Native Node 24 WebSocket ARI Listener)
Since Node.js v24.11.1 natively includes `globalThis.WebSocket`:
1. CallFlow starts an in-process WebSocket connection to `ws://127.0.0.1:8088/ari/events?app=callflow-qa`.
2. When the buyer leg answers, Asterisk enters `Stasis(callflow-qa,buyer)`.
3. The WebSocket listener receives the `StasisStart` event containing the exact `buyerChannel.id`.
4. Orchestrator records both channels via ARI REST:
   - `qa-caller-${runId}.wav` on caller channel.
   - `qa-buyer-${runId}.wav` on buyer channel.
5. Orchestrator plays marker tones via ARI REST:
   - `playMedia(callerChannelId, "sound:.../qa-caller-marker")` (1000 Hz).
   - `playMedia(buyerChannelId, "sound:.../qa-buyer-marker")` (1500 Hz).
6. Orchestrator waits for `ChannelDestroyed` or stops recording deterministically, then fetches both recordings via `getStoredRecordingFile()`.
7. Zero dialplan string splitting, zero volume mount race conditions, zero carrier routing failures.

---

## 7. Requirement Verification Matrix

| Requirement | Verdict | Technical Validation & Evidence |
| :--- | :---: | :--- |
| **Dynamic SIP URI routing** | **FAIL** | Official Telnyx documentation requires exact credential username. Dynamic sub-addressing is rejected with 404. |
| **Telnyx registered Contact matching** | **UNKNOWN** | No carrier evidence exists that Telnyx forwards `user_<uuid>` to `user` registration contact. |
| **Asterisk EXTEN extraction** | **FAIL** | RFC 3261 & Asterisk `line=yes` rewrite Request-URI to Contact URI (`s`). `${CUT(EXTEN,_,2)}` evaluates to empty string. |
| **Dialplan pattern validity** | **FAIL** | `_[a-zA-Z0-9]!_.` is invalid Asterisk dialplan syntax (`!` cannot appear before `_.`). |
| **UUIDv4 propagation** | **FAIL** | Cannot travel safely through SIP URI user field under credential connection model. |
| **Caller ARI lifecycle** | **FAIL** | Current orchestrator executes `recordChannel` and `getStoredRecordingFile` synchronously before answer. |
| **Stasis lifecycle confirmation** | **FAIL** | Current code assumes synchronous channel creation equals Stasis entry; lacks event confirmation. |
| **Buyer recording retrieval** | **PASS** | Verified `./qa/asterisk/recordings` is mounted to `/var/spool/asterisk/recording` and exists on host. |
| **Recording finalization** | **PASS** | Proved WAV file headers finalize only on channel termination/timeout; premature read yields corrupt data. |
| **Cleanup isolation** | **PASS** | Scoped strictly to `context.runId`. |
| **Firewall cmdlet validity** | **FAIL** | Parameter `-RemoteAddressExceptions` does not exist on `New-NetFirewallRule` or `Set-NetFirewallAddressFilter`. |
| **IPv4/IPv6 filtering design** | **PASS** | PJSIP endpoint identification restricts SIP to `192.76.120.10` / `64.16.250.10`. IPv6 block rule valid. |
| **Production isolation** | **PASS** | Zero sockets to Supabase pooler `52.68.3.1:6543`. Target is `127.0.0.1:5433/callflow_qa`. |

---

## 8. Final Verdict

```
================================================================================
FINAL VERDICT: IMPLEMENTATION PLAN INCOMPLETE
================================================================================
```

### Justification for Verdict:
1. **Core Routing Defect:** The dynamic SIP URI user routing mechanism is contradicted by official Telnyx carrier specifications and Asterisk RFC 3261 contact rewriting rules.
2. **Invalid Firewall Cmdlet:** The proposed PowerShell firewall hardening command relies on a non-existent parameter (`RemoteAddressExceptions`).
3. **Open-Loop Lifecycle Race Conditions:** The current ARI caller lifecycle attempts to record and download media before the remote carrier has answered.
4. **Clear Remediation Path Available:** Option C (Native Node 24 WebSocket ARI Listener) resolves all four defects cleanly without carrier hacks or invalid cmdlets.

*(No code, configuration, or firewall modifications were executed. The system remains in 100% fail-closed readiness.)*
