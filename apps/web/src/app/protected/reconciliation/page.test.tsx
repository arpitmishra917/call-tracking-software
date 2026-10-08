import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import ReconciliationPage from './page';
import ReconciliationDetailPage from './[runId]/page';
import { apiFetch } from '@/lib/api';
import { useSearchParams, useParams } from 'next/navigation';

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(),
  useParams: vi.fn(),
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

describe('Reconciliation Frontend & Security (COMM-INTEGRATION-8C)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useSearchParams as any).mockReturnValue({
      get: (key: string) => (key === 'workspace' ? 'ws-test-recon' : null),
    });
    (useParams as any).mockReturnValue({
      runId: 'recon-run-1',
    });
  });

  const mockRuns = [
    {
      id: 'recon-run-1',
      workspace_id: 'ws-test-recon',
      run_type: 'WORKSPACE_LEVEL',
      settlement_batch_id: null,
      status: 'RECONCILED',
      items_checked: 45,
      discrepancy_count: 0,
      created_at: '2026-10-08T12:00:00.000Z',
      updated_at: '2026-10-08T12:00:05.000Z',
      issues: [],
    },
    {
      id: 'recon-run-2',
      workspace_id: 'ws-test-recon',
      run_type: 'BATCH_LEVEL',
      settlement_batch_id: 'batch-201',
      status: 'DISCREPANCY',
      items_checked: 10,
      discrepancy_count: 2,
      created_at: '2026-10-08T11:00:00.000Z',
      updated_at: '2026-10-08T11:00:02.000Z',
      settlement_batch: {
        id: 'batch-201',
        batch_number: 'SB-BUYER-B2-OCT',
        net_amount: '1000.0000',
        currency: 'USD',
        settlement_status: 'FINALIZED',
        reconciliation_status: 'DISCREPANCY',
      },
      issues: [
        {
          id: 'issue-1',
          reconciliation_run_id: 'recon-run-2',
          issue_type: 'SUM_MISMATCH',
          description: 'Calculated item sum 950.0000 != batch net amount 1000.0000',
          call_commercial_id: null,
          expected_amount: '1000.0000',
          actual_amount: '950.0000',
          created_at: '2026-10-08T11:00:02.000Z',
        },
        {
          id: 'issue-2',
          reconciliation_run_id: 'recon-run-2',
          issue_type: 'DUPLICATE_CALL',
          description: 'CallCommercial cc-99 appears multiple times in batch line items',
          call_commercial_id: 'cc-99',
          expected_amount: null,
          actual_amount: null,
          created_at: '2026-10-08T11:00:02.000Z',
        },
      ],
    },
  ];

  it('13. Owner can view reconciliation dashboard', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-recon', name: 'Recon WS', role: 'OWNER' },
        ]);
      }
      if (url.includes('/reconciliation/runs')) {
        return Promise.resolve({
          items: mockRuns,
          total: 2,
        });
      }
      return Promise.resolve({});
    });

    render(<ReconciliationPage />);

    expect(screen.getByText('Reconciliation')).toBeDefined();
    expect(await screen.findByText('recon-run-1')).toBeDefined();
    expect(screen.getAllByText('WORKSPACE_LEVEL').length).toBeGreaterThan(0);
    expect(screen.getAllByText('BATCH_LEVEL').length).toBeGreaterThan(0);
  });

  it('14. Admin can view reconciliation dashboard', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-recon', name: 'Recon WS', role: 'ADMIN' },
        ]);
      }
      if (url.includes('/reconciliation/runs')) {
        return Promise.resolve({
          items: mockRuns,
          total: 2,
        });
      }
      return Promise.resolve({});
    });

    render(<ReconciliationPage />);

    expect(screen.getByText('Reconciliation')).toBeDefined();
    expect(await screen.findByText('recon-run-1')).toBeDefined();
  });

  it('15. Owner can run batch reconciliation', async () => {
    let batchReconCalled = false;
    (apiFetch as any).mockImplementation((url: string, opts?: any) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-recon', name: 'Recon WS', role: 'OWNER' },
        ]);
      }
      if (url.includes('/reconciliation/batches/batch-201/run') && opts?.method === 'POST') {
        batchReconCalled = true;
        return Promise.resolve({
          id: 'recon-run-new',
          status: 'RECONCILED',
          items_checked: 5,
          discrepancy_count: 0,
        });
      }
      if (url.includes('/reconciliation/runs')) {
        return Promise.resolve({
          items: mockRuns,
          total: 2,
        });
      }
      return Promise.resolve({});
    });

    render(<ReconciliationPage />);

    const openBatchModalBtn = await screen.findByRole('button', { name: /run batch reconciliation/i });
    fireEvent.click(openBatchModalBtn);

    // Enter batch ID
    const input = screen.getByPlaceholderText(/enter settlement batch id/i);
    fireEvent.change(input, { target: { value: 'batch-201' } });

    // Submit form
    const submitBtn = screen.getByRole('button', { name: /run batch audit/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(batchReconCalled).toBe(true);
    });
  });

  it('16. Owner can run workspace reconciliation', async () => {
    let workspaceReconCalled = false;
    (apiFetch as any).mockImplementation((url: string, opts?: any) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-recon', name: 'Recon WS', role: 'OWNER' },
        ]);
      }
      if (url.endsWith('/reconciliation/run') && opts?.method === 'POST') {
        workspaceReconCalled = true;
        return Promise.resolve({
          id: 'recon-run-ws',
          status: 'RECONCILED',
          items_checked: 50,
          discrepancy_count: 0,
        });
      }
      if (url.includes('/reconciliation/runs')) {
        return Promise.resolve({
          items: mockRuns,
          total: 2,
        });
      }
      return Promise.resolve({});
    });

    render(<ReconciliationPage />);

    const runWsBtn = await screen.findByRole('button', { name: /run workspace reconciliation/i });
    fireEvent.click(runWsBtn);

    const confirmBtn = await screen.findByRole('button', { name: /run audit/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(workspaceReconCalled).toBe(true);
    });
  });

  it('17 & 28. Admin cannot run reconciliation and workspace trigger is hidden', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-recon', name: 'Recon WS', role: 'ADMIN' },
        ]);
      }
      if (url.includes('/reconciliation/runs')) {
        return Promise.resolve({
          items: mockRuns,
          total: 2,
        });
      }
      return Promise.resolve({});
    });

    render(<ReconciliationPage />);

    await screen.findByText('recon-run-1');

    // Admin MUST NOT see Run Workspace Reconciliation or Run Batch Reconciliation
    expect(screen.queryByRole('button', { name: /run workspace reconciliation/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /run batch reconciliation/i })).toBeNull();
  });

  it('18 & 31. Buyer cannot access reconciliation', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-recon', name: 'Buyer WS', role: 'MEMBER', participant_type: 'BUYER' },
        ]);
      }
      return Promise.resolve({});
    });

    render(<ReconciliationPage />);

    expect(await screen.findByText('Access Forbidden')).toBeDefined();
    expect(screen.getByText(/Participants do not have access to reconciliation resources/i)).toBeDefined();
  });

  it('19 & 32. Vendor cannot access reconciliation', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-recon', name: 'Vendor WS', role: 'MEMBER', participant_type: 'VENDOR' },
        ]);
      }
      return Promise.resolve({});
    });

    render(<ReconciliationPage />);

    expect(await screen.findByText('Access Forbidden')).toBeDefined();
    expect(screen.getByText(/Participants do not have access to reconciliation resources/i)).toBeDefined();
  });

  it('20 & 21. issue list and discrepancy status render in detail view', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-recon', name: 'Recon WS', role: 'OWNER' },
        ]);
      }
      if (url.endsWith('/reconciliation/runs/recon-run-2')) {
        return Promise.resolve(mockRuns[1]);
      }
      if (url.endsWith('/reconciliation/runs/recon-run-2/issues')) {
        return Promise.resolve(mockRuns[1].issues);
      }
      return Promise.resolve({});
    });

    (useParams as any).mockReturnValue({ runId: 'recon-run-2' });

    render(<ReconciliationDetailPage />);

    expect((await screen.findAllByText('DISCREPANCY')).length).toBeGreaterThan(0);
    expect(screen.getByText('Audit Issues (2)')).toBeDefined();
    expect(screen.getByText('SUM_MISMATCH')).toBeDefined();
    expect(screen.getByText('DUPLICATE_CALL')).toBeDefined();
    expect(screen.getByText(/Calculated item sum 950.0000/)).toBeDefined();
  });

  it('22. API 403 handling displays access forbidden banner', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-recon', name: 'Recon WS', role: 'MEMBER', permissions: [] },
        ]);
      }
      if (url.includes('/reconciliation/runs')) {
        throw new Error('API error (403): Forbidden: Insufficient permission');
      }
      return Promise.resolve({});
    });

    render(<ReconciliationPage />);

    expect(await screen.findByText('Access Forbidden')).toBeDefined();
  });

  it('23. API 404 handling in detail view displays not found card', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-recon', name: 'Recon WS', role: 'OWNER' },
        ]);
      }
      if (url.includes('/reconciliation/runs/recon-run-nonexistent')) {
        throw new Error('API error (404): Reconciliation run not found');
      }
      return Promise.resolve({});
    });

    (useParams as any).mockReturnValue({ runId: 'recon-run-nonexistent' });

    render(<ReconciliationDetailPage />);

    expect(await screen.findByText('Reconciliation Run Not Found')).toBeDefined();
  });

  it('24. direct URL access blocked for VIEWER', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-recon', name: 'Recon WS', role: 'VIEWER' },
        ]);
      }
      return Promise.resolve({});
    });

    render(<ReconciliationPage />);

    expect(await screen.findByText('Access Forbidden')).toBeDefined();
    expect(screen.getByText(/Viewers do not have access/i)).toBeDefined();
  });

  it('27. cross-workspace reconciliation denied on backend', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-recon', name: 'Recon WS', role: 'OWNER' },
        ]);
      }
      if (url.includes('/reconciliation/runs/foreign-run-id')) {
        throw new Error('API error (404): Reconciliation run not found in workspace');
      }
      return Promise.resolve({});
    });

    (useParams as any).mockReturnValue({ runId: 'foreign-run-id' });

    render(<ReconciliationDetailPage />);

    expect(await screen.findByText('Reconciliation Run Not Found')).toBeDefined();
  });
});
