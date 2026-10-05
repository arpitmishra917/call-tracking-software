import { PermissionsService } from '../permissions/permissions.service.js';
import { Test, TestingModule } from '@nestjs/testing';
import { CampaignsService } from './campaigns.service.js';
import { BuyersService } from './buyers.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { vi } from 'vitest';

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
        }),
        findUnique: vi.fn().mockResolvedValue({ id: 'b1', name: 'Test Buyer' }),
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
      providers: [{ provide: PermissionsService, useValue: { hasResourceScope: async () => true, hasPermission: async () => true, getPermissionsForUser: async () => [] } }, 
        CampaignsService,
        BuyersService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    campaignsService = module.get<CampaignsService>(CampaignsService);
    buyersService = module.get<BuyersService>(BuyersService);
  });

  it('should normalize E.164 and create a buyer', async () => {
    const buyer = await buyersService.createBuyer(
      'ws_1',
      'Buyer A',
      '555-123-4567',
    );
    expect(buyer.destination_number).toBe('+15551234567');
    expect(prisma.buyer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ destination_number: '+15551234567' }),
      }),
    );
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

  it('should update buyer fields including status', async () => {
    prisma.buyer.update = vi.fn().mockResolvedValue({
      id: 'b1',
      status: 'INACTIVE',
    });
    
    await buyersService.updateBuyer('ws_1', 'b1', { status: 'INACTIVE', name: 'Updated' });
    
    expect(prisma.buyer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'b1' },
        data: {
          name: 'Updated',
          status: 'INACTIVE',
        },
      })
    );
  });

  it('should update campaign fields including status', async () => {
    prisma.campaign.update = vi.fn().mockResolvedValue({
      id: 'c1',
      status: 'INACTIVE',
    });
    
    await campaignsService.updateCampaign('ws_1', 'c1', { status: 'INACTIVE', name: 'Updated Campaign' });
    
    expect(prisma.campaign.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1' },
        data: {
          name: 'Updated Campaign',
          status: 'INACTIVE',
        },
      })
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
        }
      };
      return cb(tx);
    });

    await campaignsService.reorderBuyersInCampaign('ws_1', 'c1', ['b2', 'b1']);
    
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});
