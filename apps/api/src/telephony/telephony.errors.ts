export enum TelephonyErrorType {
  PROVIDER_UNAVAILABLE = 'PROVIDER_UNAVAILABLE',
  INVALID_CALL_STATE = 'INVALID_CALL_STATE',
  ROUTING_FAILED = 'ROUTING_FAILED',
  UNAUTHORIZED = 'UNAUTHORIZED',
  UNKNOWN = 'UNKNOWN',
}

export class TelephonyProviderError extends Error {
  constructor(
    public readonly type: TelephonyErrorType,
    message: string,
    public readonly originalError?: Error | unknown,
  ) {
    super(message);
    this.name = 'TelephonyProviderError';
  }
}
