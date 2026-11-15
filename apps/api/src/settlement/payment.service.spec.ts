import { Test, TestingModule } from '@nestjs/testing';
import { PaymentService } from './payment.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import {
  SettlementStatus,
  PaymentStatus,
  InstructionStatus,
  ExecutionStatus,
  PaymentDirection,
  SettlementParticipantType,
  Prisma,
} from '@prisma/client';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('PaymentService Unit Tests', () => {
  let service: PaymentService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentService,
        {
          provide: PrismaService,
          useValue: {
            $transaction: vi.fn(async (cb) => cb(prisma)),
            settlementBatch: {
              findFirst: vi.fn(),
              findUnique: vi.fn(),
              update: vi.fn(),
            },
            paymentInstruction: {
              findUnique: vi.fn(),
              findFirst: vi.fn(),
              findMany: vi.fn(),
              count: vi.fn(),
              create: vi.fn(),
              update: vi.fn(),
            },
            paymentExecution: {
              findUnique: vi.fn(),
              findFirst: vi.fn(),
              findMany: vi.fn(),
              create: vi.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<PaymentService>(PaymentService);
    prisma = module.get<PrismaService>(PrismaService);
    process.env.NODE_ENV = 'test';
    process.env.WALLET_MOCK_PAYMENTS_ENABLED = 'true';
  });

  describe('createPaymentInstruction', () => {
    it('1. instruction creation from FINALIZED batch succeeds', async () => {
      const mockBatch: any = {
        id: 'batch-1',
        workspace_id: 'ws-1',
        settlement_status: SettlementStatus.FINALIZED,
        payment_status: PaymentStatus.UNPROCESSED,
        participant_type: SettlementParticipantType.BUYER,
        buyer_id: 'buyer-1',
        vendor_id: null,
        net_amount: new Prisma.Decimal('150.0000'),
        currency: 'USD',
      };

      vi.spyOn(prisma.settlementBatch, 'findFirst').mockResolvedValue(mockBatch);
      vi.spyOn(prisma.paymentInstruction, 'findUnique').mockResolvedValue(null);
      vi.spyOn(prisma.paymentInstruction, 'create').mockResolvedValue({
        id: 'pi-1',
        workspace_id: 'ws-1',
        settlement_batch_id: 'batch-1',
        direction: PaymentDirection.COLLECTION,
        participant_type: SettlementParticipantType.BUYER,
        buyer_id: 'buyer-1',
        vendor_id: null,
        amount: mockBatch.net_amount,
        currency: 'USD',
        idempotency_key: 'pi_ws-1_batch-1',
        status: InstructionStatus.CREATED,
      } as any);
      vi.spyOn(prisma.settlementBatch, 'update').mockResolvedValue({} as any);

      const result = await service.createPaymentInstruction('ws-1', 'batch-1');

      expect(result.id).toBe('pi-1');
      expect(result.direction).toBe(PaymentDirection.COLLECTION);
      expect(prisma.paymentInstruction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            direction: PaymentDirection.COLLECTION,
            amount: mockBatch.net_amount,
            currency: 'USD',
            status: InstructionStatus.CREATED,
          }),
        }),
      );
      expect(prisma.settlementBatch.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'batch-1' },
          data: { payment_status: PaymentStatus.PENDING },
        }),
      );
    });

    it('2. rejects non-FINALIZED batch (e.g. DRAFT)', async () => {
      const mockBatch: any = {
        id: 'batch-2',
        workspace_id: 'ws-1',
        settlement_status: SettlementStatus.DRAFT,
        payment_status: PaymentStatus.UNPROCESSED,
        participant_type: SettlementParticipantType.BUYER,
        net_amount: new Prisma.Decimal('100.0000'),
        currency: 'USD',
      };

      vi.spyOn(prisma.settlementBatch, 'findFirst').mockResolvedValue(mockBatch);
      vi.spyOn(prisma.paymentInstruction, 'findUnique').mockResolvedValue(null);

      await expect(
        service.createPaymentInstruction('ws-1', 'batch-2'),
      ).rejects.toThrow(BadRequestException);
    });

    it('3. idempotent instruction creation returns existing instruction', async () => {
      const mockBatch: any = {
        id: 'batch-3',
        workspace_id: 'ws-1',
        settlement_status: SettlementStatus.FINALIZED,
        payment_status: PaymentStatus.PENDING,
      };
      const existingInstruction: any = {
        id: 'pi-existing',
        settlement_batch_id: 'batch-3',
      };

      vi.spyOn(prisma.settlementBatch, 'findFirst').mockResolvedValue(mockBatch);
      vi.spyOn(prisma.paymentInstruction, 'findUnique').mockResolvedValue(
        existingInstruction,
      );

      const result = await service.createPaymentInstruction('ws-1', 'batch-3');
      expect(result).toBe(existingInstruction);
      expect(prisma.paymentInstruction.create).not.toHaveBeenCalled();
    });

    it('4. vendor batch creates DISBURSEMENT direction', async () => {
      const mockBatch: any = {
        id: 'batch-vendor',
        workspace_id: 'ws-1',
        settlement_status: SettlementStatus.FINALIZED,
        payment_status: PaymentStatus.UNPROCESSED,
        participant_type: SettlementParticipantType.VENDOR,
        buyer_id: null,
        vendor_id: 'vendor-1',
        net_amount: new Prisma.Decimal('200.0000'),
        currency: 'EUR',
      };

      vi.spyOn(prisma.settlementBatch, 'findFirst').mockResolvedValue(mockBatch);
      vi.spyOn(prisma.paymentInstruction, 'findUnique').mockResolvedValue(null);
      vi.spyOn(prisma.paymentInstruction, 'create').mockResolvedValue({
        id: 'pi-vendor',
        direction: PaymentDirection.DISBURSEMENT,
        vendor_id: 'vendor-1',
      } as any);
      vi.spyOn(prisma.settlementBatch, 'update').mockResolvedValue({} as any);

      const result = await service.createPaymentInstruction('ws-1', 'batch-vendor');
      expect(prisma.paymentInstruction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            direction: PaymentDirection.DISBURSEMENT,
            vendor_id: 'vendor-1',
            buyer_id: null,
            currency: 'EUR',
          }),
        }),
      );
    });
  });

  describe('createPaymentExecution & retry', () => {
    it('5. creates payment execution attempt #1 with SUCCEEDED status and closes batch', async () => {
      const mockInstruction: any = {
        id: 'pi-10',
        workspace_id: 'ws-1',
        settlement_batch_id: 'batch-10',
        amount: new Prisma.Decimal('500.0000'),
        currency: 'USD',
        status: InstructionStatus.CREATED,
        executions: [],
        batch: {
          id: 'batch-10',
          settlement_status: SettlementStatus.FINALIZED,
          payment_status: PaymentStatus.PENDING,
        },
      };

      vi.spyOn(prisma.paymentInstruction, 'findFirst').mockResolvedValue(mockInstruction);
      vi.spyOn(prisma.paymentExecution, 'create').mockResolvedValue({
        id: 'pe-1',
        attempt_number: 1,
        status: ExecutionStatus.SUCCEEDED,
      } as any);
      vi.spyOn(prisma.paymentInstruction, 'update').mockResolvedValue({} as any);
      vi.spyOn(prisma.settlementBatch, 'update').mockResolvedValue({} as any);

      const result = await service.createPaymentExecution('ws-1', 'pi-10', {
        provider: 'manual',
        simulate_status: 'SUCCEEDED',
      });

      expect(prisma.paymentExecution.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            attempt_number: 1,
            provider: 'manual',
            status: ExecutionStatus.SUCCEEDED,
          }),
        }),
      );
      expect(prisma.paymentInstruction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pi-10' },
          data: { status: InstructionStatus.SUCCEEDED },
        }),
      );
      expect(prisma.settlementBatch.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'batch-10' },
          data: expect.objectContaining({
            payment_status: PaymentStatus.SUCCEEDED,
            settlement_status: SettlementStatus.CLOSED,
          }),
        }),
      );
    });

    it('6. failed execution updates batch payment_status to FAILED but does not close batch', async () => {
      const mockInstruction: any = {
        id: 'pi-11',
        workspace_id: 'ws-1',
        settlement_batch_id: 'batch-11',
        amount: new Prisma.Decimal('300.0000'),
        currency: 'USD',
        status: InstructionStatus.CREATED,
        executions: [],
        batch: {
          id: 'batch-11',
          settlement_status: SettlementStatus.FINALIZED,
          payment_status: PaymentStatus.PENDING,
        },
      };

      vi.spyOn(prisma.paymentInstruction, 'findFirst').mockResolvedValue(mockInstruction);
      vi.spyOn(prisma.paymentExecution, 'create').mockResolvedValue({
        id: 'pe-failed',
        attempt_number: 1,
        status: ExecutionStatus.FAILED,
      } as any);
      vi.spyOn(prisma.paymentInstruction, 'update').mockResolvedValue({} as any);
      vi.spyOn(prisma.settlementBatch, 'update').mockResolvedValue({} as any);

      await service.createPaymentExecution('ws-1', 'pi-11', {
        provider: 'wire',
        simulate_status: 'FAILED',
        failure_code: 'INSUFFICIENT_FUNDS',
        failure_reason: 'Account balance insufficient',
      });

      expect(prisma.settlementBatch.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'batch-11' },
          data: { payment_status: PaymentStatus.FAILED },
        }),
      );
    });

    it('7. retry creates attempt #2 leaving previous attempt immutable', async () => {
      const previousAttempt: any = {
        id: 'pe-att-1',
        attempt_number: 1,
        provider: 'mock',
        status: ExecutionStatus.FAILED,
      };

      const mockInstruction: any = {
        id: 'pi-12',
        workspace_id: 'ws-1',
        settlement_batch_id: 'batch-12',
        amount: new Prisma.Decimal('100.0000'),
        currency: 'USD',
        status: InstructionStatus.FAILED,
        executions: [previousAttempt],
        batch: {
          id: 'batch-12',
          settlement_status: SettlementStatus.FINALIZED,
          payment_status: PaymentStatus.FAILED,
        },
      };

      vi.spyOn(prisma.paymentInstruction, 'findFirst').mockResolvedValue(mockInstruction);
      vi.spyOn(prisma.paymentExecution, 'create').mockResolvedValue({
        id: 'pe-att-2',
        attempt_number: 2,
        status: ExecutionStatus.SUCCEEDED,
      } as any);
      vi.spyOn(prisma.paymentInstruction, 'update').mockResolvedValue({} as any);
      vi.spyOn(prisma.settlementBatch, 'update').mockResolvedValue({} as any);

      await service.retryPaymentExecution('ws-1', 'pi-12', {
        simulate_status: 'SUCCEEDED',
      });

      expect(prisma.paymentExecution.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            attempt_number: 2,
            status: ExecutionStatus.SUCCEEDED,
          }),
        }),
      );
    });

    it('8. rejects execution when instruction is in terminal SUCCEEDED state', async () => {
      const mockInstruction: any = {
        id: 'pi-terminal',
        workspace_id: 'ws-1',
        settlement_batch_id: 'batch-terminal',
        status: InstructionStatus.SUCCEEDED,
        executions: [{ attempt_number: 1, status: ExecutionStatus.SUCCEEDED }],
        batch: {
          settlement_status: SettlementStatus.CLOSED,
          payment_status: PaymentStatus.SUCCEEDED,
        },
      };

      vi.spyOn(prisma.paymentInstruction, 'findFirst').mockResolvedValue(mockInstruction);

      await expect(
        service.createPaymentExecution('ws-1', 'pi-terminal', {
          provider: 'manual',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('9. rejects mock execution in production mode even if mock flag is enabled', async () => {
      process.env.NODE_ENV = 'production';
      process.env.WALLET_MOCK_PAYMENTS_ENABLED = 'true';

      await expect(
        service.createPaymentExecution('ws-1', 'pi-mock-1', {
          provider: 'mock',
        }),
      ).rejects.toThrow(ForbiddenException);

      process.env.NODE_ENV = 'test';
    });

    it('10. rejects mock execution in non-production when WALLET_MOCK_PAYMENTS_ENABLED is disabled or missing', async () => {
      process.env.NODE_ENV = 'test';
      delete process.env.WALLET_MOCK_PAYMENTS_ENABLED;

      await expect(
        service.createPaymentExecution('ws-1', 'pi-mock-2', {
          provider: 'mock',
        }),
      ).rejects.toThrow(ForbiddenException);

      process.env.WALLET_MOCK_PAYMENTS_ENABLED = 'true';
    });

    it('11. allows mock execution in test mode with explicit enablement', async () => {
      process.env.NODE_ENV = 'test';
      process.env.WALLET_MOCK_PAYMENTS_ENABLED = 'true';

      const mockInstruction: any = {
        id: 'pi-mock-valid',
        workspace_id: 'ws-1',
        settlement_batch_id: 'batch-mock-1',
        amount: new Prisma.Decimal('100.0000'),
        currency: 'USD',
        status: InstructionStatus.CREATED,
        executions: [],
        batch: {
          id: 'batch-mock-1',
          settlement_status: SettlementStatus.FINALIZED,
          payment_status: PaymentStatus.PENDING,
        },
      };

      vi.spyOn(prisma.paymentInstruction, 'findFirst').mockResolvedValue(mockInstruction);
      vi.spyOn(prisma.paymentExecution, 'create').mockResolvedValue({
        id: 'pe-mock-valid',
        attempt_number: 1,
        provider: 'mock',
        status: ExecutionStatus.SUCCEEDED,
      } as any);
      vi.spyOn(prisma.paymentInstruction, 'update').mockResolvedValue({} as any);
      vi.spyOn(prisma.settlementBatch, 'update').mockResolvedValue({} as any);

      const result = await service.createPaymentExecution('ws-1', 'pi-mock-valid', {
        provider: 'mock',
        simulate_status: 'SUCCEEDED',
      });

      expect(result.provider).toBe('mock');
      expect(prisma.paymentExecution.create).toHaveBeenCalled();
    });

    it('12. allows real payment execution (wire/manual) in production unaffected', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.WALLET_MOCK_PAYMENTS_ENABLED;

      const mockInstruction: any = {
        id: 'pi-wire-prod',
        workspace_id: 'ws-1',
        settlement_batch_id: 'batch-wire-prod',
        amount: new Prisma.Decimal('500.0000'),
        currency: 'USD',
        status: InstructionStatus.CREATED,
        executions: [],
        batch: {
          id: 'batch-wire-prod',
          settlement_status: SettlementStatus.FINALIZED,
          payment_status: PaymentStatus.PENDING,
        },
      };

      vi.spyOn(prisma.paymentInstruction, 'findFirst').mockResolvedValue(mockInstruction);
      vi.spyOn(prisma.paymentExecution, 'create').mockResolvedValue({
        id: 'pe-wire-1',
        attempt_number: 1,
        provider: 'wire',
        status: ExecutionStatus.SUCCEEDED,
      } as any);
      vi.spyOn(prisma.paymentInstruction, 'update').mockResolvedValue({} as any);
      vi.spyOn(prisma.settlementBatch, 'update').mockResolvedValue({} as any);

      const result = await service.createPaymentExecution('ws-1', 'pi-wire-prod', {
        provider: 'wire',
        simulate_status: 'SUCCEEDED',
      });

      expect(result.provider).toBe('wire');
      expect(prisma.paymentExecution.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ provider: 'wire' }),
        }),
      );

      process.env.NODE_ENV = 'test';
      process.env.WALLET_MOCK_PAYMENTS_ENABLED = 'true';
    });
  });
});
