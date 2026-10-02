import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TransactionType } from '@prisma/client';

export interface WalletTransactionMicroDto {
  workspaceId: string;
  amountMicro: bigint;
  referenceType: string;
  referenceId: string;
  idempotencyKey: string;
  description?: string;
}

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  async creditWallet(params: WalletTransactionMicroDto) {
    if (params.amountMicro <= 0n) {
      throw new BadRequestException('Credit amount must be greater than zero.');
    }

    return this.prisma.$transaction(async (tx) => {
      const existingTx = await tx.walletTransaction.findUnique({
        where: { idempotency_key: params.idempotencyKey },
      });
      if (existingTx) {
        if (
          existingTx.amount_micro !== params.amountMicro ||
          existingTx.workspace_id !== params.workspaceId ||
          existingTx.type !== TransactionType.CREDIT
        ) {
          throw new ConflictException('Idempotency key reuse detected with materially different parameters.');
        }
        return existingTx;
      }

      await tx.workspaceBalance.upsert({
        where: { workspace_id: params.workspaceId },
        create: { 
          workspace_id: params.workspaceId, 
          balance_minor: 0, 
          balance_micro: 0n 
        },
        update: {},
      });

      const balanceRecords = await tx.$queryRaw<any[]>`SELECT balance_micro FROM "workspace_balances" WHERE workspace_id = \${params.workspaceId} FOR UPDATE`;
      const currentBalanceMicro = BigInt(balanceRecords[0].balance_micro);

      const newBalanceMicro = currentBalanceMicro + params.amountMicro;
      const newBalanceMinor = Number(newBalanceMicro / 10000n);

      const transaction = await tx.walletTransaction.create({
        data: {
          workspace_id: params.workspaceId,
          amount_minor: Number(params.amountMicro / 10000n), // Keep legacy populated safely
          amount_micro: params.amountMicro,
          type: TransactionType.CREDIT,
          balance_after: newBalanceMinor,
          balance_after_micro: newBalanceMicro,
          reference_type: params.referenceType,
          reference_id: params.referenceId,
          idempotency_key: params.idempotencyKey,
          description: params.description,
        },
      });

      await tx.workspaceBalance.update({
        where: { workspace_id: params.workspaceId },
        data: { 
          balance_minor: newBalanceMinor,
          balance_micro: newBalanceMicro
        },
      });

      return transaction;
    });
  }

  async debitWallet(params: WalletTransactionMicroDto) {
    if (params.amountMicro <= 0n) {
      throw new BadRequestException('Debit amount must be greater than zero.');
    }

    return this.prisma.$transaction(async (tx) => {
      const existingTx = await tx.walletTransaction.findUnique({
        where: { idempotency_key: params.idempotencyKey },
      });
      if (existingTx) {
        if (
          existingTx.amount_micro !== params.amountMicro ||
          existingTx.workspace_id !== params.workspaceId ||
          existingTx.type !== TransactionType.DEBIT
        ) {
          throw new ConflictException('Idempotency key reuse detected with materially different parameters.');
        }
        return existingTx;
      }

      await tx.workspaceBalance.upsert({
        where: { workspace_id: params.workspaceId },
        create: { 
          workspace_id: params.workspaceId, 
          balance_minor: 0, 
          balance_micro: 0n 
        },
        update: {},
      });

      const balanceRecords = await tx.$queryRaw<any[]>`SELECT balance_micro FROM "workspace_balances" WHERE workspace_id = \${params.workspaceId} FOR UPDATE`;
      const currentBalanceMicro = BigInt(balanceRecords[0].balance_micro);

      if (currentBalanceMicro < params.amountMicro) {
        throw new BadRequestException('Insufficient funds.');
      }

      const newBalanceMicro = currentBalanceMicro - params.amountMicro;
      const newBalanceMinor = Number(newBalanceMicro / 10000n);

      const transaction = await tx.walletTransaction.create({
        data: {
          workspace_id: params.workspaceId,
          amount_minor: Number(params.amountMicro / 10000n),
          amount_micro: params.amountMicro,
          type: TransactionType.DEBIT,
          balance_after: newBalanceMinor,
          balance_after_micro: newBalanceMicro,
          reference_type: params.referenceType,
          reference_id: params.referenceId,
          idempotency_key: params.idempotencyKey,
          description: params.description,
        },
      });

      await tx.workspaceBalance.update({
        where: { workspace_id: params.workspaceId },
        data: { 
          balance_minor: newBalanceMinor,
          balance_micro: newBalanceMicro 
        },
      });

      return transaction;
    });
  }

  async getTransactions(workspaceId: string, limit = 50, offset = 0) {
    const txs = await this.prisma.walletTransaction.findMany({
      where: { workspace_id: workspaceId },
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: offset,
    });
    return txs.map(tx => ({
      ...tx,
      amount_micro: tx.amount_micro ? tx.amount_micro.toString() : '0',
      balance_after_micro: tx.balance_after_micro ? tx.balance_after_micro.toString() : '0'
    }));
  }
}
