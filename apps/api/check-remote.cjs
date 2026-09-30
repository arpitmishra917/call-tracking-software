const url = 'https://uwycbvnqnpnfisvvbabu.supabase.co/rest/v1';
const key = 'your_supabase_secret_key_placeholder';

async function fetchFromSupabase(path) {
  const res = await fetch(`${url}${path}`, {
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`
    }
  });
  return res.json();
}

async function run() {
  const ws = await fetchFromSupabase('/workspaces?id=eq.772c13a6-1d75-424c-9363-2f226d5b73b7');
  console.log('Workspaces:', ws);

  const wsm = await fetchFromSupabase('/workspace_members?workspace_id=eq.772c13a6-1d75-424c-9363-2f226d5b73b7');
  console.log('WorkspaceMembers:', wsm);

  const pnums = await fetchFromSupabase('/phone_numbers');
  if (Array.isArray(pnums)) {
    console.log('PhoneNumbers count:', pnums.length);
    console.log('PhoneNumbers list:', pnums.map(p => p.phone_number));
  } else {
    console.log('PhoneNumbers:', pnums);
  }
}
run();
