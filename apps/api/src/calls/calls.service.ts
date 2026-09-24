import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsageService } from '../usage/usage.service.js';
import {
  CallState,
  CallAttemptState,
  Call,
  CallAttempt,
  UsageType,
} from '@prisma/client';

export const VALID_CALL_TRANSITIONS: Record<CallState, CallState[]> = {
  [CallState.INITIATED]: [
    CallState.ROUTING,
    CallState.CANCELED,
    CallState.FAILED,
  ],
  [CallState.ROUTING]: [
    CallState.COMPLETED,
    CallState.NO_ANSWER,
    CallState.FAILED,
    CallState.CANCELED,
  ],
  [CallState.COMPLETED]: [],
  [CallState.NO_ANSWER]: [],
  [CallState.FAILED]: [],
  [CallState.CANCELED]: [],
};

export const VALID_ATTEMPT_TRANSITIONS: Record<
  CallAttemptState,
  CallAttemptState[]
> = {
  [CallAttemptState.INITIATED]: [
    CallAttemptState.RINGING,
    CallAttemptState.CANCELED,
    CallAttemptState.FAILED,
  ],
  [CallAttemptState.RINGING]: [
    CallAttemptState.ANSWERED,
    CallAttemptState.NO_ANSWER,
    CallAttemptState.FAILED,
    CallAttemptState.CANCELED,
  ],
  [CallAttemptState.ANSWERED]: [
    CallAttemptState.COMPLETED,
    CallAttemptState.FAILED,
  ],
  [CallAttemptState.COMPLETED]: [],
  [CallAttemptState.NO_ANSWER]: [],
  [CallAttemptState.FAILED]: [],
  [CallAttemptState.CANCELED]: [],
};

import { WebhooksService } from '../webhooks/webhooks.service.js';

@Injectable()
export class CallsService {
  constructor(
    private prisma: PrismaService,
    private usageService: UsageService,
    private webhooksService: WebhooksService,
  ) {}

  async createCall(data: {
    workspace_id: string;
    campaign_id?: string;
    provider: string;
    provider_call_id: string;
    from_number: string;
    to_number: string;
  }): Promise<Call> {
    const call = await this.prisma.call.create({
      data: {
        ...data,
        state: CallState.INITIATED,
      },
    });

    // Fire webhook
    this.webhooksService
      .queueEvent(data.workspace_id, 'call.started', call)
      .catch(console.error);

    return call;
  }

  async transitionCall(
    callId: string,
    newState: CallState,
    durationSecs?: number,
  ): Promise<Call> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Call" WHERE id = ${callId}::uuid FOR UPDATE`;
      const call = await tx.call.findUnique({ where: { id: callId } });
      if (!call) throw new NotFoundException(`Call ${callId} not found`);

      if (!this.isValidTransition(call.state, newState)) {
        throw new BadRequestException(
          `Invalid transition from ${call.state} to ${newState}`,
        );
      }

      const updateData: any = { state: newState };
      if (durationSecs !== undefined) {
        updateData.duration_secs = durationSecs;
      }

      const updatedCall = await tx.call.update({
        where: { id: callId },
        data: updateData,
      });

      // Fire webhooks
      if (newState !== call.state) {
        if (newState === CallState.FAILED) {
          this.webhooksService
            .queueEvent(updatedCall.workspace_id, 'call.blocked', updatedCall)
            .catch(console.error);
        } else if (newState === CallState.COMPLETED) {
          this.webhooksService
            .queueEvent(updatedCall.workspace_id, 'call.answered', updatedCall)
            .catch(console.error);
        } else if (this.isTerminalCallState(newState)) {
          this.webhooksService
            .queueEvent(updatedCall.workspace_id, 'call.ended', updatedCall)
            .catch(console.error);
        }
      }

      return updatedCall;
    });
  }

  async handleCallerHangup(providerCallId: string, durationSecs?: number) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Call" WHERE provider_call_id = ${providerCallId} FOR UPDATE`;
      const call = await tx.call.findUnique({
        where: { provider_call_id: providerCallId },
        include: { attempts: true },
      });
      if (!call)
        throw new NotFoundException(`Call ${providerCallId} not found`);

      // Cancel the call if it's not in a terminal state already
      let finalState = call.state;
      if (
        call.state === CallState.INITIATED ||
        call.state === CallState.ROUTING
      ) {
        finalState = CallState.CANCELED;
      } else if (call.state === CallState.COMPLETED) {
        finalState = CallState.COMPLETED;
      }

      for (const attempt of call.attempts) {
        if (
          attempt.state === CallAttemptState.INITIATED ||
          attempt.state === CallAttemptState.RINGING
        ) {
          await tx.callAttempt.update({
            where: { id: attempt.id },
            data: { state: CallAttemptState.CANCELED },
          });
        }
      }

      const updateData: any = { state: finalState };
      const computedDuration =
        durationSecs !== undefined
          ? durationSecs
          : Math.floor(
              (Date.now() - (call.created_at?.getTime?.() ?? Date.now())) /
                1000,
            );

      if (this.isTerminalCallState(finalState) && call.duration_secs === null) {
        updateData.duration_secs = computedDuration;
      } else if (durationSecs !== undefined) {
        updateData.duration_secs = durationSecs;
      }

      let updatedCall: any = call;
      if (call.state !== finalState || updateData.duration_secs !== undefined) {
        updatedCall = await tx.call.update({
          where: { id: call.id },
          data: updateData,
        });
      }

      // Record Usage
      if (updatedCall.duration_secs !== null && updatedCall.duration_secs > 0) {
        const minutes = Math.ceil(updatedCall.duration_secs / 60);
        await this.usageService.recordUsage(
          updatedCall.workspace_id,
          UsageType.CALL_MINUTE,
          minutes,
          updatedCall.id,
          `CALL_MINUTE_${updatedCall.id}`,
        );
      }

      // Fire webhooks
      if (call.state !== finalState) {
        if (finalState === CallState.FAILED) {
          this.webhooksService
            .queueEvent(updatedCall.workspace_id, 'call.blocked', updatedCall)
            .catch(console.error);
        } else if (finalState === CallState.COMPLETED) {
          this.webhooksService
            .queueEvent(updatedCall.workspace_id, 'call.answered', updatedCall)
            .catch(console.error);
        } else if (this.isTerminalCallState(finalState)) {
          this.webhooksService
            .queueEvent(updatedCall.workspace_id, 'call.ended', updatedCall)
            .catch(console.error);
        }
      }

      return updatedCall;
    });
  }

  async createCallAttempt(data: {
    call_id: string;
    buyer_id: string;
    provider_call_id?: string;
  }): Promise<CallAttempt> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Call" WHERE id = ${data.call_id}::uuid FOR UPDATE`;
      const call = await tx.call.findUnique({ where: { id: data.call_id } });
      if (!call) throw new NotFoundException(`Call ${data.call_id} not found`);

      if (this.isTerminalCallState(call.state)) {
        throw new BadRequestException(
          `Cannot create attempt for call in terminal state: ${call.state}`,
        );
      }

      const attempt = await tx.callAttempt.create({
        data: {
          ...data,
          state: CallAttemptState.INITIATED,
        },
      });

      this.webhooksService
        .queueEvent(call.workspace_id, 'call.attempt.started', attempt)
        .catch(console.error);

      return attempt;
    });
  }

  async transitionAttempt(
    attemptId: string,
    newState: CallAttemptState,
    durationSecs?: number,
  ): Promise<CallAttempt> {
    const initialAttempt = await this.prisma.callAttempt.findUnique({ where: { id: attemptId } });
    if (!initialAttempt) throw new NotFoundException(`CallAttempt ${attemptId} not found`);

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Call" WHERE id = ${initialAttempt.call_id}::uuid FOR UPDATE`;
      const attempt = await tx.callAttempt.findUnique({
        where: { id: attemptId },
      });
      if (!attempt)
        throw new NotFoundException(`CallAttempt ${attemptId} not found`);

      if (!this.isValidAttemptTransition(attempt.state, newState)) {
        throw new BadRequestException(
          `Invalid attempt transition from ${attempt.state} to ${newState}`,
        );
      }

      const updateData: any = { state: newState };
      if (durationSecs !== undefined) {
        updateData.duration_secs = durationSecs;
      }

      const updatedAttempt = await tx.callAttempt.update({
        where: { id: attemptId },
        data: updateData,
      });

      if (newState !== attempt.state) {
        if (VALID_ATTEMPT_TRANSITIONS[newState].length === 0) {
          // It's a terminal state
          const call = await tx.call.findUnique({
            where: { id: attempt.call_id },
          });
          if (call) {
            this.webhooksService
              .queueEvent(
                call.workspace_id,
                'call.attempt.ended',
                updatedAttempt,
              )
              .catch(console.error);
          }
        }
      }

      return updatedAttempt;
    });
  }

  private isValidTransition(from: CallState, to: CallState): boolean {
    if (from === to) return true; // idempotency
    return VALID_CALL_TRANSITIONS[from].includes(to);
  }

  private isValidAttemptTransition(
    from: CallAttemptState,
    to: CallAttemptState,
  ): boolean {
    if (from === to) return true; // idempotency
    return VALID_ATTEMPT_TRANSITIONS[from].includes(to);
  }

  private isTerminalCallState(state: CallState): boolean {
    return VALID_CALL_TRANSITIONS[state].length === 0;
  }

  async getCalls(
    workspaceId: string,
    filters: {
      campaignId?: string;
      buyerId?: string;
      status?: CallState;
      callerNumber?: string;
      startDate?: string;
      endDate?: string;
      limit?: number;
      offset?: number;
    },
  ) {
    const where: any = { workspace_id: workspaceId };

    if (filters.campaignId) {
      where.campaign_id = filters.campaignId;
    }
    if (filters.buyerId) {
      where.attempts = {
        some: { buyer_id: filters.buyerId },
      };
    }
    if (filters.status) {
      where.state = filters.status;
    }
    if (filters.callerNumber) {
      where.from_number = { contains: filters.callerNumber };
    }
    if (filters.startDate || filters.endDate) {
      where.created_at = {};
      if (filters.startDate) where.created_at.gte = new Date(filters.startDate);
      if (filters.endDate) where.created_at.lte = new Date(filters.endDate);
    }

    const [items, total] = await Promise.all([
      this.prisma.call.findMany({
        where,
        include: {
          campaign: { select: { name: true } },
          attempts: {
            include: { buyer: { select: { name: true } } },
            orderBy: { created_at: 'asc' },
          },
        },
        orderBy: { created_at: 'desc' },
        skip: filters.offset || 0,
        take: filters.limit || 50,
      }),
      this.prisma.call.count({ where }),
    ]);

    return { items, total };
  }

  async getCallDetail(workspaceId: string, callId: string) {
    const call = await this.prisma.call.findUnique({
      where: { id: callId, workspace_id: workspaceId },
      include: {
        campaign: { select: { name: true } },
        attempts: {
          include: { buyer: { select: { name: true } } },
          orderBy: { created_at: 'asc' },
        },
        recordings: true,
      },
    });

    if (!call) throw new NotFoundException(`Call ${callId} not found`);
    return call;
  }

  async getMetrics(
    workspaceId: string,
    filters: { startDate?: string; endDate?: string },
  ) {
    const where: any = { workspace_id: workspaceId };
    if (filters.startDate || filters.endDate) {
      where.created_at = {};
      if (filters.startDate) where.created_at.gte = new Date(filters.startDate);
      if (filters.endDate) where.created_at.lte = new Date(filters.endDate);
    }

    const calls = await this.prisma.call.findMany({
      where,
      select: {
        state: true,
        duration_secs: true,
        campaign_id: true,
      },
    });

    const attempts = await this.prisma.callAttempt.findMany({
      where: {
        call: { workspace_id: workspaceId, ...where },
      },
      select: {
        state: true,
        buyer_id: true,
      },
    });

    const metrics = {
      total: calls.length,
      answered: calls.filter((c) => c.state === CallState.COMPLETED).length,
      missed: calls.filter(
        (c) =>
          c.state === CallState.NO_ANSWER ||
          c.state === CallState.FAILED ||
          c.state === CallState.CANCELED,
      ).length,
      blocked: calls.filter((c) => c.state === CallState.FAILED).length, // Approximated
      avgDuration: 0,
      campaigns: {} as Record<string, { total: number; answered: number }>,
      buyers: {} as Record<string, { total: number; answered: number }>,
    };

    let totalDuration = 0;
    let durationCount = 0;
    calls.forEach((c) => {
      if (c.duration_secs) {
        totalDuration += c.duration_secs;
        durationCount++;
      }
      if (c.campaign_id) {
        if (!metrics.campaigns[c.campaign_id]) {
          metrics.campaigns[c.campaign_id] = { total: 0, answered: 0 };
        }
        metrics.campaigns[c.campaign_id].total++;
        if (c.state === CallState.COMPLETED) {
          metrics.campaigns[c.campaign_id].answered++;
        }
      }
    });
    if (durationCount > 0) {
      metrics.avgDuration = Math.round(totalDuration / durationCount);
    }

    attempts.forEach((a) => {
      if (a.buyer_id) {
        if (!metrics.buyers[a.buyer_id]) {
          metrics.buyers[a.buyer_id] = { total: 0, answered: 0 };
        }
        metrics.buyers[a.buyer_id].total++;
        if (
          a.state === CallAttemptState.ANSWERED ||
          a.state === CallAttemptState.COMPLETED
        ) {
          metrics.buyers[a.buyer_id].answered++;
        }
      }
    });

    return metrics;
  }
}
