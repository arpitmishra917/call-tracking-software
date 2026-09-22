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
    
    // We mock the telnyx constructor locally by hijacking the import or we can just let it create a client
    // Since telnyx is used inside the class constructor based on env var, 
    // we can use standard vitest mocks for the 'telnyx' module.
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it('should fail fast if TELNYX_CALL_CONTROL_APP_ID is missing', async () => {
    delete process.env.TELNYX_CALL_CONTROL_APP_ID;
    
    const module: TestingModule = await Test.createTestingModule({
      providers: [TelnyxProvisioningService],
    }).compile();
    service = module.get<TelnyxProvisioningService>(TelnyxProvisioningService);

    await expect(service.provisionNumber('+15551234567')).rejects.toThrowError(
      new InternalServerErrorException('Telnyx Call Control Application ID is not configured.')
    );
  });

  it('should pass correct App ID to numberOrders.create and poll successfully', async () => {
    process.env.TELNYX_CALL_CONTROL_APP_ID = 'test_app_id';

    const module: TestingModule = await Test.createTestingModule({
      providers: [TelnyxProvisioningService],
    }).compile();
    service = module.get<TelnyxProvisioningService>(TelnyxProvisioningService);

    // Mock the internal telnyxClient
    const createOrderMock = vi.fn().mockResolvedValue({ data: { id: 'order_123' } });
    const listNumbersMock = vi.fn()
      .mockResolvedValueOnce({ data: [] }) // First poll fails
      .mockResolvedValueOnce({ data: [{ id: 'num_123', phone_number: '+15551234567', connection_id: 'test_app_id' }] }); // Second poll succeeds

    (service as any).telnyxClient = {
      numberOrders: { create: createOrderMock },
      phoneNumbers: { list: listNumbersMock },
    };

    // We can speed up timers for the test
    vi.useFakeTimers();
    
    const provisionPromise = service.provisionNumber('+15551234567');
    
    // Fast-forward timers to run through the polling
    await vi.runAllTimersAsync();
    
    const result = await provisionPromise;
    
    expect(createOrderMock).toHaveBeenCalledWith({
      phone_numbers: [{ phone_number: '+15551234567' }],
      connection_id: 'test_app_id',
    });
    
    expect(listNumbersMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      id: 'num_123',
      phone_number: '+15551234567',
      connection_id: 'test_app_id',
    });

    vi.useRealTimers();
  });

  it('should detect missing association and fail rather than silently succeeding', async () => {
    process.env.TELNYX_CALL_CONTROL_APP_ID = 'test_app_id';

    const module: TestingModule = await Test.createTestingModule({
      providers: [TelnyxProvisioningService],
    }).compile();
    service = module.get<TelnyxProvisioningService>(TelnyxProvisioningService);

    const createOrderMock = vi.fn().mockResolvedValue({ data: { id: 'order_123' } });
    // Returns wrong connection_id
    const listNumbersMock = vi.fn().mockResolvedValue({ 
      data: [{ id: 'num_123', phone_number: '+15551234567', connection_id: 'wrong_id' }] 
    });

    (service as any).telnyxClient = {
      numberOrders: { create: createOrderMock },
      phoneNumbers: { list: listNumbersMock },
    };

    vi.useFakeTimers();
    const provisionPromise = service.provisionNumber('+15551234567');
    const expectPromise = expect(provisionPromise).rejects.toThrowError(
      new InternalServerErrorException('Number provisioned but has incorrect or missing connection_id. Expected test_app_id, got wrong_id')
    );
    await vi.runAllTimersAsync();
    await expectPromise;
    
    vi.useRealTimers();
  });

  it('should fail if async number retrieval times out', async () => {
    process.env.TELNYX_CALL_CONTROL_APP_ID = 'test_app_id';

    const module: TestingModule = await Test.createTestingModule({
      providers: [TelnyxProvisioningService],
    }).compile();
    service = module.get<TelnyxProvisioningService>(TelnyxProvisioningService);

    const createOrderMock = vi.fn().mockResolvedValue({ data: { id: 'order_123' } });
    // Always returns empty data
    const listNumbersMock = vi.fn().mockResolvedValue({ data: [] });

    (service as any).telnyxClient = {
      numberOrders: { create: createOrderMock },
      phoneNumbers: { list: listNumbersMock },
    };

    vi.useFakeTimers();
    const provisionPromise = service.provisionNumber('+15551234567');
    const expectPromise = expect(provisionPromise).rejects.toThrowError(
      new InternalServerErrorException('Number order was placed, but the phone number resource did not become available after 10 attempts.')
    );
    await vi.runAllTimersAsync();
    await expectPromise;
    
    vi.useRealTimers();
  });
});
