import { CallEventType, NormalizedCallEvent } from './telephony.events.js';

export const mockCallId = 'call-12345';
export const mockConnectionId = 'conn-98765';
export const mockFrom = '+15551234567';
export const mockTo = '+15559876543';

export const telephonyFixtures = {
  incomingCallInitiated: (): NormalizedCallEvent => ({
    type: CallEventType.CALL_INITIATED,
    callId: mockCallId,
    direction: 'incoming',
    connectionId: mockConnectionId,
    from: mockFrom,
    to: mockTo,
    timestamp: new Date().toISOString(),
  }),

  callAnswered: (callId: string = mockCallId): NormalizedCallEvent => ({
    type: CallEventType.CALL_ANSWERED,
    callId,
    timestamp: new Date().toISOString(),
  }),

  callHangup: (callId: string = mockCallId): NormalizedCallEvent => ({
    type: CallEventType.CALL_HANGUP,
    callId,
    timestamp: new Date().toISOString(),
  }),
};
