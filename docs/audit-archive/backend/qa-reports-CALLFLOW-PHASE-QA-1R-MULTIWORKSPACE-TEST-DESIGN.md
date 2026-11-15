# CallFlow Phase QA-1R: Multi-Workspace Test Design & Ingress Architecture Reconciliation

**Document ID:** `CALLFLOW-PHASE-QA-1R-MULTIWORKSPACE-TEST-DESIGN`  
**Phase:** CALLFLOW-PHASE-QA-1R (Evidence Reconciliation & Safety Boundary Clarification)  
**Author:** Agent 4 — Telephony, Asterisk ARI, SIP, RTP & Recording Infrastructure  
**Supporting Agents:** Agent 2 (Backend), Agent 3 (Web UI)  
**Mode:** STRICT READ-ONLY FORENSIC RECONCILIATION  
**Repository Working Copy:** [`CALLFLOW-PHASE-QA-1R-MULTIWORKSPACE-TEST-DESIGN.md`](file:///C:/Projects/callflow-agent-a/qa/reports/CALLFLOW-PHASE-QA-1R-MULTIWORKSPACE-TEST-DESIGN.md)  

---

## 1. Executive Summary

During Phase QA-1, the capability matrix concluded that verifying multi-workspace concurrency on live carrier trunks was blocked because only one workspace (`5e20bafe-7306-4da7-9944-62c4c5575a5a`) and one dedicated tracking DID (`+17252574041`) exist in the isolated QA environment.

This reconciliation investigates:
1. Whether multi-workspace testing *necessarily* requires purchasing or provisioning a second carrier DID.
2. The architectural differences between database isolation, application routing, shared ingress, and live carrier ingress.
3. The exact minimum infrastructure required for each level of multi-workspace verification.

---

## 2. Ingress Routing Architecture: How CallFlow Maps Calls to Workspaces

Inspection of [`apps/api/src/telephony/call-controller.ts`](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/call-controller.ts#L287-L348) confirms how incoming carrier calls are resolved:

```typescript
// apps/api/src/telephony/call-controller.ts: lines 287-290
const trackingNumber = await this.prisma.phoneNumber.findFirst({
  where: { phone_number: to! },
  include: { workspace: true, campaign: true },
});
```

### Key Architectural Constraints:
1. **1-to-1 Mapping:** In the database schema, a `PhoneNumber` record belongs to exactly one `workspace_id` and one `campaign_id`.
2. **Deterministic Lookup:** When a call arrives from the carrier, the dialed number (`to`) is the sole primary key used to identify the tenant workspace.
3. **No Dynamic Workspace Routing on Same Carrier DID:** Two distinct workspaces cannot bind to the exact same external DID simultaneously for inbound carrier calls. If `+17252574041` is bound to Workspace A, all live carrier calls arriving on that DID resolve exclusively to Workspace A.

---

## 3. Dissecting the Five Verification Levels

We categorize multi-workspace verification into five distinct operational tiers:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        MULTI-WORKSPACE VERIFICATION HIERARCHY                         │
├─────────────────────┬──────────────────────┬─────────────────────┬─────────────────────┤
│ Level 1: Database   │ Level 2: App-Level   │ Level 3: Shared     │ Level 4/5: Live     │
│ Schema Isolation    │ Routing Emulation    │ Ingress Campaigns   │ Carrier Concurrency │
├─────────────────────┼──────────────────────┼─────────────────────┼─────────────────────┤
│ Zero DIDs / Zero    │ Zero Carrier DIDs    │ Single Workspace    │ Multiple Live DIDs  │
│ Telephony           │ Synthetic Webhooks   │ Multi-Campaign      │ Simultaneous PSTN   │
│ Unit/Integration    │ API & DB Isolation   │ Pool Routing        │ Full Cloud Trunks   │
└─────────────────────┴──────────────────────┴─────────────────────┴─────────────────────┘
```

### Level 1: Database-Level Workspace Isolation
- **Definition:** Verifies that Workspace 1 and Workspace 2 maintain strict relational data isolation in PostgreSQL. Queries, updates, wallet debits, and reservations in Workspace 1 cannot view or corrupt Workspace 2.
- **Does it require a second carrier DID?** **NO.**
- **Minimum Infrastructure Required:**
  - Dedicated QA PostgreSQL database (`127.0.0.1:5433/callflow_qa`).
  - Two workspace records created in DB (`Workspace-1`, `Workspace-2`).
  - Synthetic test harness (e.g. [`apps/api/test/database-isolation.spec.ts`](file:///C:/Projects/callflow-agent-a/apps/api/test/database-isolation.spec.ts)).
- **Verification Status:** **ALREADY FULLY VERIFIED.**

### Level 2: Application-Level Routing Isolation (Synthetic Ingress)
- **Definition:** Injects simulated Telnyx webhooks into `TelnyxWebhookController` with synthetic DIDs:
  - Synthetic DID `+15550000001` mapped to `Workspace-1` / `Campaign-1`.
  - Synthetic DID `+15550000002` mapped to `Workspace-2` / `Campaign-2`.
  Verifies that concurrent HTTP webhook requests trigger parallel waterfall routing, independent wallet deductions, separate buyer reservations, and isolated logging.
- **Does it require a second carrier DID?** **NO.**
- **Minimum Infrastructure Required:**
  - Running API instance.
  - Two workspace records and two synthetic `PhoneNumber` rows in QA DB.
  - Synthetic webhook runner (`supertest` or HTTP client).
  - Cost: **$0.00 USD (Zero carrier spend)**.

### Level 3: Multiple Campaigns via Shared Ingress (Single Tenant)
- **Definition:** Within a *single* workspace, multiple campaigns or buyer waterfalls are evaluated.
- **Does it require a second carrier DID?** **NO (if using dynamic routing) or YES (if using static 1-to-1 DIDs).**
- **Note:** In CallFlow's architecture, if two campaigns operate within the same workspace, each campaign still requires a dedicated tracking number unless an IVR/menu routing layer dispatches them dynamically.

### Level 4: Independent Carrier Ingress Through Separate DIDs
- **Definition:** Telnyx receives live PSTN calls to two different real phone numbers:
  - Real DID 1 (`+17252574041`) routed to `QA Workspace A`.
  - Real DID 2 (e.g. `+1725257XXXX`) routed to `QA Workspace B`.
- **Does it require a second carrier DID?** **YES.**
- **Minimum Infrastructure Required:**
  - Two provisioned Telnyx DIDs assigned to Call Control App `3090207513618941231`.
  - Two distinct workspaces in `callflow_qa` database.
  - Available prepaid balance ($1.00–$2.00/month per DID + per-minute PSTN rates).

### Level 5: Actual Simultaneous Calls Across Independent Workspaces
- **Definition:** Two or more live PSTN callers place simultaneous calls to two distinct workspaces, bridging to two distinct buyers over real carrier trunks, validating that tenant locks do not create cross-tenant bottlenecks or deadlocks.
- **Does it require a second carrier DID?** **YES (for live PSTN); NO (for local Asterisk/SIP).**
- **Alternative via Local SIP/ARI:** Asterisk can inject two concurrent SIP calls with custom SIP request URIs / headers (`X-QA-Workspace`) or synthetic DIDs into Stasis, simulating cross-workspace concurrency without carrier toll costs.

---

## 4. Minimum Infrastructure Comparison Matrix

| Verification Tier | Multi-Workspace Scope | Carrier DID Required? | Telnyx Spend Required? | Asterisk PJSIP Required? | Existing QA Capable Today? |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **Tier 1: DB Isolation** | Relational data & wallets | ❌ NO | ❌ NO ($0.00) | ❌ NO | ✅ YES (100% Ready) |
| **Tier 2: App Routing** | Concurrent webhooks & locks | ❌ NO | ❌ NO ($0.00) | ❌ NO | ✅ YES (Needs DB seed) |
| **Tier 3: Local ARI/SIP** | Simultaneous audio & channels | ❌ NO | ❌ NO ($0.00) | ✅ YES | ✅ YES (Needs dialplan seed) |
| **Tier 4: Live Carrier Ingress**| Inbound PSTN routing per tenant | ✅ YES (2 DIDs) | ⚠️ YES (~$1.00 DID fee)| ✅ YES | ❌ BLOCKED (Only 1 DID) |
| **Tier 5: Live Cross-Tenant**| Simultaneous PSTN bridging | ✅ YES (2 DIDs) | ⚠️ YES (DID + Usage) | ✅ YES | ❌ BLOCKED (Only 1 DID) |

---

## 5. Architectural Recommendation for Phase QA-2

1. **Avoid Unnecessary DID Procurement:** It is not necessary to spend capital purchasing additional carrier DIDs to prove multi-workspace concurrency.
2. **Execute Tier 2 & Tier 3 First:**
   - Seed `Workspace-2` in `127.0.0.1:5433/callflow_qa`.
   - Run parallel synthetic webhooks (Tier 2) to prove that `SELECT ... FOR UPDATE` locks are strictly scoped by buyer/workspace and that transactions in Workspace 1 never block Workspace 2.
   - Run parallel Asterisk `Local/` channels (Tier 3) to prove simultaneous dual-leg audio recording across distinct workspace contexts.
3. **Reserve Live Carrier Multi-DID for Pre-Production Staging:** Live carrier multi-workspace tests should be executed only after synthetic multi-workspace concurrency has passed with 100% confidence.

**Reconciliation Conclusion:** A second carrier DID is required **strictly for live carrier PSTN ingress**. All software routing, database isolation, concurrent lock independence, and multi-tenant audio processing can be verified today without purchasing a second phone number.
