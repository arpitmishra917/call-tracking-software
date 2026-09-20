const twilio = require('twilio');
const config = require('./config');

const client = config.twilioAccountSid && config.twilioAuthToken 
  ? twilio(config.twilioAccountSid, config.twilioAuthToken)
  : null;

// Normalize Twilio Webhook Payload
function normalizeEvent(reqBody) {
  const status = reqBody.CallStatus; // 'ringing', 'in-progress', 'completed', 'busy', 'no-answer', 'failed', 'canceled'
  
  let type = 'UNKNOWN';
  if (status === 'ringing' || status === 'queued') {
    type = 'CALL_INITIATED';
  } else if (status === 'in-progress') {
    type = 'CALL_ANSWERED';
  } else if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(status)) {
    type = 'CALL_HANGUP';
  }

  return {
    type,
    callId: reqBody.CallSid,
    direction: reqBody.Direction === 'inbound' ? 'incoming' : 'outgoing',
    connectionId: reqBody.CallSid, // Twilio doesn't have a distinct connection_id
    from: reqBody.From,
    to: reqBody.To,
    originalEvent: reqBody
  };
}

// Telephony Operations Adapter
function getInitialTwiML(callSid) {
  // Place the inbound caller into a conference immediately.
  // We disable waitUrl so they hear silence instead of hold music while waiting for a buyer.
  // endConferenceOnExit ensures if the caller drops, the room is destroyed.
  return `<Response><Dial><Conference waitUrl="" endConferenceOnExit="true">bridge_${callSid}</Conference></Dial></Response>`;
}

async function answerCall(callId) {
  // In our new architecture, the inbound call is answered implicitly by returning TwiML in index.js.
  // The generic routing engine still requires an asynchronous CALL_ANSWERED event to proceed to dialing.
  const webhookHandler = require('./webhookHandler');
  setImmediate(() => {
    webhookHandler.processWebhook({
      type: 'CALL_ANSWERED',
      id: `tw_syn_${callId}_answered`,
      callId: callId,
      direction: 'incoming'
    }, true).catch(err => console.error('[TWILIO] Failed to synthesize answered event:', err));
  });
}

async function dialBuyer(to, from, connectionId, timeoutSecs) {
  if (client) {
    const baseUrl = config.baseUrl || 'https://example.com';
    // The connectionId is the original inbound CallSid.
    // We create the outbound call directly into the exact same conference room.
    const confName = `bridge_${connectionId}`;
    const twiml = `<Response><Dial><Conference waitUrl="" endConferenceOnExit="false">${confName}</Conference></Dial></Response>`;
    
    const res = await client.calls.create({
      to,
      from,
      twiml,
      statusCallback: `${baseUrl}/webhooks/twilio`,
      statusCallbackEvent: ['answered', 'completed'],
      timeout: timeoutSecs
    });
    return res.sid;
  }
  return 'mock_twilio_buyer_leg_id';
}

async function bridgeCalls(callId, buyerCallId) {
  // In the Native Conference architecture, the inbound call and the buyer call
  // were both created with TwiML that places them into `bridge_${callId}`.
  // Therefore, they are physically bridged the exact millisecond the buyer answers.
  // No REST API updates are needed!
  console.log(`[TWILIO] Legs ${callId} and ${buyerCallId} are natively bridged via Conference bridge_${callId}`);
}

async function hangupCall(callId) {
  if (client) {
    try {
      await client.calls(callId).update({ status: 'completed' });
    } catch (e) {
      console.warn(`[TWILIO] Hangup failed for ${callId}: ${e.message}`);
    }
  }
}

function validateWebhook(req, url) {
  const signature = req.headers['x-twilio-signature'];
  if (!signature || !config.twilioAuthToken) return false;
  return twilio.validateRequest(config.twilioAuthToken, signature, url, req.body);
}

module.exports = {
  normalizeEvent,
  getInitialTwiML,
  answerCall,
  dialBuyer,
  bridgeCalls,
  hangupCall,
  validateWebhook,
  client
};
