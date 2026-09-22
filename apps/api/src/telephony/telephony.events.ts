export enum CallEventType {
  CALL_INITIATED = 'CALL_INITIATED',
  CALL_ANSWERED = 'CALL_ANSWERED',
  CALL_HANGUP = 'CALL_HANGUP',
  CALL_RECORDING_SAVED = 'CALL_RECORDING_SAVED',
}

export interface NormalizedCallEvent {
  type: CallEventType;
  callId: string;
  direction?: 'incoming' | 'outgoing';
  connectionId?: string;
  from?: string;
  to?: string;
  timestamp: string; // ISO string
  recordingId?: string;
  recordingUrl?: string;
}
