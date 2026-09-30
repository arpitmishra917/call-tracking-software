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
    numberType?: string,
    prefix?: string,
  ): Promise<any[]> {
    if (!this.telnyxClient) {
      // Return mock numbers
      return Array.from({ length: limit }).map((_, i) => ({
        phone_number: `+1${prefix || '555'}000${1000 + i}`,
        national_destination_code: prefix || '555',
        locality: 'Mock City',
        administrative_area: 'NY',
        phone_number_type: numberType === 'toll_free' ? 'toll_free' : 'local',
      }));
    }

    try {
      const filter: any = {
        country_code: countryCode,
        limit,
        features: ['voice'],
      };
      
      if (numberType) {
        filter.phone_number_type = numberType;
      }
      
      if (prefix) {
        filter.phone_number = { starts_with: prefix };
      }

      const response = await this.telnyxClient.availablePhoneNumbers.list({ filter });
      return response.data;
    } catch (error: any) {
      this.logger.error('Error searching Telnyx numbers', error);
      throw new InternalServerErrorException('Failed to search phone numbers');
    }
  }

  async placeNumberOrder(
    phoneNumber: string,
    connectionId?: string,
  ): Promise<{
    order_id: string;
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
        `[MOCK] Placing order for number ${phoneNumber} on connection ${targetConnection}`,
      );
      return {
        order_id: `mock_order_${Date.now()}`,
        connection_id: targetConnection,
      };
    }

    try {
      const order = await this.telnyxClient.numberOrders.create({
        phone_numbers: [{ phone_number: phoneNumber }],
        connection_id: targetConnection,
      });

      const orderId = order.data?.id;
      if (!orderId) {
        throw new InternalServerErrorException('Telnyx did not return an order ID');
      }

      this.logger.log(`Number order created: ${orderId} for ${phoneNumber}`);

      return {
        order_id: orderId,
        connection_id: targetConnection,
      };
    } catch (error: any) {
      this.logger.error(`Error placing order for number ${phoneNumber}`, error);
      throw new BadRequestException('Failed to place phone number order');
    }
  }

  async checkOrderStatus(orderId: string, phoneNumber: string): Promise<{
    status: string;
    id?: string;
    phone_number?: string;
    connection_id?: string | null;
    phone_number_type?: string;
  }> {
    if (!this.telnyxClient) {
      this.logger.debug(`[MOCK] Checking order status for ${orderId}`);
      // In mock mode, we assume it succeeds immediately
      return {
        status: 'completed',
        id: `mock_telnyx_id_${orderId}`,
        phone_number: phoneNumber,
        connection_id: process.env.TELNYX_CALL_CONTROL_APP_ID,
        phone_number_type: 'local', // Mock default
      };
    }

    try {
      // We can query the number order to see if it's successful, or just list the phone number directly
      const numbersRes = await this.telnyxClient.phoneNumbers.list({
        filter: { phone_number: phoneNumber },
      });

      if (numbersRes && numbersRes.data && numbersRes.data.length > 0) {
        const numberData = numbersRes.data[0];
        
        return {
          status: 'completed',
          id: numberData.id,
          phone_number: numberData.phone_number,
          connection_id: numberData.connection_id,
          phone_number_type: numberData.phone_number_type,
        };
      }
      
      // If not found yet, it's still pending
      return { status: 'pending' };
    } catch (error: any) {
      this.logger.error(`Error checking order status for ${orderId}`, error);
      throw new InternalServerErrorException('Failed to check order status');
    }
  }

  async releaseNumber(phoneNumberId: string): Promise<void> {
    if (!this.telnyxClient) {
      this.logger.debug(`[MOCK] Releasing number ${phoneNumberId}`);
      return;
    }

    try {
      await this.telnyxClient.phoneNumbers.delete(phoneNumberId);
      this.logger.log(`Released number from Telnyx: ${phoneNumberId}`);
    } catch (error: any) {
      this.logger.error(`Error releasing number ${phoneNumberId} from Telnyx`, error);
      throw new InternalServerErrorException('Failed to release phone number from provider');
    }
  }
}
