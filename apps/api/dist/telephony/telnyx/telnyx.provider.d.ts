import { TelephonyProvider } from '../telephony.provider.js';
export declare class TelnyxProvider implements TelephonyProvider {
    private readonly logger;
    private telnyxClient;
    constructor();
    answerCall(callId: string): Promise<void>;
    dialBuyer(to: string, from: string, connectionId: string, timeoutSecs: number): Promise<string>;
    bridgeCalls(callId: string, buyerCallId: string): Promise<void>;
    hangupCall(callId: string): Promise<void>;
    startRecording(callId: string): Promise<void>;
    getRecordingUrl(recordingId: string): Promise<string>;
}
