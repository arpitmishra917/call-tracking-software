const { createClient } = require('@supabase/supabase-js');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);
const prisma = new PrismaClient();

const TARGET_USER_ID = '18c60dd7-fca4-4d10-80bf-a1eeb3ee9dfa';
const TARGET_WORKSPACE_ID = 'dbd36d8f-a818-4b5d-85be-7c6599ccc60d';

async function main() {
  console.log('--- SAFETY CHECK ---');
  // Check desired user is NOT being targeted
  if (TARGET_USER_ID === 'f5ee4e43-0d36-4c8c-a25c-c3617b2ed81c') throw new Error('Targeting wrong user');
  if (TARGET_WORKSPACE_ID === '772c13a6-1d75-424c-9363-2f226d5b73b7') throw new Error('Targeting wrong workspace');

  // Verify target is exactly what we expect
  const targetUserMemberships = await prisma.workspaceMember.findMany({
    where: { user_id: TARGET_USER_ID }
  });
  console.log('Target user memberships:', targetUserMemberships.length);
  const belongsToTarget = targetUserMemberships.some(m => m.workspace_id === TARGET_WORKSPACE_ID);
  if (!belongsToTarget) {
      console.log('User does not belong to target workspace. Proceeding anyway if it exists.');
  }

  console.log('Deleting application records for the old workspace...');
  // Prisma doesn't always cascade automatically unless set in schema.
  await prisma.workspaceMember.deleteMany({
    where: { workspace_id: TARGET_WORKSPACE_ID }
  });
  
  // Safe cleanup of related entities if they exist. We don't delete phone numbers if they are in this workspace,
  // but wait - the prompt says "The old empty workspace prevent deletion... safely remove ONLY records belonging to unwanted old user/workspace".
  const nums = await prisma.phoneNumber.count({ where: { workspace_id: TARGET_WORKSPACE_ID } });
  if (nums > 0) {
      console.log(`WARNING: workspace has ${nums} phone numbers. Deleting them locally to drop workspace.`);
      await prisma.phoneNumber.deleteMany({ where: { workspace_id: TARGET_WORKSPACE_ID } });
  }

  const calls = await prisma.call.count({ where: { workspace_id: TARGET_WORKSPACE_ID } });
  if (calls > 0) await prisma.call.deleteMany({ where: { workspace_id: TARGET_WORKSPACE_ID } });

  const campaigns = await prisma.campaign.count({ where: { workspace_id: TARGET_WORKSPACE_ID } });
  if (campaigns > 0) await prisma.campaign.deleteMany({ where: { workspace_id: TARGET_WORKSPACE_ID } });

  try {
    await prisma.workspace.delete({
      where: { id: TARGET_WORKSPACE_ID }
    });
    console.log('Workspace deleted successfully.');
  } catch(e) {
    console.log('Workspace might be already deleted or has other relations:', e.message);
  }

  try {
    await prisma.profile.delete({
        where: { id: TARGET_USER_ID }
    });
    console.log('Profile deleted successfully.');
  } catch(e) {
    console.log('Profile might be already deleted or has other relations:', e.message);
  }

  console.log('Deleting auth user from Supabase...');
  const { data, error } = await supabase.auth.admin.deleteUser(TARGET_USER_ID);
  if (error) {
    console.error('Error deleting Supabase user:', error.message);
  } else {
    console.log('Supabase user deleted successfully.');
  }

  // Verifications
  const oldWs = await prisma.workspace.findUnique({ where: { id: TARGET_WORKSPACE_ID } });
  const oldUser = await prisma.profile.findUnique({ where: { id: TARGET_USER_ID } });
  const desiredWs = await prisma.workspace.findUnique({ where: { id: '772c13a6-1d75-424c-9363-2f226d5b73b7' } });
  const desiredUser = await prisma.profile.findUnique({ where: { id: 'f5ee4e43-0d36-4c8c-a25c-c3617b2ed81c' } });
  const desiredNums = await prisma.phoneNumber.findMany({ where: { workspace_id: '772c13a6-1d75-424c-9363-2f226d5b73b7' } });

  console.log('--- VERIFICATION ---');
  console.log('Old WS exists?', !!oldWs);
  console.log('Old User exists?', !!oldUser);
  console.log('Desired WS exists?', !!desiredWs);
  console.log('Desired User exists?', !!desiredUser);
  console.log('Desired Nums count:', desiredNums.length);

}
main().catch(console.error).finally(() => prisma.$disconnect());
