import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Header from './header';
import { apiFetch } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => ({
    get: (param: string) => (param === 'workspace' ? 'ws_1' : null),
  }),
}));

vi.mock('@/utils/supabase/client', () => ({
  createClient: () => ({
    auth: { signOut: vi.fn() },
  }),
}));

vi.mock('@/components/workspace-selector', () => ({
  default: () => <div data-testid="workspace-selector">WorkspaceSelector</div>,
}));

describe('Header Metrics (Live Calls & Balance)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('displays 0 Live when liveCalls is 0', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url: string) => {
      if (url.includes('live-calls')) {
        return { liveCalls: 0 };
      }
      if (url.includes('balance')) {
        return { balance: { amountMinor: 10000, currency: 'USD' } };
      }
      return {};
    });

    render(
      <Header
        workspaces={[{ id: 'ws_1', name: 'Test Workspace', role: 'OWNER' }]}
        user={{ email: 'user@example.com' }}
        onMenuClick={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('0 Live')).toBeDefined();
    });
  });

  it('displays 2 Live when liveCalls is 2', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url: string) => {
      if (url.includes('live-calls')) {
        return { liveCalls: 2 };
      }
      if (url.includes('balance')) {
        return { balance: { amountMinor: 10000, currency: 'USD' } };
      }
      return {};
    });

    render(
      <Header
        workspaces={[{ id: 'ws_1', name: 'Test Workspace', role: 'OWNER' }]}
        user={{ email: 'user@example.com' }}
        onMenuClick={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('2 Live')).toBeDefined();
    });
  });

  it('uses the same /calls/live-calls endpoint as reporting', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url: string) => {
      if (url.includes('live-calls')) {
        return { liveCalls: 1 };
      }
      if (url.includes('balance')) {
        return { balance: { amountMinor: 5000, currency: 'USD' } };
      }
      return {};
    });

    render(
      <Header
        workspaces={[{ id: 'ws_1', name: 'Test Workspace', role: 'OWNER' }]}
        user={{ email: 'user@example.com' }}
        onMenuClick={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/workspaces/ws_1/calls/live-calls');
      expect(screen.getByText('1 Live')).toBeDefined();
    });
  });

  it('displays live calls even when billing balance endpoint returns 403 Forbidden', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url: string) => {
      if (url.includes('live-calls')) {
        return { liveCalls: 5 };
      }
      if (url.includes('balance')) {
        throw new Error('API error (403): Forbidden for participants');
      }
      return {};
    });

    render(
      <Header
        workspaces={[{ id: 'ws_1', name: 'Test Workspace', role: 'MEMBER' }]}
        user={{ email: 'user@example.com' }}
        onMenuClick={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('5 Live')).toBeDefined();
      expect(screen.getByText('—')).toBeDefined(); // Balance shows fallback dash without crashing
    });
  });
});
