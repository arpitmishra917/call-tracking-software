const fs = require('fs');
let s = fs.readFileSync('apps/api/src/billing/wallet.service.ts', 'utf8');

// Replace literal backslash-backtick with just backtick
s = s.split('\\`').join('`');
// Replace literal backslash-dollar with just dollar
s = s.split('\\$').join('$');

fs.writeFileSync('apps/api/src/billing/wallet.service.ts', s);
