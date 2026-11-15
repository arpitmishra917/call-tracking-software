import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReportsService, getFinalDestinationDisplay, isValidPhoneNumber, formatPhoneNumber, maskCallerPhoneNumber } from './reports.service.js';

describe('ReportsService Final Destination Backend Logic', () => {
  let reportsService: ReportsService;
  let mockPrisma: any;
  let mockCallsService: any;

  beforeEach(() => {
    mockPrisma = {
      savedReport: {
        findMany: vi.fn(),
        create: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    };
    mockCallsService = {
      getCalls: vi.fn(),
      getParticipantContext: vi.fn().mockResolvedValue({
        isOwnerOrAdmin: true,
        isBuyer: false,
        isVendor: false,
      }),
    };
    reportsService = new ReportsService(mockPrisma as any, mockCallsService as any);
  });

  describe('Destination phone number validation & formatting', () => {
    it('rejects numeric database IDs, flags, and array indexes', () => {
      expect(isValidPhoneNumber(1)).toBe(false);
      expect(isValidPhoneNumber('1')).toBe(false);
      expect(isValidPhoneNumber('0')).toBe(false);
      expect(isValidPhoneNumber('2')).toBe(false);
      expect(isValidPhoneNumber('99')).toBe(false);
      expect(isValidPhoneNumber(null)).toBe(false);
      expect(isValidPhoneNumber(undefined)).toBe(false);
      expect(isValidPhoneNumber('')).toBe(false);
      expect(isValidPhoneNumber('uuid-1234-abcd')).toBe(false);
    });

    it('validates E.164 and standard phone numbers with >= 7 digits', () => {
      expect(isValidPhoneNumber('+15551234567')).toBe(true);
      expect(isValidPhoneNumber('5551234567')).toBe(true);
      expect(isValidPhoneNumber('+442071838750')).toBe(true);
      expect(isValidPhoneNumber('(555) 123-4567')).toBe(true);
    });

    it('formats phone numbers to E.164 format', () => {
      expect(formatPhoneNumber('+15551234567')).toBe('+15551234567');
      expect(formatPhoneNumber('5551234567')).toBe('+15551234567');
      expect(formatPhoneNumber('+1 (555) 123-4567')).toBe('+15551234567');
    });
  });

  describe('getFinalDestinationDisplay', () => {
    it('1. Successful destination with a phone number', () => {
      const call = {
        state: 'COMPLETED',
        attempts: [
          { state: 'COMPLETED', buyer: { destination_number: '+15558889999' } }
        ]
      };
      expect(getFinalDestinationDisplay(call)).toBe('+15558889999');
    });

    it('2. No successful destination', () => {
      const call = {
        state: 'FAILED',
        attempts: [
          { state: 'FAILED', buyer: { destination_number: '+15558889999' } },
          { state: 'NO_ANSWER', buyer: { destination_number: '+15557776666' } }
        ]
      };
      expect(getFinalDestinationDisplay(call)).toBe('No successful destination');
    });

    it('3. Successful connection with a missing destination number', () => {
      const call = {
        state: 'COMPLETED',
        attempts: [
          { state: 'COMPLETED', buyer: { name: 'Acme Solar', destination_number: null } }
        ]
      };
      expect(getFinalDestinationDisplay(call)).toBe('Destination unavailable');
    });

    it('4. Missing or unknown destination status', () => {
      expect(getFinalDestinationDisplay({ state: 'INITIATED', attempts: [] })).toBe('—');
      expect(getFinalDestinationDisplay(null)).toBe('—');
      expect(getFinalDestinationDisplay({})).toBe('—');
    });

    it('5. Numeric destination ID 1 must not render as a phone number', () => {
      const callConnected = {
        state: 'COMPLETED',
        attempts: [
          { state: 'COMPLETED', buyer: { name: '1', destination_number: '1' } }
        ]
      };
      expect(getFinalDestinationDisplay(callConnected)).toBe('Destination unavailable');

      const callFailed = {
        state: 'FAILED',
        attempts: [
          { state: 'FAILED', buyer: { name: '1', destination_number: '1' } }
        ]
      };
      expect(getFinalDestinationDisplay(callFailed)).toBe('No successful destination');
    });

    it('6. Completed call with 0 attempts renders "No successful destination"', () => {
      expect(getFinalDestinationDisplay({ state: 'COMPLETED', attempts: [] })).toBe('No successful destination');
    });

    it('7. Canceled call with 0 attempts renders "No successful destination"', () => {
      expect(getFinalDestinationDisplay({ state: 'CANCELED', attempts: [] })).toBe('No successful destination');
    });

    it('8. Active/routing call in progress renders "—"', () => {
      expect(getFinalDestinationDisplay({ state: 'ROUTING', attempts: [{ state: 'RINGING' }] })).toBe('—');
    });

    it('9. Connected call with direct destination_number renders formatted number', () => {
      expect(getFinalDestinationDisplay({ state: 'COMPLETED', destination_number: '+15552223333', attempts: [] })).toBe('+15552223333');
    });
  });

  describe('Vendor security & export behavior', () => {
    it('6. Vendor participant cannot export finalDestination column', async () => {
      mockCallsService.getParticipantContext.mockResolvedValueOnce({
        isOwnerOrAdmin: false,
        isBuyer: false,
        isVendor: true,
        vendorId: 'vendor-1',
      });

      mockCallsService.getCalls.mockResolvedValueOnce({
        items: [
          {
            id: 'call-v',
            from_number: '+15551112222',
            to_number: '+15553334444',
            state: 'COMPLETED',
            duration_secs: 60,
            attempts: [{ id: 'att-1', state: 'COMPLETED' }], // Buyer stripped by CallsService
          }
        ],
        total: 1
      });

      const exportResult = await reportsService.generateExport(
        'ws-1',
        'user-vendor',
        'csv',
        {},
        [
          { id: 'caller', visible: true, order: 0 },
          { id: 'finalDestination', visible: true, order: 1 }, // Requested by client
          { id: 'status', visible: true, order: 2 },
        ]
      );

      const csvString = exportResult.buffer.toString();
      // Ensure 'Final Destination' is NOT present in headers or rows
      expect(csvString).not.toContain('Final Destination');
      expect(csvString).toContain('Caller');
      expect(csvString).toContain('Status');
    });

    it('7. Admin participant export includes formatted finalDestination', async () => {
      mockCallsService.getCalls.mockResolvedValueOnce({
        items: [
          {
            id: 'call-admin',
            from_number: '+15551112222',
            to_number: '+15553334444',
            state: 'COMPLETED',
            duration_secs: 60,
            attempts: [
              { id: 'att-1', state: 'COMPLETED', buyer: { destination_number: '+15559990000' } }
            ],
          }
        ],
        total: 1
      });

      const exportResult = await reportsService.generateExport(
        'ws-1',
        'user-admin',
        'csv',
        {},
        [
          { id: 'caller', visible: true, order: 0 },
          { id: 'finalDestination', visible: true, order: 1 },
        ]
      );

      const csvString = exportResult.buffer.toString();
      expect(csvString).toContain('Final Destination');
      expect(csvString).toContain('+15559990000');
    });
  });

  describe('Duration Export & Serialization Logic', () => {
    it('8. Formats talkDuration and totalDuration correctly in export and preserves zero vs null', async () => {
      mockCallsService.getCalls.mockResolvedValueOnce({
        items: [
          {
            id: 'call-with-durations',
            from_number: '+15551112222',
            to_number: '+15553334444',
            state: 'COMPLETED',
            talkDurationSecs: 125, // 02:05
            totalDurationSecs: 190, // 03:10
            attempts: [],
          },
          {
            id: 'call-with-zero-talk',
            from_number: '+15551112222',
            to_number: '+15553334444',
            state: 'COMPLETED',
            talkDurationSecs: 0, // Genuine 0 -> 00:00
            totalDurationSecs: 10, // 00:10
            attempts: [],
          },
          {
            id: 'call-unconnected-null',
            from_number: '+15551112222',
            to_number: '+15553334444',
            state: 'NO_ANSWER',
            talkDurationSecs: null, // Null -> —
            totalDurationSecs: 60, // 01:00
            attempts: [],
          }
        ],
        total: 3
      });

      const exportResult = await reportsService.generateExport(
        'ws-1',
        'user-admin',
        'csv',
        {},
        [
          { id: 'caller', visible: true, order: 0 },
          { id: 'status', visible: true, order: 1 },
          { id: 'talkDuration', visible: true, order: 2 },
          { id: 'totalDuration', visible: true, order: 3 },
        ]
      );

      const csvString = exportResult.buffer.toString();
      expect(csvString).toContain('Talk Duration');
      expect(csvString).toContain('Total Duration');
      
      // Call 1
      expect(csvString).toContain('02:05');
      expect(csvString).toContain('03:10');

      // Call 2: zero talk duration
      expect(csvString).toContain('00:00');
      expect(csvString).toContain('00:10');

      // Call 3: null talk duration renders —
      expect(csvString).toContain('—');
      expect(csvString).toContain('01:00');
    });
  });

  describe('V4 Security: Caller Phone Number Masking in Exports', () => {
    describe('maskCallerPhoneNumber', () => {
      it('masks US 10-digit phone numbers with standard masking', () => {
        expect(maskCallerPhoneNumber('+15551234567')).toBe('+1555***4567');
        expect(maskCallerPhoneNumber('5551234567')).toBe('+1555***4567');
      });

      it('masks US 11-digit numbers starting with 1', () => {
        expect(maskCallerPhoneNumber('15551234567')).toBe('+1555***4567');
      });

      it('masks international numbers while preserving prefix and suffix', () => {
        expect(maskCallerPhoneNumber('+442071838750')).toBe('+4420***8750');
      });

      it('handles null, undefined, and short inputs safely', () => {
        expect(maskCallerPhoneNumber(null)).toBe('');
        expect(maskCallerPhoneNumber(undefined)).toBe('');
        expect(maskCallerPhoneNumber('')).toBe('');
        expect(maskCallerPhoneNumber('12345')).toBe('***');
      });
    });

    describe('generateExport vendor masking enforcement', () => {
      it('masks caller number in CSV export when caller is a Vendor', async () => {
        mockCallsService.getParticipantContext.mockResolvedValue({
          isOwnerOrAdmin: false,
          isBuyer: false,
          isVendor: true,
          vendorId: 'vendor-123',
        });

        mockCallsService.getCalls.mockResolvedValue({
          items: [
            {
              id: 'call-v-1',
              from_number: '+15551234567',
              to_number: '+18005550199',
              state: 'COMPLETED',
              duration_secs: 120,
              talkDurationSecs: 120,
              totalDurationSecs: 130,
              attempts: [],
              campaign: { name: 'Health Insurance' },
            },
          ],
          total: 1,
        });

        const exportResult = await reportsService.generateExport(
          'ws-1',
          'user-vendor',
          'csv',
          {},
          [
            { id: 'caller', visible: true, order: 0 },
            { id: 'trackingNumber', visible: true, order: 1 },
            { id: 'finalDestination', visible: true, order: 2 },
          ]
        );

        const csv = exportResult.buffer.toString();
        // Masked caller must be present
        expect(csv).toContain('+1555***4567');
        // Cleartext caller number must NOT be present
        expect(csv).not.toContain('+15551234567');
        // Destination column must be stripped for vendor
        expect(csv).not.toContain('Final Destination');
      });

      it('masks caller number in XLSX export when caller is a Vendor', async () => {
        mockCallsService.getParticipantContext.mockResolvedValue({
          isOwnerOrAdmin: false,
          isBuyer: false,
          isVendor: true,
          vendorId: 'vendor-123',
        });

        mockCallsService.getCalls.mockResolvedValue({
          items: [
            {
              id: 'call-v-2',
              from_number: '+15559876543',
              to_number: '+18005550199',
              state: 'COMPLETED',
              duration_secs: 60,
              attempts: [],
            },
          ],
          total: 1,
        });

        const exportResult = await reportsService.generateExport(
          'ws-1',
          'user-vendor',
          'xlsx',
          {},
          [
            { id: 'caller', visible: true, order: 0 },
          ]
        );

        expect(exportResult.contentType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        expect(exportResult.extension).toBe('xlsx');
        expect(exportResult.buffer).toBeDefined();
        expect(exportResult.buffer.length).toBeGreaterThan(0);
      });

      it('preserves cleartext caller number in export when caller is an Admin', async () => {
        mockCallsService.getParticipantContext.mockResolvedValue({
          isOwnerOrAdmin: true,
          isBuyer: false,
          isVendor: false,
        });

        mockCallsService.getCalls.mockResolvedValue({
          items: [
            {
              id: 'call-admin-1',
              from_number: '+15551234567',
              to_number: '+18005550199',
              state: 'COMPLETED',
              duration_secs: 120,
              attempts: [],
            },
          ],
          total: 1,
        });

        const exportResult = await reportsService.generateExport(
          'ws-1',
          'user-admin',
          'csv',
          {},
          [
            { id: 'caller', visible: true, order: 0 },
          ]
        );

        const csv = exportResult.buffer.toString();
        expect(csv).toContain('+15551234567');
      });

      it('Phase 2: exports operational calls without CallCommercial for Buyer and displays "Not evaluated" and "—"', async () => {
        mockCallsService.getParticipantContext.mockResolvedValue({
          isOwnerOrAdmin: false,
          isBuyer: true,
          buyerId: 'buyer-456',
          isVendor: false,
        });

        mockCallsService.getCalls.mockResolvedValue({
          items: [
            {
              id: 'call-op-missed',
              from_number: '+15559998888',
              to_number: '+18005550199',
              state: 'NO_ANSWER',
              duration_secs: null,
              talkDurationSecs: null,
              totalDurationSecs: 30,
              attempts: [{ buyer_id: 'buyer-456', state: 'NO_ANSWER' }],
              commercial: null,
              recordings: [],
              campaign: { name: 'Solar Campaign' },
            },
          ],
          total: 1,
        });

        const exportResult = await reportsService.generateExport(
          'ws-1',
          'user-buyer',
          'csv',
          {},
          [
            { id: 'caller', visible: true, order: 0 },
            { id: 'status', visible: true, order: 1 },
            { id: 'revenue', visible: true, order: 2 },
            { id: 'payout', visible: true, order: 3 }, // Should be stripped for Buyer
            { id: 'profit', visible: true, order: 4 }, // Should be stripped for Buyer
            { id: 'commercial', visible: true, order: 5 },
          ]
        );

        const csv = exportResult.buffer.toString();
        // Operational call details are present
        expect(csv).toContain('NO_ANSWER');
        expect(csv).toContain('+15559998888');
        expect(csv).toContain('Not evaluated');
        expect(csv).toContain('—');

        // Payout and profit columns are stripped for Buyer
        expect(csv).not.toContain('Payout');
        expect(csv).not.toContain('Profit');
      });

      it('Phase 2: exports commercial calls with formatted revenue for Buyer', async () => {
        mockCallsService.getParticipantContext.mockResolvedValue({
          isOwnerOrAdmin: false,
          isBuyer: true,
          buyerId: 'buyer-456',
          isVendor: false,
        });

        mockCallsService.getCalls.mockResolvedValue({
          items: [
            {
              id: 'call-commercial-won',
              from_number: '+15551112222',
              to_number: '+18005550199',
              state: 'COMPLETED',
              duration_secs: 150,
              talkDurationSecs: 140,
              totalDurationSecs: 150,
              attempts: [{ buyer_id: 'buyer-456', state: 'COMPLETED' }],
              commercial: {
                id: 'comm-1',
                buyer_id: 'buyer-456',
                revenue: 75.50,
                status: 'FINAL',
                converted: true,
                qualified: true,
              },
              recordings: [],
              campaign: { name: 'Solar Campaign' },
            },
          ],
          total: 1,
        });

        const exportResult = await reportsService.generateExport(
          'ws-1',
          'user-buyer',
          'csv',
          {},
          [
            { id: 'caller', visible: true, order: 0 },
            { id: 'revenue', visible: true, order: 1 },
            { id: 'commercial', visible: true, order: 2 },
          ]
        );

        const csv = exportResult.buffer.toString();
        expect(csv).toContain('75.5');
        expect(csv).toContain('FINAL - Converted - Qualified');
      });

      it('Phase 2: exports for Vendor strips revenue and profit columns even if requested', async () => {
        mockCallsService.getParticipantContext.mockResolvedValue({
          isOwnerOrAdmin: false,
          isBuyer: false,
          isVendor: true,
          vendorId: 'vendor-123',
        });

        mockCallsService.getCalls.mockResolvedValue({
          items: [
            {
              id: 'call-vendor-1',
              from_number: '+15550001111',
              to_number: '+18005550199',
              state: 'COMPLETED',
              attempts: [],
              commercial: {
                payout: 40,
                status: 'FINAL',
              },
            },
          ],
          total: 1,
        });

        const exportResult = await reportsService.generateExport(
          'ws-1',
          'user-vendor',
          'csv',
          {},
          [
            { id: 'caller', visible: true, order: 0 },
            { id: 'revenue', visible: true, order: 1 },
            { id: 'payout', visible: true, order: 2 },
            { id: 'profit', visible: true, order: 3 },
          ]
        );

        const csv = exportResult.buffer.toString();
        expect(csv).toContain('Payout');
        expect(csv).toContain('40');
        expect(csv).not.toContain('Revenue');
        expect(csv).not.toContain('Profit');
        // Vendor export must strictly mask caller ANI phone number
        expect(csv).toContain('+1555***1111');
        expect(csv).not.toContain('+15550001111');
      });

      it('Phase 2: exports for Vendor masks caller ANI in both CSV and XLSX formats', async () => {
        mockCallsService.getParticipantContext.mockResolvedValue({
          isOwnerOrAdmin: false,
          isBuyer: false,
          isVendor: true,
          vendorId: 'vendor-123',
        });

        mockCallsService.getCalls.mockResolvedValue({
          items: [
            {
              id: 'call-vendor-ani-test',
              from_number: '+15559876543',
              to_number: '+18005550199',
              state: 'COMPLETED',
              attempts: [],
              commercial: {
                payout: 50,
                status: 'FINAL',
              },
            },
          ],
          total: 1,
        });

        const exportResult = await reportsService.generateExport(
          'ws-1',
          'user-vendor',
          'csv',
          {},
          [
            { id: 'caller', visible: true, order: 0 },
            { id: 'payout', visible: true, order: 1 },
          ]
        );

        const csv = exportResult.buffer.toString();
        expect(csv).toContain('+1555***6543');
        expect(csv).not.toContain('+15559876543');
      });
    });
  });

});
