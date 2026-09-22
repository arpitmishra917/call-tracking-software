import { FakeTelephonyProvider } from './fake.provider.js';
import { telephonyFixtures } from './telephony.fixtures.js';
import { CallEventType } from './telephony.events.js';

describe('TelephonyProvider Contract (Fake Provider)', () => {
  let provider: FakeTelephonyProvider;

  beforeEach(() => {
    provider = new FakeTelephonyProvider();
  });

  it('should answer an incoming call', async () => {
    const event = telephonyFixtures.incomingCallInitiated();

    await provider.answerCall(event.callId);

    const actions = provider.getActions();
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe('answer');
    expect(actions[0].callId).toBe(event.callId);
  });

  it('should dial a buyer', async () => {
    const event = telephonyFixtures.incomingCallInitiated();

    const buyerCallId = await provider.dialBuyer(
      '+15550000001',
      event.to!,
      event.connectionId!,
      15,
    );

    const actions = provider.getActions();
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe('dial');
    expect(actions[0].to).toBe('+15550000001');
    expect(actions[0].from).toBe(event.to);
    expect(actions[0].connectionId).toBe(event.connectionId);
    expect(buyerCallId).toBe('fake-buyer-call-1');
  });

  it('should bridge calls', async () => {
    await provider.bridgeCalls('call-123', 'fake-buyer-call-1');

    const actions = provider.getActions();
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe('bridge');
    expect(actions[0].callId).toBe('call-123');
    expect(actions[0].buyerCallId).toBe('fake-buyer-call-1');
  });

  it('should hangup call', async () => {
    const event = telephonyFixtures.callHangup('call-123');
    expect(event.type).toBe(CallEventType.CALL_HANGUP);

    await provider.hangupCall('call-123');

    const actions = provider.getActions();
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe('hangup');
    expect(actions[0].callId).toBe('call-123');
  });

  it('should start recording a call', async () => {
    await provider.startRecording('call-123');

    const actions = provider.getActions();
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe('startRecording');
    expect(actions[0].callId).toBe('call-123');
  });

  it('should get recording url', async () => {
    const url = await provider.getRecordingUrl('rec-123');
    expect(url).toBe('https://fake.recording.url/rec-123.mp3');
  });
});
