const fs = require('fs');
let c = fs.readFileSync('src/webhooks/webhooks.service.spec.ts', 'utf8');

c = c.replace(/global\.fetch/g, "safeFetch");

fs.writeFileSync('src/webhooks/webhooks.service.spec.ts', c);
