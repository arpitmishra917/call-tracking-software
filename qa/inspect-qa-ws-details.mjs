import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://callflow_qa_user:cfqa_pg_83538438661833bab5b5741ec8b903593e00a675@127.0.0.1:5433/callflow_qa?schema=public'
    }
  }
});

async function main() {
  const wsId = '5e20bafe-7306-4da7-9944-62c4c5575a5a';
  const campaigns = await prisma.campaign.findMany({
    where: { workspace_id: wsId },
    include: { buyers: true }
  });
  console.log('\n--- CAMPAIGNS ---');
  console.log(JSON.stringify(campaigns, null, 2));

  const balances = await prisma.workspaceBalance.findMany({ where: { workspace_id: wsId } });
  console.log('\n--- WORKSPACE BALANCE ---');
  console.log(JSON.stringify(balances, null, 2));

  await prisma.$disconnect();
}

main().catch(console.error);
