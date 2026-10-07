import { PermissionsService } from '../permissions/permissions.service.js';
import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsageService } from '../usage/usage.service.js';
import { UsageBillingService } from '../billing/usage-billing.service.js';
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
    private permissionsService: PermissionsService,
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
      await tx.$queryRaw`SELECT id FROM "calls" WHERE id = ${callId} FOR UPDATE`;
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
      await tx.$queryRaw`SELECT id FROM "calls" WHERE provider_call_id = ${providerCallId} FOR UPDATE`;
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
      await tx.$queryRaw`SELECT id FROM "calls" WHERE id = ${data.call_id} FOR UPDATE`;
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
      await tx.$queryRaw`SELECT id FROM "calls" WHERE id = ${initialAttempt.call_id} FOR UPDATE`;
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

  async markCallAnswered(callId: string, attemptId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "calls" WHERE id = ${callId} FOR UPDATE`;
      const call = await tx.call.findUnique({ where: { id: callId } });
      const attempt = await tx.callAttempt.findUnique({ where: { id: attemptId } });
      if (!call || call.state !== CallState.ROUTING || !attempt || (attempt.state !== 'RINGING' && attempt.state !== 'INITIATED')) {
        return false;
      }

      await tx.callAttempt.update({
        where: { id: attemptId },
        data: { state: CallAttemptState.ANSWERED },
      });

      const updatedCall = await tx.call.update({
        where: { id: callId },
        data: { state: CallState.COMPLETED },
      });

      this.webhooksService
        .queueEvent(call.workspace_id, 'call.answered', updatedCall)
        .catch(console.error);

      return true;
    });
  }

  async handleBuyerHangup(callId: string, attemptId: string): Promise<{ action: 'HANGUP_CALLER' | 'DIAL_NEXT' | 'NONE', call?: any }> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "calls" WHERE id = ${callId} FOR UPDATE`;
      const call = await tx.call.findUnique({
        where: { id: callId },
        include: { attempts: { include: { buyer: true }, orderBy: { created_at: 'asc' } } }
      });
      const attempt = call?.attempts.find((a: any) => a.id === attemptId);

      if (!call || !attempt) return { action: 'NONE' };

      if (
        attempt.state === CallAttemptState.COMPLETED ||
        attempt.state === CallAttemptState.NO_ANSWER ||
        attempt.state === CallAttemptState.FAILED ||
        attempt.state === CallAttemptState.CANCELED
      ) {
        return { action: 'NONE' };
      }

      if (call.state === CallState.COMPLETED && attempt.state === CallAttemptState.ANSWERED) {
        await tx.callAttempt.update({
          where: { id: attemptId },
          data: { state: CallAttemptState.COMPLETED },
        });
        return { action: 'HANGUP_CALLER' };
      }

      if (call.state === CallState.ROUTING) {
        await tx.callAttempt.update({
          where: { id: attemptId },
          data: { state: CallAttemptState.NO_ANSWER },
        });

        const updatedCall = await tx.call.findUnique({
          where: { id: callId },
          include: { attempts: { include: { buyer: true }, orderBy: { created_at: 'asc' } } }
        });
        return { action: 'DIAL_NEXT', call: updatedCall };
      }

      return { action: 'NONE' };
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
    userId: string = '',
    filters: {
      campaignId?: string;
      buyerId?: string;
      status?: CallState;
      callerNumber?: string;
      trackingNumber?: string;
      durationType?: 'talk' | 'total';
      minDurationSecs?: number;
      maxDurationSecs?: number;
      startDate?: string;
      endDate?: string;
      limit?: number;
      offset?: number;
    },
  ) {
    const permissions = await this.permissionsService.getPermissionsForUser(workspaceId, userId);
    const readPerms = permissions.filter(p => p.key === 'call:read');
    if (readPerms.length === 0) throw new ForbiddenException('Missing call:read permission');
    
    const hasAll = readPerms.some(p => p.scope_type === 'ALL');
    const hasAssigned = readPerms.some(p => p.scope_type === 'ASSIGNED');
    const campaignIds = readPerms.filter(p => p.scope_type === 'CAMPAIGN' && p.resource_id).map(p => p.resource_id);
    const phoneIds = readPerms.filter(p => p.scope_type === 'PHONE_NUMBER' && p.resource_id).map(p => p.resource_id);
    const buyerIds = readPerms.filter(p => p.scope_type === 'BUYER' && p.resource_id).map(p => p.resource_id);
    
    let authOrConditions: any[] = [];
    if (!hasAll) {
      let assignedBuyerId = null;
      if (hasAssigned) {
        const member = await this.prisma.workspaceMember.findUnique({
          where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: userId } }
        });
        assignedBuyerId = member?.buyer_id;
      }
      
      if (assignedBuyerId) {
        authOrConditions.push({ campaign: { buyers: { some: { buyer_id: assignedBuyerId } } } });
        authOrConditions.push({ attempts: { some: { buyer_id: assignedBuyerId } } });
      }
      
      if (campaignIds.length > 0) {
        authOrConditions.push({ campaign_id: { in: campaignIds as string[] } });
      }
      
      if (buyerIds.length > 0) {
        authOrConditions.push({ attempts: { some: { buyer_id: { in: buyerIds as string[] } } } });
      }
      
      if (phoneIds.length > 0) {
        const phoneNumbers = await this.prisma.phoneNumber.findMany({
          where: { id: { in: phoneIds as string[] } },
          select: { phone_number: true }
        });
        const numberStrings = phoneNumbers.map(n => n.phone_number);
        if (numberStrings.length > 0) {
           authOrConditions.push({ to_number: { in: numberStrings } });
        } else {
           authOrConditions.push({ id: '__invalid__' });
        }
      }
      
      if (authOrConditions.length === 0) {
        return { items: [], total: 0 };
      }
    }

    let durationIds: string[] | null = null;

    if (filters.durationType && (filters.minDurationSecs !== undefined || filters.maxDurationSecs !== undefined)) {
      const min = filters.minDurationSecs || 0;
      
      let durationSql = filters.durationType === 'talk' 
          ? Prisma.sql`EXTRACT(EPOCH FROM (ended_at - answered_at))` 
          : Prisma.sql`EXTRACT(EPOCH FROM (ended_at - started_at))`;

      let maxCondition = Prisma.sql`1=1`;
      if (filters.maxDurationSecs !== undefined) {
         maxCondition = Prisma.sql`${durationSql} <= ${filters.maxDurationSecs}`;
      }

      let notNullCondition = filters.durationType === 'talk'
          ? Prisma.sql`ended_at IS NOT NULL AND answered_at IS NOT NULL`
          : Prisma.sql`ended_at IS NOT NULL AND started_at IS NOT NULL`;

      const results = await this.prisma.$queryRaw<{id: string}[]>`
        SELECT id FROM "calls" 
        WHERE workspace_id = ${workspaceId} 
          AND ${notNullCondition}
          AND ${durationSql} >= ${min} 
          AND ${maxCondition}
      `;
      durationIds = results.map(r => r.id);
    }

    const where: any = { workspace_id: workspaceId };

    if (authOrConditions.length > 0) {
      where.AND = [{ OR: authOrConditions }];
    }

    if (durationIds !== null) {
      where.id = { in: durationIds };
    }

    if (filters.campaignId) {
      where.campaign_id = filters.campaignId;
    }
    if (filters.buyerId) {
      where.attempts = {
        some: { buyer_id: filters.buyerId },
      };
    }
    if (filters.status) {
      if (!Object.values(CallState).includes(filters.status as CallState)) {
        throw new BadRequestException(`Invalid status: ${filters.status}`);
      }
      where.state = filters.status;
    }
    if (filters.callerNumber) {
      where.from_number = { contains: filters.callerNumber };
    }
    if (filters.trackingNumber) {
      where.to_number = filters.trackingNumber;
    }
    if (filters.startDate || filters.endDate) {
      where.created_at = {};
      if (filters.startDate) {
         where.created_at.gte = new Date(`${filters.startDate}T00:00:00Z`);
      }
      if (filters.endDate) {
         const end = new Date(`${filters.endDate}T00:00:00Z`);
         end.setUTCDate(end.getUTCDate() + 1);
         where.created_at.lt = end;
      }
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
          recordings: true,
        },
        orderBy: { created_at: 'desc' },
        skip: filters.offset || 0,
        take: filters.limit || 50,
      }),
      this.prisma.call.count({ where }),
    ]);

    const mappedItems = items.map((call: any) => {
       let talkDurationSecs: number | null = null;
       let totalDurationSecs: number | null = null;
       
       if (call.ended_at && call.answered_at && call.ended_at >= call.answered_at) {
          talkDurationSecs = Math.floor((call.ended_at.getTime() - call.answered_at.getTime()) / 1000);
       }
       
       if (call.ended_at && call.started_at && call.ended_at >= call.started_at) {
          totalDurationSecs = Math.floor((call.ended_at.getTime() - call.started_at.getTime()) / 1000);
       }

       return {
          ...call,
          talkDurationSecs,
          totalDurationSecs,
          recordings: call.recordings ? call.recordings.map((r: any) => ({
             id: r.id,
             status: r.status
          })) : []
       };
    });

    return { items: mappedItems, total };
  }


  async getLiveCalls(workspaceId: string, userId: string = '') {
    const count = await this.prisma.call.count({
      where: {
        workspace_id: workspaceId,
        state: { in: ['INITIATED', 'ROUTING'] },
      },
    });
    return { liveCalls: count };
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
    userId: string = '',
    filters: { 
      startDate?: string; 
      endDate?: string;
      campaignId?: string;
      buyerId?: string;
      trackingNumber?: string;
      callerNumber?: string;
      status?: string;
      minDuration?: string;
      maxDuration?: string;
      bucket?: string;
    },
  ) {
    
    if (filters.startDate) {
      const d = new Date(filters.startDate);
      if (isNaN(d.getTime())) throw new BadRequestException('Invalid startDate');
    }
    if (filters.endDate) {
      const d = new Date(filters.endDate);
      if (isNaN(d.getTime())) throw new BadRequestException('Invalid endDate');
    }
    if (filters.startDate && filters.endDate) {
      if (new Date(filters.startDate) > new Date(filters.endDate)) {
        throw new BadRequestException('startDate cannot be after endDate');
      }
    }
    
    
    const permissions = await this.permissionsService.getPermissionsForUser(workspaceId, userId);
    const readPerms = permissions.filter((p: any) => p.key === 'call:read');
    if (readPerms.length === 0) throw new ForbiddenException('Missing call:read permission');
    const hasAll = readPerms.some((p: any) => p.scope_type === 'ALL');
    const hasAssigned = readPerms.some((p: any) => p.scope_type === 'ASSIGNED');
    
    let assignedBuyerId = null;
    if (!hasAll && hasAssigned) {
      const member = await this.prisma.workspaceMember.findUnique({ where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: userId } }});
      assignedBuyerId = member?.buyer_id;
      if (!assignedBuyerId) {
         return { total: 0, answered: 0, missed: 0, failed: 0, blocked: 0, answerRate: 0, avgDuration: 0, tclSecs: null, aclSecs: null, campaigns: {}, buyers: {}, trackingNumbers: {}, buckets: [] };
      }
    }


    const conditions = [Prisma.sql`c.workspace_id = ${workspaceId}`];
    
    if (!hasAll) {
      let authOrConditionsRaw: any[] = [];
      
      if (hasAssigned && assignedBuyerId) {
        authOrConditionsRaw.push(Prisma.sql`(c.campaign_id IN (SELECT campaign_id FROM campaign_buyers WHERE buyer_id = ${assignedBuyerId}) OR EXISTS(SELECT 1 FROM call_attempts a2 WHERE a2.call_id = c.id AND a2.buyer_id = ${assignedBuyerId}))`);
      }
      
      const campaignIds = readPerms.filter((p: any) => p.scope_type === 'CAMPAIGN' && p.resource_id).map((p: any) => p.resource_id);
      if (campaignIds.length > 0) {
        authOrConditionsRaw.push(Prisma.sql`c.campaign_id IN (${Prisma.join(campaignIds)})`);
      }
      
      const phoneIds = readPerms.filter((p: any) => p.scope_type === 'PHONE_NUMBER' && p.resource_id).map((p: any) => p.resource_id);
      if (phoneIds.length > 0) {
        authOrConditionsRaw.push(Prisma.sql`c.to_number IN (SELECT phone_number FROM phone_numbers WHERE id IN (${Prisma.join(phoneIds)}))`);
      }

      const buyerIds = readPerms.filter((p: any) => p.scope_type === 'BUYER' && p.resource_id).map((p: any) => p.resource_id);
      if (buyerIds.length > 0) {
        authOrConditionsRaw.push(Prisma.sql`EXISTS(SELECT 1 FROM call_attempts a3 WHERE a3.call_id = c.id AND a3.buyer_id IN (${Prisma.join(buyerIds)}))`);
      }

      if (authOrConditionsRaw.length === 0) {
         return { total: 0, answered: 0, missed: 0, failed: 0, blocked: 0, avgDuration: 0, tclSecs: null, aclSecs: null, campaigns: {}, buyers: {}, trackingNumbers: {}, buckets: [] };
      }
      
      conditions.push(Prisma.sql`(${Prisma.join(authOrConditionsRaw, ' OR ')})`);
    }
  
  
    if (filters.startDate) conditions.push(Prisma.sql`c.created_at >= ${new Date(filters.startDate)}`);
    if (filters.endDate) conditions.push(Prisma.sql`c.created_at <= ${new Date(filters.endDate)}`);
    if (filters.campaignId) conditions.push(Prisma.sql`c.campaign_id = ${filters.campaignId}`);
    if (filters.trackingNumber) conditions.push(Prisma.sql`c.to_number = ${filters.trackingNumber}`);
    if (filters.callerNumber) conditions.push(Prisma.sql`c.from_number = ${filters.callerNumber}`);
    if (filters.status) conditions.push(Prisma.sql`c.state = ${filters.status}::"CallState"`);
    if (filters.minDuration) conditions.push(Prisma.sql`c.duration_secs >= ${Number(filters.minDuration)}`);
    if (filters.maxDuration) conditions.push(Prisma.sql`c.duration_secs <= ${Number(filters.maxDuration)}`);
    
    if (filters.buyerId) {
      conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM call_attempts ca WHERE ca.call_id = c.id AND ca.buyer_id = ${filters.buyerId})`);
    }

    const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

    const mainQuery = Prisma.sql`
      SELECT 
        COUNT(*)::int as total,
        SUM(CASE WHEN c.state = 'COMPLETED' THEN 1 ELSE 0 END)::int as answered,
        SUM(CASE WHEN c.state IN ('NO_ANSWER', 'CANCELED') THEN 1 ELSE 0 END)::int as missed,
        SUM(CASE WHEN c.state = 'FAILED' AND NOT EXISTS (
          SELECT 1 FROM blocked_callers bc 
          WHERE bc.workspace_id = c.workspace_id AND bc.phone_number = c.from_number
        ) THEN 1 ELSE 0 END)::int as failed,
        SUM(CASE WHEN c.state = 'FAILED' AND EXISTS (
          SELECT 1 FROM blocked_callers bc 
          WHERE bc.workspace_id = c.workspace_id AND bc.phone_number = c.from_number
        ) THEN 1 ELSE 0 END)::int as blocked,
        SUM(c.duration_secs)::int as total_duration,
        SUM(CASE WHEN c.answered_at IS NOT NULL AND c.ended_at IS NOT NULL 
                 THEN EXTRACT(EPOCH FROM (c.ended_at - c.answered_at)) ELSE 0 END)::int as talk_duration,
        SUM(CASE WHEN c.ended_at IS NOT NULL AND c.started_at IS NOT NULL 
                 THEN EXTRACT(EPOCH FROM (c.ended_at - c.started_at)) ELSE 0 END)::int as tcl_secs,
        SUM(CASE WHEN c.state = 'COMPLETED' AND c.ended_at IS NOT NULL AND c.started_at IS NOT NULL THEN 1 ELSE 0 END)::int as eligible_calls,
        SUM(CASE WHEN c.state = 'COMPLETED' THEN c.duration_secs ELSE 0 END)::int as answered_duration
      FROM calls c
      ${whereClause}
    `;

    const campaignQuery = Prisma.sql`
      SELECT 
        c.campaign_id,
        camp.name as campaign_name,
        COUNT(*)::int as total,
        SUM(CASE WHEN c.state = 'COMPLETED' THEN 1 ELSE 0 END)::int as answered,
        SUM(CASE WHEN c.ended_at IS NOT NULL AND c.started_at IS NOT NULL 
                 THEN EXTRACT(EPOCH FROM (c.ended_at - c.started_at)) ELSE 0 END)::int as tcl_secs,
        SUM(CASE WHEN c.state = 'COMPLETED' AND c.ended_at IS NOT NULL AND c.started_at IS NOT NULL THEN 1 ELSE 0 END)::int as eligible_calls
      FROM calls c
      LEFT JOIN campaigns camp ON camp.id = c.campaign_id
      ${whereClause} AND c.campaign_id IS NOT NULL
      GROUP BY c.campaign_id, camp.name
    `;

    const trackingQuery = Prisma.sql`
      SELECT 
        c.to_number as phone_number,
        pn.id as tracking_number_id,
        pn.name as tracking_number_name,
        pn.number_type,
        COUNT(*)::int as total,
        SUM(CASE WHEN c.state = 'COMPLETED' THEN 1 ELSE 0 END)::int as answered
      FROM calls c
      LEFT JOIN phone_numbers pn ON pn.phone_number = c.to_number AND pn.workspace_id = c.workspace_id
      ${whereClause}
      GROUP BY c.to_number, pn.id, pn.name, pn.number_type
    `;

    const buyerConditions = [Prisma.sql`c.workspace_id = ${workspaceId}`];
    if (!hasAll && hasAssigned && assignedBuyerId) {
      buyerConditions.push(Prisma.sql`a.buyer_id = ${assignedBuyerId}`);
    }
    if (filters.startDate) buyerConditions.push(Prisma.sql`c.created_at >= ${new Date(filters.startDate)}`);
    if (filters.endDate) buyerConditions.push(Prisma.sql`c.created_at <= ${new Date(filters.endDate)}`);
    if (filters.campaignId) buyerConditions.push(Prisma.sql`c.campaign_id = ${filters.campaignId}`);
    if (filters.trackingNumber) buyerConditions.push(Prisma.sql`c.to_number = ${filters.trackingNumber}`);
    if (filters.callerNumber) buyerConditions.push(Prisma.sql`c.from_number = ${filters.callerNumber}`);
    if (filters.status) buyerConditions.push(Prisma.sql`c.state = ${filters.status}::"CallState"`);
    if (filters.minDuration) buyerConditions.push(Prisma.sql`c.duration_secs >= ${Number(filters.minDuration)}`);
    if (filters.maxDuration) buyerConditions.push(Prisma.sql`c.duration_secs <= ${Number(filters.maxDuration)}`);
    if (filters.buyerId) buyerConditions.push(Prisma.sql`a.buyer_id = ${filters.buyerId}`);

    const buyerWhere = Prisma.sql`WHERE ${Prisma.join(buyerConditions, ' AND ')} AND a.buyer_id IS NOT NULL`;

    const buyerQuery = Prisma.sql`
      SELECT 
        a.buyer_id,
        b.name as buyer_name,
        COUNT(*)::int as total,
        SUM(CASE WHEN a.state IN ('ANSWERED', 'COMPLETED') THEN 1 ELSE 0 END)::int as answered,
        SUM(CASE WHEN a.ended_at IS NOT NULL AND a.started_at IS NOT NULL 
                 THEN EXTRACT(EPOCH FROM (a.ended_at - a.started_at)) ELSE 0 END)::int as tcl_secs,
        SUM(CASE WHEN a.ended_at IS NOT NULL AND a.started_at IS NOT NULL THEN 1 ELSE 0 END)::int as eligible_attempts
      FROM call_attempts a
      JOIN calls c ON c.id = a.call_id
      LEFT JOIN buyers b ON b.id = a.buyer_id
      ${buyerWhere}
      GROUP BY a.buyer_id, b.name
    `;

    const [mainRes, campRes, buyerRes, trackingRes] = await Promise.all([
      this.prisma.$queryRaw(mainQuery) as any,
      this.prisma.$queryRaw(campaignQuery) as any,
      this.prisma.$queryRaw(buyerQuery) as any,
      this.prisma.$queryRaw(trackingQuery) as any,
    ]);

    const main = mainRes[0] || {
      total: 0, answered: 0, missed: 0, failed: 0, blocked: 0, 
      total_duration: 0, talk_duration: 0, tcl_secs: 0, eligible_calls: 0, answered_duration: 0
    };

    let buckets: any[] = [];
    if (filters.bucket) {
      const allowedBuckets = ['hour', 'day', 'week'];
      const trunc = allowedBuckets.includes(filters.bucket) ? filters.bucket : 'day';
      const tsQuery = Prisma.sql`
        SELECT 
          date_trunc(${trunc}, c.created_at) as bucket_time,
          COUNT(*)::int as total,
          SUM(CASE WHEN c.state = 'COMPLETED' THEN 1 ELSE 0 END)::int as answered,
          SUM(CASE WHEN c.state IN ('NO_ANSWER', 'CANCELED') THEN 1 ELSE 0 END)::int as missed,
          SUM(CASE WHEN c.state = 'FAILED' AND NOT EXISTS (
            SELECT 1 FROM blocked_callers bc 
            WHERE bc.workspace_id = c.workspace_id AND bc.phone_number = c.from_number
          ) THEN 1 ELSE 0 END)::int as failed,
          SUM(CASE WHEN c.state = 'FAILED' AND EXISTS (
            SELECT 1 FROM blocked_callers bc 
            WHERE bc.workspace_id = c.workspace_id AND bc.phone_number = c.from_number
          ) THEN 1 ELSE 0 END)::int as blocked
        FROM calls c
        ${whereClause}
        GROUP BY bucket_time
        ORDER BY bucket_time ASC
      `;
      buckets = await this.prisma.$queryRaw(tsQuery) as any;
    }

    const campaigns: Record<string, any> = {};
    for (const row of campRes) {
      campaigns[row.campaign_id] = {
        id: row.campaign_id,
        name: row.campaign_name,
        total: row.total || 0,
        answered: row.answered || 0,
        tclSecs: row.tcl_secs || 0,
        aclSecs: row.eligible_calls > 0 ? Math.round(row.tcl_secs / row.eligible_calls) : null,
      };
    }

    const buyers: Record<string, any> = {};
    for (const row of buyerRes) {
      buyers[row.buyer_id] = {
        id: row.buyer_id,
        name: row.buyer_name,
        total: row.total || 0,
        answered: row.answered || 0,
        tclSecs: row.tcl_secs || 0,
        aclSecs: row.eligible_attempts > 0 ? Math.round(row.tcl_secs / row.eligible_attempts) : null,
      };
    }
    
    const trackingNumbers: Record<string, any> = {};
    for (const row of trackingRes) {
      trackingNumbers[row.phone_number] = {
        id: row.tracking_number_id,
        phone_number: row.phone_number,
        name: row.tracking_number_name,
        number_type: row.number_type,
        total: row.total || 0,
        answered: row.answered || 0,
      };
    }

    const totalCalls = main.total || 0;
    const answeredCalls = main.answered || 0;
    const answerRate = totalCalls > 0 ? Number(((answeredCalls / totalCalls) * 100).toFixed(2)) : 0;

    const metrics = {
      total: totalCalls,
      answered: answeredCalls,
      missed: main.missed || 0,
      failed: main.failed || 0,
      blocked: main.blocked || 0,
      answerRate,
      avgDuration: answeredCalls > 0 ? Math.round((main.answered_duration || 0) / answeredCalls) : 0,
      tclSecs: main.eligible_calls > 0 ? (main.tcl_secs || 0) : null,
      aclSecs: main.eligible_calls > 0 ? Math.round((main.tcl_secs || 0) / main.eligible_calls) : null,
      campaigns,
      buyers,
      trackingNumbers,
      buckets: buckets.map(b => ({
        time: b.bucket_time,
        total: b.total || 0,
        answered: b.answered || 0,
        missed: b.missed || 0,
        failed: b.failed || 0,
        blocked: b.blocked || 0
      }))
    };

    return metrics;
  }

  async commitBuyerDial(attemptId: string, providerCallId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const initialAttempt = await tx.callAttempt.findUnique({ where: { id: attemptId } });
      if (!initialAttempt) return true; // if attempt missing, hangup

      await tx.$queryRaw`SELECT id FROM "calls" WHERE id = ${initialAttempt.call_id} FOR UPDATE`;
      const call = await tx.call.findUnique({ where: { id: initialAttempt.call_id } });

      if (!call || call.state !== CallState.ROUTING) {
        await tx.callAttempt.update({
          where: { id: attemptId },
          data: { provider_call_id: providerCallId, state: CallAttemptState.CANCELED },
        });
        return true;
      }

      await tx.callAttempt.update({
        where: { id: attemptId },
        data: { provider_call_id: providerCallId },
      });
      return false;
    });
  }

  async prepareNextBuyer(callId: string): Promise<{
    action: 'HANGUP' | 'DIAL' | 'NONE';
    call?: any;
    attempt?: any;
    buyer?: any;
  }> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "calls" WHERE id = ${callId} FOR UPDATE`;
      const call = await tx.call.findUnique({
        where: { id: callId },
        include: { attempts: true },
      });

      if (!call || call.state !== CallState.ROUTING) {
        return { action: 'NONE' };
      }

      const activeAttempt = call.attempts.find(
        (a) =>
          a.state === CallAttemptState.INITIATED ||
          a.state === CallAttemptState.RINGING,
      );
      if (activeAttempt) {
        return { action: 'NONE' }; // Already dialing someone concurrently
      }

      if (!call.campaign_id) {
        const updatedCall = await tx.call.update({
          where: { id: callId },
          data: { state: CallState.FAILED },
        });
        return { action: 'HANGUP', call: updatedCall };
      }

      const campaign = await tx.campaign.findUnique({
        where: { id: call.campaign_id },
        include: {
          buyers: {
            where: { status: 'ACTIVE', buyer: { status: 'ACTIVE' } },
            orderBy: { priority: 'asc' },
            include: { buyer: true },
          },
        },
      });

      if (!campaign || campaign.status !== 'ACTIVE' || campaign.buyers.length === 0) {
        const hasAttempts = call.attempts && call.attempts.length > 0;
        const updatedCall = await tx.call.update({
          where: { id: callId },
          data: { state: hasAttempts ? CallState.NO_ANSWER : CallState.FAILED },
        });
        return { action: 'HANGUP', call: updatedCall };
      }

      const attemptedBuyerIds = new Set(call.attempts.map((a: any) => a.buyer_id));
      const nextCampaignBuyer = campaign.buyers.find(
        (cb) => !attemptedBuyerIds.has(cb.buyer_id),
      );

      if (!nextCampaignBuyer) {
        const updatedCall = await tx.call.update({
          where: { id: callId },
          data: { state: CallState.NO_ANSWER },
        });
        return { action: 'HANGUP', call: updatedCall };
      }

      const attempt = await tx.callAttempt.create({
        data: {
          call_id: call.id,
          buyer_id: nextCampaignBuyer.buyer_id,
          state: CallAttemptState.INITIATED,
        },
      });

      // Fire webhook
      this.webhooksService
        .queueEvent(call.workspace_id, 'call.attempt.started', attempt)
        .catch(console.error);

      return { action: 'DIAL', call, attempt, buyer: nextCampaignBuyer.buyer };
    });
  }
}
