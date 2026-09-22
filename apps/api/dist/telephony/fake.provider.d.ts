import { TelephonyProvider } from './telephony.provider.js';
export type FakeProviderAction = {
    action: 'answer' | 'dial' | 'bridge' | 'hangup' | 'startRecording';
    callId?: string;
    to?: string;
    from?: string;
    connectionId?: string;
    timeoutSecs?: number;
    buyerCallId?: string;
    timestamp: number;
};
export declare class FakeTelephonyProvider implements TelephonyProvider {
    private actions;
    private nextBuyerCallId;
    answerCall(callId: string): Promise<void>;
    dialBuyer(to: string, from: string, connectionId: string, timeoutSecs: number): Promise<string>;
    bridgeCalls(callId: string, buyerCallId: string): Promise<void>;
    hangupCall(callId: string): Promise<void>;
    startRecording(callId: string): Promise<void>;
    getRecordingUrl(recordingId: string): Promise<string>;
    getActions(): FakeProviderAction[];
    clearActions(): void;
}
