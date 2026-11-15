import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Deterministic path resolution independent of process.cwd():
// In development: __dirname is <repo>/apps/api/src  -> apiDir is <repo>/apps/api
// In production:  __dirname is <repo>/apps/api/dist -> apiDir is <repo>/apps/api
const apiDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(apiDir, '..');

const isQaMode = process.env.APP_ENV === 'qa' || process.env.NODE_ENV === 'qa';

if (isQaMode) {
  // Load QA environment files first
  const qaEnvPaths = [
    path.join(apiDir, '.env.qa'),
    path.join(rootDir, '.env.qa'),
    path.join(process.cwd(), 'apps/api/.env.qa'),
    path.join(process.cwd(), '.env.qa'),
    // Fallback to base apps/api/.env for non-DB auth variables (SUPABASE_URL, JWT_SECRET)
    path.join(apiDir, '.env'),
    path.join(rootDir, '.env'),
  ];
  for (const envPath of qaEnvPaths) {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath });
    }
  }

  // STRICT FAIL-CLOSED QA TARGET GUARD
  const dbUrl = process.env.DATABASE_URL || '';
  const forbiddenPatterns = ['supabase.co', 'uwycbvnqnpnfisvvbabu', 'aws-0-ap-northeast-1', '6543'];
  for (const pat of forbiddenPatterns) {
    if (dbUrl.includes(pat)) {
      console.error(`[CRITICAL ABORT] QA mode detected production database pattern: "${pat}"! Halting.`);
      process.exit(1);
    }
  }
  if (!dbUrl.includes('5433/callflow_qa')) {
    console.error('[CRITICAL ABORT] QA mode DATABASE_URL must resolve to port 5433 and database callflow_qa! Halting.');
    process.exit(1);
  }
} else {
  // Deterministic environment loading:
  // Load apps/api/.env first, then root .env for shared defaults.
  // dotenv.config() does not overwrite existing process.env variables,
  // ensuring explicitly supplied production/shell environment variables take precedence.
  const envCandidates = [
    path.join(apiDir, '.env'),
    path.join(rootDir, '.env'),
    path.join(process.cwd(), 'apps/api/.env'),
    path.join(process.cwd(), '.env'),
  ];
  for (const envPath of envCandidates) {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath });
    }
  }
}

// Startup Validation: Fail fast if required configuration is missing or invalid.
// Never print secret values or access tokens.
function validateStartupConfig(): void {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl || !supabaseUrl.trim()) {
    console.error(
      '[CRITICAL STARTUP ERROR] SUPABASE_URL is missing! NestJS JwtStrategy requires a valid SUPABASE_URL for JWKS token verification.',
    );
    process.exit(1);
  }

  try {
    const parsed = new URL(supabaseUrl);
    if (!parsed.protocol.startsWith('http')) {
      throw new Error(`Invalid protocol '${parsed.protocol}'`);
    }
  } catch (err: any) {
    console.error(`[CRITICAL STARTUP ERROR] SUPABASE_URL is not a valid URL: ${err.message}`);
    process.exit(1);
  }

  // Safe configuration status logging (no secrets or tokens exposed)
  console.log('[CONFIG] Deterministic environment loading complete.');
  console.log(`[CONFIG] SUPABASE_URL present: true (host: ${new URL(supabaseUrl).host})`);
  console.log(`[CONFIG] JWT_SECRET present: ${Boolean(process.env.JWT_SECRET)}`);
  console.log(`[CONFIG] TELEPHONY_PROVIDER: ${process.env.TELEPHONY_PROVIDER || 'not set'}`);
  console.log(`[CONFIG] Database configured: ${Boolean(process.env.DATABASE_URL)}`);
}

validateStartupConfig();

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // 1. Secure HTTP Headers
  app.use(helmet());

  // 2. CORS configuration (restrict allowed origins appropriately, avoiding '*' if credentials are true)
  const allowedOrigins = [
    process.env.FRONTEND_URL || 'http://localhost:3001',
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ];
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  // 3. Global Request Validation (BUG-BE-013)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  // 4. API Rate Limiting
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 1000, // limit each IP to 1000 requests per windowMs
      message: 'Too many requests from this IP, please try again later.',
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
