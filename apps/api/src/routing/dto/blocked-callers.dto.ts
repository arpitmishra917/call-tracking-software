import { IsString, IsNotEmpty, IsOptional, MaxLength, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class BlockCallerDto {
  @IsString()
  @IsNotEmpty({ message: 'phoneNumber is required' })
  phoneNumber!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}

export class ListBlockedCallersQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

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
