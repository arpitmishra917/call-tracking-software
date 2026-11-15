import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import LoginPage from './page';
import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';

vi.mock('@/utils/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

describe('LoginPage Component & Server Auth Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'PENDING', workspace_name: 'Test Workspace', email: 'invited@example.com' }),
    } as any);
  });

  it('redirects already-authenticated user without token directly to /protected', async () => {
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'u1', email: 'authed@example.com' } },
        }),
      },
    } as any);

    await LoginPage({ searchParams: Promise.resolve({}) });
    expect(redirect).toHaveBeenCalledWith('/protected');
  });

  it('redirects already-authenticated user with invite token to accept-invitation route', async () => {
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'u1', email: 'authed@example.com' } },
        }),
      },
    } as any);

    await LoginPage({ searchParams: Promise.resolve({ token: 'tok_abc123' }) });
    expect(redirect).toHaveBeenCalledWith('/protected/accept-invitation?token=tok_abc123');
  });

  it('renders login form for unauthenticated visitors', async () => {
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
        }),
      },
    } as any);

    const jsx = await LoginPage({ searchParams: Promise.resolve({ message: 'Session expired' }) });
    render(jsx);

    expect(screen.getByRole('heading', { name: 'Log In' })).toBeDefined();
    expect(screen.getByLabelText(/Email/i)).toBeDefined();
    expect(screen.getByLabelText(/Password/i)).toBeDefined();
    expect(screen.getByText('Session expired')).toBeDefined();
  });
});
