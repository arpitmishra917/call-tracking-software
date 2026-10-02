import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { WalletService } from '../src/billing/wallet.service.js';
import { CallState } from '@prisma/client';
import { randomUUID as uuidv4 } from 'crypto';
import { expect, describe, it, beforeAll, afterAll, beforeEach } from 'vitest';

describe('Phase 3E: Mid-Call Reservation Extension', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let wallet: WalletService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [PrismaService, WalletService],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    wallet = moduleRef.get(WalletService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await moduleRef.close();
  });

  const clearDb = async (wsIds: string[]) => {
    await prisma.callReservationExtension.deleteMany({ where: { workspace_id: { in: wsIds } }});
    await prisma.callReservation.deleteMany({ where: { workspace_id: { in: wsIds } }});
    await prisma.walletTransaction.deleteMany({ where: { workspace_id: { in: wsIds } }});
    await prisma.workspaceBalance.deleteMany({ where: { workspace_id: { in: wsIds } }});
    await prisma.callAttempt.deleteMany({ where: { call: { workspace_id: { in: wsIds } } }});
    await prisma.call.deleteMany({ where: { workspace_id: { in: wsIds } }});
    await prisma.workspace.deleteMany({ where: { id: { in: wsIds } }});
  };

  describe('Wallet Extensions Engine', () => {
    it('TEST 1: extension with sufficient funds', async () => {
      const wsId = uuidv4();
      await clearDb([wsId]);
      await prisma.workspace.create({ data: { id: wsId, name: 'T1', slug: wsId } });
      await wallet.creditWallet({ workspaceId: wsId, amountMicro: 200000n, referenceType: 'MANUAL', referenceId: 't1', idempotencyKey: uuidv4() });
      
      const cId = uuidv4();
      await prisma.call.create({ data: { id: cId, workspace_id: wsId, to_number: '+1', from_number: '+2', provider: 'telnyx', provider_call_id: cId, state: CallState.ROUTING } });
      
      await wallet.reserveForCall(wsId, cId, 50000n);
      
      // Act: Extend
      const res = await wallet.extendReservationForCall(wsId, cId, 50000n, `extension:${cId}:1`);
      expect(res.totalReservedMicro).toBe(100000n);
      expect(res.availableMicro).toBe(100000n);

      const dbRes = await prisma.callReservation.findUnique({ where: { call_id: cId } });
      expect(dbRes?.total_reserved_micro).toBe(100000n);
    });

    it('TEST 2: extension with insufficient funds', async () => {
      const wsId = uuidv4();
      await clearDb([wsId]);
      await prisma.workspace.create({ data: { id: wsId, name: 'T2', slug: wsId } });
      await wallet.creditWallet({ workspaceId: wsId, amountMicro: 100000n, referenceType: 'MANUAL', referenceId: 't2', idempotencyKey: uuidv4() });
      
      const cId = uuidv4();
      await prisma.call.create({ data: { id: cId, workspace_id: wsId, to_number: '+1', from_number: '+2', provider: 'telnyx', provider_call_id: cId, state: CallState.ROUTING } });
      
      await wallet.reserveForCall(wsId, cId, 80000n);
      
      // Act: Extend 50k when only 20k available
      await expect(wallet.extendReservationForCall(wsId, cId, 50000n, `extension:${cId}:1`)).rejects.toThrow('Insufficient available funds');
      
      const bal = await prisma.workspaceBalance.findUnique({ where: { workspace_id: wsId } });
      expect(bal?.balance_micro).toBe(100000n);
      expect(bal?.reserved_micro).toBe(80000n);
    });

    it('TEST 4: duplicate concurrent same extension key', async () => {
      const wsId = uuidv4();
      await clearDb([wsId]);
      await prisma.workspace.create({ data: { id: wsId, name: 'T4', slug: wsId } });
      await wallet.creditWallet({ workspaceId: wsId, amountMicro: 500000n, referenceType: 'MANUAL', referenceId: 't4', idempotencyKey: uuidv4() });
      
      const cId = uuidv4();
      await prisma.call.create({ data: { id: cId, workspace_id: wsId, to_number: '+1', from_number: '+2', provider: 'telnyx', provider_call_id: cId, state: CallState.ROUTING } });
      
      await wallet.reserveForCall(wsId, cId, 50000n);
      
      const p1 = wallet.extendReservationForCall(wsId, cId, 50000n, `extension:${cId}:1`);
      const p2 = wallet.extendReservationForCall(wsId, cId, 50000n, `extension:${cId}:1`); // same key
      
      await Promise.allSettled([p1, p2]);
      
      const bal = await prisma.workspaceBalance.findUnique({ where: { workspace_id: wsId } });
      expect(bal?.reserved_micro).toBe(100000n); // exactly 1 extension processed
    });

    it('TEST 6: concurrent different calls', async () => {
      const wsId = uuidv4();
      await clearDb([wsId]);
      await prisma.workspace.create({ data: { id: wsId, name: 'T6', slug: wsId } });
      await wallet.creditWallet({ workspaceId: wsId, amountMicro: 120000n, referenceType: 'MANUAL', referenceId: 't6', idempotencyKey: uuidv4() });
      
      const c1 = uuidv4();
      const c2 = uuidv4();
      await prisma.call.create({ data: { id: c1, workspace_id: wsId, to_number: '+1', from_number: '+2', provider: 'telnyx', provider_call_id: c1, state: CallState.ROUTING } });
      await prisma.call.create({ data: { id: c2, workspace_id: wsId, to_number: '+1', from_number: '+2', provider: 'telnyx', provider_call_id: c2, state: CallState.ROUTING } });
      
      await wallet.reserveForCall(wsId, c1, 50000n);
      await wallet.reserveForCall(wsId, c2, 50000n);
      // available: 20k
      
      const p1 = wallet.extendReservationForCall(wsId, c1, 30000n, `extension:${c1}:1`);
      const p2 = wallet.extendReservationForCall(wsId, c2, 30000n, `extension:${c2}:1`);
      
      const res = await Promise.allSettled([p1, p2]);
      
      const successCount = res.filter(r => r.status === 'fulfilled').length;
      expect(successCount).toBe(0); // neither can get 30k
      
      const bal = await prisma.workspaceBalance.findUnique({ where: { workspace_id: wsId } });
      expect(bal?.reserved_micro).toBe(100000n);
    });

    it('TEST 15: settlement after extension', async () => {
      const wsId = uuidv4();
      await clearDb([wsId]);
      await prisma.workspace.create({ data: { id: wsId, name: 'T15', slug: wsId } });
      await wallet.creditWallet({ workspaceId: wsId, amountMicro: 500000n, referenceType: 'MANUAL', referenceId: 't15', idempotencyKey: uuidv4() });
      
      const cId = uuidv4();
      await prisma.call.create({ data: { id: cId, workspace_id: wsId, to_number: '+1', from_number: '+2', provider: 'telnyx', provider_call_id: cId, state: CallState.ROUTING } });
      
      await wallet.reserveForCall(wsId, cId, 100000n);
      await wallet.extendReservationForCall(wsId, cId, 100000n, `extension:${cId}:1`);
      
      // Act: Settle for 150000
      await wallet.settleReservation(wsId, cId, 150000n);
      
      const bal = await prisma.workspaceBalance.findUnique({ where: { workspace_id: wsId } });
      expect(bal?.balance_micro).toBe(350000n);
      expect(bal?.reserved_micro).toBe(0n);
      
      const ledger = await prisma.walletTransaction.findMany({ where: { reference_id: cId } });
      expect(ledger.length).toBe(1);
    });
  });
});
