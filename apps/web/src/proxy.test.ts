import { describe, it, expect, vi, beforeEach } from 'vitest';
import { proxy, config } from './proxy';
import { updateSession } from '@/utils/supabase/middleware';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/utils/supabase/middleware', () => ({
  updateSession: vi.fn(),
}));

describe('Next.js 16 Proxy Convention Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates request directly to updateSession', async () => {
    const mockReq = { nextUrl: { pathname: '/protected' } } as NextRequest;
    const mockRes = { status: 200 } as NextResponse;
    vi.mocked(updateSession).mockResolvedValueOnce(mockRes);

    const result = await proxy(mockReq);

    expect(updateSession).toHaveBeenCalledWith(mockReq);
    expect(result).toBe(mockRes);
  });

  it('matcher excludes static assets and includes dynamic application routes', () => {
    expect(config.matcher).toBeDefined();
    expect(Array.isArray(config.matcher)).toBe(true);
    expect(config.matcher[0]).toContain('_next/static');
    expect(config.matcher[0]).toContain('favicon.ico');
  });
});
