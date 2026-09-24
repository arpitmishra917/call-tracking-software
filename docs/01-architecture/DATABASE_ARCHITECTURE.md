# Database Architecture
PostgreSQL driven by Prisma ORM (`apps/api/prisma/schema.prisma`).
All tenant-owned models contain a `workspace_id` foreign key. Most deletions cascade from the Workspace.

See `docs/05-database/DATABASE_SCHEMA.md` for full schema definition.
