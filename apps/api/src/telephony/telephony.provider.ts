export type ProviderCallStatus = 'ACTIVE' | 'TERMINAL' | 'NOT_FOUND' | 'UNKNOWN';

/**
 * Utility to identify synthetic provider call IDs generated for tests.
 */
export function isSyntheticProviderCallId(callId?: string | null): boolean {
  if (!callId) return false;
  return (
    callId.startsWith('mock_') ||
    callId.startsWith('fake_') ||
    callId.startsWith('recovery-mock-') ||
    callId.startsWith('test_')
  );
}

export interface TelephonyProvider {
  /**
   * Answer an incoming call.
   */
  answerCall(callId: string): Promise<void>;

  /**
   * Dial a buyer.
   * Returns the newly created buyer call ID.
   */
  dialBuyer(
    to: string,
    from: string,
    connectionId: string,
    timeoutSecs: number,
    clientState?: string,
    customHeaders?: Array<{ name: string; value: string }>,
  ): Promise<string>;

  /**
   * Bridge two calls together (e.g., caller and buyer).
   */
  bridgeCalls(callId: string, buyerCallId: string): Promise<void>;

  /**
   * Hang up a call.
   */
  hangupCall(callId: string, reason?: 'BUSY' | 'NORMAL'): Promise<void>;

  /**
   * Play ringback tone audio to a call leg while waiting for buyer.
   */
  startRingback?(callId: string, ringbackUrl?: string): Promise<void>;

  /**
   * Stop ringback tone audio on a call leg.
   */
  stopRingback?(callId: string): Promise<void>;

  /**
   * Start recording a call.
   */
  startRecording(callId: string): Promise<void>;

  /**
   * Get a temporary authorized download URL for a recording.
   */
  getRecordingUrl(recordingId: string): Promise<string>;

  /**
   * Get the current live status of a call from the provider.
   */
  getCallStatus(callId: string): Promise<ProviderCallStatus>;

  /**
   * Determine whether a call ID is a synthetic/test ID for this provider.
   */
  isSyntheticCallId?(callId?: string): boolean;
}
