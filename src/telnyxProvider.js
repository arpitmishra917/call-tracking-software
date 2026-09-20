const Telnyx = require('telnyx');
const config = require('./config');

// Initialize Telnyx SDK with API key if available
const telnyx = config.telnyxApiKey ? Telnyx(config.telnyxApiKey) : null;

/**
 * Validates a Telnyx webhook signature and returns the parsed event
 * @param {Buffer|string} rawBody - The raw request body
 * @param {string} signature - The telnyx-signature-ed25519 header
 * @param {string} timestamp - The telnyx-timestamp header
 * @returns {Promise<Object>} The constructed Telnyx event
 * @throws {Error} If signature is invalid
 */
async function constructWebhookEvent(rawBody, signature, timestamp) {
  if (!config.telnyxPublicKey) {
    throw new Error('TELNYX_PUBLIC_KEY is not configured');
  }
  
  const client = telnyx || Telnyx('dummy_key');
  const payloadStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
  
  const headers = {
    'telnyx-signature-ed25519': signature,
    'telnyx-timestamp': timestamp
  };

  // v7 SDK uses webhooks.unwrap
  return client.webhooks.unwrap(payloadStr, { headers }, config.telnyxPublicKey);
}

// ---------------------------------------------------------
// EVENT NORMALIZATION
// ---------------------------------------------------------
function normalizeEvent(event) {
  const eventType = event.data?.event_type || event.type;
  const payload = event.data?.payload || {};
  
  let type = 'UNKNOWN';
  if (eventType === 'call.initiated') type = 'CALL_INITIATED';
  else if (eventType === 'call.answered') type = 'CALL_ANSWERED';
  else if (eventType === 'call.hangup') type = 'CALL_HANGUP';

  return {
    type,
    callId: payload.call_control_id,
    direction: payload.direction,
    connectionId: payload.connection_id,
    from: payload.from,
    to: payload.to,
    originalEvent: event
  };
}

// ---------------------------------------------------------
// TELEPHONY OPERATIONS ADAPTER
// ---------------------------------------------------------
async function answerCall(callId) {
  if (telnyx) await telnyx.calls.actions.answer(callId);
}

async function dialBuyer(to, from, connectionId, timeoutSecs) {
  if (telnyx) {
    const res = await telnyx.calls.create({ to, from, connection_id: connectionId, timeout_secs: timeoutSecs });
    return res.data.call_control_id;
  }
  // Fallback for tests if not mocked
  return 'mock_buyer_leg_id';
}

async function bridgeCalls(callId, buyerCallId) {
  if (telnyx) await telnyx.calls.actions.bridge(callId, { call_control_id: buyerCallId });
}

async function hangupCall(callId) {
  if (telnyx) {
    try { await telnyx.calls.actions.hangup(callId); } catch (e) {}
  }
}

module.exports = {
  constructWebhookEvent,
  normalizeEvent,
  answerCall,
  dialBuyer,
  bridgeCalls,
  hangupCall
};
