import { vi, describe, it, expect, beforeEach } from 'vitest';
import { PhoneNumbersController } from './phone-numbers.controller.js';
import { PhoneNumbersService } from './phone-numbers.service.js';

describe('PhoneNumbersController', () => {
  let controller: PhoneNumbersController;
  let service: PhoneNumbersService;

  beforeEach(() => {
    service = {
      listWorkspaceNumbers: vi.fn(),
      searchAvailableNumbers: vi.fn(),
      provisionNumber: vi.fn(),
      updateNumber: vi.fn(),
      getNumber: vi.fn(),
      releaseNumber: vi.fn(),
    } as any;

    controller = new PhoneNumbersController(service);
  });

  describe('listNumbers', () => {
    it('delegates to phoneNumbersService.listWorkspaceNumbers with userId and params', async () => {
      const mockResult = { items: [{ id: 'pn-1', phone_number: '+15551234567' }], total: 1 };
      (service.listWorkspaceNumbers as any).mockResolvedValue(mockResult);

      const req = { user: { userId: 'user-1' } };
      const res = await controller.listNumbers('ws-1', req, '555', '20', '0');

      expect(res).toBe(mockResult);
      expect(service.listWorkspaceNumbers).toHaveBeenCalledWith('ws-1', 'user-1', {
        search: '555',
        limit: 20,
        offset: 0,
      });
    });
  });

  describe('getNumber', () => {
    it('delegates to phoneNumbersService.getNumber with workspaceId, id, and userId', async () => {
      const mockNumber = { id: 'pn-1', phone_number: '+15551234567', vendor_id: 'v-1' };
      (service.getNumber as any).mockResolvedValue(mockNumber);

      const req = { user: { userId: 'user-vendor-1' } };
      const res = await controller.getNumber('ws-1', 'pn-1', req);

      expect(res).toBe(mockNumber);
      expect(service.getNumber).toHaveBeenCalledWith('ws-1', 'pn-1', 'user-vendor-1');
    });
  });

  describe('updateNumber', () => {
    it('delegates vendor assignment to phoneNumbersService.updateNumber', async () => {
      const mockUpdated = { id: 'pn-1', vendor_id: 'vendor-123' };
      (service.updateNumber as any).mockResolvedValue(mockUpdated);

      const res = await controller.updateNumber('ws-1', 'pn-1', { vendorId: 'vendor-123' });

      expect(res).toBe(mockUpdated);
      expect(service.updateNumber).toHaveBeenCalledWith('ws-1', 'pn-1', { vendorId: 'vendor-123' });
    });

    it('delegates vendor unassignment (vendorId: null) to phoneNumbersService.updateNumber', async () => {
      const mockUpdated = { id: 'pn-1', vendor_id: null };
      (service.updateNumber as any).mockResolvedValue(mockUpdated);

      const res = await controller.updateNumber('ws-1', 'pn-1', { vendorId: null });

      expect(res).toBe(mockUpdated);
      expect(service.updateNumber).toHaveBeenCalledWith('ws-1', 'pn-1', { vendorId: null });
    });
  });
});
