const callController = require('../src/callController');
const webhookHandler = require('../src/webhookHandler');
const provider = require('../src/telephonyProvider');

// Mock the provider
jest.mock('../src/telephonyProvider', () => ({
  answerCall: jest.fn().mockResolvedValue(),
  dialBuyer: jest.fn().mockResolvedValue('buyer_a_leg_id'),
  bridgeCalls: jest.fn().mockResolvedValue(),
  hangupCall: jest.fn().mockResolvedValue()
}));

describe('Stage 2 and Stage 3: Sequential Routing (Buyer A -> Buyer B)', () => {
  beforeEach(() => {
    callController.clearCallState();
    webhookHandler.clearProcessedEvents();
    jest.clearAllMocks();
  });

  const baseEvent = {
    callId: 'inbound_123',
    connectionId: 'conn_abc',
    direction: 'incoming',
    to: '+15551111111',
    from: '+15559999999'
  };

  async function simulateIncomingCall() {
    await callController.handleEvent({ type: 'CALL_INITIATED', ...baseEvent });
    
    provider.dialBuyer.mockResolvedValueOnce('buyer_a_leg_id');
    await callController.handleEvent({ type: 'CALL_ANSWERED', ...baseEvent });
  }

  it('1. A answers → B is never called', async () => {
    await simulateIncomingCall();

    await callController.handleEvent({
      type: 'CALL_ANSWERED', callId: 'buyer_a_leg_id'
    });

    const state = callController.getCallState('inbound_123');
    expect(state.state).toBe('CONNECTED_A');
    expect(state.buyerBCallId).toBeNull();
  });

  it('2 & 3. A timeout/failure → B is called', async () => {
    await simulateIncomingCall();

    provider.dialBuyer.mockResolvedValueOnce('buyer_b_leg_id');

    // A hangs up / fails
    await callController.handleEvent({
      type: 'CALL_HANGUP', callId: 'buyer_a_leg_id'
    });

    const state = callController.getCallState('inbound_123');
    expect(state.state).toBe('RINGING_B');
    expect(state.buyerBCallId).toBe('buyer_b_leg_id');
  });

  it('4. A fails + B fails → call ends safely', async () => {
    await simulateIncomingCall();

    provider.dialBuyer.mockResolvedValueOnce('buyer_b_leg_id');

    // A hangs up
    await callController.handleEvent({
      type: 'CALL_HANGUP', callId: 'buyer_a_leg_id'
    });

    // B hangs up
    await callController.handleEvent({
      type: 'CALL_HANGUP', callId: 'buyer_b_leg_id'
    });

    const state = callController.getCallState('inbound_123');
    expect(state.state).toBe('COMPLETED');
    expect(provider.hangupCall).toHaveBeenCalledWith('inbound_123');
  });

  it('5. Caller hangs up during A → B is NOT called', async () => {
    await simulateIncomingCall();

    // Caller hangs up
    await callController.handleEvent({
      type: 'CALL_HANGUP', ...baseEvent
    });

    const state = callController.getCallState('inbound_123');
    expect(state.state).toBe('COMPLETED');
    expect(state.buyerBCallId).toBeNull(); // B was never called
    expect(provider.hangupCall).toHaveBeenCalledWith('buyer_a_leg_id');
  });

  it('6. Caller hangs up during B → routing stops safely', async () => {
    await simulateIncomingCall();

    provider.dialBuyer.mockResolvedValueOnce('buyer_b_leg_id');

    // A hangs up
    await callController.handleEvent({
      type: 'CALL_HANGUP', callId: 'buyer_a_leg_id'
    });

    // Caller hangs up
    await callController.handleEvent({
      type: 'CALL_HANGUP', ...baseEvent
    });

    const state = callController.getCallState('inbound_123');
    expect(state.state).toBe('COMPLETED');
    expect(provider.hangupCall).toHaveBeenCalledWith('buyer_b_leg_id');
  });

  it('7. A answer/timeout race → exactly one winner (no double bridge)', async () => {
    await simulateIncomingCall();

    // Answer and hangup arrive synchronously (or processed sequentially very quickly)
    // First event is answer
    await callController.handleEvent({
      type: 'CALL_ANSWERED', callId: 'buyer_a_leg_id'
    });
    
    // Second event is hangup
    await callController.handleEvent({
      type: 'CALL_HANGUP', callId: 'buyer_a_leg_id'
    });

    const state = callController.getCallState('inbound_123');
    expect(state.state).toBe('COMPLETED');
    expect(state.buyerBCallId).toBeNull(); // B should not be dialed
  });

  it('9. B answers → caller is bridged to B', async () => {
    await simulateIncomingCall();

    provider.dialBuyer.mockResolvedValueOnce('buyer_b_leg_id');

    // A hangs up
    await callController.handleEvent({
      type: 'CALL_HANGUP', callId: 'buyer_a_leg_id'
    });

    // B answers
    await callController.handleEvent({
      type: 'CALL_ANSWERED', callId: 'buyer_b_leg_id'
    });

    const state = callController.getCallState('inbound_123');
    expect(state.state).toBe('CONNECTED_B');
    expect(provider.bridgeCalls).toHaveBeenCalledWith('inbound_123', 'buyer_b_leg_id');
  });
});
