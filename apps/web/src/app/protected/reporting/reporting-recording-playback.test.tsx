import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import ReportingDashboard from './page';
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

// Polyfill HTMLMediaElement methods for JSDOM
window.HTMLMediaElement.prototype.play = vi.fn().mockImplementation(() => Promise.resolve());
window.HTMLMediaElement.prototype.pause = vi.fn();
window.HTMLMediaElement.prototype.load = vi.fn();

const mockMetrics = {
  total: 2,
  answered: 2,
  missed: 0,
  failed: 0,
  avgDuration: 120,
  aclSecs: 120,
  tclSecs: 240,
  revenue: 200,
  payout: 80,
  cost: 80,
  profit: 120,
  converted: 2,
  qualified: 2,
  duplicate: 0,
  conversionRate: 1,
  commercialCalls: 2,
  campaigns: {},
  buyers: {},
  trackingNumbers: {},
  buckets: [],
};

const mockCalls = [
  {
    id: 'call-with-rec',
    workspace_id: 'ws-buyer-101',
    created_at: new Date().toISOString(),
    from_number: '+15551112222',
    to_number: '+15553334444',
    state: 'COMPLETED',
    talkDurationSecs: 120,
    totalDurationSecs: 120,
    campaign: { name: 'Campaign Alpha' },
    buyer: { name: 'Buyer Corp' },
    attempts: [],
    recordings: [{ id: 'rec-authorized-1', status: 'COMPLETED' }],
    commercial: {
      revenue: 100,
      payout: 40,
      cost: 40,
      profit: 60,
      converted: true,
      qualified: true,
      duplicate: false,
      status: 'FINAL',
      currency: 'USD',
    },
  },
  {
    id: 'call-without-rec',
    workspace_id: 'ws-buyer-101',
    created_at: new Date().toISOString(),
    from_number: '+15559998888',
    to_number: '+15553334444',
    state: 'COMPLETED',
    talkDurationSecs: 60,
    totalDurationSecs: 60,
    campaign: { name: 'Campaign Alpha' },
    buyer: { name: 'Buyer Corp' },
    attempts: [],
    recordings: [],
    commercial: null,
  },
];

describe('Reporting Recording Playback & Cross-Browser Authorization Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    currentSearchString = '?workspace=ws-buyer-101';

    vi.mocked(apiFetch).mockImplementation(async (url) => {
      if (typeof url === 'string') {
        if (url.includes('/workspaces/ws-buyer-101/calls/metrics')) return mockMetrics;
        if (url.includes('/workspaces/ws-buyer-101/calls/live-calls')) return { liveCalls: 0 };
        if (url.includes('/workspaces/ws-buyer-101/reports')) return [];
        if (url.includes('/workspaces/ws-buyer-101/calls?')) {
          return { items: mockCalls, total: 2 };
        }
        if (url.includes('/workspaces/ws-buyer-101/recordings/rec-authorized-1/download')) {
          return { url: 'https://cdn.provider.com/recordings/rec-authorized-1.mp3' };
        }
        if (url.includes('/workspaces')) {
          return [
            { id: 'ws-buyer-101', name: 'Buyer Workspace', participant_type: 'BUYER' },
            { id: 'ws-vendor-202', name: 'Vendor Workspace', participant_type: 'VENDOR' },
          ];
        }
      }
      return { items: [], total: 0 };
    });
  });

  it('1. Reporting displays Play Recording button when call has available recording, and — when none exists', async () => {
    render(
      <ThemeProvider>
        <ReportingDashboard />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining('/workspaces/ws-buyer-101/calls?'));
    });

    const playButtons = await screen.findAllByRole('button', { name: /Play recording/i });
    expect(playButtons.length).toBeGreaterThanOrEqual(1);

    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });

  it('2. Clicking Play Recording fetches download URL and mounts audio element', async () => {
    render(
      <ThemeProvider>
        <ReportingDashboard />
      </ThemeProvider>
    );

    const playButton = await screen.findByRole('button', { name: /Play recording/i });
    fireEvent.click(playButton);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        '/workspaces/ws-buyer-101/recordings/rec-authorized-1/download'
      );
    });

    const audio = await screen.findByLabelText('Call recording audio player');
    expect(audio).toBeDefined();
    expect(audio.getAttribute('src')).toBe('https://cdn.provider.com/recordings/rec-authorized-1.mp3');

    // Confirm no router navigation or workspace switch occurred
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('3. Playback error from 403 Forbidden renders Denied without crashing or redirecting', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url) => {
      if (typeof url === 'string') {
        if (url.includes('recordings')) {
          throw new Error('API error (403): Access denied to recording');
        }
        if (url.includes('/workspaces/ws-buyer-101/calls/metrics')) return mockMetrics;
        if (url.includes('/workspaces/ws-buyer-101/calls/live-calls')) return { liveCalls: 0 };
        if (url.includes('/workspaces/ws-buyer-101/reports')) return [];
        if (url.includes('/workspaces/ws-buyer-101/calls?')) {
          return { items: mockCalls, total: 2 };
        }
        if (url.includes('/workspaces')) {
          return [{ id: 'ws-buyer-101', name: 'Buyer Workspace', participant_type: 'BUYER' }];
        }
      }
      return { items: [], total: 0 };
    });

    render(
      <ThemeProvider>
        <ReportingDashboard />
      </ThemeProvider>
    );

    const playButton = await screen.findByRole('button', { name: /Play recording/i });
    fireEvent.click(playButton);

    const deniedBadge = await screen.findByText('Denied');
    expect(deniedBadge).toBeDefined();

    expect(mockPush).not.toHaveBeenCalled();
  });

  it('4. Expired audio URL triggers onError handler allowing retry with fresh URL', async () => {
    render(
      <ThemeProvider>
        <ReportingDashboard />
      </ThemeProvider>
    );

    const playButton = await screen.findByRole('button', { name: /Play recording/i });
    fireEvent.click(playButton);

    const audioElement = await screen.findByLabelText('Call recording audio player');
    expect(audioElement).toBeDefined();

    // Trigger audio error (e.g. presigned URL expiration)
    fireEvent.error(audioElement);

    // Audio unmounts and Retry is shown
    const retryBtn = await screen.findByText('Retry');
    expect(retryBtn).toBeDefined();

    // Clicking Retry requests a fresh authorized URL
    vi.mocked(apiFetch).mockClear();
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        '/workspaces/ws-buyer-101/recordings/rec-authorized-1/download'
      );
    });
  });

  it('5. Independent browser sessions maintain distinct recording workspace routing without bleed', async () => {
    // Session A: Buyer Workspace
    currentSearchString = '?workspace=ws-buyer-101';
    const { unmount: unmountSessionA } = render(
      <ThemeProvider>
        <ReportingDashboard />
      </ThemeProvider>
    );

    const playButtonA = await screen.findByRole('button', { name: /Play recording/i });
    fireEvent.click(playButtonA);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        '/workspaces/ws-buyer-101/recordings/rec-authorized-1/download'
      );
    });
    unmountSessionA();

    // Session B: Vendor Workspace in independent browser context
    vi.mocked(apiFetch).mockClear();
    currentSearchString = '?workspace=ws-vendor-202';
    vi.mocked(apiFetch).mockImplementation(async (url) => {
      if (typeof url === 'string') {
        if (url.includes('/workspaces/ws-vendor-202/calls/metrics')) return mockMetrics;
        if (url.includes('/workspaces/ws-vendor-202/calls/live-calls')) return { liveCalls: 0 };
        if (url.includes('/workspaces/ws-vendor-202/reports')) return [];
        if (url.includes('/workspaces/ws-vendor-202/calls?')) {
          return {
            items: [
              {
                id: 'call-vendor-1',
                workspace_id: 'ws-vendor-202',
                created_at: new Date().toISOString(),
                from_number: '+15550001111',
                to_number: '+15553334444',
                state: 'COMPLETED',
                talkDurationSecs: 90,
                totalDurationSecs: 90,
                recordings: [{ id: 'rec-vendor-99', status: 'COMPLETED' }],
              },
            ],
            total: 1,
          };
        }
        if (url.includes('/workspaces/ws-vendor-202/recordings/rec-vendor-99/download')) {
          return { url: 'https://cdn.provider.com/recordings/rec-vendor-99.mp3' };
        }
        if (url.includes('/workspaces')) {
          return [{ id: 'ws-vendor-202', name: 'Vendor Workspace', participant_type: 'VENDOR' }];
        }
      }
      return { items: [], total: 0 };
    });

    render(
      <ThemeProvider>
        <ReportingDashboard />
      </ThemeProvider>
    );

    const playButtonB = await screen.findByRole('button', { name: /Play recording/i });
    fireEvent.click(playButtonB);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        '/workspaces/ws-vendor-202/recordings/rec-vendor-99/download'
      );
    });

    // Zero cross-session contamination
    expect(apiFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('ws-buyer-101')
    );
  });
});
