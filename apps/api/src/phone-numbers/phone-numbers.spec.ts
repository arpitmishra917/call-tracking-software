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
    const result = await service.listWorkspaceNumbers('ws-1');
    expect(result).toHaveLength(1);
    expect(prismaMock.phoneNumber.findMany).toHaveBeenCalledWith({
      where: { workspace_id: 'ws-1' },
      orderBy: { created_at: 'desc' },
    });
  });

  it('should search available numbers', async () => {
    const result = await service.searchAvailableNumbers('US', 2);
    expect(result).toHaveLength(1);
    expect(telnyxMock.searchNumbers).toHaveBeenCalledWith('US', 2);
  });

  it('should provision a new number', async () => {
    prismaMock.phoneNumber.findUnique.mockResolvedValue(null);
    prismaMock.phoneNumber.create.mockResolvedValue({
      id: 'new-uuid',
      workspace_id: 'ws-1',
      phone_number: '+15550001000',
      status: PhoneNumberStatus.ACTIVE,
    });

    const result = await service.provisionNumber('ws-1', '+15550001000');
    expect(result.id).toBe('new-uuid');
    expect(result.status).toBe(PhoneNumberStatus.ACTIVE);
    expect(telnyxMock.provisionNumber).toHaveBeenCalledWith('+15550001000');
    expect(prismaMock.phoneNumber.create).toHaveBeenCalled();
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
      data: { status: PhoneNumberStatus.RELEASED },
    });
  });
});
