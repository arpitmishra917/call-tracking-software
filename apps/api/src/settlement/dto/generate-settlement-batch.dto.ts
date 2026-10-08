import { IsEnum, IsDateString, IsOptional, IsString } from 'class-validator';
import { SettlementParticipantType } from '@prisma/client';

export class GenerateSettlementBatchDto {
  @IsEnum(SettlementParticipantType)
  participant_type: SettlementParticipantType;

  @IsDateString()
  period_start: string;

  @IsDateString()
  period_end: string;

  @IsOptional()
  @IsString()
  buyer_id?: string;

  @IsOptional()
  @IsString()
  vendor_id?: string;
}
