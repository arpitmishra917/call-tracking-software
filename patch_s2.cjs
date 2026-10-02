const fs = require('fs');
let s = fs.readFileSync('apps/api/prisma/schema.prisma', 'utf8');
s = s.replace('balance_minor   Int      @default(0)\\n    balance_micro   BigInt   @default(0)', 'balance_minor   Int      @default(0)\\n  balance_micro   BigInt   @default(0)');
fs.writeFileSync('apps/api/prisma/schema.prisma', s);
