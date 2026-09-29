import { Controller, Get, Put, Body, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { AccountService } from './account.service.js';

@Controller('account')
@UseGuards(JwtAuthGuard)
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @Get()
  async getAccount(@Request() req: any) {
    return this.accountService.getAccount(req.user.userId);
  }

  @Put('profile')
  async updateProfile(@Request() req: any, @Body() data: { fullName: string }) {
    return this.accountService.updateProfile(req.user.userId, data.fullName);
  }

}
