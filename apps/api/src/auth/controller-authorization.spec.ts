import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

function getFiles(dir: string, match: RegExp): string[] {
  let results: string[] = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getFiles(fullPath, match));
    } else if (match.test(fullPath)) {
      results.push(fullPath);
    }
  }
  return results;
}

describe('Controller Authorization & RBAC Coverage Audit', () => {
  const controllerFiles = getFiles('src', /\.controller\.ts$/);

  it('should find all controllers in apps/api/src', () => {
    expect(controllerFiles.length).toBeGreaterThanOrEqual(30);
  });

  const intentionalPublicControllers = [
    'app.controller.ts',
    'auth.controller.ts',
    'health.controller.ts',
    'ringback.controller.ts',
    'invitations.controller.ts',
    'telnyx.webhook.controller.ts',
    'twilio.webhook.controller.ts',
  ];

  it('every non-public controller must enforce class-level authentication guards (JwtAuthGuard, ApiKeyAuthGuard, or QaAuthGuard)', () => {
    for (const file of controllerFiles) {
      const basename = path.basename(file);
      const content = fs.readFileSync(file, 'utf8');

      if (intentionalPublicControllers.includes(basename)) {
        continue;
      }

      // BillingController has webhook + protected routes
      if (basename === 'billing.controller.ts') {
        expect(content).toContain('JwtAuthGuard');
        expect(content).toContain('WorkspaceRolesGuard');
        expect(content).toContain('PermissionsGuard');
        continue;
      }

      const hasJwt = content.includes('JwtAuthGuard');
      const hasApiKey = content.includes('ApiKeyAuthGuard');
      const hasQaAuth = content.includes('QaAuthGuard');

      expect(
        hasJwt || hasApiKey || hasQaAuth,
        `Controller ${basename} must enforce authentication guard (JwtAuthGuard, ApiKeyAuthGuard, or QaAuthGuard)`,
      ).toBe(true);
    }
  });

  it('every workspace-scoped internal controller must enforce WorkspaceRolesGuard and/or PermissionsGuard', () => {
    const workspaceControllers = controllerFiles.filter((f) => {
      const content = fs.readFileSync(f, 'utf8');
      return content.includes('workspaces/:workspaceId') && !f.includes('public-api');
    });

    for (const file of workspaceControllers) {
      const basename = path.basename(file);
      const content = fs.readFileSync(file, 'utf8');

      const hasRolesGuard = content.includes('WorkspaceRolesGuard');
      const hasPermGuard = content.includes('PermissionsGuard');

      expect(
        hasRolesGuard || hasPermGuard,
        `Workspace controller ${basename} must enforce WorkspaceRolesGuard or PermissionsGuard`,
      ).toBe(true);
    }
  });

  it('every workspace-scoped public-api controller must enforce ApiKeyAuthGuard and WorkspaceRolesGuard', () => {
    const publicApiControllers = controllerFiles.filter((f) => f.includes('public-api'));

    for (const file of publicApiControllers) {
      const basename = path.basename(file);
      const content = fs.readFileSync(file, 'utf8');

      expect(content).toContain('ApiKeyAuthGuard');
      expect(content).toContain('WorkspaceRolesGuard');
    }
  });

  it('all mutation methods on PermissionsGuard-protected controllers must declare @RequirePermission', () => {
    for (const file of controllerFiles) {
      const basename = path.basename(file);
      const content = fs.readFileSync(file, 'utf8');

      // If PermissionsGuard is on the class
      if (content.match(/@UseGuards\([^)]*PermissionsGuard[^)]*\)\s*export class/)) {
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line.match(/^@(Post|Put|Delete|Patch)\b/)) {
            let methodContext = '';
            for (let b = Math.max(0, i - 5); b < i; b++) {
              methodContext += lines[b] + '\n';
            }
            for (let f = i; f < Math.min(lines.length, i + 10); f++) {
              methodContext += lines[f] + '\n';
              if (lines[f].includes('{') || (lines[f].includes('async') && lines[f].includes('('))) {
                break;
              }
            }
            expect(
              methodContext.includes('@RequirePermission'),
              `Mutation endpoint in ${basename} at line ${i + 1} must specify @RequirePermission: ${line}`,
            ).toBe(true);
          }
        }
      }
    }
  });

  it('sensitive financial mutations must be strictly restricted to OWNER role', () => {
    // 1. Settlement batch generation
    const settlementController = fs.readFileSync('src/settlement/settlement.controller.ts', 'utf8');
    expect(settlementController).toMatch(/@Post\('batches\/generate'\)[\s\S]*?@RequireWorkspaceRoles\(WorkspaceRole\.OWNER\)/);
    expect(settlementController).toMatch(/@Post\('batches\/generate'\)[\s\S]*?@RequirePermission\('settlement:generate'\)/);

    // 2. Payment instruction creation and execution
    const paymentController = fs.readFileSync('src/settlement/payment.controller.ts', 'utf8');
    expect(paymentController).toMatch(/@Post\('settlements\/batches\/:batchId\/payment-instruction'\)[\s\S]*?@RequireWorkspaceRoles\(WorkspaceRole\.OWNER\)/);
    expect(paymentController).toMatch(/@Post\('payments\/instructions\/:instructionId\/executions'\)[\s\S]*?@RequireWorkspaceRoles\(WorkspaceRole\.OWNER\)/);

    // 3. Reconciliation runs
    const reconciliationController = fs.readFileSync('src/settlement/reconciliation.controller.ts', 'utf8');
    expect(reconciliationController).toMatch(/@Post\('reconciliation\/batches\/:batchId\/run'\)[\s\S]*?@RequireWorkspaceRoles\(WorkspaceRole\.OWNER\)/);
    expect(reconciliationController).toMatch(/@Post\('reconciliation\/run'\)[\s\S]*?@RequireWorkspaceRoles\(WorkspaceRole\.OWNER\)/);

    // 4. Workspace status (suspension/reactivation)
    const workspacesController = fs.readFileSync('src/workspaces/workspaces.controller.ts', 'utf8');
    expect(workspacesController).toMatch(/@Put\(':workspaceId\/status'\)[\s\S]*?@RequireWorkspaceRoles\(WorkspaceRole\.OWNER\)/);
  });
});
