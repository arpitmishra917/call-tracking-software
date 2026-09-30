import { PrismaClient } from '@prisma/client';
import Telnyx from 'telnyx';

const prisma = new PrismaClient();

async function run() {
  const isDryRun = process.argv.includes('--dry-run');
  const targetWorkspaceId = '772c13a6-1d75-424c-9363-2f226d5b73b7';
  console.log(`Starting Reconciliation... Dry Run: ${isDryRun}`);

  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) {
    console.error('TELNYX_API_KEY is not set. Cannot verify real Telnyx account.');
    process.exit(1);
  }
  
  const telnyxFactory = Telnyx as any;
  const telnyxClient = new telnyxFactory(apiKey);

  try {
    // 1. Fetch all numbers in Telnyx
    console.log('Fetching phone numbers from Telnyx...');
    const response = await telnyxClient.phoneNumbers.list({ filter: { size: 100 } });
    const telnyxNumbers = response.data || [];
    
    // 2. Fetch all numbers in DB
    const dbNumbers = await prisma.phoneNumber.findMany();
    const dbNumberSet = new Set(dbNumbers.map(n => n.phone_number));

    // 3. Find orphans
    const orphans = telnyxNumbers.filter((tn: any) => !dbNumberSet.has(tn.phone_number));
    
    if (orphans.length === 0) {
      console.log('No orphaned numbers found in Telnyx account.');
      return;
    }

    console.log(`Found ${orphans.length} orphaned number(s) in Telnyx.`);

    for (const orphan of orphans) {
      console.log('--------------------------------------------------');
      console.log(`Number:           ${orphan.phone_number}`);
      console.log(`Telnyx ID:        ${orphan.id}`);
      console.log(`Connection ID:    ${orphan.connection_id || 'None'}`);
      console.log(`Target Workspace: ${targetWorkspaceId}`);
      console.log(`Provider Status:  ${orphan.status}`);
      
      if (!orphan.connection_id) {
        console.log(`[SKIPPED] ${orphan.phone_number} - Reason: connection_id is missing or empty`);
        continue;
      }
      
      if (isDryRun) {
        console.log(`[DRY-RUN] Would create local record:`);
        console.log({
          workspace_id: targetWorkspaceId,
          phone_number: orphan.phone_number,
          provider: 'telnyx',
          provider_number_id: orphan.id,
          connection_id: orphan.connection_id,
          status: 'ACTIVE',
        });
      } else {
        console.log(`[LIVE] Creating local record...`);
        await prisma.phoneNumber.create({
          data: {
            workspace_id: targetWorkspaceId,
            phone_number: orphan.phone_number,
            name: orphan.phone_number,
            provider: 'telnyx',
            provider_number_id: orphan.id,
            connection_id: orphan.connection_id,
            status: 'ACTIVE',
          },
        });
        console.log(`[LIVE] Record created successfully for ${orphan.phone_number}`);
      }
    }
  } catch (error) {
    console.error('Error during reconciliation:', error);
  } finally {
    await prisma.$disconnect();
  }
}

run();
