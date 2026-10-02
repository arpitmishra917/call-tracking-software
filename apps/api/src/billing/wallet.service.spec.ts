import { Test, TestingModule } from '@nestjs/testing';
import { WalletService } from './wallet.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { TransactionType } from '@prisma/client';
import { randomUUID } from 'crypto';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('WalletService', () => {
  let service: WalletService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletService,
        {
          provide: PrismaService,
          useValue: {
            $transaction: vi.fn(async (cb) => cb(prisma)),
            $queryRaw: vi.fn(),
            walletTransaction: {
              findUnique: vi.fn(),
              create: vi.fn(),
              findMany: vi.fn(),
            },
            workspaceBalance: {
              upsert: vi.fn(),
              create: vi.fn(),
              update: vi.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<WalletService>(WalletService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('CREDIT', () => {
    it('1. credit zero/negative rejected', async () => {
      await expect(service.creditWallet({
        workspaceId: 'ws-1', amountMinor: 0, referenceType: 'TEST', referenceId: '1', idempotencyKey: 'key1'
      })).rejects.toThrow(BadRequestException);
    });

    it('2. credit positive amount & 3. balance updated & 4. ledger created & 5. balance_after correct & 6. workspace isolation', async () => {
      vi.spyOn(prisma.walletTransaction, 'findUnique').mockResolvedValue(null);
      vi.spyOn(prisma.workspaceBalance, 'upsert').mockResolvedValue({} as any);
      vi.spyOn(prisma, '$queryRaw').mockResolvedValue([{ balance_minor: 1000 }]);
      vi.spyOn(prisma.walletTransaction, 'create').mockResolvedValue({ balance_after: 1500 } as any);

      await service.creditWallet({
        workspaceId: 'ws-1', amountMinor: 500, referenceType: 'MOCK', referenceId: 'r1', idempotencyKey: 'k1'
      });

      expect(prisma.workspaceBalance.upsert).toHaveBeenCalled();
      expect(prisma.$queryRaw).toHaveBeenCalled();
      expect(prisma.walletTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          workspace_id: 'ws-1',
          amount_minor: 500,
          type: TransactionType.CREDIT,
          balance_after: 1500,
          idempotency_key: 'k1'
        })
      }));
      expect(prisma.workspaceBalance.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { workspace_id: 'ws-1' },
        data: { balance_minor: 1500 }
      }));
    });

    it('7. duplicate idempotency key exact match returns existing', async () => {
      const existing = { id: 'tx-1', amount_minor: 500, workspace_id: 'ws-1', type: TransactionType.CREDIT } as any;
      vi.spyOn(prisma.walletTransaction, 'findUnique').mockResolvedValue(existing);
      
      const res = await service.creditWallet({
        workspaceId: 'ws-1', amountMinor: 500, referenceType: 'MOCK', referenceId: 'r1', idempotencyKey: 'k1'
      });

      expect(res).toBe(existing);
      expect(prisma.walletTransaction.create).not.toHaveBeenCalled();
    });

    it('idempotency key mismatch throws ConflictException', async () => {
      const existing = { id: 'tx-1', amount_minor: 2500, workspace_id: 'ws-1', type: TransactionType.CREDIT } as any;
      vi.spyOn(prisma.walletTransaction, 'findUnique').mockResolvedValue(existing);
      
      await expect(service.creditWallet({
        workspaceId: 'ws-1', amountMinor: 10000, referenceType: 'MOCK', referenceId: 'r1', idempotencyKey: 'k1'
      })).rejects.toThrow(ConflictException);
    });
  });

  describe('DEBIT', () => {
    it('9. debit positive amount (reject negative/zero)', async () => {
      await expect(service.debitWallet({
        workspaceId: 'ws-1', amountMinor: -50, referenceType: 'TEST', referenceId: '1', idempotencyKey: 'k'
      })).rejects.toThrow(BadRequestException);
    });

    it('10. successful debit & 13. ledger created & 14. balance_after correct', async () => {
      vi.spyOn(prisma.walletTransaction, 'findUnique').mockResolvedValue(null);
      vi.spyOn(prisma.workspaceBalance, 'upsert').mockResolvedValue({} as any);
      vi.spyOn(prisma, '$queryRaw').mockResolvedValue([{ balance_minor: 5000 }]);
      
      await service.debitWallet({
        workspaceId: 'ws-1', amountMinor: 1000, referenceType: 'CALL', referenceId: 'c1', idempotencyKey: 'k2'
      });

      expect(prisma.walletTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          workspace_id: 'ws-1',
          amount_minor: 1000,
          type: TransactionType.DEBIT,
          balance_after: 4000
        })
      }));
      expect(prisma.workspaceBalance.update).toHaveBeenCalledWith(expect.objectContaining({
        data: { balance_minor: 4000 }
      }));
    });

    it('11. insufficient balance rejected', async () => {
      vi.spyOn(prisma.walletTransaction, 'findUnique').mockResolvedValue(null);
      vi.spyOn(prisma.workspaceBalance, 'upsert').mockResolvedValue({} as any);
      vi.spyOn(prisma, '$queryRaw').mockResolvedValue([{ balance_minor: 500 }]);
      
      await expect(service.debitWallet({
        workspaceId: 'ws-1', amountMinor: 1000, referenceType: 'CALL', referenceId: 'c1', idempotencyKey: 'k3'
      })).rejects.toThrow('Insufficient funds.');

      expect(prisma.walletTransaction.create).not.toHaveBeenCalled();
      expect(prisma.workspaceBalance.update).not.toHaveBeenCalled();
    });

    it('15. duplicate idempotency key exact match', async () => {
      vi.spyOn(prisma.walletTransaction, 'findUnique').mockResolvedValue({ id: 'tx-2', amount_minor: 1000, workspace_id: 'ws-1', type: TransactionType.DEBIT } as any);
      await service.debitWallet({
        workspaceId: 'ws-1', amountMinor: 1000, referenceType: 'CALL', referenceId: 'c1', idempotencyKey: 'k4'
      });
      expect(prisma.walletTransaction.create).not.toHaveBeenCalled();
    });
  });

  describe('TRANSACTION HISTORY', () => {
    it('23. correct workspace data', async () => {
      await service.getTransactions('ws-1');
      expect(prisma.walletTransaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { workspace_id: 'ws-1' }
      }));
    });
  });
});
