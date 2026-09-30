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

describe('CallsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useSearchParams as any).mockReturnValue({
      get: (key: string) => (key === 'workspace' ? 'test-ws-id' : null),
    });
  });

  it('renders correctly with NULL and Valid Talk/Total Times', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url.includes('/phone-numbers')) return Promise.resolve([{ id: '1', phone_number: '+15550000000' }]);
      if (url.includes('/campaigns')) return Promise.resolve([{ id: 'camp1', name: 'Test Campaign' }]);
      if (url.includes('/calls')) {
        return Promise.resolve({
          items: [
            {
              id: 'call-1',
              created_at: '2026-09-30T10:00:00Z',
              from_number: '+123',
              to_number: '+456',
              state: 'COMPLETED',
              talkDurationSecs: 138,
              totalDurationSecs: 188,
              recordings: [{ id: 'rec-1', status: 'COMPLETED' }]
            },
            {
              id: 'call-2',
              created_at: '2026-09-30T11:00:00Z',
              from_number: '+999',
              to_number: '+888',
              state: 'FAILED',
              talkDurationSecs: null,
              totalDurationSecs: null,
            }
          ],
          total: 2
        });
      }
      return Promise.resolve({});
    });

    const { container } = render(<CallsPage />);

    await waitFor(() => {
      expect(screen.queryByText('02:18')).not.toBeNull();
      expect(screen.queryByText('03:08')).not.toBeNull();
    });

    const nullRenders = screen.queryAllByText('—');
    expect(nullRenders.length).toBeGreaterThan(0);
    expect(container.querySelector('button[aria-label="Play recording"]')).not.toBeNull();
  });

  it('sends correct tracking number filter', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url.includes('/phone-numbers')) return Promise.resolve([{ id: '1', phone_number: '+15550000000' }]);
      if (url.includes('/campaigns')) return Promise.resolve([]);
      if (url.includes('/calls')) return Promise.resolve({ items: [] });
      return Promise.resolve({});
    });

    const { container } = render(<CallsPage />);

    await waitFor(() => {
      expect(container.querySelector('#trackingNumber')).not.toBeNull();
    });

    const trackingSelect = container.querySelector('#trackingNumber') as HTMLSelectElement;
    fireEvent.change(trackingSelect, { target: { value: '+15550000000' } });

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        expect.stringContaining('trackingNumber=%2B15550000000')
      );
    });
  });

  it('sends correct duration filters', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url.includes('/phone-numbers')) return Promise.resolve([]);
      if (url.includes('/campaigns')) return Promise.resolve([]);
      if (url.includes('/calls')) return Promise.resolve({ items: [] });
      return Promise.resolve({});
    });

    const { container } = render(<CallsPage />);

    await waitFor(() => {
      expect(container.querySelector('#durationType')).not.toBeNull();
    });

    const typeSelect = container.querySelector('#durationType') as HTMLSelectElement;
    const minInput = container.querySelector('#minDurationSecs') as HTMLInputElement;
    const maxInput = container.querySelector('#maxDurationSecs') as HTMLInputElement;

    fireEvent.change(typeSelect, { target: { value: 'talk' } });
    fireEvent.change(minInput, { target: { value: '60' } });
    fireEvent.change(maxInput, { target: { value: '120' } });

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        expect.stringContaining('durationType=talk')
      );
      expect(apiFetch).toHaveBeenCalledWith(
        expect.stringContaining('minDurationSecs=60')
      );
      expect(apiFetch).toHaveBeenCalledWith(
        expect.stringContaining('maxDurationSecs=120')
      );
    });
  });
  
  it('clears duration filters correctly', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url.includes('/phone-numbers')) return Promise.resolve([]);
      if (url.includes('/campaigns')) return Promise.resolve([]);
      if (url.includes('/calls')) return Promise.resolve({ items: [] });
      return Promise.resolve({});
    });

    const { container } = render(<CallsPage />);

    await waitFor(() => {
      expect(container.querySelector('#durationType')).not.toBeNull();
    });

    const typeSelect = container.querySelector('#durationType') as HTMLSelectElement;
    const minInput = container.querySelector('#minDurationSecs') as HTMLInputElement;
    
    fireEvent.change(typeSelect, { target: { value: 'total' } });
    fireEvent.change(minInput, { target: { value: '60' } });
    
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining('durationType=total'));
    });

    const clearButton = screen.getByText('Clear Filters');
    fireEvent.click(clearButton);

    await waitFor(() => {
      const call = (apiFetch as any).mock.calls;
      const lastCall = call[call.length - 1][0];
      expect(lastCall).not.toContain('durationType');
      expect(lastCall).not.toContain('minDurationSecs');
    });
  });
});
