# Production Release Checklist

Before releasing any new version to production, verify the following:

## SOURCE
- [ ] Correct branch/tag/commit selected.
- [ ] Working tree reviewed.
- [ ] No secrets committed (checked `.env`, `.env.example`, and source files).
- [ ] Dependencies installed (`npm install`).
- [ ] Lockfile consistent.

## TESTS
- [ ] Unit tests pass (`npm run test`).
- [ ] E2E tests pass (`vitest run test/webhooks.e2e-spec.ts`).
- [ ] Typecheck passes (`npm run typecheck`).
- [ ] Lint passes (`npm run lint`).
- [ ] Formatter passes.
- [ ] API build passes (`npm run build` in `apps/api`).
- [ ] Web build passes (`npm run build` in `apps/web`).

## DATABASE
- [ ] Database backup completed before deployment.
- [ ] Migrations reviewed for destructive changes.
- [ ] Migration status verified (`npx prisma migrate status`).

## CONFIGURATION
- [ ] Production environment variables configured.
- [ ] Server-only secrets protected.
- [ ] Browser variables verified.
- [ ] Production provider configuration (Telnyx) verified.

## SECURITY
- [ ] Stage 22 security checks remain intact.
- [ ] CORS configuration verified.
- [ ] API Rate limiting verified.
- [ ] Secure headers verified (Helmet).
- [ ] Webhook signatures verified.
- [ ] Recordings remain private.
- [ ] SSRF protection remains enabled (safeFetch).
- [ ] No sensitive logs exposed.

## OPERATIONS
- [ ] Health checks available.
- [ ] Monitoring configured/documented.
- [ ] Alerts configured/documented.
- [ ] Logs accessible.
- [ ] Backup procedure verified.
- [ ] Restore procedure documented.
- [ ] Incident runbook available.
- [ ] Rollback procedure available.

## PROVIDER
- [ ] Telnyx configuration verified.
- [ ] Telnyx webhook configuration verified.
- [ ] Twilio remains development-only.

## FINAL
- [ ] Smoke test completed.
- [ ] Release owner approval.
- [ ] Release timestamp recorded.
