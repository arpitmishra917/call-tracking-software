# Auth Module
## Purpose
Authentication logic, validating Supabase JWTs.

## Responsibilities
Extract Bearer tokens and validate them against Supabase JWKS.

## Architecture
Uses `passport-jwt` and `jwks-rsa`. Configured with `algorithms: ['ES256', 'RS256']`. Validates `issuer` against `SUPABASE_URL/auth/v1` and `audience` as `authenticated`.

## Backend
Implemented in `apps/api/src/auth/`.

## Important files
- `apps/api/src/auth/jwt.strategy.ts`
- `apps/api/src/auth/auth.module.ts`

## Current verification status
IMPLEMENTED and UNIT TESTED.
