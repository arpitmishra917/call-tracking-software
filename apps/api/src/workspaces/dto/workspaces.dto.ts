import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsEmail,
  MaxLength,
  IsIn,
} from 'class-validator';
import { WorkspaceRole } from '@prisma/client';

export class CreateWorkspaceDto {
  @IsString()
  @IsNotEmpty({ message: 'Workspace name is required' })
  @MaxLength(100, { message: 'Workspace name cannot exceed 100 characters' })
  name!: string;
}

export class UpdateWorkspaceSettingsDto {
  @IsString()
  @IsNotEmpty({ message: 'Workspace name is required' })
  @MaxLength(100, { message: 'Workspace name cannot exceed 100 characters' })
  name!: string;
}

export class UpdateWorkspaceStatusDto {
  @IsString()
  @IsNotEmpty({ message: 'Workspace status is required' })
  @IsIn(['ACTIVE', 'SUSPENDED', 'ARCHIVED'], {
    message: 'Status must be ACTIVE, SUSPENDED, or ARCHIVED',
  })
  status!: string;
}

export class UpdateMemberRoleDto {
  @IsEnum(WorkspaceRole, {
    message: 'Role must be a valid WorkspaceRole (OWNER, ADMIN, MEMBER, VIEWER)',
  })
  role!: WorkspaceRole;
}

export class InviteMemberDto {
  @IsEmail({}, { message: 'Valid email address is required' })
  @IsNotEmpty({ message: 'Email is required' })
  email!: string;

  @IsEnum(WorkspaceRole, {
    message: 'Role must be a valid WorkspaceRole (OWNER, ADMIN, MEMBER, VIEWER)',
  })
  role!: WorkspaceRole;

  @IsOptional()
  @IsIn(['INTERNAL', 'VENDOR', 'BUYER'], {
    message: 'participant_type must be INTERNAL, VENDOR, or BUYER',
  })
  participant_type?: string;

  @IsOptional()
  @IsString()
  vendor_id?: string;

  @IsOptional()
  @IsString()
  buyer_id?: string;
}

export class AcceptInvitationDto {
  @IsString()
  @IsNotEmpty({ message: 'Invitation token is required' })
  token!: string;
}

export class LinkBuyerDto {
  @IsString()
  @IsNotEmpty({ message: 'buyerId is required' })
  buyerId!: string;
}
