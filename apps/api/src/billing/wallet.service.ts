import {
  Injectable,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TransactionType, ReservationStatus } from '@prisma/client';

export interface WalletTransactionMicroDto {
  workspaceId: string;
  amountMicro: bigint;
  referenceType: string;
  referenceId: string;
  idempotencyKey: string;
  description?: string;
}

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  async creditWallet(params: WalletTransactionMicroDto) {
    if (params.amountMicro <= 0n) {
      throw new BadRequestException('Credit amount must be greater than zero.');
    }

    return this.prisma.$transaction(async (tx) => {
      const existingTx = await tx.walletTransaction.findUnique({
        where: { idempotency_key: params.idempotencyKey },
      });
      if (existingTx) {
        if (
          existingTx.amount_micro !== params.amountMicro ||
          existingTx.workspace_id !== params.workspaceId ||
          existingTx.type !== TransactionType.CREDIT
        ) {
          throw new ConflictException(
            'Idempotency key reuse detected with materially different parameters.',
          );
        }
        return existingTx;
      }

      await tx.workspaceBalance.upsert({
        where: { workspace_id: params.workspaceId },
        create: {
          workspace_id: params.workspaceId,
          balance_minor: 0,
          balance_micro: 0n,
        },
        update: {},
      });

      const balanceRecords = await tx.$queryRaw<
        any[]
      >`SELECT balance_micro FROM "workspace_balances" WHERE workspace_id = ${params.workspaceId} FOR UPDATE`;
      const currentBalanceMicro = BigInt(balanceRecords[0].balance_micro);

      const newBalanceMicro = currentBalanceMicro + params.amountMicro;
      const newBalanceMinor = Number(newBalanceMicro / 10000n);

      const transaction = await tx.walletTransaction.create({
        data: {
          workspace_id: params.workspaceId,
          amount_minor: Number(params.amountMicro / 10000n), // Keep legacy populated safely
          amount_micro: params.amountMicro,
          type: TransactionType.CREDIT,
          balance_after: newBalanceMinor,
          balance_after_micro: newBalanceMicro,
          reference_type: params.referenceType,
          reference_id: params.referenceId,
          idempotency_key: params.idempotencyKey,
          description: params.description,
        },
      });

      await tx.workspaceBalance.update({
        where: { workspace_id: params.workspaceId },
        data: {
          balance_minor: newBalanceMinor,
          balance_micro: newBalanceMicro,
        },
      });

      return transaction;
    });
  }

  async debitWallet(params: WalletTransactionMicroDto) {
    if (params.amountMicro <= 0n) {
      throw new BadRequestException('Debit amount must be greater than zero.');
    }

    return this.prisma.$transaction(async (tx) => {
      const existingTx = await tx.walletTransaction.findUnique({
        where: { idempotency_key: params.idempotencyKey },
      });
      if (existingTx) {
        if (
          existingTx.amount_micro !== params.amountMicro ||
          existingTx.workspace_id !== params.workspaceId ||
          existingTx.type !== TransactionType.DEBIT
        ) {
          throw new ConflictException(
            'Idempotency key reuse detected with materially different parameters.',
          );
        }
        return existingTx;
      }

      await tx.workspaceBalance.upsert({
        where: { workspace_id: params.workspaceId },
        create: {
          workspace_id: params.workspaceId,
          balance_minor: 0,
          balance_micro: 0n,
        },
        update: {},
      });

      const balanceRecords = await tx.$queryRaw<
        any[]
      >`SELECT balance_micro FROM "workspace_balances" WHERE workspace_id = ${params.workspaceId} FOR UPDATE`;
      const currentBalanceMicro = BigInt(balanceRecords[0].balance_micro);

      if (currentBalanceMicro < params.amountMicro) {
        throw new BadRequestException('Insufficient funds.');
      }

      const newBalanceMicro = currentBalanceMicro - params.amountMicro;
      const newBalanceMinor = Number(newBalanceMicro / 10000n);

      const transaction = await tx.walletTransaction.create({
        data: {
          workspace_id: params.workspaceId,
          amount_minor: Number(params.amountMicro / 10000n),
          amount_micro: params.amountMicro,
          type: TransactionType.DEBIT,
          balance_after: newBalanceMinor,
          balance_after_micro: newBalanceMicro,
          reference_type: params.referenceType,
          reference_id: params.referenceId,
          idempotency_key: params.idempotencyKey,
          description: params.description,
        },
      });

      await tx.workspaceBalance.update({
        where: { workspace_id: params.workspaceId },
        data: {
          balance_minor: newBalanceMinor,
          balance_micro: newBalanceMicro,
        },
      });

      return transaction;
    });
  }

  async getTransactions(workspaceId: string, limit = 50, offset = 0) {
    const txs = await this.prisma.walletTransaction.findMany({
      where: { workspace_id: workspaceId },
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: offset,
    });
    return txs.map((tx) => ({
      ...tx,
      amount_micro: tx.amount_micro ? tx.amount_micro.toString() : '0',
      balance_after_micro: tx.balance_after_micro
        ? tx.balance_after_micro.toString()
        : '0',
    }));
  }
  // =========================================================================
  // PHASE 3C: ATOMIC WALLET RESERVATION ENGINE
  // =========================================================================

  async extendReservationForCall(
    workspaceId: string,
    callId: string,
    extensionAmountMicro: bigint,
    extensionIdempotencyKey: string,
  ) {
    if (extensionAmountMicro <= 0n) {
      throw new BadRequestException(
        'Extension amount must be greater than zero.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Verify Call belongs to Workspace
      const ws = await tx.workspace.findUnique({ where: { id: workspaceId } });
        if (!ws || ws.status !== 'ACTIVE') throw new BadRequestException('Workspace must be ACTIVE.');
        const call = await tx.call.findUnique({ where: { id: callId } });
      if (!call) throw new BadRequestException('Call not found.');
      if (call.workspace_id !== workspaceId)
        throw new BadRequestException('Cross-workspace access denied.');

      // 2. Lock Balance
      const balanceRecords = await tx.$queryRaw<
        any[]
      >`SELECT balance_micro, reserved_micro FROM "workspace_balances" WHERE workspace_id = ${workspaceId} FOR UPDATE`;
      if (balanceRecords.length === 0) {
        throw new BadRequestException('Workspace balance not found.');
      }
      const currentBalanceMicro = BigInt(balanceRecords[0].balance_micro);
      const currentReservedMicro = BigInt(balanceRecords[0].reserved_micro);

      // 3. Lock Reservation
      const reservationRecords = await tx.$queryRaw<
        any[]
      >`SELECT * FROM "call_reservations" WHERE call_id = ${callId} FOR UPDATE`;
      if (reservationRecords.length === 0) {
        throw new BadRequestException('Reservation not found.');
      }

      const resData = reservationRecords[0];
      const currentStatus = resData.status;
      const resWorkspaceId = resData.workspace_id;
      const resTotalMicro = BigInt(resData.total_reserved_micro);

      if (resWorkspaceId !== workspaceId) {
        throw new BadRequestException(
          'Cross-workspace access denied on reservation.',
        );
      }

      // 4. Verify reservation status
      if (currentStatus !== ReservationStatus.ACTIVE) {
        throw new BadRequestException(
          'Cannot extend a non-ACTIVE reservation.',
        );
      }

      // 5. Verify extension idempotency
      const existingExt = await tx.callReservationExtension.findUnique({
        where: { idempotency_key: extensionIdempotencyKey },
      });
      if (existingExt) {
        if (existingExt.workspace_id !== workspaceId)
          throw new BadRequestException('Cross-workspace access denied.');
        // Idempotent success - already applied
        return {
          reservationId: resData.id,
          totalReservedMicro: resTotalMicro,
          availableMicro: currentBalanceMicro - currentReservedMicro,
        };
      }

      // 6. Calculate available balance
      const availableMicro = currentBalanceMicro - currentReservedMicro;

      // 7. Check funds
      if (availableMicro < extensionAmountMicro) {
        throw new BadRequestException(
          'Insufficient available funds for reservation extension.',
        );
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
        },
      });

      return {
        reservationId: resData.id,
        totalReservedMicro: newTotalReservedMicro,
        availableMicro: currentBalanceMicro - newReservedMicro,
      };
    });
  }

  async reserveForCall(
    workspaceId: string,
    callId: string,
    amountMicro: bigint,
  ) {
    if (amountMicro <= 0n) {
      throw new BadRequestException(
        'Reservation amount must be greater than zero.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Verify Call belongs to Workspace
      const ws = await tx.workspace.findUnique({ where: { id: workspaceId } });
      if (!ws || ws.status !== 'ACTIVE') throw new BadRequestException('Workspace must be ACTIVE.');
      const call = await tx.call.findUnique({ where: { id: callId } });
      if (!call) {
        throw new BadRequestException('Call not found.');
      }
      if (call.workspace_id !== workspaceId) {
        throw new BadRequestException('Cross-workspace access denied.');
      }

      // 2. Check for existing reservation for idempotency
      const existingRes = await tx.callReservation.findUnique({
        where: { call_id: callId },
      });
      if (existingRes) {
        if (existingRes.workspace_id !== workspaceId) {
          throw new BadRequestException('Cross-workspace access denied.');
        }
        if (existingRes.status !== ReservationStatus.ACTIVE) {
          throw new ConflictException(
            'Reservation already processed (not ACTIVE).',
          );
        }
        if (existingRes.total_reserved_micro !== amountMicro) {
          throw new ConflictException(
            'Reservation amount mismatch for existing reservation.',
          );
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
          reserved_micro: 0n,
        },
        update: {},
      });

      // 4. Lock balance
      const balanceRecords = await tx.$queryRaw<
        any[]
      >`SELECT balance_micro, reserved_micro FROM "workspace_balances" WHERE workspace_id = ${workspaceId} FOR UPDATE`;
      const currentBalanceMicro = BigInt(balanceRecords[0].balance_micro);
      const currentReservedMicro = BigInt(balanceRecords[0].reserved_micro);

      const availableMicro = currentBalanceMicro - currentReservedMicro;

      // 5. Verify funds
      if (availableMicro < amountMicro) {
        throw new BadRequestException(
          'Insufficient available funds for reservation.',
        );
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
        },
      });

      // 7. Update Balance
      await tx.workspaceBalance.update({
        where: { workspace_id: workspaceId },
        data: {
          reserved_micro: newReservedMicro,
        },
      });

      return reservation;
    });
  }

  async releaseReservation(workspaceId: string, callId: string) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Lock balance
      await tx.$queryRaw<
        any[]
      >`SELECT balance_micro, reserved_micro FROM "workspace_balances" WHERE workspace_id = ${workspaceId} FOR UPDATE`;

      // 2. Lock Reservation
      const reservationRecords = await tx.$queryRaw<
        any[]
      >`SELECT * FROM "call_reservations" WHERE call_id = ${callId} FOR UPDATE`;
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
        return {
          message: 'Already released',
          status: ReservationStatus.RELEASED,
        };
      }
      if (currentStatus === ReservationStatus.SETTLED) {
        throw new ConflictException('Reservation already settled.');
      }
      if (currentStatus === ReservationStatus.EXPIRED) {
        throw new ConflictException('Reservation expired.');
      }

      // 3. Update Balance
      await tx.$queryRaw`UPDATE "workspace_balances" SET reserved_micro = reserved_micro - ${resTotalMicro} WHERE workspace_id = ${workspaceId}`;

      // 4. Update Reservation
      const updatedRes = await tx.callReservation.update({
        where: { call_id: callId },
        data: { status: ReservationStatus.RELEASED },
      });

      return updatedRes;
    });
  }

  async settleReservation(
    workspaceId: string,
    callId: string,
    actualCostMicro: bigint,
  ) {
    if (actualCostMicro < 0n) {
      throw new BadRequestException('Settlement amount cannot be negative.');
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Lock Balance
      const balanceRecords = await tx.$queryRaw<
        any[]
      >`SELECT balance_micro, reserved_micro FROM "workspace_balances" WHERE workspace_id = ${workspaceId} FOR UPDATE`;
      if (balanceRecords.length === 0) {
        throw new BadRequestException('Workspace balance not found.');
      }
      const currentBalanceMicro = BigInt(balanceRecords[0].balance_micro);
      const currentReservedMicro = BigInt(balanceRecords[0].reserved_micro);

      // 2. Lock Reservation
      const reservationRecords = await tx.$queryRaw<
        any[]
      >`SELECT * FROM "call_reservations" WHERE call_id = ${callId} FOR UPDATE`;
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
        return {
          message: 'Already settled',
          status: ReservationStatus.SETTLED,
        };
      }
      if (currentStatus === ReservationStatus.RELEASED) {
        throw new ConflictException('Reservation already released.');
      }
      if (currentStatus === ReservationStatus.EXPIRED) {
        throw new ConflictException('Reservation expired.');
      }

      // 3. Check bounds
      if (actualCostMicro > resTotalMicro) {
        throw new BadRequestException(
          'Insufficient reservation funds to settle actual cost.',
        );
      }

      const newBalanceMicro = currentBalanceMicro - actualCostMicro;
      const newReservedMicro = currentReservedMicro - resTotalMicro;
      const newBalanceMinor = Number(newBalanceMicro / 10000n);

      if (newBalanceMicro < 0n) {
        throw new BadRequestException(
          'Settlement would result in negative wallet balance.',
        );
      }
      if (newReservedMicro < 0n) {
        throw new BadRequestException(
          'Settlement would result in negative reserved balance.',
        );
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
            idempotency_key: `settle-${callId}`,
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
          reserved_micro: newReservedMicro,
        },
      });

      // 6. Update Reservation
      const updatedRes = await tx.callReservation.update({
        where: { call_id: callId },
        data: { status: ReservationStatus.SETTLED },
      });

      return updatedRes;
    });
  }
}
