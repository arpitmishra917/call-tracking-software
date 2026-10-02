const fs = require('fs');
let s = fs.readFileSync('apps/api/src/billing/usage-billing.service.ts', 'utf8');

const replacement = `async billCallUsage(
    workspaceId: string, 
    callId: string, 
    numberType: string | null | undefined, 
    talkDurationSeconds: number
  ) {
    if (talkDurationSeconds <= 0) {
      try {
        await this.walletService.releaseReservation(workspaceId, callId);
        return { billed: false, reason: 'Zero talk duration, reservation released' };
      } catch (e: any) {
         this.logger.error(\`Failed to release reservation \${callId}: \${e.message}\`);
         return { billed: false, reason: e.message };
      }
    }

    let ratePerMin: bigint;
    if (numberType === 'local') {
      ratePerMin = PRICING.LOCAL_INBOUND_MICRO_PER_MIN;
    } else if (numberType === 'toll_free') {
      ratePerMin = PRICING.TOLL_FREE_INBOUND_MICRO_PER_MIN;
    } else {
      this.logger.warn(\`Call \${callId} lacks billable number_type (\${numberType})\`);
      // Phase 3D strict fallback safely
      ratePerMin = PRICING.LOCAL_INBOUND_MICRO_PER_MIN;
    }

    const billableMinutes = this.calculateBillableMinutes(talkDurationSeconds);
    const costMicro = billableMinutes * ratePerMin;

    if (costMicro <= 0n) {
      try {
        await this.walletService.releaseReservation(workspaceId, callId);
        return { billed: false, reason: 'Zero computed cost, reservation released' };
      } catch (e: any) {
         return { billed: false, reason: e.message };
      }
    }

    try {
      await this.walletService.settleReservation(workspaceId, callId, costMicro);
      return { billed: true, costMicro };
    } catch (e: any) {
      this.logger.error(\`Failed to settle call \${callId}: \${e.message}\`);
      return { billed: false, reason: e.message };
    }
  }`;

s = s.replace(/async billCallUsage\([\s\S]*?description:[\s\S]*?\}\);[\s\S]*?return \{ billed: true, costMicro \};[\s\S]*?\} catch \(e: any\) \{[\s\S]*?\}[\s\S]*?\}/, replacement);

fs.writeFileSync('apps/api/src/billing/usage-billing.service.ts', s);
