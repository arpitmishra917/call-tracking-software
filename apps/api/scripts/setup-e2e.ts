import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Get Workspace
  const workspace = await prisma.workspace.findFirst();
  if (!workspace) throw new Error('No workspace found');

  // Get Campaign
  const campaign = await prisma.campaign.findFirst({ where: { workspace_id: workspace.id } });
  if (!campaign) throw new Error('No campaign found');

  // Create or Update Phone Number
  const trackingNumber = '+18668300066';
  await prisma.phoneNumber.upsert({
    where: { phone_number: trackingNumber },
    update: {
      provider: 'telnyx',
      status: 'ACTIVE',
      campaign_id: campaign.id,
      workspace_id: workspace.id,
    },
    create: {
      phone_number: trackingNumber,
      provider: 'telnyx',
      status: 'ACTIVE',
      campaign_id: campaign.id,
      workspace_id: workspace.id,
    },
  });

  // Get Env values
  const buyerANumber = process.env.BUYER_A_NUMBER;
  const buyerBNumber = process.env.BUYER_B_NUMBER;

  if (!buyerANumber || !buyerBNumber) {
    throw new Error('BUYER_A_NUMBER and BUYER_B_NUMBER must be set in .env');
  }

  // Update Buyers
  await prisma.buyer.updateMany({
    where: { name: 'Buyer A' },
    data: { destination_number: buyerANumber },
  });

  await prisma.buyer.updateMany({
    where: { name: 'Buyer B' },
    data: { destination_number: buyerBNumber },
  });

  console.log('Database updated successfully for E2E testing.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
