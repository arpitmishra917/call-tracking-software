const fs = require('fs');

let s = fs.readFileSync('apps/api/src/telephony/call-controller.ts', 'utf8');

// 1. Add WalletService import
if (!s.includes('import { WalletService }')) {
  s = s.replace(
    /import \{ UsageBillingService \} from '\.\.\/billing\/usage-billing\.service\.js';/,
    "import { UsageBillingService } from '../billing/usage-billing.service.js';\nimport { WalletService } from '../billing/wallet.service.js';"
  );
}

// 2. Add WalletService to constructor
if (!s.includes('private readonly walletService: WalletService')) {
  s = s.replace(
    /private readonly webhooksService: WebhooksService,/,
    "private readonly webhooksService: WebhooksService,\n    private readonly walletService: WalletService,"
  );
}

// 3. Inject Reservation logic into CALL_INITIATED
const reservationLogic = `      call = await this.callsService.createCall({
        workspace_id: trackingNumber.workspace_id,
        campaign_id: trackingNumber.campaign_id || undefined,
        provider: 'provider',
        provider_call_id: callId,
        from_number: from!,
        to_number: to!,
      });

      // --- PHASE 3D RESERVATION ---
      const initialAmountMicro = this.usageBillingService.calculateInitialReservation(trackingNumber.number_type);
      try {
         await this.walletService.reserveForCall(call.workspace_id, call.id, initialAmountMicro);
      } catch (err: any) {
         this.logger.warn(\`Insufficient balance for call \${call.id}. Rejecting: \${err.message}\`);
         await this.prisma.call.update({
             where: { id: call.id },
             data: { state: CallState.FAILED }
         });
         await this.provider.hangupCall(callId);
         return;
      }
      // ----------------------------`;

s = s.replace(
  /call = await this\.callsService\.createCall\(\{[\s\S]*?to_number: to!,\s*\}\);/,
  reservationLogic
);


// 4. Inject Settlement logic into CALL_HANGUP
const settlementLogic = `const updatedCall = await this.callsService.handleCallerHangup(callId);
        
        // --- PHASE 3D SETTLEMENT ---
        const dMs = updatedCall.ended_at && updatedCall.answered_at ? updatedCall.ended_at.getTime() - updatedCall.answered_at.getTime() : 0;
        const talkDurationSecs = Math.max(0, Math.ceil(dMs / 1000));
        
        const trackingNumInfo = await this.prisma.phoneNumber.findFirst({
            where: { phone_number: updatedCall.to_number, workspace_id: updatedCall.workspace_id }
        });
        
        await this.usageBillingService.billCallUsage(
            updatedCall.workspace_id,
            updatedCall.id,
            trackingNumInfo?.number_type,
            talkDurationSecs
        ).catch(err => this.logger.error(\`Failed to settle/release reservation for call \${updatedCall.id}: \${err.message}\`));
        // ---------------------------`;

s = s.replace(
  /const updatedCall = await this\.callsService\.handleCallerHangup\(callId\);/,
  settlementLogic
);

fs.writeFileSync('apps/api/src/telephony/call-controller.ts', s);
