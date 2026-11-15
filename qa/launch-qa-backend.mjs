/**
 * CallFlow Phase 7B-6B: Dedicated QA Backend Launcher
 * 
 * Strict Isolation Guarantees:
 * 1. Loads ONLY apps/api/.env.qa for database and QA routing configuration.
 * 2. Hard rejects any Supabase host, pooler port 6543, or remote database.
 * 3. Enforces 127.0.0.1:5433/callflow_qa before bootstrapping NestJS.
 * 4. Pre-verifies QA database connectivity and confirms presence of Stage A entities.
 * 5. Boots compiled NestJS application with APP_ENV=qa.
 * 6. Never prints secrets or credentials.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

console.log('=== [CallFlow QA] Dedicated QA Backend Launcher ===');

// 1. Load and Validate apps/api/.env.qa
const envQaPath = path.resolve(projectRoot, 'apps/api/.env.qa');
if (!fs.existsSync(envQaPath)) {
  console.error('[CRITICAL ABORT] apps/api/.env.qa not found! Refusing to start.');
  process.exit(1);
}

const qaRaw = fs.readFileSync(envQaPath, 'utf8');
const qaConfig = dotenv.parse(qaRaw);

const qaDbUrl = qaConfig.DATABASE_URL;
if (!qaDbUrl) {
  console.error('[CRITICAL ABORT] DATABASE_URL missing from apps/api/.env.qa!');
  process.exit(1);
}

// 2. Strict Host, Port, and Database Validation
const forbiddenPatterns = [
  'supabase.co',
  'uwycbvnqnpnfisvvbabu',
  'aws-0-ap-northeast-1',
  '6543',
  'pooler.supabase.com'
];

for (const pat of forbiddenPatterns) {
  if (qaDbUrl.includes(pat)) {
    console.error(`[CRITICAL ABORT] Production database pattern detected: "${pat}"! Refusing to start.`);
    process.exit(1);
  }
}

let parsedUrl;
try {
  parsedUrl = new URL(qaDbUrl);
} catch (err) {
  console.error(`[CRITICAL ABORT] Malformed DATABASE_URL: ${err.message}`);
  process.exit(1);
}

if (parsedUrl.hostname !== '127.0.0.1' && parsedUrl.hostname !== 'localhost') {
  console.error(`[CRITICAL ABORT] Invalid QA host: "${parsedUrl.hostname}". Must be 127.0.0.1.`);
  process.exit(1);
}

if (parsedUrl.port !== '5433') {
  console.error(`[CRITICAL ABORT] Invalid QA port: "${parsedUrl.port}". Must be 5433.`);
  process.exit(1);
}

const dbName = parsedUrl.pathname.replace(/^\//, '');
if (dbName !== 'callflow_qa') {
  console.error(`[CRITICAL ABORT] Invalid QA database name: "${dbName}". Must be callflow_qa.`);
  process.exit(1);
}

if (parsedUrl.username !== 'callflow_qa_user') {
  console.error(`[CRITICAL ABORT] Invalid QA user: "${parsedUrl.username}". Must be callflow_qa_user.`);
  process.exit(1);
}

console.log(`[PASS] Validated QA Database Target: ${parsedUrl.username}@${parsedUrl.hostname}:${parsedUrl.port}/${dbName}`);

// 3. Clear any inherited production database environment variables
delete process.env.DATABASE_URL;
delete process.env.DIRECT_URL;
delete process.env.SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

// 4. Set QA Isolation Environment
process.env.APP_ENV = 'qa';
process.env.NODE_ENV = 'qa';
process.env.PORT = '3000';
process.env.DATABASE_URL = qaDbUrl;
process.env.DIRECT_URL = qaConfig.DIRECT_URL || qaDbUrl;

// Inject all variables from apps/api/.env.qa so they strictly take precedence over root .env
for (const [k, v] of Object.entries(qaConfig)) {
  process.env[k] = v;
}

// Load supplementary non-DB variables (JWT_SECRET, TELNYX keys, etc.) from root and apps/api
const rootEnvPath = path.resolve(projectRoot, '.env');
if (fs.existsSync(rootEnvPath)) {
  const rootConfig = dotenv.parse(fs.readFileSync(rootEnvPath, 'utf8'));
  for (const [k, v] of Object.entries(rootConfig)) {
    if (!k.includes('DATABASE') && !k.includes('SUPABASE') && !k.includes('DIRECT') && !process.env[k]) {
      process.env[k] = v;
    }
  }
}

const apiEnvPath = path.resolve(projectRoot, 'apps/api/.env');
if (fs.existsSync(apiEnvPath)) {
  const apiConfig = dotenv.parse(fs.readFileSync(apiEnvPath, 'utf8'));
  for (const [k, v] of Object.entries(apiConfig)) {
    if (!k.includes('DATABASE') && !k.includes('SUPABASE') && !k.includes('DIRECT') && !process.env[k]) {
      process.env[k] = v;
    }
  }
}

// 5. Pre-flight Database Verification
console.log('[...] Verifying QA database connectivity and Stage A entities...');
const testClient = new PrismaClient({ datasources: { db: { url: qaDbUrl } } });
try {
  await testClient.$connect();
  const ws = await testClient.workspace.findUnique({
    where: { id: process.env.QA_WORKSPACE_ID },
  });
  if (!ws || ws.slug !== 'callflow-qa-autonomous') {
    throw new Error(`QA Workspace not found or invalid slug: ${ws?.slug}`);
  }
  const cmp = await testClient.campaign.findUnique({
    where: { id: process.env.QA_CAMPAIGN_ID },
  });
  if (!cmp || cmp.name !== 'QA Autonomous Telephony Campaign') {
    throw new Error(`QA Campaign not found or invalid name: ${cmp?.name}`);
  }
  await testClient.$disconnect();
  console.log(`[PASS] Stage A Workspace (${ws.id}) and Campaign (${cmp.id}) confirmed present in callflow_qa.`);
} catch (dbErr) {
  console.error(`[CRITICAL ABORT] QA Database preflight failed: ${dbErr.message}`);
  process.exit(1);
}

// 6. Bootstrap NestJS Application
console.log('[...] Bootstrapping NestJS server on port 3000...');
const mainPath = path.resolve(projectRoot, 'apps/api/dist/main.js');
if (!fs.existsSync(mainPath)) {
  console.error(`[CRITICAL ABORT] dist/main.js not found at ${mainPath}. Run npm run build first.`);
  process.exit(1);
}

await import(`file:///${mainPath.replace(/\\/g, '/')}`);
console.log('=== [CallFlow QA] Backend Successfully Running in QA Mode ===');
