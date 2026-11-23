import { vi, describe, it, expect, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WebhooksController } from '../../src/webhooks/webhooks.controller.js';
import { WebhooksService } from '../../src/webhooks/webhooks.service.js';
import { TelnyxWebhookController } from '../../src/telephony/telnyx/telnyx.webhook.controller.js';
import { CallController } from '../../src/telephony/call-controller.js';
import { WebhookIdempotencyService } from '../../src/telephony/webhook-idempotency.service.js';
import { JwtAuthGuard } from '../../src/auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../../src/authorization/workspace-roles.guard.js';
import { PermissionsGuard } from '../../src/authorization/permissions.guard.js';

describe('Layer 5 Contract Regression: Webhooks Ingress & Outbound API Boundaries', () => {
  let webhooksController: WebhooksController;
  let telnyxController: TelnyxWebhookController;
  let webhooksServiceMock: any;
  let callControllerMock: any;
  let idempotencyMock: any;

  const mockWorkspaceId = 'ws-contract-wh-1';

  beforeEach(async () => {
    webhooksServiceMock = {
      getWebhooks: vi.fn(),
      createWebhook: vi.fn(),
      deleteWebhook: vi.fn(),
    };

    callControllerMock = {
      handleEvent: vi.fn(),
    };

    idempotencyMock = {
      acquireLock: vi.fn(),
      releaseLock: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhooksController, TelnyxWebhookController],
      providers: [
        { provide: WebhooksService, useValue: webhooksServiceMock },
        { provide: CallController, useValue: callControllerMock },
        { provide: WebhookIdempotencyService, useValue: idempotencyMock },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(WorkspaceRolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    webhooksController = module.get<WebhooksController>(WebhooksController);
    telnyxController = module.get<TelnyxWebhookController>(TelnyxWebhookController);
  });

  describe('Outbound Webhooks Management API Contract', () => {
    it('creates webhook conforming to exact response schema', async () => {
      const mockCreatedWebhook = {
        id: 'wh-sub-101',
        workspace_id: mockWorkspaceId,
        url: 'https://client-crm.example.com/webhooks/callflow',
        status: 'ACTIVE',
        created_at: new Date('2026-02-01T12:00:00Z'),
      };

      webhooksServiceMock.createWebhook.mockResolvedValue(mockCreatedWebhook);

      const response = await webhooksController.createWebhook(
        mockWorkspaceId,
        'https://client-crm.example.com/webhooks/callflow',
      );

      expect(response).toHaveProperty('id');
      expect(response).toHaveProperty('workspace_id');
      expect(response).toHaveProperty('url');
      expect(response).toHaveProperty('status');
      expect(response).toHaveProperty('created_at');

      expect(typeof response.id).toBe('string');
      expect(typeof response.workspace_id).toBe('string');
      expect(response.url).toBe('https://client-crm.example.com/webhooks/callflow');
      expect(response.status).toBe('ACTIVE');
    });

    it('lists webhooks returning array of conforming webhook endpoints', async () => {
      webhooksServiceMock.getWebhooks.mockResolvedValue([
        {
          id: 'wh-sub-101',
          workspace_id: mockWorkspaceId,
          url: 'https://client-crm.example.com/webhooks/callflow',
          status: 'ACTIVE',
          created_at: new Date(),
        },
      ]);

      const response = await webhooksController.listWebhooks(mockWorkspaceId);

      expect(Array.isArray(response)).toBe(true);
      expect(response).toHaveLength(1);
      expect(response[0]).toHaveProperty('id');
      expect(response[0]).toHaveProperty('url');
    });

    it('deletes webhook and returns confirmation', async () => {
      webhooksServiceMock.deleteWebhook.mockResolvedValue({ id: 'wh-sub-101' });

      const response = await webhooksController.deleteWebhook(mockWorkspaceId, 'wh-sub-101');
      expect(response).toEqual({ id: 'wh-sub-101' });
      expect(webhooksServiceMock.deleteWebhook).toHaveBeenCalledWith(mockWorkspaceId, 'wh-sub-101');
    });
  });

  describe('Inbound Telephony Webhook Ingress Contract', () => {
    it('rejects ingress payload when signature headers or body are missing (400 Bad Request)', async () => {
      const mockReqMissingHeaders: any = {
        rawBody: Buffer.from(JSON.stringify({ event_type: 'call.initiated' })),
        headers: {}, // missing telnyx-signature-ed25519 and telnyx-timestamp
      };
      const mockRes: any = { status: vi.fn().mockReturnThis(), send: vi.fn() };

      await expect(
        telnyxController.handleWebhook(mockReqMissingHeaders, mockRes),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects ingress payload when rawBody is missing (400 Bad Request)', async () => {
      const mockReqMissingBody: any = {
        rawBody: undefined,
        headers: {
          'telnyx-signature-ed25519': 'fake-sig',
          'telnyx-timestamp': '1234567890',
        },
      };
      const mockRes: any = { status: vi.fn().mockReturnThis(), send: vi.fn() };

      await expect(
        telnyxController.handleWebhook(mockReqMissingBody, mockRes),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
