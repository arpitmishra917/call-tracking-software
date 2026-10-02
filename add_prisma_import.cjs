const fs = require('fs');
let f = fs.readFileSync('apps/api/src/calls/calls.service.ts', 'utf8');
if (!f.includes('import { Prisma }')) {
  f = "import { Prisma } from '@prisma/client';\n" + f;
  fs.writeFileSync('apps/api/src/calls/calls.service.ts', f);
}
