const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.phoneNumber.count().then(c => {
  console.log('PhoneNumber count:', c);
  p.$disconnect();
});
