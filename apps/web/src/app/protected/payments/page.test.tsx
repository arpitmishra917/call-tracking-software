import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import PaymentsPage from './page';
import PaymentDetailPage from './[instructionId]/page';
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

describe('Payments Frontend & Security (COMM-INTEGRATION-8C)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useSearchParams as any).mockReturnValue({
      get: (key: string) => (key === 'workspace' ? 'ws-test-payments' : null),
    });
    (useParams as any).mockReturnValue({
      instructionId: 'inst-1',
    });
  });

  const mockInstructions = [
    {
      id: 'inst-1',
      workspace_id: 'ws-test-payments',
      settlement_batch_id: 'batch-101',
      direction: 'DISBURSEMENT',
      amount: '500.0000',
      currency: 'USD',
      participant_type: 'VENDOR',
      status: 'CREATED',
      created_at: '2026-10-08T12:00:00.000Z',
      updated_at: '2026-10-08T12:00:00.000Z',
      settlement_batch: {
        id: 'batch-101',
        batch_number: 'SB-VENDOR-V1-OCT',
        net_amount: '500.0000',
        currency: 'USD',
        settlement_status: 'FINALIZED',
        payment_status: 'UNPROCESSED',
      },
      executions: [],
    },
    {
      id: 'inst-2',
      workspace_id: 'ws-test-payments',
      settlement_batch_id: 'batch-102',
      direction: 'COLLECTION',
      amount: '1200.0000',
      currency: 'USD',
      participant_type: 'BUYER',
      status: 'FAILED',
      created_at: '2026-10-08T11:00:00.000Z',
      updated_at: '2026-10-08T11:30:00.000Z',
      settlement_batch: {
        id: 'batch-102',
        batch_number: 'SB-BUYER-B1-OCT',
        net_amount: '1200.0000',
        currency: 'USD',
        settlement_status: 'FINALIZED',
        payment_status: 'FAILED',
      },
      executions: [
        {
          id: 'exec-1',
          payment_instruction_id: 'inst-2',
          attempt_number: 1,
          provider: 'wire',
          provider_transaction_id: 'wire_tx_12345',
          status: 'FAILED',
          failure_code: 'INSUFFICIENT_FUNDS',
          error_message: 'Wire transfer rejected: Insufficient funds',
          initiated_at: '2026-10-08T11:05:00.000Z',
          completed_at: '2026-10-08T11:30:00.000Z',
          created_at: '2026-10-08T11:05:00.000Z',
          updated_at: '2026-10-08T11:30:00.000Z',
        },
      ],
    },
    {
      id: 'inst-3',
      workspace_id: 'ws-test-payments',
      settlement_batch_id: 'batch-103',
      direction: 'DISBURSEMENT',
      amount: '750.0000',
      currency: 'USD',
      participant_type: 'VENDOR',
      status: 'SUCCEEDED',
      created_at: '2026-10-08T10:00:00.000Z',
      updated_at: '2026-10-08T10:15:00.000Z',
      settlement_batch: {
        id: 'batch-103',
        batch_number: 'SB-VENDOR-V2-OCT',
        net_amount: '750.0000',
        currency: 'USD',
        settlement_status: 'FINALIZED',
        payment_status: 'SUCCEEDED',
      },
      executions: [
        {
          id: 'exec-2',
          payment_instruction_id: 'inst-3',
          attempt_number: 1,
          provider: 'manual',
          provider_transaction_id: 'man_tx_99999',
          status: 'SUCCEEDED',
          initiated_at: '2026-10-08T10:05:00.000Z',
          completed_at: '2026-10-08T10:15:00.000Z',
          created_at: '2026-10-08T10:05:00.000Z',
          updated_at: '2026-10-08T10:15:00.000Z',
        },
      ],
    },
  ];

  it('1. Owner can see payments', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-payments', name: 'Test WS', role: 'OWNER' },
        ]);
      }
      if (url.includes('/payments/instructions')) {
        return Promise.resolve({
          items: mockInstructions,
          total: 3,
        });
      }
      return Promise.resolve({});
    });

    render(<PaymentsPage />);

    expect(screen.getByText('Payments')).toBeDefined();
    expect(await screen.findByText('inst-1')).toBeDefined();
    expect(screen.getByText('SB-VENDOR-V1-OCT')).toBeDefined();
    expect(screen.getAllByText('$500.00').length).toBeGreaterThan(0);
  });

  it('2. Admin can see payments in read-only mode', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-payments', name: 'Test WS', role: 'ADMIN' },
        ]);
      }
      if (url.includes('/payments/instructions')) {
        return Promise.resolve({
          items: mockInstructions,
          total: 3,
        });
      }
      return Promise.resolve({});
    });

    render(<PaymentsPage />);

    expect(screen.getByText('Payments')).toBeDefined();
    expect(await screen.findByText('inst-1')).toBeDefined();
  });

  it('3. Admin cannot execute payments', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-payments', name: 'Test WS', role: 'ADMIN' },
        ]);
      }
      if (url.includes('/payments/instructions')) {
        return Promise.resolve({
          items: mockInstructions,
          total: 3,
        });
      }
      return Promise.resolve({});
    });

    render(<PaymentsPage />);

    await screen.findByText('inst-1');
    // Admin must NOT see Execute button
    expect(screen.queryByRole('button', { name: /execute/i })).toBeNull();
  });

  it('4. Admin cannot retry payments', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-payments', name: 'Test WS', role: 'ADMIN' },
        ]);
      }
      if (url.includes('/payments/instructions')) {
        return Promise.resolve({
          items: mockInstructions,
          total: 3,
        });
      }
      return Promise.resolve({});
    });

    render(<PaymentsPage />);

    await screen.findByText('inst-2');
    // Admin must NOT see Retry button
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('5. Owner can execute payment instruction', async () => {
    let executionCalled = false;
    (apiFetch as any).mockImplementation((url: string, opts?: any) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-payments', name: 'Test WS', role: 'OWNER' },
        ]);
      }
      if (url.includes('/payments/instructions/inst-1/executions') && opts?.method === 'POST') {
        executionCalled = true;
        return Promise.resolve({
          id: 'exec-new',
          status: 'SUCCEEDED',
          provider: 'mock',
        });
      }
      if (url.includes('/payments/instructions')) {
        return Promise.resolve({
          items: mockInstructions,
          total: 3,
        });
      }
      return Promise.resolve({});
    });

    render(<PaymentsPage />);

    const executeBtn = await screen.findByRole('button', { name: /execute/i });
    expect(executeBtn).toBeDefined();

    fireEvent.click(executeBtn);

    // Modal opens, confirm execution
    const confirmBtn = await screen.findByRole('button', { name: /confirm execution/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(executionCalled).toBe(true);
    });
  });

  it('6. Owner can retry failed instruction', async () => {
    let retryCalled = false;
    (apiFetch as any).mockImplementation((url: string, opts?: any) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-payments', name: 'Test WS', role: 'OWNER' },
        ]);
      }
      if (url.includes('/payments/instructions/inst-2/retry') && opts?.method === 'POST') {
        retryCalled = true;
        return Promise.resolve({
          id: 'exec-retry',
          status: 'SUCCEEDED',
          provider: 'mock',
        });
      }
      if (url.includes('/payments/instructions')) {
        return Promise.resolve({
          items: mockInstructions,
          total: 3,
        });
      }
      return Promise.resolve({});
    });

    render(<PaymentsPage />);

    const retryBtn = await screen.findByRole('button', { name: /retry/i });
    expect(retryBtn).toBeDefined();

    fireEvent.click(retryBtn);

    const confirmBtn = await screen.findByRole('button', { name: /retry payment/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(retryCalled).toBe(true);
    });
  });

  it('7. payment statuses render correctly', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-payments', name: 'Test WS', role: 'OWNER' },
        ]);
      }
      if (url.includes('/payments/instructions')) {
        return Promise.resolve({
          items: mockInstructions,
          total: 3,
        });
      }
      return Promise.resolve({});
    });

    render(<PaymentsPage />);

    expect(await screen.findByText('CREATED')).toBeDefined();
    expect(screen.getByText('FAILED')).toBeDefined();
    expect(screen.getByText('SUCCEEDED')).toBeDefined();
  });

  it('8. execution attempts render correctly in detail view (append-only)', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-payments', name: 'Test WS', role: 'OWNER' },
        ]);
      }
      if (url.includes('/payments/instructions/inst-2')) {
        return Promise.resolve(mockInstructions[1]);
      }
      return Promise.resolve({});
    });

    (useParams as any).mockReturnValue({ instructionId: 'inst-2' });

    render(<PaymentDetailPage />);

    expect(await screen.findByText('Execution History (1 attempts)')).toBeDefined();
    expect(screen.getByText('#1')).toBeDefined();
    expect(screen.getByText('wire')).toBeDefined();
    expect(screen.getByText(/INSUFFICIENT_FUNDS/)).toBeDefined();
  });

  it('9. duplicate action prevention disables button while executing', async () => {
    let resolveExecution: any;
    const executionPromise = new Promise((resolve) => {
      resolveExecution = resolve;
    });

    (apiFetch as any).mockImplementation((url: string, opts?: any) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-payments', name: 'Test WS', role: 'OWNER' },
        ]);
      }
      if (url.includes('/payments/instructions/inst-1/executions') && opts?.method === 'POST') {
        return executionPromise;
      }
      if (url.includes('/payments/instructions')) {
        return Promise.resolve({
          items: mockInstructions,
          total: 3,
        });
      }
      return Promise.resolve({});
    });

    render(<PaymentsPage />);

    const executeBtn = await screen.findByRole('button', { name: /execute/i });
    fireEvent.click(executeBtn);

    const confirmBtn = await screen.findByRole('button', { name: /confirm execution/i });
    fireEvent.click(confirmBtn);

    // Button should be disabled during submission
    expect(confirmBtn.hasAttribute('disabled')).toBe(true);

    // Resolve promise
    resolveExecution({ id: 'exec-done', status: 'SUCCEEDED' });
  });

  it('10. API 403 handling displays access forbidden banner', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-payments', name: 'Test WS', role: 'MEMBER', permissions: [] },
        ]);
      }
      if (url.includes('/payments/instructions')) {
        throw new Error('API error (403): Forbidden: Insufficient permission');
      }
      return Promise.resolve({});
    });

    render(<PaymentsPage />);

    expect(await screen.findByText('Access Forbidden')).toBeDefined();
  });

  it('11. API 404 handling in detail view displays not found card', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-payments', name: 'Test WS', role: 'OWNER' },
        ]);
      }
      if (url.includes('/payments/instructions/inst-nonexistent')) {
        throw new Error('API error (404): Payment instruction not found');
      }
      return Promise.resolve({});
    });

    (useParams as any).mockReturnValue({ instructionId: 'inst-nonexistent' });

    render(<PaymentDetailPage />);

    expect(await screen.findByText('Payment Instruction Not Found')).toBeDefined();
  });

  it('12. direct URL access blocked for VIEWER', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-payments', name: 'Test WS', role: 'VIEWER' },
        ]);
      }
      return Promise.resolve({});
    });

    render(<PaymentsPage />);

    expect(await screen.findByText('Access Forbidden')).toBeDefined();
    expect(screen.getByText(/Viewers do not have access/i)).toBeDefined();
  });

  it('29. buyer payment access denied', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-payments', name: 'Buyer WS', role: 'MEMBER', participant_type: 'BUYER' },
        ]);
      }
      return Promise.resolve({});
    });

    render(<PaymentsPage />);

    expect(await screen.findByText('Access Forbidden')).toBeDefined();
    expect(screen.getByText(/Participants do not have access to payment resources/i)).toBeDefined();
  });

  it('30. vendor payment access denied', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-payments', name: 'Vendor WS', role: 'MEMBER', participant_type: 'VENDOR' },
        ]);
      }
      return Promise.resolve({});
    });

    render(<PaymentsPage />);

    expect(await screen.findByText('Access Forbidden')).toBeDefined();
    expect(screen.getByText(/Participants do not have access to payment resources/i)).toBeDefined();
  });

  it('25. cross-workspace payment denied', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-payments', name: 'Test WS', role: 'OWNER' },
        ]);
      }
      if (url.includes('/payments/instructions/ws2-inst-id')) {
        throw new Error('API error (404): Payment instruction not found');
      }
      return Promise.resolve({});
    });

    (useParams as any).mockReturnValue({ instructionId: 'ws2-inst-id' });

    render(<PaymentDetailPage />);

    expect(await screen.findByText('Payment Instruction Not Found')).toBeDefined();
  });

  it('26. cross-workspace execution denied', async () => {
    (apiFetch as any).mockImplementation((url: string, opts?: any) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-payments', name: 'Test WS', role: 'OWNER' },
        ]);
      }
      if (url.includes('/payments/instructions/inst-1/executions') && opts?.method === 'POST') {
        throw new Error('API error (403): Workspace mismatch for payment execution');
      }
      if (url.includes('/payments/instructions')) {
        return Promise.resolve({
          items: mockInstructions,
          total: 3,
        });
      }
      return Promise.resolve({});
    });

    render(<PaymentsPage />);

    const executeBtn = await screen.findByRole('button', { name: /execute/i });
    fireEvent.click(executeBtn);

    const confirmBtn = await screen.findByRole('button', { name: /confirm execution/i });
    fireEvent.click(confirmBtn);

    expect(await screen.findByText(/Workspace mismatch for payment execution/)).toBeDefined();
  });

  describe('Direction filter alignment with PaymentDirection enum', () => {
    beforeEach(() => {
      vi.mocked(apiFetch).mockImplementation((url: string) => {
        if (url === '/workspaces') {
          return Promise.resolve([
            { id: 'ws-test-payments', name: 'Test WS', role: 'OWNER' },
          ]);
        }
        if (url.includes('/payments/instructions')) {
          return Promise.resolve({
            items: mockInstructions,
            total: 3,
          });
        }
        return Promise.resolve({});
      });
    });

    it('renders COLLECTION and DISBURSEMENT options and does not offer PAYOUT', async () => {
      render(<PaymentsPage />);
      await screen.findByText('inst-1');

      const directionSelect = screen.getByLabelText('Direction');
      expect(directionSelect).toBeDefined();

      const options = Array.from((directionSelect as HTMLSelectElement).options).map(
        (opt) => ({ text: opt.text, value: opt.value })
      );

      expect(options).toEqual([
        { text: 'All Directions', value: '' },
        { text: 'COLLECTION', value: 'COLLECTION' },
        { text: 'DISBURSEMENT', value: 'DISBURSEMENT' },
      ]);
      expect(options.some((opt) => opt.value === 'PAYOUT' || opt.text === 'PAYOUT')).toBe(false);
    });

    it('passes COLLECTION selection unchanged to the backend query', async () => {
      render(<PaymentsPage />);
      await screen.findByText('inst-1');

      const directionSelect = screen.getByLabelText('Direction');
      fireEvent.change(directionSelect, { target: { value: 'COLLECTION' } });

      await waitFor(() => {
        expect(apiFetch).toHaveBeenCalledWith(
          expect.stringContaining('/payments/instructions?limit=25&offset=0&direction=COLLECTION')
        );
      });
    });

    it('passes DISBURSEMENT selection unchanged to the backend query', async () => {
      render(<PaymentsPage />);
      await screen.findByText('inst-1');

      const directionSelect = screen.getByLabelText('Direction');
      fireEvent.change(directionSelect, { target: { value: 'DISBURSEMENT' } });

      await waitFor(() => {
        expect(apiFetch).toHaveBeenCalledWith(
          expect.stringContaining('/payments/instructions?limit=25&offset=0&direction=DISBURSEMENT')
        );
      });
    });

    it('clearing the filter returns to all directions without direction parameter', async () => {
      render(<PaymentsPage />);
      await screen.findByText('inst-1');

      const directionSelect = screen.getByLabelText('Direction');

      // First select DISBURSEMENT
      fireEvent.change(directionSelect, { target: { value: 'DISBURSEMENT' } });
      await waitFor(() => {
        expect(apiFetch).toHaveBeenCalledWith(
          expect.stringContaining('direction=DISBURSEMENT')
        );
      });

      // Clear filter back to All Directions ("")
      fireEvent.change(directionSelect, { target: { value: '' } });
      await waitFor(() => {
        const calls = vi.mocked(apiFetch).mock.calls;
        const lastCall = calls[calls.length - 1][0];
        expect(lastCall).toContain('/payments/instructions?limit=25&offset=0');
        expect(lastCall).not.toContain('direction=');
      });
    });

    it('immediately clears and never renders Workspace A payment instructions upon switching to Workspace B', async () => {
      let resolveWsBInstructions: (value: any) => void;
      const pendingWsBInstructions = new Promise((resolve) => {
        resolveWsBInstructions = resolve;
      });

      (apiFetch as any).mockImplementation((url: string) => {
        if (url === '/workspaces') {
          return Promise.resolve([
            { id: 'ws-test-payments', name: 'WS A', role: 'ADMIN' },
            { id: 'ws-payments-b', name: 'WS B', role: 'ADMIN' },
          ]);
        }
        if (url.includes('/workspaces/ws-test-payments/payments/instructions')) {
          return Promise.resolve({
            items: [
              {
                id: 'inst-ws-a-unique',
                workspace_id: 'ws-test-payments',
                direction: 'COLLECTION',
                amount: '444.0000',
                currency: 'USD',
                participant_type: 'BUYER',
                status: 'CREATED',
                created_at: '2026-10-08T12:00:00.000Z',
                executions: [],
              },
            ],
            total: 1,
          });
        }
        if (url.includes('/workspaces/ws-payments-b/payments/instructions')) {
          return pendingWsBInstructions;
        }
        return Promise.resolve({});
      });

      (useSearchParams as any).mockReturnValue({
        get: (key: string) => (key === 'workspace' ? 'ws-test-payments' : null),
      });

      const { rerender } = render(<PaymentsPage />);

      // Workspace A instruction renders
      await screen.findByText('inst-ws-a-unique');

      // Switch to Workspace B while Workspace B is pending
      (useSearchParams as any).mockReturnValue({
        get: (key: string) => (key === 'workspace' ? 'ws-payments-b' : null),
      });
      rerender(<PaymentsPage />);

      // Render-time identity guard check:
      // Workspace A data must NOT be rendered even briefly while Workspace B is pending
      expect(screen.queryByText('inst-ws-a-unique')).toBeNull();
      expect(screen.getByText(/Loading payment instructions.../i)).toBeDefined();

      // Resolve Workspace B
      resolveWsBInstructions!({
        items: [
          {
            id: 'inst-ws-b-unique',
            workspace_id: 'ws-payments-b',
            direction: 'DISBURSEMENT',
            amount: '777.0000',
            currency: 'USD',
            participant_type: 'VENDOR',
            status: 'SUCCEEDED',
            created_at: '2026-10-08T12:00:00.000Z',
            executions: [],
          },
        ],
        total: 1,
      });

      await waitFor(() => {
        expect(screen.getByText('inst-ws-b-unique')).toBeDefined();
        expect(screen.queryByText('inst-ws-a-unique')).toBeNull();
      });
    });
  });
});

