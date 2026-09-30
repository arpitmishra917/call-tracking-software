const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.$queryRawUnsafe(`SELECT datname FROM pg_database WHERE datistemplate = false;`).then(res => {
  console.log('Databases:');
  console.log(res);
  p.$disconnect();
});
