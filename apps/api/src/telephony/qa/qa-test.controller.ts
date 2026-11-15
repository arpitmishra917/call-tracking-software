import {
  Controller,
  Post,
  Get,
  Body,
  ForbiddenException,
  Logger,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { QaOrchestratorService } from './qa-orchestrator.service.js';
import type { QaRunOptions, QaRunResult } from './qa-orchestrator.service.js';
import { QaTelephonyGuardService } from './qa-telephony-guard.service.js';
import { QaAuthGuard } from './qa-auth.guard.js';

@Controller('qa')
@UseGuards(QaAuthGuard)
export class QaTestController {
  private readonly logger = new Logger(QaTestController.name);

  constructor(
    private readonly orchestrator: QaOrchestratorService,
    private readonly qaGuardService: QaTelephonyGuardService,
  ) {}

  @Get('status')
  getStatus() {
    const isQaEnabled = this.qaGuardService.isQaEnabled();
    const configCheck = this.qaGuardService.validateConfiguration();
    return {
      qaEnabled: isQaEnabled,
      configValid: configCheck.valid,
      configErrors: configCheck.errors,
      activeRun: this.orchestrator.getActiveRun(),
    };
  }

  @Post('lease')
  @HttpCode(HttpStatus.OK)
  openLease(@Body() body: Record<string, any> = {}) {
    if (!this.qaGuardService.isQaEnabled()) {
      this.logger.warn('Rejected QA lease: TELEPHONY_QA_ENABLED is false');
      throw new ForbiddenException('TELEPHONY_QA_ENABLED is false');
    }

    const configCheck = this.qaGuardService.validateConfiguration();
    if (!configCheck.valid) {
      this.logger.error(`Rejected QA lease: invalid configuration (${configCheck.errors.join('; ')})`);
      throw new ForbiddenException(`QA Configuration invalid: ${configCheck.errors.join('; ')}`);
    }

    const runId = body.runId || crypto.randomUUID();
    const secretToken = body.secretToken || crypto.randomBytes(32).toString('hex');
    const ttlMs = body.ttlMs || 120000;

    this.qaGuardService.registerActiveTestRun(runId, { secretToken, ttlMs });
    const lease = this.qaGuardService.openInboundTestLease({
      runId,
      secretToken,
      expectedCallerCli: body.callerCli,
      expectedCallerSipUri: body.callerSipUri,
      expectedConnectionId: body.expectedConnectionId || process.env.TELNYX_QA_CALL_CONTROL_APP_ID?.trim(),
      ttlMs,
    });

    return {
      success: true,
      runId,
      leaseId: lease.leaseId,
      secretToken,
      expiresAt: lease.expiresAt,
    };
  }

  @Post('release-binding')
  @HttpCode(HttpStatus.OK)
  releaseBinding(@Body() body: Record<string, any> = {}) {
    if (body.callId) {
      this.qaGuardService.releaseCallBinding(body.callId);
    }
    if (body.runId) {
      this.qaGuardService.unregisterActiveTestRun(body.runId);
    }
    return { success: true };
  }

  @Post('test-run')
  @HttpCode(HttpStatus.OK)
  async executeTestRun(@Body() body: Record<string, any> = {}): Promise<QaRunResult> {
    if (!this.qaGuardService.isQaEnabled()) {
      this.logger.warn('Rejected QA test-run: TELEPHONY_QA_ENABLED is false');
      throw new ForbiddenException('TELEPHONY_QA_ENABLED is false');
    }

    const configCheck = this.qaGuardService.validateConfiguration();
    if (!configCheck.valid) {
      this.logger.error(`Rejected QA test-run: invalid configuration (${configCheck.errors.join('; ')})`);
      throw new ForbiddenException(`QA Configuration invalid: ${configCheck.errors.join('; ')}`);
    }

    const options: QaRunOptions = {
      trackingDid: body.trackingDid,
      callerCli: body.callerCli,
      callerSipUri: body.callerSipUri,
      expectedConnectionId: body.expectedConnectionId,
      targetToneFreq: body.targetToneFreq,
      minDurationSecs: body.minDurationSecs,
      minSnrDb: body.minSnrDb,
      skipMediaAnalysis: body.skipMediaAnalysis,
      preserveRecordings: body.preserveRecordings ?? true,
      maxDurationMs: body.maxDurationMs,
      postPlaybackCaptureMs: body.postPlaybackCaptureMs,
    };

    this.logger.log(`qa.controller: Executing controlled QA test run with options: ${JSON.stringify(options)}`);
    return await this.orchestrator.executeTestRun(options);
  }
}
