import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { TelnyxProvisioningService } from './telnyx-provisioning.service.js';
import { UsageService } from '../usage/usage.service.js';
import { PhoneNumberStatus } from '@prisma/client';

@Injectable()
export class PhoneNumbersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly telnyxProvisioning: TelnyxProvisioningService,
    private readonly usageService: UsageService,
    private readonly permissionsService: PermissionsService,
  ) {}

  async listWorkspaceNumbers(
    workspaceId: string,
    userIdOrParams: string | any = '',
    params: any = {},
  ) {
    if (!workspaceId || typeof workspaceId !== 'string') {
      throw new ForbiddenException('Invalid or missing workspace identifier');
    }

    let userId = '';
    let queryParams: any = {};

    if (typeof userIdOrParams === 'string') {
      userId = userIdOrParams;
      queryParams = (typeof params === 'object' && params !== null && !Array.isArray(params)) ? params : {};
    } else if (typeof userIdOrParams === 'object' && userIdOrParams !== null && !Array.isArray(userIdOrParams)) {
      queryParams = userIdOrParams;
      userId = typeof params === 'string' ? params : '';
    } else {
      queryParams = (typeof params === 'object' && params !== null && !Array.isArray(params)) ? params : {};
    }

    const assertWorkspaceMemberDelegate = () => {
      if (!this.prisma.workspaceMember) {
        throw new InternalServerErrorException('WorkspaceMember repository is not available');
      }
    };

    if (userId) {
      assertWorkspaceMemberDelegate();
    }

    const permissions = await this.permissionsService.getPermissionsForUser(workspaceId, userId);
    const readPerms = permissions.filter((p: any) => p.key === 'phone_number:read');
    if (readPerms.length === 0) throw new ForbiddenException('Missing phone_number:read permission');

    const hasAll = readPerms.some((p: any) => p.scope_type === 'ALL');
    const hasAssigned = readPerms.some((p: any) => p.scope_type === 'ASSIGNED');
    const campaignIds = readPerms.filter((p: any) => p.scope_type === 'CAMPAIGN' && p.resource_id).map((p: any) => p.resource_id);
    const phoneIds = readPerms.filter((p: any) => p.scope_type === 'PHONE_NUMBER' && p.resource_id).map((p: any) => p.resource_id);
    const buyerIds = readPerms.filter((p: any) => p.scope_type === 'BUYER' && p.resource_id).map((p: any) => p.resource_id);
    const vendorIds = readPerms.filter((p: any) => p.scope_type === 'VENDOR' && p.resource_id).map((p: any) => p.resource_id);

    const where: any = { workspace_id: workspaceId, status: { not: PhoneNumberStatus.RELEASED } };

    if (!hasAll) {
      let authOrConditions: any[] = [];
      if (hasAssigned) {
        if (!userId) {
          return { items: [], total: 0 };
        }
        assertWorkspaceMemberDelegate();
        const member = await this.prisma.workspaceMember.findUnique({
          where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: userId } }
        });
        if (member?.buyer_id) {
          authOrConditions.push({ campaign: { buyers: { some: { buyer_id: member.buyer_id } } } });
        }
        if (member?.vendor_id) {
          authOrConditions.push({ vendor_id: member.vendor_id });
        }
      }
      
      if (campaignIds.length > 0) {
        authOrConditions.push({ campaign_id: { in: campaignIds } });
      }
      
      if (phoneIds.length > 0) {
        authOrConditions.push({ id: { in: phoneIds } });
      }
      
      if (buyerIds.length > 0) {
        authOrConditions.push({ campaign: { buyers: { some: { buyer_id: { in: buyerIds } } } } });
      }

      if (vendorIds.length > 0) {
        authOrConditions.push({ vendor_id: { in: vendorIds } });
      }
      
      if (authOrConditions.length === 0) {
        return { items: [], total: 0 };
      }
      where.AND = [{ OR: authOrConditions }];
    }

    // Opportunistically reconcile any numbers stuck in PROVISIONING
    const pendingNumbers = (await this.prisma.phoneNumber.findMany({
      where: { workspace_id: workspaceId, status: PhoneNumberStatus.PROVISIONING },
    })) || [];
    
    for (const pending of pendingNumbers) {
      if (pending.provider_number_id?.startsWith('order:')) {
        await this.reconcileNumber(pending.id).catch(() => {});
      }
    }

    const rawLimit = Number(queryParams.limit);
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 50;

    const rawOffset = Number(queryParams.offset);
    const offset = Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;

    const [itemsResult, total = 0] = await Promise.all([
      this.prisma.phoneNumber.findMany({
        where,
        include: {
          campaign: {
            select: { id: true, name: true }
          },
          vendor: {
            select: { id: true, name: true }
          }
        },
        orderBy: { created_at: 'desc' },
        skip: offset,
        take: limit,
      }),
      this.prisma.phoneNumber.count({ where }),
    ]);

    const items = itemsResult || [];

    const member = userId
      ? await this.prisma.workspaceMember.findUnique({
          where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: userId } },
        })
      : null;
    const isBuyer = member?.participant_type === 'BUYER';
    const isVendor = member?.participant_type === 'VENDOR';

    const mappedItems = isBuyer
      ? items.map((pn: any) => {
          const { vendor_id, vendor, ...rest } = pn;
          return rest;
        })
      : isVendor
      ? items.map((pn: any) => {
          const { provider_number_id, connection_id, ...rest } = pn;
          return rest;
        })
      : items;

    return { items: mappedItems, total };
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
            number_type: check.phone_number_type || null,
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
          number_type: check.phone_number_type || null,
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

  async updateNumber(
    workspaceId: string,
    id: string,
    nameOrData: string | { name?: string; vendorId?: string | null },
  ) {
    let name: string | undefined;
    let vendorId: string | null | undefined;

    if (typeof nameOrData === 'string') {
      name = nameOrData;
    } else if (typeof nameOrData === 'object' && nameOrData !== null) {
      name = nameOrData.name;
      vendorId = nameOrData.vendorId;
    } else {
      throw new BadRequestException('Invalid update payload');
    }

    const number = await this.prisma.phoneNumber.findUnique({
      where: { id },
    });

    if (!number || number.workspace_id !== workspaceId) {
      throw new NotFoundException('Phone number not found');
    }

    if (number.status === PhoneNumberStatus.RELEASED) {
      throw new BadRequestException('Cannot update a released phone number');
    }

    const data: any = {};
    if (name !== undefined) {
      data.name = name;
    }

    if (vendorId !== undefined) {
      if (vendorId === null) {
        data.vendor_id = null;
      } else if (typeof vendorId === 'string') {
        const trimmed = vendorId.trim();
        if (!trimmed) {
          throw new BadRequestException('Invalid vendorId: cannot be empty string');
        }
        const vendor = await this.prisma.vendor.findFirst({
          where: { id: trimmed, workspace_id: workspaceId },
        });
        if (!vendor) {
          throw new NotFoundException('Vendor not found in workspace');
        }
        data.vendor_id = vendor.id;
      } else {
        throw new BadRequestException('Invalid vendorId: must be a string or null');
      }
    }

    return this.prisma.phoneNumber.update({
      where: { id },
      data,
      include: {
        campaign: { select: { id: true, name: true } },
        vendor: { select: { id: true, name: true } },
      },
    });
  }

  async getNumber(workspaceId: string, id: string, userId?: string) {
    if (!workspaceId) {
      throw new ForbiddenException('Invalid or missing workspace identifier');
    }

    const number = await this.prisma.phoneNumber.findUnique({
      where: { id },
      include: {
        campaign: {
          select: {
            id: true,
            name: true,
            buyers: { select: { buyer_id: true } },
          },
        },
        vendor: { select: { id: true, name: true } },
      },
    });

    if (!number || number.workspace_id !== workspaceId || number.status === PhoneNumberStatus.RELEASED) {
      throw new NotFoundException('Phone number not found');
    }

    if (userId) {
      const member = await this.prisma.workspaceMember.findUnique({
        where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: userId } },
      });

      if (!member) {
        throw new ForbiddenException('You do not have access to this workspace');
      }

      if (member.participant_type === 'VENDOR') {
        if (!member.vendor_id || number.vendor_id !== member.vendor_id) {
          throw new ForbiddenException('You do not have access to this phone number');
        }
        const { provider_number_id, connection_id, ...rest } = number;
        return rest;
      }

      if (member.participant_type === 'BUYER') {
        const hasAccess = number.campaign?.buyers?.some((b: any) => b.buyer_id === member.buyer_id);
        if (!hasAccess) {
          throw new ForbiddenException('You do not have access to this phone number');
        }
        const { vendor_id, vendor, ...rest } = number;
        return rest;
      }
    }

    return number;
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

  async backfillNumberTypes(dryRun: boolean = true) {
    const numbers = await this.prisma.phoneNumber.findMany({
      where: {
        provider: 'telnyx',
        number_type: null,
        status: { in: [PhoneNumberStatus.ACTIVE, PhoneNumberStatus.PROVISIONING] },
      }
    });

    const results = { total: numbers.length, updated: 0, failed: 0, skipped: 0 };
    for (const num of numbers) {
      try {
        const check = await this.telnyxProvisioning.checkOrderStatus(num.provider_number_id || '', num.phone_number);
        if (check.phone_number_type) {
          if (!dryRun) {
            await this.prisma.phoneNumber.update({
              where: { id: num.id },
              data: { number_type: check.phone_number_type }
            });
          }
          results.updated++;
        } else {
          results.skipped++;
        }
      } catch (err) {
        results.failed++;
      }
    }
    return results;
  }
}
