const fs = require('fs');
let s = fs.readFileSync('apps/api/src/billing/usage-billing.service.ts', 'utf8');
s = s.replace(/\\\\\`/g, '\`');
fs.writeFileSync('apps/api/src/billing/usage-billing.service.ts', s);
