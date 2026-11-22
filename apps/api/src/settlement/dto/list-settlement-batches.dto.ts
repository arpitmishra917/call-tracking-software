import { IsEnum, IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import {
  SettlementParticipantType,
  SettlementStatus,
  PaymentStatus,
  ReconciliationStatus,
} from '@prisma/client';

export class ListSettlementBatchesDto {
  @IsOptional()
  @IsEnum(SettlementParticipantType)
  participant_type?: SettlementParticipantType;

  @IsOptional()
  @IsString()
  buyer_id?: string;

  @IsOptional()
  @IsString()
  vendor_id?: string;

  @IsOptional()
  @IsEnum(SettlementStatus)
  settlement_status?: SettlementStatus;

  @IsOptional()
  @IsEnum(PaymentStatus)
  payment_status?: PaymentStatus;

  @IsOptional()
  @IsEnum(ReconciliationStatus)
  reconciliation_status?: ReconciliationStatus;

  @IsOptional()
  @IsString()
  period_start?: string;

  @IsOptional()
  @IsString()
  period_end?: string;

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
}
