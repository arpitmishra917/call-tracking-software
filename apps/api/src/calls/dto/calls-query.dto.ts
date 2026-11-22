import {
  IsString,
  IsOptional,
  IsInt,
  Min,
  Max,
  MaxLength,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CallState } from '@prisma/client';

export class GetCallsQueryDto {
  @IsOptional()
  @IsString()
  campaignId?: string;

  @IsOptional()
  @IsString()
  buyerId?: string;

  @IsOptional()
  @IsString()
  vendorId?: string;

  @IsOptional()
  status?: CallState;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  callerNumber?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  trackingNumber?: string;

  @IsOptional()
  @IsIn(['talk', 'total'])
  durationType?: 'talk' | 'total';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minDurationSecs?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxDurationSecs?: number;

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

export class GetCallMetricsQueryDto {
  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsString()
  campaignId?: string;

  @IsOptional()
  @IsString()
  buyerId?: string;

  @IsOptional()
  @IsString()
  vendorId?: string;

  @IsOptional()
  @IsString()
  trackingNumber?: string;

  @IsOptional()
  @IsString()
  callerNumber?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  minDuration?: string;

  @IsOptional()
  @IsString()
  maxDuration?: string;

  @IsOptional()
  @IsString()
  bucket?: string;
}
