import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  Put,
  Body,
  Delete,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { WorkspaceRole } from '@prisma/client';
import { WorkspacesService } from './workspaces.service.js';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { RequirePermission } from '../authorization/permissions.decorator.js';

@Controller('workspaces')
@UseGuards(JwtAuthGuard)
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Post()
  async createWorkspace(@Request() req: any, @Body() body: { name: string }) {
    return this.workspacesService.createWorkspace(req.user.userId, body.name);
  }

  @Get()
  async getUserWorkspaces(@Request() req: any) {
    return this.workspacesService.getUserWorkspaces(req.user.userId);
  }

  @Get(':workspaceId')
  @UseGuards(WorkspaceRolesGuard)
  @RequireWorkspaceRoles(
    WorkspaceRole.OWNER,
    WorkspaceRole.ADMIN,
    WorkspaceRole.MEMBER,
    WorkspaceRole.VIEWER,
  )
  async getWorkspace(@Param('workspaceId') workspaceId: string) {
    return this.workspacesService.getWorkspaceInfo(workspaceId);
  }

  @Get(':workspaceId/members')
  @UseGuards(WorkspaceRolesGuard, PermissionsGuard)
  @RequirePermission('member:read')
  @RequireWorkspaceRoles(
    WorkspaceRole.OWNER,
    WorkspaceRole.ADMIN,
    WorkspaceRole.MEMBER,
    WorkspaceRole.VIEWER,
  )
  async getMembers(
    @Param('workspaceId') workspaceId: string,
    @Request() req: any,
  ) {
    return this.workspacesService.getWorkspaceMembers(workspaceId, req.user?.userId);
  }

  @Put(':workspaceId/settings')
  @UseGuards(WorkspaceRolesGuard)
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  async updateSettings(
    @Param('workspaceId') workspaceId: string,
    @Body() data: { name: string },
  ) {
    return this.workspacesService.updateWorkspaceSettings(workspaceId, data);
  }

  @Put(':workspaceId/status')
  @UseGuards(WorkspaceRolesGuard)
  @RequireWorkspaceRoles(WorkspaceRole.OWNER)
  async updateStatus(
    @Param('workspaceId') workspaceId: string,
    @Body() data: { status: string },
    @Request() req: any,
  ) {
    return this.workspacesService.updateWorkspaceStatus(workspaceId, data.status, req.user.userId);
  }

  @Put(':workspaceId/members/:userId/role')
  @UseGuards(WorkspaceRolesGuard)
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  async updateMemberRole(
    @Param('workspaceId') workspaceId: string,
    @Param('userId') targetUserId: string,
    @Body() data: { role: WorkspaceRole },
    @Request() req: any,
  ) {
    return this.workspacesService.updateMemberRole(workspaceId, targetUserId, data.role, req.user.userId);
  }

  @Delete(':workspaceId/members/:userId')
  @UseGuards(WorkspaceRolesGuard)
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  async removeMember(
    @Param('workspaceId') workspaceId: string,
    @Param('userId') userId: string,
    @Request() req: any
  ) {
    return this.workspacesService.removeMember(workspaceId, userId, req.user.userId);
  }

  @Get(':workspaceId/members/:memberId/buyers')
  @UseGuards(WorkspaceRolesGuard)
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  async getMemberBuyers(
    @Param('workspaceId') workspaceId: string,
    @Param('memberId') memberId: string,
  ) {
    return this.workspacesService.getMemberBuyers(workspaceId, memberId);
  }

  @Post(':workspaceId/members/:memberId/buyers')
  @UseGuards(WorkspaceRolesGuard)
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  async linkBuyer(
    @Param('workspaceId') workspaceId: string,
    @Param('memberId') memberId: string,
    @Body() body: { buyerId: string },
    @Request() req: any,
  ) {
    return this.workspacesService.linkBuyerToMember(workspaceId, memberId, body.buyerId, req.user.userId);
  }

  @Delete(':workspaceId/members/:memberId/buyers/:buyerId')
  @UseGuards(WorkspaceRolesGuard)
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  async unlinkBuyer(
    @Param('workspaceId') workspaceId: string,
    @Param('memberId') memberId: string,
    @Param('buyerId') buyerId: string,
    @Request() req: any,
  ) {
    return this.workspacesService.unlinkBuyerFromMember(workspaceId, memberId, buyerId, req.user.userId);
  }

  @Get(':workspaceId/invitations')
  @UseGuards(WorkspaceRolesGuard)
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  async getInvitations(@Param('workspaceId') workspaceId: string) {
    return this.workspacesService.getWorkspaceInvitations(workspaceId);
  }

  @Post(':workspaceId/invitations')
  @UseGuards(WorkspaceRolesGuard)
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  async createInvitation(
    @Param('workspaceId') workspaceId: string,
    @Body() data: { email: string; role: WorkspaceRole; participant_type?: string; vendor_id?: string; buyer_id?: string },
    @Request() req: any,
  ) {
    return this.workspacesService.createInvitation(
      workspaceId, 
      data.email, 
      data.role, 
      req.user.userId,
      data.participant_type,
      data.vendor_id,
      data.buyer_id
    );
  }

  @Delete(':workspaceId/invitations/:inviteId')
  @UseGuards(WorkspaceRolesGuard)
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  async revokeInvitation(
    @Param('workspaceId') workspaceId: string,
    @Param('inviteId') inviteId: string,
  ) {
    return this.workspacesService.revokeInvitation(workspaceId, inviteId);
  }

  @Post('accept-invitation')
  async acceptInvitation(@Body() data: { token: string }, @Request() req: any) {
    return this.workspacesService.acceptInvitation(data.token, req.user.userId, req.user.email, req.user.fullName);
  }
}
