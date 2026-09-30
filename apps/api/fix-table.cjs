const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.$executeRawUnsafe(`ALTER TABLE phone_numbers ADD COLUMN number_type TEXT;`)
.then(console.log)
.catch(console.error)
.finally(() => p.$disconnect());
