# CALLFLOW — AGENT 2 SECURITY FINDINGS

This document details all security vulnerabilities, authorization flaws, credential risks, and perimeter bypasses discovered during the Agent 2 backend audit.

---

## 1. CRITICAL VULNERABILITIES (SEVERITY P0)

### 1.1 BUG-BE-008: Account Takeover via Workspace Invitation Password Reset
- **Vulnerability**: Critical Account Takeover / Authentication Logic Flaw
- **Component**: `apps/api/src/auth/auth.service.ts:181-190`
- **Impact**: Full administrative account takeover of Workspace Owners.
- **Root Cause**:
  ```typescript
  // auth.service.ts:181-190
  const invite = await this.prisma.workspaceInvitation.findFirst({
    where: {
      email: { equals: normalized, mode: 'insensitive' },
      status: 'ACCEPTED',
    },
  });
  if (invite && invite.status !== 'PENDING' && invite.status !== 'REVOKED' && invite.status !== 'EXPIRED') {
    return { exists: true, userId: invite.created_by || null }; // CRITICAL DEFECT
  }
  ```
  `WorkspaceInvitation.created_by` stores the User ID of the workspace OWNER or ADMIN who sent the invitation, NOT the invited recipient. When an invited member submits a password reset request via `/auth/forgot-password`, `findAccountByEmail` assigns the owner's `userId`. Upon completing the reset at `/auth/reset-password`, `updateSupabasePassword(record.user_id, newPassword)` changes the OWNER's password in Supabase Auth to the attacker's password.
- **Remediation**: Remove `invite.created_by` assignment. Look up the invited user's identity through `WorkspaceMember` joining on `Profile` or query the authentic identity provider directly.

---

### 1.2 BUG-BE-007: Production Credential and Host Leakage in AuthService
- **Vulnerability**: Information Disclosure & Production Environment Boundary Violation
- **Component**: `apps/api/src/auth/auth.service.ts:97, 124, 414`
- **Impact**: Backend communicates with the live production Supabase instance (`https://uwycbvnqnpnfisvvbabu.supabase.co`) during QA / test / dev runs when `SUPABASE_URL` is omitted.
- **Evidence**:
  ```typescript
  // auth.service.ts:97
  const payload = {
    iss: 'supabase',
    ref: 'uwycbvnqnpnfisvvbabu', // Production project reference hardcoded
    role: 'service_role',
    ...
  };

  // auth.service.ts:124, 414
  const supabaseUrl =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    'https://uwycbvnqnpnfisvvbabu.supabase.co'; // Hardcoded production fallback
  ```
- **Safety Violation**: This directly violates the Phase 0 Safety rules and the fail-closed QA database guard in `main.ts:17-23` which forbids `uwycbvnqnpnfisvvbabu` and `supabase.co`.
- **Remediation**: Remove the hardcoded fallback strings. Throw a descriptive configuration error or fail-closed `ServiceUnavailableException` if `SUPABASE_URL` is missing.

---

### 1.3 BUG-BE-006: Public API Endpoints Completely Broken by Incomplete Scope Decorators
- **Vulnerability**: Denial of Service on Public API / Authorization Configuration Error
- **Component**:
  - `apps/api/src/public-api/public-buyers.controller.ts:23-30` (`getBuyer`)
  - `apps/api/src/public-api/public-calls.controller.ts:31-38` (`getCall`)
  - `apps/api/src/public-api/public-campaigns.controller.ts:32-39` (`getCampaign`)
- **Impact**: All API key consumers attempting to fetch a buyer, call detail, or campaign via the public API receive an immediate `403 Forbidden` response.
- **Root Cause**:
  `PermissionsGuard` (`apps/api/src/authorization/permissions.guard.ts:28-36`) contains the following security enforcement:
  ```typescript
  if (!requiredPermission) {
    const scopeMetadata = this.reflector.getAllAndOverride<{
      resourceType: string;
      idParam: string;
    }>(REQUIRE_RESOURCE_SCOPE_KEY, [context.getHandler(), context.getClass()]);
    
    if (scopeMetadata) {
      throw new ForbiddenException('Resource scoped endpoints must specify a required permission');
    }
  ```
  The three public controllers annotate `@RequireResourceScope('...', 'id')` on their `:id` endpoints without annotating `@RequirePermission(...)`. Consequently, `PermissionsGuard` throws a `ForbiddenException` on 100% of requests.
- **Remediation**: Add the missing `@RequirePermission('buyer:read')`, `@RequirePermission('call:read')`, and `@RequirePermission('campaign:read')` annotations to the respective controller methods.

---

## 2. HIGH SEVERITY VULNERABILITIES (SEVERITY P1)

### 2.1 BUG-BE-002: Twilio Webhook Signature Verification Fails Open
- **Vulnerability**: Webhook Authentication Bypass / Request Forgery
- **Component**: `apps/api/src/telephony/twilio/twilio.webhook.controller.ts:22-38`
- **Impact**: Allows unauthenticated attackers to forge Twilio call events (`CALL_INITIATED`, `CALL_ANSWERED`, `CALL_HANGUP`), trigger unauthorized outbound bridges, and terminate live customer calls.
- **Root Cause**:
  ```typescript
  // twilio.webhook.controller.ts:34-38
  } else {
    this.logger.debug(
      'TWILIO_AUTH_TOKEN not configured. Bypassing signature verification.',
    );
  }
  ```
  Unlike `TelnyxWebhookController` (which explicitly throws a `BadRequestException` in QA and production when keys are missing), the Twilio webhook handler silently falls through and processes untrusted HTTP POST bodies without any signature verification.
- **Remediation**: Implement a fail-closed guard identical to Telnyx: if `NODE_ENV === 'production'` or `APP_ENV === 'qa'`, reject requests with `400 Bad Request` if `TWILIO_AUTH_TOKEN` is not configured.

---

### 2.2 BUG-BE-011: Unauthenticated Telephony QA Control Plane Endpoint
- **Vulnerability**: Missing Authentication / Unauthorized Remote Action Execution
- **Component**: `apps/api/src/telephony/qa/qa-test.controller.ts:15-67`
- **Impact**: Anyone with network access can query internal telephony topology (`GET /qa/status`) and trigger Asterisk ARI test calls (`POST /qa/test-run`).
- **Root Cause**: `QaTestController` is decorated with `@Controller('qa')` without `@UseGuards(JwtAuthGuard)` or `@UseGuards(ApiKeyAuthGuard)`. The only guard is an internal flag `isQaEnabled()`. If `TELEPHONY_QA_ENABLED=true` is set on a deployment, the entire test engine is publicly accessible without authentication.
- **Remediation**: Protect `QaTestController` with `@UseGuards(JwtAuthGuard, WorkspaceRolesGuard)` and require `OWNER` or `ADMIN` roles.

---

### 2.3 BUG-BE-013: Absence of Global Request Validation Pipe
- **Vulnerability**: Missing Input Validation / Prototype Pollution / Parameter Injection
- **Component**: `apps/api/src/main.ts:41-70` and `apps/api/src/app.module.ts:25-50`
- **Impact**: Arbitrary unvalidated JSON payloads are ingested across 34 controllers. DTOs decorated with `class-validator` annotations are ignored at runtime unless an explicit `@UsePipes(ValidationPipe)` is placed on the handler.
- **Root Cause**: `main.ts` does not call `app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))` and `AppModule` does not provide `APP_PIPE`.
- **Remediation**: Register `ValidationPipe` globally in `main.ts` or as an `APP_PIPE` provider in `app.module.ts`.

---

### 2.4 BUG-BE-016: Saved Reports Mutable by Viewers and Participants
- **Vulnerability**: Broken Object-Level Authorization (BOLA)
- **Component**: `apps/api/src/reports/reports.controller.ts:20-23, 51, 77, 87`
- **Impact**: Invited Buyer and Vendor users (who receive `report:read` baseline permission) can invoke `POST /workspaces/:workspaceId/reports`, `PATCH ...`, and `DELETE ...`.
- **Root Cause**: `@RequirePermission('report:read')` is placed at the controller class level. There is no `report:manage` or `report:create` permission in `PERMISSIONS_LIST`. Mutating routes inherit `report:read`.
- **Remediation**: Introduce `report:manage` in `PERMISSIONS_LIST` and guard mutating endpoints with `@RequirePermission('report:manage')`.

---

## 3. MEDIUM SEVERITY VULNERABILITIES (SEVERITY P2)

### 3.1 BUG-BE-009 & BUG-BE-010: Inconsistent PermissionsGuard Enforcement
- **Component**:
  - `apps/api/src/api-keys/api-keys.controller.ts:18`
  - `apps/api/src/webhooks/webhooks.controller.ts:17`
- **Impact**: Granular permission revocation does not apply to API Keys or Webhooks.
- **Root Cause**: Both controllers apply `JwtAuthGuard` and `WorkspaceRolesGuard` but omit `PermissionsGuard`. A workspace Admin whose `api_key:manage` or `webhook:manage` permission has been explicitly revoked can still create and delete API keys and webhooks.
- **Remediation**: Add `PermissionsGuard` and `@RequirePermission` decorators to both controllers.

---

## 4. TENANT ISOLATION & FINANCIAL SANITIZATION VERIFICATION

### 4.1 Cross-Tenant Isolation: PASS
- All database queries for campaigns, buyers, calls, phone numbers, and balances consistently filter by `workspace_id`.
- `WorkspaceRolesGuard` verifies that the authenticated user has an active membership record in the target workspace.
- `ApiKeyAuthGuard` verifies that the provided `pk_...` API key matches `request.params.workspaceId`.

### 4.2 Financial Participant Sanitization: PASS
- `SettlementController` strictly strips vendor economics (`payout`, `cost`, `profit`, `vendor_id`) before returning data to Buyer accounts.
- Strictly strips buyer economics (`revenue`, `cost`, `profit`, `buyer_id`) before returning data to Vendor accounts.
- `BillingController` actively blocks participants (`BUYER` and `VENDOR`) via `assertNotParticipant`.
