# Production Deployment Procedure

This document describes how to deploy the MVP1 to a production environment.

## 1. Prerequisites
- Node.js (v18 or higher recommended)
- PostgreSQL (v15 recommended)
- NPM
- A reverse proxy (e.g., Nginx, Caddy) or a platform that manages routing (e.g., Vercel, Heroku, Render)
- System process manager like PM2 (if running on a bare-metal/VPS)

## 2. Repository Checkout
```bash
git clone https://github.com/arpitmishra917/call-tracking-software.git
cd call-tracking-software
```

## 3. Dependency Installation
Install root dependencies and all workspaces:
```bash
npm install
```

## 4. Environment Configuration
Create the required environment files.
```bash
cp .env.example .env
# Edit .env with your actual production secrets

cp apps/api/.env.example apps/api/.env
# Edit apps/api/.env

cp apps/web/.env.example apps/web/.env
# Edit apps/web/.env
```
Ensure all secrets are provided (see the Environment Variable Checklist).

## 5. Database Configuration & Migration
Ensure the PostgreSQL server is running and accessible.
```bash
# Apply migrations to the production database safely
cd apps/api
npx prisma migrate deploy
```
*Note: Do NOT use `prisma db push` or `prisma migrate dev` in production.*

## 6. Application Build
Build the API (NestJS):
```bash
cd apps/api
npm run build
```

Build the Web (NextJS):
```bash
cd apps/web
npm run build
```

## 7. API Deployment
If deploying to a VPS, run the API using PM2:
```bash
cd apps/api
pm2 start dist/main.js --name "call-tracking-api"
```

## 8. Web Deployment
Start the NextJS production server:
```bash
cd apps/web
pm2 start npm --name "call-tracking-web" -- run start
```

## 9. Reverse Proxy Configuration (Example Nginx)
Proxy `/api/v1` traffic to the API (port 3000 default) and other traffic to the Web (port 3001 default).

## 10. Health Verification
Verify the API is running:
```bash
curl -I https://your-domain.com/api/v1/health
```

Verify the Web application:
```bash
curl -I https://your-domain.com/
```

## 11. Rollback Reference
In the event of a deployment failure, stop the PM2 processes and checkout the previous known-good git tag/commit, then re-run `npm run build` and restart PM2.
See `ROLLBACK.md` for detailed instructions on safe migration rollbacks.
