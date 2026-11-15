import { Injectable, BadRequestException } from '@nestjs/common';
import { PaymentProvider } from './payment-provider.interface.js';
import { randomUUID } from 'crypto';
import { WalletService } from './wallet.service.js';
import { assertMockPaymentPermitted } from './payment-safeguards.util.js';

@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  constructor(private readonly walletService: WalletService) {}

  async createWalletTopUp(workspaceId: string, amountMinor: number, returnUrl: string) {
    // Fails closed if production, staging, missing NODE_ENV, or mock not explicitly permitted
    assertMockPaymentPermitted('wallet-mock-topup');

    if (amountMinor < 2500) {
      throw new BadRequestException('Minimum mock top-up is $25.00 (2500 minor units).');
    }

    const referenceId = `mock_${randomUUID()}`;
    const idempotencyKey = randomUUID();

    // Directly credit the wallet as this is a mock implementation
    // External API boundaries remain in cents (amountMinor). Internal is BigInt (amountMicro)
    const amountMicro = BigInt(amountMinor) * 10000n;

    await this.walletService.creditWallet({
      workspaceId,
      amountMicro,
      referenceType: 'MOCK_PAYMENT',
      referenceId,
      idempotencyKey,
      description: 'Mock development payment top-up [TEST_FUNDS]',
    });

    return {
      url: returnUrl,
      referenceId,
    };
  }

  async verifyPayment(referenceId: string) {
    // Fails closed if in production
    assertMockPaymentPermitted('mock-payment-verification');

    // In a real provider, this would check Stripe/Cashfree status.
    // Since mock payments execute instantly in development/test, we assume success.
    return { success: true, amountMinor: 0 };
  }
}
