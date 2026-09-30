const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

async function main() {
  const TARGET = 'f5ee4e43-0d36-4c8c-a25c-c3617b2ed81c';
  console.log(`Fetching Supabase Auth User: ${TARGET}...`);
  
  const { data, error } = await supabase.auth.admin.getUserById(TARGET);
  
  if (error) {
    console.error("Supabase Admin Error:", error.message);
  } else if (!data || !data.user) {
    console.log("User not found in Supabase Auth.");
  } else {
    const u = data.user;
    console.log("User ID:", u.id);
    console.log("Email:", u.email);
    console.log("Confirmed At:", u.email_confirmed_at);
    console.log("Banned Until:", u.banned_until);
    console.log("Identities:");
    if (u.identities && u.identities.length > 0) {
        u.identities.forEach(id => {
            console.log(` - Provider: ${id.provider}`);
        });
    } else {
        console.log(" - No identities found");
    }
  }
}

main().catch(console.error);
