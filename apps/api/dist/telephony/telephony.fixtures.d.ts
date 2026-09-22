import { NormalizedCallEvent } from './telephony.events.js';
export declare const mockCallId = "call-12345";
export declare const mockConnectionId = "conn-98765";
export declare const mockFrom = "+15551234567";
export declare const mockTo = "+15559876543";
export declare const telephonyFixtures: {
    incomingCallInitiated: () => NormalizedCallEvent;
    callAnswered: (callId?: string) => NormalizedCallEvent;
    callHangup: (callId?: string) => NormalizedCallEvent;
};
