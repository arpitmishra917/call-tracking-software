const fs = require('fs');
let s = fs.readFileSync('apps/api/prisma/schema.prisma', 'utf8');
s = s.replace(/balance_minor\\s+Int\\s+@default\\(0\\)\\\\n\\s+balance_micro\\s+BigInt\\s+@default\\(0\\)/, \`balance_minor   Int      @default(0)
  balance_micro   BigInt   @default(0)\`);
fs.writeFileSync('apps/api/prisma/schema.prisma', s);
