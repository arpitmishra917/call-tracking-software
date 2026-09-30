const Telnyx = require('telnyx');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();

async function run() {
  const telnyxClient = new Telnyx(process.env.TELNYX_API_KEY);
  
  const response = await telnyxClient.phoneNumbers.list({ filter: { size: 100 } });
  const telnyxNumbers = response.data || [];

  const targetWorkspaceId = '0d63db1a-fc8e-41da-912d-bd24d3edb75e';
  const targetPhones = [
    '+13215033884',
    '+17658268661',
    '+14845560110',
    '+18668300066',
    '+17207159445'
  ];

  const dbNumbers = await prisma.$queryRawUnsafe(`SELECT * FROM phone_numbers`);
  const localSet = new Set(dbNumbers.map(n => n.phone_number));

  console.log('| Phone | Telnyx ID | Connection ID | Type | Provider Status | Local Exists | Would Import |');
  console.log('|------|-----------|---------------|------|-----------------|--------------|--------------|');

  for (const num of telnyxNumbers) {
    if (targetPhones.includes(num.phone_number)) {
      const isTarget = num.phone_number !== '+17207159445';
      const hasConn = !!num.connection_id;
      const wouldImport = isTarget && hasConn && !localSet.has(num.phone_number);
      
      console.log(`| ${num.phone_number} | ${num.id} | ${num.connection_id || 'null'} | ${num.phone_number_type || 'null'} | ${num.status} | ${localSet.has(num.phone_number)} | ${wouldImport} |`);
    }
  }

  prisma.$disconnect();
}
run();
