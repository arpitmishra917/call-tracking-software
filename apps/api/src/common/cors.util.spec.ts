import { describe, it, expect, vi } from 'vitest';
import {
  normalizeOrigin,
  parseAllowedOrigins,
  isOriginAllowed,
  createCorsOriginDelegate,
} from './cors.util.js';

describe('CORS Origin Resolution & Normalization Utility', () => {
  describe('normalizeOrigin', () => {
    it('strips single trailing slash', () => {
      expect(normalizeOrigin('https://callflow-dun.vercel.app/')).toBe(
        'https://callflow-dun.vercel.app',
      );
    });

    it('strips multiple trailing slashes', () => {
      expect(normalizeOrigin('https://callflow-dun.vercel.app///')).toBe(
        'https://callflow-dun.vercel.app',
      );
    });

    it('trims leading and trailing whitespace', () => {
      expect(normalizeOrigin('   https://callflow-dun.vercel.app/   ')).toBe(
        'https://callflow-dun.vercel.app',
      );
    });

    it('converts to lowercase', () => {
      expect(normalizeOrigin('HTTPS://CallFlow-DUN.Vercel.App/')).toBe(
        'https://callflow-dun.vercel.app',
      );
    });

    it('returns empty string for falsy input', () => {
      expect(normalizeOrigin('')).toBe('');
    });
  });

  describe('parseAllowedOrigins', () => {
    it('always includes default development origins', () => {
      const allowed = parseAllowedOrigins(undefined);
      expect(allowed.has('http://localhost:3001')).toBe(true);
      expect(allowed.has('http://127.0.0.1:3001')).toBe(true);
      expect(allowed.has('http://localhost:3000')).toBe(true);
      expect(allowed.has('http://127.0.0.1:3000')).toBe(true);
    });

    it('normalizes single origin with trailing slash', () => {
      const allowed = parseAllowedOrigins('https://callflow-dun.vercel.app/');
      expect(allowed.has('https://callflow-dun.vercel.app')).toBe(true);
    });

    it('parses comma-delimited origins with mixed whitespace and trailing slashes', () => {
      const raw = 'https://callflow-dun.vercel.app/, https://app.callflow.ai/ , http://preview.callflow.dev';
      const allowed = parseAllowedOrigins(raw);
      expect(allowed.has('https://callflow-dun.vercel.app')).toBe(true);
      expect(allowed.has('https://app.callflow.ai')).toBe(true);
      expect(allowed.has('http://preview.callflow.dev')).toBe(true);
    });
  });

  describe('isOriginAllowed', () => {
    const allowed = parseAllowedOrigins('https://callflow-dun.vercel.app/');

    it('allows browser origin without trailing slash when env var has trailing slash', () => {
      expect(isOriginAllowed('https://callflow-dun.vercel.app', allowed)).toBe(true);
    });

    it('allows browser origin with trailing slash when env var has trailing slash', () => {
      expect(isOriginAllowed('https://callflow-dun.vercel.app/', allowed)).toBe(true);
    });

    it('allows non-browser requests without origin header (server-to-server / curl)', () => {
      expect(isOriginAllowed(undefined, allowed)).toBe(true);
    });

    it('allows localhost development origins', () => {
      expect(isOriginAllowed('http://localhost:3001', allowed)).toBe(true);
      expect(isOriginAllowed('http://127.0.0.1:3001', allowed)).toBe(true);
    });

    it('rejects unauthorized external origin', () => {
      expect(isOriginAllowed('https://malicious-attacker.com', allowed)).toBe(false);
    });
  });

  describe('createCorsOriginDelegate', () => {
    it('invokes callback with true for authorized origin', () => {
      const delegate = createCorsOriginDelegate('https://callflow-dun.vercel.app/');
      const cb = vi.fn();
      delegate('https://callflow-dun.vercel.app', cb);
      expect(cb).toHaveBeenCalledWith(null, true);
    });

    it('invokes callback with false for unauthorized origin and logs warning', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const delegate = createCorsOriginDelegate('https://callflow-dun.vercel.app/');
      const cb = vi.fn();
      delegate('https://unauthorized-domain.com', cb);
      expect(cb).toHaveBeenCalledWith(null, false);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[CORS] Blocked request from origin "https://unauthorized-domain.com"'),
      );
      warnSpy.mockRestore();
    });

    it('invokes callback with true when request origin is undefined', () => {
      const delegate = createCorsOriginDelegate('https://callflow-dun.vercel.app/');
      const cb = vi.fn();
      delegate(undefined, cb);
      expect(cb).toHaveBeenCalledWith(null, true);
    });
  });
});
