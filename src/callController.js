const provider = require('./telephonyProvider');

// In-memory state for Stage 3 sequential routing
const activeCalls = new Map();

const BUYER_A_TIMEOUT_SECS = 15;
const BUYER_B_TIMEOUT_SECS = 15;

async function handleEvent(event) {
  const { type, callId, direction, connectionId, from, to } = event;

  if (!callId) return;

  // Attempt to find the call by its own ID or by its buyer leg ID
  let callState = activeCalls.get(callId);
  if (!callState) {
    const parentEntry = Array.from(activeCalls.entries()).find(
      ([, state]) => state.buyerACallId === callId || state.buyerBCallId === callId
    );
    if (parentEntry) {
      callState = parentEntry[1];
    }
  }

  // 1. Incoming call recognized
  if (type === 'CALL_INITIATED' && direction === 'incoming') {
    if (!callState) {
      callState = { 
        id: callId, 
        state: 'RECEIVED',
        connectionId: connectionId,
        from: from,
        to: to,
        buyerACallId: null,
        buyerBCallId: null
      };
      activeCalls.set(callId, callState);
    }
    
    console.log(`[CALL ${callId}] RECEIVED. Answering...`);
    
    await provider.answerCall(callId);
    callState.state = 'ANSWERING';
    return;
  }

  // 2. Call answered (by backend or by buyer)
  if (type === 'CALL_ANSWERED') {
    if (callState && callState.state === 'ANSWERING' && callId === callState.id) {
      // Inbound call was answered by our backend. Now dial Buyer A.
      console.log(`[CALL ${callId}] INBOUND ANSWERED. Dialing Buyer A...`);
      callState.state = 'RINGING_A';
      
      const buyerNumber = process.env.BUYER_A_NUMBER || '+15550000001';
      
      callState.buyerACallId = await provider.dialBuyer(
        buyerNumber, 
        callState.to, 
        callState.connectionId, 
        BUYER_A_TIMEOUT_SECS
      );
      return;
    }

    if (callState && callState.state === 'RINGING_A' && callId === callState.buyerACallId) {
      // Buyer A answered. Bridge the calls.
      console.log(`[CALL ${callState.id}] BUYER A ANSWERED. Bridging with caller...`);
      callState.state = 'CONNECTED_A';
      
      await provider.bridgeCalls(callState.id, callState.buyerACallId);
      return;
    }

    if (callState && callState.state === 'RINGING_B' && callId === callState.buyerBCallId) {
      // Buyer B answered. Bridge the calls.
      console.log(`[CALL ${callState.id}] BUYER B ANSWERED. Bridging with caller...`);
      callState.state = 'CONNECTED_B';
      
      await provider.bridgeCalls(callState.id, callState.buyerBCallId);
      return;
    }
  }

  // 3. Caller or Buyer hangup
  if (type === 'CALL_HANGUP') {
    if (callState) {
      console.log(`[CALL ${callState.id}] HANGUP detected for leg ${callId} in state ${callState.state}`);
      
      // If the caller hung up
      if (callId === callState.id) {
        // State is complete, stop any routing
        const previousState = callState.state;
        callState.state = 'COMPLETED';

        // Hang up active buyer if they are ringing or connected
        if (['RINGING_A', 'CONNECTED_A'].includes(previousState) && callState.buyerACallId) {
          await provider.hangupCall(callState.buyerACallId);
        } else if (['RINGING_B', 'CONNECTED_B'].includes(previousState) && callState.buyerBCallId) {
          await provider.hangupCall(callState.buyerBCallId);
        }
      } 
      // If Buyer A hung up or timed out while ringing
      else if (callId === callState.buyerACallId && callState.state === 'RINGING_A') {
        console.log(`[CALL ${callState.id}] BUYER A FAILED/NO-ANSWER. Dialing Buyer B...`);
        callState.state = 'RINGING_B';

        const buyerBNumber = process.env.BUYER_B_NUMBER || '+15550000002';
        
        callState.buyerBCallId = await provider.dialBuyer(
          buyerBNumber,
          callState.to,
          callState.connectionId,
          BUYER_B_TIMEOUT_SECS
        );
      }
      // If Buyer B hung up or timed out while ringing
      else if (callId === callState.buyerBCallId && callState.state === 'RINGING_B') {
        console.log(`[CALL ${callState.id}] BUYER B FAILED/NO-ANSWER. Terminating call...`);
        callState.state = 'COMPLETED';
        await provider.hangupCall(callState.id);
      }
      // If Buyer A or B hung up after being connected
      else if (
        (callId === callState.buyerACallId && callState.state === 'CONNECTED_A') ||
        (callId === callState.buyerBCallId && callState.state === 'CONNECTED_B')
      ) {
        callState.state = 'COMPLETED';
        await provider.hangupCall(callState.id);
      }
    }
  }
}

function getCallState(id) {
  return activeCalls.get(id);
}

function clearCallState() {
  activeCalls.clear();
}

module.exports = {
  handleEvent,
  getCallState,
  clearCallState
};
