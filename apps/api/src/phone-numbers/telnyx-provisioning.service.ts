import {
  Injectable,
  Logger,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import Telnyx from 'telnyx';

@Injectable()
export class TelnyxProvisioningService {
  private readonly logger = new Logger(TelnyxProvisioningService.name);
  private telnyxClient: any;

  constructor() {
    const apiKey = process.env.TELNYX_API_KEY;
    if (apiKey) {
      const telnyxFactory = Telnyx as any;
      this.telnyxClient = new telnyxFactory(apiKey);
    } else {
      this.logger.warn(
        'TELNYX_API_KEY not provided. Running in mock provisioning mode.',
      );
    }
  }

  async searchNumbers(
    countryCode: string = 'US',
    limit: number = 5,
  ): Promise<any[]> {
    if (!this.telnyxClient) {
      // Return mock numbers
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
    } catch (error: any) {
      this.logger.error('Error searching Telnyx numbers', error);
      throw new InternalServerErrorException('Failed to search phone numbers');
    }
  }

  async provisionNumber(
    phoneNumber: string,
    connectionId?: string,
  ): Promise<{
    id: string;
    phone_number: string;
    connection_id: string | null;
  }> {
    const targetConnection = connectionId || process.env.TELNYX_CALL_CONTROL_APP_ID;

    if (!targetConnection) {
      throw new InternalServerErrorException(
        'Telnyx Call Control Application ID is not configured.',
      );
    }

    if (!this.telnyxClient) {
      this.logger.debug(
        `[MOCK] Provisioning number ${phoneNumber} on connection ${targetConnection}`,
      );
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

      // Polling for the actual phone number resource
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
            throw new InternalServerErrorException(
              `Number provisioned but has incorrect or missing connection_id. Expected ${targetConnection}, got ${numberData.connection_id}`,
            );
          }

          return {
            id: numberData.id,
            phone_number: numberData.phone_number,
            connection_id: numberData.connection_id,
          };
        }
      }

      throw new InternalServerErrorException(
        `Number order was placed, but the phone number resource did not become available after ${maxAttempts} attempts.`,
      );
    } catch (error: any) {
      this.logger.error(`Error provisioning number ${phoneNumber}`, error);
      if (error instanceof InternalServerErrorException) {
        throw error;
      }
      throw new BadRequestException('Failed to provision phone number');
    }
  }
}
