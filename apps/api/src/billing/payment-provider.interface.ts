export interface PaymentProvider {
  createWalletTopUp(
    workspaceId: string,
    amountMinor: number,
    returnUrl: string,
  ): Promise<{ url: string; referenceId: string }>;
  verifyPayment(
    referenceId: string,
  ): Promise<{ success: boolean; amountMinor: number }>;
}
