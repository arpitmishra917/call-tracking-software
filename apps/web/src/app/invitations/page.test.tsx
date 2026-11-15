import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import InvitationPage from './page';

vi.mock('next/link', () => ({
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

describe('Public Invitation Verification Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('renders error when no invitation token is provided in searchParams', async () => {
    const Component = await InvitationPage({ searchParams: Promise.resolve({}) });
    render(Component);

    expect(screen.getByText(/No invitation token provided/i)).toBeDefined();
  });

  it('verifies pending invitation and displays workspace name and email', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'PENDING',
        workspace_name: 'Acme Media WS',
        email: 'invited@callflow.io',
      }),
    } as any);

    const Component = await InvitationPage({ searchParams: Promise.resolve({ token: 'valid-inv-tok' }) });
    render(Component);

    expect(screen.getByText('Acme Media WS')).toBeDefined();
    expect(screen.getByText('invited@callflow.io')).toBeDefined();
    expect(screen.getByRole('link', { name: /create account/i })).toBeDefined();
    expect(screen.getByRole('link', { name: /log in/i })).toBeDefined();
  });

  it('renders error banner when invitation status is not PENDING', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'EXPIRED',
        workspace_name: 'Acme Media WS',
        email: 'invited@callflow.io',
      }),
    } as any);

    const Component = await InvitationPage({ searchParams: Promise.resolve({ token: 'expired-tok' }) });
    render(Component);

    expect(screen.getByText(/This invitation is no longer valid \(Status: EXPIRED\)/i)).toBeDefined();
  });

  it('renders error message when verification endpoint returns 404', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => 'Not Found',
    } as any);

    const Component = await InvitationPage({ searchParams: Promise.resolve({ token: 'nonexistent-tok' }) });
    render(Component);

    expect(screen.getByText(/Invalid or expired invitation \(404\)/i)).toBeDefined();
  });
});
