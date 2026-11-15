# CALLFLOW — PHASE QA-2A-FINAL: MASTER REPORT CORRECTION ADDENDUM

**Document ID:** `CALLFLOW-PHASE-QA-2A-FINAL-SAFETY-CORRECTION-ADDENDUM`  
**Owner:** Agent 2 — Backend, API, Database & Security  
**Supporting Agents:** Agent 3 (Frontend & Integration), Agent 4 (Telephony & Infrastructure)  
**Phase:** QA-2A Final Consolidation & Formal Closure Gate (QA-2A-FC-FINAL)  
**Execution Mode:** STRICT READ-ONLY FORENSIC CORRECTION  
**Target File:** [`qa/reports/qa-2a-final-consolidation/07-qa2b-safety-correction-addendum.md`](file:///C:/Projects/callflow-agent-a/qa/reports/qa-2a-final-consolidation/07-qa2b-safety-correction-addendum.md)  
**Reference Document:** [`06-master-final-reconciliation.md`](file:///C:/Projects/callflow-agent-a/qa/reports/qa-2a-final-consolidation/06-master-final-reconciliation.md)

---

## 1. Executive Summary & Purpose

This addendum serves as the authoritative safety and technical correction to [`qa/reports/qa-2a-final-consolidation/06-master-final-reconciliation.md`](file:///C:/Projects/callflow-agent-a/qa/reports/qa-2a-final-consolidation/06-master-final-reconciliation.md). 

A rigorous, self-critical forensic review of Report 06 identified several unresolved contradictions, over-generalized safety claims, and premature authorizations. Specifically, this addendum:
1. Re-evaluates `FakeTelephonyProvider` binding in NestJS and retracts the claim that setting `ACTIVE_TELEPHONY_PROVIDER=fake` in `.env` isolates the standard application runtime.
2. Refutes the claim that an empty `TELNYX_API_KEY` guarantees carrier isolation across all system layers.
3. Corrects the risk classification of Stage C SIP testing from "ZERO carrier risk" to "BLOCKED pending carrier topology and billing review".
4. Clarifies the Buyer B concurrency limit discrepancy (2 vs. 5) and establishes a proposed seed specification without executing database mutations.
5. Deconstructs Asterisk Local channel media assumptions, distinguishing theoretical UDP zero-consumption from unverified multi-channel runtime execution.
6. **Formally revokes and removes the unsafe recommendation (previously BLK-06) to set `TELEPHONY_QA_ENABLED=false` as test hygiene**, explicitly warning of its outbound bypass risk.
7. **Strictly decouples the closure of the QA-2A forensic audit from QA-2B execution authorization**, affirming that agent reports cannot grant execution approval and that all subsequent actions require separate human authorization.
8. Distinguishes verified disk hashes from historical file-size discrepancies.

All six foundational reports remain **immutable and unmodified** in `qa/reports/qa-2a-final-consolidation/`.

---

## 2. Mandatory Correction Register (COR-01 through COR-08)

### COR-01 — Telephony Provider Binding in Standard Bootstrap vs. Isolated Test Harness

#### The Master Report Finding:
Section 3 (FC-01) of Report 06 correctly noted that `apps/api/src/telephony/telephony.module.ts` lines 46–62 unconditionally returns `TelnyxProvider`:
```typescript
{
  provide: TELEPHONY_PROVIDER,
  useFactory: (telnyx: TelnyxProvider) => {
    const configuredProvider = (
      process.env.TELEPHONY_PROVIDER ||
      process.env.ACTIVE_TELEPHONY_PROVIDER ||
      ''
    ).toLowerCase();
    if (configuredProvider === 'twilio') {
      throw new Error('FATAL: Twilio provider has been retired and disabled.');
    }
    return telnyx;
  },
  inject: [TelnyxProvider],
}
```

#### Mandatory Correction:
1. **Retraction of Environment-Based Isolation:** Setting `ACTIVE_TELEPHONY_PROVIDER=fake` in `.env` **does NOT isolate the standard NestJS application runtime**. `TelephonyModule` has no dependency injection branch for `FakeTelephonyProvider`. In normal bootstrap (`npm run start:dev` or `main.ts`), `TelnyxProvider` is **always** instantiated and injected.
2. **Exact Provider Override Mechanism for Stage A:** `FakeTelephonyProvider` can only be enforced by **explicitly overriding the provider token in isolated Vitest/Supertest test modules**:
   ```typescript
   const moduleRef = await Test.createTestingModule({
     imports: [AppModule],
   })
     .overrideProvider(TELEPHONY_PROVIDER)
     .useClass(FakeTelephonyProvider)
     .compile();
   ```
3. **Distinction:** Direct unit/integration tests running via `vitest` that compile an overridden `TestingModule` achieve provider isolation. However, launching the full NestJS HTTP server via `main.ts` executes standard bootstrap and **cannot** use `FakeTelephonyProvider` without modifying `telephony.module.ts`.
4. **Classification:** Zero carrier egress is **VERIFIED BY SOURCE CODE** *only* within test suites that explicitly override `TELEPHONY_PROVIDER`. In standard application bootstrap, provider-level fake isolation is **CONTRADICTED**.

---

### COR-02 — Empty `TELNYX_API_KEY` Does Not Guarantee Full-Stack Carrier Isolation

#### The Master Report Finding:
Report 06 stated that if `TELNYX_API_KEY` is empty, `TelnyxProvider` runs in mock mode, preventing outbound carrier API calls.

#### Mandatory Correction:
1. **Node.js REST Layer vs. Asterisk SIP Trunk Layer:** While an empty `TELNYX_API_KEY` prevents the Node.js backend from calling `this.telnyxClient.calls.dial()`, it has **zero effect on Asterisk PJSIP trunks**.
2. **The Asterisk Outbound Path:** Forensic inspection of [`qa/asterisk/docker-entrypoint.sh#L64-L145`](file:///C:/Projects/callflow-agent-a/qa/asterisk/docker-entrypoint.sh#L64-L145) reveals that the live Asterisk container `callflow-asterisk-qa` has `PJSIP/telnyx-caller` configured with `TELNYX_SIP_CONNECTION_ID`, `TELNYX_SIP_USER`, and `TELNYX_SIP_PASS`.
3. **Bypass Vector:** If any process (or test script via Asterisk ARI `POST /ari/channels`) originates a call through `PJSIP/...@telnyx-caller`, Asterisk sends a live SIP INVITE directly to Telnyx SBCs over UDP 5060, completely bypassing Node.js environment variables.
4. **Classification:** Treating an empty `TELNYX_API_KEY` as a full-stack carrier isolation mechanism is **REFUTED**. Full carrier isolation across all software tiers is **UNVERIFIED** unless Asterisk PJSIP credentials are also physically stripped or network egress is blocked.

---

### COR-03 — Stage C Risk Reclassification: SIP Credential Testing

#### The Master Report Finding:
Report 06 classified Stage C ("Internal SIP Protocol Testing") as having "ZERO Carrier Risk".

#### Mandatory Correction:
1. **Retraction of Zero-Risk Classification:** The unconditional "ZERO Carrier Risk" claim for Stage C is **retracted**.
2. **Deconstruction of SIP Topologies:**
   - **Topology 1 — Local Asterisk Loopback:** SIP signaling that remains strictly on `127.0.0.1:5060` between local endpoints (`PJSIP/endpoint-a` to `PJSIP/endpoint-b`). Carrier Risk: **ZERO**.
   - **Topology 2 — Isolated Private Subnet:** SIP signaling across isolated container bridges without public internet access. Carrier Risk: **ZERO**.
   - **Topology 3 — SIP Signaling to Carrier Infrastructure (`sip.telnyx.com`):** Directing SIP INVITEs to `sip:buyer@sip.telnyx.com` traverses public IP networks and interacts with Telnyx proxy servers. Even if calls are not bridged to the PSTN, carrier account behavior, credential authentication counters, SIP transaction logging, and potential account fees are unverified.
   - **Topology 4 — PSTN Termination:** Carrier converts SIP to SS7/ISUP; incurs per-minute toll spend. Carrier Risk: **HIGH**.
3. **Updated Status:** Stage C involves Topology 3 and must be classified as **`BLOCKED PENDING CARRIER TOPOLOGY & BILLING REVIEW`**. It must never be treated as equivalent to local loopback.

---

### COR-04 — Buyer B Database Seed Specification & Concurrency Discrepancy

#### The Master Report Finding:
Report 06 noted a discrepancy where Agent 2 and Agent 4 Report 02 proposed Buyer B limit = 2, while Agent 3 and Agent 4 Report 05 proposed Buyer B limit = 5.

#### Mandatory Correction:
1. **No Seed Execution:** No database mutations, seed commands, or SQL inserts are authorized or executed.
2. **Resolution of the Concurrency Limit Discrepancy (2 vs. 5):**
   - The discrepancy is **not an architectural conflict in CallFlow**, but a difference in test scenario design:
     - **Limit = 2 (Symmetric Design):** Tests a finite capacity on Buyer B identical to Buyer A. If Call 3 and a hypothetical Call 4 arrive, Buyer B accepts 2 calls and saturates on Call 5.
     - **Limit = 5 (Absorbing Sink Design):** Configures Buyer B with excess capacity so that all overflow from Buyer A is guaranteed to be accepted without secondary saturation during a 3-call run.
   - **Resolution:** For the upcoming 3-call concurrency test in QA-2B, **Buyer B `max_concurrent_calls = 2` is the recommended canonical configuration**, as it tests finite capacity constraints symmetrically.
3. **Proposed Schema Seed Specification (Reference Only):**
   - Table `buyers`:
     - `id`: `b0000000-0000-0000-0000-000000000002` (UUID)
     - `workspace_id`: `5e20bafe-7306-4da7-9944-62c4c5575a5a` (FK to `workspaces`)
     - `name`: `"QA Test Buyer B (Overflow)"`
     - `destination_number`: `"+12025550198"` (Valid E.164, distinct from Buyer A)
     - `status`: `"ACTIVE"`
     - `max_concurrent_calls`: `2`
     - `timeout`: `30`
   - Table `destination_numbers` (Phase DN-1 Primary Path):
     - `id`: `d0000000-0000-0000-0000-000000000002` (UUID)
     - `workspace_id`: `5e20bafe-7306-4da7-9944-62c4c5575a5a`
     - `buyer_id`: `b0000000-0000-0000-0000-000000000002`
     - `destination_number`: `"+12025550198"`
     - `max_concurrent_calls`: `2`
     - `status`: `"ACTIVE"`
   - Table `campaign_destination_numbers`:
     - `workspace_id`: `5e20bafe-7306-4da7-9944-62c4c5575a5a`
     - `campaign_id`: `6af31407-3f46-4f1d-90d0-bf08af2e9600`
     - `destination_number_id`: `d0000000-0000-0000-0000-000000000002`
     - `priority`: `2` (Buyer A is Priority 1)
     - `weight`: `100`
     - `status`: `"ACTIVE"`
   - Table `campaign_buyers` (Legacy Route Compatibility):
     - `workspace_id`: `5e20bafe-7306-4da7-9944-62c4c5575a5a`
     - `campaign_id`: `6af31407-3f46-4f1d-90d0-bf08af2e9600`
     - `buyer_id`: `b0000000-0000-0000-0000-000000000002`
     - `priority`: `2`
     - `status`: `"ACTIVE"`
   - **Commercial Side Effects:** Inbound calls converted to Buyer B will evaluate revenue and payout against `campaigns.default_revenue_amount` and `default_payout_amount`.

---

### COR-05 — Stage B Local-Channel Media Assumptions

#### The Master Report Finding:
Report 06 and Report 05 asserted that Asterisk Local channels consume zero UDP ports and operate purely in memory frame queues, guaranteeing support for 3 simultaneous calls.

#### Mandatory Correction:
1. **Signaling vs. Media vs. OS Resources:**
   - **Local Channel Signaling:** When Asterisk originates `Local/ext@context`, it creates two virtual channel halves (`Local/xxx,1` and `Local/xxx,2`). Signaling is internal.
   - **Media Frame Translation:** Audio frames are pushed through Asterisk translation cores. If both ends terminate on internal Asterisk endpoints (`Stasis`, `Playback`, `Record`), no external RTP transport socket is bound, and **UDP consumption for that leg is zero**.
   - **Bridge Traversal:** If a `Local/` channel bridges to an external PJSIP channel, RTP sockets are bound for the PJSIP leg.
   - **Snoop Channels & WAV Disk I/O:** ARI `snoopChannel` (`spy: 'in'`) inserts an audiohook tap. While Snoop does not allocate UDP sockets, each Snoop channel consumes an operating system file descriptor, an Asterisk core audiohook thread, and disk write buffers ($16,000\text{ bytes/sec}$ per 8 kHz PCM mono stream).
2. **Empirical Boundary:** **No 3-call concurrent Local-channel test has been executed in this environment.** Claiming zero UDP consumption and guaranteed 3-call capacity without empirical telemetry is an **`ARCHITECTURAL ASSUMPTION`**. The performance and stability of simultaneous Local channels with 6 concurrent Snoop audiohooks must be validated by executed runtime evidence during Stage B.

---

### COR-06 — Revocation and Removal of Unsafe BLK-06 Recommendation

#### The Master Report Finding:
In Report 00 (line 253) and Report 06 (Section 5, BLK-06), it was recommended:
> *"Align root `.env` to `TELEPHONY_QA_ENABLED=false` before test execution to ensure complete environment hygiene."*

#### Mandatory Correction:
1. **CRITICAL SAFETY REVOCATION:** This recommendation is **FORMALLY WITHDRAWN AND REVOKED**.
2. **Safety Hazard Explanation:**
   - As conclusively proven in Section 3 (FC-01) of Report 06, [`QaTelephonyGuardService.validateDestinationOrThrow`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/qa/qa-telephony-guard.service.ts#L797) explicitly evaluates:
     ```typescript
     if (!this.isQaEnabled()) {
       return; // BYPASS ALLOWLIST!
     }
     ```
   - Setting `TELEPHONY_QA_ENABLED=false` causes the guard to **completely bypass destination allowlist checks** for outbound buyer dialing.
   - Recommending `TELEPHONY_QA_ENABLED=false` as "test hygiene" creates a severe hazard: if a synthetic test triggers an outbound dialing route while `TelnyxProvider` is loaded, the call will dial the live carrier without allowlist restriction!
3. **Correct Rule:**
   - In any environment where real telephony providers could be active, `TELEPHONY_QA_ENABLED=true` must be set, accompanied by an empty allowlist (`TELEPHONY_QA_ALLOWED_DESTINATIONS=""`), which causes the guard to **fail closed** and throw `TelephonyProviderError(ROUTING_FAILED)`.
   - **Zero environment edits are performed.**

---

### COR-07 — Strict Separation of Audit Closure from Execution Authorization

#### The Master Report Finding:
Section 6 (Decision B) of Report 06 stated:
> *"STAGE A: APPROVED TO PROCEED immediately upon executing the authorized database seed..."*  
> *"STAGE B: APPROVED TO PROCEED immediately upon deploying [local-qa-caller]..."*

#### Mandatory Correction:
1. **Jurisdictional Boundary:** An agent-authored audit report **cannot grant operational execution authorization**. Only the human system owner/user has the authority to authorize test execution, database mutations, dialplan updates, or container operations.
2. **Authoritative Clarification:**
   - **Phase QA-2A Audit Closure:** The forensic audit of Phase QA-2A is **COMPLETE and RECOMMENDED FOR CLOSURE**. The analytical objectives of the audit have been achieved under strict read-only conditions.
   - **Phase QA-2B Stage A:** Is **NOT AUTHORIZED** by this report. It remains in status **`BLOCKED PENDING USER AUTHORIZATION & SEED APPROVAL`**.
   - **Phase QA-2B Stage B:** Is **NOT AUTHORIZED** by this report. It remains in status **`BLOCKED PENDING USER AUTHORIZATION & DIALPLAN UPDATE APPROVAL`**.
   - **Database Seeding:** Strictly **PROHIBITED** until separate explicit approval is granted.
   - **Dialplan Updates:** Strictly **PROHIBITED** until separate explicit approval is granted.
   - **ARI Mutations & Channel Origination:** Strictly **PROHIBITED** until separate explicit approval is granted.
   - **Stage C:** Strictly **BLOCKED** pending carrier billing and topology review.
   - **Stage D:** Strictly **BLOCKED & GATED** awaiting explicit human authorization.

---

### COR-08 — Evidence Integrity & Historical File-Size Discrepancies

#### The Master Report Finding:
Section 2 of Report 06 provided disk file sizes and SHA-256 digests, and attempted to explain historical file size variations reported by Agent 3 and Agent 4.

#### Mandatory Correction:
1. **Integrity Baseline:** The current on-disk state of all six consolidation reports is verified and immutable:
   - `00-original-agent-2-audit.md`: 27,848 bytes (`63ffcdd...`)
   - `01-original-agent-3-audit.md`: 19,782 bytes (`585a3eb...`)
   - `02-original-agent-4-audit.md`: 21,171 bytes (`6a38620...`)
   - `03-agent-2-reconciliation.md`: 40,968 bytes (`590a2d2...`)
   - `04-agent-3-reconciliation.md`: 26,610 bytes (`b719ea1...`)
   - `05-agent-4-reconciliation.md`: 31,551 bytes (`c9fc947...`)
2. **Strict Epistemological Distinction:**
   - **Verified Fact:** The disk byte counts and SHA-256 hashes above are **`VERIFIED BY RUNTIME INSPECTION`**.
   - **Historical Observation:** In Report 04, Agent 3 recorded Report 00 as 36,993 bytes. In Report 05, Agent 4 recorded Report 00 as 27,848 bytes.
   - **Unverified Hypothesis:** Explanations regarding CRLF/LF line-ending translations or uncommitted conversation draft buffers are **`UNVERIFIED HYPOTHESES`** because historical snapshots of intermediate agent memory buffers were not cryptographically hashed at the exact microsecond of citation.
3. **Commitment:** All six source reports remain permanently unaltered.

---

## 3. Corrected 5-Stage Risk & Readiness Matrix

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                               CORRECTED 5-STAGE QA-2B RISK & READINESS MATRIX                                  │
├─────────┬──────────────────────┬──────────────────────┬────────────────────────┬──────────────┬────────────────┤
│ STAGE   │ TESTING SCOPE        │ CARRIER RISK         │ TECHNICAL PREREQUISITE │ CODE CHANGES │ EXECUTION      │
│         │                      │ CLASSIFICATION       │                        │ REQUIRED?    │ AUTHORIZATION  │
├─────────┼──────────────────────┼──────────────────────┼────────────────────────┼──────────────┼────────────────┤
│ Stage A │ Fake Provider /      │ ZERO (In-Memory /    │ Authorized seed of     │ NONE         │ NOT AUTHORIZED │
│         │ Backend Concurrency  │ TestModule override) │ Buyer B in callflow_qa │ (In test)    │ (Pending User) │
├─────────┼──────────────────────┼──────────────────────┼────────────────────────┼──────────────┼────────────────┤
│ Stage B │ Standalone Asterisk  │ ZERO (Local PBX;     │ Authorized deploy of   │ NONE         │ NOT AUTHORIZED │
│         │ Local Loopback       │ Frame queues in mem) │ [local-qa-caller] conf │ (Conf only)  │ (Pending User) │
├─────────┼──────────────────────┼──────────────────────┼────────────────────────┼──────────────┼────────────────┤
│ Stage   │ CallFlow Backend to  │ ZERO                 │ Backend provider or    │ YES (New     │ BLOCKED        │
│ B-int   │ Asterisk Local Buyer │                      │ SIP URI rewrite engine │ provider)    │ (Architectural)│
├─────────┼──────────────────────┼──────────────────────┼────────────────────────┼──────────────┼────────────────┤
│ Stage C │ Internal SIP Trunk   │ UNVERIFIED /         │ Secondary Telnyx SIP   │ NONE         │ BLOCKED        │
│         │ Protocol (PJSIP)     │ POTENTIAL BILLING    │ credential provisioned │ (Conf only)  │ (Pending Risk) │
├─────────┼──────────────────────┼──────────────────────┼────────────────────────┼──────────────┼────────────────┤
│ Stage D │ Live Carrier /       │ REAL TOLL SPEND      │ 100% pass Stages A-C;  │ NONE         │ STRICTLY GATED │
│         │ PSTN Termination     │ ($1.87 Telnyx bal)   │ explicit human approval│ (Prod path)  │ (Human Signoff)│
└─────────┴──────────────────────┴──────────────────────┴────────────────────────┴──────────────┴────────────────┘
```

---

## 4. Remaining Unresolved Blockers Prior to Phase QA-2B

| Blocker ID | Domain | Description | Current Status | Required Action Prior to Execution |
|:---:|---|---|:---:|---|
| **BLK-01** | **Database Seed** | `Buyer B` does not exist in `callflow_qa` (`127.0.0.1:5433`). Overflow waterfall cannot be tested without Buyer B. | **BLOCKED** | Await explicit human authorization, then execute verified seed inserting Buyer B (`max_concurrent_calls = 2`). |
| **BLK-02** | **Asterisk Dialplan** | `[local-qa-caller]` missing from `qa/asterisk/extensions.conf`. Asterisk rejects Local channel entry into Stasis. | **BLOCKED** | Await explicit human authorization, then deploy `[local-qa-caller]` context to Asterisk container. |
| **BLK-03** | **Dialer Incompatibility** | `TelnyxProvider` cannot dial `Local/...` channels. Backend buyer legs cannot connect to Asterisk Local channels. | **BLOCKED** | Retain Stage B as standalone Asterisk ARI testing; do not route backend buyer legs to `Local/` channels without code modifications. |
| **BLK-04** | **Browser E2E Missing** | Playwright test runner and browser binaries are not installed in the repository. | **BLOCKED** | Restrict Stage A verification to Supertest API assertions and Vitest component suites. |
| **BLK-05** | **Carrier Isolation** | `TelephonyModule` unconditionally injects `TelnyxProvider` in standard application bootstrap. | **CONDITIONAL** | Restrict Stage A execution strictly to test suites that explicitly override `TELEPHONY_PROVIDER` via `Test.createTestingModule()`. |
| **BLK-06** | **Outbound Guard Bypass**| Setting `TELEPHONY_QA_ENABLED=false` bypasses outbound allowlist checks in `validateDestinationOrThrow()`. | **CORRECTED** | Revoke previous BLK-06 advice. Keep `TELEPHONY_QA_ENABLED=true` with empty allowlist to fail closed in QA environments. |

---

## 5. Authoritative Closure & Authorization Recommendations

### 1. Phase QA-2A Forensic Audit Closure Recommendation
**Recommendation:** **`APPROVED FOR FORMAL CLOSURE`**  
- The analytical, forensic, and cross-agent audit objectives of Phase QA-2A have been executed to 100% completion under strict read-only constraints.
- All technical conflicts, architectural assumptions, and safety bypass risks across Backend, Frontend, and Telephony have been identified, adjudicated, and documented with source-code references.
- Phase QA-2A is ready for administrative closure.

### 2. Phase QA-2B Execution Authorization Status
**Status:** **`AWAITING EXPLICIT HUMAN AUTHORIZATION`**  
- This report does **NOT** authorize the execution of Phase QA-2B Stage A or Stage B.
- No database mutations, seeds, dialplan changes, or container commands may be executed until explicit instruction is issued by the user.

---

**PHASE QA-2A MASTER REPORT CORRECTION ADDENDUM COMPLETE**  
*Agent 2 — Backend, API, Database & Security*  
*November 12, 2026*
