import { PermissionsService } from '../permissions/permissions.service.js';
import { Test, TestingModule } from '@nestjs/testing';
import { CampaignsService } from './campaigns.service.js';
import { BuyersService } from './buyers.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('Routing Services (Stage 12)', () => {
  let campaignsService: CampaignsService;
  let buyersService: BuyersService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      campaign: {
        create: vi.fn().mockResolvedValue({ id: 'c1', name: 'Test Campaign' }),
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: 'c1', name: 'Test Campaign' }),
      },
      buyer: {
        create: vi.fn().mockResolvedValue({
          id: 'b1',
          name: 'Test Buyer',
          destination_number: '+15551234567',
          max_concurrent_calls: 1,
        }),
        findUnique: vi.fn().mockResolvedValue({
          id: 'b1',
          name: 'Test Buyer',
          destination_number: '+15551234567',
        }),
      },
      destinationNumber: {
        create: vi.fn().mockResolvedValue({ id: 'dn1' }),
      },
      campaignBuyer: {
        create: vi.fn().mockResolvedValue({
          id: 'cb1',
          campaign_id: 'c1',
          buyer_id: 'b1',
          priority: 1,
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: PermissionsService,
          useValue: {
            hasResourceScope: async () => true,
            hasPermission: async () => true,
            getPermissionsForUser: async () => [],
          },
        },
        CampaignsService,
        BuyersService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    campaignsService = module.get<CampaignsService>(CampaignsService);
    buyersService = module.get<BuyersService>(BuyersService);
  });

  it('should normalize E.164 and create a buyer with mandatory max_concurrent_calls', async () => {
    prisma.destinationNumber = { create: vi.fn().mockResolvedValue({}) };
    const buyer = await buyersService.createBuyer(
      'ws_1',
      'Buyer A',
      'buyer-a@example.com',
      '555-123-4567',
      30,
      1,
    );
    expect(buyer.destination_number).toBe('+15551234567');
    expect(prisma.buyer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'buyer-a@example.com',
          destination_number: '+15551234567',
          max_concurrent_calls: 1,
        }),
      }),
    );
  });

  it('should reject buyer creation if max_concurrent_calls is missing or invalid', async () => {
    await expect(
      buyersService.createBuyer('ws_1', 'Buyer A', 'buyer-a@example.com', '555-123-4567', 30, undefined as any),
    ).rejects.toThrow(/max_concurrent_calls.*required/i);

    await expect(
      buyersService.createBuyer('ws_1', 'Buyer A', 'buyer-a@example.com', '555-123-4567', 30, 0),
    ).rejects.toThrow(/positive integer/i);

    await expect(
      buyersService.createBuyer('ws_1', 'Buyer A', 'buyer-a@example.com', '555-123-4567', 30, -5),
    ).rejects.toThrow(/positive integer/i);

    await expect(
      buyersService.createBuyer('ws_1', 'Buyer A', 'buyer-a@example.com', '555-123-4567', 30, 1.5),
    ).rejects.toThrow(/positive integer/i);

    await expect(
      buyersService.createBuyer('ws_1', 'Buyer A', 'buyer-a@example.com', '555-123-4567', 30, 1001),
    ).rejects.toThrow(/cannot exceed 1000/i);
  });

  it('should add buyer to campaign with priority', async () => {
    const cb = await campaignsService.addBuyerToCampaign('ws_1', 'c1', 'b1', 1);
    expect(cb.priority).toBe(1);
    expect(prisma.campaignBuyer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          priority: 1,
          campaign_id: 'c1',
          buyer_id: 'b1',
        }),
      }),
    );
  });

  it('should update buyer fields including status and max_concurrent_calls', async () => {
    prisma.buyer.update = vi.fn().mockResolvedValue({
      id: 'b1',
      status: 'INACTIVE',
      max_concurrent_calls: 5,
    });

    await buyersService.updateBuyer('ws_1', 'b1', {
      status: 'INACTIVE',
      name: 'Updated',
      max_concurrent_calls: 5,
    });

    expect(prisma.buyer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'b1' },
        data: {
          name: 'Updated',
          status: 'INACTIVE',
          max_concurrent_calls: 5,
        },
      }),
    );
  });

  it('should update campaign fields including status', async () => {
    prisma.campaign.update = vi.fn().mockResolvedValue({
      id: 'c1',
      status: 'INACTIVE',
    });

    await campaignsService.updateCampaign('ws_1', 'c1', {
      status: 'INACTIVE',
      name: 'Updated Campaign',
    });

    expect(prisma.campaign.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1' },
        data: {
          name: 'Updated Campaign',
          status: 'INACTIVE',
        },
      }),
    );
  });

  it('should reorder buyers safely using a transaction', async () => {
    prisma.$transaction = vi.fn().mockImplementation(async (cb) => {
      // Mock the transaction client
      const tx = {
        campaignBuyer: {
          findMany: vi.fn().mockResolvedValue([
            { id: 'cb1', buyer_id: 'b1', priority: 1 },
            { id: 'cb2', buyer_id: 'b2', priority: 2 },
          ]),
          update: vi.fn().mockResolvedValue({}),
        },
      };
      return cb(tx);
    });

    await campaignsService.reorderBuyersInCampaign('ws_1', 'c1', ['b2', 'b1']);

    expect(prisma.$transaction).toHaveBeenCalled();
  });
});
