import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import CallsPage from './page';
import { apiFetch } from '@/lib/api';
import { useSearchParams } from 'next/navigation';

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(),
}));

vi.mock('@/components/ui/card', () => ({ Card: 'div', CardHeader: 'div', CardTitle: 'div', CardContent: 'div' }));
vi.mock('@/components/ui/table', () => ({ Table: 'table', TableHeader: 'thead', TableRow: 'tr', TableHead: 'th', TableBody: 'tbody', TableCell: 'td' }));
vi.mock('@/components/ui/badge', () => ({ Badge: 'span' }));
vi.mock('@/components/ui/input', () => ({ Input: 'input' }));
vi.mock('@/components/ui/label', () => ({ Label: (props: any) => <label htmlFor={props.htmlFor}>{props.children}</label> }));
vi.mock('@/components/ui/button', () => ({ Button: 'button' }));
vi.mock('@/components/ui/empty-state', () => ({ EmptyState: ({title}: any) => <div>{title}</div> }));
vi.mock('lucide-react', () => ({ PhoneCall: () => null, Search: () => null, X: () => null, Play: () => null, AlertCircle: () => null }));
vi.mock('next/link', () => ({ default: (props: any) => <a {...props} /> }));
vi.mock('@/components/ui/recording-player', () => ({
  InlineRecordingPlayer: () => <button>Play</button>,
}));

describe('CallsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useSearchParams as any).mockReturnValue({
      get: (key: string) => (key === 'workspace' ? 'test-ws-id' : null),
    });
  });

  const mockDropdowns = () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url.includes('/phone-numbers')) return Promise.resolve([{ id: '1', phone_number: '+13215033884' }, { id: '2', phone_number: '+17658268661' }]);
      if (url.includes('/campaigns')) return Promise.resolve([{ id: 'camp1', name: 'Test Campaign' }]);
      if (url.includes('/calls')) {
        return Promise.resolve({
          items: [
            {
              id: 'call-1',
              created_at: '2026-09-30T10:00:00Z',
              from_number: '+123',
              to_number: '+13215033884',
              state: 'COMPLETED',
              talkDurationSecs: 120,
              totalDurationSecs: 130,
              recordings: [{ id: 'rec1', status: 'COMPLETED' }]
            },
            {
              id: 'call-2',
              created_at: '2026-09-30T10:00:00Z',
              from_number: '+456',
              to_number: '+17658268661',
              state: 'COMPLETED',
              talkDurationSecs: null,
              totalDurationSecs: null,
              recordings: []
            }
          ]
        });
      }
      return Promise.resolve({});
    });
  };

  it('1. API response: talkDurationSecs: 120, totalDurationSecs: 130 renders 02:00, 02:10 not —', async () => {
    mockDropdowns();
    render(<CallsPage />);
    await waitFor(() => {
      expect(screen.getByText('02:00')).toBeTruthy();
      expect(screen.getByText('02:10')).toBeTruthy();
    });
  });

  it('2. Legacy calls without lifecycle data remain —', async () => {
    mockDropdowns();
    render(<CallsPage />);
    await waitFor(() => {
      const emptyCells = screen.getAllByText('—');
      expect(emptyCells.length).toBeGreaterThan(0);
    });
  });

  it('3. Recording metadata appears when recording exists (Play control)', async () => {
    mockDropdowns();
    render(<CallsPage />);
    await waitFor(() => {
      expect(screen.getByText('Play')).toBeTruthy();
    });
  });

  it('4. Tracking Number selection: +13215033884 sends correct param', async () => {
    mockDropdowns();
    render(<CallsPage />);
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining('/calls?'));
    });
    const select = screen.getByLabelText('Tracking Number');
    fireEvent.change(select, { target: { value: '+13215033884' } });
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining('trackingNumber=%2B13215033884'));
    });
  });

  it('5. Campaign selection sends campaignId', async () => {
    mockDropdowns();
    render(<CallsPage />);
    await waitFor(() => expect(screen.getByLabelText('Campaign')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Campaign'), { target: { value: 'camp1' } });
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining('campaignId=camp1')));
  });

  it('6. Status selection sends status', async () => {
    mockDropdowns();
    render(<CallsPage />);
    await waitFor(() => expect(screen.getByLabelText('Status')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'COMPLETED' } });
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining('status=COMPLETED')));
  });

  it('7. Caller input sends callerNumber', async () => {
    mockDropdowns();
    render(<CallsPage />);
    await waitFor(() => expect(screen.getByLabelText('Caller Number')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Caller Number'), { target: { value: '+1234' } });
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining('callerNumber=%2B1234')));
  });

  it('8. Talk duration sends durationType=talk', async () => {
    mockDropdowns();
    render(<CallsPage />);
    await waitFor(() => expect(screen.getByLabelText('Duration Type')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Duration Type'), { target: { value: 'talk' } });
    fireEvent.change(screen.getByLabelText('Min (s)'), { target: { value: '60' } });
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining('durationType=talk')));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining('minDurationSecs=60')));
  });

  it('9. Total duration sends durationType=total', async () => {
    mockDropdowns();
    render(<CallsPage />);
    await waitFor(() => expect(screen.getByLabelText('Duration Type')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Duration Type'), { target: { value: 'total' } });
    fireEvent.change(screen.getByLabelText('Min (s)'), { target: { value: '80' } });
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining('durationType=total')));
  });

  it('10. Date filters send correct values', async () => {
    mockDropdowns();
    render(<CallsPage />);
    await waitFor(() => expect(screen.getByLabelText('Start Date')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Start Date'), { target: { value: '2026-10-01' } });
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining('startDate=2026-10-01')));
  });

  it('11. Clear Filters resets everything', async () => {
    mockDropdowns();
    render(<CallsPage />);
    await waitFor(() => expect(screen.getByText('Clear Filters')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'FAILED' } });
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining('status=FAILED')));
    
    fireEvent.click(screen.getByText('Clear Filters'));
    await waitFor(() => {
      // should trigger new fetch without status
      const calls = (apiFetch as any).mock.calls;
      const lastCall = calls[calls.length - 1][0];
      expect(lastCall.includes('status=FAILED')).toBe(false);
    });
  });

  it('12. Workspace switching race condition: Stale in-flight response from Workspace A does not overwrite Workspace B', async () => {
    let resolveWorkspaceA: (val: any) => void;
    const pendingWorkspaceA = new Promise((resolve) => {
      resolveWorkspaceA = resolve;
    });

    (apiFetch as any).mockImplementation((url: string) => {
      if (url.includes('/phone-numbers')) return Promise.resolve([]);
      if (url.includes('/campaigns')) return Promise.resolve([]);
      if (url.includes('/buyers')) return Promise.resolve([]);
      if (url.includes('/workspaces/workspace-A/calls')) {
        return pendingWorkspaceA;
      }
      if (url.includes('/workspaces/workspace-B/calls')) {
        return Promise.resolve({
          items: [
            {
              id: 'call-ws-b',
              created_at: '2026-10-01T12:00:00Z',
              from_number: '+1999',
              to_number: '+1888',
              state: 'COMPLETED',
              talkDurationSecs: 45,
              totalDurationSecs: 50,
            },
          ],
        });
      }
      return Promise.resolve({});
    });

    // Start in Workspace A
    (useSearchParams as any).mockReturnValue({
      get: (key: string) => (key === 'workspace' ? 'workspace-A' : null),
    });

    const { rerender } = render(<CallsPage />);

    // Switch to Workspace B while Workspace A is still pending
    (useSearchParams as any).mockReturnValue({
      get: (key: string) => (key === 'workspace' ? 'workspace-B' : null),
    });
    rerender(<CallsPage />);

    // Verify Workspace B call loaded
    await waitFor(() => {
      expect(screen.getByText('00:45')).toBeTruthy();
    });

    // Now Workspace A resolves late with stale data
    resolveWorkspaceA!({
      items: [
        {
          id: 'call-ws-a',
          created_at: '2026-09-01T10:00:00Z',
          from_number: '+1111',
          to_number: '+1222',
          state: 'COMPLETED',
          talkDurationSecs: 999,
          totalDurationSecs: 1000,
        },
      ],
    });

    // Ensure stale Workspace A call does NOT overwrite Workspace B
    await waitFor(() => {
      expect(screen.queryByText('16:39')).toBeNull();
      expect(screen.getByText('00:45')).toBeTruthy();
    });
  });
});
