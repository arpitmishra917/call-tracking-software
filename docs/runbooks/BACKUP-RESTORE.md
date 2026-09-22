# PostgreSQL Backup & Restore Procedure

This runbook defines the procedures for backing up and restoring the PostgreSQL database.

## Architecture Context
The application uses PostgreSQL (v15) as its primary data store.
- **Implemented status:** Manual backups documented. Automated backups depend on the host infrastructure (e.g., AWS RDS, Supabase, Google Cloud SQL).

## 1. Backup Procedure

### What is backed up?
- The entire `calltracking` database, including all tables, data, schemas, and the `_prisma_migrations` history table.

### Backup Frequency Recommendation (Not Automated)
- **Daily:** Full automated backups.
- **Continuous:** Write-Ahead Logging (WAL) archiving for Point-in-Time Recovery (PITR) if supported by your cloud provider.
- **Before schema changes:** Manual backup before running `npx prisma migrate deploy`.

### Manual Backup Command
Using `pg_dump`:
```bash
pg_dump -U testuser -h localhost -p 5432 -F c -b -v -f /path/to/backup/calltracking_$(date +%Y%m%d_%H%M%S).dump calltracking
```
*(Replace user, host, and port with your production credentials. Never log the password; use `.pgpass` or standard environment variables like `PGPASSWORD` temporarily).*

### Backup Storage Requirements
- Backups should be stored securely (e.g., encrypted S3 bucket) and in a different region/availability zone from the primary database.
- Recommended retention: 30 days.

---

## 2. Restore Procedure

### When to Restore
- After catastrophic data loss or accidental deletion.
- When a database migration fails destructively and cannot be resolved via Prisma tools.

### Restoration Steps

1. **Isolate the database:**
   Stop the API server to prevent new writes during restoration.
   ```bash
   pm2 stop call-tracking-api
   ```

2. **Drop or Recreate the Database (if necessary):**
   *(Proceed with extreme caution)*
   ```bash
   dropdb -U testuser -h localhost calltracking
   createdb -U testuser -h localhost calltracking
   ```

3. **Restore from Backup:**
   Using `pg_restore`:
   ```bash
   pg_restore -U testuser -h localhost -p 5432 -d calltracking -v /path/to/backup/calltracking_YYYYMMDD_HHMMSS.dump
   ```

4. **Verify Database Integrity:**
   - Connect via `psql` and check that critical tables (`Workspace`, `Call`, `WebhookDelivery`) exist and contain data.
   - Verify the `_prisma_migrations` table matches the expected state.

5. **Restart Services:**
   ```bash
   pm2 start call-tracking-api
   ```

6. **Post-Restore Smoke Tests:**
   - Login to the Web UI.
   - Initiate a test call (if safe to do so) to ensure routing and database writes are functioning.
   - Check API logs for immediate errors.
