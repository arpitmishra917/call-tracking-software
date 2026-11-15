const { createClient } = require('@supabase/supabase-js');

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL || 'https://your-project.supabase.co';
  const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || 'your_supabase_secret_key_placeholder';
  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log('Querying Remote Supabase PostgreSQL...');

  const { data: workspaces } = await supabase.from('Workspace').select('*');
  console.log('\nRemote Workspaces:');
  console.table(workspaces);

  const { data: members } = await supabase.from('WorkspaceMember').select('*');
  console.log('\nRemote Members:');
  console.table(members);

  const { data: phones } = await supabase.from('PhoneNumber').select('*');
  console.log('\nRemote Phone Numbers:');
  console.table(phones);
}
main().catch(console.error);
