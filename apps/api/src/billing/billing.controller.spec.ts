import { Test, TestingModule } from '@nestjs/testing';
import { BillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceRolesGuard } from '../authorization/workspace-roles.guard.js';
import { vi, describe, it, expect, beforeEach } from 'vitest';

process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_mock';

describe('BillingController', () => {
  let controller: BillingController;
  let service: BillingService;

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
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(WorkspaceRolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<BillingController>(BillingController);
    service = module.get<BillingService>(BillingService);
  });

  it('should get billing state', async () => {
    const res = await controller.getBillingState({
      params: { workspaceId: 'ws-1' },
    } as any);
    expect(res).toEqual({ status: 'ok' });
    expect(service.getBillingState).toHaveBeenCalledWith('ws-1');
  });

  it('should create checkout session', async () => {
    const res = await controller.createCheckout(
      { params: { workspaceId: 'ws-1' } } as any,
      { planId: 'pl-1', returnUrl: 'url' },
    );
    expect(res).toEqual({ url: 'checkout' });
    expect(service.createCheckoutSession).toHaveBeenCalledWith(
      'ws-1',
      'pl-1',
      'url',
    );
  });

  it('should create portal session', async () => {
    const res = await controller.createPortal(
      { params: { workspaceId: 'ws-1' } } as any,
      { returnUrl: 'url' },
    );
    expect(res).toEqual({ url: 'portal' });
    expect(service.createPortalSession).toHaveBeenCalledWith('ws-1', 'url');
  });

  it('should handle webhook', async () => {
    const res = await controller.handleWebhook(
      { rawBody: Buffer.from('test') } as any,
      'sig',
    );
    expect(res).toEqual({ received: true });
    expect(service.handleWebhook).toHaveBeenCalledWith(
      'sig',
      Buffer.from('test'),
    );
  });

  it('should reject webhook without signature', async () => {
    const res = await controller.handleWebhook(
      { rawBody: Buffer.from('test') } as any,
      '',
    );
    expect(res).toEqual({ received: false });
    expect(service.handleWebhook).not.toHaveBeenCalled();
  });
});
