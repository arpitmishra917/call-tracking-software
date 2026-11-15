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

  it('Unauthenticated onboarding behavior - Redirects to /login', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } });

    const req = {
      cookies: { getAll: vi.fn(), set: vi.fn() },
      nextUrl: {
        pathname: '/onboarding',
        clone: () => ({ pathname: '/onboarding' }),
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

  it('Public route /login bypasses auth check without calling getUser', async () => {
    const req = {
      cookies: { getAll: vi.fn(), set: vi.fn() },
      nextUrl: {
        pathname: '/login',
        clone: () => ({ pathname: '/login' }),
      },
    } as unknown as NextRequest;

    await updateSession(req);

    expect(mockSupabase.auth.getUser).not.toHaveBeenCalled();
    expect(NextResponse.redirect).not.toHaveBeenCalled();
    expect(NextResponse.next).toHaveBeenCalled();
  });

  it('Protected route handles auth service network failure gracefully by redirecting to /login', async () => {
    mockSupabase.auth.getUser.mockRejectedValue(new Error('fetch failed'));

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

  it('Unauthenticated invitation routes with token redirect to /invitations preserving token', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } });

    const searchParams = new URLSearchParams('token=invite-token-123');
    const cloneTarget = { pathname: '/protected/accept-invitation', search: '' };
    const req = {
      cookies: { getAll: vi.fn(), set: vi.fn() },
      nextUrl: {
        pathname: '/protected/accept-invitation',
        searchParams,
        clone: () => cloneTarget,
      },
    } as unknown as NextRequest;

    await updateSession(req);

    expect(NextResponse.redirect).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: '/invitations',
        search: '?token=invite-token-123',
      })
    );
  });
});
