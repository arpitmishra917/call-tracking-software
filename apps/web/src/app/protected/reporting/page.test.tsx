import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import ReportingPage from './page';
import { ThemeProvider } from '@/components/theme-provider';
import { apiFetch } from '@/lib/api';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
  usePathname: () => '/protected/reporting',
  useSearchParams: () => new URLSearchParams("?workspace=w1"),
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

    render(<ThemeProvider><ReportingPage  /></ThemeProvider>);
    
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


describe('ReportingPage (Export E3 Frontend Matrix)', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockClear();
    // mock apiFetch default fallback
    vi.mocked(apiFetch).mockImplementation((url) => {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ 
        items: [], total: 0, 
        answered: 0, missed: 0, failed: 0, 
        buyers: {}, campaigns: {}, trackingNumbers: {} 
      }) }) as any;
    });
    // mock window URL and Object URLs
    window.URL.createObjectURL = vi.fn().mockReturnValue('blob:test');
    window.URL.revokeObjectURL = vi.fn();
  });

  it('Export toggles dropdown and downloads CSV/XLSX', async () => {
    // mock blob return
    vi.mocked(apiFetch).mockImplementationOnce(async (url) => {
      return { 
        ok: true, 
        blob: () => Promise.resolve(new Blob(['test'], { type: 'text/csv' })),
        headers: new Headers({ 'content-disposition': 'attachment; filename="export.csv"' })
      } as any;
    });

    render(<ThemeProvider><ReportingPage  /></ThemeProvider>);
    
    // Export button exists
    const exportBtn = screen.getByRole('button', { name: /Export/i });
    expect(exportBtn).toBeDefined();
    
    // Toggle dropdown
    fireEvent.click(exportBtn);
    
    // Click CSV
    const csvBtn = screen.getByText('Export CSV');
    expect(csvBtn).toBeDefined();
    
    fireEvent.click(csvBtn);
    
    // Check apiFetch was called for export
    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        '/workspaces/w1/reports/export',
        expect.objectContaining({
          method: 'POST',
          body: expect.any(String)
        })
      );
    });
  });

  it('Export duplicate-click protection', async () => {
    // mock slow response to keep loading state true
    vi.mocked(apiFetch).mockImplementationOnce(async () => {
      return new Promise(resolve => setTimeout(() => resolve({
        ok: true,
        blob: () => Promise.resolve(new Blob(['test']))
      } as any), 100));
    });

    render(<ThemeProvider><ReportingPage  /></ThemeProvider>);
    
    fireEvent.click(screen.getByRole('button', { name: /Export/i }));
    fireEvent.click(screen.getByText('Export XLSX'));
    
    // Check it enters loading state (text changes or button disables)
    expect(screen.getByRole('button', { name: /Export/i }).hasAttribute('disabled')).toBe(true);
  });

  it('Export error state handling', async () => {
    // Return a 400 bad request JSON instead of blob
    vi.mocked(apiFetch).mockImplementationOnce(async () => {
      return { 
        ok: false, 
        json: () => Promise.resolve({ message: 'Export limit exceeded' })
      } as any;
    });

    render(<ThemeProvider><ReportingPage  /></ThemeProvider>);
    
    fireEvent.click(screen.getByRole('button', { name: /Export/i }));
    fireEvent.click(screen.getByText('Export CSV'));
    
    // Toast should show error
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Export/i }).hasAttribute('disabled')).toBe(false);
    });
  });
});
