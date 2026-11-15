import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EmailService } from './email.service.js';

describe('EmailService - Provider Selection and Delivery', () => {
  let emailService: EmailService;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    emailService = new EmailService();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('captures emails in-memory when dev provider is active', async () => {
    process.env.NODE_ENV = 'development';
    process.env.EMAIL_PROVIDER = 'dev';
    delete process.env.SMTP_HOST;

    const result = await emailService.sendPasswordResetEmail('user@test.local', 'http://localhost:3001/reset-password?token=123');

    expect(result).toBe(true);
    const sent = emailService.getSentEmails();
    expect(sent.length).toBe(1);
    expect(sent[0].to).toBe('user@test.local');
    expect(sent[0].resetUrl).toContain('token=123');
  });

  it('fails fast when EMAIL_PROVIDER=smtp but SMTP_HOST is missing (no silent dev fallback)', async () => {
    process.env.NODE_ENV = 'development';
    process.env.EMAIL_PROVIDER = 'smtp';
    delete process.env.SMTP_HOST;

    await expect(
      emailService.sendPasswordResetEmail('user@test.local', 'http://localhost:3001/reset-password?token=123'),
    ).rejects.toThrow('SMTP configuration incomplete: SMTP_HOST is required');

    // Must NOT have captured the email into dev mailer
    expect(emailService.getSentEmails().length).toBe(0);
  });

  it('fails fast when SMTP transport rejects connection (no silent dev fallback)', async () => {
    process.env.NODE_ENV = 'development';
    process.env.EMAIL_PROVIDER = 'smtp';
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = '25255'; // Non-existent SMTP port

    await expect(
      emailService.sendPasswordResetEmail('user@test.local', 'http://localhost:3001/reset-password?token=123'),
    ).rejects.toThrow('Email delivery failed');

    // Must NOT have captured into dev mailer
    expect(emailService.getSentEmails().length).toBe(0);
  });

  it('fails fast in production when no email provider is configured', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.EMAIL_PROVIDER;
    delete process.env.SMTP_HOST;

    await expect(
      emailService.sendPasswordResetEmail('user@test.local', 'http://localhost:3001/reset-password?token=123'),
    ).rejects.toThrow('Email service is not configured');

    expect(emailService.getSentEmails().length).toBe(0);
  });
});
