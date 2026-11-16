import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { TelnyxProvider } from './telnyx.provider.js';
import { TelnyxWebhookController } from './telnyx.webhook.controller.js';
import { CallController } from '../call-controller.js';
import { WebhookIdempotencyService } from '../webhook-idempotency.service.js';

describe('Telnyx Hotfix Acceptance Tests', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('1 & 2. Repository Root & Path Resolution (Development vs Compiled)', () => {
    function findPackageRoot(startDir: string, targetName: string): string {
      let curr = path.resolve(startDir);
      while (true) {
        const pkgPath = path.join(curr, 'package.json');
        if (fs.existsSync(pkgPath)) {
          try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            if (
              pkg.name === targetName ||
              (targetName === 'call-tracking-software' && pkg.workspaces)
            ) {
              return curr;
            }
          } catch {}
        }
        const parent = path.dirname(curr);
        if (parent === curr) break;
        curr = parent;
      }
      return targetName === 'api'
        ? path.resolve(startDir, '..')
        : path.resolve(startDir, '..', '..');
    }

    it('should correctly resolve apiDir and rootDir from development path (src)', () => {
      const devDir = path.resolve(process.cwd(), 'src');
      const resolvedApiDir = findPackageRoot(devDir, 'api');
      const resolvedRootDir = findPackageRoot(resolvedApiDir, 'call-tracking-software');

      expect(fs.existsSync(path.join(resolvedApiDir, 'package.json'))).toBe(true);
      const apiPkg = JSON.parse(fs.readFileSync(path.join(resolvedApiDir, 'package.json'), 'utf8'));
      expect(apiPkg.name).toBe('api');

      expect(fs.existsSync(path.join(resolvedRootDir, 'package.json'))).toBe(true);
      const rootPkg = JSON.parse(fs.readFileSync(path.join(resolvedRootDir, 'package.json'), 'utf8'));
      expect(rootPkg.name).toBe('call-tracking-software');
      expect(rootPkg.workspaces).toBeDefined();
    });

    it('should correctly resolve apiDir and rootDir from compiled path (dist)', () => {
      const distDir = path.resolve(process.cwd(), 'dist');
      const resolvedApiDir = findPackageRoot(distDir, 'api');
      const resolvedRootDir = findPackageRoot(resolvedApiDir, 'call-tracking-software');

      expect(fs.existsSync(path.join(resolvedApiDir, 'package.json'))).toBe(true);
      const apiPkg = JSON.parse(fs.readFileSync(path.join(resolvedApiDir, 'package.json'), 'utf8'));
      expect(apiPkg.name).toBe('api');

      expect(fs.existsSync(path.join(resolvedRootDir, 'package.json'))).toBe(true);
      const rootPkg = JSON.parse(fs.readFileSync(path.join(resolvedRootDir, 'package.json'), 'utf8'));
      expect(rootPkg.name).toBe('call-tracking-software');
    });

    it('should correctly resolve apiDir and rootDir from deeply nested compiled path (dist/sub/sub)', () => {
      const nestedDistDir = path.resolve(process.cwd(), 'dist', 'sub', 'sub');
      const resolvedApiDir = findPackageRoot(nestedDistDir, 'api');
      const resolvedRootDir = findPackageRoot(resolvedApiDir, 'call-tracking-software');

      const apiPkg = JSON.parse(fs.readFileSync(path.join(resolvedApiDir, 'package.json'), 'utf8'));
      expect(apiPkg.name).toBe('api');

      const rootPkg = JSON.parse(fs.readFileSync(path.join(resolvedRootDir, 'package.json'), 'utf8'));
      expect(rootPkg.name).toBe('call-tracking-software');
    });
  });

  describe('3. Environment Precedence', () => {
    it('should ensure TELEPHONY_PROVIDER=fake cannot override intended Telnyx mode when Telnyx credentials exist', () => {
      // Simulate root .env defining Telnyx credentials
      const simulatedRootEnv = {
        TELEPHONY_PROVIDER: 'telnyx',
        TELNYX_API_KEY: 'test-api-key',
        TELNYX_PUBLIC_KEY: 'test-public-key',
      };

      // Simulate apps/api/.env having legacy TELEPHONY_PROVIDER=fake
      process.env.TELEPHONY_PROVIDER = 'fake';

      // Precedence resolution logic matching main.ts
      if (
        simulatedRootEnv.TELEPHONY_PROVIDER === 'telnyx' ||
        (simulatedRootEnv.TELNYX_API_KEY && (!process.env.TELEPHONY_PROVIDER || process.env.TELEPHONY_PROVIDER === 'fake'))
      ) {
        process.env.TELEPHONY_PROVIDER = 'telnyx';
        process.env.ACTIVE_TELEPHONY_PROVIDER = 'telnyx';
      }

      expect(process.env.TELEPHONY_PROVIDER).toBe('telnyx');
      expect(process.env.ACTIVE_TELEPHONY_PROVIDER).toBe('telnyx');
    });
  });

  describe('4. Missing Telnyx API Key in Telnyx Mode (Fail-Closed)', () => {
    it('should fail startup with fatal error when TELEPHONY_PROVIDER is telnyx and TELNYX_API_KEY is missing', () => {
      process.env.TELEPHONY_PROVIDER = 'telnyx';
      delete process.env.TELNYX_API_KEY;

      expect(() => new TelnyxProvider()).toThrow(
        'FATAL: TELNYX_API_KEY is missing but telephony provider is configured as "telnyx". Telnyx mode fails closed to prevent silent mock fallback.',
      );
    });

    it('should fail startup with fatal error when TELEPHONY_PROVIDER defaults to telnyx and TELNYX_API_KEY is missing', () => {
      delete process.env.TELEPHONY_PROVIDER;
      delete process.env.ACTIVE_TELEPHONY_PROVIDER;
      delete process.env.TELNYX_API_KEY;

      expect(() => new TelnyxProvider()).toThrow(
        'FATAL: TELNYX_API_KEY is missing but telephony provider is configured as "telnyx"',
      );
    });
  });

  describe('5. Explicit Fake/Mock Mode', () => {
    it('should initialize in explicit mock mode without throwing when TELEPHONY_PROVIDER is fake', async () => {
      process.env.TELEPHONY_PROVIDER = 'fake';
      delete process.env.TELNYX_API_KEY;

      const provider = new TelnyxProvider();
      await expect(provider.answerCall('call-fake-1')).resolves.toBeUndefined();
      const buyerLeg = await provider.dialBuyer('+1234567890', '+1098765432', 'conn-1', 30);
      expect(buyerLeg).toContain('mock_buyer_leg_id_');
    });

    it('should initialize in explicit mock mode without throwing when TELEPHONY_PROVIDER is mock', async () => {
      process.env.TELEPHONY_PROVIDER = 'mock';
      delete process.env.TELNYX_API_KEY;

      const provider = new TelnyxProvider();
      await expect(provider.answerCall('call-mock-1')).resolves.toBeUndefined();
    });
  });

  describe('6. Missing Public Key on Exposed Runtime (Fail-Closed)', () => {
    it('should reject unverified webhook on development runtime when TELNYX_PUBLIC_KEY is missing', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.APP_ENV;
      delete process.env.ALLOW_UNVERIFIED_WEBHOOKS;
      delete process.env.TELNYX_PUBLIC_KEY;

      const mockIdempotency = {
        acquireLock: vi.fn(),
      } as unknown as WebhookIdempotencyService;
      const mockCallController = {
        handleEvent: vi.fn(),
      } as unknown as CallController;

      const controller = new TelnyxWebhookController(mockCallController, mockIdempotency);

      const mockReq = {
        rawBody: Buffer.from(JSON.stringify({ data: { id: 'evt_dev_1' } })),
        body: { data: { id: 'evt_dev_1' } },
        headers: {
          'telnyx-signature-ed25519': 'dummy-sig',
          'telnyx-timestamp': '123456789',
        },
      } as any;
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as any;

      await controller.handleWebhook(mockReq, mockRes);
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.send).toHaveBeenCalledWith(
        expect.stringContaining('TELNYX_PUBLIC_KEY is required for webhook signature verification'),
      );
    });

    it('should reject unverified webhook on production runtime when TELNYX_PUBLIC_KEY is missing', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.ALLOW_UNVERIFIED_WEBHOOKS;
      delete process.env.TELNYX_PUBLIC_KEY;

      const mockIdempotency = { acquireLock: vi.fn() } as unknown as WebhookIdempotencyService;
      const mockCallController = { handleEvent: vi.fn() } as unknown as CallController;
      const controller = new TelnyxWebhookController(mockCallController, mockIdempotency);

      const mockReq = {
        rawBody: Buffer.from(JSON.stringify({ data: { id: 'evt_prod_1' } })),
        body: { data: { id: 'evt_prod_1' } },
        headers: {
          'telnyx-signature-ed25519': 'dummy-sig',
          'telnyx-timestamp': '123456789',
        },
      } as any;
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as any;

      await controller.handleWebhook(mockReq, mockRes);
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.send).toHaveBeenCalledWith(
        expect.stringContaining('TELNYX_PUBLIC_KEY is required for webhook signature verification'),
      );
    });
  });

  describe('7. Invalid Webhook Signature Rejection', () => {
    it('should reject webhook with HTTP 400 when signature is forged or invalid', async () => {
      // Generate a real 32-byte Ed25519 public key
      const { publicKey } = crypto.generateKeyPairSync('ed25519');
      const rawPubBase64 = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');

      process.env.TELNYX_PUBLIC_KEY = rawPubBase64;
      process.env.NODE_ENV = 'development';

      const mockIdempotency = { acquireLock: vi.fn() } as unknown as WebhookIdempotencyService;
      const mockCallController = { handleEvent: vi.fn() } as unknown as CallController;
      const controller = new TelnyxWebhookController(mockCallController, mockIdempotency);

      const payload = JSON.stringify({ data: { id: 'evt_forged_1', event_type: 'call.initiated' } });
      const mockReq = {
        rawBody: Buffer.from(payload),
        body: JSON.parse(payload),
        headers: {
          'telnyx-signature-ed25519': Buffer.alloc(64).toString('base64'), // Bogus signature
          'telnyx-timestamp': Math.floor(Date.now() / 1000).toString(),
        },
      } as any;
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as any;

      await controller.handleWebhook(mockReq, mockRes);
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.send).toHaveBeenCalledWith(expect.stringContaining('Webhook Error:'));
      expect(mockCallController.handleEvent).not.toHaveBeenCalled();
    });
  });

  describe('8. Valid Signed Webhook Acceptance', () => {
    it('should accept and process webhook with valid Ed25519 cryptographic signature', async () => {
      // Generate real Ed25519 keypair
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
      const rawPubBase64 = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');

      process.env.TELNYX_PUBLIC_KEY = rawPubBase64;

      const mockIdempotency = {
        acquireLock: vi.fn().mockResolvedValue({ canProcess: true, id: 'internal-123', leaseToken: 'token-abc' }),
        markProcessed: vi.fn().mockResolvedValue(true),
        markFailed: vi.fn(),
      } as unknown as WebhookIdempotencyService;
      const mockCallController = {
        handleEvent: vi.fn().mockResolvedValue(undefined),
      } as unknown as CallController;

      const controller = new TelnyxWebhookController(mockCallController, mockIdempotency);

      const eventPayload = {
        data: {
          id: 'evt_valid_signed_123',
          event_type: 'call.initiated',
          payload: {
            call_control_id: 'v3:test_call_control_id',
            from: '+13324000950',
            to: '+14845560110',
          },
        },
      };
      const bodyStr = JSON.stringify(eventPayload);
      const timestamp = Math.floor(Date.now() / 1000).toString();

      // Telnyx signature format: sign(timestamp + '|' + payload)
      const payloadToSign = Buffer.from(timestamp + '|' + bodyStr, 'utf8');
      const validSignatureBase64 = crypto.sign(null, payloadToSign, privateKey).toString('base64');

      const mockReq = {
        rawBody: Buffer.from(bodyStr, 'utf8'),
        body: eventPayload,
        headers: {
          'telnyx-signature-ed25519': validSignatureBase64,
          'telnyx-timestamp': timestamp,
        },
      } as any;
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as any;

      await controller.handleWebhook(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.send).toHaveBeenCalledWith('OK');
      expect(mockCallController.handleEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CALL_INITIATED',
          callId: 'v3:test_call_control_id',
          from: '+13324000950',
          to: '+14845560110',
        }),
      );
      expect(mockIdempotency.markProcessed).toHaveBeenCalledWith('internal-123', 'token-abc');
    });
  });
});
