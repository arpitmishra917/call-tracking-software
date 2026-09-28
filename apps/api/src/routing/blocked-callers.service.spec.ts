import { Test, TestingModule } from '@nestjs/testing';
import { BlockedCallersService } from './blocked-callers.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BadRequestException } from '@nestjs/common';
import { vi } from 'vitest';

describe('BlockedCallersService', () => {
  let service: BlockedCallersService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      blockedCaller: {
        findMany: vi.fn(),
        upsert: vi.fn(),
        delete: vi.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlockedCallersService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<BlockedCallersService>(BlockedCallersService);
  });

  it('should list blocked callers for a workspace (15. No cross-tenant leakage)', async () => {
    await service.listBlockedCallers('ws_1');
    expect(prisma.blockedCaller.findMany).toHaveBeenCalledWith({
      where: { workspace_id: 'ws_1' },
    });
  });

  it('should normalize E.164 and add a blocked caller (1. Add blocked caller, 3. E.164 normalization)', async () => {
    await service.blockCaller('ws_1', '555-123-4567', 'Spam');
    expect(prisma.blockedCaller.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspace_id_phone_number: {
            workspace_id: 'ws_1',
            phone_number: '+15551234567',
          },
        },
        create: {
          workspace_id: 'ws_1',
          phone_number: '+15551234567',
          reason: 'Spam',
        },
      }),
    );
  });

  it('should throw BadRequestException on invalid phone number', async () => {
    await expect(service.blockCaller('ws_1', 'invalid')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('should update reason on duplicate block (2. Duplicate blocked caller behavior, 10. Update reason/note)', async () => {
    await service.blockCaller('ws_1', '+15551234567', 'Updated Reason');
    expect(prisma.blockedCaller.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {
          reason: 'Updated Reason',
        },
      }),
    );
  });

  it('should unblock caller (11. Remove/unblock)', async () => {
    await service.unblockCaller('ws_1', 'block_1');
    expect(prisma.blockedCaller.delete).toHaveBeenCalledWith({
      where: { id: 'block_1', workspace_id: 'ws_1' },
    });
  });
});
