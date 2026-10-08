import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { CommercialFinalizationService } from './commercial-finalization.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CommercialStatus, DisputeStatus } from '@prisma/client';

describe('CommercialFinalizationService (AD-02 Finalization Processor)', () => {
  let service: CommercialFinalizationService;
  let prisma: any;

  const baseDate = new Date('2026-10-15T12:00:00.000Z');

  const createMockCommercial = (overrides: Record<string, any> = {}) => ({
    id: 'comm-1',
    workspace_id: 'ws-1',
    call_id: 'call-1',
    campaign_id: 'camp-1',
    status: CommercialStatus.PENDING,
    revenue: 50.0,
    payout: 35.0,
    cost: 0.15,
    profit: 14.85,
    currency: 'USD',
    created_at: new Date('2026-10-08T12:00:00.000Z'),
    finalizes_at: new Date('2026-10-15T12:00:00.000Z'), // exactly 168h later
    dispute: null,
    ...overrides,
  });

  beforeEach(async () => {
    vi.useFakeTimers();

    prisma = {
      callCommercial: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommercialFinalizationService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<CommercialFinalizationService>(CommercialFinalizationService);
  });

  afterEach(() => {
    service.onModuleDestroy();
    vi.useRealTimers();
  });

  // 1. Module lifecycle & 10m polling timer
  it('1. Initializes periodic 10-minute timer and clears on destroy', () => {
    service.onModuleInit();
    expect((service as any).timer).toBeDefined();

    service.onModuleDestroy();
    expect((service as any).timer).toBeNull();
  });

  // 2. Matured PENDING record transitions to FINAL
  it('2. Matured PENDING record (finalizes_at <= now) transitions to FINAL', async () => {
    const comm = createMockCommercial();
    prisma.callCommercial.findMany.mockResolvedValueOnce([comm]);
    prisma.callCommercial.updateMany.mockResolvedValueOnce({ count: 1 });

    const result = await service.processFinalizationBatch(baseDate);

    expect(result.finalizedCount).toBe(1);
    expect(result.candidateCount).toBe(1);
    expect(result.blockedByDisputeCount).toBe(0);

    expect(prisma.callCommercial.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['comm-1'] },
        status: CommercialStatus.PENDING,
      },
      data: {
        status: CommercialStatus.FINAL,
      },
    });
  });

  // 3. Early finalization is impossible (query constraint)
  it('3. Unmatured record (finalizes_at > now) is not returned by query', async () => {
    const beforeMaturity = new Date('2026-10-15T11:59:59.000Z');
    prisma.callCommercial.findMany.mockResolvedValueOnce([]);

    const result = await service.processFinalizationBatch(beforeMaturity);

    expect(result.finalizedCount).toBe(0);
    expect(prisma.callCommercial.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: CommercialStatus.PENDING,
          finalizes_at: {
            not: null,
            lte: beforeMaturity,
          },
        }),
      }),
    );
    expect(prisma.callCommercial.updateMany).not.toHaveBeenCalled();
  });

  // 4. Pending dispute blocks finalization
  it('4. Active PENDING dispute blocks finalization', async () => {
    const commWithDispute = createMockCommercial({
      dispute: { id: 'disp-1', status: DisputeStatus.PENDING },
    });
    prisma.callCommercial.findMany.mockResolvedValueOnce([commWithDispute]);

    const result = await service.processFinalizationBatch(baseDate);

    expect(result.finalizedCount).toBe(0);
    expect(result.candidateCount).toBe(1);
    expect(result.blockedByDisputeCount).toBe(1);
    expect(prisma.callCommercial.updateMany).not.toHaveBeenCalled();
  });

  // 5. Resolved / Rejected dispute permits finalization
  it('5. Resolved / Rejected dispute allows matured record to finalize', async () => {
    const commRejectedDispute = createMockCommercial({
      dispute: { id: 'disp-1', status: DisputeStatus.REJECTED },
    });
    prisma.callCommercial.findMany.mockResolvedValueOnce([commRejectedDispute]);
    prisma.callCommercial.updateMany.mockResolvedValueOnce({ count: 1 });

    const result = await service.processFinalizationBatch(baseDate);

    expect(result.finalizedCount).toBe(1);
    expect(result.blockedByDisputeCount).toBe(0);
    expect(prisma.callCommercial.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['comm-1'] },
        status: CommercialStatus.PENDING,
      },
      data: {
        status: CommercialStatus.FINAL,
      },
    });
  });

  // 6. Concurrency safety (status: PENDING guard in updateMany)
  it('6. Concurrent finalization attempt safely becomes a no-op if status already changed', async () => {
    const comm = createMockCommercial();
    prisma.callCommercial.findMany.mockResolvedValueOnce([comm]);
    // updateMany count 0 means another process already flipped status: PENDING -> FINAL
    prisma.callCommercial.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await service.processFinalizationBatch(baseDate);

    expect(result.candidateCount).toBe(1);
    expect(result.finalizedCount).toBe(0);
  });

  // 7. Idempotency: repeated run on empty/already finalized candidates
  it('7. Repeated run on already-finalized records is a safe no-op', async () => {
    prisma.callCommercial.findMany.mockResolvedValueOnce([]);

    const result = await service.processFinalizationBatch(baseDate);

    expect(result.finalizedCount).toBe(0);
    expect(result.candidateCount).toBe(0);
    expect(prisma.callCommercial.updateMany).not.toHaveBeenCalled();
  });

  // 8. Multi-tenant workspace scoping
  it('8. Scopes to workspace_id when provided', async () => {
    prisma.callCommercial.findMany.mockResolvedValueOnce([]);

    await service.processFinalizationBatch(baseDate, 'ws-target');

    expect(prisma.callCommercial.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspace_id: 'ws-target',
        }),
      }),
    );
  });

  // 9. Does not mutate financial snapshot fields
  it('9. Never mutates revenue, payout, cost, or profit', async () => {
    const comm = createMockCommercial();
    prisma.callCommercial.findMany.mockResolvedValueOnce([comm]);
    prisma.callCommercial.updateMany.mockResolvedValueOnce({ count: 1 });

    await service.processFinalizationBatch(baseDate);

    const updateCall = prisma.callCommercial.updateMany.mock.calls[0][0];
    expect(updateCall.data).toEqual({ status: CommercialStatus.FINAL });
    expect(updateCall.data.revenue).toBeUndefined();
    expect(updateCall.data.payout).toBeUndefined();
    expect(updateCall.data.cost).toBeUndefined();
    expect(updateCall.data.profit).toBeUndefined();
  });

  // 10. In-flight overlapping execution lock
  it('10. Prevents concurrent overlap via isProcessing lock', async () => {
    (service as any).isProcessing = true;

    const result = await service.processFinalizationBatch(baseDate);

    expect(result.finalizedCount).toBe(0);
    expect(prisma.callCommercial.findMany).not.toHaveBeenCalled();
  });
});
