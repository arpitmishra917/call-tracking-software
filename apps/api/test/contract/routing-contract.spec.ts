import { vi, describe, it, expect, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CampaignsController } from '../../src/routing/campaigns.controller.js';
import { BuyersController } from '../../src/routing/buyers.controller.js';
import { CampaignsService } from '../../src/routing/campaigns.service.js';
import { BuyersService } from '../../src/routing/buyers.service.js';
import { JwtAuthGuard } from '../../src/auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../../src/authorization/workspace-roles.guard.js';
import { PermissionsGuard } from '../../src/authorization/permissions.guard.js';
import { PermissionsService } from '../../src/permissions/permissions.service.js';

describe('Layer 5 Contract Regression: Routing (Campaigns & Buyers) Boundaries', () => {
  let campaignsController: CampaignsController;
  let buyersController: BuyersController;
  let campaignsServiceMock: any;
  let buyersServiceMock: any;

  const mockWorkspaceId = 'ws-contract-routing-1';
  const mockUserId = 'usr-contract-routing-1';

  beforeEach(async () => {
    campaignsServiceMock = {
      listCampaigns: vi.fn(),
      getCampaign: vi.fn(),
      createCampaign: vi.fn(),
      updateCampaign: vi.fn(),
      addDestinationToCampaign: vi.fn(),
      removeDestinationFromCampaign: vi.fn(),
      reorderDestinationsInCampaign: vi.fn(),
      addBuyerToCampaign: vi.fn(),
      removeBuyerFromCampaign: vi.fn(),
      reorderBuyersInCampaign: vi.fn(),
      assignPhoneNumber: vi.fn(),
      removePhoneNumber: vi.fn(),
    };

    buyersServiceMock = {
      listBuyers: vi.fn(),
      getBuyer: vi.fn(),
      createBuyer: vi.fn(),
      updateBuyer: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CampaignsController, BuyersController],
      providers: [
        { provide: CampaignsService, useValue: campaignsServiceMock },
        { provide: BuyersService, useValue: buyersServiceMock },
        {
          provide: PermissionsService,
          useValue: {
            getPermissionsForUser: vi.fn().mockResolvedValue([{ key: 'campaign:read', scope_type: 'ALL' }]),
            hasPermission: vi.fn().mockResolvedValue(true),
            hasResourceScope: vi.fn().mockResolvedValue(true),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(WorkspaceRolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    campaignsController = module.get<CampaignsController>(CampaignsController);
    buyersController = module.get<BuyersController>(BuyersController);
  });

  describe('Campaigns API Contract Boundaries', () => {
    it('creates campaign conforming to exact request and response contract', async () => {
      const createDto = {
        name: 'Auto Insurance Inbound',
        currency: 'USD',
        default_revenue_amount: 55.0,
        default_payout_amount: 35.0,
        conversion_duration_secs: 60,
        duplicate_window_secs: 86400,
      };

      const mockCreatedCampaign = {
        id: 'camp-created-1',
        workspace_id: mockWorkspaceId,
        name: 'Auto Insurance Inbound',
        status: 'ACTIVE',
        currency: 'USD',
        default_revenue_amount: 55.0,
        default_payout_amount: 35.0,
        conversion_duration_secs: 60,
        duplicate_window_secs: 86400,
        created_at: new Date(),
        updated_at: new Date(),
        destination_numbers: [],
        buyers: [],
      };

      campaignsServiceMock.createCampaign.mockResolvedValue(mockCreatedCampaign);

      const response = await campaignsController.create(mockWorkspaceId, createDto as any);

      // Verify Response Contract & Breaking Field Checks
      expect(response).toHaveProperty('id');
      expect(response).toHaveProperty('workspace_id');
      expect(response).toHaveProperty('name');
      expect(response).toHaveProperty('status');
      expect(response).toHaveProperty('currency');
      expect(response).toHaveProperty('default_revenue_amount');
      expect(response).toHaveProperty('default_payout_amount');
      expect(response).toHaveProperty('conversion_duration_secs');
      expect(response).toHaveProperty('created_at');

      // Verify Types
      expect(typeof response.id).toBe('string');
      expect(typeof response.workspace_id).toBe('string');
      expect(typeof response.name).toBe('string');
      expect(typeof response.currency).toBe('string');
      expect(typeof response.default_revenue_amount).toBe('number');
      expect(typeof response.default_payout_amount).toBe('number');
    });

    it('returns paginated list conforming to { items, total } contract', async () => {
      campaignsServiceMock.listCampaigns.mockResolvedValue({
        items: [
          {
            id: 'camp-1',
            workspace_id: mockWorkspaceId,
            name: 'Campaign 1',
            status: 'ACTIVE',
          },
        ],
        total: 1,
      });

      const response = await campaignsController.list(
        mockWorkspaceId,
        { user: { userId: mockUserId } },
        { limit: 10, offset: 0 } as any,
      );

      expect(response).toHaveProperty('items');
      expect(response).toHaveProperty('total');
      expect(Array.isArray(response.items)).toBe(true);
      expect(typeof response.total).toBe('number');
      expect(response.items[0]).toHaveProperty('id');
      expect(response.items[0]).toHaveProperty('workspace_id');
    });

    it('addDestination enforces priority and weight in request contract', async () => {
      const destinationDto = {
        destinationNumberId: 'dn-101',
        priority: 1,
        weight: 100,
      };

      const mockCdnResponse = {
        id: 'cdn-101',
        campaign_id: 'camp-101',
        destination_number_id: 'dn-101',
        priority: 1,
        weight: 100,
        status: 'ACTIVE',
      };

      campaignsServiceMock.addDestinationToCampaign.mockResolvedValue(mockCdnResponse);

      const response = await campaignsController.addDestination(
        mockWorkspaceId,
        'camp-101',
        destinationDto as any,
      );

      expect(response).toHaveProperty('id');
      expect(response).toHaveProperty('campaign_id');
      expect(response).toHaveProperty('destination_number_id');
      expect(response).toHaveProperty('priority');
      expect(response).toHaveProperty('weight');
      expect(response.priority).toBe(1);
      expect(response.weight).toBe(100);
      expect(campaignsServiceMock.addDestinationToCampaign).toHaveBeenCalledWith(
        mockWorkspaceId,
        'camp-101',
        'dn-101',
        1,
        100,
      );
    });
  });

  describe('Buyers API Contract Boundaries', () => {
    it('creates buyer conforming to exact contract schema', async () => {
      const createBuyerDto = {
        name: 'Premier Solar Buyer',
        email: 'buyer@premiersolar.com',
        destinationNumber: '+15554443333',
        timeout: 25,
        max_concurrent_calls: 5,
      };

      const mockCreatedBuyer = {
        id: 'buyer-created-1',
        workspace_id: mockWorkspaceId,
        name: 'Premier Solar Buyer',
        email: 'buyer@premiersolar.com',
        destination_number: '+15554443333',
        timeout: 25,
        max_concurrent_calls: 5,
        status: 'ACTIVE',
        created_at: new Date(),
      };

      buyersServiceMock.createBuyer.mockResolvedValue(mockCreatedBuyer);

      const response = await buyersController.create(mockWorkspaceId, createBuyerDto as any);

      expect(response).toHaveProperty('id');
      expect(response).toHaveProperty('workspace_id');
      expect(response).toHaveProperty('name');
      expect(response).toHaveProperty('status');
      expect(response).toHaveProperty('max_concurrent_calls');
      expect(response.max_concurrent_calls).toBe(5);
      expect(response.name).toBe('Premier Solar Buyer');
    });

    it('list buyers returns { items, total } conforming to contract schema', async () => {
      buyersServiceMock.listBuyers.mockResolvedValue({
        items: [
          {
            id: 'buyer-1',
            workspace_id: mockWorkspaceId,
            name: 'Buyer 1',
            status: 'ACTIVE',
            max_concurrent_calls: 10,
          },
        ],
        total: 1,
      });

      const response = await buyersController.list(
        mockWorkspaceId,
        { user: { userId: mockUserId } },
        { limit: 20, offset: 0 } as any,
      );

      expect(response).toHaveProperty('items');
      expect(response).toHaveProperty('total');
      expect(Array.isArray(response.items)).toBe(true);
      expect(typeof response.total).toBe('number');
    });

    it('propagates NotFoundException (404) when buyer is not found', async () => {
      buyersServiceMock.getBuyer.mockRejectedValue(new NotFoundException('Buyer not found'));

      await expect(
        buyersController.get(mockWorkspaceId, 'missing-buyer-id'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
