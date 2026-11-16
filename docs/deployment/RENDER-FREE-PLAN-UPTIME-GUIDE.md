# CallFlow — Render Free-Plan Uptime Monitoring & Operational Guide

This guide describes how to monitor the CallFlow backend hosted on a Render Free Web Service using an external uptime-monitoring service (such as UptimeRobot, Better Uptime, or Checkly). It details the platform characteristics of the Render Free tier, configuration steps for external ping monitoring, cold-start diagnosis, and SLA expectations.

---

## 1. Executive Summary & Infrastructure Realities

CallFlow's backend (`callflow-api`) provides a lightweight public health ping route:
```http
GET /health/ping
```
This endpoint responds with HTTP 200 and a minimal JSON payload (`{"status":"ok","service":"callflow-api","timestamp":"..."}`) in sub-millisecond application latency, with zero database queries, zero authentication requirements, and zero carrier API overhead.

### Render Free-Tier Limitations
> [!IMPORTANT]
> **No Guaranteed 24/7 SLA on Render Free**
> Render Free Web Services are designed for development, staging, and hobby use cases. They spin down automatically after **15 minutes of inbound inactivity**. When a new request arrives, a **cold start (~30 to 60 seconds)** occurs before the container resumes serving traffic.
> 
> Periodic external polling (e.g. every 5 minutes) will send inbound traffic to keep the instance responsive, but **external ping monitors do NOT guarantee zero downtime or carrier-grade telephony availability**. 
> 
> Carrier telephony platforms (Telnyx) enforce webhook acknowledgment deadlines of **2000ms to 5000ms**. If an inbound phone call arrives while the Render Free instance is asleep or in cold-start spin-up, **the call will fail or drop**. For live commercial telephony, upgrading to a paid always-on instance (e.g., Render Starter at $7/month) is mandatory.

---

## 2. Uptime Monitoring Configuration (UptimeRobot Example)

To monitor CallFlow availability and maintain responsiveness, configure an external HTTP monitor:

### Step 1: Create New Monitor
1. Log in to your [UptimeRobot Dashboard](https://uptimerobot.com/).
2. Click **+ Add New Monitor**.

### Step 2: Configure Monitor Settings
| Configuration Field | Recommended Setting | Rationale |
| :--- | :--- | :--- |
| **Monitor Type** | `HTTP(s)` | Standard HTTP request to ping route. |
| **Friendly Name** | `CallFlow Production API Ping` | Descriptive identifier for notification alerts. |
| **URL (or IP)** | `https://<YOUR-RENDER-SERVICE-NAME>.onrender.com/health/ping` | Replace `<YOUR-RENDER-SERVICE-NAME>` with your actual assigned Render service subdomain. Never use placeholder or localhost domains. |
| **HTTP Method** | `GET` (or `HEAD`) | Both `GET` and `HEAD` return HTTP 200 on `/health/ping`. `GET` verifies JSON response payload. |
| **Monitoring Interval** | `5 minutes` | Matches standard free UptimeRobot check frequency and remains within Render usage boundaries. |
| **Monitor Timeout** | `60 seconds` | Accommodates Render cold-start latency (~30-60s) so transient spin-up delays do not trigger spurious failure alerts. |
| **Alert Contacts** | Primary Operator Email / PagerDuty / Slack Webhook | Ensure operational team receives downtime notifications immediately. |

### Step 3: Response Validation (Optional Keyword Check)
If your monitoring provider supports keyword or JSON assertion:
- **Keyword Type**: `Alert when keyword is NOT present`
- **Keyword / Pattern**: `"status":"ok"`

---

## 3. Interpreting Timeouts, Cold Starts vs. Application Crashes

When monitoring a free-tier deployment, it is vital to distinguish between a routine cold start and a genuine application crash.

### Distinguishing Sleep/Cold-Start from Application Crash

| Symptom | Platform State | Underlying Cause | Corrective Action |
| :--- | :--- | :--- | :--- |
| **Monitor alerts timeout (HTTP 504 / Connection Timeout)**, followed 1-2 minutes later by recovery | **Instance Cold Start** | Instance was idle for >15 minutes. Uptime monitor or inbound request triggered spin-up. Docker container started and Node.js process initialized in ~35-50s. | Normal behavior on Free tier. If immediate responses are required for production telephony, upgrade to Render Starter. |
| **Monitor receives HTTP 502 Bad Gateway or 503 Service Unavailable** consecutively | **Application Crash or Boot Failure** | NestJS failed to start or crashed on an unhandled exception (e.g. invalid `DATABASE_URL`, missing `SUPABASE_URL`, or port binding error). | Inspect Render Dashboard **Logs** tab immediately. Check for `[CRITICAL STARTUP ERROR]` or stack traces. |
| **Monitor receives HTTP 503 on `/health/ready`** (while `/health/ping` returns 200) | **Database Disconnect** | Supabase database is unreachable, paused, or connection pooler is saturated. The API process is running, but database readiness has failed. | Check Supabase database connectivity, pooler status on port 6543, and connection quota. |
| **Monitor receives HTTP 404 Not Found** on `/health/ping` | **Routing / Ingress Misconfiguration** | Domain name or route typo. Verify URL matches `https://<render-subdomain>.onrender.com/health/ping`. | Verify service URL in Render Dashboard and ensure global prefixes are not misconfigured. |

---

## 4. Manual Verification After Service Wake-Up

To verify application health after a deployment, wake-up, or alert recovery, execute the following manual checks via terminal:

### 1. Public Ping Check (Zero Dependencies)
```bash
curl -I https://<YOUR-RENDER-DOMAIN>.onrender.com/health/ping
```
**Expected Response:**
```http
HTTP/2 200
content-type: application/json; charset=utf-8
```

### 2. Process Liveness Check
```bash
curl https://<YOUR-RENDER-DOMAIN>.onrender.com/health/live
```
**Expected Response:**
```json
{"status":"ok","timestamp":"2026-11-16T12:00:00.000Z"}
```

### 3. Full Database Readiness Check
```bash
curl https://<YOUR-RENDER-DOMAIN>.onrender.com/health/ready
```
**Expected Response:**
```json
{
  "status": "healthy",
  "timestamp": "2026-11-16T12:00:00.000Z",
  "services": {
    "database": {
      "status": "up"
    }
  }
}
```

---

## 5. Free-Tier Usage Limits & Monthly Instance Hours

Render Free accounts provide **750 free instance hours per month** across all free web services:
- A single service running continuously for 31 days consumes `31 × 24 = 744 hours`.
- If you have multiple free services on the same Render account and ping both continuously, you will exhaust the 750-hour free allowance before the month ends, causing **all free services on the account to be suspended** until the next calendar month.
- Ensure only one active free service is running on the account if continuous ping monitoring is active.

---

## 6. Telephony Production Architecture: Why Always-On is Required

> [!CAUTION]
> **Do Not Run Live Commercial Telephony on Render Free**
> 
> Inbound voice calls routed through Telnyx Call Control v2 require rapid webhook response times:
> 1. Inbound call event (`call.initiated`) hits `POST /webhooks/telnyx`.
> 2. Telnyx awaits an HTTP 200 response and call control command (e.g. `answer`, `transfer`, `speak`) within **2.0 to 5.0 seconds**.
> 3. If the Render Free instance is sleeping, the cold start requires **30 to 60 seconds**.
> 4. Telnyx will time out, classify the webhook as failed, and **disconnect the caller**.
> 
> Therefore, while the Free plan is suitable for development, testing, and staging validation, **production commercial operations require a Render Starter instance ($7/month)** which guarantees:
> - Zero spin-down / no sleep behavior.
> - Instant (<100ms) webhook receipt and processing.
> - Stable in-memory call tracking and recovery timers.
> - Guaranteed 24/7 uptime without monthly instance hour limits.
