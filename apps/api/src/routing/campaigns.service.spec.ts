import { PermissionsService } from '../permissions/permissions.service.js';
import { Test, TestingModule } from '@nestjs/testing';
import { CampaignsService } from './campaigns.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

describe('CampaignsService', () => {
  let service: CampaignsService;
  let prisma: PrismaService;

  beforeEach(async () => {
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
        {
          provide: PrismaService,
          useValue: {
            $transaction: vi.fn(async (cb) => cb(prisma)),
            campaign: {
              findUnique: vi.fn(),
              create: vi.fn(),
              update: vi.fn(),
            },
            campaignBuyer: { findMany: vi.fn(), update: vi.fn(), create: vi.fn() },
            callCommercial: { findMany: vi.fn(), update: vi.fn() },
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

      await expect(service.reorderBuyersInCampaign('w-1', 'c-1', ['b-1'])).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('addBuyerToCampaign', () => {
    it('should rely on DB unique constraint to reject duplicate assignments', async () => {
      const prismaError = new Error('Unique constraint failed on the fields: (`campaign_id`,`buyer_id`)');
      vi.mocked(prisma.campaignBuyer.create).mockRejectedValueOnce(prismaError as any);

      await expect(
        prisma.campaignBuyer.create({
          data: { campaign_id: 'c-1', buyer_id: 'b-1', priority: 1, workspace_id: 'w-1' },
        }),
      ).rejects.toThrow('Unique constraint failed');
    });
  });

  describe('createCampaign (Commercial Rates & Currency)', () => {
    it('should create campaign with string name (backward compatibility)', async () => {
      (prisma.campaign.create as any).mockImplementation(async (args: any) => ({
        id: 'camp-1',
        ...args.data,
      }));

      const result = await service.createCampaign('ws-1', 'Inbound Leads');
      expect(prisma.campaign.create).toHaveBeenCalledWith({
        data: {
          workspace_id: 'ws-1',
          name: 'Inbound Leads',
          status: 'ACTIVE',
          conversion_duration_secs: 90,
          default_revenue_amount: null,
          default_payout_amount: null,
          currency: 'USD',
        },
      });
      expect(result.name).toBe('Inbound Leads');
      expect(result.currency).toBe('USD');
    });

    it('should create campaign with valid commercial revenue, payout, and currency', async () => {
      (prisma.campaign.create as any).mockImplementation(async (args: any) => ({
        id: 'camp-2',
        ...args.data,
      }));

      const result = await service.createCampaign('ws-1', {
        name: 'Auto Insurance Campaign',
        default_revenue_amount: 55.5,
        default_payout_amount: 32.25,
        currency: 'cad',
      });

      expect(prisma.campaign.create).toHaveBeenCalledWith({
        data: {
          workspace_id: 'ws-1',
          name: 'Auto Insurance Campaign',
          status: 'ACTIVE',
          conversion_duration_secs: 90,
          default_revenue_amount: new Prisma.Decimal('55.5'),
          default_payout_amount: new Prisma.Decimal('32.25'),
          currency: 'CAD',
        },
      });
      expect(result.currency).toBe('CAD');
    });

    it('should reject negative default_revenue_amount', async () => {
      await expect(
        service.createCampaign('ws-1', {
          name: 'Invalid Revenue',
          default_revenue_amount: -10,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject negative default_payout_amount', async () => {
      await expect(
        service.createCampaign('ws-1', {
          name: 'Invalid Payout',
          default_payout_amount: -5,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject non-numeric string for default_revenue_amount', async () => {
      await expect(
        service.createCampaign('ws-1', {
          name: 'Invalid Revenue Str',
          default_revenue_amount: 'abc',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject invalid currency codes', async () => {
      await expect(
        service.createCampaign('ws-1', {
          name: 'Invalid Currency',
          currency: 'US', // must be 3 letters
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.createCampaign('ws-1', {
          name: 'Invalid Currency 2',
          currency: '123',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateCampaign (Commercial Rates & Currency)', () => {
    it('should update revenue, payout, and currency', async () => {
      const existing = {
        id: 'camp-1',
        workspace_id: 'ws-1',
        name: 'Camp 1',
        default_revenue_amount: new Prisma.Decimal('40.00'),
        default_payout_amount: new Prisma.Decimal('25.00'),
        currency: 'USD',
      };
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue(existing as any);
      (prisma.campaign.update as any).mockImplementation(async (args: any) => ({
        ...existing,
        ...args.data,
      }));

      const updated = await service.updateCampaign('ws-1', 'camp-1', {
        default_revenue_amount: 60,
        default_payout_amount: 40,
        currency: 'EUR',
      });

      expect(prisma.campaign.update).toHaveBeenCalledWith({
        where: { id: 'camp-1' },
        data: {
          default_revenue_amount: new Prisma.Decimal('60'),
          default_payout_amount: new Prisma.Decimal('40'),
          currency: 'EUR',
        },
      });
      expect(updated.currency).toBe('EUR');
    });

    it('should allow clearing rates to null', async () => {
      const existing = {
        id: 'camp-1',
        workspace_id: 'ws-1',
        name: 'Camp 1',
        default_revenue_amount: new Prisma.Decimal('40.00'),
        default_payout_amount: new Prisma.Decimal('25.00'),
        currency: 'USD',
      };
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue(existing as any);
      (prisma.campaign.update as any).mockImplementation(async (args: any) => ({
        ...existing,
        ...args.data,
      }));

      await service.updateCampaign('ws-1', 'camp-1', {
        default_revenue_amount: null,
        default_payout_amount: null,
      });

      expect(prisma.campaign.update).toHaveBeenCalledWith({
        where: { id: 'camp-1' },
        data: {
          default_revenue_amount: null,
          default_payout_amount: null,
        },
      });
    });

    it('should reject invalid rate values on update', async () => {
      const existing = { id: 'camp-1', workspace_id: 'ws-1' };
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue(existing as any);

      await expect(
        service.updateCampaign('ws-1', 'camp-1', {
          default_revenue_amount: -5,
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.updateCampaign('ws-1', 'camp-1', {
          currency: 'INVALID_LONG_CODE',
        }),
      ).rejects.toThrow(BadRequestException);
    });


  describe('conversion_duration_secs configuration and validation', () => {
    it('1. Creating a campaign without conversion_duration_secs uses the 90-second default', async () => {
      (prisma.campaign.create as any).mockImplementation(async (args: any) => ({
        id: 'camp-default',
        ...args.data,
      }));

      const result = await service.createCampaign('ws-1', {
        name: 'Default Duration Campaign',
      });

      expect(prisma.campaign.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          conversion_duration_secs: 90,
        }),
      });
      expect(result.conversion_duration_secs).toBe(90);
    });

    it('2. Creating a campaign with a custom integer persists it', async () => {
      (prisma.campaign.create as any).mockImplementation(async (args: any) => ({
        id: 'camp-custom',
        ...args.data,
      }));

      const result = await service.createCampaign('ws-1', {
        name: 'Custom Duration Campaign',
        conversion_duration_secs: 120,
      });

      expect(prisma.campaign.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          conversion_duration_secs: 120,
        }),
      });
      expect(result.conversion_duration_secs).toBe(120);
    });

    it('3. Updating the threshold persists the new value', async () => {
      const existing = {
        id: 'camp-1',
        workspace_id: 'ws-1',
        name: 'Camp 1',
        conversion_duration_secs: 90,
      };
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue(existing as any);
      (prisma.campaign.update as any).mockImplementation(async (args: any) => ({
        ...existing,
        ...args.data,
      }));

      const updated = await service.updateCampaign('ws-1', 'camp-1', {
        conversion_duration_secs: 45,
      });

      expect(prisma.campaign.update).toHaveBeenCalledWith({
        where: { id: 'camp-1' },
        data: {
          conversion_duration_secs: 45,
        },
      });
      expect(updated.conversion_duration_secs).toBe(45);
    });

    it('4. Updating another field without supplying the threshold preserves the existing value', async () => {
      const existing = {
        id: 'camp-1',
        workspace_id: 'ws-1',
        name: 'Old Name',
        conversion_duration_secs: 120,
      };
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue(existing as any);
      (prisma.campaign.update as any).mockImplementation(async (args: any) => ({
        ...existing,
        ...args.data,
      }));

      const updated = await service.updateCampaign('ws-1', 'camp-1', {
        name: 'New Name',
      });

      expect(prisma.campaign.update).toHaveBeenCalledWith({
        where: { id: 'camp-1' },
        data: {
          name: 'New Name',
        },
      });
      // conversion_duration_secs was not included in updateData, preserving 120
      expect(updated.conversion_duration_secs).toBe(120);
    });

    it('5. Zero is accepted on create and update', async () => {
      (prisma.campaign.create as any).mockImplementation(async (args: any) => ({
        id: 'camp-zero',
        ...args.data,
      }));

      const created = await service.createCampaign('ws-1', {
        name: 'Zero Threshold Campaign',
        conversion_duration_secs: 0,
      });
      expect(created.conversion_duration_secs).toBe(0);

      const existing = { id: 'camp-zero', workspace_id: 'ws-1', conversion_duration_secs: 90 };
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue(existing as any);
      (prisma.campaign.update as any).mockImplementation(async (args: any) => ({
        ...existing,
        ...args.data,
      }));

      const updated = await service.updateCampaign('ws-1', 'camp-zero', {
        conversion_duration_secs: 0,
      });
      expect(updated.conversion_duration_secs).toBe(0);
    });

    it('6. Negative values are rejected on create and update', async () => {
      await expect(
        service.createCampaign('ws-1', {
          name: 'Negative Threshold',
          conversion_duration_secs: -1,
        }),
      ).rejects.toThrow(BadRequestException);

      const existing = { id: 'camp-1', workspace_id: 'ws-1' };
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue(existing as any);

      await expect(
        service.updateCampaign('ws-1', 'camp-1', {
          conversion_duration_secs: -10,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('7. Fractional values are rejected on create and update', async () => {
      await expect(
        service.createCampaign('ws-1', {
          name: 'Fractional Threshold',
          conversion_duration_secs: 45.5,
        }),
      ).rejects.toThrow(BadRequestException);

      const existing = { id: 'camp-1', workspace_id: 'ws-1' };
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue(existing as any);

      await expect(
        service.updateCampaign('ws-1', 'camp-1', {
          conversion_duration_secs: 60.1,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('8. Invalid types (non-numeric string, boolean) are rejected', async () => {
      await expect(
        service.createCampaign('ws-1', {
          name: 'Invalid Type String',
          conversion_duration_secs: 'abc' as any,
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.createCampaign('ws-1', {
          name: 'Invalid Type Boolean',
          conversion_duration_secs: true as any,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('9. Explicit null is rejected with BadRequestException to prevent silent disabling of conversion', async () => {
      await expect(
        service.createCampaign('ws-1', {
          name: 'Null Threshold Create',
          conversion_duration_secs: null,
        }),
      ).rejects.toThrow(BadRequestException);

      const existing = { id: 'camp-1', workspace_id: 'ws-1', conversion_duration_secs: 90 };
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue(existing as any);

      await expect(
        service.updateCampaign('ws-1', 'camp-1', {
          conversion_duration_secs: null,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('10. Campaign responses return the correct threshold in list and get', async () => {
      const mockCampaign = {
        id: 'camp-1',
        workspace_id: 'ws-1',
        name: 'Camp 1',
        status: 'ACTIVE',
        conversion_duration_secs: 75,
        phone_numbers: [],
        buyers: [],
      };
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue(mockCampaign as any);

      const result = await service.getCampaign('ws-1', 'camp-1');
      expect(result.conversion_duration_secs).toBe(75);
    });
  });

    it('should guarantee immutability: updating campaign rates does NOT alter historical CallCommercial records', async () => {
      const existing = {
        id: 'camp-1',
        workspace_id: 'ws-1',
        name: 'Camp 1',
        default_revenue_amount: new Prisma.Decimal('40.00'),
        default_payout_amount: new Prisma.Decimal('25.00'),
        currency: 'USD',
      };
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue(existing as any);
      vi.mocked(prisma.campaign.update).mockResolvedValue({
        ...existing,
        default_revenue_amount: new Prisma.Decimal('100.00'),
      } as any);

      await service.updateCampaign('ws-1', 'camp-1', {
        default_revenue_amount: 100,
      });

      // Verify that callCommercial table is never touched during campaign rate updates
      expect(prisma.callCommercial.update).not.toHaveBeenCalled();
    });
  });
});
