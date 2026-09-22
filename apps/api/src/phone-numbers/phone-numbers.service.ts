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

  async listWorkspaceNumbers(workspaceId: string) {
    return this.prisma.phoneNumber.findMany({
      where: { workspace_id: workspaceId },
      orderBy: { created_at: 'desc' },
    });
  }

  async searchAvailableNumbers(countryCode: string = 'US', limit: number = 5) {
    return this.telnyxProvisioning.searchNumbers(countryCode, limit);
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
      throw new ConflictException(
        'Phone number is already provisioned in the system',
      );
    }

    // Call Telnyx to provision
    const provisionedData =
      await this.telnyxProvisioning.provisionNumber(phoneNumber);

    // Save to database
    const created = await this.prisma.phoneNumber.create({
      data: {
        workspace_id: workspaceId,
        phone_number: provisionedData.phone_number,
        name: name || provisionedData.phone_number,
        provider: 'telnyx',
        provider_number_id: provisionedData.id,
        connection_id: provisionedData.connection_id,
        status: PhoneNumberStatus.ACTIVE,
      },
    });

    // Record usage
    await this.usageService.recordUsage(
      workspaceId,
      'PHONE_NUMBER' as any,
      1,
      created.id,
      `PHONE_NUMBER_PROVISION_${created.id}`,
    );

    return created;
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

    // Only mark status as RELEASED, do not call telnyx to delete.
    return this.prisma.phoneNumber.update({
      where: { id },
      data: { status: PhoneNumberStatus.RELEASED },
    });
  }
}
