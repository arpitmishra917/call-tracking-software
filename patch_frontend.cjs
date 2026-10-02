const fs = require('fs');
let f = fs.readFileSync('apps/web/src/app/protected/calls/page.tsx', 'utf8');
f = f.replace(/<option value="BLOCKED">Blocked<\/option>/, '');
fs.writeFileSync('apps/web/src/app/protected/calls/page.tsx', f);
