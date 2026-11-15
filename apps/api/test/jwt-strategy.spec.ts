import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { JwtStrategy } from '../src/auth/jwt.strategy.js';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

function parseEnv(filePath: string) {
  if (!fs.existsSync(filePath)) return {} as Record<string, string>;
  const content = fs.readFileSync(filePath, 'utf8');
  const env: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
  }
  return env;
}

describe('Supabase Authentication & JwtStrategy Deep Verification Suite', () => {
  const apiEnvPath = path.resolve(process.cwd(), '.env');
  const fallbackEnvPath = path.resolve(process.cwd(), 'apps/api/.env');
  const apiEnv = fs.existsSync(apiEnvPath) ? parseEnv(apiEnvPath) : parseEnv(fallbackEnvPath);
  const rootEnv = parseEnv(path.resolve(process.cwd(), '../../.env'));

  const supabaseUrl = apiEnv.SUPABASE_URL || 'https://uwycbvnqnpnfisvvbabu.supabase.co';
  const anonKey = apiEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const jwtSecret = apiEnv.JWT_SECRET;

  let testUserId: string;
  let testUserToken: string;
  let testUserEmail: string;
  let serviceToken: string;

  beforeAll(async () => {
    // Generate service_role token to manage test users via Supabase Admin API
    const headerB64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payloadB64 = Buffer.from(
      JSON.stringify({ iss: 'supabase', role: 'service_role', exp: Math.floor(Date.now() / 1000) + 3600 }),
    ).toString('base64url');
    const signed = `${headerB64}.${payloadB64}`;
    const sig = crypto.createHmac('sha256', jwtSecret).update(signed).digest('base64url');
    serviceToken = `${signed}.${sig}`;

    // Create a confirmed user in Supabase
    testUserEmail = `jwtverify-${Date.now()}@example.com`;
    const testPassword = `Pass!${Date.now()}#Aa`;
    const createRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${serviceToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: testUserEmail,
        password: testPassword,
        email_confirm: true,
      }),
    });
    const createData = await createRes.json();
    testUserId = createData.id;

    // Sign in to get authentic Supabase access token
    const signinRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: testUserEmail,
        password: testPassword,
      }),
    });
    const signinData = await signinRes.json();
    testUserToken = signinData.access_token;
  });

  afterAll(async () => {
    if (testUserId) {
      await fetch(`${supabaseUrl}/auth/v1/admin/users/${testUserId}`, {
        method: 'DELETE',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${serviceToken}`,
        },
      }).catch(() => {});
    }
  });

  it('1. Verifies actual JWT algorithm, issuer, and audience from Supabase', () => {
    const [hB64, pB64] = testUserToken.split('.');
    const header = JSON.parse(Buffer.from(hB64, 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(pB64, 'base64url').toString('utf8'));

    // Actual signing algorithm
    expect(header.alg).toBe('ES256');
    expect(header.kid).toBeDefined();

    // Actual issuer
    expect(payload.iss).toBe(`${supabaseUrl}/auth/v1`);

    // Actual audience
    expect(payload.aud).toBe('authenticated');
    expect(payload.sub).toBe(testUserId);
    expect(payload.role).toBe('authenticated');
  });

  it('2. Verifies token passes JwtStrategy when SUPABASE_URL is properly configured', async () => {
    process.env.SUPABASE_URL = supabaseUrl;
    process.env.JWT_SECRET = jwtSecret;

    const strategy = new JwtStrategy();
    const mockReq = {
      headers: {
        authorization: `Bearer ${testUserToken}`,
      },
    };

    const authResult = await new Promise<{ success?: any; fail?: any; error?: any }>((resolve) => {
      strategy.success = (user) => resolve({ success: user });
      strategy.fail = (challenge, status) => resolve({ fail: { challenge, status } });
      strategy.error = (err) => resolve({ error: err });
      strategy.authenticate(mockReq as any, {});
    });

    expect(authResult.success).toBeDefined();
    expect(authResult.success.userId).toBe(testUserId);
    expect(authResult.success.email).toBe(testUserEmail);
  });

  it('3. Demonstrates automatic recovery via defense-in-depth and rejection of mismatched issuer', async () => {
    // A: Test defense-in-depth: when process.env.SUPABASE_URL is temporarily deleted,
    // JwtStrategy automatically recovers the configuration from apps/api/.env
    const savedUrl = process.env.SUPABASE_URL;
    const savedPublicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    try {
      const recoveredStrategy = new JwtStrategy();
      const mockReq = {
        headers: {
          authorization: `Bearer ${testUserToken}`,
        },
      };

      const authResult = await new Promise<{ success?: any; fail?: any; error?: any }>((resolve) => {
        recoveredStrategy.success = (user) => resolve({ success: user });
        recoveredStrategy.fail = (challenge, status) => resolve({ fail: { challenge, status } });
        recoveredStrategy.error = (err) => resolve({ error: err });
        recoveredStrategy.authenticate(mockReq as any, {});
      });

      // Defense-in-depth successfully recovers configuration from apps/api/.env
      expect(authResult.success).toBeDefined();
      expect(authResult.success.userId).toBe(testUserId);

      // B: Test mismatched issuer rejection
      const invalidIssuerPayload = {
        sub: testUserId,
        iss: 'https://attacker.supabase.co/auth/v1',
        aud: 'authenticated',
      };
      await expect(recoveredStrategy.validate(invalidIssuerPayload)).rejects.toThrow(
        'Invalid or missing token issuer',
      );
    } finally {
      process.env.SUPABASE_URL = savedUrl;
      process.env.NEXT_PUBLIC_SUPABASE_URL = savedPublicUrl;
    }
  });

  it('4. Checks whether authenticated Supabase user exists in backend database / workspace mapping', async () => {
    const qaDbUrl =
      process.env.DATABASE_URL ||
      'postgresql://callflow_qa_user:cfqa_pg_83538438661833bab5b5741ec8b903593e00a675@127.0.0.1:5433/callflow_qa?schema=public';

    const prisma = new PrismaClient({
      datasources: { db: { url: qaDbUrl } },
    });

    try {
      await prisma.$connect();

      // Check if newly authenticated user exists in Profile
      const profile = await prisma.profile.findUnique({
        where: { id: testUserId },
      });
      console.log('Profile in DB for new Supabase user:', profile);

      // Check if newly authenticated user has any WorkspaceMember records
      const memberships = await prisma.workspaceMember.findMany({
        where: { user_id: testUserId },
        include: { workspace: true },
      });
      console.log('Workspace memberships for new Supabase user:', memberships.length);

      // A freshly authenticated user has NO profile and NO workspace memberships
      expect(profile).toBeNull();
      expect(memberships.length).toBe(0);
    } finally {
      await prisma.$disconnect();
    }
  });
});
