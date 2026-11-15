# CallFlow — Part 3.4.1: Production Monitoring, Alerting & Disaster Recovery Plan

**Project:** CallFlow  
**Scope:** Production Observability, Alert Matrix, Supabase Backup Verification & Disaster Recovery  
**Git Branch:** `agent/reporting-backend-fix`  
**Status:** **PARTIAL** (Architecture & metrics documented; cloud dashboard items marked UNVERIFIED pending user access)

---

## 1. Production Monitoring Architecture

CallFlow requires monitoring across four operational layers:
1. **Infrastructure & Network:** HTTP availability, TLS validity, DNS resolution, memory/CPU usage.
2. **Application Performance:** Request latency (p95/p99), 4xx/5xx HTTP error rates, rate limit throttling.
3. **Database & Connection Pooling:** Supabase PgBouncer pooler utilization, transaction durations, prepared statement error counts.
4. **Domain Services & Workers:** Telephony webhook delivery, background worker loop ticks, wallet debit consistency, commercial evaluation maturity.

---

## 2. Operational Monitoring & Alerting Matrix

| Metric / Event | Target Threshold | Warning (P2) | Critical (P1) | Recommended Alert Action |
| :--- | :---: | :---: | :---: | :--- |
| **API Health Probe** (`/health/ready`) | 100% Up | 1 failed check (30s) | 3 consecutive failures (90s) | Immediate PagerDuty / On-call dispatch; automated container restart. |
| **API HTTP 5xx Rate** | < 0.05% | > 0.5% over 5m | > 2.0% over 2m | Alert on-call engineer; inspect application error logs. |
| **API Latency (p95)** | < 150 ms | > 500 ms over 5m | > 1,500 ms over 5m | Inspect database slow queries and connection pool wait queue. |
| **Database Pool Connections** | < 70% capacity | > 80% pool utilization | > 95% or pool exhaustion | Investigate unreleased Prisma interactive transactions or idle clients. |
| **Postgres Error `42P05`** | Exactly 0 | 1 occurrence | > 5 occurrences | Verify `?pgbouncer=true` is present in `DATABASE_URL`. |
| **Commercial Worker Loop** | 1 tick / 10 mins | No tick in 20 mins | No tick in 30 mins | Inspect NestJS event loop health and database locks on `call_commercials`. |
| **Commercial Finalization Errors** | 0 errors | 1 unhandled batch error | > 3 consecutive batch failures | Inspect dispute state anomalies or database deadlock errors. |
| **Reservation Recovery Loop** | 1 tick / 5 mins | No tick in 10 mins | No tick in 15 mins | Restart API instance; verify telephony provider API reachability. |
| **Telnyx Inbound Webhook Failures** | < 0.1% | > 1% non-200 responses | > 5% non-200 responses | Immediate telephony incident; calls are failing to route to buyers. |
| **Stripe Payment Webhook Failures** | 0 failures | 1 webhook 4xx/5xx | > 2 consecutive failures | Inspect `STRIPE_WEBHOOK_SECRET` and wallet top-up transactions. |
| **Unsettled Stale Reservations** | 0 older than 2h | > 10 stale reservations | > 50 stale reservations | Investigate `ReservationRecoveryService` provider sync state. |

---

## 3. Recommended Observability Stack

### Tier 1: Uptime & External Probing (Required for Launch)
- **Tool:** **BetterStack** (BetterUptime) or **UptimeRobot**.
- **Probes:**
  - `GET https://api.callflow.io/health/ready` every 60 seconds (HTTP 200 validation).
  - `GET https://app.callflow.io/` every 60 seconds.
- **Alert Channel:** Email + Slack / Discord webhook.

### Tier 2: Application Logging & APM (Required for Launch)
- **Tool:** **Sentry** (for unhandled backend and frontend runtime exceptions) + **Logtail / Papertrail / Datadog** for centralized log aggregation.
- **Integration:** Initialize Sentry in `apps/api/src/main.ts` and `apps/web/src/instrumentation.ts`.

---

## 4. Supabase Backup, PITR & Disaster Recovery Verification

### 4.1 Backup & PITR Audit Status

| Backup Component | Requirement | Audited Value / Status | Verification Evidence | Action Required |
| :--- | :--- | :---: | :--- | :--- |
| **Local Pre-Import Backup** | Valid PostgreSQL dump | **VERIFIED** | `calltracking_mvp_pre_import_2026-11-06T18-45-27-394Z.dump` (779,154 bytes) | Backup stored securely in `backups/`. |
| **Supabase Automated Daily Backups** | Daily snapshots (at least 7 days) | **UNVERIFIED** | Controlled via Supabase Cloud Organization settings. | Project owner must confirm backup retention tier in Supabase Dashboard. |
| **Supabase Point-in-Time Recovery (PITR)** | Sub-minute restore capability | **UNVERIFIED** | Feature restricted to Supabase Pro/Team organizations with PITR addon. | Project owner must verify if PITR is purchased and enabled on project `uwycbvnqnpnfisvvbabu`. |
| **Direct SQL Backup Capability** | `pg_dump` over direct port 5432 | **VERIFIED** | Direct port `5432` (`DIRECT_URL`) verified accessible. | Custom scheduled `pg_dump` can be automated via cron if PITR is unavailable. |

---

### 4.2 Disaster Recovery Targets

| Metric | Target | Description |
| :--- | :---: | :--- |
| **RPO (Recovery Point Objective)** | **< 15 minutes** | Maximum allowable data loss window in the event of catastrophic storage failure. With Supabase PITR, RPO is `< 1 minute`. With daily backups only, RPO is up to `24 hours` (unacceptable for production call billing). |
| **RTO (Recovery Time Objective)** | **< 30 minutes** | Maximum allowable duration to restore full service availability following a disaster declaration. |

---

### 4.3 Supabase Disaster Recovery & Restore Testing Procedure

1. **Catastrophic Failure Scenario:** Database corruption, accidental schema drop, or unrecoverable hardware failure on the primary Supabase instance.
2. **Point-In-Time Restoration Procedure:**
   - Log into Supabase Dashboard ➔ Select Project `uwycbvnqnpnfisvvbabu` ➔ Settings ➔ Backups ➔ Point in Time.
   - Select point-in-time recovery timestamp prior to the incident (e.g. $T_{incident} - 5\text{ minutes}$).
   - Initiate restore to a new project or clone.
   - Update `DATABASE_URL` and `DIRECT_URL` in API secrets manager to point to the restored database pooler.
   - Restart `apps/api`.
   - Run verification suite: `scratch/phase_3_3_audit.cjs` to confirm 43 tables, exact row count parity, and zero orphaned records.
3. **Periodic Recovery Drill:**
   - Conduct a semi-annual recovery drill: Restore a backup snapshot into a temporary staging project and execute the full test suite (`test:e2e`).
