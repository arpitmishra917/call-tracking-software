const express = require('express');
const config = require('./config');
const { constructWebhookEvent } = require('./telnyxProvider');
const { processWebhook } = require('./webhookHandler');

const app = express();

// Telnyx webhooks must be parsed as raw buffers for signature verification to work.
// We only apply this to the /webhooks route.
app.post('/webhooks', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['telnyx-signature-ed25519'];
  const timestamp = req.headers['telnyx-timestamp'];
  
  if (!signature || !timestamp) {
    return res.status(400).send('Missing Telnyx webhook headers');
  }

  let event;
  try {
    // 1. Verify Signature and Construct Event
    event = await constructWebhookEvent(req.body, signature, timestamp);
  } catch (err) {
    console.error(`[WEBHOOK] Signature verification failed: ${err.message}`);
    // Reject invalid signature
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    // 2. Process Idempotently
    const result = await processWebhook(event);
    
    // Always acknowledge valid webhooks quickly
    return res.status(200).json(result);
  } catch (err) {
    console.error(`[WEBHOOK] Processing failed: ${err.message}`);
    return res.status(500).send('Internal Server Error');
  }
});

// --- TWILIO ---
app.post('/webhooks/twilio', express.urlencoded({ extended: true }), async (req, res) => {
  const twilioProvider = require('./twilioProvider');
  const signature = req.headers['x-twilio-signature'];
  
  if (config.twilioAuthToken && signature) {
    const fullUrl = (config.baseUrl || `https://${req.hostname}`) + req.originalUrl;
    if (!twilioProvider.validateWebhook(req, fullUrl)) {
      return res.status(400).send('Invalid Twilio signature');
    }
  }

  // Synthesize a unique ID for idempotency
  // Voice URL doesn't have SequenceNumber, StatusCallback does
  const seq = req.body.SequenceNumber || 'voice';
  const eventId = `tw_${req.body.CallSid}_${req.body.CallStatus}_${seq}`;

  const normalizedEvent = twilioProvider.normalizeEvent(req.body);
  normalizedEvent.id = eventId; // attach ID for webhookHandler
  
  try {
    await processWebhook(normalizedEvent, true); 
  } catch(err) {
    console.error(`[TWILIO WEBHOOK] Error: ${err.message}`);
  }

  // Twilio ALWAYS expects TwiML in response to voice requests.
  // For the initial inbound call, we immediately place the caller into a Conference.
  // This allows outbound buyer calls to join the same conference instantly.
  res.type('text/xml');
  if (req.body.CallStatus === 'ringing' || req.body.CallStatus === 'queued') {
    const twiml = twilioProvider.getInitialTwiML(req.body.CallSid);
    res.send(twiml);
  } else {
    // For StatusCallback events, Twilio ignores the response body.
    res.send('<Response></Response>');
  }
});

// Start server if not running tests
if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`Server listening on port ${config.port}`);
  });
}

module.exports = app;
