import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Shell from './shell';
import { useSearchParams, usePathname, useRouter } from 'next/navigation';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: vi.fn(),
  usePathname: () => '/protected/reporting',
}));

vi.mock('@/utils/supabase/client', () => ({
  createClient: () => ({ auth: { signOut: vi.fn() } }),
}));

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn().mockResolvedValue({}),
}));

describe('Responsive Shell & Navigation Suite', () => {
  const mockWorkspaces = [
    { id: 'ws-shell-1', name: 'Shell Ops', role: 'OWNER' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams('workspace=ws-shell-1') as any);
  });

  it('renders application shell layout with header, user email, and main workspace content', () => {
    render(
      <Shell workspaces={mockWorkspaces} user={{ email: 'admin@callflow.io' }}>
        <div data-testid="page-child">Reporting View</div>
      </Shell>
    );

    expect(screen.getByText('admin@callflow.io')).toBeDefined();
    expect(screen.getByTestId('page-child')).toBeDefined();
    expect(screen.getByText('Open sidebar')).toBeDefined();
  });

  it('toggles mobile navigation drawer open and closed', () => {
    render(
      <Shell workspaces={mockWorkspaces} user={{ email: 'admin@callflow.io' }}>
        <div>Page Body</div>
      </Shell>
    );

    // Click hamburger button to open mobile menu
    const openBtn = screen.getByRole('button', { name: /Open sidebar/i });
    fireEvent.click(openBtn);

    // Close button appears in mobile drawer
    const closeBtn = screen.getByRole('button', { name: /Close sidebar/i });
    expect(closeBtn).toBeDefined();

    // Clicking close button dismisses drawer
    fireEvent.click(closeBtn);
    expect(screen.queryByRole('button', { name: /Close sidebar/i })).toBeNull();
  });
});
