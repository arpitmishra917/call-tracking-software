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
  InstructionStatus,
  PaymentDirection,
  SettlementParticipantType,
} from '@prisma/client';

export class CreatePaymentExecutionDto {
  @IsString()
  @IsIn(['manual', 'wire', 'mock'])
  provider: string;

  @IsOptional()
  @IsString()
  idempotency_key?: string;

  @IsOptional()
  @IsString()
  provider_transaction_id?: string;

  @IsOptional()
  @IsIn(['SUCCEEDED', 'FAILED', 'PROCESSING'])
  simulate_status?: 'SUCCEEDED' | 'FAILED' | 'PROCESSING';

  @IsOptional()
  @IsString()
  failure_code?: string;

  @IsOptional()
  @IsString()
  failure_reason?: string;
}

export class RetryPaymentExecutionDto {
  @IsOptional()
  @IsString()
  @IsIn(['manual', 'wire', 'mock'])
  provider?: string;

  @IsOptional()
  @IsString()
  idempotency_key?: string;

  @IsOptional()
  @IsString()
  provider_transaction_id?: string;

  @IsOptional()
  @IsIn(['SUCCEEDED', 'FAILED', 'PROCESSING'])
  simulate_status?: 'SUCCEEDED' | 'FAILED' | 'PROCESSING';

  @IsOptional()
  @IsString()
  failure_code?: string;

  @IsOptional()
  @IsString()
  failure_reason?: string;
}

export class ListPaymentInstructionsDto {
  @IsOptional()
  @IsString()
  batch_id?: string;

  @IsOptional()
  @IsIn(['CREATED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELED'])
  status?: InstructionStatus;

  @IsOptional()
  @IsIn(['COLLECTION', 'DISBURSEMENT'])
  direction?: PaymentDirection;

  @IsOptional()
  @IsIn(['BUYER', 'VENDOR'])
  participant_type?: SettlementParticipantType;

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
