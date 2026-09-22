var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Injectable, NotFoundException, ConflictException, } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TelnyxProvisioningService } from './telnyx-provisioning.service.js';
import { UsageService } from '../usage/usage.service.js';
import { PhoneNumberStatus } from '@prisma/client';
let PhoneNumbersService = class PhoneNumbersService {
    prisma;
    telnyxProvisioning;
    usageService;
    constructor(prisma, telnyxProvisioning, usageService) {
        this.prisma = prisma;
        this.telnyxProvisioning = telnyxProvisioning;
        this.usageService = usageService;
    }
    async listWorkspaceNumbers(workspaceId) {
        return this.prisma.phoneNumber.findMany({
            where: { workspace_id: workspaceId },
            orderBy: { created_at: 'desc' },
        });
    }
    async searchAvailableNumbers(countryCode = 'US', limit = 5) {
        return this.telnyxProvisioning.searchNumbers(countryCode, limit);
    }
    async provisionNumber(workspaceId, phoneNumber, name) {
        const existing = await this.prisma.phoneNumber.findUnique({
            where: { phone_number: phoneNumber },
        });
        if (existing) {
            throw new ConflictException('Phone number is already provisioned in the system');
        }
        const provisionedData = await this.telnyxProvisioning.provisionNumber(phoneNumber);
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
        await this.usageService.recordUsage(workspaceId, 'PHONE_NUMBER', 1, created.id, `PHONE_NUMBER_PROVISION_${created.id}`);
        return created;
    }
    async updateNumber(workspaceId, id, name) {
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
    async releaseNumber(workspaceId, id) {
        const number = await this.prisma.phoneNumber.findUnique({
            where: { id },
        });
        if (!number || number.workspace_id !== workspaceId) {
            throw new NotFoundException('Phone number not found');
        }
        return this.prisma.phoneNumber.update({
            where: { id },
            data: { status: PhoneNumberStatus.RELEASED },
        });
    }
};
PhoneNumbersService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [PrismaService,
        TelnyxProvisioningService,
        UsageService])
], PhoneNumbersService);
export { PhoneNumbersService };
//# sourceMappingURL=phone-numbers.service.js.map