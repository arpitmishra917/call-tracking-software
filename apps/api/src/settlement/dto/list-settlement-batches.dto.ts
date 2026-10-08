import { IsEnum, IsOptional, IsString } from 'class-validator';
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
  limit?: string | number;

  @IsOptional()
  offset?: string | number;
}
