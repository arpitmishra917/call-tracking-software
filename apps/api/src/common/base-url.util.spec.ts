import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolveBaseUrl,
  validatePublicHttpsUrl,
  normalizeTrailingSlash,
  inspectBaseUrlResolution,
} from './base-url.util.js';

describe('Base URL Resolution & Render-Native Fallback', () => {
  let originalBaseUrl: string | undefined;
  let originalRenderUrl: string | undefined;
  let originalNodeEnv: string | undefined;
  let originalAppEnv: string | undefined;

  beforeEach(() => {
    originalBaseUrl = process.env.BASE_URL;
    originalRenderUrl = process.env.RENDER_EXTERNAL_URL;
    originalNodeEnv = process.env.NODE_ENV;
    originalAppEnv = process.env.APP_ENV;
  });

  afterEach(() => {
    if (originalBaseUrl !== undefined) {
      process.env.BASE_URL = originalBaseUrl;
    } else {
      delete process.env.BASE_URL;
    }

    if (originalRenderUrl !== undefined) {
      process.env.RENDER_EXTERNAL_URL = originalRenderUrl;
    } else {
      delete process.env.RENDER_EXTERNAL_URL;
    }

    if (originalNodeEnv !== undefined) {
      process.env.NODE_ENV = originalNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }

    if (originalAppEnv !== undefined) {
      process.env.APP_ENV = originalAppEnv;
    } else {
      delete process.env.APP_ENV;
    }
  });

  describe('1. Explicit BASE_URL takes precedence', () => {
    it('uses BASE_URL when both BASE_URL and RENDER_EXTERNAL_URL are present', () => {
      process.env.BASE_URL = 'https://explicit-override.callflow.com';
      process.env.RENDER_EXTERNAL_URL = 'https://service-name.onrender.com';

      const resolved = resolveBaseUrl({ validate: true });
      expect(resolved).toBe('https://explicit-override.callflow.com');

      const inspection = inspectBaseUrlResolution();
      expect(inspection.source).toBe('BASE_URL');
      expect(inspection.url).toBe('https://explicit-override.callflow.com');
    });

    it('preserves explicit BASE_URL even if RENDER_EXTERNAL_URL has invalid protocol', () => {
      process.env.BASE_URL = 'https://valid-explicit.callflow.com';
      process.env.RENDER_EXTERNAL_URL = 'http://invalid-render.com';

      const resolved = resolveBaseUrl({ validate: true });
      expect(resolved).toBe('https://valid-explicit.callflow.com');
    });
  });

  describe('2. RENDER_EXTERNAL_URL is used when BASE_URL is absent', () => {
    it('resolves RENDER_EXTERNAL_URL when BASE_URL is undefined', () => {
      delete process.env.BASE_URL;
      process.env.RENDER_EXTERNAL_URL = 'https://callflow-backend-live.onrender.com';

      const resolved = resolveBaseUrl({ validate: true });
      expect(resolved).toBe('https://callflow-backend-live.onrender.com');

      const inspection = inspectBaseUrlResolution();
      expect(inspection.source).toBe('RENDER_EXTERNAL_URL');
      expect(inspection.url).toBe('https://callflow-backend-live.onrender.com');
    });

    it('resolves RENDER_EXTERNAL_URL when BASE_URL is empty whitespace', () => {
      process.env.BASE_URL = '   ';
      process.env.RENDER_EXTERNAL_URL = 'https://custom-service.onrender.com';

      const resolved = resolveBaseUrl({ validate: true });
      expect(resolved).toBe('https://custom-service.onrender.com');
    });

    it('resolves RENDER_EXTERNAL_URL in production environment by default', () => {
      delete process.env.BASE_URL;
      delete process.env.APP_ENV;
      process.env.NODE_ENV = 'production';
      process.env.RENDER_EXTERNAL_URL = 'https://prod-service.onrender.com';

      const resolved = resolveBaseUrl();
      expect(resolved).toBe('https://prod-service.onrender.com');
    });
  });

  describe('3. Invalid Render URL is rejected', () => {
    beforeEach(() => {
      delete process.env.BASE_URL;
    });

    it('rejects unencrypted HTTP protocol', () => {
      process.env.RENDER_EXTERNAL_URL = 'http://service-name.onrender.com';
      expect(() => resolveBaseUrl({ validate: true })).toThrow(
        '[CRITICAL STARTUP ERROR] RENDER_EXTERNAL_URL must use HTTPS protocol (got: http:).',
      );
    });

    it('rejects FTP protocol', () => {
      process.env.RENDER_EXTERNAL_URL = 'ftp://service-name.onrender.com';
      expect(() => resolveBaseUrl({ validate: true })).toThrow(
        '[CRITICAL STARTUP ERROR] RENDER_EXTERNAL_URL must use HTTPS protocol (got: ftp:).',
      );
    });

    it('rejects localhost hostname', () => {
      process.env.RENDER_EXTERNAL_URL = 'https://localhost:3000';
      expect(() => resolveBaseUrl({ validate: true })).toThrow(
        '[CRITICAL STARTUP ERROR] RENDER_EXTERNAL_URL (https://localhost:3000) resolves to a loopback or private network address.',
      );
    });

    it('rejects .localhost subdomain', () => {
      process.env.RENDER_EXTERNAL_URL = 'https://app.localhost';
      expect(() => resolveBaseUrl({ validate: true })).toThrow(
        '[CRITICAL STARTUP ERROR] RENDER_EXTERNAL_URL (https://app.localhost) resolves to a loopback or private network address.',
      );
    });

    it('rejects 127.0.0.1 loopback IP', () => {
      process.env.RENDER_EXTERNAL_URL = 'https://127.0.0.1:8080';
      expect(() => resolveBaseUrl({ validate: true })).toThrow(
        '[CRITICAL STARTUP ERROR] RENDER_EXTERNAL_URL (https://127.0.0.1:8080) resolves to a loopback or private network address.',
      );
    });

    it('rejects IPv6 loopback [::1]', () => {
      process.env.RENDER_EXTERNAL_URL = 'https://[::1]:3000';
      expect(() => resolveBaseUrl({ validate: true })).toThrow(
        '[CRITICAL STARTUP ERROR] RENDER_EXTERNAL_URL (https://[::1]:3000) resolves to a loopback or private network address.',
      );
    });

    it('rejects RFC 1918 private IP ranges (10.x, 192.168.x, 172.16-31.x)', () => {
      process.env.RENDER_EXTERNAL_URL = 'https://10.0.1.5';
      expect(() => resolveBaseUrl({ validate: true })).toThrow('resolves to a loopback or private network address');

      process.env.RENDER_EXTERNAL_URL = 'https://192.168.1.100';
      expect(() => resolveBaseUrl({ validate: true })).toThrow('resolves to a loopback or private network address');

      process.env.RENDER_EXTERNAL_URL = 'https://172.20.0.1';
      expect(() => resolveBaseUrl({ validate: true })).toThrow('resolves to a loopback or private network address');
    });

    it('rejects AWS link-local IP (169.254.169.254)', () => {
      process.env.RENDER_EXTERNAL_URL = 'https://169.254.169.254';
      expect(() => resolveBaseUrl({ validate: true })).toThrow('resolves to a loopback or private network address');
    });

    it('rejects 0.0.0.0 wildcard address', () => {
      process.env.RENDER_EXTERNAL_URL = 'https://0.0.0.0:3000';
      expect(() => resolveBaseUrl({ validate: true })).toThrow('resolves to a loopback or private network address');
    });

    it('rejects embedded credentials', () => {
      process.env.RENDER_EXTERNAL_URL = 'https://user:password@service-name.onrender.com';
      expect(() => resolveBaseUrl({ validate: true })).toThrow(
        '[CRITICAL STARTUP ERROR] RENDER_EXTERNAL_URL must not contain embedded credentials.',
      );
    });

    it('rejects completely malformed URL string', () => {
      process.env.RENDER_EXTERNAL_URL = 'not_a_valid_url';
      expect(() => resolveBaseUrl({ validate: true })).toThrow(
        '[CRITICAL STARTUP ERROR] RENDER_EXTERNAL_URL (not_a_valid_url) is not a valid URL.',
      );
    });
  });

  describe('4. Missing both variables fails safely', () => {
    beforeEach(() => {
      delete process.env.BASE_URL;
      delete process.env.RENDER_EXTERNAL_URL;
    });

    it('throws critical startup error in production when both are missing', () => {
      delete process.env.APP_ENV;
      process.env.NODE_ENV = 'production';

      expect(() => resolveBaseUrl()).toThrow(
        '[CRITICAL STARTUP ERROR] BASE_URL is missing! In production with Telnyx, a valid public HTTPS URL is required.',
      );
    });

    it('throws critical startup error when explicitly validated', () => {
      expect(() => resolveBaseUrl({ validate: true })).toThrow(
        '[CRITICAL STARTUP ERROR] BASE_URL is missing! In production with Telnyx, a valid public HTTPS URL is required.',
      );
    });

    it('returns undefined without throwing in non-production mode with validate: false', () => {
      process.env.NODE_ENV = 'development';
      const resolved = resolveBaseUrl({ validate: false });
      expect(resolved).toBeUndefined();

      const inspection = inspectBaseUrlResolution();
      expect(inspection.source).toBe('none');
      expect(inspection.url).toBeUndefined();
    });
  });

  describe('5. Trailing slash normalization does not break generated URLs', () => {
    it('strips single trailing slash from explicit BASE_URL', () => {
      process.env.BASE_URL = 'https://api.callflow.com/';
      delete process.env.RENDER_EXTERNAL_URL;

      const resolved = resolveBaseUrl({ validate: true });
      expect(resolved).toBe('https://api.callflow.com');
      expect(`${resolved}/telephony/ringback.wav`).toBe('https://api.callflow.com/telephony/ringback.wav');
    });

    it('strips multiple trailing slashes from explicit BASE_URL', () => {
      process.env.BASE_URL = 'https://api.callflow.com///';
      delete process.env.RENDER_EXTERNAL_URL;

      const resolved = resolveBaseUrl({ validate: true });
      expect(resolved).toBe('https://api.callflow.com');
      expect(`${resolved}/telephony/ringback.wav`).toBe('https://api.callflow.com/telephony/ringback.wav');
    });

    it('strips single trailing slash from RENDER_EXTERNAL_URL', () => {
      delete process.env.BASE_URL;
      process.env.RENDER_EXTERNAL_URL = 'https://callflow-backend.onrender.com/';

      const resolved = resolveBaseUrl({ validate: true });
      expect(resolved).toBe('https://callflow-backend.onrender.com');
      expect(`${resolved}/telephony/ringback.wav`).toBe(
        'https://callflow-backend.onrender.com/telephony/ringback.wav',
      );
    });

    it('strips multiple trailing slashes from RENDER_EXTERNAL_URL', () => {
      delete process.env.BASE_URL;
      process.env.RENDER_EXTERNAL_URL = 'https://callflow-backend.onrender.com///';

      const resolved = resolveBaseUrl({ validate: true });
      expect(resolved).toBe('https://callflow-backend.onrender.com');
      expect(`${resolved}/telephony/ringback.wav`).toBe(
        'https://callflow-backend.onrender.com/telephony/ringback.wav',
      );
    });

    it('normalizes non-production development URL with trailing slash', () => {
      process.env.BASE_URL = 'http://localhost:3000/';
      const resolved = resolveBaseUrl({ validate: false });
      expect(resolved).toBe('http://localhost:3000');
      expect(`${resolved}/telephony/ringback.wav`).toBe('http://localhost:3000/telephony/ringback.wav');
    });

    it('normalizeTrailingSlash handles empty and undefined strings gracefully', () => {
      expect(normalizeTrailingSlash('')).toBe('');
      expect(normalizeTrailingSlash(undefined)).toBe('');
      expect(normalizeTrailingSlash('https://example.com')).toBe('https://example.com');
      expect(normalizeTrailingSlash('https://example.com/')).toBe('https://example.com');
      expect(normalizeTrailingSlash('https://example.com///')).toBe('https://example.com');
    });
  });
});
