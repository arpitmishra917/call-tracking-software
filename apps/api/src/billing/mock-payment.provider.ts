import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PaymentProvider } from './payment-provider.interface.js';
import { randomUUID } from 'crypto';
import { WalletService } from './wallet.service.js';

@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  constructor(private readonly walletService: WalletService) {}

  async createWalletTopUp(workspaceId: string, amountMinor: number, returnUrl: string) {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.WALLET_MOCK_PAYMENTS_ENABLED !== 'true'
    ) {
      throw new ForbiddenException('Mock payments are only allowed in development.');
    }

    if (amountMinor < 2500) {
      throw new BadRequestException('Minimum mock top-up is $25.00 (2500 minor units).');
    }

    const referenceId = randomUUID();
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
      description: 'Mock development payment top-up',
    });

    return {
      url: returnUrl,
      referenceId,
    };
  }

  async verifyPayment(referenceId: string) {
    // In a real provider, this would check Stripe/Cashfree status.
    // Since mock payments execute instantly, we assume success.
    return { success: true, amountMinor: 0 };
  }
}
