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
      expect(mockPush).toHaveBeenCalledWith('/protected/reporting?status=COMPLETED&groupBy=Campaign&bucket=day&workspace=w1');
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
  }, 20000);
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
      expect(screen.getAllByText('Direct Payload Campaign').length).toBeGreaterThanOrEqual(1);
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

describe('COMM-INTEGRATION-3 Commercial Reporting Frontend Matrix', () => {
  beforeEach(() => {
    mockPush.mockClear();
    localStorage.clear();
    vi.mocked(apiFetch).mockClear();
  });

  it('Owner/Admin view: renders all 7 commercial dimensions without distortion', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('metrics')) {
        return {
          total: 10,
          answered: 8,
          missed: 2,
          failed: 0,
          avgDuration: 120,
          aclSecs: 120,
          tclSecs: 1200,
          revenue: 500.0,
          payout: 200.0,
          cost: 200.0,
          profit: 300.0,
          converted: 5,
          qualified: 7,
          duplicate: 1,
          conversionRate: 0.5,
          commercialCalls: 10,
          campaigns: {
            'c-1': {
              id: 'c-1',
              name: 'Solar Inbound',
              total: 10,
              answered: 8,
              revenue: 500.0,
              payout: 200.0,
              profit: 300.0,
              converted: 5,
              qualified: 7,
              duplicate: 1,
              conversionRate: 0.5,
            }
          },
          buyers: {
            'b-1': {
              id: 'b-1',
              name: 'SunPower Corp',
              total: 10,
              answered: 8,
              revenue: 500.0,
              converted: 5,
              conversionRate: 0.5,
            }
          },
          trackingNumbers: {},
          buckets: [],
        };
      }
      if (typeof url === 'string' && url.includes('calls?')) {
        return {
          items: [
            {
              id: 'call-owner-1',
              created_at: new Date().toISOString(),
              from_number: '+15551112222',
              to_number: '+15553334444',
              state: 'COMPLETED',
              talkDurationSecs: 120,
              totalDurationSecs: 125,
              campaign: { name: 'Solar Inbound' },
              buyer: { name: 'SunPower Corp' },
              commercial: {
                revenue: 50.0,
                payout: 20.0,
                profit: 30.0,
                converted: true,
                qualified: true,
                duplicate: false,
                status: 'FINAL',
                currency: 'USD',
              },
              attempts: [],
              recordings: [],
            }
          ],
          total: 1,
        };
      }
      return [];
    });

    render(<ThemeProvider><ReportingPage /></ThemeProvider>);

    await waitFor(() => {
      // 7 dimensions in summary KPIs
      const revCard = screen.getByTestId('kpi-revenue');
      expect(revCard).toBeDefined();
      expect(revCard.textContent).toContain('$500.00');

      const payCard = screen.getByTestId('kpi-payout');
      expect(payCard).toBeDefined();
      expect(payCard.textContent).toContain('$200.00');

      const profCard = screen.getByTestId('kpi-profit');
      expect(profCard).toBeDefined();
      expect(profCard.textContent).toContain('$300.00');

      expect(screen.getByTestId('kpi-cost')).toBeDefined();

      const convCard = screen.getByTestId('kpi-converted');
      expect(convCard.textContent).toContain('5');

      const qualCard = screen.getByTestId('kpi-qualified');
      expect(qualCard.textContent).toContain('7');

      const dupCard = screen.getByTestId('kpi-duplicate');
      expect(dupCard.textContent).toContain('1');
    });

    // Check table headers have commercial columns
    expect(screen.getAllByText('Solar Inbound').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('$50.00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('$20.00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('$30.00').length).toBeGreaterThanOrEqual(1);
  });

  it('Buyer view: hides payout, cost, profit without displaying false $0.00', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('metrics')) {
        return {
          total: 10,
          answered: 8,
          missed: 2,
          failed: 0,
          avgDuration: 120,
          aclSecs: 120,
          tclSecs: 1200,
          revenue: 500.0,
          // payout, cost, profit intentionally omitted by backend
          converted: 5,
          qualified: 7,
          duplicate: 1,
          conversionRate: 0.5,
          commercialCalls: 10,
          campaigns: {
            'c-1': {
              id: 'c-1',
              name: 'Solar Inbound',
              total: 10,
              answered: 8,
              revenue: 500.0,
              converted: 5,
              qualified: 7,
              duplicate: 1,
              conversionRate: 0.5,
            }
          },
          buyers: {
            'b-1': {
              id: 'b-1',
              name: 'SunPower Corp',
              total: 10,
              answered: 8,
              revenue: 500.0,
              converted: 5,
              conversionRate: 0.5,
            }
          },
          trackingNumbers: {},
          buckets: [],
        };
      }
      if (typeof url === 'string' && url.includes('calls?')) {
        return {
          items: [
            {
              id: 'call-buyer-1',
              created_at: new Date().toISOString(),
              from_number: '+15551112222',
              to_number: '+15553334444',
              state: 'COMPLETED',
              talkDurationSecs: 120,
              totalDurationSecs: 125,
              campaign: { name: 'Solar Inbound' },
              buyer: { name: 'SunPower Corp' },
              commercial: {
                revenue: 50.0,
                // payout, profit omitted
                converted: true,
                qualified: true,
                duplicate: false,
                status: 'FINAL',
                currency: 'USD',
              },
              attempts: [],
              recordings: [],
            }
          ],
          total: 1,
        };
      }
      return [];
    });

    render(<ThemeProvider><ReportingPage /></ThemeProvider>);

    await waitFor(() => {
      // Buyer sees Revenue
      const revCard = screen.getByTestId('kpi-revenue');
      expect(revCard).toBeDefined();
      expect(revCard.textContent).toContain('$500.00');

      const convCard = screen.getByTestId('kpi-converted');
      expect(convCard.textContent).toContain('5');

      const qualCard = screen.getByTestId('kpi-qualified');
      expect(qualCard.textContent).toContain('7');

      const dupCard = screen.getByTestId('kpi-duplicate');
      expect(dupCard.textContent).toContain('1');
    });

    // Payout, Cost, Profit must NOT be rendered (nor as $0.00)
    expect(screen.queryByTestId('kpi-payout')).toBeNull();
    expect(screen.queryByTestId('kpi-profit')).toBeNull();
    expect(screen.queryByTestId('kpi-cost')).toBeNull();
  });

  it('Vendor view: hides revenue, cost, profit, and buyer performance without false $0.00', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('metrics')) {
        return {
          total: 10,
          answered: 8,
          missed: 2,
          failed: 0,
          avgDuration: 120,
          aclSecs: 120,
          tclSecs: 1200,
          payout: 200.0,
          // revenue, cost, profit omitted
          converted: 5,
          qualified: 7,
          duplicate: 1,
          conversionRate: 0.5,
          commercialCalls: 10,
          campaigns: {
            'c-1': {
              id: 'c-1',
              name: 'Solar Inbound',
              total: 10,
              answered: 8,
              payout: 200.0,
              converted: 5,
              qualified: 7,
              duplicate: 1,
              conversionRate: 0.5,
            }
          },
          buyers: {}, // masked/empty for vendor
          trackingNumbers: {},
          buckets: [],
        };
      }
      if (typeof url === 'string' && url.includes('calls?')) {
        return {
          items: [
            {
              id: 'call-vendor-1',
              created_at: new Date().toISOString(),
              from_number: '+15551112222',
              to_number: '+15553334444',
              state: 'COMPLETED',
              talkDurationSecs: 120,
              totalDurationSecs: 125,
              campaign: { name: 'Solar Inbound' },
              // buyer name omitted
              commercial: {
                payout: 20.0,
                // revenue, profit omitted
                converted: true,
                qualified: true,
                duplicate: false,
                status: 'FINAL',
                currency: 'USD',
              },
              attempts: [],
              recordings: [],
            }
          ],
          total: 1,
        };
      }
      return [];
    });

    render(<ThemeProvider><ReportingPage /></ThemeProvider>);

    await waitFor(() => {
      // Vendor sees Payout
      const payCard = screen.getByTestId('kpi-payout');
      expect(payCard).toBeDefined();
      expect(payCard.textContent).toContain('$200.00');

      const convCard = screen.getByTestId('kpi-converted');
      expect(convCard.textContent).toContain('5');

      const qualCard = screen.getByTestId('kpi-qualified');
      expect(qualCard.textContent).toContain('7');

      const dupCard = screen.getByTestId('kpi-duplicate');
      expect(dupCard.textContent).toContain('1');
    });

    // Revenue, Cost, Profit must NOT be rendered
    expect(screen.queryByTestId('kpi-revenue')).toBeNull();
    expect(screen.queryByTestId('kpi-profit')).toBeNull();
    expect(screen.queryByTestId('kpi-cost')).toBeNull();

    // Destination / Buyer column is masked for vendors
    expect(screen.queryByText('Final Destination')).toBeNull();
  });

  it('Non-commercial Member view: hides all financial KPI cards', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('metrics')) {
        return {
          total: 10,
          answered: 8,
          missed: 2,
          failed: 0,
          avgDuration: 120,
          aclSecs: 120,
          tclSecs: 1200,
          // revenue, payout, cost, profit omitted
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
      expect(screen.getByText('Total Calls')).toBeDefined();
      expect(screen.getByText('Answered')).toBeDefined();
    });

    // No financial cards
    expect(screen.queryByText('Revenue')).toBeNull();
    expect(screen.queryByText('Payout')).toBeNull();
    expect(screen.queryByText('Profit')).toBeNull();
    expect(screen.queryByText('Cost')).toBeNull();
  });

  it('Forbidden state (403): displays explicit permission error banner', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('metrics')) {
        throw new Error('Forbidden: Insufficient permissions to view call reporting');
      }
      return { items: [], total: 0 };
    });

    render(<ThemeProvider><ReportingPage /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('Unable to load reporting data')).toBeDefined();
      expect(screen.getByText('Forbidden: Insufficient permissions to view call reporting')).toBeDefined();
    });
  });

  it('Buyer grouping: renders successfully when stats.failed is undefined without toLocaleString crash', async () => {
    mockSearchParams.set('groupBy', 'Buyer');
    vi.mocked(apiFetch).mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('metrics')) {
        return {
          total: 10,
          answered: 8,
          missed: 2,
          failed: 0,
          avgDuration: 45,
          tclSecs: 360,
          aclSecs: 45,
          campaigns: {},
          buyers: {
            'b-1': {
              id: 'b-1',
              name: 'Solar Buyer',
              total: 10,
              answered: 8,
            }
          },
          trackingNumbers: {},
          buckets: []
        };
      }
      return { items: [], total: 0 };
    });

    render(<ThemeProvider><ReportingPage /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('Solar Buyer')).toBeDefined();
    });

    expect(screen.getByText('Solar Buyer')).toBeDefined();
    expect(screen.getAllByText('10').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('8').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(1);

    mockSearchParams.delete('groupBy');
  });
  it('requests bucket=day for metrics time-series when bucket is not in searchParams', async () => {
    let requestedMetricsUrl = '';
    vi.mocked(apiFetch).mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/calls/metrics')) {
        requestedMetricsUrl = url;
        return Promise.resolve({
          total: 21,
          answered: 5,
          missed: 5,
          failed: 11,
          blocked: 0,
          answerRate: 23.81,
          avgDuration: 20,
          tclSecs: 100,
          aclSecs: 20,
          campaigns: {},
          buyers: {},
          trackingNumbers: {},
          buckets: [
            {
              time: '2026-09-30T00:00:00.000Z',
              total: 21,
              answered: 5,
              missed: 5,
              failed: 11,
              blocked: 0,
            }
          ]
        });
      }
      return Promise.resolve({ items: [], total: 0 });
    });

    render(<ThemeProvider><ReportingPage /></ThemeProvider>);

    await waitFor(() => {
      expect(requestedMetricsUrl).toContain('bucket=day');
    });

    expect(screen.queryByText('No time-series data available.')).toBeNull();
  });
});


import { getFinalDestinationDisplay, isValidPhoneNumber, formatPhoneNumber, getStatusBadgeVariant } from './page';

describe('Reporting Data Integrity - Status, Destination & Duration Suite', () => {
  it('getStatusBadgeVariant correctly maps call states to visual variants', () => {
    expect(getStatusBadgeVariant('COMPLETED')).toBe('success');
    expect(getStatusBadgeVariant('ANSWERED')).toBe('success');
    expect(getStatusBadgeVariant('NO_ANSWER')).toBe('error');
    expect(getStatusBadgeVariant('FAILED')).toBe('error');
    expect(getStatusBadgeVariant('CANCELED')).toBe('error');
    expect(getStatusBadgeVariant('BLOCKED')).toBe('error');
    expect(getStatusBadgeVariant('ROUTING')).toBe('warning');
    expect(getStatusBadgeVariant('RINGING')).toBe('warning');
    expect(getStatusBadgeVariant('ACTIVE')).toBe('warning');
    expect(getStatusBadgeVariant('UNKNOWN')).toBe('default');
  });

  it('getFinalDestinationDisplay handles completed/canceled 0-attempt calls and in-progress calls', () => {
    expect(getFinalDestinationDisplay({ state: 'COMPLETED', attempts: [] })).toBe('No successful destination');
    expect(getFinalDestinationDisplay({ state: 'CANCELED', attempts: [] })).toBe('No successful destination');
    expect(getFinalDestinationDisplay({ state: 'ROUTING', attempts: [{ state: 'RINGING' }] })).toBe('—');
    expect(getFinalDestinationDisplay({ state: 'COMPLETED', destination_number: '+15554443333', attempts: [] })).toBe('+15554443333');
  });
});

describe('Final Destination Column Regression Suite', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockClear();
  });

  it('1. Successful destination with a phone number renders formatted E.164 phone number', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('/calls?')) {
        return {
          items: [
            {
              id: 'call-1',
              from_number: '+15551112222',
              to_number: '+15553334444',
              state: 'COMPLETED',
              created_at: '2026-10-01T12:00:00Z',
              attempts: [
                {
                  id: 'att-1',
                  state: 'COMPLETED',
                  buyer: { name: 'Acme Solar', destination_number: '+15558889999' }
                }
              ]
            }
          ],
          total: 1
        };
      }
      return { items: [], total: 0 };
    });

    render(<ThemeProvider><ReportingPage /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('+15558889999')).toBeDefined();
    });
  });

  it('2. No successful destination renders "No successful destination"', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('/calls?')) {
        return {
          items: [
            {
              id: 'call-2',
              from_number: '+15551112222',
              to_number: '+15553334444',
              state: 'FAILED',
              created_at: '2026-10-01T12:00:00Z',
              attempts: [
                {
                  id: 'att-2',
                  state: 'FAILED',
                  buyer: { name: 'Acme Solar', destination_number: '+15558889999' }
                }
              ]
            }
          ],
          total: 1
        };
      }
      return { items: [], total: 0 };
    });

    render(<ThemeProvider><ReportingPage /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('No successful destination')).toBeDefined();
      expect(screen.queryByText('+15558889999')).toBeNull();
    });
  });

  it('3. Successful connection with a missing destination number renders "Destination unavailable"', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('/calls?')) {
        return {
          items: [
            {
              id: 'call-3',
              from_number: '+15551112222',
              to_number: '+15553334444',
              state: 'COMPLETED',
              created_at: '2026-10-01T12:00:00Z',
              attempts: [
                {
                  id: 'att-3',
                  state: 'COMPLETED',
                  buyer: { name: 'Acme Solar', destination_number: null }
                }
              ]
            }
          ],
          total: 1
        };
      }
      return { items: [], total: 0 };
    });

    render(<ThemeProvider><ReportingPage /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('Destination unavailable')).toBeDefined();
      expect(screen.queryByText('No successful destination')).toBeNull();
    });
  });

  it('4. Missing or unknown destination status renders "—"', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('/calls?')) {
        return {
          items: [
            {
              id: 'call-4',
              from_number: '+15551112222',
              to_number: '+15553334444',
              state: 'INITIATED',
              created_at: '2026-10-01T12:00:00Z',
              attempts: []
            }
          ],
          total: 1
        };
      }
      return { items: [], total: 0 };
    });

    render(<ThemeProvider><ReportingPage /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getAllByText('—').length).toBeGreaterThan(0);
      expect(screen.queryByText('No successful destination')).toBeNull();
      expect(screen.queryByText('Destination unavailable')).toBeNull();
    });
  });

  it('5. Numeric destination ID "1" must not render as a phone number', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('/calls?')) {
        return {
          items: [
            {
              id: 'call-5',
              from_number: '+15551112222',
              to_number: '+15553334444',
              state: 'COMPLETED',
              created_at: '2026-10-01T12:00:00Z',
              attempts: [
                {
                  id: 'att-5',
                  state: 'COMPLETED',
                  buyer: { name: '1', destination_number: '1' }
                }
              ]
            }
          ],
          total: 1
        };
      }
      return { items: [], total: 0 };
    });

    render(<ThemeProvider><ReportingPage /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getByText('Destination unavailable')).toBeDefined();
      expect(screen.queryByText(/^1$/)).toBeNull();
    });
  });

  it('6. Vendor response does not expose unauthorized buyer/destination data', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('metrics')) {
        return {
          total: 1,
          answered: 1,
          missed: 0,
          failed: 0,
          payout: 25,
          campaigns: {},
          buyers: {},
          trackingNumbers: {},
          buckets: []
        };
      }
      if (typeof url === 'string' && url.includes('/calls?')) {
        return {
          items: [
            {
              id: 'call-vendor',
              from_number: '+15551112222',
              to_number: '+15553334444',
              state: 'COMPLETED',
              commercial: { payout: 25, currency: 'USD' },
              attempts: [
                {
                  id: 'att-vendor',
                  state: 'COMPLETED'
                }
              ]
            }
          ],
          total: 1
        };
      }
      return { items: [], total: 0 };
    });

    render(<ThemeProvider><ReportingPage /></ThemeProvider>);

    await waitFor(() => {
      expect(screen.getAllByText('Payout').length).toBeGreaterThan(0);
    });

    expect(screen.queryByText('Final Destination')).toBeNull();
    expect(screen.queryByText('Acme Solar')).toBeNull();
  });

  it('7. Direct helper tests for getFinalDestinationDisplay, isValidPhoneNumber, formatPhoneNumber', () => {
    expect(isValidPhoneNumber(1)).toBe(false);
    expect(isValidPhoneNumber('1')).toBe(false);
    expect(isValidPhoneNumber('0')).toBe(false);
    expect(isValidPhoneNumber('')).toBe(false);
    expect(isValidPhoneNumber(null)).toBe(false);
    expect(isValidPhoneNumber(undefined)).toBe(false);
    expect(isValidPhoneNumber('12345')).toBe(false);
    expect(isValidPhoneNumber('+15558889999')).toBe(true);
    expect(isValidPhoneNumber('5558889999')).toBe(true);

    expect(formatPhoneNumber('+15558889999')).toBe('+15558889999');
    expect(formatPhoneNumber('5558889999')).toBe('+15558889999');

    expect(getFinalDestinationDisplay({
      state: 'COMPLETED',
      attempts: [{ state: 'COMPLETED', buyer: { destination_number: '+15558889999' } }]
    })).toBe('+15558889999');

    expect(getFinalDestinationDisplay({
      state: 'FAILED',
      attempts: [{ state: 'FAILED', buyer: { destination_number: '+15558889999' } }]
    })).toBe('No successful destination');

    expect(getFinalDestinationDisplay({
      state: 'COMPLETED',
      attempts: [{ state: 'COMPLETED', buyer: { destination_number: null } }]
    })).toBe('Destination unavailable');

    expect(getFinalDestinationDisplay({
      state: 'INITIATED',
      attempts: []
    })).toBe('—');
    expect(getFinalDestinationDisplay(null)).toBe('—');

    expect(getFinalDestinationDisplay({
      state: 'COMPLETED',
      attempts: [{ state: 'COMPLETED', buyer: { destination_number: '1' } }]
    })).toBe('Destination unavailable');
  });

  describe('Detailed Calls Talk and Total Duration Formatting & Rendering', () => {
    it('renders connected talk duration, total lifetime, zero-duration (00:00), and null (—) accurately', async () => {
      vi.mocked(apiFetch).mockImplementation((url) => {
        if (typeof url === 'string' && url.includes('calls?')) {
          return Promise.resolve({
            items: [
              {
                id: 'call-connected-durations',
                created_at: new Date('2026-10-01T10:00:00Z').toISOString(),
                from_number: '+15551112222',
                to_number: '+15553334444',
                state: 'COMPLETED',
                talkDurationSecs: 125, // 02:05
                totalDurationSecs: 190, // 03:10
                campaign: { name: 'Campaign Alpha' },
                attempts: [],
              },
              {
                id: 'call-zero-durations',
                created_at: new Date('2026-10-01T10:00:00Z').toISOString(),
                from_number: '+15552223333',
                to_number: '+15554445555',
                state: 'COMPLETED',
                talkDurationSecs: 0, // Genuine zero -> 00:00
                totalDurationSecs: 15, // 00:15
                campaign: { name: 'Campaign Beta' },
                attempts: [],
              },
              {
                id: 'call-null-talk-duration',
                created_at: new Date('2026-10-01T10:00:00Z').toISOString(),
                from_number: '+15553334444',
                to_number: '+15555556666',
                state: 'NO_ANSWER',
                talkDurationSecs: null, // Null talk duration -> —
                totalDurationSecs: 60, // 01:00
                campaign: { name: 'Campaign Gamma' },
                attempts: [],
              },
              {
                id: 'call-large-duration',
                created_at: new Date('2026-10-01T10:00:00Z').toISOString(),
                from_number: '+15554445555',
                to_number: '+15556667777',
                state: 'COMPLETED',
                talkDurationSecs: 3665, // 1h 1m 5s
                totalDurationSecs: 3700, // 1h 1m 40s
                campaign: { name: 'Campaign Delta' },
                attempts: [],
              }
            ],
            total: 4,
          });
        }
        return Promise.resolve({
          items: [],
          total: 0,
          answered: 0,
          missed: 0,
          failed: 0,
          buyers: {},
          campaigns: {},
          trackingNumbers: {},
        });
      });

      render(<ThemeProvider><ReportingPage /></ThemeProvider>);

      await waitFor(() => {
        expect(screen.getAllByText('Campaign Alpha').length).toBeGreaterThanOrEqual(1);
      });

      // Assert connected durations: 02:05 and 03:10
      expect(screen.getByText('02:05')).toBeDefined();
      expect(screen.getByText('03:10')).toBeDefined();

      // Assert genuine zero duration: renders 00:00, not —
      expect(screen.getAllByText('00:00').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('00:15')).toBeDefined();

      // Assert hours duration: renders 1h 1m 5s
      expect(screen.getByText('1h 1m 5s')).toBeDefined();
      expect(screen.getByText('1h 1m 40s')).toBeDefined();
    });

    it('Renders NO_ANSWER failed bridge talk duration as dash and completed partial timestamps accurately', async () => {
      vi.mocked(apiFetch).mockImplementation((url: string) => {
        if (url.includes('/calls')) {
          return Promise.resolve({
            items: [
              {
                id: 'call-no-answer-bridge-fail',
                created_at: new Date('2026-10-23T16:37:50Z').toISOString(),
                from_number: '+15551112222',
                to_number: '+15553334444',
                state: 'NO_ANSWER',
                talkDurationSecs: null, // failed bridge must not fabricate talk duration
                totalDurationSecs: 56, // 00:56
                campaign: { name: 'Campaign Failed Bridge' },
                attempts: [],
              },
              {
                id: 'call-historical-completed-partial',
                created_at: new Date('2026-10-23T13:43:19Z').toISOString(),
                from_number: '+15552223333',
                to_number: '+15554445555',
                state: 'COMPLETED',
                talkDurationSecs: 33, // 00:33
                totalDurationSecs: null, // missing timestamps must not be fabricated
                campaign: { name: 'Campaign Historical' },
                attempts: [],
              },
            ],
            total: 2,
          });
        }
        return Promise.resolve({
          items: [],
          total: 0,
          answered: 0,
          missed: 0,
          failed: 0,
          buyers: {},
          campaigns: {},
          trackingNumbers: {},
        });
      });

      render(<ThemeProvider><ReportingPage /></ThemeProvider>);

      await waitFor(() => {
        expect(screen.getByText('Campaign Failed Bridge')).toBeDefined();
        expect(screen.getByText('Campaign Historical')).toBeDefined();
      });

      // Total duration 56s renders 00:56
      expect(screen.getByText('00:56')).toBeDefined();
      // Talk duration 33s renders 00:33
      expect(screen.getByText('00:33')).toBeDefined();
      // Null durations render as em dashes
      const dashes = screen.getAllByText('—');
      expect(dashes.length).toBeGreaterThanOrEqual(2);
    });
  });


  describe('ReportingPage Filter Dropdowns & Tenant Isolation Matrix', () => {
    beforeEach(() => {
      mockPush.mockClear();
      vi.mocked(apiFetch).mockClear();
    });

    it('loads dropdown options from authorized API and populates select elements', async () => {
      vi.mocked(apiFetch).mockImplementation((url: string) => {
        if (url === '/workspaces') {
          return Promise.resolve([{ id: 'w1', name: 'Admin Workspace', role: 'ADMIN' }]);
        }
        if (url.includes('/phone-numbers')) {
          return Promise.resolve([{ id: 'pn-1', phone_number: '+15551234567' }]);
        }
        if (url.includes('/campaigns')) {
          return Promise.resolve([{ id: 'camp-1', name: 'Auto Insurance Lead Flow' }]);
        }
        if (url.includes('/buyers')) {
          return Promise.resolve({ items: [{ id: 'buyer-1', name: 'Acme Buyers Inc' }] });
        }
        if (url.includes('/vendors')) {
          return Promise.resolve({ items: [{ id: 'vendor-1', name: 'TopTier Traffic Vendor' }] });
        }
        if (url.includes('/reports')) {
          return Promise.resolve([]);
        }
        return Promise.resolve({
          items: [],
          total: 0,
          answered: 0,
          missed: 0,
          failed: 0,
          buyers: {},
          campaigns: {},
          trackingNumbers: {},
        });
      });

      render(<ThemeProvider><ReportingPage /></ThemeProvider>);

      await waitFor(() => {
        expect(screen.getByText('Auto Insurance Lead Flow')).toBeDefined();
        expect(screen.getByText('Acme Buyers Inc')).toBeDefined();
        expect(screen.getByText('TopTier Traffic Vendor')).toBeDefined();
        expect(screen.getByText('+15551234567')).toBeDefined();
      });

      // Verify "All" options exist
      expect(screen.getByText('All Campaigns')).toBeDefined();
      expect(screen.getByText('All Buyers')).toBeDefined();
      expect(screen.getByText('All Vendors')).toBeDefined();
      expect(screen.getByText('All Numbers')).toBeDefined();
      expect(screen.getByText('All Statuses')).toBeDefined();
    });

    it('allows selecting dropdown options and applying filters with router push', async () => {
      vi.mocked(apiFetch).mockImplementation((url: string) => {
        if (url === '/workspaces') {
          return Promise.resolve([{ id: 'w1', name: 'Admin Workspace', role: 'ADMIN' }]);
        }
        if (url.includes('/phone-numbers')) {
          return Promise.resolve([{ id: 'pn-1', phone_number: '+15551234567' }]);
        }
        if (url.includes('/campaigns')) {
          return Promise.resolve([{ id: 'camp-1', name: 'Campaign Alpha' }]);
        }
        if (url.includes('/buyers')) {
          return Promise.resolve([{ id: 'buyer-1', name: 'Buyer Alpha' }]);
        }
        if (url.includes('/vendors')) {
          return Promise.resolve([{ id: 'vendor-1', name: 'Vendor Alpha' }]);
        }
        return Promise.resolve({
          items: [], total: 0, answered: 0, missed: 0, failed: 0,
          buyers: {}, campaigns: {}, trackingNumbers: {}
        });
      });

      render(<ThemeProvider><ReportingPage /></ThemeProvider>);

      await waitFor(() => {
        expect(screen.getAllByText('Campaign Alpha').length).toBeGreaterThanOrEqual(1);
      });

      const campaignSelect = document.getElementById('campaignId') as HTMLSelectElement;
      expect(campaignSelect).toBeDefined();
      fireEvent.change(campaignSelect, { target: { value: 'camp-1' } });

      const statusSelect = document.getElementById('status') as HTMLSelectElement;
      expect(statusSelect).toBeDefined();
      fireEvent.change(statusSelect, { target: { value: 'COMPLETED' } });

      const applyBtn = screen.getByRole('button', { name: /Apply Filters/i });
      fireEvent.click(applyBtn);

      expect(mockPush).toHaveBeenCalled();
      const pushedUrl = mockPush.mock.calls[0][0];
      expect(pushedUrl).toContain('campaignId=camp-1');
      expect(pushedUrl).toContain('status=COMPLETED');
      expect(pushedUrl).toContain('workspace=w1');
    });

    it('vendor role isolation: hides Buyer and Vendor dropdowns for Vendor participants', async () => {
      vi.mocked(apiFetch).mockImplementation((url: string) => {
        if (url === '/workspaces') {
          return Promise.resolve([{ id: 'w1', name: 'Vendor Workspace', role: 'MEMBER', participant_type: 'VENDOR' }]);
        }
        if (url.includes('/phone-numbers')) {
          return Promise.resolve([{ id: 'pn-1', phone_number: '+15559998888' }]);
        }
        if (url.includes('/campaigns')) {
          return Promise.resolve([{ id: 'camp-v', name: 'Assigned Vendor Campaign' }]);
        }
        return Promise.resolve({
          items: [], total: 0, answered: 0, missed: 0, failed: 0,
          payout: 50,
          buyers: {}, campaigns: {}, trackingNumbers: {}
        });
      });

      render(<ThemeProvider><ReportingPage /></ThemeProvider>);

      await waitFor(() => {
        expect(screen.getByText('Assigned Vendor Campaign')).toBeDefined();
      });

      // Verify Buyer and Vendor dropdowns are not rendered
      expect(document.getElementById('buyerId')).toBeNull();
      expect(document.getElementById('vendorId')).toBeNull();

      // Verify Campaign and Tracking Number dropdowns ARE rendered
      expect(document.getElementById('campaignId')).not.toBeNull();
      expect(document.getElementById('trackingNumber')).not.toBeNull();
    });

    it('buyer role isolation: hides Vendor dropdown for Buyer participants', async () => {
      vi.mocked(apiFetch).mockImplementation((url: string) => {
        if (url === '/workspaces') {
          return Promise.resolve([{ id: 'w1', name: 'Buyer Workspace', role: 'MEMBER', participant_type: 'BUYER' }]);
        }
        if (url.includes('/phone-numbers')) {
          return Promise.resolve([{ id: 'pn-1', phone_number: '+15559998888' }]);
        }
        if (url.includes('/campaigns')) {
          return Promise.resolve([{ id: 'camp-b', name: 'Buyer Campaign' }]);
        }
        if (url.includes('/buyers')) {
          return Promise.resolve([{ id: 'b-self', name: 'My Buyer Org' }]);
        }
        return Promise.resolve({
          items: [], total: 0, answered: 0, missed: 0, failed: 0,
          revenue: 100,
          buyers: {}, campaigns: {}, trackingNumbers: {}
        });
      });

      render(<ThemeProvider><ReportingPage /></ThemeProvider>);

      await waitFor(() => {
        expect(screen.getByText('Buyer Campaign')).toBeDefined();
      });

      // Verify Vendor dropdown is not rendered
      expect(document.getElementById('vendorId')).toBeNull();

      // Buyer dropdown is rendered
      expect(document.getElementById('buyerId')).not.toBeNull();
    });
  });

  describe('Caller ID Formatting & Workspace Context Regression Suite', () => {
    beforeEach(() => {
      mockPush.mockClear();
      vi.mocked(apiFetch).mockClear();
      sessionStorage.clear();
      localStorage.clear();
    });

    it('formats raw SIP caller "+1919926005557@208.69.83.26" as clean "+1919926005557" for Owner/Buyer', async () => {
      vi.mocked(apiFetch).mockImplementation((url: string) => {
        if (url === '/workspaces') {
          return Promise.resolve([{ id: 'w1', name: 'Owner Workspace', role: 'OWNER' }]);
        }
        if (url.includes('/calls') && !url.includes('/metrics') && !url.includes('/live-calls')) {
          return Promise.resolve({
            items: [
              {
                id: 'call-sip-1',
                created_at: new Date('2026-10-24T18:13:01.333Z').toISOString(),
                from_number: '+1919926005557@208.69.83.26',
                to_number: '+14845560110',
                state: 'COMPLETED',
                talkDurationSecs: 45,
                totalDurationSecs: 60,
                campaign: { name: 'Campaign Alpha' },
                attempts: [],
              },
              {
                id: 'call-e164-2',
                created_at: new Date('2026-10-24T12:35:43.852Z').toISOString(),
                from_number: '+919926005557',
                to_number: '+14845560110',
                state: 'COMPLETED',
                talkDurationSecs: 30,
                totalDurationSecs: 40,
                campaign: { name: 'Campaign Alpha' },
                attempts: [],
              }
            ],
            total: 2,
          });
        }
        return Promise.resolve({
          items: [], total: 0, answered: 2, missed: 0, failed: 0,
          buyers: {}, campaigns: {}, trackingNumbers: {}
        });
      });

      render(<ThemeProvider><ReportingPage /></ThemeProvider>);

      await waitFor(() => {
        expect(screen.getAllByText('Campaign Alpha').length).toBeGreaterThanOrEqual(1);
      });

      // Assert both caller rows are rendered with clean E.164 formatting without @IP host
      expect(screen.getByText('+1919926005557')).toBeDefined();
      expect(screen.getByText('+919926005557')).toBeDefined();
      expect(screen.queryByText('+1919926005557@208.69.83.26')).toBeNull();
    }, 15000);

    it('masks caller number for Vendor view without leaking IP address', async () => {
      vi.mocked(apiFetch).mockImplementation((url: string) => {
        if (url === '/workspaces') {
          return Promise.resolve([{ id: 'w1', name: 'Vendor Workspace', role: 'MEMBER', participant_type: 'VENDOR' }]);
        }
        if (url.includes('/calls') && !url.includes('/metrics') && !url.includes('/live-calls')) {
          return Promise.resolve({
            items: [
              {
                id: 'call-sip-vendor',
                created_at: new Date('2026-10-24T18:13:01.333Z').toISOString(),
                from_number: '+1919926005557@208.69.83.26',
                to_number: '+14845560110',
                state: 'COMPLETED',
                talkDurationSecs: 45,
                totalDurationSecs: 60,
                campaign: { name: 'Vendor Campaign' },
                attempts: [],
              }
            ],
            total: 1,
          });
        }
        return Promise.resolve({
          items: [], total: 0, answered: 1, missed: 0, failed: 0,
          payout: 25,
          buyers: {}, campaigns: {}, trackingNumbers: {}
        });
      });

      render(<ThemeProvider><ReportingPage /></ThemeProvider>);

      await waitFor(() => {
        expect(screen.getByText('Vendor Campaign')).toBeDefined();
      });

      // Masked caller should be +1919***5557 and never contain 208 or @
      expect(screen.getByText('+1919***5557')).toBeDefined();
      expect(screen.queryByText(/208.69.83.26/)).toBeNull();
    }, 15000);

    it('preserves workspace ID in URL parameters when applying and resetting filters', async () => {
      vi.mocked(apiFetch).mockImplementation((url: string) => {
        if (url === '/workspaces') {
          return Promise.resolve([{ id: 'w-vendor-1', name: 'Vendor Workspace', role: 'MEMBER', participant_type: 'VENDOR' }]);
        }
        return Promise.resolve({
          items: [], total: 0, answered: 0, missed: 0, failed: 0,
          buyers: {}, campaigns: {}, trackingNumbers: {}
        });
      });

      render(<ThemeProvider><ReportingPage /></ThemeProvider>);

      const applyBtn = screen.getByRole('button', { name: /Apply Filters/i });
      fireEvent.click(applyBtn);

      expect(mockPush).toHaveBeenCalled();
      const pushedApplyUrl = mockPush.mock.calls[0][0];
      expect(pushedApplyUrl).toContain('workspace=w1');

      mockPush.mockClear();
      const resetBtn = screen.getByRole('button', { name: /Reset/i });
      fireEvent.click(resetBtn);

      expect(mockPush).toHaveBeenCalled();
      const pushedResetUrl = mockPush.mock.calls[0][0];
      expect(pushedResetUrl).toContain('workspace=w1');
    }, 15000);

    it('derives campaigns for Vendor workspace from assigned tracking numbers when campaigns endpoint is forbidden', async () => {
      vi.mocked(apiFetch).mockImplementation((url: string) => {
        if (url === '/workspaces') {
          return Promise.resolve([{ id: 'w1', name: 'Vendor WS', role: 'MEMBER', participant_type: 'VENDOR' }]);
        }
        if (url.includes('/campaigns')) {
          return Promise.reject(new Error('Forbidden'));
        }
        if (url.includes('/phone-numbers')) {
          return Promise.resolve({
            items: [
              {
                id: 'pn1',
                phone_number: '+14845560110',
                campaign: { id: 'c-qqq', name: 'qqq' },
              },
            ],
            total: 1,
          });
        }
        return Promise.resolve({
          items: [], total: 0, answered: 0, missed: 0, failed: 0, payout: 0,
          buyers: {}, campaigns: {}, trackingNumbers: {}
        });
      });

      render(<ThemeProvider><ReportingPage /></ThemeProvider>);

      await waitFor(() => {
        expect(screen.getByText('qqq')).toBeDefined();
      });
    }, 15000);
  });
});
