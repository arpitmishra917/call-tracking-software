import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { DestinationNumbersService } from './destination-numbers.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { vi, describe, beforeEach, it, expect } from 'vitest';

describe('DestinationNumbersService (Step 2 - Independent Destination Numbers)', () => {
  let service: DestinationNumbersService;
  let prisma: any;
  let permissionsService: any;

  beforeEach(async () => {
    prisma = {
      buyer: {
        findUnique: vi.fn(),
      },
      destinationNumber: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'dn-uuid-1',
            created_at: new Date(),
            updated_at: new Date(),
            ...data,
          }),
        ),
        update: vi.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'dn-uuid-1',
            updated_at: new Date(),
            ...data,
          }),
        ),
        delete: vi.fn().mockResolvedValue({ id: 'dn-uuid-1' }),
      },
      workspaceMember: {
        findUnique: vi.fn(),
      },
      workspaceMemberBuyer: {
        findMany: vi.fn(),
      },
    };

    permissionsService = {
      getPermissionsForUser: vi.fn().mockResolvedValue([
        { key: 'buyer:read', scope_type: 'ALL' },
        { key: 'buyer:update', scope_type: 'ALL' },
      ]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DestinationNumbersService,
        { provide: PrismaService, useValue: prisma },
        { provide: PermissionsService, useValue: permissionsService },
      ],
    }).compile();

    service = module.get<DestinationNumbersService>(DestinationNumbersService);
  });

  describe('Destination Number Creation', () => {
    it('should create an independent Destination Number attached exclusively to a Buyer', async () => {
      prisma.buyer.findUnique.mockResolvedValue({
        id: 'buyer-1',
        workspace_id: 'ws-1',
        name: 'Prime Buyer',
        email: 'prime@buyer.com',
      });
      prisma.destinationNumber.findUnique.mockResolvedValue(null);

      const result = await service.createDestinationNumber('ws-1', 'buyer-1', {
        destinationNumber: '+15554443322',
        name: 'West Coast Line',
        timeout: 45,
        maxConcurrentCalls: 10,
      });

      expect(prisma.destinationNumber.create).toHaveBeenCalledWith({
        data: {
          workspace_id: 'ws-1',
          buyer_id: 'buyer-1',
          destination_number: '+15554443322',
          name: 'West Coast Line',
          timeout: 45,
          max_concurrent_calls: 10,
          status: 'ACTIVE',
        },
        include: expect.any(Object),
      });
      expect(result.destination_number).toBe('+15554443322');
      expect(result.status).toBe('ACTIVE');
    });

    it('should reject creation if Buyer does not belong to the target workspace (cross-workspace protection)', async () => {
      // Buyer belongs to ws-2, but caller is in ws-1
      prisma.buyer.findUnique.mockResolvedValue({
        id: 'buyer-1',
        workspace_id: 'ws-2',
        name: 'Other WS Buyer',
      });

      await expect(
        service.createDestinationNumber('ws-1', 'buyer-1', {
          destinationNumber: '+15554443322',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject creation if Buyer does not exist', async () => {
      prisma.buyer.findUnique.mockResolvedValue(null);

      await expect(
        service.createDestinationNumber('ws-1', 'buyer-nonexistent', {
          destinationNumber: '+15554443322',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject duplicate destination numbers within the same workspace', async () => {
      prisma.buyer.findUnique.mockResolvedValue({
        id: 'buyer-1',
        workspace_id: 'ws-1',
        name: 'Prime Buyer',
      });
      prisma.destinationNumber.findUnique.mockResolvedValue({
        id: 'dn-existing',
        workspace_id: 'ws-1',
        destination_number: '+15554443322',
      });

      await expect(
        service.createDestinationNumber('ws-1', 'buyer-1', {
          destinationNumber: '+15554443322',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should validate E.164 phone number formatting and normalize', async () => {
      prisma.buyer.findUnique.mockResolvedValue({
        id: 'buyer-1',
        workspace_id: 'ws-1',
        name: 'Prime Buyer',
      });
      prisma.destinationNumber.findUnique.mockResolvedValue(null);

      // Raw formatted number without leading plus (US 10 digit)
      const result = await service.createDestinationNumber('ws-1', 'buyer-1', {
        destinationNumber: '555-444-3322',
      });
      expect(result.destination_number).toBe('+15554443322');

      // Invalid characters or length
      await expect(
        service.createDestinationNumber('ws-1', 'buyer-1', {
          destinationNumber: 'not-a-number',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Update and Status Management', () => {
    it('should update name, timeout, concurrency and status', async () => {
      prisma.destinationNumber.findUnique.mockResolvedValue({
        id: 'dn-1',
        workspace_id: 'ws-1',
        buyer_id: 'buyer-1',
        destination_number: '+15551234567',
        status: 'ACTIVE',
      });

      const updated = await service.updateDestinationNumber('ws-1', 'dn-1', {
        name: 'Updated Line Label',
        timeout: 60,
        maxConcurrentCalls: 5,
        status: 'INACTIVE',
      });

      expect(prisma.destinationNumber.update).toHaveBeenCalledWith({
        where: { id: 'dn-1' },
        data: {
          name: 'Updated Line Label',
          timeout: 60,
          max_concurrent_calls: 5,
          status: 'INACTIVE',
        },
        include: expect.any(Object),
      });
    });

    it('should toggle status to INACTIVE via archive and ACTIVE via activate', async () => {
      prisma.destinationNumber.findUnique.mockResolvedValue({
        id: 'dn-1',
        workspace_id: 'ws-1',
        buyer_id: 'buyer-1',
        status: 'ACTIVE',
      });

      await service.setStatus('ws-1', 'dn-1', 'INACTIVE');
      expect(prisma.destinationNumber.update).toHaveBeenCalledWith({
        where: { id: 'dn-1' },
        data: { status: 'INACTIVE' },
        include: expect.any(Object),
      });

      await service.setStatus('ws-1', 'dn-1', 'ACTIVE');
      expect(prisma.destinationNumber.update).toHaveBeenCalledWith({
        where: { id: 'dn-1' },
        data: { status: 'ACTIVE' },
        include: expect.any(Object),
      });
    });

    it('should reject invalid status strings', async () => {
      prisma.destinationNumber.findUnique.mockResolvedValue({
        id: 'dn-1',
        workspace_id: 'ws-1',
        buyer_id: 'buyer-1',
      });

      await expect(
        service.updateDestinationNumber('ws-1', 'dn-1', { status: 'INVALID_STATUS' }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
