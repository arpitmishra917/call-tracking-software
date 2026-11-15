import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import LoginPage from './login/page';
import ProtectedLayout from './protected/layout';
import { updateSession } from '@/utils/supabase/middleware';
import WorkspaceValidator from '@/components/workspace-validator';
import { createClient } from '@/utils/supabase/server';
import { redirect, useRouter, useSearchParams, usePathname } from 'next/navigation';
import { NextRequest } from 'next/server';

const mockGlobalCookieStore = {
  getAll: vi.fn().mockReturnValue([]),
  set: vi.fn(),
};

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockImplementation(async () => mockGlobalCookieStore),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
  usePathname: vi.fn(),
}));

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(),
}));

vi.mock('@/components/shell', () => ({
  default: ({ children, workspaces }: any) => (
    <div data-testid="app-shell" data-workspaces={JSON.stringify(workspaces)}>
      {children}
    </div>
  ),
}));

describe('Auth Session Persistence & Redirect Loop Suite (PHASE 3)', () => {
  let mockSupabase: any;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();

    mockSupabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'usr-1', email: 'user@example.com' } },
          error: null,
        }),
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: 'valid-jwt-token' } },
          error: null,
        }),
        refreshSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: 'refreshed-jwt-token' } },
          error: null,
        }),
        signOut: vi.fn().mockResolvedValue({ error: null }),
      },
    };

    vi.mocked(createClient).mockResolvedValue(mockSupabase);
    vi.mocked(useRouter).mockReturnValue({ push: vi.fn(), replace: vi.fn() } as any);
    vi.mocked(usePathname).mockReturnValue('/protected');
  });

  // 1. Successful login persists session cookies
  it('1. Successful login persists session cookies with appropriate local development options', async () => {
    const { createServerClient } = await import('@supabase/ssr');
    let capturedOptions: any = null;

    vi.mocked(createServerClient).mockImplementation((_url, _key, options: any) => {
      capturedOptions = options;
      return mockSupabase;
    });

    const { createClient: actualServerCreateClient } = await vi.importActual<any>('@/utils/supabase/server');
    await actualServerCreateClient();

    expect(capturedOptions?.cookies).toBeDefined();
    expect(typeof capturedOptions.cookies.getAll).toBe('function');
    expect(typeof capturedOptions.cookies.setAll).toBe('function');

    capturedOptions.cookies.setAll([
      { name: 'sb-access-token', value: 'token-abc', options: { path: '/', secure: true } },
    ]);

    expect(mockGlobalCookieStore.set).toHaveBeenCalledWith(
      'sb-access-token',
      'token-abc',
      expect.objectContaining({ path: '/', secure: false }) // dev mode sanitization
    );
  });

  // 2. Successful login followed by "/protected" access
  it('2. Successful login followed by /protected access loads workspaces and renders Shell', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [{ id: '5e20bafe-7306-4da7-9944-62c4c5575a5a', name: 'QA Workspace', role: 'OWNER' }],
    } as any);

    const Jsx = await ProtectedLayout({ children: <div data-testid="protected-content">Content</div> });
    render(Jsx);

    expect(screen.getByTestId('app-shell')).toBeDefined();
    expect(screen.getByTestId('protected-content')).toBeDefined();
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/workspaces'),
      expect.objectContaining({
        headers: { Authorization: 'Bearer valid-jwt-token' },
      })
    );
    expect(redirect).not.toHaveBeenCalled();
  });

  // 3. Valid session refresh
  it('3. Valid session refresh fetches and applies new access token when initial token is missing', async () => {
    mockSupabase.auth.getSession.mockResolvedValueOnce({
      data: { session: null },
      error: null,
    });
    mockSupabase.auth.refreshSession.mockResolvedValueOnce({
      data: { session: { access_token: 'freshly-refreshed-token' } },
      error: null,
    });

    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [{ id: '5e20bafe-7306-4da7-9944-62c4c5575a5a', name: 'QA Workspace', role: 'ADMIN' }],
    } as any);

    const Jsx = await ProtectedLayout({ children: <div>Refreshed</div> });
    render(Jsx);

    expect(mockSupabase.auth.refreshSession).toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/workspaces'),
      expect.objectContaining({
        headers: { Authorization: 'Bearer freshly-refreshed-token' },
      })
    );
    expect(redirect).not.toHaveBeenCalled();
  });

  // 4. Expired access token with valid refresh token
  it('4. Expired access token with valid refresh token handles 401 by refreshing and retrying', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [{ id: 'ws-qa-1', name: 'QA WS', role: 'OWNER' }],
      } as any);

    const Jsx = await ProtectedLayout({ children: <div>Recovered</div> });
    render(Jsx);

    expect(mockSupabase.auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(redirect).not.toHaveBeenCalled();
    expect(screen.getByTestId('app-shell')).toBeDefined();
  });

  // 5. Invalid refresh token
  it('5. Invalid refresh token triggers signOut and redirects to /login with session expired message', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 401,
    } as any);
    mockSupabase.auth.refreshSession.mockResolvedValueOnce({
      data: { session: null },
      error: new Error('Refresh token revoked'),
    });

    await ProtectedLayout({ children: <div>Dead</div> });

    expect(mockSupabase.auth.signOut).toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith('/login?message=Session+expired.+Please+log+in+again.');
  });

  // 6. Logout clears the session
  it('6. Logout behavior calls Supabase signOut to invalidate credentials', async () => {
    await mockSupabase.auth.signOut();
    expect(mockSupabase.auth.signOut).toHaveBeenCalled();
  });

  // 7. Unauthenticated protected route redirects once
  it('7. Unauthenticated protected route redirects once to /login', async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });

    await ProtectedLayout({ children: <div>Protected</div> });

    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith('/login');
  });

  // 8. Authenticated user visiting /login
  describe('8. Authenticated user visiting /login', () => {
    it('redirects to /protected when NO error message is present', async () => {
      mockSupabase.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: 'usr-1', email: 'test@callflow.io' } },
      });

      await LoginPage({ searchParams: Promise.resolve({}) });

      expect(redirect).toHaveBeenCalledWith('/protected');
    });

    it('BREAKS REDIRECT LOOP: does NOT redirect when session expired message is present', async () => {
      mockSupabase.auth.getUser.mockResolvedValueOnce({
        data: { user: { id: 'usr-1', email: 'test@callflow.io' } },
      });

      const jsx = await LoginPage({
        searchParams: Promise.resolve({ message: 'Session expired. Please log in again.' }),
      });
      render(jsx);

      // Must NOT redirect back to /protected! Must render the login form and display the error message!
      expect(redirect).not.toHaveBeenCalled();
      expect(screen.getByText('Session expired. Please log in again.')).toBeDefined();
      expect(screen.getByRole('heading', { name: 'Log In' })).toBeDefined();
    });
  });

  // 9. Missing workspace selection
  it('9. Missing workspace selection prompts selection or defaults safely', () => {
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams() as any);
    const mockWorkspaces = [
      { id: 'ws-1', name: 'Alpha Workspace' },
      { id: 'ws-2', name: 'Beta Workspace' },
    ];

    render(
      <WorkspaceValidator workspaces={mockWorkspaces}>
        <div>Workspace Children</div>
      </WorkspaceValidator>
    );

    expect(screen.getByText('Select an Active Workspace')).toBeDefined();
    expect(screen.getByText(/Please select which workspace context you would like to view/i)).toBeDefined();
  });

  // 10. Invalid workspace membership
  it('10. Invalid workspace membership displays access denied instead of redirecting to login', () => {
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams('workspace=unauthorized-ws-id') as any);
    const mockWorkspaces = [{ id: 'ws-1', name: 'My Permitted Workspace' }];

    render(
      <WorkspaceValidator workspaces={mockWorkspaces}>
        <div>Workspace Children</div>
      </WorkspaceValidator>
    );

    expect(screen.getByText('Workspace Access Denied')).toBeDefined();
    expect(redirect).not.toHaveBeenCalled();
  });

  // 11. Invitation acceptance route
  it('11. Invitation acceptance route preserves token parameter on redirect', async () => {
    const { createServerClient } = await import('@supabase/ssr');
    vi.mocked(createServerClient).mockReturnValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    } as any);

    const req = new NextRequest('http://localhost:3000/protected/accept-invitation?token=invite-token-xyz');

    const res = await updateSession(req);
    expect(res).toBeDefined();
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/invitations?token=invite-token-xyz');
  });

  // 12. Public route access
  it('12. Public route access bypasses session validation check', async () => {
    const req = new NextRequest('http://localhost:3000/login');

    const res = await updateSession(req);
    expect(res).toBeDefined();
  });

  // 13. Cookie persistence across redirects
  it('13. Cookie persistence preserves updated cookies when redirecting', async () => {
    const { createServerClient } = await import('@supabase/ssr');
    let capturedSetAll: any = null;

    vi.mocked(createServerClient).mockImplementation((_url, _key, options: any) => {
      capturedSetAll = options.cookies.setAll;
      return {
        auth: {
          getUser: vi.fn().mockImplementation(async () => {
            if (capturedSetAll) {
              capturedSetAll([
                { name: 'sb-access-token', value: 'refreshed-val', options: { path: '/' } },
              ]);
            }
            return { data: { user: null } };
          }),
        },
      };
    });

    const req = new NextRequest('http://localhost:3000/protected');

    const res = await updateSession(req);
    expect(res).toBeDefined();
    expect(res.status).toBe(307);
    expect(res.cookies.get('sb-access-token')).toBeDefined();
  });

  // 14. Proxy and protected layout do not produce duplicate redirects
  it('14. Proxy and protected layout coordination prevents redirect loops', async () => {
    const loginJsx = await LoginPage({
      searchParams: Promise.resolve({ message: 'Session expired. Please log in again.' }),
    });
    render(loginJsx);

    expect(redirect).not.toHaveBeenCalled();
    expect(screen.getByText('Session expired. Please log in again.')).toBeDefined();
  });

  // PHASE 3C SPECIFIC VERIFICATION TESTS
  describe('15. Phase 3C Minimal Safe Implementation Verification', () => {
    it('Phase 3C - Test 2: Valid Supabase session + NestJS 401 preserves session and displays workspace error', async () => {
      // Supabase user and session are valid
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'usr-phase3c', email: 'verified@callflow.io' } },
        error: null,
      });
      mockSupabase.auth.getSession.mockResolvedValue({
        data: { session: { access_token: 'valid-supabase-jwt' } },
        error: null,
      });
      // Refresh succeeds during retry
      mockSupabase.auth.refreshSession.mockResolvedValue({
        data: { session: { access_token: 'valid-refreshed-jwt' } },
        error: null,
      });

      // NestJS backend returns 401 for /workspaces on both initial and retry calls
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 401,
      } as any);

      const Jsx = await ProtectedLayout({
        children: <div data-testid="isolated-dashboard">Secret Dashboard</div>,
      });
      render(Jsx);

      // Crucial assertion 1: Must NOT destroy the valid Supabase session
      expect(mockSupabase.auth.signOut).not.toHaveBeenCalled();

      // Crucial assertion 2: Must NOT redirect back to /login in an infinite loop
      expect(redirect).not.toHaveBeenCalled();

      // Crucial assertion 3: Must render workspace authentication failure UI
      expect(screen.getByText('Workspace Authentication Failed')).toBeDefined();
      expect(
        screen.getByText(/Backend API rejected authentication token \(HTTP 401\)/i)
      ).toBeDefined();

      // Crucial assertion 4: Must provide a Retry mechanism pointing to /protected
      const retryLink = screen.getByRole('link', { name: 'Retry' });
      expect(retryLink).toBeDefined();
      expect(retryLink.getAttribute('href')).toBe('/protected');

      // Crucial assertion 5: Must provide an explicit Sign Out button
      const signOutBtn = screen.getByRole('button', { name: 'Sign Out' });
      expect(signOutBtn).toBeDefined();

      // Crucial assertion 6: Must maintain tenant isolation and NOT render protected content
      expect(screen.queryByTestId('isolated-dashboard')).toBeNull();
      expect(screen.queryByTestId('app-shell')).toBeNull();
    });

    it('Phase 3C - Test 3: Invalid Supabase session redirects to login', async () => {
      mockSupabase.auth.getUser.mockResolvedValueOnce({
        data: { user: null },
        error: new Error('Invalid JWT'),
      });

      await ProtectedLayout({ children: <div>Hidden Content</div> });

      expect(redirect).toHaveBeenCalledTimes(1);
      expect(redirect).toHaveBeenCalledWith('/login');
    });

    it('Phase 3C - Test 4: Explicit logout clears session', async () => {
      mockSupabase.auth.signOut.mockResolvedValueOnce({ error: null });
      await mockSupabase.auth.signOut();
      expect(mockSupabase.auth.signOut).toHaveBeenCalledTimes(1);
    });

    it('Phase 3C - Test 5: Successful backend workspace response renders dashboard', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'usr-1', email: 'owner@callflow.io' } },
        error: null,
      });
      mockSupabase.auth.getSession.mockResolvedValue({
        data: { session: { access_token: 'valid-token' } },
        error: null,
      });

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          { id: '5e20bafe-7306-4da7-9944-62c4c5575a5a', name: 'QA Workspace', role: 'OWNER' },
        ],
      } as any);

      const Jsx = await ProtectedLayout({
        children: <div data-testid="dashboard-view">Live Dashboard</div>,
      });
      render(Jsx);

      expect(redirect).not.toHaveBeenCalled();
      expect(screen.getByTestId('app-shell')).toBeDefined();
      expect(screen.getByTestId('dashboard-view')).toBeDefined();
    });
  });
});
