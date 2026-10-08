import {
  IsString,
  IsOptional,
  IsIn,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  ReconciliationRunType,
  ReconciliationStatus,
} from '@prisma/client';

export class ListReconciliationRunsDto {
  @IsOptional()
  @IsString()
  batch_id?: string;

  @IsOptional()
  @IsIn(['BATCH_LEVEL', 'WORKSPACE_LEVEL'])
  run_type?: ReconciliationRunType;

  @IsOptional()
  @IsIn(['UNRECONCILED', 'RECONCILED', 'DISCREPANCY'])
  status?: ReconciliationStatus;

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
