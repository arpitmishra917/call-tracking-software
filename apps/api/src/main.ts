import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Deterministic package root resolution independent of process.cwd() or build directory depth.
// Traverses upwards from __dirname to locate the package boundaries reliably in both
// development (src/) and compiled (dist/ or dist/sub/) execution modes.
function findPackageRoot(startDir: string, targetName: string): string {
  let curr = path.resolve(startDir);
  while (true) {
    const pkgPath = path.join(curr, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (
          pkg.name === targetName ||
          (targetName === 'call-tracking-software' && pkg.workspaces)
        ) {
          return curr;
        }
      } catch {}
    }
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  // Structural fallback if package.json is missing:
  // apiDir is 1 level up from __dirname, rootDir is 2 levels up from apiDir
  return targetName === 'api'
    ? path.resolve(startDir, '..')
    : path.resolve(startDir, '..', '..');
}

export const apiDir = findPackageRoot(__dirname, 'api');
export const rootDir = findPackageRoot(apiDir, 'call-tracking-software');

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
  // Deterministic environment loading for development and production:
  // 1. Root .env defines global/infrastructure defaults (carrier credentials, provider settings).
  // 2. apps/api/.env defines API-specific overrides.
  const rootEnvPath = path.join(rootDir, '.env');
  const apiEnvPath = path.join(apiDir, '.env');

  const rootParsed = fs.existsSync(rootEnvPath)
    ? dotenv.parse(fs.readFileSync(rootEnvPath, 'utf8'))
    : {};

  // First load root .env into process.env for global defaults
  if (fs.existsSync(rootEnvPath)) {
    dotenv.config({ path: rootEnvPath });
  }

  // Then load apps/api/.env into process.env
  if (fs.existsSync(apiEnvPath)) {
    dotenv.config({ path: apiEnvPath });
  }

  // Guard against legacy/stale TELEPHONY_PROVIDER=fake accidentally overriding root Telnyx configuration:
  // If root .env specified telnyx or Telnyx credentials are provided, ensure Telnyx is selected.
  if (
    rootParsed.TELEPHONY_PROVIDER === 'telnyx' ||
    (rootParsed.TELNYX_API_KEY && (!process.env.TELEPHONY_PROVIDER || process.env.TELEPHONY_PROVIDER === 'fake'))
  ) {
    process.env.TELEPHONY_PROVIDER = 'telnyx';
    process.env.ACTIVE_TELEPHONY_PROVIDER = 'telnyx';
  }

  // Ensure Telnyx credentials from root are populated if missing in process.env
  if (rootParsed.TELNYX_API_KEY && !process.env.TELNYX_API_KEY) {
    process.env.TELNYX_API_KEY = rootParsed.TELNYX_API_KEY;
  }
  if (rootParsed.TELNYX_PUBLIC_KEY && !process.env.TELNYX_PUBLIC_KEY) {
    process.env.TELNYX_PUBLIC_KEY = rootParsed.TELNYX_PUBLIC_KEY;
  }

  // Synchronize BASE_URL and RINGBACK_AUDIO_URL:
  // Root .env defines global public ingress URL (e.g. ngrok / production domain).
  // Prioritize public HTTPS BASE_URL / RINGBACK_AUDIO_URL over stale localhost values.
  if (rootParsed.BASE_URL && (!process.env.BASE_URL || process.env.BASE_URL.includes('localhost') || rootParsed.BASE_URL.startsWith('https://'))) {
    process.env.BASE_URL = rootParsed.BASE_URL;
  }
  if (rootParsed.RINGBACK_AUDIO_URL) {
    process.env.RINGBACK_AUDIO_URL = rootParsed.RINGBACK_AUDIO_URL;
  }
}

// Startup Validation: Fail fast if required configuration is missing or invalid.
// Never print secret values or access tokens.
/**
 * Strict validator for public HTTPS origins required by external telephony carriers.
 * Fails closed on invalid protocol, embedded credentials, localhost, loopback, or private IP ranges.
 */
export function validatePublicHttpsUrl(urlStr: string | undefined, varName: string): string {
  if (!urlStr || !urlStr.trim()) {
    throw new Error(
      `[CRITICAL STARTUP ERROR] ${varName} is missing! In production with Telnyx, a valid public HTTPS URL is required.`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error(`[CRITICAL STARTUP ERROR] ${varName} (${urlStr}) is not a valid URL.`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`[CRITICAL STARTUP ERROR] ${varName} must use HTTPS protocol (got: ${parsed.protocol}).`);
  }

  if (parsed.username || parsed.password) {
    throw new Error(`[CRITICAL STARTUP ERROR] ${varName} must not contain embedded credentials.`);
  }

  const hostname = parsed.hostname.toLowerCase();

  // Guard against localhost, loopback, link-local, and RFC 1918 private IPv4/IPv6 ranges
  const isLocalhost = hostname === 'localhost' || hostname.endsWith('.localhost');
  const isLoopbackIp =
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    hostname.startsWith('127.');
  const isPrivateIp =
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname) ||
    hostname.startsWith('169.254.') ||
    hostname.startsWith('fe80:') ||
    hostname.startsWith('fc00:') ||
    hostname.startsWith('fd00:') ||
    hostname === '0.0.0.0';

  if (isLocalhost || isLoopbackIp || isPrivateIp) {
    throw new Error(
      `[CRITICAL STARTUP ERROR] ${varName} (${urlStr}) resolves to a loopback or private network address. External carriers cannot reach private addresses.`,
    );
  }

  return parsed.origin;
}

export function validateStartupConfig(): void {
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

  const configuredProvider = (
    process.env.TELEPHONY_PROVIDER ||
    process.env.ACTIVE_TELEPHONY_PROVIDER ||
    'telnyx'
  ).toLowerCase();

  if (configuredProvider === 'telnyx') {
    if (!process.env.TELNYX_API_KEY || !process.env.TELNYX_API_KEY.trim()) {
      console.error(
        '[CRITICAL STARTUP ERROR] TELNYX_API_KEY is missing! Telephony provider is configured as "telnyx" but no API key was provided. Halting.',
      );
      process.exit(1);
    }
    if (!process.env.TELNYX_PUBLIC_KEY || !process.env.TELNYX_PUBLIC_KEY.trim()) {
      console.error(
        '[CRITICAL STARTUP ERROR] TELNYX_PUBLIC_KEY is missing! Live carrier webhook ingress requires a valid TELNYX_PUBLIC_KEY. Halting.',
      );
      process.exit(1);
    }

    const isProduction =
      process.env.NODE_ENV === 'production' &&
      process.env.APP_ENV !== 'qa';

    if (isProduction) {
      try {
        validatePublicHttpsUrl(process.env.BASE_URL, 'BASE_URL');
        if (process.env.RINGBACK_AUDIO_URL) {
          validatePublicHttpsUrl(process.env.RINGBACK_AUDIO_URL, 'RINGBACK_AUDIO_URL');
        }
      } catch (err: any) {
        console.error(err.message);
        process.exit(1);
      }
    } else {
      const activeBaseUrl = process.env.BASE_URL || '';
      const activeRingbackUrl = process.env.RINGBACK_AUDIO_URL || '';
      const isLocalhostBase = activeBaseUrl.includes('localhost') || activeBaseUrl.includes('127.0.0.1');
      const isLocalhostRingback = activeRingbackUrl.includes('localhost') || activeRingbackUrl.includes('127.0.0.1');
      if (isLocalhostBase && (!activeRingbackUrl || isLocalhostRingback)) {
        console.warn(
          `[CONFIG WARNING] BASE_URL (${activeBaseUrl}) points to loopback/localhost! External Telnyx media servers cannot fetch ringback audio from localhost. Configure BASE_URL or RINGBACK_AUDIO_URL to a public HTTPS domain.`,
        );
      }
    }
  } else if (configuredProvider === 'fake' || configuredProvider === 'mock') {
    console.warn(
      '[CONFIG WARNING] Telephony provider is explicitly configured as fake/mock. Real carrier calls will not be routed.',
    );
  }

  // Safe configuration status logging (no secrets or tokens exposed)
  console.log('[CONFIG] Deterministic environment loading complete.');
  console.log(`[CONFIG] rootDir resolved: ${rootDir}`);
  console.log(`[CONFIG] apiDir resolved: ${apiDir}`);
  console.log(`[CONFIG] SUPABASE_URL present: true (host: ${new URL(supabaseUrl).host})`);
  console.log(`[CONFIG] JWT_SECRET present: ${Boolean(process.env.JWT_SECRET)}`);
  console.log(`[CONFIG] TELEPHONY_PROVIDER: ${process.env.TELEPHONY_PROVIDER || 'not set'}`);
  console.log(`[CONFIG] BASE_URL: ${process.env.BASE_URL || 'not set'}`);
  console.log(`[CONFIG] RINGBACK_AUDIO_URL: ${process.env.RINGBACK_AUDIO_URL || 'not set'}`);
  console.log(`[CONFIG] TELNYX_API_KEY present: ${Boolean(process.env.TELNYX_API_KEY)}`);
  console.log(`[CONFIG] TELNYX_PUBLIC_KEY present: ${Boolean(process.env.TELNYX_PUBLIC_KEY)}`);
  console.log(`[CONFIG] Database configured: ${Boolean(process.env.DATABASE_URL)}`);
}

if (!process.env.VITEST) {
  validateStartupConfig();
}

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

export async function bootstrap() {
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

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}

if (!process.env.VITEST) {
  await bootstrap();
}
