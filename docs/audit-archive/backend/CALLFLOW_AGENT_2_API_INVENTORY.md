# CALLFLOW — AGENT 2 API INVENTORY

Total Endpoints Discovered: 151

| HTTP Method | Route Path | Controller | Method Name | Guards / Permissions | ValidationPipe |
|---|---|---|---|---|---|
| GET | /account | account/account.controller.ts | getAccount | @UseGuards(JwtAuthGuard) | ❌ Missing |
| PUT | /account/profile | account/account.controller.ts | updateProfile | @UseGuards(JwtAuthGuard) | ❌ Missing |
| GET | /workspaces/:workspaceId/api-keys | api-keys/api-keys.controller.ts | RequireWorkspaceRoles | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard) | ❌ Missing |
| POST | /workspaces/:workspaceId/api-keys | api-keys/api-keys.controller.ts | RequireWorkspaceRoles | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard) | ❌ Missing |
| DELETE | /workspaces/:workspaceId/api-keys/:id | api-keys/api-keys.controller.ts | RequireWorkspaceRoles | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard) | ❌ Missing |
| GET | / | app.controller.ts | getHello | None | ❌ Missing |
| GET | /reset-password | app.controller.ts | redirectToFrontendReset | None | ❌ Missing |
| GET | /protected | app.controller.ts | getProtected | None | ❌ Missing |
| GET | /workspaces/:workspaceId/audit-logs | audit-logs/audit-logs.controller.ts | getAuditLogs | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| POST | /auth/forgot-password | auth/auth.controller.ts | HttpCode | None | ✅ Explicit |
| POST | /auth/reset-password | auth/auth.controller.ts | HttpCode | None | ✅ Explicit |
| GET | /auth/verify-reset-token | auth/auth.controller.ts | verifyResetToken | None | ❌ Missing |
| GET | /auth/dev/mailbox | auth/auth.controller.ts | getDevMailbox | None | ❌ Missing |
| GET | /auth/dev/last-reset-link | auth/auth.controller.ts | getLastResetLink | None | ❌ Missing |
| DELETE | /auth/dev/mailbox | auth/auth.controller.ts | clearDevMailbox | None | ❌ Missing |
| GET | /workspaces/:workspaceId/billing | billing/billing.controller.ts | UseGuards | None | ❌ Missing |
| GET | /workspaces/:workspaceId/billing/balance | billing/billing.controller.ts | UseGuards | None | ❌ Missing |
| GET | /workspaces/:workspaceId/billing/wallet/transactions | billing/billing.controller.ts | UseGuards | None | ❌ Missing |
| POST | /workspaces/:workspaceId/billing/wallet/mock-topup | billing/billing.controller.ts | UseGuards | None | ❌ Missing |
| POST | /workspaces/:workspaceId/billing/checkout | billing/billing.controller.ts | UseGuards | None | ❌ Missing |
| POST | /workspaces/:workspaceId/billing/portal | billing/billing.controller.ts | UseGuards | None | ❌ Missing |
| POST | /webhooks/stripe | billing/billing.controller.ts | handleWebhook | None | ❌ Missing |
| GET | /workspaces/:workspaceId/calls | calls/calls.controller.ts | getCalls | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| GET | /workspaces/:workspaceId/calls/metrics | calls/calls.controller.ts | getMetrics | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| GET | /workspaces/:workspaceId/calls/live-calls | calls/calls.controller.ts | getLiveCalls | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| GET | /workspaces/:workspaceId/calls/:callId | calls/calls.controller.ts | RequireResourceScope | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| POST | /workspaces/:workspaceId/call-commercials/:callCommercialId/dispute | commercial/commercial-disputes.controller.ts | RequirePermission | @UseGuards(JwtAuthGuard, PermissionsGuard) | ❌ Missing |
| POST | /workspaces/:workspaceId/disputes/:disputeId/resolve | commercial/commercial-disputes.controller.ts | UseGuards | @UseGuards(JwtAuthGuard, PermissionsGuard) | ❌ Missing |
| POST | /workspaces/:workspaceId/disputes/:disputeId/accept | commercial/commercial-disputes.controller.ts | UseGuards | @UseGuards(JwtAuthGuard, PermissionsGuard) | ❌ Missing |
| POST | /workspaces/:workspaceId/disputes/:disputeId/reject | commercial/commercial-disputes.controller.ts | UseGuards | @UseGuards(JwtAuthGuard, PermissionsGuard) | ❌ Missing |
| GET | /workspaces/:workspaceId/disputes | commercial/commercial-disputes.controller.ts | RequirePermission | @UseGuards(JwtAuthGuard, PermissionsGuard) | ❌ Missing |
| GET | /workspaces/:workspaceId/disputes/:disputeId | commercial/commercial-disputes.controller.ts | RequirePermission | @UseGuards(JwtAuthGuard, PermissionsGuard) | ❌ Missing |
| GET | /workspaces/:workspaceId/call-commercials/:callCommercialId/dispute | commercial/commercial-disputes.controller.ts | RequirePermission | @UseGuards(JwtAuthGuard, PermissionsGuard) | ❌ Missing |
| GET | /health | health/health.controller.ts | getHealth | None | ❌ Missing |
| GET | /health/ready | health/health.controller.ts | getReady | None | ❌ Missing |
| GET | /health/live | health/health.controller.ts | getLive | None | ❌ Missing |
| GET | /workspaces/:workspaceId/permissions | permissions/permissions.controller.ts | getAllPermissions | @UseGuards(JwtAuthGuard) | ❌ Missing |
| GET | /workspaces/:workspaceId/permissions/members/:memberId | permissions/permissions.controller.ts | getMemberPermissions | @UseGuards(JwtAuthGuard) | ❌ Missing |
| PUT | /workspaces/:workspaceId/permissions/members/:memberId/:permissionKey | permissions/permissions.controller.ts | assignPermission | @UseGuards(JwtAuthGuard) | ❌ Missing |
| DELETE | /workspaces/:workspaceId/permissions/members/:memberId/:permissionKey | permissions/permissions.controller.ts | removePermission | @UseGuards(JwtAuthGuard) | ❌ Missing |
| GET | /workspaces/:workspaceId/phone-numbers | phone-numbers/phone-numbers.controller.ts | RequirePermission | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| GET | /workspaces/:workspaceId/phone-numbers/search | phone-numbers/phone-numbers.controller.ts | RequireWorkspaceRoles | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| POST | /workspaces/:workspaceId/phone-numbers | phone-numbers/phone-numbers.controller.ts | RequirePermission | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| GET | /workspaces/:workspaceId/phone-numbers/:id | phone-numbers/phone-numbers.controller.ts | RequirePermission | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| PUT | /workspaces/:workspaceId/phone-numbers/:id | phone-numbers/phone-numbers.controller.ts | Patch | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| DELETE | /workspaces/:workspaceId/phone-numbers/:id | phone-numbers/phone-numbers.controller.ts | RequireResourceScope | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| GET | /api/v1/workspaces/:workspaceId/billing | public-api/public-billing.controller.ts | RequireWorkspaceRoles | @UseGuards(ApiKeyAuthGuard, WorkspaceRolesGuard) | ❌ Missing |
| GET | /api/v1/workspaces/:workspaceId/blocked-numbers | public-api/public-blocked-numbers.controller.ts | RequireWorkspaceRoles | @UseGuards(ApiKeyAuthGuard, WorkspaceRolesGuard) | ❌ Missing |
| POST | /api/v1/workspaces/:workspaceId/blocked-numbers | public-api/public-blocked-numbers.controller.ts | RequireWorkspaceRoles | @UseGuards(ApiKeyAuthGuard, WorkspaceRolesGuard) | ❌ Missing |
| DELETE | /api/v1/workspaces/:workspaceId/blocked-numbers/:id | public-api/public-blocked-numbers.controller.ts | RequireWorkspaceRoles | @UseGuards(ApiKeyAuthGuard, WorkspaceRolesGuard) | ❌ Missing |
| GET | /api/v1/workspaces/:workspaceId/buyers | public-api/public-buyers.controller.ts | RequirePermission | @UseGuards(ApiKeyAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| GET | /api/v1/workspaces/:workspaceId/buyers/:id | public-api/public-buyers.controller.ts | RequireResourceScope | @UseGuards(ApiKeyAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| POST | /api/v1/workspaces/:workspaceId/buyers | public-api/public-buyers.controller.ts | RequirePermission | @UseGuards(ApiKeyAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| GET | /api/v1/workspaces/:workspaceId/calls | public-api/public-calls.controller.ts | RequirePermission | @UseGuards(ApiKeyAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| GET | /api/v1/workspaces/:workspaceId/calls/:id | public-api/public-calls.controller.ts | RequireResourceScope | @UseGuards(ApiKeyAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| GET | /api/v1/workspaces/:workspaceId/campaigns | public-api/public-campaigns.controller.ts | RequirePermission | @UseGuards(ApiKeyAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| POST | /api/v1/workspaces/:workspaceId/campaigns | public-api/public-campaigns.controller.ts | RequirePermission | @UseGuards(ApiKeyAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| GET | /api/v1/workspaces/:workspaceId/campaigns/:id | public-api/public-campaigns.controller.ts | RequireResourceScope | @UseGuards(ApiKeyAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| GET | /api/v1/workspaces/:workspaceId/phone-numbers | public-api/public-phone-numbers.controller.ts | RequirePermission | @UseGuards(ApiKeyAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| GET | /api/v1/workspaces/:workspaceId/phone-numbers/search | public-api/public-phone-numbers.controller.ts | searchNumbers | @UseGuards(ApiKeyAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| POST | /api/v1/workspaces/:workspaceId/phone-numbers | public-api/public-phone-numbers.controller.ts | RequirePermission | @UseGuards(ApiKeyAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| PUT | /api/v1/workspaces/:workspaceId/phone-numbers/:id | public-api/public-phone-numbers.controller.ts | updateNumber | @UseGuards(ApiKeyAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| DELETE | /api/v1/workspaces/:workspaceId/phone-numbers/:id | public-api/public-phone-numbers.controller.ts | releaseNumber | @UseGuards(ApiKeyAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| GET | /api/v1/workspaces/:workspaceId/recordings | public-api/public-recordings.controller.ts | RequireWorkspaceRoles | @UseGuards(ApiKeyAuthGuard, WorkspaceRolesGuard) | ❌ Missing |
| GET | /api/v1/workspaces/:workspaceId/recordings/:id | public-api/public-recordings.controller.ts | RequireWorkspaceRoles | @UseGuards(ApiKeyAuthGuard, WorkspaceRolesGuard) | ❌ Missing |
| GET | /api/v1/workspaces/:workspaceId/usage | public-api/public-usage.controller.ts | RequireWorkspaceRoles | @UseGuards(ApiKeyAuthGuard, WorkspaceRolesGuard) | ❌ Missing |
| GET | /api/v1/workspaces/:workspaceId | public-api/public-workspaces.controller.ts | UseGuards | @UseGuards(ApiKeyAuthGuard) | ❌ Missing |
| POST | /workspaces/:workspaceId/reports/export | reports/reports.controller.ts | RequirePermission | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| POST | /workspaces/:workspaceId/reports | reports/reports.controller.ts | createReport | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| GET | /workspaces/:workspaceId/reports | reports/reports.controller.ts | getReports | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| GET | /workspaces/:workspaceId/reports/:reportId | reports/reports.controller.ts | getReport | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| PATCH | /workspaces/:workspaceId/reports/:reportId | reports/reports.controller.ts | updateReport | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| DELETE | /workspaces/:workspaceId/reports/:reportId | reports/reports.controller.ts | deleteReport | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| GET | /workspaces/:workspaceId/blocked-callers | routing/blocked-callers.controller.ts | list | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard) | ❌ Missing |
| POST | /workspaces/:workspaceId/blocked-callers | routing/blocked-callers.controller.ts | block | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard) | ❌ Missing |
| DELETE | /workspaces/:workspaceId/blocked-callers/:id | routing/blocked-callers.controller.ts | unblock | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard) | ❌ Missing |
| GET | /workspaces/:workspaceId/buyers | routing/buyers.controller.ts | RequirePermission | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| GET | /workspaces/:workspaceId/buyers/:id | routing/buyers.controller.ts | RequirePermission | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| POST | /workspaces/:workspaceId/buyers | routing/buyers.controller.ts | RequirePermission | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| POST | /workspaces/:workspaceId/buyers/:id/archive | routing/buyers.controller.ts | RequireResourceScope | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| POST | /workspaces/:workspaceId/buyers/:id/activate | routing/buyers.controller.ts | RequireResourceScope | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| PUT | /workspaces/:workspaceId/buyers/:id | routing/buyers.controller.ts | RequirePermission | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| GET | /workspaces/:workspaceId/campaigns | routing/campaigns.controller.ts | RequirePermission | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| GET | /workspaces/:workspaceId/campaigns/:id | routing/campaigns.controller.ts | RequirePermission | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| POST | /workspaces/:workspaceId/campaigns | routing/campaigns.controller.ts | RequirePermission | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| PUT | /workspaces/:workspaceId/campaigns/:id | routing/campaigns.controller.ts | RequirePermission | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| POST | /workspaces/:workspaceId/campaigns/:id/archive | routing/campaigns.controller.ts | RequireResourceScope | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| POST | /workspaces/:workspaceId/campaigns/:id/activate | routing/campaigns.controller.ts | RequireResourceScope | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| POST | /workspaces/:workspaceId/campaigns/:id/phone-numbers | routing/campaigns.controller.ts | RequireResourceScope | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| DELETE | /workspaces/:workspaceId/campaigns/:id/phone-numbers/:phoneNumberId | routing/campaigns.controller.ts | RequireResourceScope | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| POST | /workspaces/:workspaceId/campaigns/:id/buyers | routing/campaigns.controller.ts | RequirePermission | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| DELETE | /workspaces/:workspaceId/campaigns/:id/buyers/:buyerId | routing/campaigns.controller.ts | RequireResourceScope | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| PUT | /workspaces/:workspaceId/campaigns/:id/buyers/reorder | routing/campaigns.controller.ts | RequireResourceScope | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| POST | /workspaces/:workspaceId/campaigns/:id/destinations | routing/campaigns.controller.ts | RequirePermission | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| DELETE | /workspaces/:workspaceId/campaigns/:id/destinations/:destinationNumberId | routing/campaigns.controller.ts | RequireResourceScope | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| PUT | /workspaces/:workspaceId/campaigns/:id/destinations/reorder | routing/campaigns.controller.ts | RequireResourceScope | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| POST | /workspaces/:workspaceId/buyers/:buyerId/destination-numbers | routing/destination-numbers.controller.ts | RequirePermission | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| GET | /workspaces/:workspaceId/buyers/:buyerId/destination-numbers | routing/destination-numbers.controller.ts | RequirePermission | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| GET | /workspaces/:workspaceId/destination-numbers | routing/destination-numbers.controller.ts | RequirePermission | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| GET | /workspaces/:workspaceId/destination-numbers/:id | routing/destination-numbers.controller.ts | RequirePermission | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| PUT | /workspaces/:workspaceId/destination-numbers/:id | routing/destination-numbers.controller.ts | Patch | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| POST | /workspaces/:workspaceId/destination-numbers/:id/archive | routing/destination-numbers.controller.ts | RequirePermission | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| POST | /workspaces/:workspaceId/destination-numbers/:id/activate | routing/destination-numbers.controller.ts | RequirePermission | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| DELETE | /workspaces/:workspaceId/destination-numbers/:id | routing/destination-numbers.controller.ts | RequirePermission | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| POST | /workspaces/:workspaceId/settlements/batches/:batchId/payment-instruction | settlement/payment.controller.ts | UseGuards | @UseGuards(JwtAuthGuard, PermissionsGuard) | ❌ Missing |
| POST | /workspaces/:workspaceId/payments/batches/:batchId/instructions | settlement/payment.controller.ts | UseGuards | @UseGuards(JwtAuthGuard, PermissionsGuard) | ❌ Missing |
| GET | /workspaces/:workspaceId/payments/instructions | settlement/payment.controller.ts | UseGuards | @UseGuards(JwtAuthGuard, PermissionsGuard) | ✅ Explicit |
| GET | /workspaces/:workspaceId/payments/instructions/:instructionId | settlement/payment.controller.ts | UseGuards | @UseGuards(JwtAuthGuard, PermissionsGuard) | ❌ Missing |
| POST | /workspaces/:workspaceId/payments/instructions/:instructionId/executions | settlement/payment.controller.ts | UseGuards | @UseGuards(JwtAuthGuard, PermissionsGuard) | ✅ Explicit |
| POST | /workspaces/:workspaceId/payments/instructions/:instructionId/retry | settlement/payment.controller.ts | UseGuards | @UseGuards(JwtAuthGuard, PermissionsGuard) | ✅ Explicit |
| GET | /workspaces/:workspaceId/payments/executions/:executionId | settlement/payment.controller.ts | UseGuards | @UseGuards(JwtAuthGuard, PermissionsGuard) | ❌ Missing |
| POST | /workspaces/:workspaceId/reconciliation/batches/:batchId/run | settlement/reconciliation.controller.ts | UseGuards | @UseGuards(JwtAuthGuard, PermissionsGuard) | ❌ Missing |
| POST | /workspaces/:workspaceId/settlements/batches/:batchId/reconciliation/run | settlement/reconciliation.controller.ts | UseGuards | @UseGuards(JwtAuthGuard, PermissionsGuard) | ❌ Missing |
| POST | /workspaces/:workspaceId/reconciliation/run | settlement/reconciliation.controller.ts | UseGuards | @UseGuards(JwtAuthGuard, PermissionsGuard) | ❌ Missing |
| GET | /workspaces/:workspaceId/reconciliation/runs | settlement/reconciliation.controller.ts | UseGuards | @UseGuards(JwtAuthGuard, PermissionsGuard) | ✅ Explicit |
| GET | /workspaces/:workspaceId/reconciliation/runs/:runId | settlement/reconciliation.controller.ts | UseGuards | @UseGuards(JwtAuthGuard, PermissionsGuard) | ❌ Missing |
| GET | /workspaces/:workspaceId/reconciliation/runs/:runId/issues | settlement/reconciliation.controller.ts | UseGuards | @UseGuards(JwtAuthGuard, PermissionsGuard) | ❌ Missing |
| POST | /workspaces/:workspaceId/settlements/batches/generate | settlement/settlement.controller.ts | UseGuards | @UseGuards(JwtAuthGuard, PermissionsGuard) | ✅ Explicit |
| GET | /workspaces/:workspaceId/settlements/batches | settlement/settlement.controller.ts | RequirePermission | @UseGuards(JwtAuthGuard, PermissionsGuard) | ✅ Explicit |
| GET | /workspaces/:workspaceId/settlements/batches/:batchId | settlement/settlement.controller.ts | RequirePermission | @UseGuards(JwtAuthGuard, PermissionsGuard) | ❌ Missing |
| GET | /workspaces/:workspaceId/settlements/batches/:batchId/items | settlement/settlement.controller.ts | RequirePermission | @UseGuards(JwtAuthGuard, PermissionsGuard) | ❌ Missing |
| GET | /qa/status | telephony/qa/qa-test.controller.ts | getStatus | None | ❌ Missing |
| POST | /qa/test-run | telephony/qa/qa-test.controller.ts | HttpCode | None | ❌ Missing |
| GET | /workspaces/:workspaceId/recordings/:recordingId/download | telephony/recordings.controller.ts | RequirePermission | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| POST | /webhooks/telnyx | telephony/telnyx/telnyx.webhook.controller.ts | handleWebhook | None | ❌ Missing |
| POST | /webhooks/twilio | telephony/twilio/twilio.webhook.controller.ts | handleWebhook | None | ❌ Missing |
| GET | /workspaces/:workspaceId/webhooks | webhooks/webhooks.controller.ts | RequireWorkspaceRoles | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard) | ❌ Missing |
| POST | /workspaces/:workspaceId/webhooks | webhooks/webhooks.controller.ts | RequireWorkspaceRoles | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard) | ❌ Missing |
| DELETE | /workspaces/:workspaceId/webhooks/:id | webhooks/webhooks.controller.ts | RequireWorkspaceRoles | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard) | ❌ Missing |
| GET | /invitations/verify/:token | workspaces/invitations.controller.ts | verifyInvitation | None | ❌ Missing |
| GET | /workspaces/:workspaceId/vendors | workspaces/vendors.controller.ts | RequirePermission | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| GET | /workspaces/:workspaceId/vendors/:id | workspaces/vendors.controller.ts | RequirePermission | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| POST | /workspaces/:workspaceId/vendors | workspaces/vendors.controller.ts | RequirePermission | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| PUT | /workspaces/:workspaceId/vendors/:id | workspaces/vendors.controller.ts | RequirePermission | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| POST | /workspaces/:workspaceId/vendors/:id/archive | workspaces/vendors.controller.ts | RequirePermission | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| POST | /workspaces/:workspaceId/vendors/:id/activate | workspaces/vendors.controller.ts | RequirePermission | @UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard) | ❌ Missing |
| POST | /workspaces | workspaces/workspaces.controller.ts | createWorkspace | @UseGuards(JwtAuthGuard) | ❌ Missing |
| GET | /workspaces | workspaces/workspaces.controller.ts | getUserWorkspaces | @UseGuards(JwtAuthGuard) | ❌ Missing |
| GET | /workspaces/:workspaceId | workspaces/workspaces.controller.ts | UseGuards | @UseGuards(JwtAuthGuard) | ❌ Missing |
| GET | /workspaces/:workspaceId/members | workspaces/workspaces.controller.ts | UseGuards | @UseGuards(JwtAuthGuard) | ❌ Missing |
| PUT | /workspaces/:workspaceId/settings | workspaces/workspaces.controller.ts | UseGuards | @UseGuards(JwtAuthGuard) | ❌ Missing |
| PUT | /workspaces/:workspaceId/status | workspaces/workspaces.controller.ts | UseGuards | @UseGuards(JwtAuthGuard) | ❌ Missing |
| PUT | /workspaces/:workspaceId/members/:userId/role | workspaces/workspaces.controller.ts | UseGuards | @UseGuards(JwtAuthGuard) | ❌ Missing |
| DELETE | /workspaces/:workspaceId/members/:userId | workspaces/workspaces.controller.ts | UseGuards | @UseGuards(JwtAuthGuard) | ❌ Missing |
| GET | /workspaces/:workspaceId/members/:memberId/buyers | workspaces/workspaces.controller.ts | UseGuards | @UseGuards(JwtAuthGuard) | ❌ Missing |
| POST | /workspaces/:workspaceId/members/:memberId/buyers | workspaces/workspaces.controller.ts | UseGuards | @UseGuards(JwtAuthGuard) | ❌ Missing |
| DELETE | /workspaces/:workspaceId/members/:memberId/buyers/:buyerId | workspaces/workspaces.controller.ts | UseGuards | @UseGuards(JwtAuthGuard) | ❌ Missing |
| GET | /workspaces/:workspaceId/invitations | workspaces/workspaces.controller.ts | UseGuards | @UseGuards(JwtAuthGuard) | ❌ Missing |
| POST | /workspaces/:workspaceId/invitations | workspaces/workspaces.controller.ts | UseGuards | @UseGuards(JwtAuthGuard) | ❌ Missing |
| DELETE | /workspaces/:workspaceId/invitations/:inviteId | workspaces/workspaces.controller.ts | UseGuards | @UseGuards(JwtAuthGuard) | ❌ Missing |
| POST | /workspaces/accept-invitation | workspaces/workspaces.controller.ts | acceptInvitation | @UseGuards(JwtAuthGuard) | ❌ Missing |
