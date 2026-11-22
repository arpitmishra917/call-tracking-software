import { IsString, IsNotEmpty, IsOptional, MaxLength, IsIn, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateVendorDto {
  @IsString()
  @IsNotEmpty({ message: 'Vendor name is required' })
  @MaxLength(100, { message: 'Vendor name cannot exceed 100 characters' })
  name!: string;
}

export class UpdateVendorDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE', 'ARCHIVED'], {
    message: 'Status must be ACTIVE, INACTIVE, or ARCHIVED',
  })
  status?: string;
}

export class ListVendorsQueryDto {
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
