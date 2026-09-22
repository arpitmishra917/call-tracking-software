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

export class FakeTelephonyProvider implements TelephonyProvider {
  private actions: FakeProviderAction[] = [];
  private nextBuyerCallId = 1;

  async answerCall(callId: string): Promise<void> {
    this.actions.push({ action: 'answer', callId, timestamp: Date.now() });
  }

  async dialBuyer(
    to: string,
    from: string,
    connectionId: string,
    timeoutSecs: number,
  ): Promise<string> {
    const buyerCallId = `fake-buyer-call-${this.nextBuyerCallId++}`;
    this.actions.push({
      action: 'dial',
      to,
      from,
      connectionId,
      timeoutSecs,
      buyerCallId,
      timestamp: Date.now(),
    });
    return buyerCallId;
  }

  async bridgeCalls(callId: string, buyerCallId: string): Promise<void> {
    this.actions.push({
      action: 'bridge',
      callId,
      buyerCallId,
      timestamp: Date.now(),
    });
  }

  async hangupCall(callId: string): Promise<void> {
    this.actions.push({ action: 'hangup', callId, timestamp: Date.now() });
  }

  async startRecording(callId: string): Promise<void> {
    this.actions.push({
      action: 'startRecording',
      callId,
      timestamp: Date.now(),
    });
  }

  async getRecordingUrl(recordingId: string): Promise<string> {
    return `https://fake.recording.url/${recordingId}.mp3`;
  }

  getActions(): FakeProviderAction[] {
    return this.actions;
  }

  clearActions(): void {
    this.actions = [];
    this.nextBuyerCallId = 1;
  }
}
