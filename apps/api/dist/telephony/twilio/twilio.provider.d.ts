import type { TelephonyProvider } from '../telephony.provider.js';
import { CallController } from '../call-controller.js';
export declare class TwilioProvider implements TelephonyProvider {
    private readonly callController;
    private readonly logger;
    private readonly client;
    private readonly baseUrl;
    constructor(callController: CallController);
    getInitialTwiML(callSid: string): string;
    validateWebhook(signature: string, url: string, body: any): boolean;
    answerCall(callId: string): Promise<void>;
    dialBuyer(to: string, from: string, connectionId: string, timeoutSecs: number): Promise<string>;
    bridgeCalls(callId: string, buyerCallId: string): Promise<void>;
    hangupCall(callId: string): Promise<void>;
    startRecording(callId: string): Promise<void>;
    getRecordingUrl(recordingId: string): Promise<string>;
}
