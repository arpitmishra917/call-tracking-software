export class FakeTelephonyProvider {
    actions = [];
    nextBuyerCallId = 1;
    async answerCall(callId) {
        this.actions.push({ action: 'answer', callId, timestamp: Date.now() });
    }
    async dialBuyer(to, from, connectionId, timeoutSecs) {
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
    async bridgeCalls(callId, buyerCallId) {
        this.actions.push({
            action: 'bridge',
            callId,
            buyerCallId,
            timestamp: Date.now(),
        });
    }
    async hangupCall(callId) {
        this.actions.push({ action: 'hangup', callId, timestamp: Date.now() });
    }
    async startRecording(callId) {
        this.actions.push({
            action: 'startRecording',
            callId,
            timestamp: Date.now(),
        });
    }
    async getRecordingUrl(recordingId) {
        return `https://fake.recording.url/${recordingId}.mp3`;
    }
    getActions() {
        return this.actions;
    }
    clearActions() {
        this.actions = [];
        this.nextBuyerCallId = 1;
    }
}
//# sourceMappingURL=fake.provider.js.map