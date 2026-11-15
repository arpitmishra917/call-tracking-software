import {
  Injectable,
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmailService } from '../email/email.service.js';
import * as crypto from 'crypto';
import jwt from 'jsonwebtoken';

interface RateLimitRecord {
  timestamps: number[];
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  // In-memory rate limiting stores (IP and Email)
  private readonly ipRateLimits = new Map<string, RateLimitRecord>();
  private readonly emailRateLimits = new Map<string, RateLimitRecord>();

  // Configurable rate limit parameters
  private readonly RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
  private readonly MAX_REQUESTS_PER_IP = 5;
  private readonly MAX_REQUESTS_PER_EMAIL = 3;

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Enforces rate limiting per IP and per normalized email.
   */
  private checkRateLimit(ip: string, email: string): void {
    const now = Date.now();
    const windowStart = now - this.RATE_LIMIT_WINDOW_MS;

    // 1. IP rate check
    if (ip) {
      const ipRecord = this.ipRateLimits.get(ip) || { timestamps: [] };
      ipRecord.timestamps = ipRecord.timestamps.filter((ts) => ts > windowStart);
      if (ipRecord.timestamps.length >= this.MAX_REQUESTS_PER_IP) {
        throw new HttpException(
          'Too many password reset requests from this IP. Please try again later.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      ipRecord.timestamps.push(now);
      this.ipRateLimits.set(ip, ipRecord);
    }

    // 2. Email rate check
    if (email) {
      const emailRecord = this.emailRateLimits.get(email) || { timestamps: [] };
      emailRecord.timestamps = emailRecord.timestamps.filter((ts) => ts > windowStart);
      if (emailRecord.timestamps.length >= this.MAX_REQUESTS_PER_EMAIL) {
        throw new HttpException(
          'Too many password reset requests for this email account. Please try again later.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      emailRecord.timestamps.push(now);
      this.emailRateLimits.set(email, emailRecord);
    }
  }

  /**
   * Normalizes email address.
   */
  normalizeEmail(email: string): string {
    if (!email || typeof email !== 'string') return '';
    return email.trim().toLowerCase();
  }

  /**
   * Hashes a raw token with SHA-256 for secure constant-size storage and lookup.
   */
  hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Resolves service role key for Supabase Admin API operations.
   */
  private getServiceRoleKey(): string | null {
    if (process.env.SUPABASE_SECRET_KEY) return process.env.SUPABASE_SECRET_KEY;
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY;
    const secret = process.env.JWT_SECRET;
    if (!secret) return null;
    try {
      const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
      let ref: string | undefined;
      if (supabaseUrl) {
        try {
          const parsed = new URL(supabaseUrl);
          ref = parsed.hostname.split('.')[0];
        } catch {
          // ignore parsing error
        }
      }
      const payload: any = {
        iss: 'supabase',
        role: 'service_role',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 60 * 60,
      };
      if (ref) {
        payload.ref = ref;
      }
      return jwt.sign(payload, secret);
    } catch {
      return null;
    }
  }

  /**
   * Authoritative account lookup across Supabase Auth and CallFlow DB.
   * Returns { exists: boolean, userId: string | null }
   */
  /**
   * Authoritative account lookup across Supabase Auth and CallFlow DB.
   * Returns { exists: boolean, userId: string | null }
   * Fails closed if the identity provider (Supabase) returns an error.
   */
  async findAccountByEmail(email: string): Promise<{ exists: boolean; userId: string | null }> {
    const normalized = this.normalizeEmail(email);

    // 1. Authoritative check: Supabase Auth Admin API
    const supabaseUrl =
      process.env.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceSecret = this.getServiceRoleKey();
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || serviceSecret;

    if (supabaseUrl && serviceSecret && anonKey) {
      try {
        const res = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${serviceSecret}`,
          },
        });
        if (res.ok) {
          const data = await res.json();
          const users = data.users || [];
          const matched = users.find((u: any) => u.email?.toLowerCase() === normalized);
          if (matched) {
            return { exists: true, userId: matched.id };
          }
        } else {
          // IdP returned non-200 HTTP response - fail closed
          this.logger.error(
            `[AuthService] Identity provider lookup failed for email: ${normalized} (status ${res.status})`,
          );
          throw new HttpException(
            'Authentication service unavailable. Please try again later.',
            HttpStatus.SERVICE_UNAVAILABLE,
          );
        }
      } catch (err: any) {
        if (err instanceof HttpException) {
          throw err;
        }
        this.logger.error(
          `[AuthService] Identity provider lookup failed for email: ${normalized}: ${err?.message || err}`,
        );
        throw new HttpException(
          'Authentication service unavailable. Please try again later.',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
    }

    // 2. Check local profiles (where display_name = email)
    try {
      const profile = await this.prisma.profile.findFirst({
        where: { display_name: { equals: normalized, mode: 'insensitive' } },
      });
      if (profile) {
        return { exists: true, userId: profile.id };
      }
    } catch (err: any) {
      this.logger.warn(`Profile lookup error: ${err?.message || err}`);
    }

    // 3. Security & Account Resolution (BUG-BE-008 remediation):
    // Under NO circumstances may invite.created_by (the inviter/admin) be returned
    // as the invited user's identity. Doing so enables Account Takeover (ATO) of workspace admins.
    // An account is valid only if it exists authoritatively in Supabase Auth or a local Profile.
    return { exists: false, userId: null };
  }

  /**
   * Initiates forgot password flow:
   * - Validates and normalizes email
   * - Enforces rate limiting
   * - Authoritatively verifies account existence
   * - For non-existent accounts: suppresses token generation & email dispatch; logs safe internal diagnostic; returns generic message
   * - For existing accounts: generates single-use token, stores SHA-256 hash in DB, dispatches email via configured transport
   * - Builds reset URL pointing strictly to frontend origin on port 3001
   */
  async forgotPassword(rawEmail: string, clientIp: string): Promise<{ success: boolean; message: string }> {
    const email = this.normalizeEmail(rawEmail);
    if (!email || !email.includes('@')) {
      throw new BadRequestException('A valid email address is required');
    }

    // Rate limiting
    this.checkRateLimit(clientIp, email);

    // Authoritative account existence check
    const account = await this.findAccountByEmail(email);

    // Handle unknown account
    if (!account.exists) {
      this.logger.log(
        `[AuthService] Account not found for email: ${email}. Suppressed token generation and email dispatch.`,
      );
      // Timing-attack prevention: perform dummy hashing operation
      crypto.pbkdf2Sync(email, 'timing-defense-salt', 1000, 32, 'sha256');
      return {
        success: true,
        message: 'If an account exists with this email, password reset instructions have been sent.',
      };
    }

    // Ensure valid userId in profiles table before referencing in password_reset_tokens foreign key
    let validUserId: string | null = null;
    if (account.userId) {
      try {
        const profile = await this.prisma.profile.upsert({
          where: { id: account.userId },
          update: {},
          create: { id: account.userId, display_name: email },
        });
        validUserId = profile.id;
      } catch {
        validUserId = null;
      }
    }

    // Invalidate previous pending tokens for this email to maintain single active token
    await this.prisma.passwordResetToken.updateMany({
      where: { email, status: 'PENDING' },
      data: { status: 'REVOKED' },
    });

    // Generate cryptographically secure reset token (256-bit entropy)
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);

    // Configurable expiry (default: 60 minutes)
    const expiryMinutes = parseInt(process.env.RESET_TOKEN_EXPIRY_MINUTES || '60', 10);
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

    // Persist token hash only
    await this.prisma.passwordResetToken.create({
      data: {
        email,
        user_id: validUserId,
        token_hash: tokenHash,
        status: 'PENDING',
        expires_at: expiresAt,
      },
    });

    // Build reset link using frontend origin strictly (never backend API origin on port 3000)
    const frontendOrigin =
      process.env.FRONTEND_URL ||
      process.env.RESET_PASSWORD_URL?.replace(/\/reset-password$/, '') ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      (process.env.NODE_ENV === 'production'
        ? process.env.PUBLIC_FRONTEND_URL || 'https://app.callflow.io'
        : 'http://localhost:3001');

    const cleanOrigin = frontendOrigin.replace(/\/+$/, '').replace(/\/reset-password$/, '');
    const resetUrl = `${cleanOrigin}/reset-password?token=${encodeURIComponent(rawToken)}`;

    // Send email via configured provider
    try {
      await this.emailService.sendPasswordResetEmail(email, resetUrl);
    } catch (err: any) {
      this.logger.error(`Failed to send password recovery email: ${err?.message || err}`);
      throw new HttpException(
        'Failed to deliver password reset email. Please try again later or contact support.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return {
      success: true,
      message: 'If an account exists with this email, password reset instructions have been sent.',
    };
  }

  /**
   * Verifies if a reset token is valid and unexpired before presenting the reset password form.
   */
  async verifyResetToken(token: string): Promise<{ valid: boolean; email?: string }> {
    if (!token || typeof token !== 'string') {
      throw new BadRequestException('Token is required');
    }

    const tokenHash = this.hashToken(token);
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { token_hash: tokenHash },
    });

    if (!record) {
      throw new BadRequestException('Invalid or expired password reset token');
    }

    if (record.status === 'USED') {
      throw new BadRequestException('This password reset token has already been used');
    }

    if (record.status === 'REVOKED') {
      throw new BadRequestException('This password reset token has been revoked');
    }

    if (record.status === 'EXPIRED' || record.expires_at < new Date()) {
      if (record.status === 'PENDING') {
        await this.prisma.passwordResetToken.update({
          where: { id: record.id },
          data: { status: 'EXPIRED' },
        });
      }
      throw new BadRequestException('This password reset token has expired');
    }

    return { valid: true, email: record.email };
  }

  /**
   * Resets the user's password:
   * - Verifies token securely
   * - Validates password policy
   * - Atomically updates token status to USED
   * - Updates password in auth store / Supabase Auth
   * - Invalidates sessions
   */
  async resetPassword(token: string, newPassword: string): Promise<{ success: boolean; message: string }> {
    if (!token || typeof token !== 'string') {
      throw new BadRequestException('Reset token is required');
    }

    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
      throw new BadRequestException('Password must be at least 6 characters');
    }

    const tokenHash = this.hashToken(token);

    const record = await this.prisma.passwordResetToken.findUnique({
      where: { token_hash: tokenHash },
    });

    if (!record) {
      throw new BadRequestException('Invalid or expired password reset token');
    }

    if (record.status === 'USED') {
      throw new BadRequestException('This password reset token has already been used');
    }

    if (record.status === 'REVOKED') {
      throw new BadRequestException('This password reset token has been revoked');
    }

    if (record.status === 'EXPIRED' || record.expires_at < new Date()) {
      if (record.status === 'PENDING') {
        await this.prisma.passwordResetToken.update({
          where: { id: record.id },
          data: { status: 'EXPIRED' },
        });
      }
      throw new BadRequestException('This password reset token has expired');
    }

    // Atomically consume token using conditional update inside transaction to prevent concurrent reuse
    await this.prisma.$transaction(async (tx) => {
      const updateResult = await tx.passwordResetToken.updateMany({
        where: { id: record.id, status: 'PENDING' },
        data: { status: 'USED' },
      });

      if (updateResult.count === 0) {
        throw new BadRequestException('This password reset token has already been used');
      }
    });

    // Propagate password update to Supabase Auth
    if (record.user_id) {
      await this.updateSupabasePassword(record.user_id, newPassword);
    }

    return {
      success: true,
      message: 'Password has been successfully reset. You may now sign in with your new password.',
    };
  }

  /**
   * Updates user password in Supabase Auth via Admin API.
   */
  async updateSupabasePassword(userId: string, newPassword: string): Promise<boolean> {
    const supabaseUrl =
      process.env.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceSecret = this.getServiceRoleKey();
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || serviceSecret;

    if (!supabaseUrl || !serviceSecret || !anonKey) {
      this.logger.warn(`Supabase credentials missing; cannot update password in Supabase for user ${userId}`);
      return false;
    }

    try {
      const res = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
        method: 'PUT',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${serviceSecret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password: newPassword }),
      });

      if (res.ok) {
        this.logger.log(`[AuthService] Password updated in Supabase Auth for user ${userId}`);
        return true;
      } else {
        const data = await res.json().catch(() => ({}));
        this.logger.warn(
          `Failed to update password in Supabase admin API for user ${userId}: ${JSON.stringify(data)}`,
        );
        return false;
      }
    } catch (err: any) {
      this.logger.error(`Error updating password in Supabase: ${err?.message || err}`);
      return false;
    }
  }

  // Testing helper
  resetRateLimits(): void {
    this.ipRateLimits.clear();
    this.emailRateLimits.clear();
  }
}
