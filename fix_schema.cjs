const fs = require('fs');
let s = fs.readFileSync('apps/api/prisma/schema.prisma', 'utf8');

s = s.replace(/balance_micro BigInt   @default\(0\)(\\\\n|\\n|\\\\r\\\\n)?/g, 'balance_micro BigInt   @default(0)\n  reserved_micro BigInt   @default(0)\n');

// Replace literal \n from previous mistake
s = s.replace('balance_micro BigInt   @default(0)\\n  reserved_micro BigInt   @default(0)', 'balance_micro BigInt   @default(0)\n  reserved_micro BigInt   @default(0)\n');

fs.writeFileSync('apps/api/prisma/schema.prisma', s);
