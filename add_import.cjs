const fs = require('fs');
let f = fs.readFileSync('apps/api/src/calls/calls.service.ts', 'utf8');
if (!f.includes('import { CallState, Prisma }')) {
  f = f.replace(/import \{ CallState \} from '@prisma\/client';/, "import { CallState, Prisma } from '@prisma/client';");
  fs.writeFileSync('apps/api/src/calls/calls.service.ts', f);
}
