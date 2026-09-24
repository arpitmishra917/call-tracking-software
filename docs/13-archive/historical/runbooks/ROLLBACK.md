# Production Rollback Procedure

This runbook defines how to safely roll back the application and configuration after a failed deployment.

## 1. Application Rollback

If a new code deployment introduces critical regressions:
1. **Identify the previous known-good commit:**
   ```bash
   git log --oneline
   ```
2. **Checkout the commit:**
   ```bash
   git checkout <commit-hash>
   ```
3. **Rebuild the Application:**
   ```bash
   cd apps/api && npm run build
   cd ../web && npm run build
   ```
4. **Restart Processes:**
   ```bash
   pm2 restart all
   ```

## 2. Database Rollback

**WARNING:** Never blindly reverse production migrations (`prisma migrate down` is generally discouraged or unsupported in Prisma without strict manual oversight).

If a deployed migration corrupted data or is incompatible with the rollback code:
1. Determine if the schema change is purely additive (e.g., adding a new table or nullable column). If additive, rolling back the application code is usually sufficient and safe.
2. If the schema change was destructive or modified types, you must **restore from backup** (see `BACKUP-RESTORE.md`).
3. After restoring the pre-migration database, apply the application code rollback.

## 3. Configuration Rollback

If an environment variable change caused the outage:
1. Revert the `.env` changes.
2. Restart the application processes so they pick up the reverted environment variables.

## 4. Post-Rollback Verification

Always perform the following checks after a rollback:
- **API Health:** `curl -I https://your-domain.com/api/v1/health`
- **Authentication Test:** Ensure users can log in via Supabase.
- **Webhook Verification:** Trigger a test webhook from Telnyx to ensure the older code still correctly processes signatures and states.
