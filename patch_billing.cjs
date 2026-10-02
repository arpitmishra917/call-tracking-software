const fs = require('fs');
let s = fs.readFileSync('apps/api/src/billing/billing.service.ts', 'utf8');

const target = `      if (!balance) {
        return { balance: { amountMinor: 0, currency: 'USD' } };
      }
      return { balance: { amountMinor: balance.balance_minor, currency: balance.currency } };`;

const replacement = `      if (!balance) {
        return { balance: { amountMinor: 0, amountMicro: '0', currency: 'USD' } };
      }
      return { balance: { amountMinor: balance.balance_minor, amountMicro: balance.balance_micro ? balance.balance_micro.toString() : '0', currency: balance.currency } };`;

s = s.replace(target, replacement);
fs.writeFileSync('apps/api/src/billing/billing.service.ts', s);
