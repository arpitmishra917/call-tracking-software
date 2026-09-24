# Database Migration Procedure

This document explains the required procedure to run schema changes (migrations) in a production environment using Prisma.

## Prerequisites
- A verified backup of the database has been taken (see `BACKUP-RESTORE.md`).
- Direct access to run `npx prisma migrate deploy` in the production environment or a CI/CD runner with production database access.

## 1. Migration Inspection
Before deploying migrations, inspect the current state of the database:
```bash
cd apps/api
npx prisma migrate status
```
This command confirms which migrations have already been applied and which are pending.

## 2. Migration Execution
To apply pending migrations to the database:
```bash
cd apps/api
npx prisma migrate deploy
```
> **CRITICAL:** Do NOT run `npx prisma db push` or `npx prisma migrate dev` in production. These commands are destructive and can result in data loss.

## 3. Migration Verification
After execution, verify that all migrations were applied successfully:
```bash
cd apps/api
npx prisma migrate status
```
The output should indicate that the database is up to date.

## 4. Application Deployment Ordering
If an API release introduces new schema requirements:
1. Stop the application (optional if the deployment is zero-downtime and migrations are purely additive).
2. Run `npx prisma migrate deploy`.
3. Start/Restart the application with the new code that references the new schema.

## 5. Failure Handling and Rollback
If a migration fails mid-execution:
1. **Do NOT blindly reverse or delete migration files.**
2. Inspect the `_prisma_migrations` table to identify the failure state:
   ```sql
   SELECT * FROM _prisma_migrations ORDER BY started_at DESC LIMIT 5;
   ```
3. If the database is in an inconsistent state, use `npx prisma migrate resolve` to mark failed migrations as rolled back (if you manually repaired the database) or applied (if you manually applied the SQL).
4. If the database schema cannot be easily repaired, execute a full database restoration from the pre-migration backup (see `BACKUP-RESTORE.md`).
