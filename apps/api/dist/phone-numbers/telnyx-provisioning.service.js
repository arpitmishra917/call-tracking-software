var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var TelnyxProvisioningService_1;
import { Injectable, Logger, InternalServerErrorException, BadRequestException, } from '@nestjs/common';
import Telnyx from 'telnyx';
let TelnyxProvisioningService = TelnyxProvisioningService_1 = class TelnyxProvisioningService {
    logger = new Logger(TelnyxProvisioningService_1.name);
    telnyxClient;
    constructor() {
        const apiKey = process.env.TELNYX_API_KEY;
        if (apiKey) {
            const telnyxFactory = Telnyx;
            this.telnyxClient = new telnyxFactory(apiKey);
        }
        else {
            this.logger.warn('TELNYX_API_KEY not provided. Running in mock provisioning mode.');
        }
    }
    async searchNumbers(countryCode = 'US', limit = 5) {
        if (!this.telnyxClient) {
            return Array.from({ length: limit }).map((_, i) => ({
                phone_number: `+1555000${1000 + i}`,
                national_destination_code: '555',
                locality: 'Mock City',
                administrative_area: 'NY',
            }));
        }
        try {
            const response = await this.telnyxClient.availablePhoneNumbers.list({
                filter: {
                    country_code: countryCode,
                    limit,
                    features: ['voice'],
                },
            });
            return response.data;
        }
        catch (error) {
            this.logger.error('Error searching Telnyx numbers', error);
            throw new InternalServerErrorException('Failed to search phone numbers');
        }
    }
    async provisionNumber(phoneNumber, connectionId) {
        const targetConnection = connectionId || process.env.TELNYX_CALL_CONTROL_APP_ID;
        if (!targetConnection) {
            throw new InternalServerErrorException('Telnyx Call Control Application ID is not configured.');
        }
        if (!this.telnyxClient) {
            this.logger.debug(`[MOCK] Provisioning number ${phoneNumber} on connection ${targetConnection}`);
            return {
                id: `mock_telnyx_id_${Date.now()}`,
                phone_number: phoneNumber,
                connection_id: targetConnection,
            };
        }
        try {
            const order = await this.telnyxClient.numberOrders.create({
                phone_numbers: [{ phone_number: phoneNumber }],
                connection_id: targetConnection,
            });
            this.logger.log(`Number order created: ${order.data?.id || 'unknown'} for ${phoneNumber}`);
            let attempts = 0;
            const maxAttempts = 10;
            const delayMs = 3000;
            while (attempts < maxAttempts) {
                await new Promise((resolve) => setTimeout(resolve, delayMs));
                attempts++;
                const numbersRes = await this.telnyxClient.phoneNumbers.list({
                    filter: { phone_number: phoneNumber },
                });
                if (numbersRes && numbersRes.data && numbersRes.data.length > 0) {
                    const numberData = numbersRes.data[0];
                    if (numberData.connection_id !== targetConnection) {
                        throw new InternalServerErrorException(`Number provisioned but has incorrect or missing connection_id. Expected ${targetConnection}, got ${numberData.connection_id}`);
                    }
                    return {
                        id: numberData.id,
                        phone_number: numberData.phone_number,
                        connection_id: numberData.connection_id,
                    };
                }
            }
            throw new InternalServerErrorException(`Number order was placed, but the phone number resource did not become available after ${maxAttempts} attempts.`);
        }
        catch (error) {
            this.logger.error(`Error provisioning number ${phoneNumber}`, error);
            if (error instanceof InternalServerErrorException) {
                throw error;
            }
            throw new BadRequestException('Failed to provision phone number');
        }
    }
};
TelnyxProvisioningService = TelnyxProvisioningService_1 = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [])
], TelnyxProvisioningService);
export { TelnyxProvisioningService };
//# sourceMappingURL=telnyx-provisioning.service.js.map