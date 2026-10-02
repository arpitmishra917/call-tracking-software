const fs = require('fs');

let s = fs.readFileSync('apps/api/src/billing/wallet.service.ts', 'utf8');

// Fix imports
s = s.replace("import { TransactionType } from '@prisma/client';", 
  "import { TransactionType, ReservationStatus } from '@prisma/client';");

const methods = \`
  // =========================================================================
  // PHASE 3C: ATOMIC WALLET RESERVATION ENGINE
  // =========================================================================

  async reserveForCall(workspaceId: string, callId: string, amountMicro: bigint) {
    if (amountMicro <= 0n) {
      throw new BadRequestException('Reservation amount must be greater than zero.');
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Verify Call belongs to Workspace
      const call = await tx.call.findUnique({ where: { id: callId } });
      if (!call) {
        throw new BadRequestException('Call not found.');
      }
      if (call.workspace_id !== workspaceId) {
        throw new BadRequestException('Cross-workspace access denied.');
      }

      // 2. Check for existing reservation for idempotency
      const existingRes = await tx.callReservation.findUnique({ where: { call_id: callId } });
      if (existingRes) {
        if (existingRes.workspace_id !== workspaceId) {
          throw new BadRequestException('Cross-workspace access denied.');
        }
        if (existingRes.status !== ReservationStatus.ACTIVE) {
          throw new ConflictException('Reservation already processed (not ACTIVE).');
        }
        if (existingRes.total_reserved_micro !== amountMicro) {
          throw new ConflictException('Reservation amount mismatch for existing reservation.');
        }
        return existingRes;
      }

      // 3. Upsert balance row
      await tx.workspaceBalance.upsert({
        where: { workspace_id: workspaceId },
        create: { 
          workspace_id: workspaceId, 
          balance_minor: 0, 
          balance_micro: 0n,
          reserved_micro: 0n
        },
        update: {},
      });

      // 4. Lock balance
      const balanceRecords = await tx.$queryRaw<any[]>\`SELECT balance_micro, reserved_micro FROM "workspace_balances" WHERE workspace_id = \${workspaceId} FOR UPDATE\`;
      const currentBalanceMicro = BigInt(balanceRecords[0].balance_micro);
      const currentReservedMicro = BigInt(balanceRecords[0].reserved_micro);

      const availableMicro = currentBalanceMicro - currentReservedMicro;

      // 5. Verify funds
      if (availableMicro < amountMicro) {
        throw new BadRequestException('Insufficient available funds for reservation.');
      }

      const newReservedMicro = currentReservedMicro + amountMicro;

      // 6. Create Reservation
      const reservation = await tx.callReservation.create({
        data: {
          call_id: callId,
          workspace_id: workspaceId,
          status: ReservationStatus.ACTIVE,
          original_reserved_micro: amountMicro,
          total_reserved_micro: amountMicro,
        }
      });

      // 7. Update Balance
      await tx.workspaceBalance.update({
        where: { workspace_id: workspaceId },
        data: {
          reserved_micro: newReservedMicro
        }
      });

      return reservation;
    });
  }

  async releaseReservation(workspaceId: string, callId: string) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Lock balance
      await tx.$queryRaw<any[]>\`SELECT balance_micro, reserved_micro FROM "workspace_balances" WHERE workspace_id = \${workspaceId} FOR UPDATE\`;

      // 2. Lock Reservation
      const reservationRecords = await tx.$queryRaw<any[]>\`SELECT * FROM "call_reservations" WHERE call_id = \${callId} FOR UPDATE\`;
      if (reservationRecords.length === 0) {
        throw new BadRequestException('Reservation not found.');
      }
      
      const resData = reservationRecords[0];
      const currentStatus = resData.status;
      const resWorkspaceId = resData.workspace_id;
      const resTotalMicro = BigInt(resData.total_reserved_micro);

      if (resWorkspaceId !== workspaceId) {
        throw new BadRequestException('Cross-workspace access denied.');
      }

      if (currentStatus === ReservationStatus.RELEASED) {
        return { message: 'Already released', status: ReservationStatus.RELEASED };
      }
      if (currentStatus === ReservationStatus.SETTLED) {
        throw new ConflictException('Reservation already settled.');
      }
      if (currentStatus === ReservationStatus.EXPIRED) {
        throw new ConflictException('Reservation expired.');
      }

      // 3. Update Balance
      await tx.$queryRaw\`UPDATE "workspace_balances" SET reserved_micro = reserved_micro - \${resTotalMicro} WHERE workspace_id = \${workspaceId}\`;

      // 4. Update Reservation
      const updatedRes = await tx.callReservation.update({
        where: { call_id: callId },
        data: { status: ReservationStatus.RELEASED }
      });

      return updatedRes;
    });
  }

  async settleReservation(workspaceId: string, callId: string, actualCostMicro: bigint) {
    if (actualCostMicro < 0n) {
      throw new BadRequestException('Settlement amount cannot be negative.');
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Lock Balance
      const balanceRecords = await tx.$queryRaw<any[]>\`SELECT balance_micro, reserved_micro FROM "workspace_balances" WHERE workspace_id = \${workspaceId} FOR UPDATE\`;
      if (balanceRecords.length === 0) {
        throw new BadRequestException('Workspace balance not found.');
      }
      const currentBalanceMicro = BigInt(balanceRecords[0].balance_micro);
      const currentReservedMicro = BigInt(balanceRecords[0].reserved_micro);

      // 2. Lock Reservation
      const reservationRecords = await tx.$queryRaw<any[]>\`SELECT * FROM "call_reservations" WHERE call_id = \${callId} FOR UPDATE\`;
      if (reservationRecords.length === 0) {
        throw new BadRequestException('Reservation not found.');
      }
      
      const resData = reservationRecords[0];
      const currentStatus = resData.status;
      const resWorkspaceId = resData.workspace_id;
      const resTotalMicro = BigInt(resData.total_reserved_micro);

      if (resWorkspaceId !== workspaceId) {
        throw new BadRequestException('Cross-workspace access denied.');
      }

      if (currentStatus === ReservationStatus.SETTLED) {
        return { message: 'Already settled', status: ReservationStatus.SETTLED };
      }
      if (currentStatus === ReservationStatus.RELEASED) {
        throw new ConflictException('Reservation already released.');
      }
      if (currentStatus === ReservationStatus.EXPIRED) {
        throw new ConflictException('Reservation expired.');
      }

      // 3. Check bounds
      if (actualCostMicro > resTotalMicro) {
        throw new BadRequestException('Insufficient reservation funds to settle actual cost.');
      }

      const newBalanceMicro = currentBalanceMicro - actualCostMicro;
      const newReservedMicro = currentReservedMicro - resTotalMicro;
      const newBalanceMinor = Number(newBalanceMicro / 10000n);

      if (newBalanceMicro < 0n) {
        throw new BadRequestException('Settlement would result in negative wallet balance.');
      }
      if (newReservedMicro < 0n) {
        throw new BadRequestException('Settlement would result in negative reserved balance.');
      }

      // 4. Create Ledger DEBIT transaction if cost > 0
      if (actualCostMicro > 0n) {
        await tx.walletTransaction.create({
          data: {
            workspace_id: workspaceId,
            amount_minor: Number(actualCostMicro / 10000n),
            amount_micro: actualCostMicro,
            type: TransactionType.DEBIT,
            balance_after: newBalanceMinor,
            balance_after_micro: newBalanceMicro,
            reference_type: 'CALL_SETTLEMENT',
            reference_id: callId,
            idempotency_key: \`settle-\${callId}\`,
            description: 'Final call usage settlement',
          },
        });
      }

      // 5. Update Balance
      await tx.workspaceBalance.update({
        where: { workspace_id: workspaceId },
        data: {
          balance_minor: newBalanceMinor,
          balance_micro: newBalanceMicro,
          reserved_micro: newReservedMicro
        }
      });

      // 6. Update Reservation
      const updatedRes = await tx.callReservation.update({
        where: { call_id: callId },
        data: { status: ReservationStatus.SETTLED }
      });

      return updatedRes;
    });
  }
\`;

// Insert methods before last brace
const lastBraceIndex = s.lastIndexOf('}');
if (lastBraceIndex > -1) {
    s = s.substring(0, lastBraceIndex) + methods + '\\n}\\n';
    
    // Fix any string interpolation escapes if this script is outputting liter backslash backtick
    s = s.split('\\\\\\`').join('\\`').split('\\\\\\$').join('$');
    
    fs.writeFileSync('apps/api/src/billing/wallet.service.ts', s);
    console.log('Successfully injected methods.');
} else {
    console.log('Failed to find closing brace.');
}
