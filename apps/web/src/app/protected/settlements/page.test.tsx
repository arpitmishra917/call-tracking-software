import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import SettlementsPage from './page';
import { apiFetch } from '@/lib/api';
import { useSearchParams } from 'next/navigation';

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

describe('SettlementsPage (COMM-INTEGRATION-5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useSearchParams as any).mockReturnValue({
      get: (key: string) => (key === 'workspace' ? 'ws-test-settle' : null),
    });
  });

  it('renders settlement batch list for authorized user', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-settle', name: 'Settlement WS', role: 'ADMIN' },
        ]);
      }
      if (url.includes('/settlements/batches?')) {
        return Promise.resolve({
          batches: [
            {
              id: 'batch-1',
              batch_number: 'SB-BUYER-B1-USD-20261001-20261008',
              workspace_id: 'ws-test-settle',
              participant_type: 'BUYER',
              buyer_id: 'buyer-1',
              currency: 'USD',
              period_start: '2026-10-01T00:00:00.000Z',
              period_end: '2026-10-08T00:00:00.000Z',
              gross_amount: '150.0000',
              adjustments_amount: '0.0000',
              net_amount: '150.0000',
              item_count: 3,
              settlement_status: 'DRAFT',
              payment_status: 'UNPROCESSED',
              reconciliation_status: 'UNRECONCILED',
              created_at: '2026-10-08T10:00:00.000Z',
            },
          ],
          total: 1,
        });
      }
      return Promise.resolve({});
    });

    render(<SettlementsPage />);

    expect(screen.getByText('Settlements')).toBeDefined();
    expect(await screen.findByText('SB-BUYER-B1-USD-20261001-20261008')).toBeDefined();
    expect(screen.getByText('Buyer Settlement')).toBeDefined();
    expect(screen.getAllByText('$150.00').length).toBeGreaterThan(0);
  });

  it('allows OWNER to see generate button and submit valid generation request', async () => {
    (apiFetch as any).mockImplementation((url: string, opts?: any) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-settle', name: 'Settlement WS', role: 'OWNER' },
        ]);
      }
      if (url.includes('/settlements/batches?')) {
        return Promise.resolve({
          batches: [],
          total: 0,
        });
      }
      if (url.includes('/settlements/batches/generate')) {
        return Promise.resolve({
          batches: [
            {
              id: 'batch-generated-1',
              batch_number: 'SB-BUYER-USD-OCT',
            },
          ],
        });
      }
      return Promise.resolve({});
    });

    render(<SettlementsPage />);

    const generateBtn = await screen.findByRole('button', { name: /generate batch/i });
    expect(generateBtn).toBeDefined();

    fireEvent.click(generateBtn);

    const startInput = screen.getByLabelText(/Period Start \(UTC\) \*/i);
    const endInput = screen.getByLabelText(/Period End \(UTC\) \*/i);

    fireEvent.change(startInput, { target: { value: '2026-10-01T00:00' } });
    fireEvent.change(endInput, { target: { value: '2026-10-08T00:00' } });

    const submitBtn = screen.getByRole('button', { name: 'Confirm Generate' });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        '/workspaces/ws-test-settle/settlements/batches/generate',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });
  });

  it('blocks ADMIN from seeing or triggering generation controls', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-settle', name: 'Settlement WS', role: 'ADMIN' },
        ]);
      }
      if (url.includes('/settlements/batches?')) {
        return Promise.resolve({
          batches: [],
          total: 0,
        });
      }
      return Promise.resolve({});
    });

    render(<SettlementsPage />);

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /generate batch/i })).toBeNull();
    });
  });

  it('rejects invalid period where start >= end with clear validation error', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-settle', name: 'Settlement WS', role: 'OWNER' },
        ]);
      }
      if (url.includes('/settlements/batches?')) {
        return Promise.resolve({
          batches: [],
          total: 0,
        });
      }
      return Promise.resolve({});
    });

    render(<SettlementsPage />);

    const generateBtn = await screen.findByRole('button', { name: /generate batch/i });
    fireEvent.click(generateBtn);

    const startInput = screen.getByLabelText(/Period Start \(UTC\) \*/i);
    const endInput = screen.getByLabelText(/Period End \(UTC\) \*/i);

    fireEvent.change(startInput, { target: { value: '2026-10-08T00:00' } });
    fireEvent.change(endInput, { target: { value: '2026-10-01T00:00' } });

    const submitBtn = screen.getByRole('button', { name: 'Confirm Generate' });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText('Period start must be before period end.')).toBeDefined();
    });
    expect(apiFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/settlements/batches/generate'),
      expect.anything()
    );
  });

  it('loads batch detail and line items when View Detail is clicked', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-settle', name: 'Settlement WS', role: 'OWNER' },
        ]);
      }
      if (url.includes('/settlements/batches?')) {
        return Promise.resolve({
          batches: [
            {
              id: 'batch-99',
              batch_number: 'SB-VENDOR-V1-USD',
              participant_type: 'VENDOR',
              vendor_id: 'vend-1',
              currency: 'USD',
              period_start: '2026-10-01T00:00:00.000Z',
              period_end: '2026-10-08T00:00:00.000Z',
              gross_amount: '90.0000',
              adjustments_amount: '0.0000',
              net_amount: '90.0000',
              item_count: 1,
              settlement_status: 'FINALIZED',
              payment_status: 'SUCCEEDED',
              reconciliation_status: 'RECONCILED',
              created_at: '2026-10-08T10:00:00.000Z',
            },
          ],
          total: 1,
        });
      }
      if (url.includes('/settlements/batches/batch-99/items')) {
        return Promise.resolve({
          items: [
            {
              id: 'item-1',
              settlement_batch_id: 'batch-99',
              call_commercial_id: 'comm-100',
              participant_type: 'VENDOR',
              amount: '90.0000',
              currency: 'USD',
              commercial: {
                id: 'comm-100',
                call_id: 'call-100',
                status: 'FINAL',
              },
            },
          ],
          total: 1,
        });
      }
      return Promise.resolve({});
    });

    render(<SettlementsPage />);

    const viewDetailBtn = await screen.findByRole('button', { name: /view detail/i });
    fireEvent.click(viewDetailBtn);

    expect(await screen.findByText('Batch: SB-VENDOR-V1-USD')).toBeDefined();
    expect(await screen.findByText('Call: call-100...')).toBeDefined();
    expect(screen.getByText('Gross Settlement')).toBeDefined();
  });

  it('immediately clears and never renders Workspace A settlement batches upon switching to Workspace B', async () => {
    let resolveWsBBatches: (value: any) => void;
    const pendingWsBBatches = new Promise((resolve) => {
      resolveWsBBatches = resolve;
    });

    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-settle', name: 'WS A', role: 'ADMIN' },
          { id: 'ws-settle-b', name: 'WS B', role: 'ADMIN' },
        ]);
      }
      if (url.includes('/workspaces/ws-test-settle/settlements/batches')) {
        return Promise.resolve({
          batches: [
            {
              id: 'batch-ws-a-unique',
              batch_number: 'SB-WS-A-EXCLUSIVE',
              workspace_id: 'ws-test-settle',
              participant_type: 'BUYER',
              buyer_id: 'buyer-a',
              currency: 'USD',
              gross_amount: '999.0000',
              net_amount: '999.0000',
              item_count: 5,
              settlement_status: 'FINALIZED',
              payment_status: 'SUCCEEDED',
              reconciliation_status: 'RECONCILED',
              created_at: '2026-10-08T10:00:00.000Z',
            },
          ],
          total: 1,
        });
      }
      if (url.includes('/workspaces/ws-settle-b/settlements/batches')) {
        return pendingWsBBatches;
      }
      return Promise.resolve({});
    });

    (useSearchParams as any).mockReturnValue({
      get: (key: string) => (key === 'workspace' ? 'ws-test-settle' : null),
    });

    const { rerender } = render(<SettlementsPage />);

    // Workspace A batch renders
    await screen.findByText('SB-WS-A-EXCLUSIVE');

    // Switch to Workspace B while Workspace B is pending
    (useSearchParams as any).mockReturnValue({
      get: (key: string) => (key === 'workspace' ? 'ws-settle-b' : null),
    });
    rerender(<SettlementsPage />);

    // Render-time identity guard check:
    // Workspace A data must NOT be rendered even briefly while Workspace B is pending
    expect(screen.queryByText('SB-WS-A-EXCLUSIVE')).toBeNull();
    expect(screen.getByText(/Loading settlement batches.../i)).toBeDefined();

    // Resolve Workspace B
    resolveWsBBatches!({
      batches: [
        {
          id: 'batch-ws-b-unique',
          batch_number: 'SB-WS-B-EXCLUSIVE',
          workspace_id: 'ws-settle-b',
          participant_type: 'VENDOR',
          vendor_id: 'vendor-b',
          currency: 'USD',
          gross_amount: '555.0000',
          net_amount: '555.0000',
          item_count: 2,
          settlement_status: 'FINALIZED',
          payment_status: 'SUCCEEDED',
          reconciliation_status: 'RECONCILED',
          created_at: '2026-10-08T11:00:00.000Z',
        },
      ],
      total: 1,
    });

    await waitFor(() => {
      expect(screen.getByText('SB-WS-B-EXCLUSIVE')).toBeDefined();
      expect(screen.queryByText('SB-WS-A-EXCLUSIVE')).toBeNull();
    });
  });
});
