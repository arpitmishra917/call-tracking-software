# Incident Response Runbook

This runbook covers common production incidents and their required response steps.

## INCIDENT A: Application Unavailable
**Symptoms:** 502 Bad Gateway or connection timeouts on API/Web.
**First Checks:**
1. Check process uptime (e.g., `pm2 status`).
2. Check reverse proxy logs (Nginx/Caddy).
3. Check API application logs for startup crashes.
**Immediate Containment:** Restart the Node processes (`pm2 restart all`).
**Recovery Action:** If a recent deployment caused the crash, initiate a rollback (see `ROLLBACK.md`).
**Verification:** Run `curl -I https://your-domain.com/api/v1/health` (or basic root endpoint).

## INCIDENT B: Database Unavailable
**Symptoms:** API logs show `PrismaClientInitializationError` or connection timeouts.
**First Checks:**
1. Check PostgreSQL service status.
2. Verify network connectivity between API and Database.
**Immediate Containment:** Stop API traffic at the load balancer to prevent queueing errors.
**Recovery Action:** Restart PostgreSQL service or resolve cloud-provider outage.
**Verification:** Run `npx prisma migrate status` to verify connection is restored.

## INCIDENT C: Telnyx Unavailable
**Symptoms:** Outbound API calls to Telnyx fail with 5xx or timeouts.
**First Checks:**
1. Check [status.telnyx.com](https://status.telnyx.com).
2. Check API logs for Telnyx provider errors.
**Immediate Containment:** 
- Await provider resolution (DO NOT implement unauthorized Twilio production failover).
- Log the incident for customer communication.
**Verification:** Once Telnyx reports resolved, manually test an inbound/outbound call.

## INCIDENT D: Telnyx Webhooks Not Arriving
**Symptoms:** Calls are not routing, no new `Call` or `CallEvent` records appearing in DB.
**First Checks:**
1. Check Telnyx Mission Control portal for webhook delivery errors.
2. Verify API server is publicly accessible and not blocking Telnyx IPs.
**Recovery Action:** Reconfigure Telnyx Connection webhook URL if incorrect. 

## INCIDENT E: Customer Webhooks Failing
**Symptoms:** Customer webhook delivery backlog growing, or deliveries marked `FAILED`.
**First Checks:**
1. Inspect `WebhookDelivery` table.
2. Check `last_error` on failed deliveries.
**Recovery Action:**
- If the customer's server is down, the system's exponential backoff will handle retries (up to 5).
- If the failure is due to SSRF protection (e.g., internal IP blocked), notify the customer their URL is invalid.

## INCIDENT F: Routing Failures
**Symptoms:** Calls immediately disconnect, missing buyer routing.
**First Checks:**
1. Verify workspace has sufficient funds (if billing is implemented).
2. Verify campaign has active, matching buyers with positive concurrency.
3. Check application logs for routing engine errors.

## INCIDENT I: Unexpected Elevated Error Rate
**Symptoms:** High percentage of 500 Internal Server Errors in proxy logs.
**First Checks:**
1. Inspect API logs.
2. Look for newly introduced code regressions or rate limit triggers.
**Recovery Action:** Roll back to the previous deployment if the root cause is a code regression.
