const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
async function run() {
  const ws = await p.$queryRaw`SELECT * FROM workspaces LIMIT 1`;
  console.log('--- Workspace ---');
  console.log(ws);

  const profs = await p.$queryRaw`SELECT * FROM profiles`;
  console.log('--- Profiles ---');
  console.log(profs);

  const pn = await p.$queryRaw`SELECT * FROM phone_numbers LIMIT 1`;
  console.log('--- PhoneNumber ---');
  console.log(pn);

  console.log('--- Historical Counts ---');
  const counts = {
    campaigns: (await p.$queryRaw`SELECT count(*) FROM campaigns`)[0].count,
    buyers: (await p.$queryRaw`SELECT count(*) FROM buyers`)[0].count,
    campaignBuyers: (await p.$queryRaw`SELECT count(*) FROM campaign_buyers`)[0].count,
    calls: (await p.$queryRaw`SELECT count(*) FROM calls`)[0].count,
    callAttempts: (await p.$queryRaw`SELECT count(*) FROM call_attempts`)[0].count,
    apiKeys: (await p.$queryRaw`SELECT count(*) FROM api_keys`)[0].count,
    usageRecords: (await p.$queryRaw`SELECT count(*) FROM usage_records`)[0].count,
    outboundWebhooks: (await p.$queryRaw`SELECT count(*) FROM outbound_webhooks`)[0].count,
    webhookDeliveries: (await p.$queryRaw`SELECT count(*) FROM webhook_deliveries`)[0].count,
    subscriptions: (await p.$queryRaw`SELECT count(*) FROM subscriptions`)[0].count
  };
  console.log(counts);
  p.$disconnect();
}
run();
