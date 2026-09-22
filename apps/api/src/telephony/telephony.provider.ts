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
  ): Promise<string>;

  /**
   * Bridge two calls together (e.g., caller and buyer).
   */
  bridgeCalls(callId: string, buyerCallId: string): Promise<void>;

  /**
   * Hang up a call.
   */
  hangupCall(callId: string): Promise<void>;

  /**
   * Start recording a call.
   */
  startRecording(callId: string): Promise<void>;

  /**
   * Get a temporary authorized download URL for a recording.
   */
  getRecordingUrl(recordingId: string): Promise<string>;
}
