
import { Controller, Get, Param, NotFoundException, BadRequestException } from '@nestjs/common';
import { WorkspacesService } from './workspaces.service.js';

@Controller('invitations')
export class InvitationsController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Get('verify/:token')
  async verifyInvitation(@Param('token') token: string) {
    if (!token) throw new BadRequestException('Token is required');
    return this.workspacesService.verifyInvitationToken(token);
  }
}


