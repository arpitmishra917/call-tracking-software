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

  // --- Fake Provider specific methods for testing ---
  private mockedStatuses = new Map<string, 'ACTIVE' | 'TERMINAL' | 'NOT_FOUND' | 'UNKNOWN'>();
  
  mockCallStatus(callId: string, status: 'ACTIVE' | 'TERMINAL' | 'NOT_FOUND' | 'UNKNOWN') {
    this.mockedStatuses.set(callId, status);
  }

  async getCallStatus(callId: string): Promise<'ACTIVE' | 'TERMINAL' | 'NOT_FOUND' | 'UNKNOWN'> {
    return this.mockedStatuses.get(callId) || 'UNKNOWN';
  }

  getActions(): FakeProviderAction[] {
    return this.actions;
  }

  clearActions(): void {
    this.actions = [];
    this.nextBuyerCallId = 1;
    this.mockedStatuses.clear();
  }
}
