import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { AppService } from './app.service.js';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
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
