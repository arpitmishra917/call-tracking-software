// In-memory store for Stage 1 idempotency
// In production, this would be Redis or a Database
const processedEvents = new Set();

/**
 * Handles verified Telnyx webhooks
 * @param {Object} event - The verified Telnyx event object
 * @returns {Promise<Object>} Result of processing
 */
async function processWebhook(event, isNormalized = false) {
  let eventId, eventType, normalizedEvent;

  if (isNormalized) {
    eventId = event.id;
    eventType = event.type;
    normalizedEvent = event;
  } else {
    eventId = event.data?.id || event.id;
    eventType = event.data?.event_type || event.type;
    const telnyxProvider = require('./telnyxProvider');
    normalizedEvent = telnyxProvider.normalizeEvent(event);
  }

  // 1. Idempotency Check
  if (!eventId) {
    console.warn(`[WEBHOOK] Received event without an ID`, eventType);
    return { status: 'ignored', reason: 'missing_id' };
  }

  if (processedEvents.has(eventId)) {
    console.log(`[WEBHOOK] Duplicate event ignored: ${eventId}`);
    return { status: 'ignored', reason: 'duplicate' };
  }

  // Mark as processed
  processedEvents.add(eventId);

  // 2. Event Routing / Logging
  const occurredAt = isNormalized ? new Date().toISOString() : (event.data?.occurred_at || event.occurred_at);
  console.log(`[WEBHOOK] Processing event: ${eventType}`, {
    event_id: eventId,
    occurred_at: occurredAt,
  });

  // Call the Call Controller
  try {
    const callController = require('./callController');
    await callController.handleEvent(normalizedEvent);
  } catch (err) {
    console.error(`[WEBHOOK] Routing Error: ${err.message}`);
    return { status: 'error', reason: err.message };
  }
  
  return { status: 'processed', type: eventType, id: eventId };
}

// For testing purposes
function clearProcessedEvents() {
  processedEvents.clear();
}

module.exports = {
  processWebhook,
  clearProcessedEvents
};
