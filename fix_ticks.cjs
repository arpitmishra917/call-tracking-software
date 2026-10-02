const fs = require('fs');
let f = fs.readFileSync('apps/api/src/billing/wallet.service.ts', 'utf8');
f = f.split('\\`').join('`');
fs.writeFileSync('apps/api/src/billing/wallet.service.ts', f);
