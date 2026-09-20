const config = require('./config');

let cachedAdapter = null;
function getAdapter() {
  if (!cachedAdapter) {
    cachedAdapter = config.telephonyProvider === 'twilio' 
      ? require('./twilioProvider') 
      : require('./telnyxProvider');
  }
  return cachedAdapter;
}

const TelephonyProvider = {
  answerCall: async (callId) => getAdapter().answerCall(callId),
  dialBuyer: async (to, from, connectionId, timeoutSecs) => getAdapter().dialBuyer(to, from, connectionId, timeoutSecs),
  bridgeCalls: async (callId, buyerCallId) => getAdapter().bridgeCalls(callId, buyerCallId),
  hangupCall: async (callId) => getAdapter().hangupCall(callId)
};

module.exports = TelephonyProvider;
