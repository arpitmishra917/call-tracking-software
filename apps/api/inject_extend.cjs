const fs = require('fs');
let s = fs.readFileSync('apps/api/src/billing/wallet.service.ts', 'utf8');

const newMethod = `
  async extendReservationForCall(
    workspaceId: string,
    callId: string,
    extensionAmountMicro: bigint,
    extensionIdempotencyKey: string
  ) {
    if (extensionAmountMicro <= 0n) {
      throw new BadRequestException('Extension amount must be greater than zero.');
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Verify Call belongs to Workspace
      const call = await tx.call.findUnique({ where: { id: callId } });
      if (!call) throw new BadRequestException('Call not found.');
      if (call.workspace_id !== workspaceId) throw new BadRequestException('Cross-workspace access denied.');

      // 2. Lock Balance
      const balanceRecords = await tx.$queryRaw<any[]>\`SELECT balance_micro, reserved_micro FROM "workspace_balances" WHERE workspace_id = \${workspaceId} FOR UPDATE\`;
      if (balanceRecords.length === 0) {
        throw new BadRequestException('Workspace balance not found.');
      }
      const currentBalanceMicro = BigInt(balanceRecords[0].balance_micro);
      const currentReservedMicro = BigInt(balanceRecords[0].reserved_micro);

      // 3. Lock Reservation
      const reservationRecords = await tx.$queryRaw<any[]>\`SELECT * FROM "call_reservations" WHERE call_id = \${callId} FOR UPDATE\`;
      if (reservationRecords.length === 0) {
        throw new BadRequestException('Reservation not found.');
      }

      const resData = reservationRecords[0];
      const currentStatus = resData.status;
      const resWorkspaceId = resData.workspace_id;
      const resTotalMicro = BigInt(resData.total_reserved_micro);

      if (resWorkspaceId !== workspaceId) {
        throw new BadRequestException('Cross-workspace access denied on reservation.');
      }

      // 4. Verify reservation status
      if (currentStatus !== ReservationStatus.ACTIVE) {
        throw new BadRequestException('Cannot extend a non-ACTIVE reservation.');
      }

      // 5. Verify extension idempotency
      const existingExt = await tx.callReservationExtension.findUnique({
        where: { idempotency_key: extensionIdempotencyKey }
      });
      if (existingExt) {
        if (existingExt.workspace_id !== workspaceId) throw new BadRequestException('Cross-workspace access denied.');
        // Idempotent success - already applied
        return {
          reservationId: resData.id,
          totalReservedMicro: resTotalMicro,
          availableMicro: currentBalanceMicro - currentReservedMicro
        };
      }

      // 6. Calculate available balance
      const availableMicro = currentBalanceMicro - currentReservedMicro;

      // 7. Check funds
      if (availableMicro < extensionAmountMicro) {
        throw new BadRequestException('Insufficient available funds for reservation extension.');
      }

      // 8. Atomically extend
      const newReservedMicro = currentReservedMicro + extensionAmountMicro;
      await tx.workspaceBalance.update({
        where: { workspace_id: workspaceId },
        data: { reserved_micro: newReservedMicro },
      });

      const newTotalReservedMicro = resTotalMicro + extensionAmountMicro;
      const updatedRes = await tx.callReservation.update({
        where: { id: resData.id },
        data: { total_reserved_micro: newTotalReservedMicro },
      });

      // 9. Persist extension state
      // Parse extension index from idempotency key (e.g. extension:callId:1)
      const parts = extensionIdempotencyKey.split(':');
      const idx = parts.length === 3 ? parseInt(parts[2], 10) : 1;
      
      await tx.callReservationExtension.create({
        data: {
          reservation_id: resData.id,
          call_id: callId,
          workspace_id: workspaceId,
          extension_index: isNaN(idx) ? 1 : idx,
          idempotency_key: extensionIdempotencyKey,
          amount_micro: extensionAmountMicro,
        }
      });

      return {
        reservationId: resData.id,
        totalReservedMicro: newTotalReservedMicro,
        availableMicro: currentBalanceMicro - newReservedMicro
      };
    });
  }
`;

s = s.replace(/async reserveForCall\(/, newMethod + '\n  async reserveForCall(');
fs.writeFileSync('apps/api/src/billing/wallet.service.ts', s);
