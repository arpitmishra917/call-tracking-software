import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BuyersService } from './buyers.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { vi, describe, beforeEach, it, expect } from 'vitest';

describe('BuyersService (Step 2 - Buyer Organization Foundation)', () => {
  let service: BuyersService;
  let prisma: any;
  let permissionsService: any;

  beforeEach(async () => {
    prisma = {
      buyer: {
        create: vi.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'buyer-uuid-1',
            created_at: new Date(),
            updated_at: new Date(),
            ...data,
          }),
        ),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        update: vi.fn(),
      },
      destinationNumber: {
        create: vi.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'dn-uuid-1',
            created_at: new Date(),
            updated_at: new Date(),
            ...data,
          }),
        ),
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
        { key: 'buyer:create', scope_type: 'ALL' },
        { key: 'buyer:update', scope_type: 'ALL' },
      ]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BuyersService,
        { provide: PrismaService, useValue: prisma },
        { provide: PermissionsService, useValue: permissionsService },
      ],
    }).compile();

    service = module.get<BuyersService>(BuyersService);
  });

  describe('Buyer Organization Creation', () => {
    it('should create a Buyer Organization with valid name and email', async () => {
      prisma.buyer.findUnique.mockResolvedValue({
        id: 'buyer-uuid-1',
        workspace_id: 'ws-1',
        name: 'Acme Telephony Org',
        email: 'billing@acme.com',
        destination_number: '',
        status: 'ACTIVE',
        destination_numbers: [],
      });

      const result = await service.createBuyer('ws-1', 'Acme Telephony Org', 'billing@acme.com');

      expect(prisma.buyer.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          workspace_id: 'ws-1',
          name: 'Acme Telephony Org',
          email: 'billing@acme.com',
          status: 'ACTIVE',
        }),
      });
      expect(result.name).toBe('Acme Telephony Org');
      expect(result.email).toBe('billing@acme.com');
    });

    it('should reject creation if email is missing or empty', async () => {
      await expect(
        service.createBuyer('ws-1', 'Acme Telephony Org', ''),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.createBuyer('ws-1', 'Acme Telephony Org', undefined as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject creation if email format is invalid', async () => {
      await expect(
        service.createBuyer('ws-1', 'Acme Telephony Org', 'not-an-email'),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.createBuyer('ws-1', 'Acme Telephony Org', 'invalid@domain'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject creation if name is missing or empty', async () => {
      await expect(
        service.createBuyer('ws-1', '', 'billing@acme.com'),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.createBuyer('ws-1', '   ', 'billing@acme.com'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should optionally create a DestinationNumber entity when destinationNumber is provided', async () => {
      prisma.buyer.findUnique.mockResolvedValue({
        id: 'buyer-uuid-1',
        workspace_id: 'ws-1',
        name: 'Acme Telephony Org',
        email: 'billing@acme.com',
        destination_number: '+15551234567',
        status: 'ACTIVE',
        destination_numbers: [
          {
            id: 'dn-uuid-1',
            destination_number: '+15551234567',
            name: 'Acme Telephony Org Primary',
          },
        ],
      });

      const result = await service.createBuyer(
        'ws-1',
        'Acme Telephony Org',
        'billing@acme.com',
        '+15551234567',
        35,
        5,
      );

      expect(prisma.destinationNumber.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          workspace_id: 'ws-1',
          buyer_id: 'buyer-uuid-1',
          destination_number: '+15551234567',
          timeout: 35,
          max_concurrent_calls: 5,
        }),
      });
      expect(result.destination_numbers).toHaveLength(1);
    });
  });

  describe('Workspace Isolation & Retrieval', () => {
    it('should enforce workspace isolation when fetching a buyer', async () => {
      prisma.buyer.findUnique.mockResolvedValue(null);

      await expect(service.getBuyer('ws-1', 'buyer-other-ws')).rejects.toThrow(NotFoundException);
      expect(prisma.buyer.findUnique).toHaveBeenCalledWith({
        where: { id: 'buyer-other-ws', workspace_id: 'ws-1' },
        include: expect.any(Object),
      });
    });

    it('should return existing buyer data and destination numbers', async () => {
      prisma.buyer.findUnique.mockResolvedValue({
        id: 'buyer-1',
        workspace_id: 'ws-1',
        name: 'Existing Buyer',
        email: 'contact@buyer.com',
        destination_number: '+15559876543',
        status: 'ACTIVE',
        destination_numbers: [
          {
            id: 'dn-1',
            destination_number: '+15559876543',
            name: 'Existing Buyer Primary',
          },
        ],
      });

      const buyer = await service.getBuyer('ws-1', 'buyer-1');
      expect(buyer.id).toBe('buyer-1');
      expect(buyer.destination_numbers).toHaveLength(1);
      expect(buyer.destination_numbers[0].destination_number).toBe('+15559876543');
    });
  });
});
