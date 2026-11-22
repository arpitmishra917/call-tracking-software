import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  Min,
  Max,
  MaxLength,
  Length,
  IsIn,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCampaignDto {
  @IsString()
  @IsNotEmpty({ message: 'Campaign name is required' })
  @MaxLength(100, { message: 'Campaign name cannot exceed 100 characters' })
  name!: string;

  @IsOptional()
  default_revenue_amount?: number | string | null;

  @IsOptional()
  default_payout_amount?: number | string | null;

  @IsOptional()
  @IsString()
  @Length(3, 3, { message: 'currency must be a valid 3-letter currency code (e.g. USD)' })
  currency?: string;

  @IsOptional()
  conversion_duration_secs?: number | string | null;
}

export class UpdateCampaignDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: string;

  @IsOptional()
  default_revenue_amount?: number | string | null;

  @IsOptional()
  default_payout_amount?: number | string | null;

  @IsOptional()
  @IsString()
  @Length(3, 3, { message: 'currency must be a valid 3-letter currency code (e.g. USD)' })
  currency?: string;

  @IsOptional()
  conversion_duration_secs?: number | string | null;
}

export class AssignPhoneNumberDto {
  @IsString()
  @IsNotEmpty({ message: 'phoneNumberId is required' })
  phoneNumberId!: string;
}

export class AssignBuyerDto {
  @IsString()
  @IsNotEmpty({ message: 'buyerId is required' })
  buyerId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  priority?: number = 0;
}

export class BatchAssignBuyersDto {
  @IsArray()
  @IsString({ each: true })
  buyerIds!: string[];
}

export class AssignDestinationNumberDto {
  @IsString()
  @IsNotEmpty({ message: 'destinationNumberId is required' })
  destinationNumberId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  priority?: number = 0;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  weight?: number = 100;
}

export class BatchAssignDestinationNumbersDto {
  @IsArray()
  @IsString({ each: true })
  destinationNumberIds!: string[];
}

export class ListCampaignsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE', 'ARCHIVED'])
  status?: string;

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
