import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import ReportingPage from './page';
import { ThemeProvider } from '@/components/theme-provider';
import { apiFetch } from '@/lib/api';

const mockPush = vi.fn();
let currentSearchString = '?workspace=ws-buyer-101';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
  }),
  usePathname: () => '/protected/reporting',
  useSearchParams: () => new URLSearchParams(currentSearchString),
}));

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
  apiDownload: vi.fn(),
}));

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

const defaultMetricsResponse = {
  total: 42,
  answered: 30,
  missed: 10,
  failed: 2,
  avgDuration: 120,
  aclSecs: 140,
  tclSecs: 4200,
  revenue: 1000,
  payout: 400,
  cost: 400,
  profit: 600,
  converted: 25,
  qualified: 28,
  duplicate: 2,
  conversionRate: 0.595,
  commercialCalls: 42,
  campaigns: {},
  buyers: {},
  trackingNumbers: {},
  buckets: [],
};

describe('Reporting Workspace Context & Tenant Routing Regression Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    currentSearchString = '?workspace=ws-buyer-101';

    vi.mocked(apiFetch).mockImplementation(async (url) => {
      if (typeof url === 'string') {
        if (url.includes('/workspaces/ws-buyer-101/')) {
          if (url.includes('metrics')) return defaultMetricsResponse;
          if (url.includes('reports')) return [];
          if (url.includes('live-calls')) return { liveCalls: 0 };
          if (url.includes('calls')) return { items: [], total: 0 };
        }
        if (url.includes('/workspaces/ws-vendor-202/')) {
          if (url.includes('metrics')) return { ...defaultMetricsResponse, total: 15 };
          if (url.includes('reports')) return [];
          if (url.includes('live-calls')) return { liveCalls: 0 };
          if (url.includes('calls')) return { items: [], total: 0 };
        }
        if (url.includes('/workspaces')) {
          return [
            { id: 'ws-default-000', name: 'Default Primary Workspace', workspace_type: 'PRIMARY' },
            { id: 'ws-buyer-101', name: 'Buyer Workspace Alpha', workspace_type: 'BUYER' },
            { id: 'ws-vendor-202', name: 'Vendor Workspace Beta', workspace_type: 'VENDOR' },
          ];
        }
      }
      return { items: [], total: 0 };
    });
  });

  it('1. Buyer workspace: clicking Apply Filter preserves buyer workspace ID in URL and API routing', async () => {
    currentSearchString = '?workspace=ws-buyer-101';

    render(
      <ThemeProvider>
        <ReportingPage />
      </ThemeProvider>
    );

    // Initial API fetch must target ws-buyer-101
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        expect.stringContaining('/workspaces/ws-buyer-101/calls/metrics?')
      );
    });

    // Locate Apply Filters button
    const applyButton = screen.getByRole('button', { name: /Apply Filters/i });
    expect(applyButton).toBeDefined();

    // Trigger Apply Filters
    fireEvent.click(applyButton);

    // Assert that mockPush retained ?workspace=ws-buyer-101 without dropping it or reverting to default
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalled();
      const pushedUrl = mockPush.mock.calls[0][0];
      const parsedUrl = new URL(pushedUrl, 'http://localhost');
      expect(parsedUrl.searchParams.get('workspace')).toBe('ws-buyer-101');
      expect(parsedUrl.pathname).toBe('/protected/reporting');
      expect(pushedUrl).not.toContain('ws-default-000');
    });
  });

  it('2. Vendor workspace: clicking Apply Filter preserves vendor workspace ID in URL and API routing', async () => {
    currentSearchString = '?workspace=ws-vendor-202';

    render(
      <ThemeProvider>
        <ReportingPage />
      </ThemeProvider>
    );

    // Initial API fetch must target ws-vendor-202
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        expect.stringContaining('/workspaces/ws-vendor-202/calls/metrics?')
      );
    });

    const applyButton = screen.getByRole('button', { name: /Apply Filters/i });
    fireEvent.click(applyButton);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalled();
      const pushedUrl = mockPush.mock.calls[0][0];
      const parsedUrl = new URL(pushedUrl, 'http://localhost');
      expect(parsedUrl.searchParams.get('workspace')).toBe('ws-vendor-202');
      expect(parsedUrl.pathname).toBe('/protected/reporting');
      expect(pushedUrl).not.toContain('ws-default-000');
    });
  });

  it('3. Reset Filters: preserves workspace ID while resetting filter criteria', async () => {
    currentSearchString = '?workspace=ws-buyer-101&status=COMPLETED&page=3';

    render(
      <ThemeProvider>
        <ReportingPage />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        expect.stringContaining('/workspaces/ws-buyer-101/calls/metrics?')
      );
    });

    const resetButton = screen.getByRole('button', { name: /Reset/i });
    expect(resetButton).toBeDefined();

    fireEvent.click(resetButton);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalled();
      const pushedUrl = mockPush.mock.calls[0][0];
      const parsedUrl = new URL(pushedUrl, 'http://localhost');
      expect(parsedUrl.searchParams.get('workspace')).toBe('ws-buyer-101');
      expect(parsedUrl.searchParams.get('bucket')).toBe('day');
      expect(parsedUrl.searchParams.get('groupBy')).toBe('Campaign');
      expect(parsedUrl.searchParams.get('page')).toBe('1');
      expect(parsedUrl.searchParams.get('status')).toBeNull();
    });
  });

  it('4. Group By and Bucket changes preserve workspace context', async () => {
    currentSearchString = '?workspace=ws-buyer-101';

    render(
      <ThemeProvider>
        <ReportingPage />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalled();
    });

    // Test Group By selector
    const groupSelect = screen.getByDisplayValue('Campaign');
    fireEvent.change(groupSelect, { target: { value: 'Buyer' } });

    await waitFor(() => {
      const lastPush = mockPush.mock.calls[mockPush.mock.calls.length - 1][0];
      const parsedUrl = new URL(lastPush, 'http://localhost');
      expect(parsedUrl.searchParams.get('workspace')).toBe('ws-buyer-101');
      expect(parsedUrl.searchParams.get('groupBy')).toBe('Buyer');
    });

    // Test Bucket selector
    const bucketSelect = screen.getByDisplayValue('Daily');
    fireEvent.change(bucketSelect, { target: { value: 'hour' } });

    await waitFor(() => {
      const lastPush = mockPush.mock.calls[mockPush.mock.calls.length - 1][0];
      const parsedUrl = new URL(lastPush, 'http://localhost');
      expect(parsedUrl.searchParams.get('workspace')).toBe('ws-buyer-101');
      expect(parsedUrl.searchParams.get('bucket')).toBe('hour');
    });
  });

  it('5. Independent browser sessions maintain distinct workspace contexts without bleed', async () => {
    // Session 1: Buyer Workspace
    currentSearchString = '?workspace=ws-buyer-101';
    const { unmount: unmountSession1 } = render(
      <ThemeProvider>
        <ReportingPage />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        expect.stringContaining('/workspaces/ws-buyer-101/')
      );
    });

    const applyButton1 = screen.getByRole('button', { name: /Apply Filters/i });
    fireEvent.click(applyButton1);

    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('workspace=ws-buyer-101'));
    unmountSession1();

    // Session 2: Vendor Workspace (simulated separate browser tab / session)
    mockPush.mockClear();
    currentSearchString = '?workspace=ws-vendor-202';
    render(
      <ThemeProvider>
        <ReportingPage />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        expect.stringContaining('/workspaces/ws-vendor-202/')
      );
    });

    const applyButton2 = screen.getByRole('button', { name: /Apply Filters/i });
    fireEvent.click(applyButton2);

    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('workspace=ws-vendor-202'));
    expect(mockPush).not.toHaveBeenCalledWith(expect.stringContaining('workspace=ws-buyer-101'));
  });

  it('6. Filter action buttons have type="button" to prevent native form submission / page reload', async () => {
    currentSearchString = '?workspace=ws-buyer-101';

    render(
      <ThemeProvider>
        <ReportingPage />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalled();
    });

    const applyButton = screen.getByRole('button', { name: /Apply Filters/i });
    const resetButton = screen.getByRole('button', { name: /Reset/i });

    expect(applyButton.getAttribute('type')).toBe('button');
    expect(resetButton.getAttribute('type')).toBe('button');
  });

  it('7. Saved report application preserves active workspaceId in router.push', async () => {
    currentSearchString = '?workspace=ws-buyer-101';
    vi.mocked(apiFetch).mockImplementation(async (url) => {
      if (typeof url === 'string') {
        if (url.includes('/reports') && !url.includes('export')) {
          return [
            {
              id: 'rep-saved-1',
              name: 'Saved Q4 Overview',
              visibility: 'PERSONAL',
              configuration: {
                filters: { status: 'COMPLETED' },
                groupBy: 'Campaign',
                bucket: 'day',
                columns: [],
              },
              creator: { display_name: 'Tester' },
            },
          ];
        }
        if (url.includes('metrics')) return defaultMetricsResponse;
        if (url.includes('live-calls')) return { liveCalls: 0 };
        if (url.includes('calls')) return { items: [], total: 0 };
      }
      return [];
    });

    render(
      <ThemeProvider>
        <ReportingPage />
      </ThemeProvider>
    );

    // Open saved reports dropdown
    const savedReportsBtn = await screen.findByRole('button', { name: /Saved Reports/i });
    fireEvent.click(savedReportsBtn);

    const reportItem = await screen.findByText('Saved Q4 Overview');
    fireEvent.click(reportItem);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalled();
      const lastCall = mockPush.mock.calls[mockPush.mock.calls.length - 1][0];
      const parsedUrl = new URL(lastCall, 'http://localhost');
      expect(parsedUrl.searchParams.get('workspace')).toBe('ws-buyer-101');
      expect(parsedUrl.searchParams.get('status')).toBe('COMPLETED');
    });
  });

  it('8. Stale in-flight response from a previous workspace does not overwrite active workspace state', async () => {
    currentSearchString = '?workspace=ws-buyer-101';
    let resolveSlowWs1Metrics: (value: any) => void = () => {};

    vi.mocked(apiFetch).mockImplementation(async (url) => {
      if (typeof url === 'string') {
        if (url.includes('/workspaces/ws-buyer-101/calls/metrics')) {
          // Slow request that hangs until after workspace switches
          return new Promise((resolve) => {
            resolveSlowWs1Metrics = resolve;
          });
        }
        if (url.includes('/workspaces/ws-vendor-202/calls/metrics')) {
          return { ...defaultMetricsResponse, total: 888 };
        }
        if (url.includes('live-calls')) return { liveCalls: 0 };
        if (url.includes('reports')) return [];
        if (url.includes('calls')) return { items: [], total: 0 };
      }
      return [];
    });

    const { rerender } = render(
      <ThemeProvider>
        <ReportingPage />
      </ThemeProvider>
    );

    // Switch workspace to ws-vendor-202 before ws-buyer-101 resolves
    currentSearchString = '?workspace=ws-vendor-202';
    rerender(
      <ThemeProvider>
        <ReportingPage />
      </ThemeProvider>
    );

    // Vendor response arrives and displays total: 888
    await waitFor(() => {
      expect(screen.getByText('888')).toBeDefined();
    });

    // Now resolve the stale ws-buyer-101 request with total 9999
    resolveSlowWs1Metrics({ ...defaultMetricsResponse, total: 9999 });

    // Ensure 9999 is NOT rendered and 888 remains
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('9999')).toBeNull();
    expect(screen.getByText('888')).toBeDefined();
  });
});
