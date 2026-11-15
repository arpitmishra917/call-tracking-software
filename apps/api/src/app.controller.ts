import {
  Controller,
  Get,
  UseGuards,
  Request,
  Query,
  Res,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { AppService } from './app.service.js';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /**
   * Catches any browser requests hitting the backend origin for /reset-password
   * and safely redirects them to the CallFlow Next.js frontend on port 3001.
   */
  @Get('reset-password')
  redirectToFrontendReset(
    @Query('token') token: string,
    @Res() res: Response,
  ) {
    const frontendBase =
      process.env.FRONTEND_URL ||
      process.env.RESET_PASSWORD_URL?.replace(/\/reset-password$/, '') ||
      'http://localhost:3001';
    const cleanBase = frontendBase.replace(/\/+$/, '').replace(/\/reset-password$/, '');
    const redirectUrl = token
      ? `${cleanBase}/reset-password?token=${encodeURIComponent(token)}`
      : `${cleanBase}/reset-password`;
    return res.redirect(HttpStatus.FOUND, redirectUrl);
  }

  @UseGuards(JwtAuthGuard)
  @Get('protected')
  getProtected(@Request() req: any): any {
    return {
      message: 'This is a protected route',
      user: req.user, // provided by JwtStrategy validate method
    };
  }
}
