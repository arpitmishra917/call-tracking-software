const fs = require('fs');
let s = fs.readFileSync('apps/api/src/billing/wallet.service.ts', 'utf8');
const methods = fs.readFileSync('apps/api/temp_methods.ts', 'utf8');

const lastBraceIndex = s.lastIndexOf('}');
if (lastBraceIndex > -1) {
    s = s.substring(0, lastBraceIndex) + methods + '\n}\n';
    fs.writeFileSync('apps/api/src/billing/wallet.service.ts', s);
    console.log('Successfully injected methods.');
} else {
    console.log('Failed to find closing brace.');
}
