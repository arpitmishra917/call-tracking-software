import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getBaseApiUrl, buildApiUrl, apiFetch } from './api';

const mockGetSession = vi.fn();
const mockRefreshSession = vi.fn();

vi.mock('@/utils/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getSession: mockGetSession,
      refreshSession: mockRefreshSession,
    },
  }),
}));

describe('Frontend API Client (apps/web/src/lib/api.ts)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  describe('getBaseApiUrl & buildApiUrl', () => {
    it('strips trailing slashes from NEXT_PUBLIC_API_URL', () => {
      process.env.NEXT_PUBLIC_API_URL = 'https://callflow-backend-swsq.onrender.com/';
      expect(getBaseApiUrl()).toBe('https://callflow-backend-swsq.onrender.com');
    });

    it('strips multiple trailing slashes and whitespace', () => {
      process.env.NEXT_PUBLIC_API_URL = '  https://callflow-backend-swsq.onrender.com///  ';
      expect(getBaseApiUrl()).toBe('https://callflow-backend-swsq.onrender.com');
    });

    it('falls back safely to localhost when env var is missing', () => {
      delete process.env.NEXT_PUBLIC_API_URL;
      expect(getBaseApiUrl()).toBe('http://localhost:3000');
    });

    it('buildApiUrl normalizes path ensuring exactly one separating slash', () => {
      process.env.NEXT_PUBLIC_API_URL = 'https://callflow-backend-swsq.onrender.com/';
      expect(buildApiUrl('/workspaces/123/reporting')).toBe(
        'https://callflow-backend-swsq.onrender.com/workspaces/123/reporting',
      );
      expect(buildApiUrl('workspaces/123/reporting')).toBe(
        'https://callflow-backend-swsq.onrender.com/workspaces/123/reporting',
      );
    });
  });

  describe('apiFetch execution & error handling', () => {
    it('throws error when user is not authenticated', async () => {
      mockGetSession.mockResolvedValueOnce({ data: { session: null } });
      await expect(apiFetch('/test')).rejects.toThrow('Not authenticated');
    });

    it('surfaces actionable diagnostic error on network / CORS failure', async () => {
      mockGetSession.mockResolvedValueOnce({
        data: { session: { access_token: 'mock-token' } },
      });
      global.fetch = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch'));

      await expect(apiFetch('/test')).rejects.toThrow(
        /Network request failed to http:\/\/localhost:3000\/test: Failed to fetch\. Please verify backend health and CORS configuration\./,
      );
    });

    it('retries request once if first attempt returns 401 and refresh succeeds', async () => {
      mockGetSession.mockResolvedValueOnce({
        data: { session: { access_token: 'stale-token' } },
      });
      mockRefreshSession.mockResolvedValueOnce({
        data: { session: { access_token: 'refreshed-token' } },
        error: null,
      });

      const mockResponse401 = {
        status: 401,
        ok: false,
        text: vi.fn().mockResolvedValue('Unauthorized'),
      };
      const mockResponse200 = {
        status: 200,
        ok: true,
        text: vi.fn().mockResolvedValue(JSON.stringify({ success: true })),
      };

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(mockResponse401)
        .mockResolvedValueOnce(mockResponse200);

      const result = await apiFetch('/workspaces');
      expect(result).toEqual({ success: true });
      expect(mockRefreshSession).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });
});
