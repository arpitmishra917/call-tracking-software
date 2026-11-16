import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JwtStrategy } from '../src/auth/jwt.strategy.js';
import { UnauthorizedException } from '@nestjs/common';
import crypto from 'crypto';

describe('Auth Production Configuration Preservation Tests (Phase DEPLOY-2R)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('1. Verifies HS256 algorithm uses JWT_SECRET successfully', async () => {
    process.env.JWT_SECRET = 'test_hs256_secret_key_callflow_32chars!';
    process.env.SUPABASE_URL = 'https://uwycbvnqnpnfisvvbabu.supabase.co';

    const strategy = new JwtStrategy();

    // Create a mock HS256 token
    const headerB64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payloadB64 = Buffer.from(
      JSON.stringify({
        sub: 'user_123',
        email: 'user@example.com',
        iss: 'https://uwycbvnqnpnfisvvbabu.supabase.co/auth/v1',
        aud: 'authenticated',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString('base64url');
    const unsigned = `${headerB64}.${payloadB64}`;
    const sig = crypto
      .createHmac('sha256', process.env.JWT_SECRET)
      .update(unsigned)
      .digest('base64url');
    const token = `${unsigned}.${sig}`;

    const mockReq = { headers: { authorization: `Bearer ${token}` } };

    const result = await new Promise<{ success?: any; fail?: any; error?: any }>((resolve) => {
      strategy.success = (user) => resolve({ success: user });
      strategy.fail = (challenge, status) => resolve({ fail: { challenge, status } });
      strategy.error = (err) => resolve({ error: err });
      strategy.authenticate(mockReq as any, {});
    });

    expect(result.success).toBeDefined();
    expect(result.success.userId).toBe('user_123');
    expect(result.success.email).toBe('user@example.com');
  });

  it('2. Verifies HS256 fails closed if JWT_SECRET is missing', async () => {
    delete process.env.JWT_SECRET;
    process.env.SUPABASE_URL = 'https://uwycbvnqnpnfisvvbabu.supabase.co';

    const strategy = new JwtStrategy();

    const headerB64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payloadB64 = Buffer.from(
      JSON.stringify({
        sub: 'user_123',
        aud: 'authenticated',
        iss: 'https://uwycbvnqnpnfisvvbabu.supabase.co/auth/v1',
      }),
    ).toString('base64url');
    const token = `${headerB64}.${payloadB64}.fakesig`;

    const mockReq = { headers: { authorization: `Bearer ${token}` } };

    const result = await new Promise<{ success?: any; fail?: any; error?: any }>((resolve) => {
      strategy.success = (user) => resolve({ success: user });
      strategy.fail = (challenge, status) => resolve({ fail: { challenge, status } });
      strategy.error = (err) => resolve({ error: err });
      strategy.authenticate(mockReq as any, {});
    });

    // In passport-jwt, secretOrKeyProvider errors are reported via fail or error
    expect(result.error || result.fail).toBeDefined();
    const failureMsg = result.error?.message || (typeof result.fail?.challenge === 'string' ? result.fail.challenge : result.fail?.challenge?.message);
    expect(failureMsg).toContain('JWT_SECRET is not configured');
  });

  it('3. Verifies unsupported algorithm (e.g. none) is rejected with UnauthorizedException', async () => {
    process.env.JWT_SECRET = 'secret';
    process.env.SUPABASE_URL = 'https://uwycbvnqnpnfisvvbabu.supabase.co';

    const strategy = new JwtStrategy();

    const headerB64 = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payloadB64 = Buffer.from(
      JSON.stringify({
        sub: 'user_123',
        aud: 'authenticated',
        iss: 'https://uwycbvnqnpnfisvvbabu.supabase.co/auth/v1',
      }),
    ).toString('base64url');
    const token = `${headerB64}.${payloadB64}.`;

    const mockReq = { headers: { authorization: `Bearer ${token}` } };

    const result = await new Promise<{ success?: any; fail?: any; error?: any }>((resolve) => {
      strategy.success = (user) => resolve({ success: user });
      strategy.fail = (challenge, status) => resolve({ fail: { challenge, status } });
      strategy.error = (err) => resolve({ error: err });
      strategy.authenticate(mockReq as any, {});
    });

    expect(result.error || result.fail).toBeDefined();
    const failureMsg = result.error?.message || (typeof result.fail?.challenge === 'string' ? result.fail.challenge : result.fail?.challenge?.message);
    expect(failureMsg).toContain('Unsupported JWT algorithm: none');
  });

  it('4. Verifies validate() requires sub (user ID)', async () => {
    process.env.SUPABASE_URL = 'https://uwycbvnqnpnfisvvbabu.supabase.co';
    const strategy = new JwtStrategy();

    await expect(strategy.validate({ email: 'no-sub@example.com' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('5. Verifies validate() rejects untrusted issuer', async () => {
    process.env.SUPABASE_URL = 'https://uwycbvnqnpnfisvvbabu.supabase.co';
    const strategy = new JwtStrategy();

    await expect(
      strategy.validate({
        sub: 'user_123',
        iss: 'https://malicious-idp.com/auth/v1',
        aud: 'authenticated',
      }),
    ).rejects.toThrow('Invalid or missing token issuer');
  });

  it('6. Verifies validate() accepts trusted Supabase issuer with sub and user metadata', async () => {
    process.env.SUPABASE_URL = 'https://uwycbvnqnpnfisvvbabu.supabase.co';
    const strategy = new JwtStrategy();

    const result = await strategy.validate({
      sub: 'user_abc',
      email: 'verified@example.com',
      role: 'authenticated',
      iss: 'https://uwycbvnqnpnfisvvbabu.supabase.co/auth/v1',
      aud: 'authenticated',
      user_metadata: {
        full_name: 'Jane Doe',
      },
    });

    expect(result).toBeDefined();
    expect(result.userId).toBe('user_abc');
    expect(result.email).toBe('verified@example.com');
    expect(result.role).toBe('authenticated');
    expect(result.fullName).toBe('Jane Doe');
  });
});
