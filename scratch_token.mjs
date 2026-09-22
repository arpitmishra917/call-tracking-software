import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';

dotenv.config({ path: 'apps/api/.env' });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY; // Using service role key for simplicity, or we can use anon key if available.

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error("Missing Supabase credentials");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

async function run() {
  // Let's create a dummy user
  const email = `testuser_${Date.now()}@example.com`;
  const password = "Password123!";

  const { data: user, error: signUpError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (signUpError) {
    console.error("Signup error:", signUpError);
    return;
  }

  // Now login with that user
  const { data: session, error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError) {
    console.error("Signin error:", signInError);
    return;
  }

  const token = session.session.access_token;
  
  // Save token to file to avoid printing
  fs.writeFileSync('scratch_token.txt', token);

  const decodedHeader = jwt.decode(token, { complete: true }).header;
  const decodedPayload = jwt.decode(token);
  
  console.log("----- JWT HEADER -----");
  console.log("alg:", decodedHeader.alg);
  console.log("typ:", decodedHeader.typ);
  
  console.log("----- JWT PAYLOAD -----");
  console.log("iss:", decodedPayload.iss);
  console.log("aud:", decodedPayload.aud);
  console.log("exp:", decodedPayload.exp);
  console.log("sub:", decodedPayload.sub);
  
  console.log("User ID:", user.user.id);
}

run().catch(console.error);
