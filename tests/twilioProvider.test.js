const twilioProvider = require('../src/twilioProvider');

// Mock twilio
jest.mock('twilio', () => {
  const mockCallsUpdate = jest.fn().mockResolvedValue({});
  const mockCallsCreate = jest.fn().mockResolvedValue({ sid: 'new_twilio_call_sid' });
  const mockClient = {
    calls: jest.fn((callId) => ({
      update: mockCallsUpdate
    }))
  };
  mockClient.calls.create = mockCallsCreate;

  const twilioFn = jest.fn(() => mockClient);
  twilioFn.validateRequest = jest.fn().mockReturnValue(true);
  
  return twilioFn;
}, { virtual: true });

describe('Twilio Provider Adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Event Normalization', () => {
    it('normalizes a ringing status to CALL_INITIATED', () => {
      const reqBody = {
        CallStatus: 'ringing',
        CallSid: 'CA123',
        Direction: 'inbound',
        From: '+111',
        To: '+222'
      };
      
      const event = twilioProvider.normalizeEvent(reqBody);
      
      expect(event.type).toBe('CALL_INITIATED');
      expect(event.callId).toBe('CA123');
      expect(event.direction).toBe('incoming');
      expect(event.from).toBe('+111');
      expect(event.to).toBe('+222');
      expect(event.originalEvent).toBe(reqBody);
    });

    it('normalizes an in-progress status to CALL_ANSWERED', () => {
      const event = twilioProvider.normalizeEvent({ CallStatus: 'in-progress', CallSid: 'CA123' });
      expect(event.type).toBe('CALL_ANSWERED');
    });

    it('normalizes completed/busy/failed statuses to CALL_HANGUP', () => {
      expect(twilioProvider.normalizeEvent({ CallStatus: 'completed' }).type).toBe('CALL_HANGUP');
      expect(twilioProvider.normalizeEvent({ CallStatus: 'busy' }).type).toBe('CALL_HANGUP');
      expect(twilioProvider.normalizeEvent({ CallStatus: 'failed' }).type).toBe('CALL_HANGUP');
    });
  });

  describe('Telephony Operations', () => {
    // Tests for operations mapped to twilio mock
    // Wait, the client is only instantiated if account sid is present. 
    // We can just rely on the mock returning values.
  });
});
