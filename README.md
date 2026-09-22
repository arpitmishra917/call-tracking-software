# Call Tracking & Sequential Buyer Routing Platform

## Monorepo Architecture

This repository is structured as a standard `npm` workspace monorepo.

### Directory Structure

* `apps/web`: The Next.js + React + TypeScript frontend application.
* `apps/api`: The NestJS + TypeScript backend application.
* `docs/architecture`: Architectural Decision Records (ADRs).
* `src/` & `tests/`: Protected Legacy Telephony Proof of Concept (POC) reference code.

### Prerequisites
* Node.js (v18+)
* npm (v8+)

### Setup

Install dependencies across all workspaces:
```bash
npm install
```

### Development Scripts

**Frontend (Next.js)**
```bash
npm run dev --workspace=apps/web
```

**Backend (NestJS)**
```bash
npm run start:dev --workspace=apps/api
```

**Running Legacy POC Tests**
The legacy POC code in `src/` and `tests/` remains intact as a reference. To run its tests:
```bash
npm test
```

### Environment Variables
For configuring external services (Telnyx, Twilio, Supabase, PostgreSQL), reference `.env.example` at the root and within individual applications when deployed.

> **Note**: This foundation is actively being developed as MVP 1. Please refer to `MVP1_BUILD_SPEC_v5.md` for specific rules and authorized stages.
