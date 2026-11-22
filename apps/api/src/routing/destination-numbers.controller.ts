import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { PermissionsGuard } from '../authorization/permissions.guard.js';
import { RequirePermission, RequireResourceScope } from '../authorization/permissions.decorator.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { WorkspaceRole } from '@prisma/client';
import { DestinationNumbersService } from './destination-numbers.service.js';
import {
  CreateDestinationNumberDto,
  UpdateDestinationNumberDto,
  ListDestinationNumbersQueryDto,
} from './dto/destination-numbers.dto.js';

@Controller('workspaces/:workspaceId')
@UseGuards(JwtAuthGuard, WorkspaceRolesGuard, PermissionsGuard)
export class DestinationNumbersController {
  constructor(private readonly service: DestinationNumbersService) {}

  @Post('buyers/:buyerId/destination-numbers')
  @RequirePermission('buyer:update')
  @RequireResourceScope('buyer', 'buyerId')
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  async createForBuyer(
    @Param('workspaceId') workspaceId: string,
    @Param('buyerId') buyerId: string,
    @Body() body: CreateDestinationNumberDto,
  ) {
    return this.service.createDestinationNumber(workspaceId, buyerId, body);
  }

  @Get('buyers/:buyerId/destination-numbers')
  @RequirePermission('buyer:read')
  @RequireResourceScope('buyer', 'buyerId')
  async listForBuyer(
    @Param('workspaceId') workspaceId: string,
    @Param('buyerId') buyerId: string,
    @Request() req: any,
  ) {
    return this.service.listBuyerDestinationNumbers(workspaceId, buyerId, req?.user?.userId);
  }

  @Get('destination-numbers')
  @RequirePermission('buyer:read')
  async listAll(
    @Param('workspaceId') workspaceId: string,
    @Request() req: any,
    @Query() query: ListDestinationNumbersQueryDto,
  ) {
    return this.service.listWorkspaceDestinationNumbers(workspaceId, req?.user?.userId, {
      search: query.search,
      status: query.status,
      limit: query.limit,
      offset: query.offset,
    });
  }

  @Get('destination-numbers/:id')
  @RequirePermission('buyer:read')
  async getOne(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Request() req: any,
  ) {
    return this.service.getDestinationNumber(workspaceId, id, req?.user?.userId);
  }

  @Put('destination-numbers/:id')
  @Patch('destination-numbers/:id')
  @RequirePermission('buyer:update')
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  async update(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Body() body: UpdateDestinationNumberDto,
    @Request() req: any,
  ) {
    return this.service.updateDestinationNumber(workspaceId, id, body, req?.user?.userId);
  }

  @Post('destination-numbers/:id/archive')
  @RequirePermission('buyer:update')
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  async archive(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Request() req: any,
  ) {
    return this.service.setStatus(workspaceId, id, 'INACTIVE', req?.user?.userId);
  }

  @Post('destination-numbers/:id/activate')
  @RequirePermission('buyer:update')
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  async activate(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Request() req: any,
  ) {
    return this.service.setStatus(workspaceId, id, 'ACTIVE', req?.user?.userId);
  }

  @Delete('destination-numbers/:id')
  @RequirePermission('buyer:update')
  @RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
  async delete(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Request() req: any,
  ) {
    return this.service.deleteDestinationNumber(workspaceId, id, req?.user?.userId);
  }
}
