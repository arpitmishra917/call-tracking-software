import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  Query,
} from '@nestjs/common';
import { BlockedCallersService } from './blocked-callers.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { RequireWorkspaceRoles } from '../authorization/workspace-roles.decorator.js';
import { WorkspaceRole } from '@prisma/client';
import { BlockCallerDto, ListBlockedCallersQueryDto } from './dto/blocked-callers.dto.js';

@Controller('workspaces/:workspaceId/blocked-callers')
@UseGuards(JwtAuthGuard, WorkspaceRolesGuard)
@RequireWorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
export class BlockedCallersController {
  constructor(private readonly blockedCallersService: BlockedCallersService) {}

  @Get()
  list(
    @Param('workspaceId') workspaceId: string,
    @Query() query: ListBlockedCallersQueryDto,
  ) {
    return this.blockedCallersService.listBlockedCallers(workspaceId, {
      search: query.search,
      limit: query.limit,
      offset: query.offset,
    });
  }

  @Post()
  block(
    @Param('workspaceId') workspaceId: string,
    @Body() body: BlockCallerDto,
  ) {
    return this.blockedCallersService.blockCaller(
      workspaceId,
      body.phoneNumber,
      body.reason,
    );
  }

  @Delete(':id')
  unblock(@Param('workspaceId') workspaceId: string, @Param('id') id: string) {
    return this.blockedCallersService.unblockCaller(workspaceId, id);
  }
}
