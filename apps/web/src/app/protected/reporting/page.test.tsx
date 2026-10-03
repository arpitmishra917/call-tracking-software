import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import ReportingPage from './page';
import { ThemeProvider } from '@/components/theme-provider';
import { apiFetch } from '@/lib/api';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
  usePathname: () => '/protected/reporting',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn()
}));

const mock = Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // Deprecated
    removeListener: vi.fn(), // Deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

describe('ReportingPage (Saved Reports Frontend Matrix)', () => {
  beforeEach(() => {
    mockPush.mockClear();
    localStorage.clear();
  });

  it('Apply report pushes URL state and saves columns', async () => {
    vi.mocked(apiFetch).mockImplementation((url) => {
      if (typeof url === 'string' && url.includes('reports')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([{
          id: 'rep1',
          name: 'Full Dashboard',
          visibility: 'PERSONAL',
          configuration: {
            filters: { status: 'COMPLETED' },
            groupBy: 'Campaign',
            bucket: 'day',
            columns: [{ id: 'caller', visible: true, order: 0 }]
          },
          creator: { display_name: 'Test' }
        }]) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ 
        items: [], total: 0, 
        answered: 0, missed: 0, failed: 0, 
        buyers: {}, campaigns: {}, trackingNumbers: {} 
      }) });
    });

    render(<ThemeProvider><ReportingPage params={{ workspaceId: 'w1' }} /></ThemeProvider>);
    
    // Open reports dropdown
    const btn = screen.getByRole('button', { name: /Saved Reports/i });
    fireEvent.click(btn);
    
    // Wait for reports to load
    await waitFor(() => {
      expect(screen.getByText('Full Dashboard')).toBeDefined();
    });
    
    // Apply the report
    fireEvent.click(screen.getByText('Full Dashboard'));
    
    // Assert 1: URL pushed with active filters/groupBy/bucket
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/protected/reporting?status=COMPLETED&groupBy=Campaign&bucket=day');
    });
    
    // Assert 2: Columns restored + Actions locked
    const ls = JSON.parse(localStorage.getItem('callflow.reporting.columns.w1') || '[]');
    expect(ls).toBeDefined();
    
    const callerCol = ls.find((x: any) => x.id === 'caller');
    expect(callerCol.visible).toBe(true);
    expect(callerCol.order).toBeDefined();
    
    const actionCol = ls.find((x: any) => x.id === 'actions');
    expect(actionCol).toBeDefined();
    expect(actionCol.visible).toBe(true);
  });
});
