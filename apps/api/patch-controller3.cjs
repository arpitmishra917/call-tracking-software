const fs = require('fs');
let code = fs.readFileSync('apps/api/src/calls/calls.controller.ts', 'utf8');

code = code.replace(
  /ParseIntPipe,\n} from '@nestjs\/common';/,
  "ParseIntPipe,\n  BadRequestException,\n} from '@nestjs/common';"
);

const newArgs = `    @Query('endDate') endDate?: string,
    @Query('trackingNumber') trackingNumber?: string,
    @Query('durationType') durationType?: 'talk' | 'total',
    @Query('minDurationSecs') minDurationSecs?: string,
    @Query('maxDurationSecs') maxDurationSecs?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,`;

code = code.replace(
  /    @Query\('endDate'\) endDate\?: string,\n    @Query\('limit'\) limit\?: string,\n    @Query\('offset'\) offset\?: string,/g,
  newArgs
);

const validationLogic = `
    const min = minDurationSecs ? parseInt(minDurationSecs, 10) : undefined;
    const max = maxDurationSecs ? parseInt(maxDurationSecs, 10) : undefined;

    if (minDurationSecs || maxDurationSecs) {
      if (!durationType) {
        throw new BadRequestException('durationType is REQUIRED when min/max duration filtering is supplied.');
      }
    }
    
    if (durationType && durationType !== 'talk' && durationType !== 'total') {
      throw new BadRequestException('Invalid durationType. Allowed values: talk, total');
    }

    if (min !== undefined && (isNaN(min) || min < 0)) {
      throw new BadRequestException('minDurationSecs must be an integer >= 0');
    }
    if (max !== undefined && (isNaN(max) || max < 0)) {
      throw new BadRequestException('maxDurationSecs must be an integer >= 0');
    }
    if (min !== undefined && max !== undefined && min > max) {
      throw new BadRequestException('minDurationSecs cannot be greater than maxDurationSecs');
    }

    return this.callsService.getCalls(workspaceId, {
      campaignId,
      buyerId,
      status,
      callerNumber,
      trackingNumber,
      durationType,
      minDurationSecs: min,
      maxDurationSecs: max,`;

code = code.replace(
  /    return this\.callsService\.getCalls\(workspaceId, {\n      campaignId,\n      buyerId,\n      status,\n      callerNumber,\n      startDate,\n      endDate,/g,
  validationLogic + '\n      startDate,\n      endDate,'
);

fs.writeFileSync('apps/api/src/calls/calls.controller.ts', code);
console.log('patched');
