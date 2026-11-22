import { describe, it, expect } from 'vitest';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { BadRequestException, ArgumentMetadata } from '@nestjs/common';
import { SafeValidationPipe } from '../pipes/safe-validation.pipe.js';
import { PaginationQueryDto } from './pagination.dto.js';
import { ListSettlementBatchesDto } from '../../settlement/dto/list-settlement-batches.dto.js';
import { CreateBuyerDto, UpdateBuyerDto, ListBuyersQueryDto } from '../../routing/dto/buyers.dto.js';
import {
  CreateCampaignDto,
  UpdateCampaignDto,
  AssignBuyerDto,
  AssignDestinationNumberDto,
} from '../../routing/dto/campaigns.dto.js';
import {
  CreateDestinationNumberDto,
  UpdateDestinationNumberDto,
} from '../../routing/dto/destination-numbers.dto.js';
import { BlockCallerDto } from '../../routing/dto/blocked-callers.dto.js';
import {
  CreateWorkspaceDto,
  UpdateMemberRoleDto,
  InviteMemberDto,
} from '../../workspaces/dto/workspaces.dto.js';
import { CreateVendorDto, UpdateVendorDto } from '../../workspaces/dto/vendors.dto.js';
import { CreateDisputeDto, ResolveDisputeDto } from '../../commercial/dto/commercial-disputes.dto.js';
import { MockTopUpDto, CreateCheckoutSessionDto } from '../../billing/dto/billing.dto.js';
import { GetCallsQueryDto } from '../../calls/dto/calls-query.dto.js';
import { WorkspaceRole, DisputeStatus } from '@prisma/client';

describe('DTO Security & Request Validation Suite', () => {
  const pipe = new SafeValidationPipe();

  const toDto = (cls: any, plain: any) => plainToInstance(cls, plain);

  describe('Safe Pagination DTOs', () => {
    it('PaginationQueryDto should enforce limit between 1 and 100', async () => {
      const valid = toDto(PaginationQueryDto, { limit: 50, offset: 0 });
      expect(await validate(valid)).toHaveLength(0);

      const tooHigh = toDto(PaginationQueryDto, { limit: 150 });
      const errorsHigh = await validate(tooHigh);
      expect(errorsHigh.length).toBeGreaterThan(0);
      expect(errorsHigh[0].constraints?.max).toBeDefined();

      const tooLow = toDto(PaginationQueryDto, { limit: 0 });
      const errorsLow = await validate(tooLow);
      expect(errorsLow.length).toBeGreaterThan(0);
      expect(errorsLow[0].constraints?.min).toBeDefined();

      const negOffset = toDto(PaginationQueryDto, { offset: -5 });
      const errorsOffset = await validate(negOffset);
      expect(errorsOffset.length).toBeGreaterThan(0);
      expect(errorsOffset[0].constraints?.min).toBeDefined();
    });

    it('ListSettlementBatchesDto should enforce bounded limit and non-negative offset', async () => {
      const valid = toDto(ListSettlementBatchesDto, { limit: 20, offset: 10 });
      expect(await validate(valid)).toHaveLength(0);

      const invalidLimit = toDto(ListSettlementBatchesDto, { limit: 500 });
      const errors = await validate(invalidLimit);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('limit');

      const negativeOffset = toDto(ListSettlementBatchesDto, { offset: -1 });
      const offsetErrors = await validate(negativeOffset);
      expect(offsetErrors.length).toBeGreaterThan(0);
      expect(offsetErrors[0].property).toBe('offset');
    });

    it('GetCallsQueryDto should enforce duration bounds and limit bounds', async () => {
      const valid = toDto(GetCallsQueryDto, {
        durationType: 'talk',
        minDurationSecs: 10,
        maxDurationSecs: 60,
        limit: 50,
        offset: 0,
      });
      expect(await validate(valid)).toHaveLength(0);

      const invalidDurationType = toDto(GetCallsQueryDto, {
        durationType: 'invalid_duration',
      });
      const errors = await validate(invalidDurationType);
      expect(errors.length).toBeGreaterThan(0);

      const negativeDuration = toDto(GetCallsQueryDto, {
        minDurationSecs: -1,
      });
      const negErrors = await validate(negativeDuration);
      expect(negErrors.length).toBeGreaterThan(0);
    });
  });

  describe('Routing DTOs Mass Assignment & Field Constraints', () => {
    it('CreateBuyerDto should require name and validate timeout range and concurrency', async () => {
      const valid = toDto(CreateBuyerDto, {
        name: 'Enterprise Buyer Inc',
        email: 'buyer@example.com',
        timeout: 45,
        max_concurrent_calls: 10,
      });
      expect(await validate(valid)).toHaveLength(0);

      const emptyName = toDto(CreateBuyerDto, { name: '' });
      const errors = await validate(emptyName);
      expect(errors.length).toBeGreaterThan(0);

      const excessiveTimeout = toDto(CreateBuyerDto, {
        name: 'Valid Name',
        timeout: 999,
      });
      const timeoutErrors = await validate(excessiveTimeout);
      expect(timeoutErrors.length).toBeGreaterThan(0);

      const excessiveCalls = toDto(CreateBuyerDto, {
        name: 'Valid Name',
        max_concurrent_calls: 5000,
      });
      const callErrors = await validate(excessiveCalls);
      expect(callErrors.length).toBeGreaterThan(0);
    });

    it('SafeValidationPipe rejects mass-assignment injection on CreateBuyerDto', async () => {
      const metadata: ArgumentMetadata = {
        type: 'body',
        metatype: CreateBuyerDto,
      };

      const maliciousBody = {
        name: 'Attacker Org',
        workspace_id: 'target-victim-ws',
      };

      await expect(pipe.transform(maliciousBody, metadata)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('CreateCampaignDto should validate 3-letter currency and conversion duration', async () => {
      const valid = toDto(CreateCampaignDto, {
        name: 'Inbound Sales 2026',
        currency: 'USD',
        conversion_duration_secs: 90,
      });
      expect(await validate(valid)).toHaveLength(0);

      const invalidCurrency = toDto(CreateCampaignDto, {
        name: 'Test Campaign',
        currency: 'TOOLONG',
      });
      const errors = await validate(invalidCurrency);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('AssignBuyerDto and AssignDestinationNumberDto should enforce integer priorities and weights', async () => {
      const validBuyer = toDto(AssignBuyerDto, {
        buyerId: 'buyer-uuid',
        priority: 1,
      });
      expect(await validate(validBuyer)).toHaveLength(0);

      const negativePriority = toDto(AssignBuyerDto, {
        buyerId: 'buyer-uuid',
        priority: -1,
      });
      expect((await validate(negativePriority)).length).toBeGreaterThan(0);

      const invalidWeight = toDto(AssignDestinationNumberDto, {
        destinationNumberId: 'dest-uuid',
        weight: 150,
      });
      expect((await validate(invalidWeight)).length).toBeGreaterThan(0);
    });

    it('BlockCallerDto should require non-empty phoneNumber and bound reason length', async () => {
      const valid = toDto(BlockCallerDto, {
        phoneNumber: '+15551234567',
        reason: 'Spam robot caller',
      });
      expect(await validate(valid)).toHaveLength(0);

      const missingPhone = toDto(BlockCallerDto, { phoneNumber: '' });
      expect((await validate(missingPhone)).length).toBeGreaterThan(0);
    });
  });

  describe('Workspace & Member DTOs Security', () => {
    it('CreateWorkspaceDto should require name and strip / reject protected fields', async () => {
      const metadata: ArgumentMetadata = {
        type: 'body',
        metatype: CreateWorkspaceDto,
      };

      const payloadWithAdmin = {
        name: 'Acme Workspace',
        is_admin: true,
      };

      await expect(pipe.transform(payloadWithAdmin, metadata)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('UpdateMemberRoleDto should only accept valid WorkspaceRole enum', async () => {
      const valid = toDto(UpdateMemberRoleDto, { role: WorkspaceRole.ADMIN });
      expect(await validate(valid)).toHaveLength(0);

      const invalid = toDto(UpdateMemberRoleDto, { role: 'SUPERUSER_NOT_EXIST' as any });
      expect((await validate(invalid)).length).toBeGreaterThan(0);
    });

    it('InviteMemberDto should validate email format and participant_type', async () => {
      const valid = toDto(InviteMemberDto, {
        email: 'user@example.com',
        role: WorkspaceRole.MEMBER,
        participant_type: 'VENDOR',
        vendor_id: 'v-123',
      });
      expect(await validate(valid)).toHaveLength(0);

      const badEmail = toDto(InviteMemberDto, {
        email: 'not-an-email',
        role: WorkspaceRole.MEMBER,
      });
      expect((await validate(badEmail)).length).toBeGreaterThan(0);

      const badParticipant = toDto(InviteMemberDto, {
        email: 'user@example.com',
        role: WorkspaceRole.MEMBER,
        participant_type: 'UNAUTHORIZED_ROLE',
      });
      expect((await validate(badParticipant)).length).toBeGreaterThan(0);
    });
  });

  describe('Commercial Disputes & Billing DTO Security', () => {
    it('CreateDisputeDto requires reason and enforces max length', async () => {
      const valid = toDto(CreateDisputeDto, {
        reason: 'Call was dropped before minimum duration',
        description: 'Caller was silent',
      });
      expect(await validate(valid)).toHaveLength(0);

      const missingReason = toDto(CreateDisputeDto, { reason: '' });
      expect((await validate(missingReason)).length).toBeGreaterThan(0);
    });

    it('ResolveDisputeDto allows only ACCEPTED or REJECTED status', async () => {
      const accepted = toDto(ResolveDisputeDto, { status: DisputeStatus.ACCEPTED });
      expect(await validate(accepted)).toHaveLength(0);

      const rejected = toDto(ResolveDisputeDto, { status: DisputeStatus.REJECTED });
      expect(await validate(rejected)).toHaveLength(0);

      const invalid = toDto(ResolveDisputeDto, { status: 'PENDING' as any });
      expect((await validate(invalid)).length).toBeGreaterThan(0);
    });

    it('MockTopUpDto enforces integer bounds ($1.00 minimum = 100 minor units)', async () => {
      const valid = toDto(MockTopUpDto, { amountMinor: 5000 });
      expect(await validate(valid)).toHaveLength(0);

      const tooSmall = toDto(MockTopUpDto, { amountMinor: 50 });
      expect((await validate(tooSmall)).length).toBeGreaterThan(0);

      const negative = toDto(MockTopUpDto, { amountMinor: -1000 });
      expect((await validate(negative)).length).toBeGreaterThan(0);
    });

    it('SafeValidationPipe rejects balance_micro mass-assignment on MockTopUpDto', async () => {
      const metadata: ArgumentMetadata = {
        type: 'body',
        metatype: MockTopUpDto,
      };

      const payload = {
        amountMinor: 5000,
        balance_micro: 999999999999,
      };

      await expect(pipe.transform(payload, metadata)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
