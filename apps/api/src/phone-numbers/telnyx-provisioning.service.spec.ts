import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { TelnyxProvisioningService } from './telnyx-provisioning.service.js';
import { InternalServerErrorException, BadRequestException } from '@nestjs/common';

describe('TelnyxProvisioningService', () => {
  let service: TelnyxProvisioningService;
  
  const originalEnv = process.env;
  
  beforeEach(async () => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.TELNYX_API_KEY = 'test_api_key';
    
    const module: TestingModule = await Test.createTestingModule({
      providers: [TelnyxProvisioningService],
    }).compile();
    service = module.get<TelnyxProvisioningService>(TelnyxProvisioningService);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it('should fail fast if TELNYX_CALL_CONTROL_APP_ID is missing', async () => {
    delete process.env.TELNYX_CALL_CONTROL_APP_ID;
    
    // recompile
    const module: TestingModule = await Test.createTestingModule({
      providers: [TelnyxProvisioningService],
    }).compile();
    service = module.get<TelnyxProvisioningService>(TelnyxProvisioningService);

    await expect(service.placeNumberOrder('+15551234567')).rejects.toThrowError(
      new InternalServerErrorException('Telnyx Call Control Application ID is not configured.')
    );
  });

  it('should pass correct App ID to numberOrders.create and return order_id', async () => {
    process.env.TELNYX_CALL_CONTROL_APP_ID = 'test_app_id';

    const module: TestingModule = await Test.createTestingModule({
      providers: [TelnyxProvisioningService],
    }).compile();
    service = module.get<TelnyxProvisioningService>(TelnyxProvisioningService);

    const createOrderMock = vi.fn().mockResolvedValue({ data: { id: 'order_123' } });

    (service as any).telnyxClient = {
      numberOrders: { create: createOrderMock },
    };

    const result = await service.placeNumberOrder('+15551234567');
    
    expect(createOrderMock).toHaveBeenCalledWith({
      phone_numbers: [{ phone_number: '+15551234567' }],
      connection_id: 'test_app_id',
    });
    
    expect(result).toEqual({
      order_id: 'order_123',
      connection_id: 'test_app_id',
    });
  });

  it('should check order status and return completed if found', async () => {
    process.env.TELNYX_CALL_CONTROL_APP_ID = 'test_app_id';

    const module: TestingModule = await Test.createTestingModule({
      providers: [TelnyxProvisioningService],
    }).compile();
    service = module.get<TelnyxProvisioningService>(TelnyxProvisioningService);

    const listNumbersMock = vi.fn().mockResolvedValue({ 
      data: [{ id: 'num_123', phone_number: '+15551234567', connection_id: 'test_app_id' }] 
    });

    (service as any).telnyxClient = {
      phoneNumbers: { list: listNumbersMock },
    };

    const result = await service.checkOrderStatus('order_123', '+15551234567');
    
    expect(result).toEqual({
      status: 'completed',
      id: 'num_123',
      phone_number: '+15551234567',
      connection_id: 'test_app_id',
    });
  });

  it('should return pending if number not found yet', async () => {
    process.env.TELNYX_CALL_CONTROL_APP_ID = 'test_app_id';

    const module: TestingModule = await Test.createTestingModule({
      providers: [TelnyxProvisioningService],
    }).compile();
    service = module.get<TelnyxProvisioningService>(TelnyxProvisioningService);

    const listNumbersMock = vi.fn().mockResolvedValue({ data: [] });

    (service as any).telnyxClient = {
      phoneNumbers: { list: listNumbersMock },
    };

    const result = await service.checkOrderStatus('order_123', '+15551234567');
    
    expect(result).toEqual({
      status: 'pending',
    });
  });
});
