# Monitoring and Alerting Procedure

This document outlines the required production monitoring and alerting for the MVP.

## 1. Monitoring

The following monitoring targets are **DOCUMENTED** and recommended for the production operator to implement using standard infrastructure tooling (e.g., Datadog, New Relic, or AWS CloudWatch):

### Application
- **API/Web availability:** External ping to the application URL.
- **Process uptime:** PM2 process uptime or container restart count.
- **CPU/Memory:** Host metrics.

### Database
- **Connection failures:** Monitor API logs for Prisma connection timeouts.
- **Migration status:** Ad-hoc verification via `npx prisma migrate status`.

### Telephony
- **Provider API failures:** Monitor API logs for 5xx responses from Telnyx.
- **Routing failures:** Monitor `Call` table for an abnormal spike in unrouted calls.

### Webhooks
- **Delivery backlog:** Monitor the `WebhookDelivery` table where `status = 'PENDING'`.
- **Permanent failures:** Monitor `WebhookDelivery` where `status = 'FAILED'`.

### Security
- **Rate-limit events:** Monitor API logs for 429 Too Many Requests.
- **Authentication/Authorization failures:** Monitor for 401/403 responses.

---

## 2. Alerting

The following alerts are **RECOMMENDED** but must be manually configured in your infrastructure dashboard:

| Alert | Condition | Severity | Operator Action |
| ----- | --------- | -------- | --------------- |
| API Unavailable | HTTP ping fails 3 times in 5 mins | CRITICAL | Restart API process, check logs. |
| Database Unavailable | Prisma throws connection errors continuously | CRITICAL | Verify DB host status, restore if needed. |
| High Webhook Backlog | `COUNT(WebhookDelivery)` where `status='PENDING'` > 100 | WARNING | Check if worker is running or if customers are experiencing downtime. |
| Elevated Error Rate | >5% of HTTP responses are 500s over 10 mins | WARNING | Inspect API logs, investigate recent deployment, consider rollback. |
| Telnyx Outage | Spike in Telnyx API timeout errors | CRITICAL | Confirm on status.telnyx.com, notify customers. |

## 3. Log Inspection

The application logs JSON/text output to standard output (`stdout`). 

**How to inspect logs:**
- If using PM2: `pm2 logs call-tracking-api`
- If using Docker: `docker logs <container_id>`

**Correlation:**
To correlate a production call across logs and database records, search logs for the `call_id` or `provider_call_id`. 

> **SECURITY REMINDER:** Never search for or output sensitive secrets like `password`, `TELNYX_API_KEY`, or user API keys in logging dashboards.
