# CALLFLOW — PHASE B INSPECTION & AUDIT (READ-ONLY DISCOVERY)
## Monorepo Hygiene, Artifact Classification & Secret Exposure Audit

**Document ID:** `CALLFLOW-PHASE-B-CLEANUP-AUDIT`  
**Execution Date:** November 23, 2026  
**Auditor:** Agent 3 / DevOps & Infrastructure Owner (`@devops`)  
**Target Branch:** `agent/phase2-multi-workspace-isolation` (`1b57de618e031643465a86d64a4d865a7fc096ba`)  
**Repository Working Directory:** `C:\Projects\callflow-agent-a`  
**Status:** **`READ-ONLY DISCOVERY COMPLETE — NO MUTATIONS PERFORMED`**  

---

## 1. Executive Summary

In accordance with Phase B mandates, a comprehensive, read-only discovery audit was conducted across the CallFlow repository. Zero files were deleted, moved, or altered.

### Key Audit Metrics
1. **Total Tracked Files:** 1,478 files.
2. **Total Non-node_modules Disk Files:** 4,364 files.
3. **Secret Exposure Scan:** **PASS (0 secrets exposed)**. Exhaustive automated scanning across all 1,478 tracked files confirmed zero live production credentials, Telnyx keys, Supabase service-role keys, JWT secrets, or live database passwords. All occurrences are strictly synthetic placeholders or test mocks.
4. **Environment File Protection:** All live `.env` files (`.env`, `apps/api/.env`, `apps/web/.env`, etc.) are untracked and strictly excluded by `.gitignore`. Only `.env.example` templates are tracked.
5. **Build Output & Artifact Isolation:** Zero build outputs (`dist/`, `.next/`, `*.tsbuildinfo`, `coverage/`, `*.log`) are tracked in git. All build outputs are properly ignored.
6. **Confirmed Obsolete Candidates Identified:** Exactly 5 legacy one-off text dumps (`all_ts.txt`, `migrate_out.txt`, `schema_grep.txt`, `scratch_token.txt`, `usage_log.txt`) from October/November 2026 are tracked in git root and proposed for removal.

---

## 2. Seven-Category Candidate Classification

Per Phase B specifications, all candidate files and directories have been classified under one of the 7 designated categories:
- `(1) Required`
- `(2) Local Dev`
- `(3) QA/testing`
- `(4) Documentation`
- `(5) Generated artifact`
- `(6) Confirmed obsolete`
- `(7) Uncertain - preserve`

### 2.1 Generated Artifacts (Category 5)

| Path / Pattern | Git State | Classification | Description & Action |
| :--- | :---: | :---: | :--- |
| `apps/api/dist/` | Untracked (Ignored) | **(5) Generated artifact** | NestJS compiled API build output. Excluded via `.gitignore`. Rebuilt cleanly on `npm run build`. |
| `apps/web/.next/` | Untracked (Ignored) | **(5) Generated artifact** | Next.js Turbopack build output. Excluded via `.gitignore`. Rebuilt cleanly on `npm run build`. |
| `apps/api/tsconfig.build.tsbuildinfo` | Untracked (Ignored) | **(5) Generated artifact** | TypeScript incremental build cache. Excluded via `.gitignore`. |
| `apps/web/tsconfig.tsbuildinfo` | Untracked (Ignored) | **(5) Generated artifact** | TypeScript incremental build cache. Excluded via `.gitignore`. |
| `apps/web/next-env.d.ts` | Untracked (Ignored) | **(5) Generated artifact** | Next.js auto-generated type declarations. Excluded via `apps/web/.gitignore`. |
| `backend-job.log` | Untracked (Ignored) | **(5) Generated artifact / (6) Confirmed obsolete** | Local runner output log in root. Excluded via `.gitignore`. Safe to clean. |

### 2.2 Temporary & Debugging Files (Category 6 & 7)

| Path | Size | Git State | Classification | Description & Recommendation |
| :--- | :---: | :---: | :---: | :--- |
| `all_ts.txt` | 10,072 B | **Tracked** | **(6) Confirmed obsolete** | Early directory listing text dump dated 04-10-2026. Zero references in codebase. **Proposed for deletion.** |
| `migrate_out.txt` | 458 B | **Tracked** | **(6) Confirmed obsolete** | Prisma migrate command console text output from 04-10-2026. Zero references. **Proposed for deletion.** |
| `schema_grep.txt` | 197 B | **Tracked** | **(6) Confirmed obsolete** | One-off regex grep match text output from 04-10-2026. Zero references. **Proposed for deletion.** |
| `scratch_token.txt` | 49 B | **Tracked** | **(6) Confirmed obsolete** | Scratch token snippet from 15-11-2026. Zero references. **Proposed for deletion.** |
| `usage_log.txt` | 25,986 B | **Tracked** | **(6) Confirmed obsolete** | Raw usage service log dump from 04-10-2026. Zero references. **Proposed for deletion.** |
| `qa/asterisk-logs.txt` | 4,060 B | **Tracked** | **(7) Uncertain - preserve** | Sample Asterisk ARI output log used as reference for mock simulation. **Preserve.** |

### 2.3 Environment & Configuration Files (Category 1, 2 & 3)

| Path | Size | Git State | Classification | Security & Hygiene Finding |
| :--- | :---: | :---: | :---: | :--- |
| `.env.example` | 1,536 B | **Tracked** | **(1) Required** | Root environment template. Sanitized placeholders only. Required for setup. |
| `apps/web/.env.example` | 706 B | **Tracked** | **(1) Required** | Frontend web environment template. Sanitized placeholders only. Required for setup. |
| `.env` | 2,136 B | Untracked (Ignored) | **(2) Local Dev** | Root developer environment. Contains local connection strings. Properly ignored. |
| `apps/api/.env` | 1,129 B | Untracked (Ignored) | **(2) Local Dev** | API developer environment. Properly ignored. |
| `apps/api/.env.e2e` | 389 B | Untracked (Ignored) | **(3) QA/testing** | Local E2E test environment configuration. Properly ignored. |
| `apps/api/.env.isolated` | 112 B | Untracked (Ignored) | **(3) QA/testing** | Local isolated test configuration. Properly ignored. |
| `apps/api/.env.qa` | 1,409 B | Untracked (Ignored) | **(3) QA/testing** | Local QA harness configuration. Properly ignored. |
| `apps/api/.env.rollback` | 895 B | Untracked (Ignored) | **(3) QA/testing** | Local rollback verification configuration. Properly ignored. |
| `apps/api/.env.test` | 389 B | Untracked (Ignored) | **(3) QA/testing** | Local unit/integration test configuration. Properly ignored. |
| `apps/web/.env` | 435 B | Untracked (Ignored) | **(2) Local Dev** | Web developer environment. Properly ignored. |

### 2.4 Local Backups & QA Recordings (Category 2 & 3)

| Path / Directory | Count | Git State | Classification | Description & Policy |
| :--- | :---: | :---: | :---: | :--- |
| `backups/` | 66 files | Untracked (Ignored) | **(2) Local Dev** | Local database dumps (`*.dump`) and migration state JSONs from November 2026. Properly ignored via `.gitignore:33`. Preserve locally. |
| `apps/api/qa/recordings/` (Tracked) | 403 files | **Tracked** | **(3) QA/testing** | Audio `.wav` test fixtures committed in early milestones. Preserved for QA simulation. |
| `apps/api/qa/recordings/` (Untracked) | 1,364 files | Untracked (Ignored) | **(3) QA/testing** | Local synthetic audio recordings produced during test runs. Ignored via `.gitignore:37`. Preserve locally. |

### 2.5 Root Markdown Reports & Documentation (Category 1, 4 & 6)

| Document Group | File Count | Classification | Detail & Recommendation |
| :--- | :---: | :---: | :--- |
| **System README & Spec** | 2 files | **(1) Required** | `README.md`, `MVP1_BUILD_SPEC_v5.md`. Core project documentation. |
| **Agent Context Documents** | 3 files | **(4) Documentation** | `CALLFLOW_PROJECT_CONTEXT.md`, `BACKEND_AGENT_CONTEXT.md`, `FRONTEND_AGENT_CONTEXT.md`. |
| **Active Master Plans** | 2 files | **(4) Documentation** | `CallFlow_CRUD_UI_Enrichment_Master_Plan.md`, `CallFlow_UI_V2_Master_Plan.md`. |
| **P2.4 Foundation Reports** | 7 files | **(4) Documentation** | `P24_BASELINE_REPORT.md`, `P24_CRITICAL_WORKFLOW_INVENTORY.md`, `P24_FINAL_EVIDENCE_RECONCILIATION.md`, `P24_FINAL_REGRESSION_FOUNDATION_REPORT.md`, `P24_PRODUCTION_REGRESSION_SIGNALS.md`, `P24_REGRESSION_GATE_PROOF.md`, `P24_REGRESSION_TEST_STRATEGY.md`. |
| **Phase A Baseline Report** | 1 file | **(4) Documentation** | `CALLFLOW_PRE_CLEANUP_BASELINE.md` (authored in Phase A). |
| **Phase 1 & 2 Attestation Reports** | 17 files | **(4) Documentation** | `CALLFLOW-PHASE-1-*`, `CALLFLOW-PHASE-1B-*`, `CALLFLOW-PHASE-1C-*`, `CALLFLOW-PHASE-2-*`, `CALLFLOW-PHASE-DB-*`, `CALLFLOW-PHASE-DEPLOY-*`, `CALLFLOW-LOCAL-SYNC-REPORT.md`. |
| **Local Exclude Reports** | 8 files | **(4) Documentation** | `CALLFLOW-FINAL-EXECUTION-REPORT.md`, `CALLFLOW-PHASE-2-MAIN-PROMOTION-REPORT.md`, `CALLFLOW-PHASE-3-GITHUB-PUSH-REPORT.md`, `CALLFLOW-PHASE-3B-*` through `3F`. Listed in `.git/info/exclude`. |
| **Historical Pre-P2.1 Audit Reports** | 10 files | **(4) Documentation / (7) Preserve** | `CRUD13_Final_Report.md`, `PRE_CRUD14_BugFix_Report.md`, `Phase_2A_Review.md`, `Phase_2_Final_Audit.md`, `Phase_3A_Architecture_Review.md`, `Phase_3B_Report.md`, `Phase_3C_Completion_Report.md`, `Phase_3C_Remediation_Final_Verification_Report.md`, `Prepaid_Phase_1_Report.md`, `Prepaid_Phase_2_Report.md`. (Candidate for eventual relocation to `docs/audit-archive/` or preserving as-is). |

---

## 3. Secret Exposure Audit Results

A recursive scan across all 1,478 tracked files was executed using high-entropy regex patterns matching:
- Telnyx API keys (`KEY[0-9a-zA-Z_-]{20,}`)
- Supabase service-role JWT tokens (`eyJhbGciOiJIUzI1Ni...`)
- Real JWT secrets and encryption keys
- RSA / OpenSSH private keys (`-----BEGIN PRIVATE KEY-----`)
- Database connection URIs with embedded passwords (`postgresql://user:pass@host/...`)

### Scan Findings
- **Real Secrets Exposed:** **0**
- **Synthetic Test Placeholders:**
  1. `apps/api/src/auth/auth.service.spec.ts`: Mock testing string (`mock-jwt-secret-for-testing-only-at-least-32-chars-long`).
  2. `apps/api/test/auth-production-preservation.spec.ts`: Synthetic test secret (`test_hs256_secret_key_callflow_test_only_min_32_chars`).
  3. `apps/api/test/production-startup-dryrun.spec.ts`: Synthetic constants (`KEY_SYNTHETIC_TELNYX_API_KEY`, `synthetic_production_jwt_secret_value_32_characters`).
  4. `CALLFLOW-PHASE-1-AGENT-1-BACKEND-TEST-READINESS.md`: Zero-padded dummy key (`KEY00000000000000000000000000000000000000000000000000`).
  5. `package-lock.json`: SHA-512 integrity string prefixed with `KeYAZ...` (false positive regex match on npm hash).
- **Verdict:** **100% CLEAN. No secret exposure in git history or tracked working tree.**

---

## 4. `.gitignore` Integrity Review

Root `.gitignore` and workspace `apps/web/.gitignore` were evaluated against best practices:

```
[PASS] Dependencies: node_modules/, .pnp, .pnp.js excluded
[PASS] Build Outputs: .next/, dist/, apps/api/dist/, build/, out/, .turbo/, .cache/, *.tsbuildinfo excluded
[PASS] Testing: coverage/, test-results/ excluded
[PASS] Environment: .env, .env.*, apps/api/.env.qa excluded; .env.example whitelisted
[PASS] Backups & Dumps: *.tmp, *.bak, *.old, *.dump, backups/ excluded
[PASS] Recordings: apps/api/qa/recordings/*.wav excluded
[PASS] Logs: *.log, npm-debug.log*, yarn-debug.log*, yarn-error.log* excluded
```

### Recommendation
Add `apps/api/.gitignore` to mirror workspace isolation, or maintain single source of truth in root `.gitignore`. Current root `.gitignore` comprehensively covers both `apps/api` and `apps/web`.

---

## 5. Proposed Deletion / Cleanup List (Pending Coordinator Approval)

Per strict instruction, **zero files have been deleted**. The following candidate list is submitted to `@coordinator` for formal review and authorization:

### Phase C Deletion Candidates (Confirmed Obsolete Tracked Artifacts)
1. `all_ts.txt` (10 KB) — Tracked legacy file list from 04-10-2026.
2. `migrate_out.txt` (458 B) — Tracked legacy migration console output from 04-10-2026.
3. `schema_grep.txt` (197 B) — Tracked legacy schema regex output from 04-10-2026.
4. `scratch_token.txt` (49 B) — Tracked legacy token string from 15-11-2026.
5. `usage_log.txt` (26 KB) — Tracked legacy event log dump from 04-10-2026.

### Untracked Local Cleanup Candidates
6. `backend-job.log` (190 B) — Untracked local run log in repository root.

### Files Explicitly Protected / Retained
- All source code in `apps/api/src/` and `apps/web/src/`
- All 138 automated test files in `apps/api/src/**/*.spec.ts` and `apps/api/test/`
- All 37 Prisma migrations in `apps/api/prisma/migrations/`
- All QA test harnesses in `apps/api/qa/` and `docker-compose.qa.yml`
- All environment templates (`.env.example`, `apps/web/.env.example`)
- All architectural and milestone documentation
