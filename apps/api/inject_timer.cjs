const fs = require('fs');
let s = fs.readFileSync('apps/api/src/telephony/call-controller.ts', 'utf8');

const classVars = `  private readonly logger = new Logger(CallController.name);
  private activeCallTimers = new Map<string, any>();`;

s = s.replace(/private readonly logger = new Logger\(CallController\.name\);/, classVars);

const scheduleFunc = `
  private scheduleAuthorizationExtension(
    workspaceId: string,
    callId: string,
    providerCallId: string,
    numberType: string | null | undefined,
  ) {
    const blockMicro = this.usageBillingService.calculateInitialReservation(numberType);
    const blockMinutes = 10;
    const triggerPercent = 0.8;
    const triggerMs = blockMinutes * 60 * 1000 * triggerPercent;

    const scheduleNext = (extensionIndex: number) => {
      const timer = setTimeout(async () => {
        try {
          const call = await this.prisma.call.findUnique({ where: { id: callId } });
          if (!call || call.state === 'COMPLETED' || call.state === 'CANCELED' || call.state === 'FAILED') {
            this.activeCallTimers.delete(callId);
            return;
          }

          const idempotencyKey = \`extension:\${callId}:\${extensionIndex}\`;
          
          this.logger.log(\`reservation.extension.requested: Call \${callId} extending block \${extensionIndex}, workspace: \${workspaceId}, amount: \${blockMicro}\`);
          
          const result = await this.walletService.extendReservationForCall(
            workspaceId,
            callId,
            blockMicro,
            idempotencyKey
          );
          
          this.logger.log(\`reservation.extension.succeeded: Call \${callId}, reserved \${result.totalReservedMicro}, available \${result.availableMicro}\`);
          
          scheduleNext(extensionIndex + 1);

        } catch (e: any) {
          if (e.message.includes('Insufficient available funds')) {
             this.logger.warn(\`reservation.extension.insufficient_funds: Call \${callId}, hanging up provider call.\`);
             this.logger.warn(\`call.authorization.exhausted: callId=\${callId}\`);
             this.logger.warn(\`call.authorization.hangup_requested: callId=\${callId}\`);
             
             await this.provider.hangupCall(providerCallId).catch(err => {
                this.logger.error(\`Failed to hangup exhausted call \${callId}: \${err.message}\`);
             });
             this.activeCallTimers.delete(callId);
          } else if (e.message.includes('already applied') || e.message.includes('already')) {
             this.logger.warn(\`reservation.extension.duplicate: \${e.message}\`);
             scheduleNext(extensionIndex + 1);
          } else if (e.message.includes('non-ACTIVE')) {
             this.activeCallTimers.delete(callId);
          } else {
             this.logger.error(\`reservation.extension.failed: Call \${callId}, error: \${e.message}\`);
             this.activeCallTimers.delete(callId);
          }
        }
      }, triggerMs);

      this.activeCallTimers.set(callId, timer);
    };

    scheduleNext(1);
  }

  async handleEvent(event: NormalizedCallEvent): Promise<void> {`;

s = s.replace(/async handleEvent\(event: NormalizedCallEvent\): Promise<void> \{/, scheduleFunc);

const bridgeCallBlock = `        await this.provider.bridgeCalls(
          call.provider_call_id,
          attempt.provider_call_id!,
        );

        // --- PHASE 3E: Start Extension Timer ---
        const trackingNumInfo = await this.prisma.phoneNumber.findFirst({
          where: { phone_number: call.to_number, workspace_id: call.workspace_id }
        });
        this.scheduleAuthorizationExtension(call.workspace_id, call.id, call.provider_call_id, trackingNumInfo?.number_type);
        // ---------------------------------------

        return;`;

s = s.replace(/await this\.provider\.bridgeCalls\([\s\S]*?\);[\s\S]*?return;/, bridgeCallBlock);

const hangupBlock = `      if (type === CallEventType.CALL_HANGUP) {
        // --- PHASE 3E: Clear Timer ---
        const timer = this.activeCallTimers.get(callId);
        if (timer) {
          clearTimeout(timer);
          this.activeCallTimers.delete(callId);
        }
        // -----------------------------`;

s = s.replace(/if \(type === CallEventType\.CALL_HANGUP\) \{/, hangupBlock);

fs.writeFileSync('apps/api/src/telephony/call-controller.ts', s);
