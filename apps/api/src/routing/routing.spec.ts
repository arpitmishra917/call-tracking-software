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
      providers: [
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
});
