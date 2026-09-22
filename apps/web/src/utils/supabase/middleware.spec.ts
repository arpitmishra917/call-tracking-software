import { updateSession } from './middleware';
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(),
}));

vi.mock('next/server', () => {
  return {
    NextResponse: {
      next: vi.fn().mockImplementation(() => {
        return {
          cookies: { set: vi.fn(), getAll: vi.fn() },
        };
      }),
      redirect: vi.fn().mockReturnValue({ redirected: true }),
    },
    NextRequest: vi.fn(),
  };
});

describe('Frontend Middleware Auth (MOCK)', () => {
  let mockSupabase: { auth: { getUser: ReturnType<typeof vi.fn> } };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase = {
      auth: {
        getUser: vi.fn(),
      },
    };
    (createServerClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockSupabase);
  });

  it('Unauthenticated protected-page behavior - Redirects to /login', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } });

    const req = {
      cookies: { getAll: vi.fn(), set: vi.fn() },
      nextUrl: {
        pathname: '/protected',
        clone: () => ({ pathname: '/protected' }),
      },
    } as unknown as NextRequest;

    await updateSession(req);

    expect(NextResponse.redirect).toHaveBeenCalled();
  });

  it('Authenticated protected-page behavior - Allows access', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: '123' } } });

    const req = {
      cookies: { getAll: vi.fn(), set: vi.fn() },
      nextUrl: {
        pathname: '/protected',
        clone: () => ({ pathname: '/protected' }),
      },
    } as unknown as NextRequest;

    await updateSession(req);

    expect(NextResponse.redirect).not.toHaveBeenCalled();
    expect(NextResponse.next).toHaveBeenCalled();
  });
});
