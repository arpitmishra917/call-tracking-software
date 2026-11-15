import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmailService } from '../email/email.service.js';
import * as crypto from 'crypto';

describe('AuthService - Password Reset Flow', () => {
  let service: AuthService;
  let prisma: any;
  let emailService: EmailService;

  const mockPrisma = {
    passwordResetToken: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    profile: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn().mockResolvedValue({ id: 'user-1' }),
    },
    workspaceMember: {
      findFirst: vi.fn(),
    },
    workspaceInvitation: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn((callback) => callback(mockPrisma)),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        EmailService,
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    emailService = module.get<EmailService>(EmailService);
    service.resetRateLimits();
    emailService.clearSentEmails();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('forgotPassword', () => {
    it('1. Existing account receives reset instructions through the test email provider', async () => {
      mockPrisma.profile.findFirst.mockResolvedValue({
        id: 'user-1',
        display_name: 'user@example.com',
      });
      mockPrisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.passwordResetToken.create.mockResolvedValue({
        id: 'token-id-1',
        email: 'user@example.com',
        token_hash: 'hashed',
        status: 'PENDING',
        expires_at: new Date(Date.now() + 3600000),
      });

      const result = await service.forgotPassword('user@example.com', '127.0.0.1');

      expect(result.success).toBe(true);
      expect(result.message).toContain('If an account exists');
      expect(mockPrisma.passwordResetToken.create).toHaveBeenCalled();

      // Check email was sent
      const sent = emailService.getSentEmails();
      expect(sent.length).toBe(1);
      expect(sent[0].to).toBe('user@example.com');
      expect(sent[0].resetUrl).toContain('/reset-password?token=');
      // Must use frontend origin and never port 3000 or backend
      expect(sent[0].resetUrl).not.toContain(':3000');
      expect(sent[0].resetUrl).toMatch(/^http:\/\/(localhost|127\.0\.0\.1):3001\/reset-password\?token=/);
      // The stored token hash must NOT equal the sent raw token
      const rawToken = sent[0].resetUrl.split('token=')[1];
      const createdRecordArg = mockPrisma.passwordResetToken.create.mock.calls[0][0].data;
      expect(createdRecordArg.token_hash).not.toBe(rawToken);
      expect(createdRecordArg.token_hash).toBe(service.hashToken(rawToken));
    });

    it('2. Unknown email receives the exact same public response (enumeration prevention)', async () => {
      mockPrisma.workspaceInvitation.findFirst.mockResolvedValue(null);
      mockPrisma.profile.findFirst.mockResolvedValue(null);
      mockPrisma.workspaceMember.findFirst.mockResolvedValue(null);

      const result = await service.forgotPassword('unknown@example.com', '127.0.0.2');

      expect(result.success).toBe(true);
      expect(result.message).toContain('If an account exists');
      // No token generated or persisted
      expect(mockPrisma.passwordResetToken.create).not.toHaveBeenCalled();
      // No email sent
      expect(emailService.getSentEmails().length).toBe(0);
    });

    it('3. Rate limits are enforced by IP', async () => {
      mockPrisma.workspaceInvitation.findFirst.mockResolvedValue(null);
      const ip = '192.168.1.100';

      // 5 requests allowed
      for (let i = 0; i < 5; i++) {
        await service.forgotPassword(`test${i}@example.com`, ip);
      }

      // 6th request from same IP must be rejected
      await expect(service.forgotPassword('test6@example.com', ip)).rejects.toThrow(
        HttpException,
      );
    });

    it('4. Rate limits are enforced by email address', async () => {
      mockPrisma.workspaceInvitation.findFirst.mockResolvedValue(null);
      const email = 'target@example.com';

      // 3 requests allowed
      await service.forgotPassword(email, '10.0.0.1');
      await service.forgotPassword(email, '10.0.0.2');
      await service.forgotPassword(email, '10.0.0.3');

      // 4th request for same email from different IP must be rejected
      await expect(service.forgotPassword(email, '10.0.0.4')).rejects.toThrow(
        HttpException,
      );
    });

    it('5. Email delivery failure is handled safely', async () => {
      mockPrisma.profile.findFirst.mockResolvedValue({
        id: 'user-1',
        display_name: 'user@example.com',
      });
      mockPrisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.passwordResetToken.create.mockResolvedValue({ id: '1' });

      vi.spyOn(emailService, 'sendPasswordResetEmail').mockRejectedValue(
        new Error('SMTP connection timed out'),
      );

      await expect(
        service.forgotPassword('user@example.com', '127.0.0.9'),
      ).rejects.toThrow(HttpException);
    });

    it('6. Pending unaccepted workspace invitation alone does not allow password recovery', async () => {
      mockPrisma.workspaceInvitation.findFirst.mockResolvedValue({
        id: 'inv-pending',
        email: 'pending@example.com',
        created_by: 'creator-user',
        status: 'PENDING',
      });
      mockPrisma.profile.findFirst.mockResolvedValue(null);

      const result = await service.forgotPassword('pending@example.com', '127.0.0.10');

      expect(result.success).toBe(true);
      expect(result.message).toContain('If an account exists');
      expect(mockPrisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(emailService.getSentEmails().length).toBe(0);
    });

    it('6b. Accepted workspace invitation alone NEVER returns inviter ID or allows account takeover (BUG-BE-008)', async () => {
      mockPrisma.workspaceInvitation.findFirst.mockResolvedValue({
        id: 'inv-accepted',
        email: 'invited@example.com',
        created_by: 'workspace-owner-id',
        status: 'ACCEPTED',
      });
      mockPrisma.profile.findFirst.mockResolvedValue(null);

      const result = await service.forgotPassword('invited@example.com', '127.0.0.12');

      expect(result.success).toBe(true);
      expect(result.message).toContain('If an account exists');
      // Token must NEVER be created for inviter
      expect(mockPrisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(emailService.getSentEmails().length).toBe(0);

      const account = await service.findAccountByEmail('invited@example.com');
      expect(account.exists).toBe(false);
      expect(account.userId).toBeNull();
      expect(account.userId).not.toBe('workspace-owner-id');
    });

    it('7. Fails closed with 503 when IdP (Supabase) returns server error', async () => {
      const originalFetch = global.fetch;
      const originalSecret = process.env.JWT_SECRET;
      const originalUrl = process.env.SUPABASE_URL;

      process.env.JWT_SECRET = 'mock-jwt-secret-for-testing-only-12345';
      process.env.SUPABASE_URL = 'https://mock.supabase.co';

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      } as any);

      try {
        await expect(
          service.forgotPassword('idp-fail@example.com', '127.0.0.11'),
        ).rejects.toThrow(HttpException);
      } finally {
        global.fetch = originalFetch;
        process.env.JWT_SECRET = originalSecret;
        process.env.SUPABASE_URL = originalUrl;
      }
    });
  });

  describe('verifyResetToken', () => {
    it('rejects missing or empty token', async () => {
      await expect(service.verifyResetToken('')).rejects.toThrow(BadRequestException);
    });

    it('rejects unknown token', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue(null);
      await expect(service.verifyResetToken('nonexistent')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects already USED token', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
        id: '1',
        status: 'USED',
        expires_at: new Date(Date.now() + 100000),
      });
      await expect(service.verifyResetToken('used-token')).rejects.toThrow(
        'already been used',
      );
    });

    it('rejects REVOKED token', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
        id: '1',
        status: 'REVOKED',
        expires_at: new Date(Date.now() + 100000),
      });
      await expect(service.verifyResetToken('revoked-token')).rejects.toThrow(
        'has been revoked',
      );
    });

    it('rejects EXPIRED token and updates status', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
        id: '1',
        status: 'PENDING',
        expires_at: new Date(Date.now() - 5000), // in the past
      });
      mockPrisma.passwordResetToken.update.mockResolvedValue({});

      await expect(service.verifyResetToken('expired-token')).rejects.toThrow(
        'has expired',
      );
      expect(mockPrisma.passwordResetToken.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { status: 'EXPIRED' },
      });
    });

    it('accepts valid PENDING token', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
        id: '1',
        email: 'valid@example.com',
        status: 'PENDING',
        expires_at: new Date(Date.now() + 60000),
      });

      const res = await service.verifyResetToken('valid-token');
      expect(res.valid).toBe(true);
      expect(res.email).toBe('valid@example.com');
    });
  });

  describe('resetPassword', () => {
    const rawToken = 'my-valid-secret-token-12345';
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    it('rejects password shorter than 6 characters', async () => {
      await expect(service.resetPassword(rawToken, '12345')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects invalid or non-existent token', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue(null);
      await expect(service.resetPassword('invalid', 'newPassword123')).rejects.toThrow(
        'Invalid or expired password reset token',
      );
    });

    it('rejects already USED token', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 't-1',
        token_hash: tokenHash,
        status: 'USED',
        expires_at: new Date(Date.now() + 60000),
      });

      await expect(service.resetPassword(rawToken, 'newPassword123')).rejects.toThrow(
        'already been used',
      );
    });

    it('rejects EXPIRED token', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 't-1',
        token_hash: tokenHash,
        status: 'PENDING',
        expires_at: new Date(Date.now() - 10000),
      });
      mockPrisma.passwordResetToken.update.mockResolvedValue({});

      await expect(service.resetPassword(rawToken, 'newPassword123')).rejects.toThrow(
        'has expired',
      );
    });

    it('successful reset updates token status to USED atomically and returns success', async () => {
      vi.spyOn(service, 'updateSupabasePassword').mockResolvedValue(true);

      mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 't-1',
        email: 'user@example.com',
        user_id: 'u-1',
        token_hash: tokenHash,
        status: 'PENDING',
        expires_at: new Date(Date.now() + 60000),
      });

      mockPrisma.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.resetPassword(rawToken, 'newSecurePass123');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Password has been successfully reset');
      expect(mockPrisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
        where: { id: 't-1', status: 'PENDING' },
        data: { status: 'USED' },
      });
      expect(service.updateSupabasePassword).toHaveBeenCalledWith('u-1', 'newSecurePass123');
    });

    it('concurrent reset attempts cannot reuse the same token (atomicity test)', async () => {
      mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 't-1',
        email: 'user@example.com',
        token_hash: tokenHash,
        status: 'PENDING',
        expires_at: new Date(Date.now() + 60000),
      });

      // Simulating race: updateMany returns count: 0 because another concurrent request updated it first
      mockPrisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.resetPassword(rawToken, 'firstAttempt123'),
      ).rejects.toThrow('already been used');
    });
  });
});
