import { IsOptional, IsInt, Min, Max, IsString, MaxLength, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be at least 1' })
  @Max(100, { message: 'limit cannot exceed 100' })
  limit?: number = 50;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'offset must be an integer' })
  @Min(0, { message: 'offset must be greater than or equal to 0' })
  offset?: number = 0;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'search string cannot exceed 100 characters' })
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50, { message: 'status string cannot exceed 50 characters' })
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  sortBy?: string;

  @IsOptional()
  @IsIn(['asc', 'desc', 'ASC', 'DESC'], { message: 'sortOrder must be asc or desc' })
  sortOrder?: 'asc' | 'desc';
}
