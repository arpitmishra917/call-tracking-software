export var TelephonyErrorType;
(function (TelephonyErrorType) {
    TelephonyErrorType["PROVIDER_UNAVAILABLE"] = "PROVIDER_UNAVAILABLE";
    TelephonyErrorType["INVALID_CALL_STATE"] = "INVALID_CALL_STATE";
    TelephonyErrorType["ROUTING_FAILED"] = "ROUTING_FAILED";
    TelephonyErrorType["UNAUTHORIZED"] = "UNAUTHORIZED";
    TelephonyErrorType["UNKNOWN"] = "UNKNOWN";
})(TelephonyErrorType || (TelephonyErrorType = {}));
export class TelephonyProviderError extends Error {
    type;
    originalError;
    constructor(type, message, originalError) {
        super(message);
        this.type = type;
        this.originalError = originalError;
        this.name = 'TelephonyProviderError';
    }
}
//# sourceMappingURL=telephony.errors.js.map