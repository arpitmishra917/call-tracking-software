import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, HttpException } from '@nestjs/common';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { EmailService } from '../src/email/email.service.js';
import * as crypto from 'crypto';

describe('Password Reset Integration & E2E Suite', () => {
  let moduleRef: TestingModule;
  let authService: AuthService;
  let prisma: PrismaService;
  let emailService: EmailService;

  const testEmail = `reset-test-${crypto.randomBytes(4).toString('hex')}@example.com`;
  const unknownEmail = `unknown-${crypto.randomBytes(4).toString('hex')}@example.com`;
  let testUserId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [AuthService, PrismaService, EmailService],
    }).compile();

    authService = moduleRef.get(AuthService);
    prisma = moduleRef.get(PrismaService);
    emailService = moduleRef.get(EmailService);

    // Create an existing test profile and invitation to represent a registered account
    testUserId = crypto.randomUUID();
    await prisma.profile.create({
      data: {
        id: testUserId,
        display_name: testEmail,
      },
    });
  });

  afterAll(async () => {
    try {
      await prisma.passwordResetToken.deleteMany({
        where: { email: { in: [testEmail, unknownEmail] } },
      });
      await prisma.profile.deleteMany({
        where: { id: testUserId },
      });
    } catch {
      // Cleanup best effort
    }
    await prisma.$disconnect();
    await moduleRef.close();
  });

  beforeEach(() => {
    authService.resetRateLimits();
    emailService.clearSentEmails();
  });

  it('1. Existing account receives reset instructions via configured email provider', async () => {
    const response = await authService.forgotPassword(testEmail, '127.0.0.1');

    expect(response.success).toBe(true);
    expect(response.message).toContain('If an account exists');

    const sent = emailService.getSentEmails();
    expect(sent.length).toBe(1);
    expect(sent[0].to).toBe(testEmail);
    expect(sent[0].resetUrl).toContain('http://localhost:3001/reset-password?token=');

    // Extract raw token from resetUrl
    const rawToken = sent[0].resetUrl.split('token=')[1];
    expect(rawToken).toBeDefined();

    // Verify token was stored hashed, NOT in raw format
    const tokenHash = authService.hashToken(rawToken);
    const dbRecord = await prisma.passwordResetToken.findUnique({
      where: { token_hash: tokenHash },
    });
    expect(dbRecord).not.toBeNull();
    expect(dbRecord?.email).toBe(testEmail);
    expect(dbRecord?.status).toBe('PENDING');
  });

  it('2. Unknown email receives the exact same public response and generates NO tokens or emails', async () => {
    const response = await authService.forgotPassword(unknownEmail, '127.0.0.1');

    expect(response.success).toBe(true);
    expect(response.message).toContain('If an account exists');

    // No emails sent for unknown accounts
    expect(emailService.getSentEmails().length).toBe(0);

    // No token created in DB for unknown accounts
    const tokens = await prisma.passwordResetToken.findMany({
      where: { email: unknownEmail },
    });
    expect(tokens.length).toBe(0);
  });

  it('3. Invalid, expired, and reused tokens are rejected', async () => {
    // A: Invalid token
    await expect(
      authService.resetPassword('completely-fake-token', 'NewSecurePassword123!'),
    ).rejects.toThrow('Invalid or expired password reset token');

    // B: Expired token
    const expiredToken = crypto.randomBytes(32).toString('hex');
    const expiredHash = authService.hashToken(expiredToken);
    await prisma.passwordResetToken.create({
      data: {
        email: testEmail,
        token_hash: expiredHash,
        status: 'PENDING',
        expires_at: new Date(Date.now() - 60000), // Expired 1 minute ago
      },
    });

    await expect(
      authService.resetPassword(expiredToken, 'NewSecurePassword123!'),
    ).rejects.toThrow('This password reset token has expired');

    // C: Already USED token
    const usedToken = crypto.randomBytes(32).toString('hex');
    const usedHash = authService.hashToken(usedToken);
    await prisma.passwordResetToken.create({
      data: {
        email: testEmail,
        token_hash: usedHash,
        status: 'USED',
        expires_at: new Date(Date.now() + 60000),
      },
    });

    await expect(
      authService.resetPassword(usedToken, 'NewSecurePassword123!'),
    ).rejects.toThrow('This password reset token has already been used');
  });

  it('4. Successful reset changes password and consumes token atomically', async () => {
    // Generate valid reset token
    await authService.forgotPassword(testEmail, '127.0.0.1');
    const sent = emailService.getLastSentEmail();
    const rawToken = sent!.resetUrl.split('token=')[1];

    const result = await authService.resetPassword(rawToken, 'BrandNewPassword2026!');
    expect(result.success).toBe(true);
    expect(result.message).toContain('Password has been successfully reset');

    // Token must now be USED in the database
    const tokenHash = authService.hashToken(rawToken);
    const dbRecord = await prisma.passwordResetToken.findUnique({
      where: { token_hash: tokenHash },
    });
    expect(dbRecord?.status).toBe('USED');

    // Attempting to reuse the exact same token now fails
    await expect(
      authService.resetPassword(rawToken, 'AnotherPassword2026!'),
    ).rejects.toThrow('This password reset token has already been used');
  });

  it('5. Concurrent reset attempts cannot reuse the same token', async () => {
    await authService.forgotPassword(testEmail, '127.0.0.1');
    const sent = emailService.getLastSentEmail();
    const rawToken = sent!.resetUrl.split('token=')[1];

    // Fire 2 concurrent reset requests with the same token
    const results = await Promise.allSettled([
      authService.resetPassword(rawToken, 'ConcurrentPass1!'),
      authService.resetPassword(rawToken, 'ConcurrentPass2!'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactly one must succeed, and one must fail
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
  });

  it('6. Invalid passwords are rejected', async () => {
    await authService.forgotPassword(testEmail, '127.0.0.1');
    const sent = emailService.getLastSentEmail();
    const rawToken = sent!.resetUrl.split('token=')[1];

    // Too short (< 6 chars)
    await expect(authService.resetPassword(rawToken, '12345')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('7. Rate limits are enforced on forgot password endpoint', async () => {
    const ip = '198.51.100.42';

    // 5 attempts allowed
    for (let i = 0; i < 5; i++) {
      await authService.forgotPassword(`user_${i}@example.com`, ip);
    }

    // 6th attempt rejected with 429
    await expect(
      authService.forgotPassword('user_overflow@example.com', ip),
    ).rejects.toThrow(HttpException);
  });
});
