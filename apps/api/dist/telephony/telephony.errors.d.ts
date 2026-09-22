export declare enum TelephonyErrorType {
    PROVIDER_UNAVAILABLE = "PROVIDER_UNAVAILABLE",
    INVALID_CALL_STATE = "INVALID_CALL_STATE",
    ROUTING_FAILED = "ROUTING_FAILED",
    UNAUTHORIZED = "UNAUTHORIZED",
    UNKNOWN = "UNKNOWN"
}
export declare class TelephonyProviderError extends Error {
    readonly type: TelephonyErrorType;
    readonly originalError?: (Error | unknown) | undefined;
    constructor(type: TelephonyErrorType, message: string, originalError?: (Error | unknown) | undefined);
}
