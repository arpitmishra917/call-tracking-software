import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import ReportingPage from './page';
import { ThemeProvider } from '@/components/theme-provider';
import { apiFetch, apiDownload } from '@/lib/api';

const mockPush = vi.fn();
const mockSearchParams = new URLSearchParams("?workspace=w1");
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
  usePathname: () => '/protected/reporting',
  useSearchParams: () => mockSearchParams,
}));

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
  apiDownload: vi.fn(),
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
        return Promise.resolve([{
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
        }]);
      }
      return Promise.resolve({ 
        items: [], total: 0, 
        answered: 0, missed: 0, failed: 0, 
        buyers: {}, campaigns: {}, trackingNumbers: {} 
      });
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
    vi.mocked(apiDownload).mockClear();
    // mock apiFetch default fallback
    vi.mocked(apiFetch).mockImplementation((url) => {
      if (typeof url === 'string' && url.includes('reports') && !url.includes('export')) {
        return Promise.resolve([]);
      }
      return Promise.resolve({ 
        items: [], total: 0, 
        answered: 0, missed: 0, failed: 0, 
        buyers: {}, campaigns: {}, trackingNumbers: {} 
      });
    });
    // mock window URL and Object URLs
    window.URL.createObjectURL = vi.fn().mockReturnValue('blob:test');
    window.URL.revokeObjectURL = vi.fn();
  });

  it('CSV export successfully downloads a Blob and does NOT call apiFetch', async () => {
    const mockBlob = new Blob(['test-csv-content'], { type: 'text/csv' });
    vi.mocked(apiDownload).mockResolvedValueOnce({
      blob: mockBlob,
      filename: null,
      headers: new Headers(),
    });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(<ThemeProvider><ReportingPage /></ThemeProvider>);
    
    // Export button exists
    const exportBtn = screen.getByRole('button', { name: /Export/i });
    expect(exportBtn).toBeDefined();
    
    // Toggle dropdown
    fireEvent.click(exportBtn);
    
    // Click CSV
    const csvBtn = screen.getByText('Export CSV');
    expect(csvBtn).toBeDefined();
    
    fireEvent.click(csvBtn);
    
    // Check apiDownload was called for export with csv format
    await waitFor(() => {
      expect(apiDownload).toHaveBeenCalledWith(
        '/workspaces/w1/reports/export',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"format":"csv"'),
        })
      );
    });

    // Ensure apiFetch was NOT called for export
    expect(apiFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/reports/export'),
      expect.anything()
    );

    // Verify browser download triggers
    expect(window.URL.createObjectURL).toHaveBeenCalledWith(mockBlob);
    expect(clickSpy).toHaveBeenCalled();
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:test');
    clickSpy.mockRestore();
  });

  it('XLSX export successfully downloads a Blob', async () => {
    const mockBlob = new Blob(['test-xlsx-content'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    vi.mocked(apiDownload).mockResolvedValueOnce({
      blob: mockBlob,
      filename: null,
      headers: new Headers(),
    });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(<ThemeProvider><ReportingPage /></ThemeProvider>);

    fireEvent.click(screen.getByRole('button', { name: /Export/i }));
    fireEvent.click(screen.getByText('Export XLSX'));

    await waitFor(() => {
      expect(apiDownload).toHaveBeenCalledWith(
        '/workspaces/w1/reports/export',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"format":"xlsx"'),
        })
      );
    });

    expect(window.URL.createObjectURL).toHaveBeenCalledWith(mockBlob);
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it('Content-Disposition filename is respected when present', async () => {
    const mockBlob = new Blob(['test-content'], { type: 'text/csv' });
    vi.mocked(apiDownload).mockResolvedValueOnce({
      blob: mockBlob,
      filename: 'custom-export-report-2026.csv',
      headers: new Headers({ 'content-disposition': 'attachment; filename="custom-export-report-2026.csv"' }),
    });

    let downloadedFilename = '';
    const origAppendChild = document.body.appendChild.bind(document.body);
    const appendSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
      if (node instanceof HTMLAnchorElement) {
        downloadedFilename = node.download;
      }
      return origAppendChild(node);
    });

    render(<ThemeProvider><ReportingPage /></ThemeProvider>);

    fireEvent.click(screen.getByRole('button', { name: /Export/i }));
    fireEvent.click(screen.getByText('Export CSV'));

    await waitFor(() => {
      expect(downloadedFilename).toBe('custom-export-report-2026.csv');
    });

    appendSpy.mockRestore();
  });

  it('Export duplicate-click protection', async () => {
    let resolveExport: (val: any) => void = () => {};
    vi.mocked(apiDownload).mockImplementationOnce(() => {
      return new Promise(resolve => {
        resolveExport = resolve;
      });
    });

    render(<ThemeProvider><ReportingPage /></ThemeProvider>);
    
    fireEvent.click(screen.getByRole('button', { name: /Export/i }));
    fireEvent.click(screen.getByText('Export XLSX'));
    
    // Check it enters loading state (text changes or button disables)
    expect(screen.getByRole('button', { name: /Export/i }).hasAttribute('disabled')).toBe(true);

    // Resolve the export promise so state settles cleanly
    await act(async () => {
      resolveExport({
        blob: new Blob(['test']),
        filename: 'report.xlsx',
        headers: new Headers(),
      });
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Export/i }).hasAttribute('disabled')).toBe(false);
    });
  });

  it('Export error state handling produces user-facing error alert', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.mocked(apiDownload).mockRejectedValueOnce(new Error('Export quota exceeded'));

    render(<ThemeProvider><ReportingPage /></ThemeProvider>);
    
    fireEvent.click(screen.getByRole('button', { name: /Export/i }));
    fireEvent.click(screen.getByText('Export CSV'));
    
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('Export quota exceeded');
      expect(screen.getByRole('button', { name: /Export/i }).hasAttribute('disabled')).toBe(false);
    });
    alertSpy.mockRestore();
  });
});

describe('ReportingPage (Direct apiFetch Payload Regression)', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockClear();
    localStorage.clear();
  });

  it('renders aggregated metrics directly from parsed payload without .ok', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('metrics')) {
        return {
          total: 150,
          answered: 120,
          missed: 20,
          failed: 10,
          aclSecs: 95,
          tclSecs: 11400,
          campaigns: {},
          buyers: {},
          trackingNumbers: {},
          buckets: [],
        };
      }
      if (typeof url === 'string' && url.includes('reports')) {
        return [];
      }
      return { items: [], total: 0 };
    });

    render(<ThemeProvider><ReportingPage /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('150')).toBeDefined();
      expect(screen.getByText('120')).toBeDefined();
      expect(screen.getByText('20')).toBeDefined();
      expect(screen.getByText('10')).toBeDefined();
    });

    expect(screen.queryByText('Unable to load reporting data')).toBeNull();
    expect(screen.queryByText('Failed to load reporting metrics')).toBeNull();
  });

  it('renders detailed calls directly from parsed payload without .ok', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('metrics')) {
        return {
          total: 1,
          answered: 1,
          missed: 0,
          failed: 0,
          aclSecs: 60,
          tclSecs: 60,
          campaigns: {
            c1: { id: 'c1', name: 'Direct Payload Campaign', total: 1, answered: 1, tclSecs: 60 }
          },
          buyers: {},
          trackingNumbers: {},
          buckets: [],
        };
      }
      if (typeof url === 'string' && url.includes('reports')) {
        return [];
      }
      if (typeof url === 'string' && url.includes('calls?')) {
        return {
          items: [
            {
              id: 'call-regression-1',
              created_at: new Date().toISOString(),
              from_number: '+15551234567',
              to_number: '+15559876543',
              state: 'COMPLETED',
              duration_secs: 60,
              talkDurationSecs: 55,
              totalDurationSecs: 60,
              campaign: { name: 'Direct Payload Campaign' },
              buyer: { name: 'Direct Buyer' },
              attempts: [],
              recordings: [],
            }
          ],
          total: 1,
        };
      }
      return { items: [], total: 0 };
    });

    render(<ThemeProvider><ReportingPage /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getAllByText('+15551234567').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('+15559876543').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Direct Payload Campaign')).toBeDefined();
    });

    expect(screen.queryByText('Unable to load reporting data')).toBeNull();
  });

  it('handles apiFetch error rejection gracefully with error banner', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('metrics')) {
        throw new Error('API error (403): You do not have access to this workspace');
      }
      return [];
    });

    render(<ThemeProvider><ReportingPage /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('Unable to load reporting data')).toBeDefined();
      expect(screen.getByText('API error (403): You do not have access to this workspace')).toBeDefined();
    });
  });
});

describe('ReportingPage (Owner KPI UI Completion)', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockClear();
    vi.mocked(apiDownload).mockClear();
    localStorage.clear();
  });

  it('Answer Rate calculation (answered=25, total=100 -> 25%)', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('metrics')) {
        return {
          total: 100,
          answered: 25,
          missed: 50,
          failed: 25,
          avgDuration: 60,
          aclSecs: 90,
          tclSecs: 9000,
          campaigns: {},
          buyers: {},
          trackingNumbers: {},
          buckets: [],
        };
      }
      if (typeof url === 'string' && url.includes('live-calls')) {
        return { liveCalls: 0 };
      }
      return { items: [], total: 0 };
    });

    render(<ThemeProvider><ReportingPage /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('Answer Rate')).toBeDefined();
      expect(screen.getByText('25%')).toBeDefined();
    });
  });

  it('Answer Rate with total=0 -> 0%', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('metrics')) {
        return {
          total: 0,
          answered: 0,
          missed: 0,
          failed: 0,
          avgDuration: 0,
          aclSecs: 0,
          tclSecs: 0,
          campaigns: {},
          buyers: {},
          trackingNumbers: {},
          buckets: [],
        };
      }
      if (typeof url === 'string' && url.includes('live-calls')) {
        return { liveCalls: 0 };
      }
      return { items: [], total: 0 };
    });

    render(<ThemeProvider><ReportingPage /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('Answer Rate')).toBeDefined();
      expect(screen.getAllByText('0%').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('Average Talk Time avgDuration renders correctly', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('metrics')) {
        return {
          total: 10,
          answered: 10,
          missed: 0,
          failed: 0,
          avgDuration: 125, // 02:05
          aclSecs: 150,
          tclSecs: 1500,
          campaigns: {},
          buyers: {},
          trackingNumbers: {},
          buckets: [],
        };
      }
      if (typeof url === 'string' && url.includes('live-calls')) {
        return { liveCalls: 0 };
      }
      return { items: [], total: 0 };
    });

    render(<ThemeProvider><ReportingPage /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('Average Talk Time')).toBeDefined();
      expect(screen.getByText('02:05')).toBeDefined();
    });
  });

  it('Average Total Time aclSecs renders correctly', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('metrics')) {
        return {
          total: 10,
          answered: 10,
          missed: 0,
          failed: 0,
          avgDuration: 60,
          aclSecs: 3665, // 1h 1m 5s
          tclSecs: 36650,
          campaigns: {},
          buyers: {},
          trackingNumbers: {},
          buckets: [],
        };
      }
      if (typeof url === 'string' && url.includes('live-calls')) {
        return { liveCalls: 0 };
      }
      return { items: [], total: 0 };
    });

    render(<ThemeProvider><ReportingPage /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('Average Total Time')).toBeDefined();
      expect(screen.getByText('1h 1m 5s')).toBeDefined();
    });
  });

  it('Live Calls apiFetch returns { liveCalls: 3 } -> card displays 3', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('metrics')) {
        return {
          total: 5,
          answered: 5,
          missed: 0,
          failed: 0,
          avgDuration: 60,
          aclSecs: 60,
          tclSecs: 300,
          campaigns: {},
          buyers: {},
          trackingNumbers: {},
          buckets: [],
        };
      }
      if (typeof url === 'string' && url.includes('live-calls')) {
        return { liveCalls: 3 };
      }
      return { items: [], total: 0 };
    });

    render(<ThemeProvider><ReportingPage /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('Live Calls')).toBeDefined();
      expect(screen.getByText('3')).toBeDefined();
    });
  });

  it('Live Calls zero { liveCalls: 0 } -> displays 0', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('metrics')) {
        return {
          total: 10,
          answered: 6,
          missed: 3,
          failed: 1,
          avgDuration: 60,
          aclSecs: 60,
          tclSecs: 300,
          campaigns: {},
          buyers: {},
          trackingNumbers: {},
          buckets: [],
        };
      }
      if (typeof url === 'string' && url.includes('live-calls')) {
        return { liveCalls: 0 };
      }
      return { items: [], total: 0 };
    });

    render(<ThemeProvider><ReportingPage /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('Live Calls')).toBeDefined();
      expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('Null ACL: aclSecs=null -> no NaN/error', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('metrics')) {
        return {
          total: 10,
          answered: 5,
          missed: 5,
          failed: 0,
          avgDuration: null,
          aclSecs: null,
          tclSecs: null,
          campaigns: {},
          buyers: {},
          trackingNumbers: {},
          buckets: [],
        };
      }
      if (typeof url === 'string' && url.includes('live-calls')) {
        return { liveCalls: 0 };
      }
      return { items: [], total: 0 };
    });

    render(<ThemeProvider><ReportingPage /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('Average Total Time')).toBeDefined();
      expect(screen.getByText('Average Talk Time')).toBeDefined();
    });

    // Ensure formatDurationHms(null) rendered '00:00' and not NaN / Infinity / undefined
    expect(screen.queryByText(/NaN/)).toBeNull();
    expect(screen.queryByText(/Infinity/)).toBeNull();
    expect(screen.queryByText(/undefined/)).toBeNull();
    expect(screen.getAllByText('00:00').length).toBeGreaterThanOrEqual(2);
  });

  it('apiFetch error for live calls -> existing Reporting error behavior remains sane', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('live-calls')) {
        throw new Error('API error (500): Internal live calls failure');
      }
      if (typeof url === 'string' && url.includes('metrics')) {
        return {
          total: 10,
          answered: 5,
          missed: 5,
          failed: 0,
          avgDuration: 60,
          aclSecs: 60,
          tclSecs: 600,
          campaigns: {},
          buyers: {},
          trackingNumbers: {},
          buckets: [],
        };
      }
      return { items: [], total: 0 };
    });

    render(<ThemeProvider><ReportingPage /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('Unable to load reporting data')).toBeDefined();
      expect(screen.getByText('API error (500): Internal live calls failure')).toBeDefined();
    });
  });
});
