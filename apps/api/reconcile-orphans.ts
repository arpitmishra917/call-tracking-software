import { PrismaClient, PhoneNumberStatus } from '@prisma/client';
import Telnyx from 'telnyx';

const prisma = new PrismaClient();

async function run() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  
  const wsIndex = args.indexOf('--workspace-id');
  const targetWorkspaceId = wsIndex !== -1 ? args[wsIndex + 1] : null;

  const numIndex = args.indexOf('--numbers');
  const rawNumbers = numIndex !== -1 ? args[numIndex + 1] : null;

  if (!targetWorkspaceId) {
    console.error('Missing required argument: --workspace-id <uuid>');
    process.exit(1);
  }

  if (!rawNumbers) {
    console.error('Missing required argument: --numbers <comma-separated-E164-numbers>');
    process.exit(1);
  }

  const allowedNumbers = rawNumbers.split(',').map(n => n.trim());
  
  console.log(`Starting Parameterized Reconciliation... Dry Run: ${isDryRun}`);

  // Validate Target Workspace
  const ws = await prisma.workspace.findUnique({ where: { id: targetWorkspaceId } });
  if (!ws || ws.status !== 'ACTIVE') {
    console.error(`STOP. Target workspace ${targetWorkspaceId} does not exist or is not ACTIVE.`);
    process.exit(1);
  }

  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) {
    console.error('TELNYX_API_KEY is not set.');
    process.exit(1);
  }
  
  const telnyxFactory = Telnyx as any;
  const telnyxClient = new telnyxFactory(apiKey);

  try {
    console.log('Fetching phone numbers from Telnyx...');
    const response = await telnyxClient.phoneNumbers.list({ filter: { size: 100 } });
    const telnyxNumbers = response.data || [];
    
    for (const num of allowedNumbers) {
      if (num === '+17207159445') {
        console.log(`[SKIPPED] ${num} - EXPLICITLY SKIPPED`);
        continue;
      }

      const tn = telnyxNumbers.find((t: any) => t.phone_number === num);
      if (!tn) {
        console.log(`[ERROR] ${num} - Not found on Telnyx. Skipping.`);
        continue;
      }

      // Local duplicate check
      const localNum = await prisma.phoneNumber.findFirst({ where: { phone_number: num } });
      if (localNum) {
        if (localNum.workspace_id === targetWorkspaceId) {
          console.log(`[EXISTS] ${num} already exists in target workspace.`);
        } else {
          console.error(`[CONFLICT] ${num} already exists in a DIFFERENT workspace (${localNum.workspace_id}). STOPPING assignment.`);
        }
        continue;
      }

      if (isDryRun) {
        console.log(`\nWOULD CREATE:\n${num}`);
      } else {
        console.log(`[LIVE] Creating local record for ${num}...`);
        await prisma.phoneNumber.create({
          data: {
            workspace_id: targetWorkspaceId,
            phone_number: tn.phone_number,
            name: tn.phone_number,
            provider: 'telnyx',
            provider_number_id: tn.id,
            connection_id: tn.connection_id,
            number_type: tn.phone_number_type,
            status: PhoneNumberStatus.ACTIVE,
          },
        });
        console.log(`[LIVE] Record created successfully for ${num}`);
      }
    }

    if (isDryRun && allowedNumbers.includes('+17207159445')) {
      console.log(`\nWOULD NOT IMPORT:\n+17207159445`);
    }

  } catch (error) {
    console.error('Error during reconciliation:', error);
  } finally {
    await prisma.$disconnect();
  }
}

run();
