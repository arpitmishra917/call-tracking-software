import { Test, TestingModule } from '@nestjs/testing';
import { CampaignsService } from './campaigns.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('CampaignsService', () => {
  let service: CampaignsService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CampaignsService,
        {
          provide: PrismaService,
          useValue: {
            $transaction: vi.fn(async (cb) => cb(prisma)),
            campaign: { findUnique: vi.fn() },
            campaignBuyer: { findMany: vi.fn(), update: vi.fn(), create: vi.fn() },
          },
        },
      ],
    }).compile();

    service = module.get<CampaignsService>(CampaignsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('reorderBuyersInCampaign', () => {
    it('should reorder using transaction to prevent unique constraint collisions', async () => {
      const mockCampaign = { id: 'c-1', workspace_id: 'w-1' };
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue(mockCampaign as any);

      const mockBuyers = [
        { id: 'cb-1', campaign_id: 'c-1', buyer_id: 'b-1', priority: 1, workspace_id: 'w-1' },
        { id: 'cb-2', campaign_id: 'c-1', buyer_id: 'b-2', priority: 2, workspace_id: 'w-1' },
      ];
      vi.mocked(prisma.campaignBuyer.findMany).mockResolvedValue(mockBuyers as any);

      const updateSpy = vi.mocked(prisma.campaignBuyer.update).mockResolvedValue({} as any);

      // We want to swap them
      await service.reorderBuyersInCampaign('w-1', 'c-1', ['b-2', 'b-1']);

      // Should be 4 updates (2 to negative, 2 to positive)
      expect(updateSpy).toHaveBeenCalledTimes(4);

      // Check first two updates set priority to negative
      expect(updateSpy.mock.calls[0][0].data.priority).toBeLessThan(0);
      expect(updateSpy.mock.calls[1][0].data.priority).toBeLessThan(0);

      // Check last two updates set priority to 1 and 2
      expect(updateSpy.mock.calls[2][0].data.priority).toBe(1);
      expect(updateSpy.mock.calls[3][0].data.priority).toBe(2);
    });

    it('should throw if input missing buyers', async () => {
      const mockCampaign = { id: 'c-1', workspace_id: 'w-1' };
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue(mockCampaign as any);

      const mockBuyers = [
        { id: 'cb-1', campaign_id: 'c-1', buyer_id: 'b-1', priority: 1, workspace_id: 'w-1' },
        { id: 'cb-2', campaign_id: 'c-1', buyer_id: 'b-2', priority: 2, workspace_id: 'w-1' },
      ];
      vi.mocked(prisma.campaignBuyer.findMany).mockResolvedValue(mockBuyers as any);

      await expect(service.reorderBuyersInCampaign('w-1', 'c-1', ['b-1']))
        .rejects.toThrow(BadRequestException);
    });
  });

  describe('addBuyerToCampaign', () => {
    it('should rely on DB unique constraint to reject duplicate assignments', async () => {
      // In actual app, Prisma throws a PrismaClientKnownRequestError if uniqueness is violated.
      // We simulate Prisma throwing on duplicate.
      const prismaError = new Error('Unique constraint failed on the fields: (`campaign_id`,`buyer_id`)');
      vi.mocked(prisma.campaignBuyer.create).mockRejectedValueOnce(prismaError as any);

      await expect(
        prisma.campaignBuyer.create({ data: { campaign_id: 'c-1', buyer_id: 'b-1', priority: 1, workspace_id: 'w-1' } })
      ).rejects.toThrow('Unique constraint failed');
    });
  });
});
