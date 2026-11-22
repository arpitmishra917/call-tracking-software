import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class MockTopUpDto {
  @Type(() => Number)
  @IsInt({ message: 'amountMinor must be an integer' })
  @Min(100, { message: 'Minimum top-up amount is 100 minor units ($1.00)' })
  @Max(100000000, { message: 'Maximum top-up amount is 100,000,000 minor units' })
  amountMinor!: number;

  @IsOptional()
  @IsString()
  returnUrl?: string;
}

export class CreateCheckoutSessionDto {
  @IsString()
  @IsNotEmpty({ message: 'planId is required' })
  planId!: string;

  @IsString()
  @IsNotEmpty({ message: 'returnUrl is required' })
  returnUrl!: string;
}

export class CreatePortalSessionDto {
  @IsString()
  @IsNotEmpty({ message: 'returnUrl is required' })
  returnUrl!: string;
}

export class WalletTransactionsQueryDto {
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
