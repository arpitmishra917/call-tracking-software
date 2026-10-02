import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TransactionType } from '@prisma/client';

export interface WalletTransactionDto {
  workspaceId: string;
  amountMinor: number;
  referenceType: string;
  referenceId: string;
  idempotencyKey: string;
  description?: string;
}

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  async creditWallet(params: WalletTransactionDto) {
    if (params.amountMinor <= 0) {
      throw new BadRequestException('Credit amount must be greater than zero.');
    }

    return this.prisma.$transaction(async (tx) => {
      const existingTx = await tx.walletTransaction.findUnique({
        where: { idempotency_key: params.idempotencyKey },
      });
      if (existingTx) {
        return existingTx;
      }

      const balanceRecords = await tx.$queryRaw<any[]>`SELECT balance_minor FROM "workspace_balances" WHERE workspace_id = \${params.workspaceId} FOR UPDATE`;
      
      let currentBalance = 0;
      if (balanceRecords.length > 0) {
        currentBalance = balanceRecords[0].balance_minor;
      } else {
        await tx.workspaceBalance.create({
          data: { workspace_id: params.workspaceId, balance_minor: 0 },
        });
      }

      const newBalance = currentBalance + params.amountMinor;

      const transaction = await tx.walletTransaction.create({
        data: {
          workspace_id: params.workspaceId,
          amount_minor: params.amountMinor,
          type: TransactionType.CREDIT,
          balance_after: newBalance,
          reference_type: params.referenceType,
          reference_id: params.referenceId,
          idempotency_key: params.idempotencyKey,
          description: params.description,
        },
      });

      await tx.workspaceBalance.update({
        where: { workspace_id: params.workspaceId },
        data: { balance_minor: newBalance },
      });

      return transaction;
    });
  }

  async debitWallet(params: WalletTransactionDto) {
    if (params.amountMinor <= 0) {
      throw new BadRequestException('Debit amount must be greater than zero.');
    }

    return this.prisma.$transaction(async (tx) => {
      const existingTx = await tx.walletTransaction.findUnique({
        where: { idempotency_key: params.idempotencyKey },
      });
      if (existingTx) {
        return existingTx;
      }

      const balanceRecords = await tx.$queryRaw<any[]>`SELECT balance_minor FROM "workspace_balances" WHERE workspace_id = \${params.workspaceId} FOR UPDATE`;
      
      let currentBalance = 0;
      if (balanceRecords.length > 0) {
        currentBalance = balanceRecords[0].balance_minor;
      }

      if (currentBalance < params.amountMinor) {
        throw new BadRequestException('Insufficient funds.');
      }

      const newBalance = currentBalance - params.amountMinor;

      const transaction = await tx.walletTransaction.create({
        data: {
          workspace_id: params.workspaceId,
          amount_minor: params.amountMinor,
          type: TransactionType.DEBIT,
          balance_after: newBalance,
          reference_type: params.referenceType,
          reference_id: params.referenceId,
          idempotency_key: params.idempotencyKey,
          description: params.description,
        },
      });

      await tx.workspaceBalance.update({
        where: { workspace_id: params.workspaceId },
        data: { balance_minor: newBalance },
      });

      return transaction;
    });
  }

  async getTransactions(workspaceId: string, limit = 50, offset = 0) {
    return this.prisma.walletTransaction.findMany({
      where: { workspace_id: workspaceId },
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: offset,
    });
  }
}
