const request = require('supertest');
const app = require('../src/index');
const telnyxProvider = require('../src/telnyxProvider');
const { clearProcessedEvents } = require('../src/webhookHandler');

jest.mock('twilio', () => ({
  validateRequest: jest.fn().mockReturnValue(true)
}), { virtual: true });

jest.mock('../src/telnyxProvider', () => ({
  constructWebhookEvent: jest.fn(),
  normalizeEvent: jest.fn().mockImplementation((event) => {
    return {
      type: event.data?.event_type === 'call.initiated' ? 'CALL_INITIATED' : 
            event.data?.event_type === 'call.answered' ? 'CALL_ANSWERED' : 
            event.data?.event_type === 'call.hangup' ? 'CALL_HANGUP' : 'UNKNOWN',
      callId: event.data?.payload?.call_control_id || 'mock_id',
      direction: event.data?.payload?.direction,
      connectionId: event.data?.payload?.connection_id,
      from: event.data?.payload?.from,
      to: event.data?.payload?.to,
      originalEvent: event
    };
  })
}));

describe('Telnyx Webhook Endpoint', () => {
  beforeEach(() => {
    clearProcessedEvents();
    jest.clearAllMocks();
  });

  const validHeaders = {
    'telnyx-signature-ed25519': 'fake-signature',
    'telnyx-timestamp': '1234567890',
    'Content-Type': 'application/json'
  };

  it('1. Valid webhook: should accept and process a valid webhook', async () => {
    const mockEvent = {
      data: {
        id: 'evt_123',
        event_type: 'call.initiated',
        occurred_at: new Date().toISOString()
      }
    };

    telnyxProvider.constructWebhookEvent.mockReturnValue(mockEvent);

    const res = await request(app)
      .post('/webhooks')
      .set(validHeaders)
      .send(JSON.stringify(mockEvent));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('processed');
    expect(res.body.id).toBe('evt_123');
    expect(telnyxProvider.constructWebhookEvent).toHaveBeenCalled();
  });

  it('2. Invalid signature: should reject requests that fail signature validation', async () => {
    telnyxProvider.constructWebhookEvent.mockImplementation(() => {
      throw new Error('Invalid signature');
    });

    const res = await request(app)
      .post('/webhooks')
      .set(validHeaders)
      .send(JSON.stringify({ some: 'data' }));

    expect(res.status).toBe(400);
    expect(res.text).toContain('Webhook Error: Invalid signature');
  });

  it('3. Duplicate webhook: should handle idempotent requests safely', async () => {
    const mockEvent = {
      data: {
        id: 'evt_dup',
        event_type: 'call.answered',
        occurred_at: new Date().toISOString()
      }
    };

    telnyxProvider.constructWebhookEvent.mockReturnValue(mockEvent);

    // First request
    const res1 = await request(app)
      .post('/webhooks')
      .set(validHeaders)
      .send(JSON.stringify(mockEvent));
    
    expect(res1.status).toBe(200);
    expect(res1.body.status).toBe('processed');

    // Second request (duplicate)
    const res2 = await request(app)
      .post('/webhooks')
      .set(validHeaders)
      .send(JSON.stringify(mockEvent));

    expect(res2.status).toBe(200);
    expect(res2.body.status).toBe('ignored'); // Idempotently accepted but not processed again
    expect(res2.body.reason).toBe('duplicate');
  });

  it('4. Unknown event: should handle unknown event types without corrupting state', async () => {
    const mockEvent = {
      data: {
        id: 'evt_unknown',
        event_type: 'some.future.event',
        occurred_at: new Date().toISOString()
      }
    };

    telnyxProvider.constructWebhookEvent.mockReturnValue(mockEvent);

    const res = await request(app)
      .post('/webhooks')
      .set(validHeaders)
      .send(JSON.stringify(mockEvent));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('processed');
    expect(res.body.type).toBe('some.future.event');
  });

  it('5. Malformed request: should reject if signature headers are missing', async () => {
    const res = await request(app)
      .post('/webhooks')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ valid: 'json' })); // Missing telnyx headers

    expect(res.status).toBe(400);
    expect(res.text).toContain('Missing Telnyx webhook headers');
  });
});
