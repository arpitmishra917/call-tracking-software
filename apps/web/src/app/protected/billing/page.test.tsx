import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BillingPage from './page';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: (key: string) => (key === 'workspace' ? 'ws-1' : null),
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
});
