require('dotenv').config();

module.exports = {
  telephonyProvider: process.env.TELEPHONY_PROVIDER || 'telnyx',
  telnyxApiKey: process.env.TELNYX_API_KEY,
  telnyxPublicKey: process.env.TELNYX_PUBLIC_KEY,
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
  baseUrl: process.env.BASE_URL,
  port: process.env.PORT || 3000,
};
