import { vi, describe, it, expect, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { PhoneNumbersService } from './phone-numbers.service.js';
import { TelnyxProvisioningService } from './telnyx-provisioning.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsageService } from '../usage/usage.service.js';
import { PhoneNumberStatus } from '@prisma/client';

describe('PhoneNumbersService', () => {
  let service: PhoneNumbersService;
  let prismaMock: any;
  let telnyxMock: any;

  let usageMock: any;

  beforeEach(async () => {
    prismaMock = {
      phoneNumber: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        count: vi.fn().mockResolvedValue(1),
      },
    };

    telnyxMock = {
      searchNumbers: vi
        .fn()
        .mockResolvedValue([{ phone_number: '+15550001000' }]),
      provisionNumber: vi.fn().mockResolvedValue({
        id: 'mock_telnyx_id',
        phone_number: '+15550001000',
        connection_id: 'mock_conn_id',
      }),
    };

    usageMock = {
      recordUsage: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PhoneNumbersService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: TelnyxProvisioningService, useValue: telnyxMock },
        { provide: UsageService, useValue: usageMock },
      ],
    }).compile();

    service = module.get<PhoneNumbersService>(PhoneNumbersService);
  });

  it('should list workspace numbers', async () => {
    prismaMock.phoneNumber.findMany.mockResolvedValue([
      { id: 'mock-uuid', phone_number: '+15550001000' },
    ]);
    const result = await service.listWorkspaceNumbers('ws-1', { page: 1, limit: 50 });
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(prismaMock.phoneNumber.findMany).toHaveBeenCalledWith({
      where: { workspace_id: 'ws-1', status: { not: PhoneNumberStatus.RELEASED } },
      include: {
        campaign: {
          select: { id: true, name: true }
        }
      },
      orderBy: { created_at: 'desc' },
      skip: 0,
      take: 50,
    });
  });

  it('should return campaign for assigned number', async () => {
    prismaMock.phoneNumber.findMany.mockResolvedValue([
      { id: 'num-1', phone_number: '+1555', campaign: { id: 'camp-1', name: 'Summer Campaign' } },
    ]);
    const result = await service.listWorkspaceNumbers('ws-1');
    expect(result.items[0].campaign.name).toBe('Summer Campaign');
  });

  it('should return null campaign for unassigned number', async () => {
    prismaMock.phoneNumber.findMany.mockResolvedValue([
      { id: 'num-1', phone_number: '+1555', campaign: null },
    ]);
    const result = await service.listWorkspaceNumbers('ws-1');
    expect(result.items[0].campaign).toBeNull();
  });

  it('should search available numbers', async () => {
    const result = await service.searchAvailableNumbers('US', 2);
    expect(result).toHaveLength(1);
    expect(telnyxMock.searchNumbers).toHaveBeenCalledWith('US', 2, undefined, undefined);
  });

  it('should provision a new number', async () => {
    prismaMock.phoneNumber.findUnique.mockResolvedValue(null);
    prismaMock.phoneNumber.create.mockResolvedValue({
      id: 'new-uuid',
      workspace_id: 'ws-1',
      phone_number: '+15550001000',
      status: PhoneNumberStatus.PROVISIONING,
    });
    prismaMock.phoneNumber.update.mockResolvedValue({
      id: 'new-uuid',
      workspace_id: 'ws-1',
      phone_number: '+15550001000',
      status: PhoneNumberStatus.ACTIVE,
    });

    telnyxMock.placeNumberOrder = vi.fn().mockResolvedValue({
      order_id: 'mock_order_id',
      connection_id: 'mock_conn_id',
    });
    telnyxMock.checkOrderStatus = vi.fn().mockResolvedValue({
      status: 'completed',
      id: 'mock_telnyx_id',
      connection_id: 'mock_conn_id',
      phone_number_type: 'toll_free'
    });

    const result = await service.provisionNumber('ws-1', '+15550001000');
    expect(result.id).toBe('new-uuid');
    expect(result.status).toBe(PhoneNumberStatus.ACTIVE);
    expect(telnyxMock.placeNumberOrder).toHaveBeenCalledWith('+15550001000');
    expect(prismaMock.phoneNumber.create).toHaveBeenCalled();
    expect(prismaMock.phoneNumber.update).toHaveBeenCalledTimes(2);
    expect(prismaMock.phoneNumber.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          number_type: 'toll_free',
        })
      })
    );
  });

  it('should backfill number types', async () => {
    prismaMock.phoneNumber.findMany.mockResolvedValue([
      { id: '1', phone_number: '+123', provider_number_id: 'pn1' } as any,
    ]);
    telnyxMock.checkOrderStatus = vi.fn().mockResolvedValue({ status: 'completed', phone_number_type: 'local' });
    
    const res = await service.backfillNumberTypes(false);
    expect(res.updated).toBe(1);
    expect(prismaMock.phoneNumber.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: '1' },
        data: { number_type: 'local' }
      })
    );
  });

  it('should release a number (soft delete)', async () => {
    prismaMock.phoneNumber.findUnique.mockResolvedValue({
      id: 'new-uuid',
      workspace_id: 'ws-1',
      status: PhoneNumberStatus.ACTIVE,
    });
    prismaMock.phoneNumber.update.mockResolvedValue({
      id: 'new-uuid',
      workspace_id: 'ws-1',
      status: PhoneNumberStatus.RELEASED,
    });

    const result = await service.releaseNumber('ws-1', 'new-uuid');
    expect(result.status).toBe(PhoneNumberStatus.RELEASED);
    expect(prismaMock.phoneNumber.update).toHaveBeenCalledWith({
      where: { id: 'new-uuid' },
      data: { 
        status: PhoneNumberStatus.RELEASED,
        campaign_id: null
      },
    });
  });
  it('should not update DB and throw if provider release fails', async () => {
    prismaMock.phoneNumber.findUnique.mockResolvedValue({
      id: 'new-uuid',
      workspace_id: 'ws-1',
      status: PhoneNumberStatus.ACTIVE,
      provider_number_id: 'provider_123',
    });
    
    telnyxMock.releaseNumber = vi.fn().mockRejectedValue(new Error('Provider error'));
    prismaMock.phoneNumber.update.mockClear();

    await expect(service.releaseNumber('ws-1', 'new-uuid')).rejects.toThrow('Provider error');
    
    expect(telnyxMock.releaseNumber).toHaveBeenCalledWith('provider_123');
    expect(prismaMock.phoneNumber.update).not.toHaveBeenCalled();
  });

  it('should be idempotent and not call provider if already RELEASED', async () => {
    prismaMock.phoneNumber.findUnique.mockResolvedValue({
      id: 'new-uuid',
      workspace_id: 'ws-1',
      status: PhoneNumberStatus.RELEASED,
      provider_number_id: 'provider_123',
    });

    telnyxMock.releaseNumber = vi.fn();
    prismaMock.phoneNumber.update.mockClear();

    const result = await service.releaseNumber('ws-1', 'new-uuid');
    
    expect(result.status).toBe(PhoneNumberStatus.RELEASED);
    expect(telnyxMock.releaseNumber).not.toHaveBeenCalled();
    expect(prismaMock.phoneNumber.update).not.toHaveBeenCalled();
  });
});
