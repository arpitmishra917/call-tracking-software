const fs = require('fs');

let controllerContent = fs.readFileSync('apps/api/src/billing/billing.controller.ts', 'utf8');

// Insert getBalance
const newBalanceController = `  @Get('workspaces/:workspaceId/billing/balance')
  @UseGuards(JwtAuthGuard, WorkspaceRolesGuard)
  // No strict role requirement explicitly, let it follow whatever getBilling uses, or just require auth
  async getBalance(@Param('workspaceId') workspaceId: string) {
    return this.billingService.getBalance(workspaceId);
  }

  @Post('workspaces/:workspaceId/billing/checkout')`;

controllerContent = controllerContent.replace('  @Post(\'workspaces/:workspaceId/billing/checkout\')', newBalanceController);
fs.writeFileSync('apps/api/src/billing/billing.controller.ts', controllerContent, 'utf8');


let serviceContent = fs.readFileSync('apps/api/src/billing/billing.service.ts', 'utf8');

// Insert getBalance
const newBalanceService = `  async getBalance(workspaceId: string) {
    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!ws) throw new NotFoundException('Workspace not found');
    let balance = await this.prisma.workspaceBalance.findUnique({
      where: { workspace_id: workspaceId }
    });
    if (!balance) {
      balance = { workspace_id: workspaceId, balance_minor: 0, currency: 'USD' } as any;
    }
    return { balance: { amountMinor: balance.balance_minor, currency: balance.currency } };
  }

  async getBillingState(workspaceId: string) {`;

serviceContent = serviceContent.replace('  async getBillingState(workspaceId: string) {', newBalanceService);

fs.writeFileSync('apps/api/src/billing/billing.service.ts', serviceContent, 'utf8');
console.log('Patched billing controller and service successfully');
