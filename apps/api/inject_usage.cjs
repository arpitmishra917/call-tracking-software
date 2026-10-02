const fs = require('fs');
let s = fs.readFileSync('apps/api/src/billing/usage-billing.service.ts', 'utf8');

const calcMethod = `
  calculateInitialReservation(numberType: string | null | undefined): bigint {
    let ratePerMin: bigint;
    if (numberType === 'local') {
      ratePerMin = PRICING.LOCAL_INBOUND_MICRO_PER_MIN;
    } else if (numberType === 'toll_free') {
      ratePerMin = PRICING.TOLL_FREE_INBOUND_MICRO_PER_MIN;
    } else {
      ratePerMin = PRICING.LOCAL_INBOUND_MICRO_PER_MIN;
    }
    const recordingRate = PRICING.RECORDING_MICRO_PER_MIN;
    // 10 minute block
    return (ratePerMin + recordingRate) * 10n;
  }

  calculateBillableMinutes(durationSeconds: number): bigint {`;

s = s.replace(/calculateBillableMinutes\(durationSeconds: number\): bigint \{/, calcMethod);
fs.writeFileSync('apps/api/src/billing/usage-billing.service.ts', s);
