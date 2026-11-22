import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BillingPage from './page';
import { vi, describe, it, expect, beforeEach } from 'vitest';

let mockWorkspaceId = 'ws-1';

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: (key: string) => (key === 'workspace' ? mockWorkspaceId : null),
  }),
}));

const mockApiFetch = vi.fn();
vi.mock('@/lib/api', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

describe('BillingPage Wallet UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders wallet section and development mode label', async () => {
    mockApiFetch.mockImplementation((url: string) => {
      if (url.includes('/billing/balance')) return Promise.resolve({ balance: { amountMinor: 2500, currency: 'USD' } });
      if (url.includes('/billing/wallet/transactions')) return Promise.resolve([]);
      return Promise.resolve({});
    });

    render(<BillingPage />);

    expect(await screen.findByText('Development Mode — Mock payment (no real money is charged)')).toBeTruthy();
    expect((await screen.findAllByText('$25.00')).length).toBeGreaterThan(0);
    expect(screen.getByText('Add Mock Funds')).toBeTruthy();
  });

  it('successfully triggers mock top-up and refreshes data', async () => {
    mockApiFetch.mockImplementation((url: string) => {
      if (url.includes('/billing/wallet/mock-topup')) return Promise.resolve({});
      if (url.includes('/billing/balance')) return Promise.resolve({ balance: { amountMinor: 5000, currency: 'USD' } });
      if (url.includes('/billing/wallet/transactions')) return Promise.resolve([{ id: '1', type: 'CREDIT', amount_minor: 2500, balance_after: 5000, created_at: new Date().toISOString() }]);
      return Promise.resolve({});
    });

    const alertMock = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const dispatchMock = vi.spyOn(window, 'dispatchEvent');

    render(<BillingPage />);
    
    // Wait for initial load
    await screen.findByText('Prepaid Wallet');

    const topUpButtons = await screen.findAllByText('$25.00');
    fireEvent.click(topUpButtons[0]);

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(expect.stringContaining('/billing/wallet/mock-topup'), expect.any(Object));
      expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('Mock top-up successful'));
      expect(dispatchMock).toHaveBeenCalledWith(expect.any(Event));
    });

    // Check transaction rendered
    expect(await screen.findByText('+$25.00')).toBeTruthy();
  });

  it('immediately clears and never renders Workspace A data synchronously upon switching to Workspace B', async () => {
    let resolveWsBBalance: (value: any) => void;
    const pendingWsBBalance = new Promise((resolve) => {
      resolveWsBBalance = resolve;
    });

    mockApiFetch.mockImplementation((url: string) => {
      if (url.includes('/workspaces/ws-1/billing/balance')) {
        return Promise.resolve({ balance: { amountMinor: 9900, currency: 'USD' } });
      }
      if (url.includes('/workspaces/ws-1/billing/wallet/transactions')) {
        return Promise.resolve([
          { id: 'tx-ws-1', type: 'CREDIT', amount_minor: 9900, balance_after: 9900, created_at: new Date().toISOString() },
        ]);
      }
      if (url.includes('/workspaces/ws-2/billing/balance')) {
        return pendingWsBBalance;
      }
      if (url.includes('/workspaces/ws-2/billing/wallet/transactions')) {
        return Promise.resolve([]);
      }
      return Promise.resolve({});
    });

    mockWorkspaceId = 'ws-1';
    const { rerender } = render(<BillingPage />);

    // Wait for ws-1 data to render
    expect((await screen.findAllByText('$99.00')).length).toBeGreaterThan(0);

    // Switch to Workspace B while Workspace B request is pending
    mockWorkspaceId = 'ws-2';
    rerender(<BillingPage />);

    // Render-time identity guard check:
    // Workspace A balance $99.00 must NOT be rendered even briefly while Workspace B is pending
    expect(screen.queryByText('$99.00')).toBeNull();

    // Resolve Workspace B
    resolveWsBBalance!({ balance: { amountMinor: 1200, currency: 'USD' } });

    await waitFor(() => {
      expect(screen.getAllByText('$12.00').length).toBeGreaterThan(0);
      expect(screen.queryByText('$99.00')).toBeNull();
    });
  });
});
