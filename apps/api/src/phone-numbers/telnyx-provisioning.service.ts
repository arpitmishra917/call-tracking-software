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
    if (!this.telnyxClient) {
      this.logger.debug(
        `[MOCK] Provisioning number ${phoneNumber} on connection ${connectionId}`,
      );
      return {
        id: `mock_telnyx_id_${Date.now()}`,
        phone_number: phoneNumber,
        connection_id: connectionId || null,
      };
    }

    try {
      const order = await this.telnyxClient.numberOrders.create({
        phone_numbers: [{ phone_number: phoneNumber }],
        connection_id: connectionId || process.env.TELNYX_SIP_CONNECTION_ID,
      });

      // Telnyx number orders return immediately but might be pending.
      // For MVP, we return the data of the first ordered number or mock a success response.
      // To get the actual phone number ID, usually we should poll or query phone_numbers.
      // But we can just query the number by phone_number if needed, or rely on webhook.
      // Let's assume we can fetch the actual number details to return its ID.

      const numbersRes = await this.telnyxClient.phoneNumbers.list({
        filter: { phone_number: phoneNumber },
      });

      if (numbersRes && numbersRes.data && numbersRes.data.length > 0) {
        const numberData = numbersRes.data[0];

        // If connectionId was passed or we have a default one, we might need to update the number if it wasn't done in the order
        const targetConnection =
          connectionId || process.env.TELNYX_SIP_CONNECTION_ID;
        if (targetConnection && numberData.connection_id !== targetConnection) {
          await this.telnyxClient.phoneNumbers.update(numberData.id, {
            connection_id: targetConnection,
          });
        }

        return {
          id: numberData.id,
          phone_number: numberData.phone_number,
          connection_id: targetConnection || numberData.connection_id,
        };
      }

      // Fallback if not found yet (still provisioning)
      return {
        id: `pending_${order.data.id}`,
        phone_number: phoneNumber,
        connection_id:
          connectionId || process.env.TELNYX_SIP_CONNECTION_ID || null,
      };
    } catch (error: any) {
      this.logger.error(`Error provisioning number ${phoneNumber}`, error);
      throw new BadRequestException('Failed to provision phone number');
    }
  }
}
