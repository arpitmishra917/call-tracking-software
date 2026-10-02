import { Test, TestingModule } from '@nestjs/testing';
import { BillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';
import { WalletService } from './wallet.service.js';
import { MockPaymentProvider } from './mock-payment.provider.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('BillingController', () => {
  let controller: BillingController;
  let billingService: BillingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BillingController],
      providers: [
        {
          provide: BillingService,
          useValue: {
            getBillingState: vi.fn().mockResolvedValue({ status: 'ok' }),
            createCheckoutSession: vi
              .fn()
              .mockResolvedValue({ url: 'checkout' }),
            createPortalSession: vi.fn().mockResolvedValue({ url: 'portal' }),
            handleWebhook: vi.fn(),
          },
        },
        { provide: WalletService, useValue: {} },
        { provide: MockPaymentProvider, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(WorkspaceRolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<BillingController>(BillingController);
    billingService = module.get<BillingService>(BillingService);
  });

  it('should get billing state', async () => {
    const req = { params: { workspaceId: 'ws-1' } };
    await controller.getBillingState(req);
    expect(billingService.getBillingState).toHaveBeenCalledWith('ws-1');
  });

  it('should create checkout session', async () => {
    const req = { params: { workspaceId: 'ws-1' } };
    const body = { planId: 'p-1', returnUrl: 'url' };
    const res = await controller.createCheckout(req, body);
    expect(res).toEqual({ url: 'checkout' });
    expect(billingService.createCheckoutSession).toHaveBeenCalledWith(
      'ws-1',
      'p-1',
      'url',
    );
  });

  it('should create portal session', async () => {
    const req = { params: { workspaceId: 'ws-1' } };
    const body = { returnUrl: 'url' };
    const res = await controller.createPortal(req, body);
    expect(res).toEqual({ url: 'portal' });
    expect(billingService.createPortalSession).toHaveBeenCalledWith(
      'ws-1',
      'url',
    );
  });

  it('should handle webhook', async () => {
    const req = { rawBody: Buffer.from('test') };
    const res = await controller.handleWebhook(req, 'sig');
    expect(res).toEqual({ received: true });
    expect(billingService.handleWebhook).toHaveBeenCalledWith(
      'sig',
      req.rawBody,
    );
  });

  it('should reject webhook without signature', async () => {
    const req = { rawBody: Buffer.from('test') };
    const res = await controller.handleWebhook(req, '');
    expect(res).toEqual({ received: false });
  });
});
