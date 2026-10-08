import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import CallDetailPage from './page';
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

describe('CallDetailPage Dispute & Adjustment UI (COMM-INTEGRATION-4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useSearchParams as any).mockReturnValue({
      get: (key: string) => (key === 'workspace' ? 'ws-test-456' : null),
    });
  });

  it('renders commercial financial details and dispute filing button when no dispute exists', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url.includes('/calls/call-1')) {
        return Promise.resolve({
          id: 'call-1',
          from_number: '+15551234567',
          to_number: '+15559876543',
          state: 'COMPLETED',
          created_at: '2026-10-01T10:00:00Z',
          attempts: [],
          commercial: {
            id: 'comm-1',
            status: 'PENDING',
            qualified: true,
            converted: true,
            duplicate: false,
            revenue: 100,
            payout: 50,
            currency: 'USD',
            buyer: { id: 'b-1', name: 'Premium Buyer' },
            dispute: null,
          },
        });
      }
      return Promise.resolve({});
    });

    render(<CallDetailPage params={{ callId: 'call-1' }} />);

    await waitFor(() => {
      expect(screen.getByText('Commercial Economics')).toBeDefined();
      expect(screen.getByText('File Dispute')).toBeDefined();
    });
  });

  it('allows user to file a dispute with reason and description', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url.includes('/calls/call-1')) {
        return Promise.resolve({
          id: 'call-1',
          from_number: '+15551234567',
          to_number: '+15559876543',
          state: 'COMPLETED',
          created_at: '2026-10-01T10:00:00Z',
          attempts: [],
          commercial: {
            id: 'comm-1',
            status: 'PENDING',
            qualified: true,
            converted: true,
            duplicate: false,
            revenue: 100,
            currency: 'USD',
            dispute: null,
          },
        });
      }
      if (url.includes('/call-commercials/comm-1/dispute')) {
        return Promise.resolve({
          id: 'disp-created-1',
          status: 'PENDING',
          reason: 'Call was silence only',
        });
      }
      return Promise.resolve({});
    });

    render(<CallDetailPage params={{ callId: 'call-1' }} />);

    await waitFor(() => {
      expect(screen.getByText('File Dispute')).toBeDefined();
    });

    fireEvent.click(screen.getByText('File Dispute'));

    const reasonInput = screen.getByLabelText(/Reason \*/i);
    fireEvent.change(reasonInput, { target: { value: 'Call was silence only' } });

    const submitBtn = screen.getByRole('button', { name: 'Submit Dispute' });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        '/workspaces/ws-test-456/call-commercials/comm-1/dispute',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            reason: 'Call was silence only',
          }),
        })
      );
    });
  });

  it('renders pending dispute and allows resolving dispute', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url.includes('/calls/call-2')) {
        return Promise.resolve({
          id: 'call-2',
          from_number: '+15551234567',
          to_number: '+15559876543',
          state: 'COMPLETED',
          created_at: '2026-10-01T10:00:00Z',
          attempts: [],
          commercial: {
            id: 'comm-2',
            status: 'PENDING',
            qualified: true,
            converted: true,
            duplicate: false,
            revenue: 80,
            currency: 'USD',
            dispute: {
              id: 'disp-2',
              status: 'PENDING',
              reason: 'Wrong geographic region',
            },
          },
        });
      }
      if (url.includes('/disputes/disp-2/resolve')) {
        return Promise.resolve({
          dispute: { id: 'disp-2', status: 'ACCEPTED' },
        });
      }
      return Promise.resolve({});
    });

    render(<CallDetailPage params={{ callId: 'call-2' }} />);

    await waitFor(() => {
      expect(screen.getByText('Buyer Dispute')).toBeDefined();
      expect(screen.getByText('Wrong geographic region')).toBeDefined();
      expect(screen.getByText('Accept Dispute')).toBeDefined();
      expect(screen.getByText('Reject Dispute')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Accept Dispute'));

    // In modal, click Accept Dispute
    const confirmButtons = screen.getAllByRole('button', { name: 'Accept Dispute' });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        '/workspaces/ws-test-456/disputes/disp-2/resolve',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            status: 'ACCEPTED',
          }),
        })
      );
    });
  });

  it('renders financial adjustment reversal when present', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url.includes('/calls/call-3')) {
        return Promise.resolve({
          id: 'call-3',
          from_number: '+15551234567',
          to_number: '+15559876543',
          state: 'COMPLETED',
          created_at: '2026-10-01T10:00:00Z',
          attempts: [],
          commercial: {
            id: 'comm-3',
            status: 'FINAL',
            qualified: true,
            converted: true,
            duplicate: false,
            revenue: 0,
            currency: 'USD',
            dispute: {
              id: 'disp-3',
              status: 'ACCEPTED',
              reason: 'Unqualified lead accepted by admin',
              resolution_notes: 'Full refund agreed',
            },
            adjustment: {
              id: 'adj-3',
              original_revenue: 120,
              adjusted_revenue: 0,
              original_payout: 60,
              adjusted_payout: 0,
              reason: 'Full refund agreed',
              created_at: '2026-10-02T10:00:00Z',
            },
          },
        });
      }
      return Promise.resolve({});
    });

    render(<CallDetailPage params={{ callId: 'call-3' }} />);

    await waitFor(() => {
      expect(screen.getByText('Financial Adjustment')).toBeDefined();
      expect(screen.getByText('Reversed')).toBeDefined();
      expect(screen.getByText('Original Revenue:')).toBeDefined();
      expect(screen.getByText('Adjusted Revenue:')).toBeDefined();
    });
  });

  it('COMM-INTEGRATION-6: scopes vendor view by hiding disputes, buyer identities, and non-vendor economics', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/workspaces') {
        return Promise.resolve([
          { id: 'ws-test-456', role: 'MEMBER', participant_type: 'VENDOR' },
        ]);
      }
      if (url.includes('/calls/call-vendor-1')) {
        return Promise.resolve({
          id: 'call-vendor-1',
          from_number: '+15551234567',
          to_number: '+15559876543',
          state: 'COMPLETED',
          created_at: '2026-10-01T10:00:00Z',
          campaign: { name: 'Inbound Campaign' },
          attempts: [
            {
              id: 'att-1',
              state: 'COMPLETED',
              buyer: { id: 'b-1', name: 'Secret Buyer Inc' },
              started_at: '2026-10-01T10:00:01Z',
              answered_at: '2026-10-01T10:00:05Z',
              ended_at: '2026-10-01T10:02:05Z',
            },
          ],
          commercial: {
            id: 'comm-v-1',
            status: 'FINAL',
            qualified: true,
            converted: true,
            duplicate: false,
            payout: 45.0,
            currency: 'USD',
            vendor: { id: 'v-1', name: 'Premier Vendor' },
            // dispute, revenue, cost, profit omitted for vendor
          },
        });
      }
      return Promise.resolve({});
    });

    render(<CallDetailPage params={{ callId: 'call-vendor-1' }} />);

    await waitFor(() => {
      expect(screen.getByText('Commercial Economics')).toBeDefined();
    });

    // Payout should be visible
    expect(screen.getByTestId('detail-payout')).toBeDefined();
    expect(screen.getByText('$45.00')).toBeDefined();

    // Revenue, Cost, Profit should NOT be visible
    expect(screen.queryByTestId('detail-revenue')).toBeNull();
    expect(screen.queryByTestId('detail-cost')).toBeNull();
    expect(screen.queryByTestId('detail-profit')).toBeNull();

    // Dispute actions and sections should NOT be visible
    expect(screen.queryByText('File Dispute')).toBeNull();
    expect(screen.queryByText('Buyer Dispute')).toBeNull();

    // Buyer identity should NOT be visible
    expect(screen.queryByText('Final Buyer')).toBeNull();
    expect(screen.queryByText('Commercial Buyer')).toBeNull();
    expect(screen.queryByText('Secret Buyer Inc')).toBeNull();

    // Timeline should show masked attempt
    expect(screen.getByText('Attempt #1')).toBeDefined();
    expect(screen.getByText('Sequence of routing attempts.')).toBeDefined();
  });
});
