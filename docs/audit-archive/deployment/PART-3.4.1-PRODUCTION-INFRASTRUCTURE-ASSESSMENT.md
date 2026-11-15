# CallFlow — Part 3.4.1: Production Infrastructure & Hosting Architecture Assessment

**Project:** CallFlow  
**Component:** Backend API (`apps/api`), Frontend UI (`apps/web`), Database (Supabase PostgreSQL)  
**Git Branch:** `agent/reporting-backend-fix`  
**Status:** **PARTIAL** (Architecture fully evaluated; pending user infrastructure selection & provisioning)

---

## 1. Executive Summary & Context

CallFlow is a real-time call tracking, attribution, commercial evaluation, and settlement platform comprising:
- A **NestJS v12** backend API with Prisma ORM v6, running in-process periodic background workers (`CommercialFinalizationService` and `ReservationRecoveryService`) and handling high-frequency asynchronous webhooks from telephony (Telnyx / Twilio) and billing (Stripe) providers.
- A **Next.js v16** frontend (React 19, Turbopack, App Router) leveraging Supabase Auth SSR.
- A **Supabase PostgreSQL 17.6** cloud database in AWS `ap-northeast-1` (Tokyo), accessed via PgBouncer transaction pooling (port 6543) and direct session pooling (port 5432).

This assessment analyzes four potential production hosting architectures against operational criteria, establishes strict single-replica safeguards for background workers, designs a future distributed worker roadmap, and outlines database connectivity requirements.

---

## 2. Hosting Architecture Evaluation

We evaluate four primary deployment architectures for CallFlow based on:
1. **Reliability & Availability** (uptime SLAs, failover, zero-downtime deployments)
2. **Cost Efficiency** (base cost, scaling costs, compute utilization)
3. **Scalability** (ability to handle traffic spikes in call webhooks and reporting)
4. **Operational Complexity** (DevOps overhead, maintenance burden, logging/monitoring)
5. **Deployment Simplicity** (git-push deployments, rollbacks, pipeline integration)

---

### Option 1: Decoupled Cloud PaaS (Recommended)
- **Frontend (`apps/web`):** Hosted on **Vercel** or **AWS Amplify Hosting**.
- **Backend API (`apps/api`):** Hosted on a containerized PaaS such as **Render**, **Railway**, or **Fly.io** (running as a Docker container or Node.js native service).
- **Database:** Managed **Supabase PostgreSQL** (existing).

| Dimension | Rating | Analysis |
| :--- | :---: | :--- |
| **Reliability** | **High (4.5/5)** | Vercel provides global edge CDN for the UI. PaaS platforms (Render/Railway) provide automatic container health checks, automated zero-downtime rollouts, and automatic restart on crash. |
| **Cost** | **Low-Medium (4/5)** | Predictable monthly tier ($20–$50/mo total for staging + production compute). No idle Kubernetes overhead. |
| **Scaling** | **Medium (3.5/5)** | Frontend scales infinitely at edge. API scales vertically with a single slider. Horizontal autoscaling must be constrained to replica=1 until distributed locking is implemented (see Section 3). |
| **Operational Complexity** | **Low (4.5/5)** | Zero server patching, automated TLS certificate provisioning, built-in log streaming, native GitHub deployment webhooks. |
| **Deployment Simplicity** | **Very High (5/5)** | Native git push triggers builds automatically. Preview environments for pull requests. |

---

### Option 2: AWS Containerized Cloud (AWS ECS Fargate + CloudFront/S3 or Amplify)
- **Frontend (`apps/web`):** Hosted on **AWS Amplify Hosting** or **S3 + CloudFront**.
- **Backend API (`apps/api`):** Packaged as a Docker container, stored in **AWS ECR**, running on **AWS ECS Fargate** behind an **Application Load Balancer (ALB)**.
- **Database:** Managed **Supabase PostgreSQL** (existing).

| Dimension | Rating | Analysis |
| :--- | :---: | :--- |
| **Reliability** | **Very High (5/5)** | Enterprise-grade 99.99% infrastructure SLA. ALB multi-AZ health checking and target group draining. |
| **Cost** | **Medium-High (2.5/5)** | ALB base cost (~$25/mo) + Fargate vCPU/RAM + NAT Gateway (~$32/mo if inside private VPC) + ECR storage. Base cost is ~$70–$120/mo before traffic. |
| **Scaling** | **Very High (5/5)** | Seamless vertical and horizontal scaling, AWS Auto Scaling policies. |
| **Operational Complexity** | **High (2/5)** | Requires IAM role management, VPC networking, security groups, task definitions, ECR registries, CloudWatch log groups, and Terraform/CDK infrastructure as code. |
| **Deployment Simplicity** | **Medium (3/5)** | Requires Docker build, ECR login/push, and ECS service update via GitHub Actions. |

---

### Option 3: Traditional Virtual Machine (AWS EC2 / DigitalOcean Droplet + Docker Compose / PM2)
- **Architecture:** A single virtual server (e.g. EC2 `t4g.medium` or DigitalOcean Droplet) running Nginx reverse proxy, PM2 / Docker Compose hosting both `apps/api` and `apps/web`.

| Dimension | Rating | Analysis |
| :--- | :---: | :--- |
| **Reliability** | **Medium (3/5)** | Single point of failure. If the VM hangs or restarts, all services drop until reboot. Requires external watchdog. |
| **Cost** | **Very Low (5/5)** | Flat $12–$24/mo for the VM. |
| **Scaling** | **Low (2/5)** | Strictly vertical scaling. Requires manual server resizing and downtime. |
| **Operational Complexity** | **High (2/5)** | Manual OS security patches, firewall setup, manual Let's Encrypt renewal, manual log rotation, manual process monitoring. |
| **Deployment Simplicity** | **Low (2/5)** | Requires SSH deployment scripts, local git pulls on server, or self-hosted runners. |

---

### Option 4: Serverless API (AWS Lambda via NestJS Serverless + Vercel)
- **Frontend:** Vercel.
- **API:** NestJS compiled into AWS Lambda functions via `@codegenie/serverless-express`.

| Dimension | Rating | Analysis |
| :--- | :---: | :--- |
| **Reliability** | **Low-Medium (2.5/5)** | **INCOMPATIBLE WITH CURRENT ARCHITECTURE:** Background worker loops (`CommercialFinalizationService` and `ReservationRecoveryService`) rely on persistent in-memory `setInterval` timers. In AWS Lambda, processes freeze when idle; background intervals will not fire. |
| **Cost** | **Medium (3.5/5)** | Pay-per-request, but cold starts and connection churn against PgBouncer degrade telephony webhook responsiveness. |
| **Scaling** | **High (4/5)** | Massive concurrency, but connection spikes would overwhelm database pooler limits. |
| **Operational Complexity** | **High (2/5)** | Requires API Gateway mapping, warmers, and complete worker extraction to AWS EventBridge / SQS. |
| **Deployment Simplicity** | **Medium (3/5)** | Serverless Framework / AWS SAM integration. |

---

## 3. Architecture Comparison Matrix & Recommendation

| Criterion | Option 1: Decoupled PaaS (Render/Railway + Vercel) | Option 2: AWS ECS Fargate + CloudFront | Option 3: VM (EC2 / Droplet + PM2) | Option 4: Serverless (Lambda) |
| :--- | :---: | :---: | :---: | :---: |
| **Reliability** | 4.5 / 5 | **5.0 / 5** | 3.0 / 5 | 2.5 / 5 |
| **Cost Efficiency** | **4.5 / 5** | 2.5 / 5 | 5.0 / 5 | 3.5 / 5 |
| **Worker Compatibility** | **5.0 / 5** (Long-running process) | **5.0 / 5** (Long-running task) | **5.0 / 5** (PM2 daemon) | 1.0 / 5 (Frozen execution) |
| **Operational Simplicity**| **4.5 / 5** | 2.0 / 5 | 2.0 / 5 | 2.5 / 5 |
| **Deployment Speed** | **5.0 / 5** | 3.0 / 5 | 2.0 / 5 | 3.0 / 5 |
| **Overall Score** | **23.5 / 25 (94%)** | **17.5 / 25 (70%)** | **17.0 / 25 (68%)** | **12.5 / 25 (50%)** |

### Official Recommendation
> [!IMPORTANT]
> **PRIMARY RECOMMENDATION: Option 1 (Decoupled PaaS)**
> - **Frontend (`apps/web`):** Deploy to **Vercel**. Provides native Next.js Turbopack optimization, automatic preview branches, instant rollbacks, and global edge caching for public assets.
> - **Backend API (`apps/api`):** Deploy as a containerized service on **Render** (or **Railway**). Provides continuous background execution for `setInterval` worker loops, native health-check routing (`/health/ready`), automated zero-downtime deployment, and managed environment secrets.
> - **Scaling Configuration:** Deploy `apps/api` with **`replicas = 1`** (vertical scaling only) to eliminate background worker concurrency hazards until distributed locking is introduced.

---

## 4. Background Worker Safety & Concurrency Architecture

### 4.1 Current Implementation Forensic Audit
The API contains two core periodic background workers defined in NestJS modules:

1. **`CommercialFinalizationService`** ([apps/api/src/commercial/commercial-finalization.service.ts](file:///C:/Projects/callflow-agent-a/apps/api/src/commercial/commercial-finalization.service.ts)):
   - **Interval:** 10 minutes (`FINALIZATION_POLL_INTERVAL_MS = 600,000`).
   - **Startup:** Triggered inside `onModuleInit()` via `setInterval()`.
   - **In-Memory Guard:** `private isProcessing = false` (process-local only).
   - **Database Action:**
     - Selects up to 100 `PENDING` CallCommercial records where `finalizes_at <= now()`.
     - Skips records with active disputes (`dispute.status === 'PENDING'`).
     - Updates status to `FINAL` with atomic SQL condition `WHERE id IN (...) AND status = 'PENDING'`.

2. **`ReservationRecoveryService`** ([apps/api/src/telephony/reservation-recovery.service.ts](file:///C:/Projects/callflow-agent-a/apps/api/src/telephony/reservation-recovery.service.ts)):
   - **Interval:** 5 minutes (`300,000 ms`).
   - **Startup:** Triggered inside `onModuleInit()` via `setInterval()`.
   - **Stale Threshold:** Identifies `ACTIVE` reservations where `updated_at < now() - 15 minutes`.
   - **External Call:** Queries telephony provider `getCallStatus(providerCallId)`.
   - **Database Action:** Updates reservation status, releases expired buyer reservations, and executes `WalletService.settleReservation()` or `releaseReservation()` within a database transaction guarded by pessimistic row locks (`SELECT ... FOR UPDATE`).

---

### 4.2 Multi-Replica Concurrency Hazards
If `apps/api` is scaled horizontally (e.g., 2 or more container replicas running simultaneously):
1. **Duplicate Interval Triggers:** Every container instance initializes its own independent `setInterval` timer upon startup.
2. **Double Query Load:** All instances query Supabase simultaneously every 5 and 10 minutes.
3. **Telephony Provider Rate Limiting:** All instances simultaneously issue external HTTP requests to Telnyx / Twilio API for the same active call IDs, risking third-party rate limiting or webhook race conditions.
4. **Log Clutter and Non-Deterministic Metrics:** Both instances log batch progress, obscuring which instance finalized which record.

---

### 4.3 Mandatory Production Constraints

#### Rule 1: Single-Replica Deployment Mandate (Initial Cutover)
For the initial production deployment:
- `apps/api` **MUST be deployed with exactly 1 replica (`replicas: 1`)**.
- Scaling must be achieved **vertically** (e.g., allocating 1 vCPU / 2GB RAM to the API instance).
- Horizontal auto-scaling **MUST be disabled**.

#### Rule 2: Future Distributed Locking Roadmap (Multi-Replica Scaling)
Before horizontal autoscaling (`replicas > 1`) can be enabled, CallFlow must implement distributed leader election or job locking. Two viable architectures:

1. **PostgreSQL Advisory Locks (Zero Infrastructure Overhead):**
   - Utilize PostgreSQL transaction-level advisory locks via Prisma `$queryRaw`:
     ```sql
     SELECT pg_try_advisory_xact_lock(hashtext('commercial_finalization_worker_lock')) AS acquired;
     ```
   - If `acquired === false`, the worker instance immediately logs `Worker lock busy on another replica, skipping tick` and exits.
   - Requires no Redis or external message broker.

2. **Decoupled Worker Architecture (BullMQ + Redis):**
   - Extract `CommercialFinalizationService` and `ReservationRecoveryService` into a dedicated worker container (`apps/worker`).
   - Deploy API without timers (`ENABLE_BACKGROUND_WORKERS=false`).
   - Run a single worker process dedicated to scheduled jobs and queue processing.

---

## 5. Supabase PostgreSQL Connectivity Analysis

### 5.1 Region & Latency
- **Supabase Project Region:** AWS `ap-northeast-1` (Tokyo, Japan).
- **Latency Considerations:**
  - If hosting on Vercel and Render in Tokyo or Singapore (`ap-southeast-1`), roundtrip latency is `< 15ms`.
  - If hosting in US-East (`us-east-1`), roundtrip latency across the Pacific is `~150ms–180ms`.
  - **Requirement:** Production compute hosting for `apps/api` SHOULD be provisioned in the **Asia-Pacific (Tokyo or Singapore)** region to minimize query roundtrip latency.

### 5.2 Connection Pooling Configuration
- **Transaction Pooler (Port 6543):**
  - Supabase PgBouncer runs in transaction pooling mode.
  - Mandates `?pgbouncer=true` on `DATABASE_URL` to prevent Prisma prepared statement errors (`42P05`).
- **Direct Connection (Port 5432):**
  - Configured under `DIRECT_URL`.
  - Reserved exclusively for Prisma CLI migration operations (`prisma migrate deploy`). Never used for application traffic.

---

## 6. Verification & Artifact Evidence
- Verified API production build: `nest build` completed cleanly (exit code 0).
- Verified Web production build: `next build` completed cleanly (exit code 0).
- Verified lack of container/cloud manifests in git tree: No existing Dockerfile or CI/CD workflow found.
- Verified background worker timers in codebase: Found lines 23-35 of `commercial-finalization.service.ts` and lines 30-36 of `reservation-recovery.service.ts`.
