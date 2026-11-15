import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { EmailService } from '../email/email.service.js';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: AuthService;
  let emailService: EmailService;

  const mockAuthService = {
    forgotPassword: vi.fn(),
    resetPassword: vi.fn(),
    verifyResetToken: vi.fn(),
  };

  const mockEmailService = {
    getSentEmails: vi.fn().mockReturnValue([]),
    getLastSentEmail: vi.fn(),
    clearSentEmails: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
        {
          provide: EmailService,
          useValue: mockEmailService,
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get<AuthService>(AuthService);
    emailService = module.get<EmailService>(EmailService);
  });

  it('forgotPassword delegates to service with client IP', async () => {
    mockAuthService.forgotPassword.mockResolvedValue({
      success: true,
      message: 'Instructions sent',
    });

    const mockReq = {
      headers: { 'x-forwarded-for': '203.0.113.195, 70.41.3.18' },
      socket: { remoteAddress: '127.0.0.1' },
    } as any;

    const res = await controller.forgotPassword({ email: 'user@test.com' }, mockReq);

    expect(res.success).toBe(true);
    expect(mockAuthService.forgotPassword).toHaveBeenCalledWith('user@test.com', '203.0.113.195');
  });

  it('resetPassword delegates to service with token and password', async () => {
    mockAuthService.resetPassword.mockResolvedValue({
      success: true,
      message: 'Password reset',
    });

    const res = await controller.resetPassword({
      token: 'tok_123',
      password: 'new_pass_456',
    });

    expect(res.success).toBe(true);
    expect(mockAuthService.resetPassword).toHaveBeenCalledWith('tok_123', 'new_pass_456');
  });

  it('verifyResetToken delegates to service with token', async () => {
    mockAuthService.verifyResetToken.mockResolvedValue({ valid: true });

    const res = await controller.verifyResetToken('tok_abc');

    expect(res.valid).toBe(true);
    expect(mockAuthService.verifyResetToken).toHaveBeenCalledWith('tok_abc');
  });

  it('getDevMailbox returns sent emails in dev mode', async () => {
    mockEmailService.getSentEmails.mockReturnValue([
      { to: 'test@example.com', subject: 'Reset', resetUrl: 'http://localhost:3001/reset-password?token=abc', sentAt: new Date() },
    ]);

    const res = await controller.getDevMailbox();
    expect(res.success).toBe(true);
    expect(res.count).toBe(1);
    expect(res.emails.length).toBe(1);
  });

  it('getLastResetLink returns last reset link for email', async () => {
    mockEmailService.getLastSentEmail.mockReturnValue({
      to: 'test@example.com',
      subject: 'Reset',
      resetUrl: 'http://localhost:3001/reset-password?token=abc',
      sentAt: new Date(),
    });

    const res = await controller.getLastResetLink('test@example.com');
    expect(res.success).toBe(true);
    expect(res.to).toBe('test@example.com');
    expect(res.resetUrl).toContain('token=abc');
  });
});
