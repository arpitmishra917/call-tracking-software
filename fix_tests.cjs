const fs = require('fs');

let controller = fs.readFileSync('apps/api/src/billing/billing.controller.ts', 'utf8');
if (!controller.includes('Param,')) {
  controller = controller.replace('  Get,\n  Post,', '  Get,\n  Post,\n  Param,');
}
if (!controller.includes('Param,')) {
  controller = controller.replace('  Get,', '  Get,\n  Param,'); // Fallback
}
fs.writeFileSync('apps/api/src/billing/billing.controller.ts', controller, 'utf8');

let spec = fs.readFileSync('apps/api/src/billing/billing.service.spec.ts', 'utf8');
if (!spec.includes('workspaceBalance:')) {
  spec = spec.replace('usageRecord: { groupBy: vi.fn() },', 'usageRecord: { groupBy: vi.fn() },\n            workspaceBalance: { findUnique: vi.fn() },');
}
fs.writeFileSync('apps/api/src/billing/billing.service.spec.ts', spec, 'utf8');

console.log('Fixed test errors');
