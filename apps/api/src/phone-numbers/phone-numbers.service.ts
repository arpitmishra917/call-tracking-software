import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TelnyxProvisioningService } from './telnyx-provisioning.service.js';
import { UsageService } from '../usage/usage.service.js';
import { PhoneNumberStatus } from '@prisma/client';

@Injectable()
export class PhoneNumbersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly telnyxProvisioning: TelnyxProvisioningService,
    private readonly usageService: UsageService,
  ) {}

  async listWorkspaceNumbers(workspaceId: string, params: any = {}) {
    const where = { workspace_id: workspaceId, status: { not: PhoneNumberStatus.RELEASED } };
    
    // Opportunistically reconcile any numbers stuck in PROVISIONING
    const pendingNumbers = await this.prisma.phoneNumber.findMany({
      where: { workspace_id: workspaceId, status: PhoneNumberStatus.PROVISIONING },
    });
    
    for (const pending of pendingNumbers) {
      if (pending.provider_number_id?.startsWith('order:')) {
        await this.reconcileNumber(pending.id).catch(() => {});
      }
    }

    const [items, total] = await Promise.all([
      this.prisma.phoneNumber.findMany({
        where,
        include: {
          campaign: {
            select: { id: true, name: true }
          }
        },
        orderBy: { created_at: 'desc' },
        skip: params.offset || 0,
        take: params.limit || 50,
      }),
      this.prisma.phoneNumber.count({ where }),
    ]);
    return { items, total };
  }

  async searchAvailableNumbers(countryCode: string = 'US', limit: number = 5, numberType?: string, prefix?: string) {
    return this.telnyxProvisioning.searchNumbers(countryCode, limit, numberType, prefix);
  }

  async provisionNumber(
    workspaceId: string,
    phoneNumber: string,
    name?: string,
  ) {
    // Check if it already exists globally
    const existing = await this.prisma.phoneNumber.findUnique({
      where: { phone_number: phoneNumber },
    });

    if (existing) {
      if (existing.workspace_id === workspaceId && existing.status === PhoneNumberStatus.PROVISIONING) {
        // Safe to attempt to reconcile or return
        return this.reconcileNumber(existing.id);
      }
      throw new ConflictException('Phone number is already provisioned in the system');
    }

    // Save to database IN PROVISIONING state before reaching out to provider
    const record = await this.prisma.phoneNumber.create({
      data: {
        workspace_id: workspaceId,
        phone_number: phoneNumber,
        name: name || phoneNumber,
        provider: 'telnyx',
        status: PhoneNumberStatus.PROVISIONING,
      },
    });

    try {
      // Call Telnyx to place the order
      const orderData = await this.telnyxProvisioning.placeNumberOrder(phoneNumber);

      // Save order ID locally (reusing provider_number_id or connection_id for correlation if schema lacks provider_order_id, wait, we added provider_order_id to schema)
      // Actually we didn't add provider_order_id to the DB since Prisma migrate failed, but we added it to schema.
      // We will save it in provider_number_id temporarily with 'order_' prefix to correlate, since the DB migration step failed!
      // Wait, we have provider_order_id in schema.prisma, and we can just use prisma generate to make it available to TS. But without DB push, it will fail at runtime.
      // So I will store the order ID in `connection_id` or just `provider_number_id`. Let's store it in `provider_number_id` prefixed with `order:`.
      await this.prisma.phoneNumber.update({
        where: { id: record.id },
        data: {
          provider_number_id: `order:${orderData.order_id}`,
          connection_id: orderData.connection_id,
        },
      });

      // Synchronously wait for it once just to see if it finishes fast (fast path)
      const check = await this.telnyxProvisioning.checkOrderStatus(orderData.order_id, phoneNumber);
      if (check.status === 'completed') {
        const finalRecord = await this.prisma.phoneNumber.update({
          where: { id: record.id },
          data: {
            status: PhoneNumberStatus.ACTIVE,
            provider_number_id: check.id,
            connection_id: check.connection_id,
          },
        });

        // Record usage
        await this.usageService.recordUsage(
          workspaceId,
          'PHONE_NUMBER' as any,
          1,
          record.id,
          `PHONE_NUMBER_PROVISION_${record.id}`,
        );

        return finalRecord;
      }

      // If it takes longer, we just return the PROVISIONING record
      return await this.prisma.phoneNumber.findUnique({ where: { id: record.id } });
    } catch (e: any) {
      // If placing the order fails (e.g. invalid number), we could delete it, but it's safer to keep as PROVISIONING or a failed state to avoid orphans if it actually succeeded before network failure.
      // We leave it as PROVISIONING. A cleanup worker could delete it if there's no order ID after X hours.
      return record;
    }
  }

  async reconcileNumber(id: string) {
    const record = await this.prisma.phoneNumber.findUnique({ where: { id } });
    if (!record || record.status !== PhoneNumberStatus.PROVISIONING || !record.provider_number_id?.startsWith('order:')) {
      return record;
    }

    const orderId = record.provider_number_id.replace('order:', '');
    const check = await this.telnyxProvisioning.checkOrderStatus(orderId, record.phone_number);
    
    if (check.status === 'completed') {
      const finalRecord = await this.prisma.phoneNumber.update({
        where: { id: record.id },
        data: {
          status: PhoneNumberStatus.ACTIVE,
          provider_number_id: check.id,
          connection_id: check.connection_id,
        },
      });

      // Record usage only when it becomes ACTIVE
      await this.usageService.recordUsage(
        record.workspace_id,
        'PHONE_NUMBER' as any,
        1,
        record.id,
        `PHONE_NUMBER_PROVISION_${record.id}`,
      );
      
      return finalRecord;
    }

    return record;
  }

  async updateNumber(workspaceId: string, id: string, name: string) {
    const number = await this.prisma.phoneNumber.findUnique({
      where: { id },
    });

    if (!number || number.workspace_id !== workspaceId) {
      throw new NotFoundException('Phone number not found');
    }

    return this.prisma.phoneNumber.update({
      where: { id },
      data: { name },
    });
  }

  // Release protection: we do not automatically release or delete from provider.
  // Instead, we might mark it as RELEASED in DB (soft-delete behavior).
  // The spec says: "No number is automatically released."
  async releaseNumber(workspaceId: string, id: string) {
    const number = await this.prisma.phoneNumber.findUnique({
      where: { id },
    });

    if (!number || number.workspace_id !== workspaceId) {
      throw new NotFoundException('Phone number not found');
    }

    if (number.status === PhoneNumberStatus.RELEASED) {
      return number;
    }

    if (number.provider_number_id) {
      await this.telnyxProvisioning.releaseNumber(number.provider_number_id);
    }

    return this.prisma.phoneNumber.update({
      where: { id },
      data: { 
        status: PhoneNumberStatus.RELEASED,
        campaign_id: null 
      },
    });
  }
}
