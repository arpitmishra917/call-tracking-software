import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsIn,
  MaxLength,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DisputeStatus } from '@prisma/client';

export class CreateDisputeDto {
  @IsString()
  @IsNotEmpty({ message: 'Dispute reason is required' })
  @MaxLength(255, { message: 'Dispute reason cannot exceed 255 characters' })
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Description cannot exceed 2000 characters' })
  description?: string;
}

export class ResolveDisputeDto {
  @IsIn([DisputeStatus.ACCEPTED, DisputeStatus.REJECTED], {
    message: 'Status must be ACCEPTED or REJECTED',
  })
  status!: DisputeStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Resolution notes cannot exceed 2000 characters' })
  resolution_notes?: string;
}

export class DirectResolveDisputeDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Resolution notes cannot exceed 2000 characters' })
  resolution_notes?: string;
}

export class ListDisputesQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  buyerId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}
