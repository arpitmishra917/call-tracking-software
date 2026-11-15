import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Query,
  Req,
  HttpCode,
  HttpStatus,
  ValidationPipe,
  UsePipes,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';
import { EmailService } from '../email/email.service.js';
import { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly emailService: EmailService,
  ) {}

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() req: Request,
  ) {
    const clientIp =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      '';

    return this.authService.forgotPassword(dto.email, clientIp);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.password);
  }

  @Get('verify-reset-token')
  async verifyResetToken(@Query('token') token: string) {
    return this.authService.verifyResetToken(token);
  }

  /**
   * Safe development-only endpoint to inspect in-memory dev mailbox.
   * Strictly disabled (returns 404) in production.
   */
  @Get('dev/mailbox')
  async getDevMailbox() {
    if (process.env.NODE_ENV === 'production') {
      throw new NotFoundException();
    }
    const emails = this.emailService.getSentEmails();
    return {
      success: true,
      count: emails.length,
      emails,
    };
  }

  /**
   * Safe development-only endpoint to retrieve the most recent reset link.
   * Strictly disabled (returns 404) in production.
   */
  @Get('dev/last-reset-link')
  async getLastResetLink(@Query('email') email?: string) {
    if (process.env.NODE_ENV === 'production') {
      throw new NotFoundException();
    }
    const last = this.emailService.getLastSentEmail(email);
    if (!last) {
      throw new NotFoundException('No reset emails found in development mailbox');
    }
    return {
      success: true,
      to: last.to,
      subject: last.subject,
      resetUrl: last.resetUrl,
      sentAt: last.sentAt,
    };
  }

  /**
   * Safe development-only endpoint to clear the dev mailbox.
   * Strictly disabled (returns 404) in production.
   */
  @Delete('dev/mailbox')
  async clearDevMailbox() {
    if (process.env.NODE_ENV === 'production') {
      throw new NotFoundException();
    }
    this.emailService.clearSentEmails();
    return { success: true, message: 'Dev mailbox cleared' };
  }
}
