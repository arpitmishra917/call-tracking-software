import { Test, TestingModule } from '@nestjs/testing';
import { WalletService } from './wallet.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { TransactionType } from '@prisma/client';
import { randomUUID } from 'crypto';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('WalletService (Micro-units)', () => {
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
        workspaceId: 'ws-1', amountMicro: 0n, referenceType: 'TEST', referenceId: '1', idempotencyKey: 'key1'
      })).rejects.toThrow(BadRequestException);
    });

    it('2. credit positive amount micro & ledger mapped correctly', async () => {
      vi.spyOn(prisma.walletTransaction, 'findUnique').mockResolvedValue(null);
      vi.spyOn(prisma.workspaceBalance, 'upsert').mockResolvedValue({} as any);
      vi.spyOn(prisma, '$queryRaw').mockResolvedValue([{ balance_micro: 10000000n }]); // $10.00
      vi.spyOn(prisma.walletTransaction, 'create').mockResolvedValue({ balance_after_micro: 15000000n } as any);

      await service.creditWallet({
        workspaceId: 'ws-1', amountMicro: 5000000n, referenceType: 'MOCK', referenceId: 'r1', idempotencyKey: 'k1'
      });

      expect(prisma.workspaceBalance.upsert).toHaveBeenCalled();
      expect(prisma.$queryRaw).toHaveBeenCalled();
      expect(prisma.walletTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          workspace_id: 'ws-1',
          amount_minor: 500, // 5000000 / 10000
          amount_micro: 5000000n,
          type: TransactionType.CREDIT,
          balance_after: 1500,
          balance_after_micro: 15000000n,
          idempotency_key: 'k1'
        })
      }));
      expect(prisma.workspaceBalance.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { workspace_id: 'ws-1' },
        data: { 
          balance_minor: 1500,
          balance_micro: 15000000n 
        }
      }));
    });

    it('duplicate idempotency exact match', async () => {
      const existing = { id: 'tx-1', amount_micro: 5000000n, workspace_id: 'ws-1', type: TransactionType.CREDIT } as any;
      vi.spyOn(prisma.walletTransaction, 'findUnique').mockResolvedValue(existing);
      
      const res = await service.creditWallet({
        workspaceId: 'ws-1', amountMicro: 5000000n, referenceType: 'MOCK', referenceId: 'r1', idempotencyKey: 'k1'
      });

      expect(res).toBe(existing);
    });

    it('idempotency key mismatch throws ConflictException', async () => {
      const existing = { id: 'tx-1', amount_micro: 25000000n, workspace_id: 'ws-1', type: TransactionType.CREDIT } as any;
      vi.spyOn(prisma.walletTransaction, 'findUnique').mockResolvedValue(existing);
      
      await expect(service.creditWallet({
        workspaceId: 'ws-1', amountMicro: 10000000n, referenceType: 'MOCK', referenceId: 'r1', idempotencyKey: 'k1'
      })).rejects.toThrow(ConflictException);
    });
  });

  describe('DEBIT', () => {
    it('debit negative amount micro rejected', async () => {
      await expect(service.debitWallet({
        workspaceId: 'ws-1', amountMicro: -50n, referenceType: 'TEST', referenceId: '1', idempotencyKey: 'k'
      })).rejects.toThrow(BadRequestException);
    });

    it('successful debit micro', async () => {
      vi.spyOn(prisma.walletTransaction, 'findUnique').mockResolvedValue(null);
      vi.spyOn(prisma.workspaceBalance, 'upsert').mockResolvedValue({} as any);
      vi.spyOn(prisma, '$queryRaw').mockResolvedValue([{ balance_micro: 50000000n }]); // $50.00
      
      await service.debitWallet({
        workspaceId: 'ws-1', amountMicro: 10000000n, referenceType: 'CALL', referenceId: 'c1', idempotencyKey: 'k2'
      });

      expect(prisma.walletTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          workspace_id: 'ws-1',
          amount_micro: 10000000n,
          type: TransactionType.DEBIT,
          balance_after_micro: 40000000n,
          balance_after: 4000
        })
      }));
    });

    it('insufficient balance micro rejected cleanly', async () => {
      vi.spyOn(prisma.walletTransaction, 'findUnique').mockResolvedValue(null);
      vi.spyOn(prisma.workspaceBalance, 'upsert').mockResolvedValue({} as any);
      vi.spyOn(prisma, '$queryRaw').mockResolvedValue([{ balance_micro: 500n }]); // 0.05 cents
      
      await expect(service.debitWallet({
        workspaceId: 'ws-1', amountMicro: 45000n, // 4.5 cents
        referenceType: 'CALL', referenceId: 'c1', idempotencyKey: 'k3'
      })).rejects.toThrow('Insufficient funds.');

      expect(prisma.walletTransaction.create).not.toHaveBeenCalled();
    });
  });
});
